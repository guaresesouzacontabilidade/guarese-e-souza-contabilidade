-- Preços de venda e margem desejada (gestão da loja) e apoio à gestão do estoque.
--
-- * Margem que o cliente quer ganhar (opcional), sobre o custo: no produto, no
--   grupo e a padrão da empresa (a mesma usada nos produtos novos da entrada
--   por nota). O produto sem margem própria usa a do grupo e, sem grupo, a
--   padrão. Serve para sugerir o preço; o preço é sempre o que a pessoa salva.
-- * Histórico de preços: toda mudança do preço de venda fica registrada (quem,
--   quando, preço antigo e novo, custo da época), por gatilho no produto.
-- * Tabela de preços: situação de cada produto (última entrada e custo dela,
--   última mudança de preço e o custo daquela hora) e gravação em lote.
-- * Vendas por produto num período (quantidade, faturamento, custo e última
--   venda), para reposição, giro, curva ABC e produtos parados.
-- * Aviso no sino para quem gerencia a loja quando um produto fica abaixo do
--   estoque mínimo (no máximo um por produto a cada 20 horas, sem e-mail).
-- Tudo exige a permissão "gerenciar a loja" e a gestão ligada para a empresa.

-- -----------------------------------------------------------------------------
-- 1. Margem desejada
-- -----------------------------------------------------------------------------
alter table public.nfe_produtos
  add column margem_desejada numeric(7, 2) check (margem_desejada is null or margem_desejada between 0 and 1000);

create table public.gestao_grupos_margem (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  grupo text not null check (length(trim(grupo)) between 1 and 60),
  margem_desejada numeric(7, 2) not null check (margem_desejada between 0 and 1000),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, grupo)
);
create trigger auditoria_gestao_grupos_margem after insert or update or delete on public.gestao_grupos_margem
  for each row execute function app.tg_auditoria();
alter table public.gestao_grupos_margem enable row level security;
create policy gestao_grupos_margem_leitura on public.gestao_grupos_margem for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
revoke all on public.gestao_grupos_margem from anon, authenticated;
grant select on public.gestao_grupos_margem to authenticated;

-- Margem do produto
create or replace function public.gestao_produto_margem(p_empresa_id uuid, p_produto_id uuid, p_margem numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if p_margem is not null and (p_margem < 0 or p_margem > 1000) then
    raise exception 'A margem deve ficar entre 0%% e 1000%%.';
  end if;
  update public.nfe_produtos set margem_desejada = round(p_margem, 2) where id = p_produto_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
end;
$$;

-- Margem do grupo (null tira a margem do grupo)
create or replace function public.gestao_grupo_margem(p_empresa_id uuid, p_grupo text, p_margem numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grupo text := nullif(trim(p_grupo), '');
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if v_grupo is null then
    raise exception 'Informe o grupo.';
  end if;
  if p_margem is null then
    delete from public.gestao_grupos_margem where empresa_id = p_empresa_id and grupo = v_grupo;
    return;
  end if;
  if p_margem < 0 or p_margem > 1000 then
    raise exception 'A margem deve ficar entre 0%% e 1000%%.';
  end if;
  insert into public.gestao_grupos_margem (empresa_id, grupo, margem_desejada)
  values (p_empresa_id, v_grupo, round(p_margem, 2))
  on conflict (empresa_id, grupo) do update
    set margem_desejada = excluded.margem_desejada, atualizado_por = auth.uid(), updated_at = now();
end;
$$;

-- Margem padrão da empresa (a mesma dos produtos novos da entrada por nota)
create or replace function public.gestao_margem_padrao(p_empresa_id uuid, p_margem numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if p_margem is not null and (p_margem < 0 or p_margem > 1000) then
    raise exception 'A margem deve ficar entre 0%% e 1000%%.';
  end if;
  update public.gestao_config set margem_entrada = round(p_margem, 2), atualizado_por = auth.uid(), updated_at = now()
   where empresa_id = p_empresa_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Histórico de preços
-- -----------------------------------------------------------------------------
create table public.produto_precos_historico (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.nfe_produtos(id) on delete cascade,
  preco_anterior numeric(15, 4),
  preco_novo numeric(15, 4) not null,
  custo_referencia numeric(18, 6),
  origem text not null default 'cadastro' check (origem in ('cadastro', 'tabela_precos')),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index produto_precos_historico_idx on public.produto_precos_historico (empresa_id, produto_id, created_at desc);
alter table public.produto_precos_historico enable row level security;
create policy produto_precos_historico_leitura on public.produto_precos_historico for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
revoke all on public.produto_precos_historico from anon, authenticated;
grant select on public.produto_precos_historico to authenticated;

create or replace function app.tg_produto_preco_historico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Produto sem preço (ex.: cadastrado só para nota fiscal) não entra no histórico
  if new.valor_unitario is not null
     and (tg_op = 'INSERT' or new.valor_unitario is distinct from old.valor_unitario) then
    insert into public.produto_precos_historico (empresa_id, produto_id, preco_anterior, preco_novo, custo_referencia, origem, criado_por)
    values (
      new.empresa_id, new.id,
      case when tg_op = 'UPDATE' then old.valor_unitario end,
      new.valor_unitario,
      coalesce(nullif(new.custo_medio, 0), new.preco_custo),
      case when coalesce(current_setting('app.origem_preco', true), '') = 'tabela_precos' then 'tabela_precos' else 'cadastro' end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;
create trigger produto_preco_historico after insert or update of valor_unitario on public.nfe_produtos
  for each row execute function app.tg_produto_preco_historico();

-- -----------------------------------------------------------------------------
-- 3. Tabela de preços
-- -----------------------------------------------------------------------------
-- Situação de cada produto: última entrada (e o custo dela) e última mudança de preço.
-- (security definer: confere "gerenciar a loja" e filtra pela empresa.)
create or replace function public.gestao_precos_situacao(p_empresa_id uuid)
returns table (
  produto_id uuid,
  ultima_entrada_em timestamptz,
  ultimo_custo_entrada numeric,
  preco_alterado_em timestamptz,
  custo_na_alteracao numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  return query
  select p.id, e.created_at, e.custo_unitario, h.created_at, h.custo_referencia
    from public.nfe_produtos p
    left join lateral (
      select m.created_at, m.custo_unitario
        from public.estoque_movimentos m
       where m.empresa_id = p.empresa_id and m.produto_id = p.id and m.tipo in ('entrada_compra', 'entrada_manual')
       order by m.created_at desc
       limit 1
    ) e on true
    left join lateral (
      select x.created_at, x.custo_referencia
        from public.produto_precos_historico x
       where x.empresa_id = p.empresa_id and x.produto_id = p.id
       order by x.created_at desc, x.id desc
       limit 1
    ) h on true
   where p.empresa_id = p_empresa_id;
end;
$$;

-- Grava vários preços de uma vez: [{"produto_id": "...", "preco": 12.5, "margem": 30}]
-- ("margem" é opcional; presente e nula, tira a margem do produto).
create or replace function public.gestao_precos_salvar(p_empresa_id uuid, p_itens jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  v_preco numeric;
  v_margem numeric;
  v_n int := 0;
  v_mudou int;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Nenhum preço para salvar.';
  end if;
  if jsonb_array_length(p_itens) > 5000 then
    raise exception 'Salve no máximo 5.000 preços de uma vez.';
  end if;
  perform set_config('app.origem_preco', 'tabela_precos', true);
  for it in select * from jsonb_array_elements(p_itens) loop
    if it ? 'preco' then
      v_preco := nullif(it ->> 'preco', '')::numeric;
      if v_preco is null or v_preco < 0 or v_preco > 9999999999 then
        raise exception 'Preço inválido em um dos produtos.';
      end if;
      update public.nfe_produtos set valor_unitario = round(v_preco, 4)
       where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id and valor_unitario is distinct from round(v_preco, 4);
      get diagnostics v_mudou = row_count;
      v_n := v_n + v_mudou;
      if v_mudou = 0 and not exists (select 1 from public.nfe_produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id) then
        raise exception 'Produto não encontrado.';
      end if;
    end if;
    if it ? 'margem' then
      v_margem := nullif(it ->> 'margem', '')::numeric;
      if v_margem is not null and (v_margem < 0 or v_margem > 1000) then
        raise exception 'A margem deve ficar entre 0%% e 1000%%.';
      end if;
      update public.nfe_produtos set margem_desejada = round(v_margem, 2)
       where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id;
    end if;
  end loop;
  perform set_config('app.origem_preco', '', true);
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Vendas por produto num período (reposição, giro, ABC, parados)
-- -----------------------------------------------------------------------------
create or replace function public.gestao_vendas_por_produto(p_empresa_id uuid, p_inicio date, p_fim date)
returns table (
  produto_id uuid,
  quantidade numeric,
  faturamento numeric,
  custo numeric,
  vendas bigint,
  ultima_venda date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  return query
  with periodo as (
    select i.produto_id,
           sum(i.quantidade) as quantidade,
           sum(i.total) as faturamento,
           sum(i.quantidade * coalesce(i.custo_unitario, 0)) as custo,
           count(distinct v.id) as vendas
      from public.venda_itens i
      join public.vendas v on v.id = i.venda_id and v.empresa_id = i.empresa_id
     where i.empresa_id = p_empresa_id
       and v.tipo = 'venda' and v.status = 'concluida'
       and v.data between p_inicio and p_fim
     group by i.produto_id
  ), ultima as (
    select i.produto_id, max(v.data) as ultima_venda
      from public.venda_itens i
      join public.vendas v on v.id = i.venda_id and v.empresa_id = i.empresa_id
     where i.empresa_id = p_empresa_id and v.tipo = 'venda' and v.status = 'concluida'
     group by i.produto_id
  )
  select u.produto_id, coalesce(pe.quantidade, 0), coalesce(pe.faturamento, 0), coalesce(pe.custo, 0), coalesce(pe.vendas, 0), u.ultima_venda
    from ultima u
    left join periodo pe on pe.produto_id = u.produto_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Aviso de estoque abaixo do mínimo
-- -----------------------------------------------------------------------------
create or replace function app.tg_produto_estoque_minimo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link text;
begin
  if new.controla_estoque and new.ativo and new.estoque_minimo is not null
     and old.estoque_atual >= new.estoque_minimo and new.estoque_atual < new.estoque_minimo
     and app.gestao_ativa(new.empresa_id) then
    v_link := '/e/' || new.empresa_id::text || '/loja/produtos/' || new.id::text;
    if not exists (
      select 1 from public.notificacoes
       where empresa_id = new.empresa_id and tipo = 'estoque_baixo' and link = v_link and created_at > now() - interval '20 hours'
    ) then
      perform app.notificar_clientes(
        new.empresa_id, 'gestao.gerenciar', 'estoque_baixo',
        'Estoque baixo: ' || left(new.descricao, 80),
        'Ficou abaixo do mínimo. Veja a sugestão de compra em Produtos e estoque → Reposição e análise.',
        v_link, false
      );
    end if;
  end if;
  return new;
end;
$$;
create trigger produto_estoque_minimo after update of estoque_atual on public.nfe_produtos
  for each row execute function app.tg_produto_estoque_minimo();

-- -----------------------------------------------------------------------------
-- 6. Permissões das funções
-- -----------------------------------------------------------------------------
revoke all on function public.gestao_produto_margem(uuid, uuid, numeric) from public, anon;
revoke all on function public.gestao_grupo_margem(uuid, text, numeric) from public, anon;
revoke all on function public.gestao_margem_padrao(uuid, numeric) from public, anon;
revoke all on function public.gestao_precos_situacao(uuid) from public, anon;
revoke all on function public.gestao_precos_salvar(uuid, jsonb) from public, anon;
revoke all on function public.gestao_vendas_por_produto(uuid, date, date) from public, anon;
grant execute on function public.gestao_produto_margem(uuid, uuid, numeric) to authenticated;
grant execute on function public.gestao_grupo_margem(uuid, text, numeric) to authenticated;
grant execute on function public.gestao_margem_padrao(uuid, numeric) to authenticated;
grant execute on function public.gestao_precos_situacao(uuid) to authenticated;
grant execute on function public.gestao_precos_salvar(uuid, jsonb) to authenticated;
grant execute on function public.gestao_vendas_por_produto(uuid, date, date) to authenticated;
