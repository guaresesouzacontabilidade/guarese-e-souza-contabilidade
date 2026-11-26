-- Custo médio pelo custo de compra do cadastro: estoque lançado por correção
-- (sem custo) usa o custo de compra; mudar o custo de compra muda o custo
-- médio enquanto não houve entrada com custo; depois, segue a média; a venda
-- grava o custo certo.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prego', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Prego 15x18 caixa 20 kg', 'ncm', '73170090', 'unidade', 'KG', 'valor_unitario', 22.90, 'preco_custo', 14.41))::text, true);
-- Estoque por correção (sem custo), como no caso relatado
select public.gestao_inventario(current_setting('testes.empresa_a')::uuid,
  jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prego'), 'contado', 20)), 'Correção manual do estoque');
reset role;
select is((select (estoque_atual, custo_medio)::text from public.nfe_produtos where id = current_setting('testes.prego')::uuid),
  '(20.0000,14.410000)', 'estoque por correção: custo médio = custo de compra do cadastro');

-- Muda o custo de compra no cadastro (sem entrada com custo): o custo médio acompanha
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.prego')::uuid, jsonb_build_object(
  'descricao', 'Prego 15x18 caixa 20 kg', 'ncm', '73170090', 'unidade', 'KG', 'valor_unitario', 22.90, 'preco_custo', 15));
reset role;
select is((select custo_medio from public.nfe_produtos where id = current_setting('testes.prego')::uuid), 15.000000::numeric,
  'custo de compra atualizado no cadastro aparece no custo médio');

-- Entrada com custo: passa a seguir a média
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.prego'), 'quantidade', 20, 'custo_unitario', 17));
reset role;
select is((select custo_medio from public.nfe_produtos where id = current_setting('testes.prego')::uuid), 16.000000::numeric,
  'entrada com custo: média ponderada (20 × 15 + 20 × 17) ÷ 40');
-- Depois disso, mudar o custo de compra não mexe na média das entradas
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.prego')::uuid, jsonb_build_object(
  'descricao', 'Prego 15x18 caixa 20 kg', 'ncm', '73170090', 'unidade', 'KG', 'valor_unitario', 22.90, 'preco_custo', 18));
reset role;
select is((select (preco_custo, custo_medio)::text from public.nfe_produtos where id = current_setting('testes.prego')::uuid),
  '(18.0000,16.000000)', 'com entradas com custo, o custo médio continua sendo a média delas');

-- Produto sem custo de compra: nada muda (continua zero)
insert into public.nfe_produtos (empresa_id, codigo, descricao, ncm, unidade, valor_unitario)
values (current_setting('testes.empresa_a')::uuid, 'SEMCUSTO', 'Produto sem custo', '73170090', 'UN', 10);
select is((select custo_medio from public.nfe_produtos where codigo = 'SEMCUSTO'), 0::numeric, 'sem custo de compra: custo médio fica zero');

-- A venda grava o custo do produto
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 100)::text, true);
select public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prego'), 'quantidade', 2)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 45.80))));
reset role;
select is((select custo_unitario from public.venda_itens where produto_id = current_setting('testes.prego')::uuid), 16.000000::numeric,
  'a venda grava o custo médio (não zero)');

select * from finish();
rollback;
