-- =============================================================================
-- Camada operacional interna (somente equipe do escritório)
--
-- Empresas e regimes com vigência, estado e município (IBGE), feriados,
-- catálogo de obrigações com regras versionadas (aplicabilidade, periodicidade,
-- regra de vencimento, tratamento de feriados e fonte oficial), validação antes
-- de aplicar, cálculo de prazos (entrega, pagamento e interno), tarefas por
-- competência sem duplicidade (apuração, entrega e pagamento) com responsável,
-- revisor e comprovantes vindos dos documentos do portal, alertas e auditoria.
--
-- Princípio: nenhum prazo é presumido. Sem regra validada, com fonte, não há
-- data — a obrigação aparece como "sem regra validada".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Regimes: inclui Lucro Arbitrado e passa a ter histórico com vigência
-- -----------------------------------------------------------------------------
alter table public.empresas drop constraint if exists empresas_regime_tributario_check;
alter table public.empresas add constraint empresas_regime_tributario_check check (regime_tributario in (
  'mei', 'simples_nacional', 'lucro_presumido', 'lucro_real', 'lucro_arbitrado',
  'imune_isenta', 'produtor_rural', 'pessoa_fisica', 'outro'
));

create or replace function app.regimes_validos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['mei', 'simples_nacional', 'lucro_presumido', 'lucro_real', 'lucro_arbitrado',
               'imune_isenta', 'produtor_rural', 'pessoa_fisica', 'outro'];
$$;

-- Dados operacionais da empresa (município pelo código do IBGE)
alter table public.empresas
  add column municipio_ibge text references public.municipios(ibge),
  add column contribuinte_icms boolean not null default false,
  add column contribuinte_iss boolean not null default false,
  add column tem_empregados boolean not null default false;

update public.empresas
   set contribuinte_icms = coalesce(nullif(trim(inscricao_estadual), ''), '') <> '',
       contribuinte_iss = coalesce(nullif(trim(inscricao_municipal), ''), '') <> '',
       tem_empregados = 'folha' = any(servicos);

-- Município do IBGE a partir da cidade/UF já cadastradas (mesmo nome, sem acentos)
update public.empresas e
   set municipio_ibge = m.ibge
  from public.municipios m
 where e.municipio_ibge is null and m.uf = upper(e.uf) and app.normalizar(m.nome) = app.normalizar(trim(e.cidade));

-- Cidade/UF acompanham o município do IBGE; regime e dados fiscais só pelo escritório
create or replace function app.tg_empresa_campos_operacionais()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.municipio_ibge is not distinct from old.municipio_ibge
     and (new.cidade is distinct from old.cidade or new.uf is distinct from old.uf) then
    new.municipio_ibge := null;
  end if;
  if new.municipio_ibge is null and coalesce(trim(new.cidade), '') <> '' and new.uf is not null then
    select m.ibge into new.municipio_ibge from public.municipios m
     where m.uf = upper(new.uf) and app.normalizar(m.nome) = app.normalizar(trim(new.cidade)) limit 1;
  end if;
  if new.municipio_ibge is not null then
    select m.nome, m.uf into new.cidade, new.uf from public.municipios m where m.ibge = new.municipio_ibge;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and not app.is_equipe() and (
       new.regime_tributario is distinct from old.regime_tributario
    or new.municipio_ibge is distinct from old.municipio_ibge
    or new.contribuinte_icms is distinct from old.contribuinte_icms
    or new.contribuinte_iss is distinct from old.contribuinte_iss
    or new.tem_empregados is distinct from old.tem_empregados
    or new.servicos is distinct from old.servicos) then
    raise exception 'Somente o escritório altera o regime, o município e os dados fiscais da empresa.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger empresas_campos_operacionais before insert or update on public.empresas
  for each row execute function app.tg_empresa_campos_operacionais();

create table public.empresa_regimes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  regime text not null check (regime = any (app.regimes_validos())),
  inicio date not null check (extract(day from inicio) = 1),
  fim date check (fim is null or (extract(day from fim) = 1 and fim >= inicio)), -- última competência (inclusive)
  observacao text,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index empresa_regimes_empresa_idx on public.empresa_regimes (empresa_id, inicio desc);
create trigger empresa_regimes_updated_at before update on public.empresa_regimes
  for each row execute function app.tg_updated_at();

-- Regime vigente numa competência (histórico; sem histórico, o regime do cadastro)
create or replace function app.regime_em(p_empresa_id uuid, p_competencia date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.regime from public.empresa_regimes r
      where r.empresa_id = p_empresa_id and r.inicio <= p_competencia and (r.fim is null or r.fim >= p_competencia)
      order by r.inicio desc limit 1),
    (select e.regime_tributario from public.empresas e where e.id = p_empresa_id));
$$;

-- Períodos de regime não podem se sobrepor
create or replace function app.tg_regime_sem_sobreposicao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.empresa_regimes r
     where r.empresa_id = new.empresa_id and r.id <> new.id
       and r.inicio <= coalesce(new.fim, 'infinity'::date)
       and coalesce(r.fim, 'infinity'::date) >= new.inicio
  ) then
    raise exception 'Já existe um regime cadastrado para parte deste período. Ajuste o fim do regime anterior antes.';
  end if;
  return new;
end;
$$;
create trigger empresa_regimes_sem_sobreposicao before insert or update on public.empresa_regimes
  for each row execute function app.tg_regime_sem_sobreposicao();

-- O cadastro da empresa mostra sempre o regime da competência atual
create or replace function app.tg_regime_sincroniza_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := coalesce(new.empresa_id, old.empresa_id);
  v_regime text;
begin
  select r.regime into v_regime from public.empresa_regimes r
   where r.empresa_id = v_empresa and r.inicio <= app.competencia_de(app.hoje())
     and (r.fim is null or r.fim >= app.competencia_de(app.hoje()))
   order by r.inicio desc limit 1;
  if v_regime is not null then
    perform set_config('app.sincronizando_regime', 'on', true);
    update public.empresas set regime_tributario = v_regime where id = v_empresa and regime_tributario is distinct from v_regime;
    perform set_config('app.sincronizando_regime', 'off', true);
  end if;
  return null;
end;
$$;
create trigger empresa_regimes_sincroniza after insert or update or delete on public.empresa_regimes
  for each row execute function app.tg_regime_sincroniza_empresa();

-- Mudança de regime pelo cadastro da empresa gera o histórico automaticamente
create or replace function app.tg_empresa_regime_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := app.competencia_de(app.hoje());
  v_atual public.empresa_regimes;
begin
  if coalesce(current_setting('app.sincronizando_regime', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.empresa_regimes (empresa_id, regime, inicio, observacao)
    values (new.id, new.regime_tributario, app.competencia_de(coalesce(new.data_inicio_atendimento, app.hoje())), 'Regime informado no cadastro da empresa.');
    return new;
  end if;
  if new.regime_tributario is not distinct from old.regime_tributario then
    return new;
  end if;
  select * into v_atual from public.empresa_regimes r
   where r.empresa_id = new.id and r.inicio <= v_comp and (r.fim is null or r.fim >= v_comp)
   order by r.inicio desc limit 1;
  perform set_config('app.sincronizando_regime', 'on', true);
  if v_atual.id is not null and v_atual.inicio = v_comp then
    update public.empresa_regimes set regime = new.regime_tributario where id = v_atual.id;
  else
    if v_atual.id is not null then
      update public.empresa_regimes set fim = (v_comp - interval '1 month')::date where id = v_atual.id;
    end if;
    insert into public.empresa_regimes (empresa_id, regime, inicio, observacao)
    values (new.id, new.regime_tributario, v_comp, 'Alteração feita no cadastro da empresa.');
  end if;
  perform set_config('app.sincronizando_regime', 'off', true);
  return new;
end;
$$;
create trigger empresas_regime_historico after insert or update of regime_tributario on public.empresas
  for each row execute function app.tg_empresa_regime_historico();

-- Histórico inicial das empresas já cadastradas
insert into public.empresa_regimes (empresa_id, regime, inicio, observacao)
select e.id, e.regime_tributario, app.competencia_de(coalesce(e.data_inicio_atendimento, e.created_at::date)), 'Regime informado no cadastro da empresa.'
  from public.empresas e
 where not exists (select 1 from public.empresa_regimes r where r.empresa_id = e.id);

-- -----------------------------------------------------------------------------
-- Quem da equipe atende a empresa (administrador vê todas)
-- -----------------------------------------------------------------------------
create or replace function app.equipe_ve_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin() or (
    app.is_equipe() and exists (
      select 1 from public.empresa_membros m
       where m.empresa_id = p_empresa_id and m.user_id = auth.uid() and m.ativo and m.papel = 'equipe'));
$$;

-- -----------------------------------------------------------------------------
-- Feriados (nacionais, estaduais e municipais) e dias úteis
-- -----------------------------------------------------------------------------
create table public.feriados (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  nome text not null check (length(trim(nome)) > 1),
  abrangencia text not null check (abrangencia in ('nacional', 'estadual', 'municipal')),
  uf char(2),
  municipio_ibge text references public.municipios(ibge),
  tipo text not null default 'feriado' check (tipo in ('feriado', 'ponto_facultativo', 'sem_expediente_bancario')),
  fonte text not null check (length(trim(fonte)) > 3),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint feriados_abrangencia_coerente check (
    (abrangencia = 'nacional' and uf is null and municipio_ibge is null)
    or (abrangencia = 'estadual' and uf is not null and municipio_ibge is null)
    or (abrangencia = 'municipal' and municipio_ibge is not null))
);
create unique index feriados_unico on public.feriados (data, abrangencia, coalesce(uf, ''), coalesce(municipio_ibge, ''), tipo);
create index feriados_data_idx on public.feriados (data);

-- Dia útil para a empresa: sem fim de semana nem feriado nacional, do estado ou
-- do município. No calendário "expediente bancário", dias sem expediente
-- bancário (ex.: Carnaval) também não contam.
create or replace function app.e_dia_util(p_data date, p_uf text, p_municipio text, p_bancario boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(isodow from p_data) < 6 and not exists (
    select 1 from public.feriados f
     where f.data = p_data
       and (f.tipo = 'feriado' or (p_bancario and f.tipo = 'sem_expediente_bancario'))
       and (f.abrangencia = 'nacional'
            or (f.abrangencia = 'estadual' and f.uf = p_uf)
            or (f.abrangencia = 'municipal' and f.municipio_ibge = p_municipio)));
$$;

create or replace function app.ajustar_dia_util(p_data date, p_ajuste text, p_uf text, p_municipio text, p_bancario boolean)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v date := p_data;
  i int := 0;
begin
  if p_ajuste = 'manter' or app.e_dia_util(v, p_uf, p_municipio, p_bancario) then
    return v;
  end if;
  loop
    v := v + case when p_ajuste = 'antecipar' then -1 else 1 end;
    i := i + 1;
    exit when app.e_dia_util(v, p_uf, p_municipio, p_bancario) or i > 30;
  end loop;
  return v;
end;
$$;

-- n dias úteis antes de uma data (n = 0 devolve a própria data, se útil, ou o útil anterior)
create or replace function app.dias_uteis_antes(p_data date, p_n int, p_uf text, p_municipio text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v date := app.ajustar_dia_util(p_data, 'antecipar', p_uf, p_municipio, false);
  k int := 0;
begin
  while k < coalesce(p_n, 0) loop
    v := v - 1;
    if app.e_dia_util(v, p_uf, p_municipio, false) then
      k := k + 1;
    end if;
  end loop;
  return v;
end;
$$;

-- Estrutura de uma regra de prazo:
--   {"tipo": "dia_fixo" | "dia_util" | "ultimo_dia_util",
--    "dia": 1..31 (dia do mês ou n-ésimo dia útil), "meses_apos": 0..24 (a partir do mês da competência),
--    "ajuste": "antecipar" | "postergar" | "manter" (quando o dia fixo não for útil),
--    "calendario": "dia_util" | "expediente_bancario"}
create or replace function app.prazo_valido(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then true
    when jsonb_typeof(p) <> 'object' then false
    else coalesce(
      p ->> 'tipo' in ('dia_fixo', 'dia_util', 'ultimo_dia_util')
      and coalesce(p ->> 'meses_apos', '') ~ '^[0-9]{1,2}$' and (p ->> 'meses_apos')::int <= 24
      and (p ->> 'tipo' = 'ultimo_dia_util'
           or (coalesce(p ->> 'dia', '') ~ '^[0-9]{1,2}$' and (p ->> 'dia')::int between 1 and (case when p ->> 'tipo' = 'dia_util' then 23 else 31 end)))
      and (p ->> 'tipo' <> 'dia_fixo' or p ->> 'ajuste' in ('antecipar', 'postergar', 'manter'))
      and coalesce(p ->> 'calendario', 'dia_util') in ('dia_util', 'expediente_bancario'),
      false)
  end;
$$;

create or replace function app.calcular_prazo(p_regra jsonb, p_competencia date, p_uf text, p_municipio text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mes date;
  v_fim date;
  v_bancario boolean;
  v_dia date;
  v_n int;
  k int := 0;
begin
  if p_regra is null or jsonb_typeof(p_regra) <> 'object' then
    return null;
  end if;
  v_mes := (date_trunc('month', p_competencia) + make_interval(months => (p_regra ->> 'meses_apos')::int))::date;
  v_fim := (v_mes + interval '1 month - 1 day')::date;
  v_bancario := coalesce(p_regra ->> 'calendario', 'dia_util') = 'expediente_bancario';
  if p_regra ->> 'tipo' = 'dia_fixo' then
    v_dia := least(v_mes + ((p_regra ->> 'dia')::int - 1), v_fim);
    return app.ajustar_dia_util(v_dia, p_regra ->> 'ajuste', p_uf, p_municipio, v_bancario);
  elsif p_regra ->> 'tipo' = 'dia_util' then
    v_n := (p_regra ->> 'dia')::int;
    v_dia := v_mes;
    while v_dia <= v_fim loop
      if app.e_dia_util(v_dia, p_uf, p_municipio, v_bancario) then
        k := k + 1;
        if k = v_n then
          return v_dia;
        end if;
      end if;
      v_dia := v_dia + 1;
    end loop;
    return null;
  else
    v_dia := v_fim;
    while v_dia >= v_mes loop
      if app.e_dia_util(v_dia, p_uf, p_municipio, v_bancario) then
        return v_dia;
      end if;
      v_dia := v_dia - 1;
    end loop;
    return null;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Catálogo de obrigações e regras versionadas
-- -----------------------------------------------------------------------------
create table public.obrigacoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[A-Z0-9_]{2,40}$'),
  nome text not null,
  descricao text,
  esfera text not null check (esfera in ('federal', 'estadual', 'municipal')),
  area text not null check (area in ('fiscal', 'contabil', 'pessoal', 'societario')),
  tributos text[] not null default array[]::text[]
    check (tributos <@ array['SIMPLES', 'IRPJ', 'CSLL', 'PIS', 'COFINS', 'IPI', 'ICMS', 'ISS', 'INSS', 'FGTS', 'IRRF', 'CBS', 'IBS', 'IS']::text[]),
  etapas text[] not null check (etapas <@ array['apuracao', 'entrega', 'pagamento']::text[] and cardinality(etapas) > 0),
  periodicidade text not null check (periodicidade in ('mensal', 'trimestral', 'anual')),
  categorias_documento text[] not null default array[]::text[], -- documentos do portal ligados à obrigação
  ativa boolean not null default true,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger obrigacoes_updated_at before update on public.obrigacoes
  for each row execute function app.tg_updated_at();

create table public.obrigacao_regras (
  id uuid primary key default gen_random_uuid(),
  obrigacao_id uuid not null references public.obrigacoes(id) on delete cascade,
  vigencia_inicio date not null check (extract(day from vigencia_inicio) = 1),
  vigencia_fim date check (vigencia_fim is null or (extract(day from vigencia_fim) = 1 and vigencia_fim >= vigencia_inicio)),
  -- Aplicabilidade
  regimes text[] not null check (regimes <@ app.regimes_validos() and cardinality(regimes) > 0),
  ufs text[],             -- vazio = todas
  municipios text[],      -- códigos IBGE; vazio = todos
  empresa_id uuid references public.empresas(id) on delete cascade, -- regra própria de uma empresa
  exige_empregados boolean not null default false,
  exige_icms boolean not null default false,
  exige_iss boolean not null default false,
  servico text check (servico in ('contabil', 'fiscal', 'folha', 'financeiro', 'societario', 'imposto_renda')),
  -- Prazos (legais) e prazo interno
  prazo_entrega jsonb check (app.prazo_valido(prazo_entrega)),
  prazo_pagamento jsonb check (app.prazo_valido(prazo_pagamento)),
  prazo_apuracao jsonb check (app.prazo_valido(prazo_apuracao)), -- meta interna da apuração (opcional)
  prazo_interno_dias_uteis int not null default 2 check (prazo_interno_dias_uteis between 0 and 30),
  -- Fonte oficial
  fonte_titulo text not null check (length(trim(fonte_titulo)) > 3),
  fonte_url text,
  fonte_consultada_em date not null,
  observacao text,
  status text not null default 'rascunho' check (status in ('rascunho', 'validada', 'revogada')),
  validada_por uuid references public.perfis(id) on delete set null,
  validada_em timestamptz,
  criada_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index obrigacao_regras_obrigacao_idx on public.obrigacao_regras (obrigacao_id, status, vigencia_inicio);
create trigger obrigacao_regras_updated_at before update on public.obrigacao_regras
  for each row execute function app.tg_updated_at();

-- Regra validada não é editada: muda só por atualização normativa (nova versão)
create or replace function app.tg_regra_validada_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'validada' and coalesce(current_setting('app.aplicando_norma', true), 'off') <> 'on' then
    raise exception 'Regra validada não pode ser alterada. Registre uma atualização normativa com a fonte.';
  end if;
  return new;
end;
$$;
create trigger obrigacao_regras_imutavel before update on public.obrigacao_regras
  for each row execute function app.tg_regra_validada_imutavel();

-- Calendário por empresa e por vigência (inclusões, exclusões e responsáveis)
create table public.empresa_obrigacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obrigacao_id uuid not null references public.obrigacoes(id) on delete cascade,
  modo text not null default 'automatico' check (modo in ('automatico', 'incluida', 'excluida')),
  vigencia_inicio date not null check (extract(day from vigencia_inicio) = 1),
  vigencia_fim date check (vigencia_fim is null or (extract(day from vigencia_fim) = 1 and vigencia_fim >= vigencia_inicio)),
  responsavel_id uuid references public.perfis(id) on delete set null,
  revisor_id uuid references public.perfis(id) on delete set null,
  prazo_interno_dias_uteis int check (prazo_interno_dias_uteis between 0 and 30),
  motivo text,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint empresa_obrigacoes_motivo check (modo = 'automatico' or length(trim(coalesce(motivo, ''))) >= 5)
);
create index empresa_obrigacoes_empresa_idx on public.empresa_obrigacoes (empresa_id, obrigacao_id);
create trigger empresa_obrigacoes_updated_at before update on public.empresa_obrigacoes
  for each row execute function app.tg_updated_at();

create or replace function app.tg_empresa_obrigacao_sem_sobreposicao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.empresa_obrigacoes c
     where c.empresa_id = new.empresa_id and c.obrigacao_id = new.obrigacao_id and c.id <> new.id
       and c.vigencia_inicio <= coalesce(new.vigencia_fim, 'infinity'::date)
       and coalesce(c.vigencia_fim, 'infinity'::date) >= new.vigencia_inicio
  ) then
    raise exception 'Já existe uma configuração desta obrigação para parte deste período.';
  end if;
  return new;
end;
$$;
create trigger empresa_obrigacoes_sem_sobreposicao before insert or update on public.empresa_obrigacoes
  for each row execute function app.tg_empresa_obrigacao_sem_sobreposicao();

-- A regra vale para a empresa na competência? (vigência, local e, se pedido, aplicabilidade)
create or replace function app.regra_casa(x public.obrigacao_regras, e public.empresas, p_regime text, p_competencia date,
                                          p_ignorar_aplicabilidade boolean default false)
returns boolean
language sql
stable
set search_path = ''
as $$
  select x.vigencia_inicio <= p_competencia and (x.vigencia_fim is null or x.vigencia_fim >= p_competencia)
     and (x.empresa_id is null or x.empresa_id = e.id)
     and (coalesce(cardinality(x.ufs), 0) = 0 or e.uf = any (x.ufs))
     and (coalesce(cardinality(x.municipios), 0) = 0 or e.municipio_ibge = any (x.municipios))
     and (p_ignorar_aplicabilidade or (
          p_regime = any (x.regimes)
          and (not x.exige_empregados or e.tem_empregados)
          and (not x.exige_icms or e.contribuinte_icms)
          and (not x.exige_iss or e.contribuinte_iss)
          and (x.servico is null or x.servico = any (e.servicos))));
$$;

-- Regra validada mais específica que vale para a empresa na competência
-- (empresa > município > estado > geral; a mais recente desempata).
create or replace function app.regra_para(p_obrigacao_id uuid, p_empresa_id uuid, p_competencia date, p_ignorar_aplicabilidade boolean default false)
returns public.obrigacao_regras
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.empresas;
  v_regime text;
  r public.obrigacao_regras;
begin
  select * into e from public.empresas where id = p_empresa_id;
  v_regime := app.regime_em(p_empresa_id, p_competencia);
  select * into r
    from public.obrigacao_regras x
   where x.obrigacao_id = p_obrigacao_id
     and x.status = 'validada'
     and app.regra_casa(x, e, v_regime, p_competencia, p_ignorar_aplicabilidade)
   order by (x.empresa_id is not null) desc,
            (coalesce(cardinality(x.municipios), 0) > 0) desc,
            (coalesce(cardinality(x.ufs), 0) > 0) desc,
            x.vigencia_inicio desc
   limit 1;
  if r.id is null then
    return null;
  end if;
  return r;
end;
$$;

create or replace function app.periodicidade_cobre(p_periodicidade text, p_competencia date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_periodicidade
           when 'mensal' then true
           when 'trimestral' then extract(month from p_competencia) in (3, 6, 9, 12)
           when 'anual' then extract(month from p_competencia) = 12
           else false end;
$$;

-- -----------------------------------------------------------------------------
-- Tarefas por competência (apuração, entrega e pagamento)
-- -----------------------------------------------------------------------------
create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obrigacao_id uuid not null references public.obrigacoes(id) on delete restrict,
  regra_id uuid references public.obrigacao_regras(id) on delete set null,
  competencia date not null check (extract(day from competencia) = 1),
  etapa text not null check (etapa in ('apuracao', 'entrega', 'pagamento')),
  status text not null default 'pendente'
    check (status in ('pendente', 'em_andamento', 'aguardando_cliente', 'em_revisao', 'concluida', 'dispensada')),
  prazo_legal date,          -- prazo de entrega ou vencimento do pagamento (vazio na apuração)
  prazo_interno date not null,
  responsavel_id uuid references public.perfis(id) on delete set null,
  revisor_id uuid references public.perfis(id) on delete set null,
  valor numeric(15, 2) check (valor is null or valor >= 0),
  guia_documento_id uuid references public.documentos(id) on delete set null,
  comprovante_documento_id uuid references public.documentos(id) on delete set null,
  protocolo text,
  enviada_revisao_em timestamptz,
  revisada_por uuid references public.perfis(id) on delete set null,
  revisada_em timestamptz,
  concluida_por uuid references public.perfis(id) on delete set null,
  concluida_em timestamptz,
  dispensa_motivo text,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tarefas_unica unique (empresa_id, obrigacao_id, competencia, etapa)
);
create index tarefas_prazo_idx on public.tarefas (status, prazo_interno);
create index tarefas_responsavel_idx on public.tarefas (responsavel_id, status, prazo_interno);
create index tarefas_empresa_idx on public.tarefas (empresa_id, competencia);
create trigger tarefas_updated_at before update on public.tarefas
  for each row execute function app.tg_updated_at();

create table public.tarefa_historico (
  id bigint generated always as identity primary key,
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  acao text not null,
  status_anterior text,
  status_novo text,
  comentario text,
  detalhes jsonb,
  usuario_id uuid default auth.uid(),
  ocorrido_em timestamptz not null default now()
);
create index tarefa_historico_tarefa_idx on public.tarefa_historico (tarefa_id, ocorrido_em desc);

-- Regras de conclusão: entrega e pagamento só com comprovante; revisão quando há revisor
create or replace function app.tg_tarefa_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
begin
  if new.comprovante_documento_id is not null and new.comprovante_documento_id is distinct from old.comprovante_documento_id then
    select * into v_doc from public.documentos where id = new.comprovante_documento_id;
    if v_doc.id is null or v_doc.empresa_id <> new.empresa_id or v_doc.excluido_em is not null or v_doc.upload_status <> 'concluido' then
      raise exception 'O comprovante precisa ser um documento recebido desta empresa.';
    end if;
  end if;
  if new.guia_documento_id is not null and new.guia_documento_id is distinct from old.guia_documento_id then
    select * into v_doc from public.documentos where id = new.guia_documento_id;
    if v_doc.id is null or v_doc.empresa_id <> new.empresa_id then
      raise exception 'A guia precisa ser um documento desta empresa.';
    end if;
  end if;
  if new.status = 'concluida' and old.status <> 'concluida' then
    if new.etapa = 'entrega' and new.comprovante_documento_id is null then
      raise exception 'Para marcar como transmitida, anexe o recibo ou protocolo de entrega.';
    end if;
    if new.etapa = 'pagamento' and new.comprovante_documento_id is null then
      raise exception 'Para marcar como paga, anexe o comprovante de pagamento.';
    end if;
    if new.revisor_id is not null and auth.uid() is distinct from new.revisor_id and not app.is_admin() then
      raise exception 'Esta tarefa tem revisor: envie para revisão; quem revisa conclui.';
    end if;
    new.concluida_em := now();
    new.concluida_por := auth.uid();
    if new.revisor_id is not null then
      new.revisada_em := now();
      new.revisada_por := auth.uid();
    end if;
  end if;
  if new.status = 'dispensada' and old.status <> 'dispensada' and length(trim(coalesce(new.dispensa_motivo, ''))) < 5 then
    raise exception 'Explique por que a tarefa foi dispensada (ex.: sem movimento no período).';
  end if;
  if new.status = 'em_revisao' and old.status <> 'em_revisao' then
    if new.revisor_id is null then
      raise exception 'Defina quem revisa antes de enviar para revisão.';
    end if;
    new.enviada_revisao_em := now();
  end if;
  if new.status not in ('concluida') and old.status = 'concluida' then
    new.concluida_em := null;
    new.concluida_por := null;
  end if;
  return new;
end;
$$;
create trigger tarefas_regras before update on public.tarefas
  for each row execute function app.tg_tarefa_regras();

-- Prazos de uma etapa: legal (entrega ou pagamento, pela regra) e interno
-- (n dias úteis antes do legal; na apuração, a meta da regra ou n + 2 dias
-- úteis antes do primeiro prazo legal). Sem base na regra, devolve vazio.
create or replace function app.prazos_da_etapa(p_etapas text[], p_regra public.obrigacao_regras, p_etapa text, p_competencia date,
                                               p_uf text, p_municipio text, p_dias_internos int,
                                               out prazo_legal date, out prazo_interno date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entrega date := case when 'entrega' = any (p_etapas) then app.calcular_prazo(p_regra.prazo_entrega, p_competencia, p_uf, p_municipio) end;
  v_pagamento date := case when 'pagamento' = any (p_etapas) then app.calcular_prazo(p_regra.prazo_pagamento, p_competencia, p_uf, p_municipio) end;
begin
  prazo_legal := case p_etapa when 'entrega' then v_entrega when 'pagamento' then v_pagamento end;
  if prazo_legal is not null then
    prazo_interno := app.dias_uteis_antes(prazo_legal, p_dias_internos, p_uf, p_municipio);
  elsif p_etapa = 'apuracao' and p_regra.prazo_apuracao is not null then
    prazo_interno := app.calcular_prazo(p_regra.prazo_apuracao, p_competencia, p_uf, p_municipio);
  elsif p_etapa = 'apuracao' and coalesce(v_entrega, v_pagamento) is not null then
    prazo_interno := app.dias_uteis_antes(least(coalesce(v_entrega, v_pagamento), coalesce(v_pagamento, v_entrega)),
                                          p_dias_internos + 2, p_uf, p_municipio);
  end if;
end;
$$;

-- Gera as tarefas de uma empresa numa competência (idempotente, sem duplicar).
-- p_corte: não cria tarefas cujo prazo já passou antes desta data (evita
-- "atrasos" de períodos anteriores ao uso do sistema).
create or replace function app.gerar_tarefas_empresa(p_empresa_id uuid, p_competencia date, p_corte date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.empresas;
  o public.obrigacoes;
  cfg public.empresa_obrigacoes;
  r public.obrigacao_regras;
  v_comp date := app.competencia_de(p_competencia);
  v_legal date;
  v_interno date;
  v_etapa text;
  v_criadas int := 0;
  v_ins int;
begin
  select * into e from public.empresas where id = p_empresa_id;
  if e.id is null or not e.ativa then
    return 0;
  end if;
  for o in select * from public.obrigacoes where ativa and app.periodicidade_cobre(periodicidade, v_comp) loop
    cfg := null;
    select * into cfg from public.empresa_obrigacoes c
     where c.empresa_id = e.id and c.obrigacao_id = o.id
       and c.vigencia_inicio <= v_comp and (c.vigencia_fim is null or c.vigencia_fim >= v_comp)
     limit 1;
    continue when cfg.modo = 'excluida';
    r := app.regra_para(o.id, e.id, v_comp, coalesce(cfg.modo = 'incluida', false));
    continue when r.id is null; -- sem regra validada: nenhum prazo é presumido
    foreach v_etapa in array o.etapas loop
      select x.prazo_legal, x.prazo_interno into v_legal, v_interno
        from app.prazos_da_etapa(o.etapas, r, v_etapa, v_comp, e.uf, e.municipio_ibge,
                                 coalesce(cfg.prazo_interno_dias_uteis, r.prazo_interno_dias_uteis)) x;
      continue when v_interno is null;
      continue when p_corte is not null and coalesce(v_legal, v_interno) < p_corte;
      insert into public.tarefas (empresa_id, obrigacao_id, regra_id, competencia, etapa, prazo_legal, prazo_interno, responsavel_id, revisor_id)
      values (e.id, o.id, r.id, v_comp, v_etapa, v_legal, v_interno, coalesce(cfg.responsavel_id, e.contador_responsavel_id), cfg.revisor_id)
      on conflict (empresa_id, obrigacao_id, competencia, etapa) do nothing;
      get diagnostics v_ins = row_count;
      v_criadas := v_criadas + v_ins;
    end loop;
  end loop;
  return v_criadas;
end;
$$;

-- Recalcula prazos das tarefas abertas a partir de uma competência (após mudança normativa)
create or replace function app.recalcular_tarefas(p_obrigacao_id uuid, p_desde date, p_motivo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  o public.obrigacoes;
  cfg public.empresa_obrigacoes;
  r public.obrigacao_regras;
  v_legal date;
  v_interno date;
  v_qtd int := 0;
begin
  select * into o from public.obrigacoes where id = p_obrigacao_id;
  for t in
    select x.*, e.uf, e.municipio_ibge
      from public.tarefas x join public.empresas e on e.id = x.empresa_id
     where x.obrigacao_id = p_obrigacao_id and x.competencia >= p_desde and x.status not in ('concluida', 'dispensada')
  loop
    cfg := null;
    select * into cfg from public.empresa_obrigacoes c
     where c.empresa_id = t.empresa_id and c.obrigacao_id = t.obrigacao_id
       and c.vigencia_inicio <= t.competencia and (c.vigencia_fim is null or c.vigencia_fim >= t.competencia)
     limit 1;
    r := case when cfg.modo = 'excluida' then null else app.regra_para(t.obrigacao_id, t.empresa_id, t.competencia, coalesce(cfg.modo = 'incluida', false)) end;
    v_legal := null;
    v_interno := null;
    if r.id is not null then
      select x.prazo_legal, x.prazo_interno into v_legal, v_interno
        from app.prazos_da_etapa(o.etapas, r, t.etapa, t.competencia, t.uf, t.municipio_ibge,
                                 coalesce(cfg.prazo_interno_dias_uteis, r.prazo_interno_dias_uteis)) x;
    end if;
    if v_interno is null then
      update public.tarefas
         set status = 'dispensada',
             dispensa_motivo = left(coalesce(p_motivo, 'Sem regra vigente para esta competência.') || ' (sem regra vigente para esta etapa)', 500)
       where id = t.id;
      insert into public.tarefa_historico (tarefa_id, empresa_id, acao, status_anterior, status_novo, comentario)
      values (t.id, t.empresa_id, 'dispensada_por_norma', t.status, 'dispensada', p_motivo);
      v_qtd := v_qtd + 1;
      continue;
    end if;
    if v_legal is distinct from t.prazo_legal or v_interno is distinct from t.prazo_interno or r.id is distinct from t.regra_id then
      update public.tarefas set prazo_legal = v_legal, prazo_interno = v_interno, regra_id = r.id where id = t.id;
      insert into public.tarefa_historico (tarefa_id, empresa_id, acao, comentario, detalhes)
      values (t.id, t.empresa_id, 'prazo_recalculado', p_motivo,
              jsonb_build_object('prazo_legal_anterior', t.prazo_legal, 'prazo_legal', v_legal, 'prazo_interno_anterior', t.prazo_interno, 'prazo_interno', v_interno));
      v_qtd := v_qtd + 1;
    end if;
  end loop;
  return v_qtd;
end;
$$;

-- Gera tarefas sob demanda (equipe). Sem empresa: todas as que a pessoa atende.
create or replace function public.gerar_tarefas(p_competencia date, p_empresa_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_total int := 0;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  for e in select id from public.empresas where ativa and (p_empresa_id is null or id = p_empresa_id) loop
    continue when not app.equipe_ve_empresa(e.id);
    v_total := v_total + app.gerar_tarefas_empresa(e.id, p_competencia, null);
  end loop;
  perform app.registrar_auditoria('gerar_tarefas', 'tarefas', null, p_empresa_id, jsonb_build_object('competencia', p_competencia, 'criadas', v_total));
  return v_total;
end;
$$;

-- Ação sobre uma tarefa (com histórico e regras de comprovante e revisão)
create or replace function public.atualizar_tarefa(
  p_tarefa_id uuid,
  p_status text default null,
  p_comentario text default null,
  p_comprovante_documento_id uuid default null,
  p_guia_documento_id uuid default null,
  p_protocolo text default null,
  p_valor numeric default null,
  p_dispensa_motivo text default null,
  p_responsavel_id uuid default null,
  p_revisor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tarefas;
begin
  select * into t from public.tarefas where id = p_tarefa_id for update;
  if t.id is null or not app.equipe_ve_empresa(t.empresa_id) then
    raise exception 'Tarefa não encontrada.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('pendente', 'em_andamento', 'aguardando_cliente', 'em_revisao', 'concluida', 'dispensada') then
    raise exception 'Situação inválida.';
  end if;
  if p_status is not null and p_status <> 'concluida' and t.status = 'concluida' and not app.is_admin() and auth.uid() is distinct from t.concluida_por then
    raise exception 'Só quem concluiu (ou um administrador) pode reabrir a tarefa.';
  end if;
  update public.tarefas
     set status = coalesce(p_status, status),
         comprovante_documento_id = coalesce(p_comprovante_documento_id, comprovante_documento_id),
         guia_documento_id = coalesce(p_guia_documento_id, guia_documento_id),
         protocolo = coalesce(nullif(trim(coalesce(p_protocolo, '')), ''), protocolo),
         valor = coalesce(p_valor, valor),
         dispensa_motivo = coalesce(nullif(trim(coalesce(p_dispensa_motivo, '')), ''), dispensa_motivo),
         responsavel_id = coalesce(p_responsavel_id, responsavel_id),
         revisor_id = coalesce(p_revisor_id, revisor_id)
   where id = t.id;
  insert into public.tarefa_historico (tarefa_id, empresa_id, acao, status_anterior, status_novo, comentario, detalhes)
  values (t.id, t.empresa_id,
          case when p_status is not null and p_status <> t.status then 'status' else 'atualizacao' end,
          t.status, coalesce(p_status, t.status), nullif(trim(coalesce(p_comentario, '')), ''),
          jsonb_strip_nulls(jsonb_build_object(
            'comprovante', p_comprovante_documento_id, 'guia', p_guia_documento_id, 'protocolo', nullif(trim(coalesce(p_protocolo, '')), ''),
            'valor', p_valor, 'responsavel', p_responsavel_id, 'revisor', p_revisor_id)));
end;
$$;

-- Atribuição em lote
create or replace function public.atribuir_tarefas(p_ids uuid[], p_responsavel_id uuid default null, p_revisor_id uuid default null, p_limpar_revisor boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  t public.tarefas;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  for t in select * from public.tarefas where id = any (p_ids) and status not in ('concluida', 'dispensada') for update loop
    continue when not app.equipe_ve_empresa(t.empresa_id);
    update public.tarefas
       set responsavel_id = coalesce(p_responsavel_id, responsavel_id),
           revisor_id = case when p_limpar_revisor then null else coalesce(p_revisor_id, revisor_id) end
     where id = t.id;
    insert into public.tarefa_historico (tarefa_id, empresa_id, acao, detalhes)
    values (t.id, t.empresa_id, 'atribuicao', jsonb_strip_nulls(jsonb_build_object('responsavel', p_responsavel_id, 'revisor', p_revisor_id, 'sem_revisor', p_limpar_revisor)));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Atualizações normativas (proposta → validação → aplicação)
-- -----------------------------------------------------------------------------
create table public.atualizacoes_normativas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 3),
  resumo text,
  tipo text not null check (tipo in ('nova_regra', 'alteracao_regra', 'revogacao')),
  obrigacao_id uuid not null references public.obrigacoes(id) on delete cascade,
  regra_anterior_id uuid references public.obrigacao_regras(id) on delete set null,
  regra_proposta_id uuid references public.obrigacao_regras(id) on delete set null,
  vigencia_inicio date not null check (extract(day from vigencia_inicio) = 1),
  fonte_titulo text not null check (length(trim(fonte_titulo)) > 3),
  fonte_url text,
  fonte_publicada_em date,
  fonte_consultada_em date not null,
  status text not null default 'proposta' check (status in ('proposta', 'validada', 'aplicada', 'rejeitada')),
  proposta_por uuid references public.perfis(id) on delete set null default auth.uid(),
  proposta_em timestamptz not null default now(),
  validada_por uuid references public.perfis(id) on delete set null,
  validada_em timestamptz,
  validacao_observacao text,
  aplicada_por uuid references public.perfis(id) on delete set null,
  aplicada_em timestamptz,
  resultado jsonb,
  rejeitada_por uuid references public.perfis(id) on delete set null,
  rejeitada_em timestamptz,
  motivo_rejeicao text,
  constraint atualizacoes_normativas_regra check (
    (tipo = 'revogacao' and regra_anterior_id is not null)
    or (tipo <> 'revogacao' and regra_proposta_id is not null))
);
create index atualizacoes_normativas_status_idx on public.atualizacoes_normativas (status, proposta_em desc);

-- Propõe uma regra nova (ou a substituição de uma regra) com a fonte oficial.
create or replace function public.propor_regra(
  p_obrigacao_id uuid,
  p_titulo text,
  p_resumo text,
  p_regra jsonb,
  p_fonte_titulo text,
  p_fonte_url text,
  p_fonte_publicada_em date,
  p_fonte_consultada_em date,
  p_regra_anterior_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regra uuid;
  v_id uuid;
  v_vig date := app.competencia_de((p_regra ->> 'vigencia_inicio')::date);
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if coalesce(trim(p_fonte_titulo), '') = '' or p_fonte_consultada_em is null then
    raise exception 'Informe a fonte oficial e a data em que foi consultada.';
  end if;
  if not app.prazo_valido(p_regra -> 'prazo_entrega') or not app.prazo_valido(p_regra -> 'prazo_pagamento') or not app.prazo_valido(p_regra -> 'prazo_apuracao') then
    raise exception 'Regra de prazo incompleta ou inválida.';
  end if;
  insert into public.obrigacao_regras (
    obrigacao_id, vigencia_inicio, vigencia_fim, regimes, ufs, municipios, empresa_id,
    exige_empregados, exige_icms, exige_iss, servico,
    prazo_entrega, prazo_pagamento, prazo_apuracao, prazo_interno_dias_uteis,
    fonte_titulo, fonte_url, fonte_consultada_em, observacao, status)
  values (
    p_obrigacao_id, v_vig, app.competencia_de(nullif(p_regra ->> 'vigencia_fim', '')::date),
    array(select jsonb_array_elements_text(p_regra -> 'regimes')),
    nullif(array(select jsonb_array_elements_text(coalesce(p_regra -> 'ufs', '[]'::jsonb))), array[]::text[]),
    nullif(array(select jsonb_array_elements_text(coalesce(p_regra -> 'municipios', '[]'::jsonb))), array[]::text[]),
    app.try_uuid(p_regra ->> 'empresa_id'),
    coalesce((p_regra ->> 'exige_empregados')::boolean, false),
    coalesce((p_regra ->> 'exige_icms')::boolean, false),
    coalesce((p_regra ->> 'exige_iss')::boolean, false),
    nullif(p_regra ->> 'servico', ''),
    nullif(p_regra -> 'prazo_entrega', 'null'::jsonb), nullif(p_regra -> 'prazo_pagamento', 'null'::jsonb),
    nullif(p_regra -> 'prazo_apuracao', 'null'::jsonb),
    coalesce((p_regra ->> 'prazo_interno_dias_uteis')::int, 2),
    p_fonte_titulo, nullif(trim(coalesce(p_fonte_url, '')), ''), p_fonte_consultada_em,
    nullif(trim(coalesce(p_regra ->> 'observacao', '')), ''), 'rascunho')
  returning id into v_regra;
  insert into public.atualizacoes_normativas (titulo, resumo, tipo, obrigacao_id, regra_anterior_id, regra_proposta_id, vigencia_inicio,
                                              fonte_titulo, fonte_url, fonte_publicada_em, fonte_consultada_em)
  values (p_titulo, p_resumo, case when p_regra_anterior_id is null then 'nova_regra' else 'alteracao_regra' end,
          p_obrigacao_id, p_regra_anterior_id, v_regra, v_vig, p_fonte_titulo, nullif(trim(coalesce(p_fonte_url, '')), ''),
          p_fonte_publicada_em, p_fonte_consultada_em)
  returning id into v_id;
  return v_id;
end;
$$;

-- Propõe o fim de uma regra (ex.: obrigação extinta ou substituída)
create or replace function public.propor_revogacao(
  p_regra_id uuid,
  p_titulo text,
  p_resumo text,
  p_vigencia_inicio date,
  p_fonte_titulo text,
  p_fonte_url text,
  p_fonte_publicada_em date,
  p_fonte_consultada_em date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.obrigacao_regras;
  v_id uuid;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into r from public.obrigacao_regras where id = p_regra_id;
  if r.id is null or r.status <> 'validada' then
    raise exception 'Somente regras validadas podem ser encerradas.';
  end if;
  if coalesce(trim(p_fonte_titulo), '') = '' or p_fonte_consultada_em is null then
    raise exception 'Informe a fonte oficial e a data em que foi consultada.';
  end if;
  insert into public.atualizacoes_normativas (titulo, resumo, tipo, obrigacao_id, regra_anterior_id, vigencia_inicio,
                                              fonte_titulo, fonte_url, fonte_publicada_em, fonte_consultada_em)
  values (p_titulo, p_resumo, 'revogacao', r.obrigacao_id, r.id, app.competencia_de(p_vigencia_inicio),
          p_fonte_titulo, nullif(trim(coalesce(p_fonte_url, '')), ''), p_fonte_publicada_em, p_fonte_consultada_em)
  returning id into v_id;
  return v_id;
end;
$$;

-- Validação (administrador): confere a fonte; nada muda até aplicar.
create or replace function public.validar_atualizacao_normativa(p_id uuid, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.atualizacoes_normativas;
begin
  if not app.is_admin() then
    raise exception 'Somente administradores validam atualizações normativas.' using errcode = '42501';
  end if;
  select * into a from public.atualizacoes_normativas where id = p_id for update;
  if a.id is null or a.status <> 'proposta' then
    raise exception 'Somente propostas podem ser validadas.';
  end if;
  update public.atualizacoes_normativas
     set status = 'validada', validada_por = auth.uid(), validada_em = now(),
         validacao_observacao = nullif(trim(coalesce(p_observacao, '')), '')
   where id = p_id;
end;
$$;

create or replace function public.rejeitar_atualizacao_normativa(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.atualizacoes_normativas;
begin
  if not app.is_admin() then
    raise exception 'Somente administradores rejeitam atualizações normativas.' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo.';
  end if;
  select * into a from public.atualizacoes_normativas where id = p_id for update;
  if a.id is null or a.status not in ('proposta', 'validada') then
    raise exception 'Esta atualização não pode mais ser rejeitada.';
  end if;
  update public.atualizacoes_normativas
     set status = 'rejeitada', rejeitada_por = auth.uid(), rejeitada_em = now(), motivo_rejeicao = trim(p_motivo)
   where id = p_id;
end;
$$;

-- Aplicação (administrador, somente após validação): ativa a nova regra,
-- encerra a anterior no mês anterior à vigência e recalcula tarefas abertas.
create or replace function public.aplicar_atualizacao_normativa(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.atualizacoes_normativas;
  nova public.obrigacao_regras;
  v_fim date;
  v_recalc int := 0;
  v_geradas int := 0;
  e record;
  c date;
  v_motivo text;
begin
  if not app.is_admin() then
    raise exception 'Somente administradores aplicam atualizações normativas.' using errcode = '42501';
  end if;
  select * into a from public.atualizacoes_normativas where id = p_id for update;
  if a.id is null then
    raise exception 'Atualização não encontrada.';
  end if;
  if a.status <> 'validada' then
    raise exception 'Valide a atualização (conferindo a fonte) antes de aplicar.';
  end if;
  v_fim := (a.vigencia_inicio - interval '1 month')::date;
  v_motivo := a.titulo || ' — ' || a.fonte_titulo;
  perform set_config('app.aplicando_norma', 'on', true);
  if a.regra_anterior_id is not null then
    update public.obrigacao_regras
       set vigencia_fim = case when vigencia_inicio > v_fim then vigencia_inicio else least(coalesce(vigencia_fim, v_fim), v_fim) end,
           status = case when vigencia_inicio > v_fim then 'revogada' else status end
     where id = a.regra_anterior_id;
  end if;
  if a.regra_proposta_id is not null then
    update public.obrigacao_regras
       set status = 'validada', validada_por = a.validada_por, validada_em = a.validada_em
     where id = a.regra_proposta_id
    returning * into nova;
  end if;
  perform set_config('app.aplicando_norma', 'off', true);
  v_recalc := app.recalcular_tarefas(a.obrigacao_id, a.vigencia_inicio, v_motivo);
  -- Gera as tarefas da janela atual para quem passou a ter a obrigação
  for e in select id from public.empresas where ativa loop
    c := (app.competencia_de(app.hoje()) - interval '12 months')::date;
    while c <= app.competencia_de(app.hoje()) loop
      if c >= a.vigencia_inicio then
        v_geradas := v_geradas + app.gerar_tarefas_empresa(e.id, c, (app.hoje() - 30));
      end if;
      c := (c + interval '1 month')::date;
    end loop;
  end loop;
  update public.atualizacoes_normativas
     set status = 'aplicada', aplicada_por = auth.uid(), aplicada_em = now(),
         resultado = jsonb_build_object('tarefas_recalculadas', v_recalc, 'tarefas_geradas', v_geradas)
   where id = p_id;
  perform app.registrar_auditoria('aplicar_norma', 'atualizacoes_normativas', p_id::text, null,
                                  jsonb_build_object('obrigacao', a.obrigacao_id, 'recalculadas', v_recalc, 'geradas', v_geradas));
  return jsonb_build_object('tarefas_recalculadas', v_recalc, 'tarefas_geradas', v_geradas);
end;
$$;

-- Recibos de entrega e protocolos publicados pelo escritório (comprovam a transmissão)
insert into public.categorias_documento (codigo, nome, descricao, grupo, extensoes, escritorio, ordem)
values ('esc_protocolo', 'Recibos de entrega e protocolos', 'Recibos e protocolos de transmissão de declarações e obrigações.',
        'escritorio', array['pdf', 'jpg', 'jpeg', 'png', 'xml', 'txt', 'zip'], true, 205)
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- Integração com os documentos do portal: guia publicada pelo escritório é
-- ligada à tarefa de pagamento correspondente (sem marcar como paga).
-- -----------------------------------------------------------------------------
create or replace function app.tg_documento_liga_tarefa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if new.upload_status <> 'concluido' or old.upload_status = 'concluido' or new.direcao <> 'escritorio' then
    return null;
  end if;
  select array_agg(t.id) into v_ids
    from public.tarefas t
    join public.obrigacoes o on o.id = t.obrigacao_id
   where t.empresa_id = new.empresa_id and t.competencia = new.competencia and t.etapa = 'pagamento'
     and t.guia_documento_id is null and t.status not in ('concluida', 'dispensada')
     and new.categoria_codigo = any (o.categorias_documento);
  if cardinality(v_ids) = 1 then
    update public.tarefas set guia_documento_id = new.id, valor = coalesce(valor, new.valor) where id = v_ids[1];
    insert into public.tarefa_historico (tarefa_id, empresa_id, acao, comentario, detalhes, usuario_id)
    values (v_ids[1], new.empresa_id, 'guia_vinculada', 'Guia publicada no portal ligada automaticamente.', jsonb_build_object('documento', new.id), auth.uid());
  end if;
  return null;
end;
$$;
create trigger documentos_liga_tarefa after update of upload_status on public.documentos
  for each row execute function app.tg_documento_liga_tarefa();

-- -----------------------------------------------------------------------------
-- Consultas para as telas
-- -----------------------------------------------------------------------------
-- Tabela operacional das empresas
create or replace function public.operacional_empresas()
returns table (
  empresa_id uuid, razao_social text, nome_fantasia text, documento text, regime text, uf text, municipio text,
  responsavel text, abertas int, atrasadas int, vencendo_7d int, aguardando_cliente int, em_revisao int, proximo_prazo date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.razao_social, e.nome_fantasia, e.documento, app.regime_em(e.id, app.competencia_de(app.hoje())), e.uf,
         coalesce(m.nome, e.cidade), p.nome,
         count(t.id) filter (where t.status not in ('concluida', 'dispensada'))::int,
         count(t.id) filter (where t.status not in ('concluida', 'dispensada') and coalesce(t.prazo_legal, t.prazo_interno) < app.hoje())::int,
         count(t.id) filter (where t.status not in ('concluida', 'dispensada') and t.prazo_interno between app.hoje() and app.hoje() + 7)::int,
         count(t.id) filter (where t.status = 'aguardando_cliente')::int,
         count(t.id) filter (where t.status = 'em_revisao')::int,
         min(least(t.prazo_interno, coalesce(t.prazo_legal, t.prazo_interno))) filter (where t.status not in ('concluida', 'dispensada'))
    from public.empresas e
    left join public.municipios m on m.ibge = e.municipio_ibge
    left join public.perfis p on p.id = e.contador_responsavel_id
    left join public.tarefas t on t.empresa_id = e.id
   where e.ativa and app.equipe_ve_empresa(e.id)
   group by e.id, m.nome, p.nome;
$$;

-- Calendário da empresa numa competência: o que se aplica, por quê e quando
create or replace function public.calendario_empresa(p_empresa_id uuid, p_competencia date)
returns table (
  obrigacao_id uuid, codigo text, nome text, esfera text, area text, tributos text[], periodicidade text, etapas text[],
  situacao text, motivo text, regra_id uuid, fonte text, fonte_url text, prazo_entrega date, prazo_pagamento date,
  config_id uuid, modo text, responsavel_id uuid, revisor_id uuid, prazo_interno_dias_uteis int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.empresas;
  o public.obrigacoes;
  cfg public.empresa_obrigacoes;
  r public.obrigacao_regras;
  v_comp date := app.competencia_de(p_competencia);
  v_regime text;
  v_ini date;
  v_fim date;
  v_incluida boolean;
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into e from public.empresas where id = p_empresa_id;
  v_regime := app.regime_em(e.id, v_comp);
  for o in select * from public.obrigacoes ob where ob.ativa order by ob.esfera, ob.nome loop
    cfg := null;
    select * into cfg from public.empresa_obrigacoes c
     where c.empresa_id = e.id and c.obrigacao_id = o.id and c.vigencia_inicio <= v_comp and (c.vigencia_fim is null or c.vigencia_fim >= v_comp) limit 1;
    v_incluida := coalesce(cfg.modo = 'incluida', false);
    r := app.regra_para(o.id, e.id, v_comp, v_incluida);
    obrigacao_id := o.id; codigo := o.codigo; nome := o.nome; esfera := o.esfera; area := o.area; tributos := o.tributos;
    periodicidade := o.periodicidade; etapas := o.etapas;
    config_id := cfg.id; modo := coalesce(cfg.modo, 'automatico'); responsavel_id := coalesce(cfg.responsavel_id, e.contador_responsavel_id);
    revisor_id := cfg.revisor_id; prazo_interno_dias_uteis := cfg.prazo_interno_dias_uteis;
    regra_id := r.id; fonte := r.fonte_titulo; fonte_url := r.fonte_url; prazo_entrega := null; prazo_pagamento := null;
    if cfg.modo = 'excluida' then
      situacao := 'excluida'; motivo := cfg.motivo;
    elsif r.id is not null then
      if not app.periodicidade_cobre(o.periodicidade, v_comp) then
        situacao := 'fora_da_periodicidade';
        motivo := case o.periodicidade when 'trimestral' then 'Trimestral: apurada nas competências de março, junho, setembro e dezembro.'
                                       when 'anual' then 'Anual: apurada na competência de dezembro (ano-base).' else 'Fora da periodicidade.' end;
      else
        situacao := 'aplica';
        motivo := case when v_incluida then 'Incluída manualmente: ' || cfg.motivo else 'Aplicável pelo regime e pelo cadastro da empresa.' end;
        prazo_entrega := case when 'entrega' = any (o.etapas) then app.calcular_prazo(r.prazo_entrega, v_comp, e.uf, e.municipio_ibge) end;
        prazo_pagamento := case when 'pagamento' = any (o.etapas) then app.calcular_prazo(r.prazo_pagamento, v_comp, e.uf, e.municipio_ibge) end;
      end if;
    elsif exists (select 1 from public.obrigacao_regras x where x.obrigacao_id = o.id and x.status = 'rascunho'
                   and app.regra_casa(x, e, v_regime, v_comp, v_incluida)) then
      situacao := 'aguardando_validacao';
      motivo := 'Há regra proposta aguardando validação; sem ela nenhum prazo é calculado.';
    elsif exists (select 1 from public.obrigacao_regras x where x.obrigacao_id = o.id and x.status in ('rascunho', 'validada')
                   and app.regra_casa(x, e, v_regime, v_comp, true)) then
      situacao := 'nao_aplica';
      motivo := 'Não se aplica ao regime (' || coalesce(v_regime, '?') || ') ou ao cadastro da empresa nesta competência.';
    elsif 'ICMS' = any (o.tributos) and not e.contribuinte_icms then
      situacao := 'nao_aplica'; motivo := 'A empresa não está marcada como contribuinte do ICMS.';
    elsif 'ISS' = any (o.tributos) and not e.contribuinte_iss then
      situacao := 'nao_aplica'; motivo := 'A empresa não está marcada como contribuinte do ISS.';
    else
      select min(x.vigencia_inicio), max(coalesce(x.vigencia_fim, 'infinity'::date)) into v_ini, v_fim
        from public.obrigacao_regras x
       where x.obrigacao_id = o.id and x.status in ('rascunho', 'validada')
         and (x.empresa_id is null or x.empresa_id = e.id)
         and (coalesce(cardinality(x.ufs), 0) = 0 or e.uf = any (x.ufs))
         and (coalesce(cardinality(x.municipios), 0) = 0 or e.municipio_ibge = any (x.municipios));
      if v_ini is not null and v_ini > v_comp then
        situacao := 'fora_da_vigencia'; motivo := 'Passa a valer a partir de ' || to_char(v_ini, 'MM/YYYY') || '.';
      elsif v_fim is not null and v_fim < v_comp then
        situacao := 'fora_da_vigencia'; motivo := 'Vigente até ' || to_char(v_fim, 'MM/YYYY') || '; mantida no histórico das competências anteriores.';
      else
        situacao := 'sem_regra';
        motivo := case o.esfera when 'federal' then 'Sem regra validada. Cadastre a regra com a fonte oficial.'
                                when 'estadual' then 'Sem regra validada para ' || coalesce(e.uf, 'o estado') || '. Cadastre a regra com a fonte oficial.'
                                else 'Sem regra validada para o município da empresa. Cadastre a regra com a fonte oficial.' end;
      end if;
    end if;
    return next;
  end loop;
end;
$$;

-- Prévia dos prazos de uma regra (salva ou em edição) para uma empresa ou um local
create or replace function public.simular_regra(
  p_regra jsonb,
  p_periodicidade text,
  p_inicio date,
  p_meses int default 12,
  p_empresa_id uuid default null,
  p_uf text default null,
  p_municipio text default null
)
returns table (competencia date, prazo_apuracao date, prazo_entrega date, prazo_pagamento date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uf text := upper(nullif(trim(coalesce(p_uf, '')), ''));
  v_mun text := nullif(trim(coalesce(p_municipio, '')), '');
  c date := app.competencia_de(p_inicio);
  i int := 0;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_empresa_id is not null then
    if not app.equipe_ve_empresa(p_empresa_id) then
      raise exception 'Acesso negado.' using errcode = '42501';
    end if;
    select e.uf, e.municipio_ibge into v_uf, v_mun from public.empresas e where e.id = p_empresa_id;
  end if;
  if not app.prazo_valido(p_regra -> 'prazo_entrega') or not app.prazo_valido(p_regra -> 'prazo_pagamento')
     or not app.prazo_valido(p_regra -> 'prazo_apuracao') then
    raise exception 'Regra de prazo incompleta ou inválida.';
  end if;
  while i < least(greatest(coalesce(p_meses, 12), 1), 36) loop
    if app.periodicidade_cobre(p_periodicidade, c) then
      competencia := c;
      prazo_apuracao := app.calcular_prazo(p_regra -> 'prazo_apuracao', c, v_uf, v_mun);
      prazo_entrega := app.calcular_prazo(p_regra -> 'prazo_entrega', c, v_uf, v_mun);
      prazo_pagamento := app.calcular_prazo(p_regra -> 'prazo_pagamento', c, v_uf, v_mun);
      return next;
    end if;
    c := (c + interval '1 month')::date;
    i := i + 1;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Alertas diários e rotina operacional
-- -----------------------------------------------------------------------------
create or replace function app.alertas_tarefas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  u record;
  v_n int := 0;
begin
  for u in
    select t.responsavel_id as user_id,
           count(*) filter (where coalesce(t.prazo_legal, t.prazo_interno) < app.hoje()) as atrasadas,
           count(*) filter (where t.prazo_interno between app.hoje() and app.hoje() + 3) as vencendo,
           count(*) filter (where t.status = 'em_revisao') as revisao
      from public.tarefas t
     where t.status not in ('concluida', 'dispensada') and t.responsavel_id is not null
     group by t.responsavel_id
  loop
    continue when u.atrasadas = 0 and u.vencendo = 0;
    continue when exists (select 1 from public.notificacoes n where n.user_id = u.user_id and n.tipo = 'tarefas_alerta'
                                                              and (n.created_at at time zone 'America/Araguaina')::date = app.hoje());
    perform app.notificar(u.user_id, null, 'tarefas_alerta',
      case when u.atrasadas > 0 then u.atrasadas || ' tarefa(s) em atraso' else u.vencendo || ' tarefa(s) vencendo nos próximos 3 dias' end,
      'Atrasadas: ' || u.atrasadas || ' · vencendo em até 3 dias: ' || u.vencendo || '. Veja em Obrigações → Tarefas.',
      '/escritorio/obrigacoes/tarefas?filtro=minhas', true);
    v_n := v_n + 1;
  end loop;
  -- Revisores: tarefas aguardando revisão
  for u in
    select t.revisor_id as user_id, count(*) as qtd from public.tarefas t
     where t.status = 'em_revisao' and t.revisor_id is not null group by t.revisor_id
  loop
    continue when exists (select 1 from public.notificacoes n where n.user_id = u.user_id and n.tipo = 'tarefas_revisao'
                                                              and (n.created_at at time zone 'America/Araguaina')::date = app.hoje());
    perform app.notificar(u.user_id, null, 'tarefas_revisao', u.qtd || ' tarefa(s) aguardando sua revisão', null,
                          '/escritorio/obrigacoes/tarefas?filtro=revisar', false);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.rotina_operacional()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  c date;
  v_geradas int := 0;
  v_alertas int;
begin
  for e in select id from public.empresas where ativa loop
    c := (app.competencia_de(app.hoje()) - interval '12 months')::date;
    while c <= app.competencia_de(app.hoje()) loop
      v_geradas := v_geradas + app.gerar_tarefas_empresa(e.id, c, (app.hoje() - 30));
      c := (c + interval '1 month')::date;
    end loop;
  end loop;
  v_alertas := app.alertas_tarefas();
  if v_geradas > 0 then
    perform app.registrar_auditoria('gerar_tarefas', 'tarefas', null, null, jsonb_build_object('origem', 'rotina_diaria', 'criadas', v_geradas));
  end if;
  return jsonb_build_object('tarefas_geradas', v_geradas, 'alertas', v_alertas);
end;
$$;

-- -----------------------------------------------------------------------------
-- Segurança (somente equipe; cliente não enxerga a camada operacional)
-- -----------------------------------------------------------------------------
alter table public.empresa_regimes enable row level security;
alter table public.feriados enable row level security;
alter table public.obrigacoes enable row level security;
alter table public.obrigacao_regras enable row level security;
alter table public.empresa_obrigacoes enable row level security;
alter table public.tarefas enable row level security;
alter table public.tarefa_historico enable row level security;
alter table public.atualizacoes_normativas enable row level security;

create policy empresa_regimes_leitura on public.empresa_regimes for select to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)));
create policy empresa_regimes_escrita on public.empresa_regimes for all to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)) and (select app.pode(empresa_id, 'empresa.editar')))
  with check ((select app.equipe_ve_empresa(empresa_id)) and (select app.pode(empresa_id, 'empresa.editar')));

create policy feriados_leitura on public.feriados for select to authenticated using ((select app.is_equipe()));
create policy feriados_escrita on public.feriados for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy obrigacoes_leitura on public.obrigacoes for select to authenticated using ((select app.is_equipe()));
create policy obrigacoes_escrita on public.obrigacoes for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy obrigacao_regras_leitura on public.obrigacao_regras for select to authenticated using ((select app.is_equipe()));

create policy empresa_obrigacoes_leitura on public.empresa_obrigacoes for select to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)));
create policy empresa_obrigacoes_escrita on public.empresa_obrigacoes for all to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)))
  with check ((select app.equipe_ve_empresa(empresa_id)));

create policy tarefas_leitura on public.tarefas for select to authenticated using ((select app.equipe_ve_empresa(empresa_id)));
create policy tarefa_historico_leitura on public.tarefa_historico for select to authenticated using ((select app.equipe_ve_empresa(empresa_id)));
create policy atualizacoes_normativas_leitura on public.atualizacoes_normativas for select to authenticated using ((select app.is_equipe()));

grant select on public.empresa_regimes, public.feriados, public.obrigacoes, public.obrigacao_regras,
                public.empresa_obrigacoes, public.tarefas, public.tarefa_historico, public.atualizacoes_normativas to authenticated;
grant insert, update, delete on public.empresa_regimes, public.feriados, public.empresa_obrigacoes to authenticated;
grant insert (codigo, nome, descricao, esfera, area, tributos, etapas, periodicidade, categorias_documento, observacao),
      update (nome, descricao, tributos, categorias_documento, ativa, observacao)
  on public.obrigacoes to authenticated;
grant update (municipio_ibge, contribuinte_icms, contribuinte_iss, tem_empregados) on public.empresas to authenticated;

-- Auditoria
create trigger auditoria_empresa_regimes after insert or update or delete on public.empresa_regimes
  for each row execute function app.tg_auditoria();
create trigger auditoria_feriados after insert or update or delete on public.feriados
  for each row execute function app.tg_auditoria();
create trigger auditoria_obrigacoes after insert or update or delete on public.obrigacoes
  for each row execute function app.tg_auditoria();
create trigger auditoria_obrigacao_regras after insert or update or delete on public.obrigacao_regras
  for each row execute function app.tg_auditoria();
create trigger auditoria_empresa_obrigacoes after insert or update or delete on public.empresa_obrigacoes
  for each row execute function app.tg_auditoria();
create trigger auditoria_tarefas after update or delete on public.tarefas
  for each row execute function app.tg_auditoria();
create trigger auditoria_atualizacoes_normativas after insert or update or delete on public.atualizacoes_normativas
  for each row execute function app.tg_auditoria();

revoke execute on function
  public.gerar_tarefas(date, uuid),
  public.atualizar_tarefa(uuid, text, text, uuid, uuid, text, numeric, text, uuid, uuid),
  public.atribuir_tarefas(uuid[], uuid, uuid, boolean),
  public.propor_regra(uuid, text, text, jsonb, text, text, date, date, uuid),
  public.propor_revogacao(uuid, text, text, date, text, text, date, date),
  public.validar_atualizacao_normativa(uuid, text),
  public.rejeitar_atualizacao_normativa(uuid, text),
  public.aplicar_atualizacao_normativa(uuid),
  public.operacional_empresas(),
  public.calendario_empresa(uuid, date),
  public.simular_regra(jsonb, text, date, int, uuid, text, text),
  public.rotina_operacional()
from public, anon;
grant execute on function
  public.gerar_tarefas(date, uuid),
  public.atualizar_tarefa(uuid, text, text, uuid, uuid, text, numeric, text, uuid, uuid),
  public.atribuir_tarefas(uuid[], uuid, uuid, boolean),
  public.propor_regra(uuid, text, text, jsonb, text, text, date, date, uuid),
  public.propor_revogacao(uuid, text, text, date, text, text, date, date),
  public.validar_atualizacao_normativa(uuid, text),
  public.rejeitar_atualizacao_normativa(uuid, text),
  public.aplicar_atualizacao_normativa(uuid),
  public.operacional_empresas(),
  public.calendario_empresa(uuid, date),
  public.simular_regra(jsonb, text, date, int, uuid, text, text)
to authenticated;
grant execute on function public.rotina_operacional() to service_role;
