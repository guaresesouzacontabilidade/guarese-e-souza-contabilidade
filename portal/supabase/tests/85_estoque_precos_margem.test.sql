-- Preços de venda e margem desejada: margem no produto, no grupo e padrão;
-- histórico de preços com quem mudou; tabela de preços (situação e gravação
-- em lote); vendas por produto; aviso de estoque abaixo do mínimo; só quem
-- gerencia a loja mexe; isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

-- Colaborador da empresa A opera o caixa, sem gerenciar
update public.empresa_membros set permissoes = permissoes || array['gestao.vender']
 where user_id = '00000000-0000-0000-0000-0000000000b2';

-- Escritório liga a loja das empresas A e B
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
select public.gestao_configurar(current_setting('testes.empresa_b')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

-- Produtos e entrada (gerente = titular)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.tabua', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Tábua de pinus 2,5x30 3m', 'ncm', '44071100', 'unidade', 'PC', 'valor_unitario', 40,
  'grupo', 'Pinus', 'estoque_minimo', 10))::text, true);
select set_config('testes.viga', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Viga de eucalipto 6x12', 'ncm', '44079990', 'unidade', 'm3', 'valor_unitario', 2500,
  'espessura_cm', 6, 'largura_cm', 12, 'grupo', 'Eucalipto'))::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.tabua'), 'quantidade', 12, 'custo_unitario', 30));

-- 1. Margens
select lives_ok(format($$select public.gestao_produto_margem(%L, %L, 35)$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  'gerente define a margem do produto');
select is((select margem_desejada from public.nfe_produtos where id = current_setting('testes.tabua')::uuid), 35.00::numeric, 'margem do produto guardada');
select lives_ok(format($$select public.gestao_grupo_margem(%L, ' Eucalipto ', 40)$$, current_setting('testes.empresa_a')), 'gerente define a margem do grupo');
select is((select margem_desejada from public.gestao_grupos_margem where empresa_id = current_setting('testes.empresa_a')::uuid and grupo = 'Eucalipto'),
  40.00::numeric, 'margem do grupo guardada (sem espaços)');
select lives_ok(format($$select public.gestao_margem_padrao(%L, 30)$$, current_setting('testes.empresa_a')), 'gerente define a margem padrão');
select is((select margem_entrada from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid), 30.00::numeric, 'margem padrão guardada');
select throws_like(format($$select public.gestao_produto_margem(%L, %L, -5)$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  '%entre 0%', 'margem negativa recusada');
select lives_ok(format($$select public.gestao_grupo_margem(%L, 'Eucalipto', null)$$, current_setting('testes.empresa_a')), 'tirar a margem do grupo');
select is((select count(*)::int from public.gestao_grupos_margem where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'margem do grupo removida');

-- 2. Tabela de preços: situação depois da entrada
select is((select (ultimo_custo_entrada, ultima_entrada_em is not null, preco_alterado_em is not null)::text
             from public.gestao_precos_situacao(current_setting('testes.empresa_a')::uuid) where produto_id = current_setting('testes.tabua')::uuid),
  '(30.000000,t,t)', 'situação: custo da última entrada e data do preço');

-- 3. Gravação em lote: preço e margem; registra no histórico com quem mudou
select is(public.gestao_precos_salvar(current_setting('testes.empresa_a')::uuid, jsonb_build_array(
    jsonb_build_object('produto_id', current_setting('testes.tabua'), 'preco', 40.5, 'margem', 35),
    jsonb_build_object('produto_id', current_setting('testes.viga'), 'preco', 2500))), 1,
  'só o preço que mudou conta como alterado');
select is((select valor_unitario from public.nfe_produtos where id = current_setting('testes.tabua')::uuid), 40.5000::numeric, 'preço novo gravado');
select is((select (preco_anterior, preco_novo, origem, criado_por)::text from public.produto_precos_historico
            where produto_id = current_setting('testes.tabua')::uuid order by id desc limit 1),
  '(40.0000,40.5000,tabela_precos,00000000-0000-0000-0000-0000000000b1)', 'histórico: preço antigo, novo, origem e quem mudou');
select throws_like(format($$select public.gestao_precos_salvar(%L, '[{"produto_id": "%s", "preco": -1}]')$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  '%Preço inválido%', 'preço negativo recusado');
reset role;
-- Produto só para nota fiscal (sem preço de venda) não entra no histórico
with novo as (
  insert into public.nfe_produtos (empresa_id, codigo, descricao, ncm, unidade)
  values (current_setting('testes.empresa_a')::uuid, 'MILHO', 'Milho em grãos', '10059010', 'KG') returning id
) select set_config('testes.milho', (select id from novo)::text, true);
select is((select count(*)::int from public.produto_precos_historico where produto_id = current_setting('testes.milho')::uuid), 0,
  'produto sem preço de venda não entra no histórico');

-- 4. Quem só vende não mexe em preço nem vê margens
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.gestao_precos_salvar(%L, '[{"produto_id": "%s", "preco": 1}]')$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  '42501', null, 'operador do caixa não muda preços');
select throws_ok(format($$select * from public.gestao_precos_situacao(%L)$$, current_setting('testes.empresa_a')), '42501', null, 'operador do caixa não vê a tabela de custos');
select is((select count(*)::int from public.produto_precos_historico), 0, 'operador do caixa não vê o histórico de preços');
reset role;

-- 5. Outra empresa não mexe
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.gestao_produto_margem(%L, %L, 10)$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  '42501', null, 'gestor de outra empresa não muda a margem');
select is(public.gestao_precos_salvar(current_setting('testes.empresa_b')::uuid, jsonb_build_array(
    jsonb_build_object('produto_id', current_setting('testes.tabua'), 'margem', 99))), 0, 'pela própria empresa, o produto da outra não muda');
reset role;
select is((select margem_desejada from public.nfe_produtos where id = current_setting('testes.tabua')::uuid), 35.00::numeric, 'margem do produto continua a mesma');

-- 6. Venda: vendas por produto e aviso de estoque abaixo do mínimo
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 100)::text, true);
select public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.tabua'), 'quantidade', 4)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 162))));
select is((select (quantidade, faturamento, custo, vendas, ultima_venda = app.hoje())::text
             from public.gestao_vendas_por_produto(current_setting('testes.empresa_a')::uuid, app.hoje() - 30, app.hoje())
            where produto_id = current_setting('testes.tabua')::uuid),
  '(4.0000,162.00,120.0000000000,1,t)', 'vendas por produto: quantidade, faturamento, custo e última venda');
reset role;
select is((select count(*)::int from public.notificacoes where tipo = 'estoque_baixo' and empresa_id = current_setting('testes.empresa_a')::uuid), 0,
  'quem fez a venda não é avisado de novo (já viu na tela)');
-- Venda pelo operador: o gerente recebe o aviso uma vez
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.tabua'), 'quantidade', 10, 'custo_unitario', 30));
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.caixa2', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 2', 50)::text, true);
select public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa2'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.tabua'), 'quantidade', 10)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 405))));
reset role;
select is((select count(*)::int from public.notificacoes where tipo = 'estoque_baixo' and empresa_id = current_setting('testes.empresa_a')::uuid
            and user_id = '00000000-0000-0000-0000-0000000000b1'), 1, 'gerente avisado quando o estoque fica abaixo do mínimo');

select * from finish();
rollback;
