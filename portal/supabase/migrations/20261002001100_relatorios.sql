-- =============================================================================
-- Migração 1100: consultas para relatórios/painel e relatórios publicados
-- =============================================================================
-- Todas as consultas usam "security invoker": valem as políticas RLS do usuário.
-- Critérios:
--   * DRE gerencial por COMPETÊNCIA: lançamentos confirmados e não cancelados,
--     pela data de competência; juros, multas, descontos e taxas das baixas
--     reconhecidos na data do pagamento. Lançamentos sugeridos não entram.
--   * Fluxo de caixa REALIZADO: baixas e transferências pela data efetiva.
--   * Fluxo PROJETADO: saldo atual + lançamentos em aberto pelo vencimento.
-- =============================================================================

-- Linhas da DRE (valores positivos; o sinal é dado pelo tipo da categoria).
create or replace function public.relatorio_dre_linhas(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_centro_custo_id uuid default null,
  p_projeto_id uuid default null
)
returns table (
  mes date,
  origem text,
  categoria_id uuid,
  categoria_codigo text,
  categoria_nome text,
  tipo text,
  valor numeric,
  quantidade bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Lançamentos por competência
  select date_trunc('month', l.data_competencia)::date as mes,
         'lancamento' as origem,
         c.id, c.codigo, c.nome, c.tipo,
         sum(l.valor_previsto) as valor,
         count(*) as quantidade
    from public.lancamentos l
    join public.categorias_financeiras c on c.id = l.categoria_id
   where l.empresa_id = p_empresa_id
     and l.status_revisao = 'confirmado'
     and l.situacao <> 'cancelado'
     and l.data_competencia between p_inicio and p_fim
     and c.tipo in ('receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
                    'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro')
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
     and (p_projeto_id is null or l.projeto_id = p_projeto_id)
   group by 1, 2, 3, 4, 5, 6
  union all
  -- Ajustes das baixas (juros, multas, descontos e taxas) pela data do pagamento
  select date_trunc('month', a.data_pagamento)::date,
         'ajuste_baixa',
         c.id, c.codigo, c.nome, c.tipo,
         sum(a.valor), count(*)
    from (
      select b.empresa_id, b.data_pagamento, l.centro_custo_id, l.projeto_id,
             case
               when x.componente = 'juros' and b.tipo = 'receber' then 'JUROS_RECEBIDOS'
               when x.componente = 'juros' and b.tipo = 'pagar' then 'JUROS_PAGOS'
               when x.componente = 'desconto' and b.tipo = 'receber' then 'DESCONTOS_CONCEDIDOS'
               when x.componente = 'desconto' and b.tipo = 'pagar' then 'DESCONTOS_OBTIDOS'
               when x.componente = 'taxas' and b.tipo = 'receber' then 'TAXAS_CARTAO'
               else 'TARIFAS_BANCARIAS'
             end as codigo_sistema,
             x.valor
        from public.baixas b
        join public.lancamentos l on l.id = b.lancamento_id
        cross join lateral (values ('juros', b.juros + b.multa), ('desconto', b.desconto), ('taxas', b.taxas)) as x(componente, valor)
       where b.empresa_id = p_empresa_id
         and b.data_pagamento between p_inicio and p_fim
         and x.valor > 0
         and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
         and (p_projeto_id is null or l.projeto_id = p_projeto_id)
    ) a
    join public.categorias_financeiras c on c.empresa_id = a.empresa_id and c.codigo_sistema = a.codigo_sistema
   group by 1, 2, 3, 4, 5, 6;
$$;

-- Lançamentos que compõem uma linha/categoria da DRE (rastreabilidade).
create or replace function public.relatorio_dre_composicao(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_tipos text[],
  p_categoria_id uuid default null,
  p_centro_custo_id uuid default null
)
returns table (
  origem text,
  lancamento_id uuid,
  baixa_id uuid,
  data date,
  descricao text,
  categoria_nome text,
  tipo_categoria text,
  contraparte text,
  valor numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'lancamento', l.id, null::uuid, l.data_competencia, l.descricao, c.nome, c.tipo, cp.nome, l.valor_previsto
    from public.lancamentos l
    join public.categorias_financeiras c on c.id = l.categoria_id
    left join public.contrapartes cp on cp.id = l.contraparte_id
   where l.empresa_id = p_empresa_id
     and l.status_revisao = 'confirmado' and l.situacao <> 'cancelado'
     and l.data_competencia between p_inicio and p_fim
     and c.tipo = any(p_tipos)
     and (p_categoria_id is null or c.id = p_categoria_id)
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
  union all
  select 'ajuste_baixa', l.id, b.id, b.data_pagamento,
         l.descricao || ' — ' || x.rotulo, c.nome, c.tipo, cp.nome, x.valor
    from public.baixas b
    join public.lancamentos l on l.id = b.lancamento_id
    left join public.contrapartes cp on cp.id = l.contraparte_id
    cross join lateral (values
      ('juros/multa', b.juros + b.multa, case when b.tipo = 'receber' then 'JUROS_RECEBIDOS' else 'JUROS_PAGOS' end),
      ('desconto', b.desconto, case when b.tipo = 'receber' then 'DESCONTOS_CONCEDIDOS' else 'DESCONTOS_OBTIDOS' end),
      ('taxas', b.taxas, case when b.tipo = 'receber' then 'TAXAS_CARTAO' else 'TARIFAS_BANCARIAS' end)
    ) as x(rotulo, valor, codigo_sistema)
    join public.categorias_financeiras c on c.empresa_id = b.empresa_id and c.codigo_sistema = x.codigo_sistema
   where b.empresa_id = p_empresa_id
     and b.data_pagamento between p_inicio and p_fim
     and x.valor > 0
     and c.tipo = any(p_tipos)
     and (p_categoria_id is null or c.id = p_categoria_id)
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
   order by 4, 5;
$$;

-- Fluxo de caixa realizado (linhas detalhadas).
create or replace function public.relatorio_fluxo_realizado(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_contas uuid[] default null,
  p_centro_custo_id uuid default null
)
returns table (
  data date,
  registro text,
  registro_id uuid,
  lancamento_id uuid,
  conta_id uuid,
  conta_nome text,
  conta_disponivel boolean,
  conta_contrapartida_id uuid,
  conta_contrapartida_disponivel boolean,
  grupo text,
  categoria_id uuid,
  categoria_nome text,
  tipo_categoria text,
  descricao text,
  contraparte text,
  entrada numeric,
  saida numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.data_pagamento, 'baixa', b.id, l.id, cf.id, cf.nome, cf.compoe_saldo_disponivel, null::uuid, null::boolean,
         case
           when c.tipo = 'investimento' then 'investimento'
           when c.tipo in ('aporte_socio', 'retirada_socio', 'despesa_pessoal_socio', 'emprestimo_captacao', 'emprestimo_amortizacao') then 'financiamento'
           else 'operacional'
         end,
         c.id, c.nome, c.tipo, l.descricao, cp.nome,
         case when b.tipo = 'receber' then b.valor_total else 0 end,
         case when b.tipo = 'pagar' then b.valor_total else 0 end
    from public.baixas b
    join public.lancamentos l on l.id = b.lancamento_id
    join public.contas_financeiras cf on cf.id = b.conta_financeira_id
    left join public.categorias_financeiras c on c.id = l.categoria_id
    left join public.contrapartes cp on cp.id = l.contraparte_id
   where b.empresa_id = p_empresa_id
     and b.data_pagamento between p_inicio and p_fim
     and b.data_pagamento > cf.saldo_inicial_data
     and (p_contas is null or b.conta_financeira_id = any(p_contas))
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
  union all
  -- Saída da conta de origem
  select t.data, 'transferencia', t.id, null, o.id, o.nome, o.compoe_saldo_disponivel, d.id, d.compoe_saldo_disponivel,
         'transferencia', null, case t.tipo when 'pagamento_fatura_cartao' then 'Pagamento de fatura de cartão' else 'Transferência entre contas' end,
         t.tipo, coalesce(t.descricao, 'Transferência para ' || d.nome), null, 0, t.valor
    from public.transferencias t
    join public.contas_financeiras o on o.id = t.conta_origem_id
    join public.contas_financeiras d on d.id = t.conta_destino_id
   where t.empresa_id = p_empresa_id
     and t.data between p_inicio and p_fim
     and t.data > o.saldo_inicial_data
     and (p_contas is null or t.conta_origem_id = any(p_contas))
     and p_centro_custo_id is null
  union all
  -- Entrada na conta de destino
  select t.data, 'transferencia', t.id, null, d.id, d.nome, d.compoe_saldo_disponivel, o.id, o.compoe_saldo_disponivel,
         'transferencia', null, case t.tipo when 'pagamento_fatura_cartao' then 'Pagamento de fatura de cartão' else 'Transferência entre contas' end,
         t.tipo, coalesce(t.descricao, 'Transferência de ' || o.nome), null, t.valor, 0
    from public.transferencias t
    join public.contas_financeiras o on o.id = t.conta_origem_id
    join public.contas_financeiras d on d.id = t.conta_destino_id
   where t.empresa_id = p_empresa_id
     and t.data between p_inicio and p_fim
     and t.data > d.saldo_inicial_data
     and (p_contas is null or t.conta_destino_id = any(p_contas))
     and p_centro_custo_id is null
   order by 1, 2;
$$;

-- Saldos por conta em uma data (sistema e último extrato informado).
create or replace function public.saldos_contas(p_empresa_id uuid, p_data date)
returns table (
  conta_id uuid,
  nome text,
  tipo text,
  compoe_saldo_disponivel boolean,
  saldo_sistema numeric,
  saldo_extrato numeric,
  saldo_extrato_data date,
  ultimo_movimento_data date,
  movimentos_pendentes bigint,
  conciliado_ate date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.nome, c.tipo, c.compoe_saldo_disponivel,
         case when p_data >= c.saldo_inicial_data then public.saldo_conta(c.id, p_data) else null end,
         e.saldo, e.data,
         (select max(m.data) from public.movimentos_bancarios m where m.conta_financeira_id = c.id and m.data <= p_data),
         (select count(*) from public.movimentos_bancarios m
           where m.conta_financeira_id = c.id and m.status_conciliacao = 'pendente' and m.data <= p_data),
         -- Conciliado até: véspera do movimento pendente mais antigo (ou último movimento)
         coalesce(
           (select min(m.data) - 1 from public.movimentos_bancarios m
             where m.conta_financeira_id = c.id and m.status_conciliacao = 'pendente' and m.data <= p_data),
           (select max(m.data) from public.movimentos_bancarios m where m.conta_financeira_id = c.id and m.data <= p_data)
         )
    from public.contas_financeiras c
    left join lateral (
      select s.saldo, s.data from public.extrato_saldos s
       where s.conta_financeira_id = c.id and s.data <= p_data
       order by s.data desc, case s.fonte when 'ofx' then 1 when 'planilha' then 2 else 3 end
       limit 1
    ) e on true
   where c.empresa_id = p_empresa_id and c.ativa
   order by c.compoe_saldo_disponivel desc, c.nome;
$$;

-- Fluxo de caixa projetado: lançamentos em aberto e faturas de cartão.
create or replace function public.relatorio_fluxo_projetado(p_empresa_id uuid, p_ate date)
returns table (
  data date,
  vencido boolean,
  origem text,
  lancamento_id uuid,
  descricao text,
  contraparte text,
  categoria_nome text,
  entrada numeric,
  saida numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(l.data_vencimento, app.hoje()), l.data_vencimento < app.hoje(), 'lancamento', l.id, l.descricao, cp.nome, c.nome,
         case when l.tipo = 'receber' then l.valor_previsto - l.valor_baixado else 0 end,
         case when l.tipo = 'pagar' then l.valor_previsto - l.valor_baixado else 0 end
    from public.lancamentos l
    left join public.contrapartes cp on cp.id = l.contraparte_id
    left join public.categorias_financeiras c on c.id = l.categoria_id
    left join public.contas_financeiras cf on cf.id = l.conta_financeira_id
   where l.empresa_id = p_empresa_id
     and l.status_revisao = 'confirmado'
     and l.situacao in ('aberto', 'parcial')
     and l.data_vencimento <= p_ate
     and coalesce(cf.tipo, '') <> 'cartao_credito'
  union all
  -- Saldo devedor dos cartões vence na próxima data de vencimento da fatura
  select (case
            when extract(day from app.hoje()) <= coalesce(cf.cartao_dia_vencimento, 10)
              then date_trunc('month', app.hoje())::date + (least(coalesce(cf.cartao_dia_vencimento, 10), 28) - 1)
            else (date_trunc('month', app.hoje()) + interval '1 month')::date + (least(coalesce(cf.cartao_dia_vencimento, 10), 28) - 1)
          end),
         false, 'fatura_cartao', null, 'Fatura do cartão ' || cf.nome, null, 'Pagamento de fatura de cartão',
         0, -public.saldo_conta(cf.id, app.hoje())
    from public.contas_financeiras cf
   where cf.empresa_id = p_empresa_id and cf.ativa and cf.tipo = 'cartao_credito'
     and public.saldo_conta(cf.id, app.hoje()) < 0
   order by 1;
$$;

-- Indicadores de qualidade e completude dos dados de um período.
create or replace function public.qualidade_dados(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with meses as (
    select generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month')::date as mes
  ),
  checklist as (
    select m.mes,
           count(i.*) filter (where i.obrigatorio) as obrigatorios,
           count(i.*) filter (where i.obrigatorio and i.status in ('concluido', 'nao_se_aplica')) as concluidos,
           count(i.*) filter (where i.status in ('pendente', 'correcao')) as faltantes
      from meses m
      left join public.checklist_itens i on i.empresa_id = p_empresa_id and i.competencia = m.mes
     group by m.mes
  ),
  bancos as (
    select c.id, c.nome,
           exists (select 1 from public.movimentos_bancarios mv where mv.conta_financeira_id = c.id and mv.data between p_inicio and p_fim) as tem_extrato,
           (select max(mv.data) from public.movimentos_bancarios mv where mv.conta_financeira_id = c.id) as ultimo_movimento
      from public.contas_financeiras c
     where c.empresa_id = p_empresa_id and c.ativa and c.tipo in ('conta_corrente', 'poupanca', 'cartao_credito', 'investimento')
       and c.saldo_inicial_data <= p_fim
  ),
  mov as (
    select count(*) as total,
           count(*) filter (where status_conciliacao = 'conciliado') as conciliados,
           count(*) filter (where status_conciliacao = 'pendente') as pendentes,
           count(*) filter (where status_conciliacao = 'ignorado') as ignorados
      from public.movimentos_bancarios
     where empresa_id = p_empresa_id and data between p_inicio and p_fim
  )
  select jsonb_build_object(
    'checklist', (select jsonb_agg(jsonb_build_object(
                     'mes', mes, 'obrigatorios', obrigatorios, 'concluidos', concluidos, 'faltantes', faltantes,
                     'percentual', case when obrigatorios = 0 then null else round(100.0 * concluidos / obrigatorios) end)
                   order by mes) from checklist),
    'movimentos', (select to_jsonb(mov) from mov),
    'contas_sem_extrato', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ultimo_movimento', ultimo_movimento))
                                      from bancos where not tem_extrato), '[]'::jsonb),
    'contas_extrato_incompleto', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'ultimo_movimento', ultimo_movimento))
                                      from bancos where tem_extrato and ultimo_movimento < least(p_fim, app.hoje()) - 5), '[]'::jsonb),
    'lancamentos_sugeridos', (select count(*) from public.lancamentos
                               where empresa_id = p_empresa_id and status_revisao = 'sugerido' and situacao <> 'cancelado'
                                 and data_competencia between p_inicio and p_fim),
    'lancamentos_total', (select count(*) from public.lancamentos
                           where empresa_id = p_empresa_id and status_revisao = 'confirmado' and situacao <> 'cancelado'
                             and data_competencia between p_inicio and p_fim),
    'competencias', (select coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'status', coalesce(c.status, 'aberta')) order by m.mes), '[]'::jsonb)
                       from meses m left join public.competencias c on c.empresa_id = p_empresa_id and c.competencia = m.mes),
    'documentos_apos_fechamento', (select count(*) from public.documentos
                                    where empresa_id = p_empresa_id and recebido_apos_fechamento and apos_fechamento_avaliado_em is null
                                      and excluido_em is null and competencia between date_trunc('month', p_inicio)::date and p_fim),
    'contas_com_saldo_inicial', (select count(*) from public.contas_financeiras where empresa_id = p_empresa_id and ativa),
    'estoques', (select count(*) from public.estoques where empresa_id = p_empresa_id and competencia between date_trunc('month', p_inicio)::date - interval '1 month' and p_fim),
    'ultima_atualizacao', (select max(x) from (
        select max(updated_at) as x from public.lancamentos where empresa_id = p_empresa_id
        union all select max(created_at) from public.baixas where empresa_id = p_empresa_id
        union all select max(created_at) from public.movimentos_bancarios where empresa_id = p_empresa_id
        union all select max(created_at) from public.transferencias where empresa_id = p_empresa_id
      ) u)
  );
$$;

-- -----------------------------------------------------------------------------
-- Relatórios publicados (versões preservadas)
-- -----------------------------------------------------------------------------
create table public.relatorios_publicados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  tipo text not null check (tipo in ('pacote_mensal', 'resumo_executivo', 'dre', 'fluxo_caixa', 'personalizado')),
  titulo text not null,
  competencia date check (competencia is null or extract(day from competencia) = 1),
  periodo_inicio date not null,
  periodo_fim date not null,
  versao int not null default 0,
  situacao text not null default 'preliminar' check (situacao in ('preliminar', 'revisado')),
  status text not null default 'rascunho' check (status in ('rascunho', 'publicado', 'substituido')),
  dados jsonb not null default '{}'::jsonb,
  resumo_texto text,
  comentarios_contador text,
  limitacoes jsonb not null default '[]'::jsonb,
  gerado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  gerado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  publicado_por uuid references public.perfis(id) on delete set null,
  publicado_em timestamptz,
  substituido_por uuid references public.relatorios_publicados(id) on delete set null,
  constraint relatorios_periodo check (periodo_fim >= periodo_inicio)
);
create index relatorios_empresa_idx on public.relatorios_publicados (empresa_id, periodo_inicio desc);
create unique index relatorios_versao_unica on public.relatorios_publicados (empresa_id, tipo, periodo_inicio, periodo_fim, versao)
  where status <> 'rascunho';
create trigger auditoria_relatorios after insert or update or delete on public.relatorios_publicados
  for each row execute function app.tg_auditoria();

create table public.relatorio_acessos (
  id bigint generated always as identity primary key,
  relatorio_id uuid not null references public.relatorios_publicados(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid references public.perfis(id) on delete set null,
  tipo text not null check (tipo in ('visualizacao', 'download_pdf', 'download_xlsx')),
  ocorrido_em timestamptz not null default now()
);
create index relatorio_acessos_relatorio_idx on public.relatorio_acessos (relatorio_id, ocorrido_em desc);

create or replace function public.salvar_rascunho_relatorio(
  p_id uuid,
  p_empresa_id uuid,
  p_tipo text,
  p_titulo text,
  p_competencia date,
  p_inicio date,
  p_fim date,
  p_dados jsonb,
  p_resumo text,
  p_comentarios text,
  p_limitacoes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel public.relatorios_publicados;
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'relatorios.publicar');
  if p_id is not null then
    select * into v_rel from public.relatorios_publicados where id = p_id for update;
    if not found or v_rel.empresa_id <> p_empresa_id then
      raise exception 'Relatório não encontrado.';
    end if;
    if v_rel.status <> 'rascunho' then
      raise exception 'Relatórios publicados não podem ser alterados. Gere uma nova versão.';
    end if;
    update public.relatorios_publicados
       set titulo = coalesce(nullif(trim(coalesce(p_titulo, '')), ''), titulo),
           dados = coalesce(p_dados, dados),
           resumo_texto = p_resumo,
           comentarios_contador = p_comentarios,
           limitacoes = coalesce(p_limitacoes, limitacoes),
           atualizado_em = now()
     where id = p_id;
    return p_id;
  end if;
  insert into public.relatorios_publicados (empresa_id, tipo, titulo, competencia, periodo_inicio, periodo_fim, dados,
                                            resumo_texto, comentarios_contador, limitacoes)
  values (p_empresa_id, p_tipo, coalesce(nullif(trim(coalesce(p_titulo, '')), ''), 'Relatório'), app.competencia_de(p_competencia),
          p_inicio, p_fim, coalesce(p_dados, '{}'::jsonb), p_resumo, p_comentarios, coalesce(p_limitacoes, '[]'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.publicar_relatorio(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel public.relatorios_publicados;
  v_versao int;
  v_fechada boolean;
  v_situacao text;
begin
  select * into v_rel from public.relatorios_publicados where id = p_id for update;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  perform app.exigir(v_rel.empresa_id, 'relatorios.publicar');
  if v_rel.status <> 'rascunho' then
    raise exception 'Este relatório já foi publicado.';
  end if;
  -- "Revisado" somente quando todas as competências do período estão fechadas.
  select not exists (
    select 1 from generate_series(date_trunc('month', v_rel.periodo_inicio), date_trunc('month', v_rel.periodo_fim), interval '1 month') as g(mes)
     where not app.competencia_fechada(v_rel.empresa_id, g.mes::date)
  ) into v_fechada;
  v_situacao := case when v_fechada then 'revisado' else 'preliminar' end;

  select coalesce(max(versao), 0) + 1 into v_versao
    from public.relatorios_publicados
   where empresa_id = v_rel.empresa_id and tipo = v_rel.tipo and periodo_inicio = v_rel.periodo_inicio
     and periodo_fim = v_rel.periodo_fim and status <> 'rascunho';

  update public.relatorios_publicados
     set status = 'substituido', substituido_por = v_rel.id
   where empresa_id = v_rel.empresa_id and tipo = v_rel.tipo and periodo_inicio = v_rel.periodo_inicio
     and periodo_fim = v_rel.periodo_fim and status = 'publicado';

  update public.relatorios_publicados
     set status = 'publicado', versao = v_versao, situacao = v_situacao, publicado_por = auth.uid(), publicado_em = now()
   where id = v_rel.id;

  if v_rel.tipo = 'pacote_mensal' and v_rel.competencia is not null and v_fechada then
    update public.fechamento_etapas e
       set status = 'concluida', concluida_em = now(), concluida_por = auth.uid(), iniciada_em = coalesce(iniciada_em, now())
      from public.competencias c
     where c.id = e.competencia_id and c.empresa_id = v_rel.empresa_id and c.competencia = v_rel.competencia
       and e.etapa = 'publicacao';
    insert into public.competencia_historico (empresa_id, competencia_id, acao, etapa, detalhes)
    select v_rel.empresa_id, c.id, 'relatorio_publicado', 'publicacao', jsonb_build_object('relatorio_id', v_rel.id, 'versao', v_versao)
      from public.competencias c where c.empresa_id = v_rel.empresa_id and c.competencia = v_rel.competencia;
  end if;

  perform app.notificar_clientes(
    v_rel.empresa_id, 'relatorios.ver', 'relatorio_publicado',
    'Relatório disponível: ' || v_rel.titulo,
    case when v_situacao = 'revisado' then 'Relatório revisado pelo escritório.' else 'Relatório preliminar: os dados ainda podem mudar.' end,
    '/e/' || v_rel.empresa_id::text || '/relatorios/' || v_rel.id::text,
    true
  );
  return jsonb_build_object('versao', v_versao, 'situacao', v_situacao);
end;
$$;

create or replace function public.excluir_rascunho_relatorio(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel public.relatorios_publicados;
begin
  select * into v_rel from public.relatorios_publicados where id = p_id for update;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  perform app.exigir(v_rel.empresa_id, 'relatorios.publicar');
  if v_rel.status <> 'rascunho' then
    raise exception 'Relatórios publicados são preservados e não podem ser excluídos.';
  end if;
  delete from public.relatorios_publicados where id = p_id;
end;
$$;

create or replace function public.registrar_acesso_relatorio(p_id uuid, p_tipo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel public.relatorios_publicados;
begin
  select * into v_rel from public.relatorios_publicados where id = p_id;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  perform app.exigir(v_rel.empresa_id, 'relatorios.ver');
  insert into public.relatorio_acessos (relatorio_id, empresa_id, user_id, tipo)
  values (v_rel.id, v_rel.empresa_id, auth.uid(), p_tipo);
end;
$$;

alter table public.relatorios_publicados enable row level security;
alter table public.relatorio_acessos enable row level security;

create policy relatorios_leitura on public.relatorios_publicados for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('relatorios.publicar'))::uuid[])
    or (status in ('publicado', 'substituido') and empresa_id = any ((select app.empresas_com('relatorios.ver'))::uuid[]))
  );
create policy relatorio_acessos_leitura on public.relatorio_acessos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('relatorios.publicar'))::uuid[]) or user_id = (select auth.uid()));
