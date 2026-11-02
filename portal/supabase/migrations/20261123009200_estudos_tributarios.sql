-- =============================================================================
-- Robô de planejamento tributário: estudos automáticos de cada empresa
--
--  * Toda noite (e quando a equipe pede "Rodar agora") o robô estuda cada
--    empresa com os dados do portal: regime mais barato, Fator R, imposto pago
--    a mais (achados do auditor fiscal) e limite do Simples Nacional.
--  * estudo_oportunidades: o resultado de cada estudo (um por empresa e tipo),
--    com a conta explicada, o que falta e a revisão da equipe (aprovar,
--    descartar com motivo, apresentar ao cliente). Só a equipe vê.
--  * estudo_execucoes: cada vez que o robô rodou (noite ou manual).
--  * As premissas do comparativo (margem de lucro e ICMS médio) passam a ficar
--    guardadas na configuração dos cálculos da empresa.
--  * app.dados_previsao: os mesmos dados de public.dados_previsao_impostos,
--    sem a checagem de permissão, para o robô (servidor) usar à noite. A função
--    pública continua exigindo a permissão de quem consulta.
-- =============================================================================

alter table public.calculo_parametros
  add column margem_lucro numeric(6, 2) check (margem_lucro is null or margem_lucro between -100 and 100),
  add column aliquota_icms_media numeric(5, 2) check (aliquota_icms_media is null or aliquota_icms_media between 0 and 40);

-- -----------------------------------------------------------------------------
-- Dados da previsão sem checagem de permissão (uso interno do servidor)
-- -----------------------------------------------------------------------------
create or replace function app.dados_previsao(p_empresa_id uuid, p_competencia date, p_meses int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  -- 12 meses anteriores (previsão) ou 24 (comparativo de regimes: RBT12 de cada um dos 12 meses)
  v_inicio date := (date_trunc('month', p_competencia) - make_interval(months => least(greatest(coalesce(p_meses, 12), 12), 24)))::date;
  v_emp public.empresas;
  v_meses jsonb;
  v_checklist jsonb;
begin
  select * into v_emp from public.empresas where id = p_empresa_id;

  with notas as (
    select df.*
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
     where df.empresa_id = p_empresa_id
       and df.competencia between v_inicio and v_comp
       and df.relacionado_empresa
       and not df.cancelada_evento
       and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
       and d.excluido_em is null
       and coalesce(d.verificacao_status, '') <> 'bloqueado'
       and not (df.avisos::text ilike '%registro de cancelamento%')
  ),
  itens as (
    select n.competencia, n.operacao, i.cfop,
           coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor,
           coalesce(app.try_numeric(i.tributos ->> 'icms'), 0) as icms,
           -- Crédito de PIS/Cofins (não cumulativo) só na compra de pessoa jurídica com as contribuições:
           -- sem crédito na compra de pessoa física (produtor rural) nem na compra com CST de saída sem
           -- PIS/Cofins (04 a 09) ou de entrada sem direito a crédito (70 a 75)
           (length(regexp_replace(coalesce(case when upper(regexp_replace(coalesce(n.emitente_documento, ''), '[^0-9A-Za-z]', '', 'g')) = upper(v_emp.documento)
                                                 then n.destinatario_documento else n.emitente_documento end, ''), '[^0-9A-Za-z]', '', 'g')) <> 11
            and coalesce(i.tributos ->> 'cst_pis', '') not in ('04', '05', '06', '07', '08', '09', '70', '71', '72', '73', '74', '75')) as credita_pis_cofins
      from notas n
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
     where n.modelo in ('55', '65')
  ),
  servicos as (
    select n.competencia,
           coalesce(n.valor_servicos, n.valor_total, 0) as valor,
           n.tributos ? 'iss_retido' as retido,
           app.try_numeric(n.tributos ->> 'iss') as iss
      from notas n
     where n.operacao = 'saida' and n.modelo in ('nfse_nacional', 'nfse_abrasf', '57')
  ),
  meses as (
    select g::date as competencia from generate_series(v_inicio, v_comp, interval '1 month') g
  )
  select jsonb_agg(jsonb_build_object(
           'competencia', m.competencia,
           'vendas', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'vendas_st', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda_st(i.cfop)),
           'icms_vendas', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'servicos_nfe', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_servico(i.cfop)),
           'devolucoes', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'icms_devolucoes', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'compras', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop)),
           'icms_compras', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop)),
           'compras_credito_pis', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop) and i.credita_pis_cofins),
           'icms_compras_credito_pis', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop) and i.credita_pis_cofins),
           'servicos', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia),
           'servicos_retido', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'iss_destacado', (select coalesce(sum(iss), 0) from servicos s where s.competencia = m.competencia and not s.retido),
           'servicos_sem_iss', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and not s.retido and s.iss is null),
           'iss_retido', (select coalesce(sum(iss), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'icms_debito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'icms')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'saida' and n.modelo in ('55', '65')),
           'icms_credito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'icms')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'entrada' and n.modelo in ('55', '57')),
           'ipi_debito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'ipi')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'saida' and n.modelo = '55'),
           'ipi_credito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'ipi')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'entrada' and n.modelo = '55'),
           'notas_saida', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'saida'),
           'notas_entrada', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'entrada'),
           'informado', (select jsonb_build_object('receita_mercadorias', cm.receita_mercadorias, 'receita_servicos', cm.receita_servicos,
                                                   'folha_fator_r', cm.folha_fator_r, 'observacao', cm.observacao)
                           from public.calculo_meses cm where cm.empresa_id = p_empresa_id and cm.competencia = m.competencia)
         ) order by m.competencia)
    into v_meses
    from meses m;

  select jsonb_build_object(
           'itens', count(*),
           'obrigatorios', count(*) filter (where c.obrigatorio),
           'faltantes', coalesce(jsonb_agg(jsonb_build_object('titulo', c.titulo, 'status', c.status, 'prazo', c.prazo) order by c.prazo, c.titulo)
                                   filter (where c.obrigatorio and c.status in ('pendente', 'correcao')), '[]'::jsonb)
         )
    into v_checklist
    from public.checklist_itens c
   where c.empresa_id = p_empresa_id and c.competencia = v_comp;

  return jsonb_build_object(
    'competencia', v_comp,
    'empresa', jsonb_build_object(
      'nome', coalesce(nullif(trim(v_emp.nome_fantasia), ''), v_emp.razao_social),
      'regime', app.regime_em(p_empresa_id, v_comp),
      'lucro_real_apuracao', app.lucro_real_apuracao_em(p_empresa_id, v_comp),
      'contribuinte_icms', v_emp.contribuinte_icms,
      'contribuinte_iss', v_emp.contribuinte_iss,
      'tem_empregados', v_emp.tem_empregados,
      'tem_pro_labore', v_emp.tem_pro_labore,
      'uf', v_emp.uf
    ),
    'parametros', (select to_jsonb(p) - 'atualizado_por' - 'created_at' from public.calculo_parametros p where p.empresa_id = p_empresa_id),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'checklist', v_checklist,
    -- Folha: só valores e datas (sem nomes)
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object('admissao', c.admissao, 'desligamento', c.desligamento, 'salario', c.salario,
                                          'adicionais', c.adicionais, 'dependentes_ir', c.dependentes_ir))
        from public.colaboradores c
       where c.empresa_id = p_empresa_id
         and c.admissao <= (v_comp + interval '1 month' - interval '1 day')::date
         and (c.desligamento is null or c.desligamento >= v_inicio)
    ), '[]'::jsonb),
    'ajustes', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'descricao', a.descricao, 'valor', a.valor, 'observacao', a.observacao) order by a.created_at)
        from public.calculo_ajustes a
       where a.empresa_id = p_empresa_id and a.competencia = v_comp
    ), '[]'::jsonb),
    -- Vencimentos calculados pelo módulo de obrigações (regras validadas) e
    -- o valor da guia, quando o escritório já a publicou.
    'vencimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', o.codigo,
               'vencimento', t.prazo_legal,
               'valor_guia', case when gd.publicado_em is not null and gd.excluido_em is null then t.valor end,
               'concluida', t.status = 'concluida'))
        from public.tarefas t
        join public.obrigacoes o on o.id = t.obrigacao_id
        left join public.documentos gd on gd.id = t.guia_documento_id
       where t.empresa_id = p_empresa_id and t.competencia = v_comp and t.etapa = 'pagamento' and t.status <> 'dispensada'
    ), '[]'::jsonb),
    'guias_publicadas', (
      select count(*) from public.documentos d
       where d.empresa_id = p_empresa_id and d.competencia = v_comp and d.categoria_codigo = 'esc_guia'
         and d.publicado_em is not null and d.excluido_em is null
    )
  );
end;
$$;

revoke execute on function app.dados_previsao(uuid, date, int) from public, anon, authenticated;

create or replace function public.dados_previsao_impostos(p_empresa_id uuid, p_competencia date, p_meses int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'calculos.ver');
  return app.dados_previsao(p_empresa_id, p_competencia, p_meses);
end;
$$;
revoke execute on function public.dados_previsao_impostos(uuid, date, int) from public, anon;
grant execute on function public.dados_previsao_impostos(uuid, date, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Resultado dos estudos (um por empresa e tipo)
-- -----------------------------------------------------------------------------
create table public.estudo_oportunidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('regime', 'fator_r', 'imposto_pago_a_mais', 'limite_simples')),
  -- oportunidade: dá para economizar; alerta: risco (ex.: limite do Simples);
  -- nada_a_fazer: estudado e sem ganho; faltam_dados: não dá para estudar ainda
  estado text not null check (estado in ('oportunidade', 'alerta', 'nada_a_fazer', 'faltam_dados')),
  titulo text not null check (length(titulo) between 3 and 200),
  resumo text not null check (length(resumo) between 3 and 2000),
  -- Economia estimada por ano (oportunidade) e valor a recuperar de uma vez (imposto pago a mais)
  economia_anual numeric(15, 2),
  valor_unico numeric(15, 2),
  -- Conta explicada passo a passo, premissas e fontes
  detalhes jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhes) = 'object' and pg_column_size(detalhes) <= 60000),
  faltando text[] not null default array[]::text[],
  -- Revisão da equipe
  situacao text not null default 'nova' check (situacao in ('nova', 'aprovada', 'descartada', 'apresentada')),
  motivo text check (motivo is null or length(motivo) <= 1000),
  revisado_por uuid references public.perfis(id) on delete set null,
  revisado_em timestamptz,
  valor_na_revisao numeric(15, 2),
  apresentado_em timestamptz,
  detectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint estudo_oportunidades_unica unique (empresa_id, tipo)
);
create index estudo_oportunidades_estado_idx on public.estudo_oportunidades (estado, situacao);
create trigger auditoria_estudo_oportunidades after update of situacao, motivo on public.estudo_oportunidades
  for each row execute function app.tg_auditoria();

create table public.estudo_execucoes (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  origem text not null check (origem in ('noite', 'manual')),
  pedido_por uuid references public.perfis(id) on delete set null,
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'concluida', 'erro')),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  resumo jsonb,
  erro text check (erro is null or length(erro) <= 1000)
);
create index estudo_execucoes_empresa_idx on public.estudo_execucoes (empresa_id, iniciado_em desc);

alter table public.estudo_oportunidades enable row level security;
alter table public.estudo_execucoes enable row level security;
create policy estudo_oportunidades_leitura on public.estudo_oportunidades for select to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)));
create policy estudo_execucoes_leitura on public.estudo_execucoes for select to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)));
grant select on public.estudo_oportunidades, public.estudo_execucoes to authenticated;

-- -----------------------------------------------------------------------------
-- Dados para o robô (servidor): previsão de 24 meses e achados do auditor
-- -----------------------------------------------------------------------------
create or replace function public.estudo_dados(p_empresa_id uuid, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.empresas e where e.id = p_empresa_id) then
    raise exception 'Empresa não encontrada.';
  end if;
  return jsonb_build_object(
    'previsao', app.dados_previsao(p_empresa_id, p_ate, 24),
    'auditor', jsonb_build_object(
      'ultima_execucao', (select max(x.concluida_em) from public.auditor_execucoes x
                           where x.empresa_id = p_empresa_id and x.situacao = 'concluida'),
      'tem_notas', exists (select 1 from public.documentos_fiscais df
                            where df.empresa_id = p_empresa_id and df.relacionado_empresa
                              and (df.modelo in ('55', '65') or df.modelo like 'nfse%')
                              and df.competencia >= (date_trunc('month', app.hoje()) - interval '60 months')::date),
      'achados', coalesce((
        select jsonb_agg(jsonb_build_object('regra', a.regra, 'titulo', a.titulo, 'competencia', a.competencia,
                                            'valor', a.valor_estimado, 'situacao', a.situacao, 'confianca', a.confianca)
                         order by a.competencia desc)
          from public.auditor_achados a
         where a.empresa_id = p_empresa_id and a.tipo = 'oportunidade'
           and a.situacao in ('novo', 'confirmado', 'publicado') and coalesce(a.valor_estimado, 0) > 0
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Gravar o resultado do robô (servidor) e avisar a equipe só quando muda
-- -----------------------------------------------------------------------------
create or replace function public.estudo_registrar(
  p_empresa_id uuid, p_execucao_id bigint, p_origem text, p_estudos jsonb, p_pedir_auditor boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_ant public.estudo_oportunidades;
  v_estado text;
  v_valor numeric;
  v_valor_ant numeric;
  v_novas int := 0;
  v_mudaram int := 0;
  v_soma numeric := 0;
  v_exec bigint := p_execucao_id;
  v_nome text;
  v_resumo jsonb;
begin
  if jsonb_typeof(p_estudos) <> 'array' then
    raise exception 'Estudos inválidos.';
  end if;
  for e in select x from jsonb_array_elements(p_estudos) x
  loop
    select * into v_ant from public.estudo_oportunidades where empresa_id = p_empresa_id and tipo = e ->> 'tipo';
    v_estado := e ->> 'estado';
    v_valor := coalesce(nullif(e ->> 'economia_anual', '')::numeric, nullif(e ->> 'valor_unico', '')::numeric, 0);
    insert into public.estudo_oportunidades (empresa_id, tipo, estado, titulo, resumo, economia_anual, valor_unico, detalhes, faltando)
    values (p_empresa_id, e ->> 'tipo', v_estado, e ->> 'titulo', e ->> 'resumo',
            nullif(e ->> 'economia_anual', '')::numeric, nullif(e ->> 'valor_unico', '')::numeric,
            coalesce(e -> 'detalhes', '{}'::jsonb),
            coalesce((select array_agg(f) from jsonb_array_elements_text(coalesce(e -> 'faltando', '[]'::jsonb)) f), array[]::text[]))
    on conflict on constraint estudo_oportunidades_unica do update
      set estado = excluded.estado, titulo = excluded.titulo, resumo = excluded.resumo,
          economia_anual = excluded.economia_anual, valor_unico = excluded.valor_unico,
          detalhes = excluded.detalhes, faltando = excluded.faltando, atualizado_em = now(),
          -- Voltou a ser oportunidade/alerta depois de não ser: começa nova revisão
          detectado_em = case when public.estudo_oportunidades.estado not in ('oportunidade', 'alerta')
                                   and excluded.estado in ('oportunidade', 'alerta') then now()
                              else public.estudo_oportunidades.detectado_em end,
          situacao = case when public.estudo_oportunidades.estado not in ('oportunidade', 'alerta')
                               and excluded.estado in ('oportunidade', 'alerta') then 'nova'
                          else public.estudo_oportunidades.situacao end;
    if v_estado in ('oportunidade', 'alerta') then
      v_valor_ant := coalesce(v_ant.economia_anual, v_ant.valor_unico, 0);
      if v_ant.id is null or v_ant.estado not in ('oportunidade', 'alerta') then
        v_novas := v_novas + 1;
        v_soma := v_soma + v_valor;
      elsif abs(v_valor - v_valor_ant) >= greatest(v_valor_ant * 0.2, 500) then
        v_mudaram := v_mudaram + 1;
      end if;
    end if;
  end loop;

  if coalesce(p_pedir_auditor, false) then
    perform app.enfileirar('auditor_fiscal', jsonb_build_object('empresa_id', p_empresa_id, 'origem', 'automatica'), p_empresa_id,
                           'auditor:estudo:' || p_empresa_id::text || ':' || to_char(app.hoje(), 'YYYY-MM'), now(), 130);
  end if;

  v_resumo := jsonb_build_object('novas', v_novas, 'mudaram', v_mudaram, 'estudos', jsonb_array_length(p_estudos));
  if v_exec is null then
    insert into public.estudo_execucoes (empresa_id, origem, situacao, concluido_em, resumo)
    values (p_empresa_id, case when p_origem = 'manual' then 'manual' else 'noite' end, 'concluida', now(), v_resumo)
    returning id into v_exec;
  else
    update public.estudo_execucoes set situacao = 'concluida', concluido_em = now(), resumo = v_resumo, erro = null
     where id = v_exec and empresa_id = p_empresa_id;
  end if;

  if v_novas + v_mudaram > 0 then
    select coalesce(nullif(trim(nome_fantasia), ''), razao_social) into v_nome from public.empresas where id = p_empresa_id;
    perform app.notificar_equipe(
      p_empresa_id, 'estudo_tributario',
      'Robô tributário: ' || case when v_novas > 0
                                  then v_novas || case when v_novas = 1 then ' oportunidade nova' else ' oportunidades novas' end
                                  else 'oportunidade com valor diferente' end || ' — ' || coalesce(v_nome, ''),
      case when v_soma > 0 then 'Economia estimada de ' || app.moeda_br(v_soma) || ' para revisar.'
           else 'Há estudo para revisar no planejamento tributário da empresa.' end,
      '/escritorio/oportunidades/' || p_empresa_id::text,
      false
    );
  end if;
  return jsonb_build_object('novas', v_novas, 'mudaram', v_mudaram, 'execucao_id', v_exec);
end;
$$;

-- Erro do robô numa empresa (servidor)
create or replace function public.estudo_falhou(p_empresa_id uuid, p_execucao_id bigint, p_origem text, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_execucao_id is null then
    insert into public.estudo_execucoes (empresa_id, origem, situacao, concluido_em, erro)
    values (p_empresa_id, case when p_origem = 'manual' then 'manual' else 'noite' end, 'erro', now(), left(coalesce(p_erro, 'Erro'), 1000));
  else
    update public.estudo_execucoes set situacao = 'erro', concluido_em = now(), erro = left(coalesce(p_erro, 'Erro'), 1000)
     where id = p_execucao_id and empresa_id = p_empresa_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- "Rodar agora" (equipe): uma empresa ou todas as que a pessoa atende
-- -----------------------------------------------------------------------------
create or replace function public.estudo_rodar(p_empresa_id uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_exec bigint;
  n int := 0;
begin
  if not (app.is_admin() or app.is_equipe()) then
    raise exception 'Acesso negado.';
  end if;
  if p_empresa_id is not null and not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.';
  end if;
  for r in
    select e.id from public.empresas e
     where e.ativa and (p_empresa_id is null or e.id = p_empresa_id) and app.equipe_ve_empresa(e.id)
       -- Já na fila há menos de 10 minutos: não pede de novo
       and not exists (select 1 from public.estudo_execucoes x
                        where x.empresa_id = e.id and x.situacao = 'na_fila' and x.iniciado_em > now() - interval '10 minutes')
  loop
    insert into public.estudo_execucoes (empresa_id, origem, pedido_por, situacao)
    values (r.id, 'manual', auth.uid(), 'na_fila')
    returning id into v_exec;
    perform app.enfileirar('estudo_tributario', jsonb_build_object('empresa_id', r.id, 'execucao_id', v_exec, 'origem', 'manual'),
                           r.id, 'estudo:manual:' || v_exec::text, now(), 60);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Revisão da equipe: aprovar, descartar (com motivo), apresentar ao cliente, reabrir
-- -----------------------------------------------------------------------------
create or replace function public.estudo_revisar(p_id uuid, p_acao text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.estudo_oportunidades;
begin
  select * into v from public.estudo_oportunidades where id = p_id for update;
  if v.id is null or not app.equipe_ve_empresa(v.empresa_id) then
    raise exception 'Estudo não encontrado.';
  end if;
  if v.estado not in ('oportunidade', 'alerta') then
    raise exception 'Só oportunidades e alertas são revisados.';
  end if;
  if p_acao = 'aprovar' then
    update public.estudo_oportunidades
       set situacao = 'aprovada', motivo = nullif(trim(coalesce(p_motivo, '')), ''), revisado_por = auth.uid(), revisado_em = now(),
           valor_na_revisao = coalesce(economia_anual, valor_unico)
     where id = p_id;
  elsif p_acao = 'descartar' then
    if length(trim(coalesce(p_motivo, ''))) < 5 then
      raise exception 'Explique por que o estudo foi descartado (ex.: o cliente vai mudar de atividade).';
    end if;
    update public.estudo_oportunidades
       set situacao = 'descartada', motivo = left(trim(p_motivo), 1000), revisado_por = auth.uid(), revisado_em = now(),
           valor_na_revisao = coalesce(economia_anual, valor_unico)
     where id = p_id;
  elsif p_acao = 'apresentar' then
    if v.situacao not in ('aprovada', 'apresentada') then
      raise exception 'Aprove o estudo antes de apresentar ao cliente.';
    end if;
    update public.estudo_oportunidades set situacao = 'apresentada', apresentado_em = now() where id = p_id;
  elsif p_acao = 'reabrir' then
    update public.estudo_oportunidades
       set situacao = 'nova', motivo = null, revisado_por = null, revisado_em = null, valor_na_revisao = null, apresentado_em = null
     where id = p_id;
  else
    raise exception 'Ação inválida.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Premissas do comparativo guardadas na configuração dos cálculos
-- -----------------------------------------------------------------------------
create or replace function public.estudo_premissas_salvar(p_empresa_id uuid, p_margem_lucro numeric, p_aliquota_icms numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if p_margem_lucro is not null and (p_margem_lucro < -100 or p_margem_lucro > 100) then
    raise exception 'A margem de lucro deve ficar entre -100%% e 100%%.';
  end if;
  if p_aliquota_icms is not null and (p_aliquota_icms < 0 or p_aliquota_icms > 40) then
    raise exception 'O ICMS médio deve ficar entre 0%% e 40%%.';
  end if;
  update public.calculo_parametros
     set margem_lucro = p_margem_lucro, aliquota_icms_media = p_aliquota_icms, atualizado_por = auth.uid()
   where empresa_id = p_empresa_id;
  if not found then
    raise exception 'Configure os cálculos desta empresa primeiro (Cálculos → Configuração).';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rotina da noite: um estudo por empresa ativa (pela fila)
-- -----------------------------------------------------------------------------
create or replace function public.rotina_estudos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in select e.id from public.empresas e where e.ativa
  loop
    perform app.enfileirar('estudo_tributario', jsonb_build_object('empresa_id', r.id, 'origem', 'noite'), r.id,
                           'estudo:noite:' || r.id::text || ':' || to_char(app.hoje(), 'YYYY-MM-DD'), now(), 140);
    n := n + 1;
  end loop;
  return jsonb_build_object('agendados', n);
end;
$$;

revoke execute on function public.estudo_dados(uuid, date) from public, anon, authenticated;
revoke execute on function public.estudo_registrar(uuid, bigint, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.estudo_falhou(uuid, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.rotina_estudos() from public, anon, authenticated;
grant execute on function public.estudo_dados(uuid, date) to service_role;
grant execute on function public.estudo_registrar(uuid, bigint, text, jsonb, boolean) to service_role;
grant execute on function public.estudo_falhou(uuid, bigint, text, text) to service_role;
grant execute on function public.rotina_estudos() to service_role;

revoke execute on function public.estudo_rodar(uuid) from public, anon;
revoke execute on function public.estudo_revisar(uuid, text, text) from public, anon;
revoke execute on function public.estudo_premissas_salvar(uuid, numeric, numeric) from public, anon;
grant execute on function public.estudo_rodar(uuid) to authenticated;
grant execute on function public.estudo_revisar(uuid, text, text) to authenticated;
grant execute on function public.estudo_premissas_salvar(uuid, numeric, numeric) to authenticated;
