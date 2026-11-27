-- =============================================================================
-- Migração 1200: lembretes, rotinas diárias e integrações opcionais
-- =============================================================================

create table public.lembretes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date,
  data_referencia date not null default app.hoje(),
  tipo text not null default 'automatico' check (tipo in ('automatico', 'manual')),
  regra text,                                   -- ex.: "D-5", "D+2", "manual"
  itens uuid[] not null default array[]::uuid[],
  mensagem text,
  destinatarios int not null default 0,
  canais text[] not null default array['sistema']::text[],
  enviado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint lembretes_automatico_unico unique (empresa_id, data_referencia, regra, tipo)
);
create index lembretes_empresa_idx on public.lembretes (empresa_id, created_at desc);

-- Envia lembrete (sistema + e-mail; WhatsApp somente se configurado) para os
-- clientes com permissão de envio de documentos.
create or replace function app.enviar_lembrete(
  p_empresa_id uuid,
  p_competencia date,
  p_itens uuid[],
  p_regra text,
  p_tipo text,
  p_mensagem text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc public.escritorio;
  v_emp public.empresas;
  v_lista text;
  v_titulo text;
  v_corpo text;
  v_id uuid;
  v_n int;
  v_canais text[] := array['sistema'];
  v_atrasados int;
  r record;
  v_envio uuid;
begin
  select * into v_esc from public.escritorio where id = 1;
  select * into v_emp from public.empresas where id = p_empresa_id;
  if cardinality(coalesce(p_itens, array[]::uuid[])) = 0 then
    return null;
  end if;

  select string_agg('• ' || i.titulo || ' — prazo ' || to_char(i.prazo, 'DD/MM/YYYY')
                    || case when i.status = 'correcao' then ' (precisa de correção)' when i.prazo < app.hoje() then ' (atrasado)' else '' end,
                    E'\n' order by i.prazo, i.titulo),
         count(*) filter (where i.prazo < app.hoje())
    into v_lista, v_atrasados
    from public.checklist_itens i
   where i.id = any(p_itens);

  v_titulo := case when v_atrasados > 0
                   then 'Documentos em atraso — ' || coalesce(v_emp.nome_fantasia, v_emp.razao_social)
                   else 'Lembrete de documentos — ' || coalesce(v_emp.nome_fantasia, v_emp.razao_social) end;
  v_corpo := coalesce(nullif(trim(coalesce(p_mensagem, '')), '') || E'\n\n', '')
          || 'Pendências da competência ' || to_char(p_competencia, 'MM/YYYY') || E':\n' || v_lista;

  if v_esc.lembretes_email_ativo then
    v_canais := v_canais || 'email';
  end if;

  insert into public.lembretes (empresa_id, competencia, tipo, regra, itens, mensagem, canais)
  values (p_empresa_id, p_competencia, p_tipo, p_regra, p_itens, v_corpo, v_canais)
  on conflict (empresa_id, data_referencia, regra, tipo) do nothing
  returning id into v_id;
  if v_id is null then
    return null;   -- lembrete automático desta regra já enviado hoje
  end if;

  v_n := app.notificar_clientes(
    p_empresa_id, 'documentos.enviar', 'lembrete', v_titulo, v_corpo,
    '/e/' || p_empresa_id::text || '/pendencias?competencia=' || to_char(p_competencia, 'YYYY-MM'),
    v_esc.lembretes_email_ativo
  );

  -- WhatsApp (API oficial): somente quando habilitado e configurado.
  if v_esc.lembretes_whatsapp_ativo and coalesce(v_esc.whatsapp_phone_number_id, '') <> '' then
    for r in
      select c.whatsapp from public.empresa_contatos c
       where c.empresa_id = p_empresa_id and c.recebe_lembretes and coalesce(c.whatsapp, '') <> ''
    loop
      insert into public.envios (empresa_id, canal, destinatario, assunto, conteudo, tipo, referencia_tipo, referencia_id)
      values (p_empresa_id, 'whatsapp', r.whatsapp, v_titulo, v_corpo, 'lembrete', 'lembrete', v_id::text)
      returning id into v_envio;
      perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), p_empresa_id, 'envio:' || v_envio::text, now(), 60);
      v_n := v_n + 1;
    end loop;
    update public.lembretes set canais = array_append(canais, 'whatsapp') where id = v_id;
  end if;

  update public.lembretes set destinatarios = v_n where id = v_id;
  return v_id;
end;
$$;

-- Lembretes automáticos conforme a configuração do escritório (dias relativos ao prazo).
create or replace function app.gerar_lembretes_automaticos()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esc public.escritorio;
  v_dia int;
  e record;
  v_itens uuid[];
  v_n int := 0;
  v_comp date;
begin
  select * into v_esc from public.escritorio where id = 1;
  foreach v_dia in array v_esc.lembretes_dias
  loop
    for e in
      select distinct i.empresa_id, i.competencia
        from public.checklist_itens i
        join public.empresas emp on emp.id = i.empresa_id and emp.ativa
       where i.status in ('pendente', 'correcao')
         and i.obrigatorio
         and app.hoje() - i.prazo = v_dia
    loop
      -- Inclui no lembrete todas as pendências da competência (não só as do dia)
      select array_agg(i.id) into v_itens
        from public.checklist_itens i
       where i.empresa_id = e.empresa_id and i.competencia = e.competencia
         and i.status in ('pendente', 'correcao') and i.obrigatorio;
      v_comp := e.competencia;
      if app.enviar_lembrete(e.empresa_id, v_comp, v_itens,
                             case when v_dia < 0 then 'D' || v_dia::text when v_dia = 0 then 'D0' else 'D+' || v_dia::text end,
                             'automatico') is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;

create or replace function public.enviar_lembrete_manual(p_empresa_id uuid, p_competencia date, p_mensagem text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_itens uuid[];
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'checklist.gerenciar');
  select array_agg(id) into v_itens from public.checklist_itens
   where empresa_id = p_empresa_id and competencia = app.competencia_de(p_competencia)
     and status in ('pendente', 'correcao');
  if v_itens is null then
    raise exception 'Não há pendências nesta competência.';
  end if;
  v_id := app.enviar_lembrete(p_empresa_id, app.competencia_de(p_competencia), v_itens,
                              'manual-' || to_char(now(), 'HH24MISS'), 'manual', p_mensagem);
  return v_id;
end;
$$;

-- Rotina diária (chamada pelo agendador): checklist do mês, recorrências,
-- lembretes, limpeza de envios incompletos e sugestões de conciliação.
create or replace function public.rotina_diaria()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_check int := 0;
  v_rec int := 0;
  v_lem int := 0;
  v_limpos int := 0;
  v_comp date := app.competencia_de(app.hoje());
begin
  for e in select id from public.empresas where ativa
  loop
    v_check := v_check + app.gerar_checklist(e.id, v_comp);
    -- Competência anterior também (prazos costumam cair no mês seguinte)
    v_check := v_check + app.gerar_checklist(e.id, (v_comp - interval '1 month')::date);
  end loop;
  v_rec := app.gerar_recorrencias(null, null);
  v_lem := app.gerar_lembretes_automaticos();

  -- Envios iniciados e não concluídos há mais de 24h
  with antigos as (
    select d.id, dv.storage_path
      from public.documentos d
      join public.documento_versoes dv on dv.documento_id = d.id
     where d.upload_status = 'pendente' and d.created_at < now() - interval '24 hours'
  )
  select count(distinct id) into v_limpos from antigos;
  perform app.enfileirar('remover_arquivos',
    jsonb_build_object('caminhos', coalesce((
      select jsonb_agg(dv.storage_path) from public.documentos d
        join public.documento_versoes dv on dv.documento_id = d.id
       where d.upload_status = 'pendente' and d.created_at < now() - interval '24 hours'), '[]'::jsonb)),
    null, 'limpeza:' || app.hoje()::text, now(), 200);
  delete from public.documentos where upload_status = 'pendente' and created_at < now() - interval '24 hours';
  -- Versões substitutas não concluídas
  delete from public.documento_versoes where upload_concluido_em is null and criado_em < now() - interval '24 hours' and versao > 1;

  return jsonb_build_object('itens_checklist_criados', v_check, 'lancamentos_recorrentes', v_rec,
                            'lembretes', v_lem, 'envios_incompletos_removidos', v_limpos);
end;
$$;

alter table public.lembretes enable row level security;
create policy lembretes_leitura on public.lembretes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[]));
