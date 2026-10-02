-- =============================================================================
-- Migração 1700: conciliação — proteção de transferências e resumo da carteira
-- =============================================================================

-- Uma transferência tem dois lados (conta de origem e conta de destino). Cada
-- lado só pode ser conciliado com UMA movimentação do extrato daquela conta.
create or replace function app.tg_conciliacao_item_transferencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ativo and new.transferencia_id is not null and (tg_op = 'INSERT' or not old.ativo) then
    if exists (
      select 1
        from public.conciliacao_itens outro
        join public.conciliacao_itens om
          on om.conciliacao_id = outro.conciliacao_id and om.movimento_id is not null and om.ativo
        join public.movimentos_bancarios m on m.id = om.movimento_id
       where outro.transferencia_id = new.transferencia_id
         and outro.ativo
         and outro.conciliacao_id <> new.conciliacao_id
         and m.conta_financeira_id in (
           select m2.conta_financeira_id
             from public.conciliacao_itens x
             join public.movimentos_bancarios m2 on m2.id = x.movimento_id
            where x.conciliacao_id = new.conciliacao_id
         )
    ) then
      raise exception 'Esta transferência já foi conciliada com outra movimentação desta conta.';
    end if;
  end if;
  return new;
end;
$$;

create trigger conciliacao_itens_transferencia before insert or update on public.conciliacao_itens
  for each row execute function app.tg_conciliacao_item_transferencia();

-- Resumo da conciliação por empresa (painel do escritório). Executa com as
-- permissões de quem consulta: as regras de acesso (RLS) limitam as empresas.
create or replace function public.resumo_conciliacao_carteira()
returns table (
  empresa_id uuid,
  pendentes int,
  entradas_pendentes numeric,
  saidas_pendentes numeric,
  pendente_mais_antiga date,
  sugestoes int,
  conciliadas_30d int,
  ultima_importacao timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mov as (
    select m.empresa_id,
           count(*)::int as pendentes,
           coalesce(sum(m.valor) filter (where m.valor > 0), 0) as entradas,
           abs(coalesce(sum(m.valor) filter (where m.valor < 0), 0)) as saidas,
           min(m.data) as mais_antiga
      from public.movimentos_bancarios m
     where m.status_conciliacao = 'pendente'
     group by m.empresa_id
  ),
  conc as (
    select c.empresa_id,
           (count(*) filter (where c.status = 'sugerida'))::int as sugestoes,
           (count(*) filter (where c.status = 'confirmada' and c.confirmada_em >= now() - interval '30 days'))::int as conciliadas
      from public.conciliacoes c
     where c.status in ('sugerida', 'confirmada')
     group by c.empresa_id
  ),
  imp as (
    select i.empresa_id, max(i.created_at) as ultima
      from public.importacoes i
     where i.status = 'concluida' and i.tipo in ('extrato_ofx', 'extrato_planilha')
     group by i.empresa_id
  )
  select e.id,
         coalesce(mov.pendentes, 0),
         coalesce(mov.entradas, 0),
         coalesce(mov.saidas, 0),
         mov.mais_antiga,
         coalesce(conc.sugestoes, 0),
         coalesce(conc.conciliadas, 0),
         imp.ultima
    from public.empresas e
    left join mov on mov.empresa_id = e.id
    left join conc on conc.empresa_id = e.id
    left join imp on imp.empresa_id = e.id
   where e.ativa
     and e.id = any ((select app.empresas_com('financeiro.ver'))::uuid[]);
$$;

revoke execute on function public.resumo_conciliacao_carteira() from public, anon;
grant execute on function public.resumo_conciliacao_carteira() to authenticated, service_role;
