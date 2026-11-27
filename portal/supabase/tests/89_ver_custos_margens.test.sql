-- Permissão "Ver custos e margens": o titular vê; o colaborador que só gerencia a
-- loja não lê o custo nem por fora da tela; salvar ou importar sem a permissão
-- mantém o custo guardado; as colunas de custo não são lidas diretamente por
-- ninguém (só pelas funções que conferem a permissão); isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(23);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

-- Permissões: o titular tem; o colaborador que gerencia a loja não ganha sozinho
select ok((select 'gestao.custos' = any(permissoes) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'),
  'titular vê custos e margens');
update public.empresa_membros set permissoes = permissoes || array['gestao.gerenciar']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select ok((select not ('gestao.custos' = any(permissoes)) and 'gestao.vender' = any(permissoes) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2'),
  'colaborador que gerencia a loja não vê custos (e continua vendendo)');
select is(app.permissoes_padrao('cliente_colaborador') @> array['gestao.custos'], false, 'colaborador novo não vem com a permissão');

-- Colunas de custo: ninguém lê diretamente
select is(
  (select array_agg(table_name || '.' || column_name order by table_name, column_name)
     from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('nfe_produtos', 'estoque_movimentos', 'venda_itens', 'produto_precos_historico')
      and not has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'select')),
  array['estoque_movimentos.custo_medio_apos', 'estoque_movimentos.custo_unitario', 'nfe_produtos.custo_medio',
        'nfe_produtos.margem_desejada', 'nfe_produtos.preco_custo', 'produto_precos_historico.custo_referencia', 'venda_itens.custo_unitario'],
  'só as colunas de custo ficam sem leitura (as outras, inclusive novas, continuam liberadas)');
select is(has_table_privilege('anon', 'public.nfe_produtos', 'select'), false, 'visitante não lê produtos');

-- Produto com custo (titular)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prod', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Tábua de pinus 30 cm', 'ncm', '44071100', 'unidade', 'UN', 'valor_unitario', 30, 'preco_custo', 20))::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.prod'), 'quantidade', 10, 'custo_unitario', 21));
select public.gestao_grupo_margem(current_setting('testes.empresa_a')::uuid, 'Madeiras', 40);
select throws_ok($$select preco_custo from public.nfe_produtos limit 1$$, '42501', null, 'nem o titular lê a coluna de custo direto (só pela função)');
select is((select descricao from public.nfe_produtos where id = current_setting('testes.prod')::uuid), 'Tábua de pinus 30 cm', 'as outras colunas do produto continuam lidas');
select is((public.gestao_produtos_custos(current_setting('testes.empresa_a')::uuid) -> current_setting('testes.prod') ->> 'preco_custo')::numeric, 20::numeric,
  'titular lê o custo de compra pela função');
select is((public.gestao_produtos_custos(current_setting('testes.empresa_a')::uuid) -> current_setting('testes.prod') ->> 'custo_medio')::numeric, 21::numeric,
  'titular lê o custo médio pela função');
select is((select count(*)::int from jsonb_each(public.gestao_produto_custos(current_setting('testes.empresa_a')::uuid, current_setting('testes.prod')::uuid) -> 'movimentos') m where m.value::numeric = 21), 1,
  'titular vê o custo nos movimentos do estoque');
select is((select count(*)::int from public.gestao_grupos_margem where empresa_id = current_setting('testes.empresa_a')::uuid), 1, 'titular vê as metas de margem');
select lives_ok(format($$select * from public.gestao_precos_situacao(%L)$$, current_setting('testes.empresa_a')), 'titular abre a tabela de preços');
reset role;

-- Colaborador que gerencia a loja, sem ver custos
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select valor_unitario from public.nfe_produtos where id = current_setting('testes.prod')::uuid), 30.0000::numeric, 'colaborador vê o produto e o preço de venda');
select throws_ok($$select custo_medio from public.nfe_produtos limit 1$$, '42501', null, 'colaborador não lê o custo médio');
select throws_ok($$select custo_unitario from public.estoque_movimentos limit 1$$, '42501', null, 'colaborador não lê o custo dos movimentos');
select throws_ok(format($$select public.gestao_produtos_custos(%L)$$, current_setting('testes.empresa_a')), '42501', null, 'colaborador não chama a função de custos');
select throws_ok(format($$select * from public.gestao_precos_situacao(%L)$$, current_setting('testes.empresa_a')), '42501', null, 'colaborador não abre a tabela de preços (custo da última compra)');
select throws_ok(format($$select * from public.gestao_vendas_por_produto(%L, current_date - 30, current_date)$$, current_setting('testes.empresa_a')), '42501', null,
  'colaborador não vê o custo das vendas por produto');
select throws_ok(format($$select public.gestao_produto_margem(%L, %L, 50)$$, current_setting('testes.empresa_a'), current_setting('testes.prod')), '42501', null,
  'colaborador não muda a margem');
select is((select count(*)::int from public.gestao_grupos_margem where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'colaborador não vê as metas de margem');
-- Salva o produto (mudando o preço) e manda um custo: o custo guardado fica
select public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.prod')::uuid, jsonb_build_object(
  'descricao', 'Tábua de pinus 30 cm', 'ncm', '44071100', 'unidade', 'UN', 'valor_unitario', 32, 'preco_custo', 1));
-- Importa a planilha com a coluna de custo: ignorada
select public.gestao_importar_produtos(current_setting('testes.empresa_a')::uuid, jsonb_build_array(
  jsonb_build_object('linha', 2, 'codigo', 'PLAN-1', 'descricao', 'Ripa de pinus', 'ncm', '44071100', 'unidade', 'UN', 'preco_venda', '5', 'preco_custo', '3')));
reset role;
select is((select array[valor_unitario, preco_custo] from public.nfe_produtos where id = current_setting('testes.prod')::uuid), array[32, 20]::numeric[],
  'colaborador muda o preço; o custo guardado não muda');
select is((select preco_custo from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = 'PLAN-1'), null,
  'planilha importada sem a permissão: custo ignorado');

-- Gestor de outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.gestao_produto_custos(%L, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.prod')), '42501', null,
  'gestor de outra empresa não lê os custos');
reset role;

select * from finish();
rollback;
