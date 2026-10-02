-- =============================================================================
-- Camada operacional — funções de apoio às telas
--
-- - Mudança de regime a partir de uma competência (fecha o período anterior).
-- - Sincronização das tarefas de uma empresa depois de mudanças no cadastro,
--   no regime ou no calendário (inclusões/exclusões): recalcula prazos das
--   tarefas abertas, dispensa (com motivo) as que deixaram de se aplicar e gera
--   as que passaram a valer.
-- - Recálculo geral das tarefas abertas (ex.: depois de cadastrar um feriado).
-- =============================================================================

create or replace function public.registrar_regime(
  p_empresa_id uuid,
  p_regime text,
  p_inicio date,
  p_lucro_real_apuracao text default null,
  p_observacao text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio date := app.competencia_de(p_inicio);
  v_atual public.empresa_regimes;
  v_id uuid;
begin
  if not (app.equipe_ve_empresa(p_empresa_id) and app.pode(p_empresa_id, 'empresa.editar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_regime is null or not (p_regime = any (app.regimes_validos())) then
    raise exception 'Regime inválido.';
  end if;
  if p_regime = 'lucro_real' and coalesce(p_lucro_real_apuracao, '') not in ('trimestral', 'anual') then
    raise exception 'No Lucro Real, informe se a apuração é trimestral ou anual.';
  end if;
  if exists (select 1 from public.empresa_regimes r where r.empresa_id = p_empresa_id and r.inicio > v_inicio) then
    raise exception 'Há regime cadastrado depois desta competência. Ajuste o histórico antes de registrar a mudança.';
  end if;
  select * into v_atual from public.empresa_regimes r
   where r.empresa_id = p_empresa_id and r.inicio <= v_inicio and (r.fim is null or r.fim >= v_inicio)
   order by r.inicio desc limit 1;
  if v_atual.id is not null and v_atual.inicio = v_inicio then
    update public.empresa_regimes
       set regime = p_regime,
           lucro_real_apuracao = case when p_regime = 'lucro_real' then p_lucro_real_apuracao end,
           observacao = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), observacao)
     where id = v_atual.id
    returning id into v_id;
  else
    if v_atual.id is not null then
      update public.empresa_regimes set fim = (v_inicio - interval '1 month')::date where id = v_atual.id;
    end if;
    insert into public.empresa_regimes (empresa_id, regime, inicio, lucro_real_apuracao, observacao)
    values (p_empresa_id, p_regime, v_inicio, case when p_regime = 'lucro_real' then p_lucro_real_apuracao end,
            nullif(trim(coalesce(p_observacao, '')), ''))
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Recalcula as tarefas abertas (de uma empresa, de uma obrigação ou de todas)
create or replace function app.recalcular_abertas(p_empresa_id uuid, p_obrigacao_id uuid, p_motivo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  cfg public.empresa_obrigacoes;
  r public.obrigacao_regras;
  v_legal date;
  v_interno date;
  v_qtd int := 0;
begin
  for t in
    select x.*, e.uf, e.municipio_ibge, o.etapas
      from public.tarefas x
      join public.empresas e on e.id = x.empresa_id
      join public.obrigacoes o on o.id = x.obrigacao_id
     where (p_empresa_id is null or x.empresa_id = p_empresa_id)
       and (p_obrigacao_id is null or x.obrigacao_id = p_obrigacao_id)
       and x.status not in ('concluida', 'dispensada')
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
        from app.prazos_da_etapa(t.etapas, r, t.etapa, t.competencia, t.uf, t.municipio_ibge,
                                 coalesce(cfg.prazo_interno_dias_uteis, r.prazo_interno_dias_uteis)) x;
    end if;
    if v_interno is null then
      update public.tarefas
         set status = 'dispensada',
             dispensa_motivo = left(case when cfg.modo = 'excluida' then 'Obrigação excluída para a empresa: ' || cfg.motivo
                                         else coalesce(p_motivo, 'A obrigação deixou de se aplicar à empresa nesta competência.') end, 500)
       where id = t.id;
      insert into public.tarefa_historico (tarefa_id, empresa_id, acao, status_anterior, status_novo, comentario)
      values (t.id, t.empresa_id, 'dispensada_automaticamente', t.status, 'dispensada', p_motivo);
      v_qtd := v_qtd + 1;
      continue;
    end if;
    if v_legal is distinct from t.prazo_legal or v_interno is distinct from t.prazo_interno or r.id is distinct from t.regra_id
       or coalesce(cfg.revisor_id, t.revisor_id) is distinct from t.revisor_id then
      update public.tarefas
         set prazo_legal = v_legal, prazo_interno = v_interno, regra_id = r.id,
             revisor_id = coalesce(cfg.revisor_id, revisor_id)
       where id = t.id;
      insert into public.tarefa_historico (tarefa_id, empresa_id, acao, comentario, detalhes)
      values (t.id, t.empresa_id, 'prazo_recalculado', p_motivo,
              jsonb_build_object('prazo_legal_anterior', t.prazo_legal, 'prazo_legal', v_legal, 'prazo_interno_anterior', t.prazo_interno, 'prazo_interno', v_interno));
      v_qtd := v_qtd + 1;
    end if;
  end loop;
  return v_qtd;
end;
$$;

-- Depois de mudar cadastro, regime ou calendário da empresa
create or replace function public.sincronizar_tarefas_empresa(p_empresa_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recalc int;
  v_geradas int := 0;
  c date;
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  v_recalc := app.recalcular_abertas(p_empresa_id, null, coalesce(p_motivo, 'Cadastro ou calendário da empresa alterado.'));
  c := (app.competencia_de(app.hoje()) - interval '12 months')::date;
  while c <= app.competencia_de(app.hoje()) loop
    v_geradas := v_geradas + app.gerar_tarefas_empresa(p_empresa_id, c, app.hoje() - 30);
    c := (c + interval '1 month')::date;
  end loop;
  if v_recalc + v_geradas > 0 then
    perform app.registrar_auditoria('sincronizar_tarefas', 'tarefas', null, p_empresa_id,
                                    jsonb_build_object('recalculadas', v_recalc, 'geradas', v_geradas, 'motivo', p_motivo));
  end if;
  return jsonb_build_object('tarefas_recalculadas', v_recalc, 'tarefas_geradas', v_geradas);
end;
$$;

-- Depois de cadastrar ou remover feriados (administrador)
create or replace function public.recalcular_tarefas_abertas(p_motivo text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  v := app.recalcular_abertas(null, null, coalesce(p_motivo, 'Calendário de feriados atualizado.'));
  perform app.registrar_auditoria('recalcular_tarefas', 'tarefas', null, null, jsonb_build_object('recalculadas', v, 'motivo', p_motivo));
  return v;
end;
$$;

revoke execute on function
  public.registrar_regime(uuid, text, date, text, text),
  public.sincronizar_tarefas_empresa(uuid, text),
  public.recalcular_tarefas_abertas(text)
from public, anon;
grant execute on function
  public.registrar_regime(uuid, text, date, text, text),
  public.sincronizar_tarefas_empresa(uuid, text),
  public.recalcular_tarefas_abertas(text)
to authenticated;
