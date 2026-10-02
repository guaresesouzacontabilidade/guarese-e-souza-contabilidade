-- =============================================================================
-- Migração 1800: resumo financeiro da carteira (painel do escritório)
-- =============================================================================
-- Executa com as permissões de quem consulta (security invoker): cada usuário
-- só vê as empresas em que tem acesso ao financeiro. A DRE usa exatamente a
-- mesma regra do relatório (relatorio_dre_linhas).

create or replace function public.resumo_financeiro_carteira(p_inicio date, p_fim date)
returns table (
  empresa_id uuid,
  saldo_disponivel numeric,
  contas_sem_saldo int,
  receber_vencido numeric,
  pagar_vencido numeric,
  receber_30 numeric,
  pagar_30 numeric,
  receita numeric,
  resultado numeric,
  sugeridos int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with emp as (
    select e.id
      from public.empresas e
     where e.ativa
       and e.id = any ((select app.empresas_com('financeiro.ver'))::uuid[])
  ),
  saldos as (
    select c.empresa_id,
           sum(case when app.hoje() >= c.saldo_inicial_data then public.saldo_conta(c.id, app.hoje()) else 0 end) as saldo,
           (count(*) filter (where app.hoje() < c.saldo_inicial_data))::int as sem_saldo
      from public.contas_financeiras c
     where c.ativa and c.compoe_saldo_disponivel and c.empresa_id in (select id from emp)
     group by c.empresa_id
  ),
  abertos as (
    select l.empresa_id,
           coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.tipo = 'receber' and l.data_vencimento < app.hoje()), 0) as rv,
           coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.tipo = 'pagar' and l.data_vencimento < app.hoje()), 0) as pv,
           coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.tipo = 'receber' and l.data_vencimento between app.hoje() and app.hoje() + 30), 0) as r30,
           coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.tipo = 'pagar' and l.data_vencimento between app.hoje() and app.hoje() + 30), 0) as p30
      from public.lancamentos l
      left join public.contas_financeiras cf on cf.id = l.conta_financeira_id
     where l.empresa_id in (select id from emp)
       and l.status_revisao = 'confirmado'
       and l.situacao in ('aberto', 'parcial')
       and coalesce(cf.tipo, '') <> 'cartao_credito'
     group by l.empresa_id
  ),
  dre as (
    select e.id as empresa_id,
           coalesce(sum(x.valor) filter (where x.tipo = 'receita_operacional'), 0) as receita,
           coalesce(sum(case when x.tipo in ('receita_operacional', 'receita_financeira', 'outras_receitas') then x.valor else -x.valor end), 0) as resultado
      from emp e
      cross join lateral public.relatorio_dre_linhas(e.id, p_inicio, p_fim) x
     group by e.id
  ),
  sug as (
    select l.empresa_id, count(*)::int as n
      from public.lancamentos l
     where l.empresa_id in (select id from emp) and l.status_revisao = 'sugerido' and l.situacao <> 'cancelado'
     group by l.empresa_id
  )
  select e.id,
         s.saldo,
         coalesce(s.sem_saldo, 0),
         coalesce(a.rv, 0), coalesce(a.pv, 0), coalesce(a.r30, 0), coalesce(a.p30, 0),
         coalesce(d.receita, 0), coalesce(d.resultado, 0),
         coalesce(g.n, 0)
    from emp e
    left join saldos s on s.empresa_id = e.id
    left join abertos a on a.empresa_id = e.id
    left join dre d on d.empresa_id = e.id
    left join sug g on g.empresa_id = e.id;
$$;

revoke execute on function public.resumo_financeiro_carteira(date, date) from public, anon;
grant execute on function public.resumo_financeiro_carteira(date, date) to authenticated, service_role;
