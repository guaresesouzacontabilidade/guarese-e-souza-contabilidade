-- =============================================================================
-- Migração 0500: competências e fluxo de fechamento mensal
-- Coleta de documentos → Conferência → Conciliação → Revisão → Publicação
-- =============================================================================

create table public.competencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  status text not null default 'aberta' check (status in ('aberta', 'em_fechamento', 'fechada')),
  fechada_em timestamptz,
  fechada_por uuid references public.perfis(id) on delete set null,
  reaberta_em timestamptz,
  reaberta_por uuid references public.perfis(id) on delete set null,
  reabertura_justificativa text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competencias_unica unique (empresa_id, competencia)
);
create index competencias_status_idx on public.competencias (competencia, status);
create trigger competencias_updated_at before update on public.competencias
  for each row execute function app.tg_updated_at();
create trigger auditoria_competencias after insert or update or delete on public.competencias
  for each row execute function app.tg_auditoria();

create table public.fechamento_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia_id uuid not null references public.competencias(id) on delete cascade,
  etapa text not null check (etapa in ('coleta', 'conferencia', 'conciliacao', 'revisao', 'publicacao')),
  ordem int not null,
  status text not null default 'nao_iniciada' check (status in ('nao_iniciada', 'em_andamento', 'concluida')),
  responsavel_id uuid references public.perfis(id) on delete set null,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  concluida_por uuid references public.perfis(id) on delete set null,
  observacao text,
  updated_at timestamptz not null default now(),
  constraint fechamento_etapas_unica unique (competencia_id, etapa)
);
create index fechamento_etapas_empresa_idx on public.fechamento_etapas (empresa_id);
create trigger fechamento_etapas_updated_at before update on public.fechamento_etapas
  for each row execute function app.tg_updated_at();

create table public.fechamento_pendencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia_id uuid not null references public.competencias(id) on delete cascade,
  etapa text check (etapa in ('coleta', 'conferencia', 'conciliacao', 'revisao', 'publicacao')),
  descricao text not null,
  impeditiva boolean not null default true,
  visivel_cliente boolean not null default false,
  status text not null default 'aberta' check (status in ('aberta', 'resolvida', 'dispensada')),
  criada_por uuid references public.perfis(id) on delete set null default auth.uid(),
  criada_em timestamptz not null default now(),
  resolvida_por uuid references public.perfis(id) on delete set null,
  resolvida_em timestamptz,
  resolucao text
);
create index fechamento_pendencias_comp_idx on public.fechamento_pendencias (competencia_id, status);

create table public.competencia_historico (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia_id uuid not null references public.competencias(id) on delete cascade,
  acao text not null,
  etapa text,
  detalhes jsonb,
  por uuid references public.perfis(id) on delete set null default auth.uid(),
  em timestamptz not null default now()
);
create index competencia_historico_comp_idx on public.competencia_historico (competencia_id, em);

-- -----------------------------------------------------------------------------
-- Funções
-- -----------------------------------------------------------------------------
create or replace function app.competencia_fechada(p_empresa_id uuid, p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.competencias c
     where c.empresa_id = p_empresa_id
       and c.competencia = date_trunc('month', p_data)::date
       and c.status = 'fechada'
  );
$$;

create or replace function app.exigir_competencia_aberta(p_empresa_id uuid, p_data date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_data is not null and app.competencia_fechada(p_empresa_id, p_data) then
    raise exception 'A competência %/% está fechada. Para alterar, é preciso reabri-la com justificativa.',
      lpad(extract(month from p_data)::text, 2, '0'), extract(year from p_data)
      using errcode = 'P0001', hint = 'competencia_fechada';
  end if;
end;
$$;

-- Obtém (ou cria) a competência com suas etapas.
create or replace function app.obter_competencia(p_empresa_id uuid, p_competencia date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := app.competencia_de(p_competencia);
  v_id uuid;
begin
  insert into public.competencias (empresa_id, competencia)
  values (p_empresa_id, v_comp)
  on conflict (empresa_id, competencia) do nothing;
  select id into v_id from public.competencias where empresa_id = p_empresa_id and competencia = v_comp;

  insert into public.fechamento_etapas (empresa_id, competencia_id, etapa, ordem)
  select p_empresa_id, v_id, e.etapa, e.ordem
    from (values ('coleta', 1), ('conferencia', 2), ('conciliacao', 3), ('revisao', 4), ('publicacao', 5)) as e(etapa, ordem)
  on conflict (competencia_id, etapa) do nothing;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs do fechamento
-- -----------------------------------------------------------------------------
create or replace function public.iniciar_fechamento(p_empresa_id uuid, p_competencia date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_comp public.competencias;
begin
  perform app.exigir(p_empresa_id, 'fechamento.gerenciar');
  v_id := app.obter_competencia(p_empresa_id, p_competencia);
  select * into v_comp from public.competencias where id = v_id for update;
  if v_comp.status = 'aberta' then
    update public.competencias set status = 'em_fechamento' where id = v_id;
    update public.fechamento_etapas
       set status = 'em_andamento', iniciada_em = now(), responsavel_id = coalesce(responsavel_id, auth.uid())
     where competencia_id = v_id and etapa = 'coleta' and status = 'nao_iniciada';
    insert into public.competencia_historico (empresa_id, competencia_id, acao)
    values (p_empresa_id, v_id, 'fechamento_iniciado');
  end if;
  return v_id;
end;
$$;

create or replace function public.atualizar_etapa_fechamento(
  p_etapa_id uuid,
  p_status text,
  p_responsavel_id uuid default null,
  p_observacao text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.fechamento_etapas;
  v_comp public.competencias;
  v_pend int;
begin
  select * into v_etapa from public.fechamento_etapas where id = p_etapa_id for update;
  if not found then
    raise exception 'Etapa não encontrada.';
  end if;
  perform app.exigir(v_etapa.empresa_id, 'fechamento.gerenciar');
  select * into v_comp from public.competencias where id = v_etapa.competencia_id;
  if v_comp.status = 'fechada' and v_etapa.etapa <> 'publicacao' then
    raise exception 'A competência está fechada. Reabra-a para alterar as etapas.';
  end if;
  if p_status not in ('nao_iniciada', 'em_andamento', 'concluida') then
    raise exception 'Status de etapa inválido.';
  end if;
  if p_status = 'concluida' then
    select count(*) into v_pend from public.fechamento_pendencias
     where competencia_id = v_etapa.competencia_id and etapa = v_etapa.etapa and status = 'aberta' and impeditiva;
    if v_pend > 0 then
      raise exception 'Há % pendência(s) impeditiva(s) aberta(s) nesta etapa.', v_pend;
    end if;
  end if;

  update public.fechamento_etapas
     set status = p_status,
         responsavel_id = coalesce(p_responsavel_id, responsavel_id),
         observacao = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), observacao),
         iniciada_em = case when p_status <> 'nao_iniciada' then coalesce(iniciada_em, now()) else null end,
         concluida_em = case when p_status = 'concluida' then now() else null end,
         concluida_por = case when p_status = 'concluida' then auth.uid() else null end
   where id = v_etapa.id;

  if v_comp.status = 'aberta' and p_status <> 'nao_iniciada' then
    update public.competencias set status = 'em_fechamento' where id = v_comp.id;
  end if;

  insert into public.competencia_historico (empresa_id, competencia_id, acao, etapa, detalhes)
  values (v_etapa.empresa_id, v_etapa.competencia_id, 'etapa_' || p_status, v_etapa.etapa,
          jsonb_build_object('anterior', v_etapa.status, 'observacao', p_observacao, 'responsavel', p_responsavel_id));
end;
$$;

create or replace function public.registrar_pendencia_fechamento(
  p_competencia_id uuid,
  p_etapa text,
  p_descricao text,
  p_impeditiva boolean default true,
  p_visivel_cliente boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp public.competencias;
  v_id uuid;
begin
  select * into v_comp from public.competencias where id = p_competencia_id;
  if not found then
    raise exception 'Competência não encontrada.';
  end if;
  perform app.exigir(v_comp.empresa_id, 'fechamento.gerenciar');
  if coalesce(trim(p_descricao), '') = '' then
    raise exception 'Descreva a pendência.';
  end if;
  insert into public.fechamento_pendencias (empresa_id, competencia_id, etapa, descricao, impeditiva, visivel_cliente)
  values (v_comp.empresa_id, v_comp.id, p_etapa, trim(p_descricao), coalesce(p_impeditiva, true), coalesce(p_visivel_cliente, false))
  returning id into v_id;
  insert into public.competencia_historico (empresa_id, competencia_id, acao, etapa, detalhes)
  values (v_comp.empresa_id, v_comp.id, 'pendencia_registrada', p_etapa, jsonb_build_object('descricao', trim(p_descricao), 'impeditiva', p_impeditiva));
  if coalesce(p_visivel_cliente, false) then
    perform app.notificar_clientes(
      v_comp.empresa_id, 'documentos.ver', 'pendencia_fechamento',
      'Pendência para o fechamento de ' || to_char(v_comp.competencia, 'MM/YYYY'),
      trim(p_descricao),
      '/e/' || v_comp.empresa_id::text || '/pendencias?competencia=' || to_char(v_comp.competencia, 'YYYY-MM'),
      true
    );
  end if;
  return v_id;
end;
$$;

create or replace function public.resolver_pendencia_fechamento(p_pendencia_id uuid, p_status text, p_resolucao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pend public.fechamento_pendencias;
begin
  select * into v_pend from public.fechamento_pendencias where id = p_pendencia_id for update;
  if not found then
    raise exception 'Pendência não encontrada.';
  end if;
  perform app.exigir(v_pend.empresa_id, 'fechamento.gerenciar');
  if p_status not in ('resolvida', 'dispensada', 'aberta') then
    raise exception 'Status inválido.';
  end if;
  if p_status = 'dispensada' and coalesce(trim(p_resolucao), '') = '' then
    raise exception 'Justifique a dispensa da pendência.';
  end if;
  update public.fechamento_pendencias
     set status = p_status,
         resolucao = nullif(trim(coalesce(p_resolucao, '')), ''),
         resolvida_por = case when p_status = 'aberta' then null else auth.uid() end,
         resolvida_em = case when p_status = 'aberta' then null else now() end
   where id = v_pend.id;
  insert into public.competencia_historico (empresa_id, competencia_id, acao, etapa, detalhes)
  values (v_pend.empresa_id, v_pend.competencia_id, 'pendencia_' || p_status, v_pend.etapa,
          jsonb_build_object('descricao', v_pend.descricao, 'resolucao', p_resolucao));
end;
$$;

create or replace function public.fechar_competencia(p_empresa_id uuid, p_competencia date, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_comp public.competencias;
  v_faltando text;
  v_pend int;
begin
  perform app.exigir(p_empresa_id, 'fechamento.gerenciar');
  v_id := app.obter_competencia(p_empresa_id, p_competencia);
  select * into v_comp from public.competencias where id = v_id for update;
  if v_comp.status = 'fechada' then
    raise exception 'A competência já está fechada.';
  end if;

  select string_agg(
           case etapa when 'coleta' then 'Coleta de documentos' when 'conferencia' then 'Conferência'
                      when 'conciliacao' then 'Conciliação' when 'revisao' then 'Revisão' else etapa end,
           ', ' order by ordem)
    into v_faltando
    from public.fechamento_etapas
   where competencia_id = v_id and etapa <> 'publicacao' and status <> 'concluida';
  if v_faltando is not null then
    raise exception 'Conclua as etapas antes de fechar: %.', v_faltando;
  end if;

  select count(*) into v_pend from public.fechamento_pendencias
   where competencia_id = v_id and status = 'aberta' and impeditiva;
  if v_pend > 0 then
    raise exception 'Há % pendência(s) impeditiva(s) aberta(s).', v_pend;
  end if;

  update public.competencias
     set status = 'fechada', fechada_em = now(), fechada_por = auth.uid(),
         observacoes = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), observacoes)
   where id = v_id;
  update public.fechamento_etapas
     set status = 'em_andamento', iniciada_em = coalesce(iniciada_em, now())
   where competencia_id = v_id and etapa = 'publicacao' and status = 'nao_iniciada';
  insert into public.competencia_historico (empresa_id, competencia_id, acao, detalhes)
  values (p_empresa_id, v_id, 'fechada', jsonb_build_object('observacao', p_observacao));
end;
$$;

create or replace function public.reabrir_competencia(p_empresa_id uuid, p_competencia date, p_justificativa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp public.competencias;
begin
  perform app.exigir(p_empresa_id, 'fechamento.reabrir');
  if coalesce(length(trim(p_justificativa)), 0) < 10 then
    raise exception 'Informe uma justificativa detalhada (mínimo de 10 caracteres) para reabrir a competência.';
  end if;
  select * into v_comp from public.competencias
   where empresa_id = p_empresa_id and competencia = app.competencia_de(p_competencia) for update;
  if not found or v_comp.status <> 'fechada' then
    raise exception 'A competência não está fechada.';
  end if;
  update public.competencias
     set status = 'em_fechamento', reaberta_em = now(), reaberta_por = auth.uid(),
         reabertura_justificativa = trim(p_justificativa)
   where id = v_comp.id;
  update public.fechamento_etapas
     set status = 'em_andamento', concluida_em = null, concluida_por = null
   where competencia_id = v_comp.id and etapa in ('revisao', 'publicacao');
  insert into public.competencia_historico (empresa_id, competencia_id, acao, detalhes)
  values (p_empresa_id, v_comp.id, 'reaberta', jsonb_build_object('justificativa', trim(p_justificativa)));
  perform app.notificar_equipe(
    p_empresa_id, 'competencia_reaberta',
    'Competência ' || to_char(v_comp.competencia, 'MM/YYYY') || ' reaberta',
    trim(p_justificativa),
    '/e/' || p_empresa_id::text || '/fechamento?competencia=' || to_char(v_comp.competencia, 'YYYY-MM'),
    false
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.competencias enable row level security;
alter table public.fechamento_etapas enable row level security;
alter table public.fechamento_pendencias enable row level security;
alter table public.competencia_historico enable row level security;

create policy competencias_leitura on public.competencias for select to authenticated
  using (empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]));
create policy fechamento_etapas_leitura on public.fechamento_etapas for select to authenticated
  using (empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]));
create policy fechamento_pendencias_leitura on public.fechamento_pendencias for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('fechamento.gerenciar'))::uuid[])
    or (visivel_cliente and empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]))
  );
create policy competencia_historico_leitura on public.competencia_historico for select to authenticated
  using (empresa_id = any ((select app.empresas_com('fechamento.gerenciar'))::uuid[]));
