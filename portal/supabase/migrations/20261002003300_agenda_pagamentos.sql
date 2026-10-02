-- =============================================================================
-- Agenda de pagamentos do cliente
--
--  * As guias publicadas pelo escritório (categoria "Guias de impostos", com
--    vencimento) formam a agenda do mês da empresa.
--  * O cliente informa "paguei" (data, valor e, de preferência, o comprovante
--    enviado pelo portal). O escritório é avisado e a informação entra no
--    histórico da tarefa de pagamento; quem conclui a tarefa continua sendo a
--    equipe, escolhendo o comprovante (nada é baixado automaticamente).
-- =============================================================================

create table public.guia_pagamentos (
  guia_documento_id uuid primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pago_em date not null,
  valor_pago numeric(15, 2) check (valor_pago is null or valor_pago > 0),
  comprovante_documento_id uuid,
  observacao text check (observacao is null or length(observacao) <= 500),
  informado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  informado_em timestamptz not null default now(),
  constraint guia_pagamentos_guia_fk foreign key (empresa_id, guia_documento_id)
    references public.documentos (empresa_id, id) on delete cascade,
  constraint guia_pagamentos_comprovante_fk foreign key (empresa_id, comprovante_documento_id)
    references public.documentos (empresa_id, id) on delete set null (comprovante_documento_id)
);
create index guia_pagamentos_empresa_idx on public.guia_pagamentos (empresa_id, pago_em);

alter table public.guia_pagamentos enable row level security;
create policy guia_pagamentos_leitura on public.guia_pagamentos for select to authenticated
  using ((select app.pode(empresa_id, 'documentos.ver')));
grant select on public.guia_pagamentos to authenticated;

-- O cliente (ou a equipe) informa o pagamento de uma guia publicada.
create or replace function public.informar_pagamento_guia(
  p_guia_id uuid,
  p_pago_em date,
  p_valor numeric default null,
  p_comprovante_id uuid default null,
  p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guia public.documentos;
  v_comp public.documentos;
  v_tarefa uuid;
  v_nome text;
  v_link text;
begin
  select * into v_guia from public.documentos where id = p_guia_id;
  if not found or v_guia.direcao <> 'escritorio' or v_guia.categoria_codigo <> 'esc_guia'
     or v_guia.publicado_em is null or v_guia.excluido_em is not null then
    raise exception 'Guia não encontrada.';
  end if;
  perform app.exigir(v_guia.empresa_id, 'documentos.enviar');
  if p_pago_em is null or p_pago_em > app.hoje() then
    raise exception 'Informe a data do pagamento (hoje ou antes).';
  end if;
  if p_pago_em < v_guia.competencia - interval '1 year' then
    raise exception 'Data do pagamento muito antiga para esta guia.';
  end if;
  if p_valor is not null and p_valor <= 0 then
    raise exception 'Valor inválido.';
  end if;
  if p_comprovante_id is not null then
    select * into v_comp from public.documentos where id = p_comprovante_id;
    if not found or v_comp.empresa_id <> v_guia.empresa_id or v_comp.excluido_em is not null then
      raise exception 'Comprovante não encontrado.';
    end if;
  end if;

  insert into public.guia_pagamentos (guia_documento_id, empresa_id, pago_em, valor_pago, comprovante_documento_id, observacao, informado_por, informado_em)
  values (p_guia_id, v_guia.empresa_id, p_pago_em, p_valor, p_comprovante_id, nullif(trim(coalesce(p_observacao, '')), ''), auth.uid(), now())
  on conflict (guia_documento_id) do update
    set pago_em = excluded.pago_em, valor_pago = excluded.valor_pago,
        comprovante_documento_id = coalesce(excluded.comprovante_documento_id, public.guia_pagamentos.comprovante_documento_id),
        observacao = excluded.observacao, informado_por = excluded.informado_por, informado_em = now();

  v_nome := coalesce(v_guia.titulo, v_guia.nome_original);
  -- Histórico da tarefa de pagamento ligada à guia (a equipe conclui escolhendo o comprovante)
  select t.id into v_tarefa from public.tarefas t
   where t.guia_documento_id = p_guia_id and t.etapa = 'pagamento' and t.status not in ('concluida', 'dispensada')
   limit 1;
  if v_tarefa is not null then
    insert into public.tarefa_historico (tarefa_id, empresa_id, acao, comentario, detalhes, usuario_id)
    values (v_tarefa, v_guia.empresa_id, 'pagamento_informado',
            'Pagamento informado pelo cliente em ' || to_char(p_pago_em, 'DD/MM/YYYY') ||
            case when p_comprovante_id is null then ' (sem comprovante).' else ' com comprovante.' end,
            jsonb_build_object('pago_em', p_pago_em, 'valor', p_valor, 'comprovante', p_comprovante_id), auth.uid());
  end if;
  v_link := case when v_tarefa is not null then '/escritorio/obrigacoes/tarefas/' || v_tarefa::text
                 else '/e/' || v_guia.empresa_id::text || '/documentos/' || p_guia_id::text end;
  perform app.notificar_equipe(v_guia.empresa_id, 'pagamento_informado',
    'Pagamento informado: ' || v_nome,
    'Pago em ' || to_char(p_pago_em, 'DD/MM/YYYY') ||
      case when p_valor is not null then ' — R$ ' || replace(to_char(p_valor, 'FM999999999990.00'), '.', ',') else '' end ||
      case when p_comprovante_id is null then '. Comprovante ainda não enviado.' else '. Comprovante enviado pelo portal.' end,
    v_link, false);
  perform app.registrar_auditoria('pagamento_guia_informado', 'documentos', p_guia_id::text, v_guia.empresa_id,
    jsonb_build_object('pago_em', p_pago_em, 'valor', p_valor, 'comprovante', p_comprovante_id));
end;
$$;

-- Desfaz o "paguei" (informado por engano).
create or replace function public.desfazer_pagamento_guia(p_guia_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.guia_pagamentos where guia_documento_id = p_guia_id;
  if v_empresa is null then
    raise exception 'Pagamento não encontrado.';
  end if;
  perform app.exigir(v_empresa, 'documentos.enviar');
  delete from public.guia_pagamentos where guia_documento_id = p_guia_id;
  perform app.registrar_auditoria('pagamento_guia_desfeito', 'documentos', p_guia_id::text, v_empresa, '{}'::jsonb);
end;
$$;

revoke execute on function public.informar_pagamento_guia(uuid, date, numeric, uuid, text), public.desfazer_pagamento_guia(uuid) from public, anon;
grant execute on function public.informar_pagamento_guia(uuid, date, numeric, uuid, text), public.desfazer_pagamento_guia(uuid) to authenticated;
