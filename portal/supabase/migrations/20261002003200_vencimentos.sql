-- =============================================================================
-- Vencimentos: certificados digitais, alvarás, licenças e certidões
--
--  * Cadastro por empresa com a validade e o arquivo (opcional) no portal.
--  * A rotina diária avisa o escritório e o cliente 30, 15 e 5 dias antes e
--    no vencimento (um aviso por marco; a renovação recomeça o ciclo).
--  * O cliente vê os vencimentos da própria empresa; quem envia documentos
--    também pode cadastrar e renovar; excluir é só do escritório.
-- =============================================================================

insert into public.categorias_documento (codigo, nome, descricao, grupo, extensoes, escritorio, ordem) values
  ('licencas_certidoes', 'Alvarás, licenças, certidões e certificados',
   'Alvarás de funcionamento, licenças (sanitária, bombeiros, ambiental), certidões negativas e comprovantes de certificados digitais.',
   'outros', array['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'], false, 145),
  ('esc_certidao', 'Certidões e licenças', 'Certidões negativas, alvarás e licenças obtidos pelo escritório.',
   'escritorio', array['pdf', 'jpg', 'jpeg', 'png', 'zip'], true, 245)
on conflict (codigo) do nothing;

create or replace function app.tipos_vencimento()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['certificado_digital', 'alvara_funcionamento', 'licenca_sanitaria', 'licenca_bombeiros', 'licenca_ambiental',
               'cnd_federal', 'cnd_estadual', 'cnd_municipal', 'crf_fgts', 'cndt', 'procuracao', 'contrato', 'outro']::text[];
$$;

create table public.vencimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo = any (app.tipos_vencimento())),
  descricao text not null check (length(trim(descricao)) between 3 and 120),
  numero text check (numero is null or length(numero) <= 80),
  orgao text check (orgao is null or length(orgao) <= 120),
  emissao date,
  validade date not null,
  responsavel text not null default 'escritorio' check (responsavel in ('escritorio', 'cliente')),
  documento_id uuid,
  situacao text not null default 'ativo' check (situacao in ('ativo', 'arquivado')),
  observacao text check (observacao is null or length(observacao) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vencimentos_datas check (emissao is null or emissao <= validade),
  constraint vencimentos_documento_fk foreign key (empresa_id, documento_id)
    references public.documentos (empresa_id, id) on delete set null (documento_id)
);
create index vencimentos_empresa_idx on public.vencimentos (empresa_id, validade) where situacao = 'ativo';
create index vencimentos_validade_idx on public.vencimentos (validade) where situacao = 'ativo';
create trigger vencimentos_updated_at before update on public.vencimentos
  for each row execute function app.tg_updated_at();
create trigger auditoria_vencimentos after insert or update or delete on public.vencimentos
  for each row execute function app.tg_auditoria();

-- Avisos já enviados (um por marco e por validade: renovar recomeça o ciclo)
create table public.vencimento_avisos (
  vencimento_id uuid not null references public.vencimentos(id) on delete cascade,
  validade date not null,
  marco int not null check (marco in (30, 15, 5, 0)),
  enviado_em timestamptz not null default now(),
  primary key (vencimento_id, validade, marco)
);

alter table public.vencimentos enable row level security;
alter table public.vencimento_avisos enable row level security;

create policy vencimentos_leitura on public.vencimentos for select to authenticated
  using ((select app.pode(empresa_id, 'documentos.ver')));
create policy vencimentos_insercao on public.vencimentos for insert to authenticated
  with check ((select app.pode(empresa_id, 'documentos.enviar')));
create policy vencimentos_alteracao on public.vencimentos for update to authenticated
  using ((select app.pode(empresa_id, 'documentos.enviar')))
  with check ((select app.pode(empresa_id, 'documentos.enviar')));
create policy vencimentos_exclusao on public.vencimentos for delete to authenticated
  using ((select app.pode(empresa_id, 'empresa.editar')) and (select app.is_equipe()));
create policy vencimento_avisos_leitura on public.vencimento_avisos for select to authenticated
  using (exists (select 1 from public.vencimentos v where v.id = vencimento_id and (select app.pode(v.empresa_id, 'documentos.ver'))));

grant select, insert, update, delete on public.vencimentos to authenticated;
grant select on public.vencimento_avisos to authenticated;

-- Avisos de vencimento também podem ir por WhatsApp (clientes que autorizaram)
create or replace function app.tipos_aviso_whatsapp()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['documento_escritorio', 'relatorio_publicado', 'mensagem', 'item_solicitado', 'item_correcao',
               'documento_correcao', 'pendencia_fechamento', 'vencimento']::text[];
$$;

-- Marco do aviso pelos dias que faltam (nulo: ainda longe do vencimento)
create or replace function app.marco_vencimento(p_dias int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_dias <= 0 then 0 when p_dias <= 5 then 5 when p_dias <= 15 then 15 when p_dias <= 30 then 30 end;
$$;

-- Rotina diária: um aviso por marco (30, 15, 5 dias e vencido)
create or replace function public.rotina_vencimentos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_dias int;
  v_marco int;
  v_titulo text;
  v_corpo text;
  v_link text;
  n int := 0;
begin
  for v in
    select x.* from public.vencimentos x
      join public.empresas e on e.id = x.empresa_id and e.ativa
     where x.situacao = 'ativo' and x.validade <= app.hoje() + 30
     order by x.validade
  loop
    v_dias := v.validade - app.hoje();
    v_marco := app.marco_vencimento(v_dias);
    -- Já avisado neste marco (ou num mais próximo do vencimento) para esta validade
    if exists (select 1 from public.vencimento_avisos a
                where a.vencimento_id = v.id and a.validade = v.validade and a.marco <= v_marco) then
      continue;
    end if;
    -- Vencidos há mais de 30 dias quando cadastrados: não geram aviso atrasado
    if v_dias < -30 then
      insert into public.vencimento_avisos (vencimento_id, validade, marco) values (v.id, v.validade, 0) on conflict do nothing;
      continue;
    end if;
    insert into public.vencimento_avisos (vencimento_id, validade, marco) values (v.id, v.validade, v_marco);
    v_titulo := case
      when v_dias < 0 then v.descricao || ' venceu em ' || to_char(v.validade, 'DD/MM/YYYY')
      when v_dias = 0 then v.descricao || ' vence hoje'
      when v_dias = 1 then v.descricao || ' vence amanhã'
      else v.descricao || ' vence em ' || v_dias || ' dias (' || to_char(v.validade, 'DD/MM/YYYY') || ')'
    end;
    v_corpo := case v.responsavel
      when 'cliente' then 'A renovação é feita pela empresa. Depois de renovar, envie o novo documento pelo portal.'
      else 'O escritório vai cuidar da renovação e avisa se precisar de algo.'
    end;
    v_link := '/e/' || v.empresa_id::text || '/vencimentos';
    perform app.notificar_equipe(v.empresa_id, 'vencimento', v_titulo, v_corpo, v_link, false);
    perform app.notificar_clientes(v.empresa_id, 'documentos.ver', 'vencimento', v_titulo, v_corpo, v_link, true);
    n := n + 1;
  end loop;
  return jsonb_build_object('avisos_vencimento', n);
end;
$$;

revoke execute on function public.rotina_vencimentos() from public, anon, authenticated;
grant execute on function public.rotina_vencimentos() to service_role;
revoke execute on function app.tipos_vencimento(), app.marco_vencimento(int) from public, anon;
grant execute on function app.tipos_vencimento(), app.marco_vencimento(int) to authenticated, service_role;
