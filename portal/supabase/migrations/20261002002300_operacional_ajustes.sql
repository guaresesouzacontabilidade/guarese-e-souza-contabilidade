-- =============================================================================
-- Camada operacional — ajustes de modelagem
--
-- - Lucro Real: forma de apuração (trimestral ou anual por estimativa) no
--   histórico de regimes; regras podem exigir uma das formas.
-- - Folha: empresa com pró-labore (além de empregados); regras podem exigir
--   "folha" (empregados ou pró-labore).
-- - Feriados considerados por regra: só nacionais (declarações e guias
--   federais), nacionais + estaduais, ou também municipais.
-- - Prazo interno contado no calendário do escritório (onde a equipe trabalha).
-- - Regra em vigor ainda sem prazo regulamentado (ex.: CBS/IBS) aparece como
--   "prazo a regulamentar" e não gera datas.
-- - Proposta pode ser corrigida antes da validação; rejeitada deixa de valer.
-- =============================================================================

alter table public.obrigacoes drop constraint if exists obrigacoes_esfera_check;
alter table public.obrigacoes add constraint obrigacoes_esfera_check check (esfera in ('federal', 'nacional', 'estadual', 'municipal'));

-- Lucro Real: trimestral ou anual (estimativa mensal), por período do histórico
alter table public.empresa_regimes
  add column lucro_real_apuracao text check (lucro_real_apuracao in ('trimestral', 'anual')),
  add constraint empresa_regimes_lucro_real check (regime = 'lucro_real' or lucro_real_apuracao is null);

alter table public.obrigacao_regras
  add column lucro_real_apuracao text check (lucro_real_apuracao in ('trimestral', 'anual')),
  add column exige_folha boolean not null default false;

alter table public.empresas add column tem_pro_labore boolean not null default false;
grant update (tem_pro_labore) on public.empresas to authenticated;

create or replace function app.lucro_real_apuracao_em(p_empresa_id uuid, p_competencia date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.lucro_real_apuracao from public.empresa_regimes r
   where r.empresa_id = p_empresa_id and r.inicio <= p_competencia and (r.fim is null or r.fim >= p_competencia)
   order by r.inicio desc limit 1;
$$;

-- Dados fiscais (inclui pró-labore) só pelo escritório
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
    or new.tem_pro_labore is distinct from old.tem_pro_labore
    or new.servicos is distinct from old.servicos) then
    raise exception 'Somente o escritório altera o regime, o município e os dados fiscais da empresa.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Regra de prazo: abrangência dos feriados
--   "feriados": "nacional" | "estadual" | "municipal" (padrão: municipal)
-- -----------------------------------------------------------------------------
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
      and coalesce(p ->> 'calendario', 'dia_util') in ('dia_util', 'expediente_bancario')
      and coalesce(p ->> 'feriados', 'municipal') in ('nacional', 'estadual', 'municipal'),
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
  v_uf text;
  v_mun text;
  k int := 0;
begin
  if p_regra is null or jsonb_typeof(p_regra) <> 'object' then
    return null;
  end if;
  v_uf := case when coalesce(p_regra ->> 'feriados', 'municipal') in ('estadual', 'municipal') then p_uf end;
  v_mun := case when coalesce(p_regra ->> 'feriados', 'municipal') = 'municipal' then p_municipio end;
  v_mes := (date_trunc('month', p_competencia) + make_interval(months => (p_regra ->> 'meses_apos')::int))::date;
  v_fim := (v_mes + interval '1 month - 1 day')::date;
  v_bancario := coalesce(p_regra ->> 'calendario', 'dia_util') = 'expediente_bancario';
  if p_regra ->> 'tipo' = 'dia_fixo' then
    v_dia := least(v_mes + ((p_regra ->> 'dia')::int - 1), v_fim);
    return app.ajustar_dia_util(v_dia, p_regra ->> 'ajuste', v_uf, v_mun, v_bancario);
  elsif p_regra ->> 'tipo' = 'dia_util' then
    v_n := (p_regra ->> 'dia')::int;
    v_dia := v_mes;
    while v_dia <= v_fim loop
      if app.e_dia_util(v_dia, v_uf, v_mun, v_bancario) then
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
      if app.e_dia_util(v_dia, v_uf, v_mun, v_bancario) then
        return v_dia;
      end if;
      v_dia := v_dia - 1;
    end loop;
    return null;
  end if;
end;
$$;

-- Local do escritório (o prazo interno segue os dias úteis de quem executa)
create or replace function app.local_escritorio(out uf text, out municipio_ibge text)
language sql
stable
security definer
set search_path = ''
as $$
  select upper(nullif(trim(e.uf), '')),
         (select m.ibge from public.municipios m
           where m.uf = upper(e.uf) and app.normalizar(m.nome) = app.normalizar(trim(e.cidade)) limit 1)
    from public.escritorio e
   where e.id = 1;
$$;

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
  v_esc record;
begin
  select * into v_esc from app.local_escritorio();
  prazo_legal := case p_etapa when 'entrega' then v_entrega when 'pagamento' then v_pagamento end;
  if prazo_legal is not null then
    prazo_interno := app.dias_uteis_antes(prazo_legal, p_dias_internos, v_esc.uf, v_esc.municipio_ibge);
  elsif p_etapa = 'apuracao' and p_regra.prazo_apuracao is not null then
    prazo_interno := app.calcular_prazo(p_regra.prazo_apuracao, p_competencia, v_esc.uf, v_esc.municipio_ibge);
  elsif p_etapa = 'apuracao' and coalesce(v_entrega, v_pagamento) is not null then
    prazo_interno := app.dias_uteis_antes(least(coalesce(v_entrega, v_pagamento), coalesce(v_pagamento, v_entrega)),
                                          p_dias_internos + 2, v_esc.uf, v_esc.municipio_ibge);
  end if;
end;
$$;

-- Aplicabilidade: inclui a forma de apuração do Lucro Real e a folha
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
          and (x.lucro_real_apuracao is null or p_regime <> 'lucro_real'
               or x.lucro_real_apuracao = app.lucro_real_apuracao_em(e.id, p_competencia))
          and (not x.exige_empregados or e.tem_empregados)
          and (not x.exige_folha or e.tem_empregados or e.tem_pro_labore)
          and (not x.exige_icms or e.contribuinte_icms)
          and (not x.exige_iss or e.contribuinte_iss)
          and (x.servico is null or x.servico = any (e.servicos))));
$$;

-- -----------------------------------------------------------------------------
-- Propostas: novos campos, correção antes da validação e rejeição
-- -----------------------------------------------------------------------------
create or replace function app.preencher_regra(r inout public.obrigacao_regras, p_regra jsonb)
language plpgsql
stable
set search_path = ''
as $$
begin
  if not app.prazo_valido(p_regra -> 'prazo_entrega') or not app.prazo_valido(p_regra -> 'prazo_pagamento')
     or not app.prazo_valido(p_regra -> 'prazo_apuracao') then
    raise exception 'Regra de prazo incompleta ou inválida.';
  end if;
  if p_regra ->> 'vigencia_inicio' is null then
    raise exception 'Informe o início da vigência.';
  end if;
  if coalesce(jsonb_array_length(p_regra -> 'regimes'), 0) = 0 then
    raise exception 'Informe ao menos um regime em que a regra se aplica.';
  end if;
  r.vigencia_inicio := app.competencia_de((p_regra ->> 'vigencia_inicio')::date);
  r.vigencia_fim := app.competencia_de(nullif(p_regra ->> 'vigencia_fim', '')::date);
  r.regimes := array(select jsonb_array_elements_text(p_regra -> 'regimes'));
  r.ufs := nullif(array(select upper(jsonb_array_elements_text(coalesce(p_regra -> 'ufs', '[]'::jsonb)))), array[]::text[]);
  r.municipios := nullif(array(select jsonb_array_elements_text(coalesce(p_regra -> 'municipios', '[]'::jsonb))), array[]::text[]);
  r.empresa_id := app.try_uuid(p_regra ->> 'empresa_id');
  r.exige_empregados := coalesce((p_regra ->> 'exige_empregados')::boolean, false);
  r.exige_folha := coalesce((p_regra ->> 'exige_folha')::boolean, false);
  r.exige_icms := coalesce((p_regra ->> 'exige_icms')::boolean, false);
  r.exige_iss := coalesce((p_regra ->> 'exige_iss')::boolean, false);
  r.lucro_real_apuracao := nullif(p_regra ->> 'lucro_real_apuracao', '');
  r.servico := nullif(p_regra ->> 'servico', '');
  r.prazo_entrega := nullif(p_regra -> 'prazo_entrega', 'null'::jsonb);
  r.prazo_pagamento := nullif(p_regra -> 'prazo_pagamento', 'null'::jsonb);
  r.prazo_apuracao := nullif(p_regra -> 'prazo_apuracao', 'null'::jsonb);
  r.prazo_interno_dias_uteis := coalesce((p_regra ->> 'prazo_interno_dias_uteis')::int, 2);
  r.observacao := nullif(trim(coalesce(p_regra ->> 'observacao', '')), '');
end;
$$;

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
  r public.obrigacao_regras;
  v_id uuid;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if coalesce(trim(p_fonte_titulo), '') = '' or p_fonte_consultada_em is null then
    raise exception 'Informe a fonte oficial e a data em que foi consultada.';
  end if;
  if p_regra_anterior_id is not null and not exists (
    select 1 from public.obrigacao_regras x where x.id = p_regra_anterior_id and x.obrigacao_id = p_obrigacao_id and x.status = 'validada') then
    raise exception 'A regra a substituir precisa ser uma regra validada desta obrigação.';
  end if;
  r := app.preencher_regra(r, p_regra);
  insert into public.obrigacao_regras (
    obrigacao_id, vigencia_inicio, vigencia_fim, regimes, ufs, municipios, empresa_id,
    exige_empregados, exige_folha, exige_icms, exige_iss, lucro_real_apuracao, servico,
    prazo_entrega, prazo_pagamento, prazo_apuracao, prazo_interno_dias_uteis,
    fonte_titulo, fonte_url, fonte_consultada_em, observacao, status)
  values (
    p_obrigacao_id, r.vigencia_inicio, r.vigencia_fim, r.regimes, r.ufs, r.municipios, r.empresa_id,
    r.exige_empregados, r.exige_folha, r.exige_icms, r.exige_iss, r.lucro_real_apuracao, r.servico,
    r.prazo_entrega, r.prazo_pagamento, r.prazo_apuracao, r.prazo_interno_dias_uteis,
    trim(p_fonte_titulo), nullif(trim(coalesce(p_fonte_url, '')), ''), p_fonte_consultada_em, r.observacao, 'rascunho')
  returning id into r.id;
  insert into public.atualizacoes_normativas (titulo, resumo, tipo, obrigacao_id, regra_anterior_id, regra_proposta_id, vigencia_inicio,
                                              fonte_titulo, fonte_url, fonte_publicada_em, fonte_consultada_em)
  values (trim(p_titulo), nullif(trim(coalesce(p_resumo, '')), ''), case when p_regra_anterior_id is null then 'nova_regra' else 'alteracao_regra' end,
          p_obrigacao_id, p_regra_anterior_id, r.id, r.vigencia_inicio, trim(p_fonte_titulo), nullif(trim(coalesce(p_fonte_url, '')), ''),
          p_fonte_publicada_em, p_fonte_consultada_em)
  returning id into v_id;
  return v_id;
end;
$$;

-- Correção da proposta (antes da validação)
create or replace function public.editar_proposta_regra(
  p_id uuid,
  p_titulo text,
  p_resumo text,
  p_regra jsonb,
  p_fonte_titulo text,
  p_fonte_url text,
  p_fonte_publicada_em date,
  p_fonte_consultada_em date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.atualizacoes_normativas;
  r public.obrigacao_regras;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into a from public.atualizacoes_normativas where id = p_id for update;
  if a.id is null or a.status <> 'proposta' or a.regra_proposta_id is null then
    raise exception 'Somente propostas ainda não validadas podem ser corrigidas.';
  end if;
  if coalesce(trim(p_fonte_titulo), '') = '' or p_fonte_consultada_em is null then
    raise exception 'Informe a fonte oficial e a data em que foi consultada.';
  end if;
  select * into r from public.obrigacao_regras where id = a.regra_proposta_id;
  r := app.preencher_regra(r, p_regra);
  update public.obrigacao_regras
     set vigencia_inicio = r.vigencia_inicio, vigencia_fim = r.vigencia_fim, regimes = r.regimes, ufs = r.ufs, municipios = r.municipios,
         empresa_id = r.empresa_id, exige_empregados = r.exige_empregados, exige_folha = r.exige_folha, exige_icms = r.exige_icms,
         exige_iss = r.exige_iss, lucro_real_apuracao = r.lucro_real_apuracao, servico = r.servico,
         prazo_entrega = r.prazo_entrega, prazo_pagamento = r.prazo_pagamento, prazo_apuracao = r.prazo_apuracao,
         prazo_interno_dias_uteis = r.prazo_interno_dias_uteis, observacao = r.observacao,
         fonte_titulo = trim(p_fonte_titulo), fonte_url = nullif(trim(coalesce(p_fonte_url, '')), ''), fonte_consultada_em = p_fonte_consultada_em
   where id = r.id;
  update public.atualizacoes_normativas
     set titulo = trim(p_titulo), resumo = nullif(trim(coalesce(p_resumo, '')), ''), vigencia_inicio = r.vigencia_inicio,
         fonte_titulo = trim(p_fonte_titulo), fonte_url = nullif(trim(coalesce(p_fonte_url, '')), ''),
         fonte_publicada_em = p_fonte_publicada_em, fonte_consultada_em = p_fonte_consultada_em
   where id = p_id;
end;
$$;

-- Rejeição: a regra proposta deixa de contar como "aguardando validação"
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
  if a.regra_proposta_id is not null then
    update public.obrigacao_regras set status = 'revogada' where id = a.regra_proposta_id and status = 'rascunho';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Calendário da empresa (com "prazo a regulamentar" e cadastro incompleto)
-- -----------------------------------------------------------------------------
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
  v_lr text;
  v_ini date;
  v_fim date;
  v_incluida boolean;
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into e from public.empresas where id = p_empresa_id;
  v_regime := app.regime_em(e.id, v_comp);
  v_lr := app.lucro_real_apuracao_em(e.id, v_comp);
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
      elsif r.prazo_entrega is null and r.prazo_pagamento is null and r.prazo_apuracao is null then
        situacao := 'sem_prazo';
        motivo := 'Em vigor, mas o prazo ainda depende de regulamentação.' || coalesce(' ' || r.observacao, '');
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
    elsif v_regime = 'lucro_real' and v_lr is null and exists (
            select 1 from public.obrigacao_regras x where x.obrigacao_id = o.id and x.status in ('rascunho', 'validada')
               and x.lucro_real_apuracao is not null and 'lucro_real' = any (x.regimes)
               and x.vigencia_inicio <= v_comp and (x.vigencia_fim is null or x.vigencia_fim >= v_comp)) then
      situacao := 'falta_cadastro';
      motivo := 'Informe no regime da empresa se o Lucro Real é apurado de forma trimestral ou anual.';
    elsif exists (select 1 from public.obrigacao_regras x where x.obrigacao_id = o.id and x.status in ('rascunho', 'validada')
                   and app.regra_casa(x, e, v_regime, v_comp, true)) then
      situacao := 'nao_aplica';
      motivo := 'Não se aplica ao regime ou ao cadastro da empresa nesta competência.';
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
        motivo := case o.esfera when 'estadual' then 'Sem regra validada para ' || coalesce(e.uf, 'o estado') || '. Cadastre a regra com a fonte oficial.'
                                when 'municipal' then 'Sem regra validada para o município da empresa. Cadastre a regra com a fonte oficial.'
                                else 'Sem regra validada. Cadastre a regra com a fonte oficial.' end;
      end if;
    end if;
    return next;
  end loop;
end;
$$;

revoke execute on function public.editar_proposta_regra(uuid, text, text, jsonb, text, text, date, date) from public, anon;
grant execute on function public.editar_proposta_regra(uuid, text, text, jsonb, text, text, date, date) to authenticated;
