-- Critérios: a gestão da loja só funciona depois que o escritório liga o
-- módulo; produtos com cubagem e custo médio; caixa com troco, sangria e
-- fechamento; venda com pagamentos divididos (dinheiro com troco + a prazo)
-- baixa o estoque e gera os lançamentos no Financeiro; estoque insuficiente,
-- sangria maior que o dinheiro e desconto acima do limite do operador são
-- recusados; só o gerente cancela (o estoque volta e os lançamentos são
-- cancelados); orçamento vira venda; cada empresa só vê as próprias vendas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(26);

\ir 00_setup.sql.inc

-- Colaborador da empresa A pode vender (operador de caixa), sem ser gerente
update public.empresa_membros set permissoes = permissoes || array['gestao.vender']
 where user_id = '00000000-0000-0000-0000-0000000000b2';

-- 1. Sem o módulo ligado, nada funciona
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.gestao_caixa_abrir(%L, 'Caixa 1', 0)$$, current_setting('testes.empresa_a')),
  '%não está ligada%', 'sem o módulo contratado o caixa não abre');
select throws_like(format($$select public.gestao_configurar(%L, '{"ativa": true}')$$, current_setting('testes.empresa_a')),
  '%não está ligada%', 'o cliente não liga o módulo sozinho');
reset role;

-- 2. O escritório liga o módulo: contas de recebimento criadas
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;
select ok((select ativa and conta_dinheiro_id is not null and conta_pix_id is not null and conta_cartao_id is not null
             from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'escritório liga o módulo e as contas da loja (caixa, banco, maquininha) são criadas');

-- 3. Produtos, entradas e custo médio (gerente = titular)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.viga', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Viga de eucalipto 6x12', 'ncm', '44079990', 'unidade', 'm3', 'valor_unitario', 2500,
  'espessura_cm', 6, 'largura_cm', 12, 'grupo', 'Vigas'))::text, true);
select set_config('testes.ripa', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Ripa de pinus 1x5 3m', 'ncm', '44071100', 'unidade', 'UN', 'valor_unitario', 3.5))::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.viga'), 'quantidade', 2, 'custo_unitario', 1500));
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.viga'), 'quantidade', 1, 'custo_unitario', 1800));
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.ripa'), 'quantidade', 500, 'custo_unitario', 1.8));
reset role;
select is((select (estoque_atual, custo_medio)::text from public.nfe_produtos where id = current_setting('testes.viga')::uuid),
  '(3.0000,1600.000000)', 'duas entradas: 3 m³ com custo médio de R$ 1.600,00');

-- 4. Caixa e venda com cubagem, frete, desconto, dinheiro com troco e a prazo
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 100)::text, true);
select set_config('testes.cliente', public.gestao_cliente_salvar(current_setting('testes.empresa_a')::uuid,
  '{"nome": "Construtora Exemplo Ltda", "documento": "11.222.333/0001-81", "telefone": "(63) 99999-0000"}')::text, true);
select set_config('testes.venda1', (public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa'), 'cliente_id', current_setting('testes.cliente'),
  'itens', jsonb_build_array(
    jsonb_build_object('produto_id', current_setting('testes.viga'), 'pecas', 10, 'comprimento_m', 3),
    jsonb_build_object('produto_id', current_setting('testes.ripa'), 'quantidade', 20)),
  'frete', 30, 'desconto', 10,
  'pagamentos', jsonb_build_array(
    jsonb_build_object('forma', 'dinheiro', 'valor', 200, 'valor_recebido', 250),
    jsonb_build_object('forma', 'a_prazo', 'valor', 430, 'parcelas', 2, 'primeiro_vencimento', (app.hoje() + 30)::text)))) ->> 'id'), true);
reset role;
select is((select (numero, subtotal, total, troco)::text from public.vendas where id = current_setting('testes.venda1')::uuid),
  '(1,610.00,630.00,50.00)', 'venda nº 1: 0,216 m³ de viga (R$ 540) + 20 ripas (R$ 70) + frete − desconto = R$ 630, troco R$ 50');
select is((select quantidade from public.venda_itens where venda_id = current_setting('testes.venda1')::uuid and ordem = 1),
  0.2160::numeric, 'cubagem: 10 peças de 6×12 cm com 3 m = 0,216 m³');
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.viga')::uuid), 2.7840::numeric,
  'o estoque da viga baixa 0,216 m³');
select is((select count(*)::int from public.lancamentos where origem = 'venda' and origem_referencia = current_setting('testes.venda1')), 3,
  'Financeiro: 1 recebimento em dinheiro + 2 parcelas a prazo');
select is((select string_agg(situacao || ':' || valor_previsto, ',' order by data_vencimento, valor_previsto)
             from public.lancamentos where origem = 'venda' and origem_referencia = current_setting('testes.venda1')),
  'quitado:200.00,aberto:215.00,aberto:215.00', 'dinheiro já recebido no caixa; parcelas de R$ 215 em aberto');
select is((select count(*)::int from public.baixas b join public.gestao_config g on g.conta_dinheiro_id = b.conta_financeira_id
            where b.origem = 'venda' and b.empresa_id = current_setting('testes.empresa_a')::uuid), 1,
  'o dinheiro entra na conta "Caixa da loja"');
select is((public.gestao_caixa_resumo(current_setting('testes.caixa')::uuid) ->> 'dinheiro_esperado')::numeric, 300::numeric,
  'dinheiro esperado na gaveta: troco inicial R$ 100 + R$ 200 da venda');

-- 5. Recusas
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.gestao_venda_finalizar(%L, jsonb_build_object('sessao_id', %L,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 100)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 250000))))$$,
    current_setting('testes.empresa_a'), current_setting('testes.caixa'), current_setting('testes.viga')),
  '%Estoque insuficiente%', 'venda maior que o estoque é recusada');
select throws_like(format($$select public.gestao_venda_finalizar(%L, jsonb_build_object('sessao_id', %L,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 2)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 5))))$$,
    current_setting('testes.empresa_a'), current_setting('testes.caixa'), current_setting('testes.ripa')),
  '%soma dos pagamentos%', 'pagamentos que não fecham com o total são recusados');
select throws_like(format($$select public.gestao_venda_finalizar(%L, jsonb_build_object('sessao_id', %L,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 2)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'a_prazo', 'valor', 7, 'primeiro_vencimento', app.hoje()::text))))$$,
    current_setting('testes.empresa_a'), current_setting('testes.caixa'), current_setting('testes.ripa')),
  '%cliente para vender a prazo%', 'venda a prazo sem cliente é recusada');
select throws_like(format($$select public.gestao_caixa_movimento(%L, 'sangria', 400, 'Depósito', null)$$, current_setting('testes.caixa')),
  '%maior que o dinheiro%', 'sangria maior que o dinheiro da gaveta é recusada');
select public.gestao_caixa_movimento(current_setting('testes.caixa')::uuid, 'sangria', 150, 'Depósito no banco',
  (select conta_pix_id from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid));
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"desconto_maximo_operador": 5}');
reset role;
select is((select count(*)::int from public.transferencias where empresa_id = current_setting('testes.empresa_a')::uuid and valor = 150), 1,
  'a sangria para o banco vira transferência no Financeiro');

-- 6. Operador (sem permissão de gerente): limite de desconto e cancelamento
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.caixa2', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 2', 50)::text, true);
select throws_like(format($$select public.gestao_venda_finalizar(%L, jsonb_build_object('sessao_id', %L,
    'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 20, 'preco_unitario', 3)),
    'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 60))))$$,
    current_setting('testes.empresa_a'), current_setting('testes.caixa2'), current_setting('testes.ripa')),
  '%limite do operador%', 'desconto de 14% passa do limite de 5% do operador');
select throws_like(format($$select public.gestao_venda_cancelar(%L, 'Cliente desistiu')$$, current_setting('testes.venda1')),
  '%gestao.gerenciar%', 'operador não cancela venda');
reset role;

-- 7. Gerente cancela: estoque volta, lançamentos cancelados, dinheiro sai do esperado
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_venda_cancelar(current_setting('testes.venda1')::uuid, 'Cliente desistiu da compra');
reset role;
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.viga')::uuid), 3.0000::numeric,
  'cancelamento devolve a viga ao estoque');
select is((select string_agg(distinct situacao, ',') from public.lancamentos where origem = 'venda' and origem_referencia = current_setting('testes.venda1')),
  'cancelado', 'os lançamentos da venda cancelada ficam cancelados');
select is((public.gestao_caixa_resumo(current_setting('testes.caixa')::uuid) ->> 'dinheiro_esperado')::numeric, (-50)::numeric,
  'dinheiro esperado depois da devolução: 100 − 150 de sangria = −50 (a sangria saiu antes do cancelamento)');

-- 8. Orçamento vira venda
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.orc', (public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'cliente_nome', 'Maria Exemplo', 'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.ripa'), 'quantidade', 10)))) ->> 'id'), true);
select public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa'), 'orcamento_id', current_setting('testes.orc'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.ripa'), 'quantidade', 10)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 35))));
reset role;
select is((select status from public.vendas where id = current_setting('testes.orc')::uuid), 'convertido', 'orçamento vira venda');

-- 9. Fechamento com contagem e diferença
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.gestao_caixa_fechar(current_setting('testes.caixa')::uuid, 0, 'Faltou dinheiro da devolução') ->> 'diferenca')::numeric,
  15::numeric, 'fechamento: esperado −50 + 35 = −15; contado 0 → diferença de R$ 15');
reset role;
select is((select status from public.caixa_sessoes where id = current_setting('testes.caixa')::uuid), 'fechado', 'caixa fechado');

-- 10. Isolamento: outra empresa não vê nem vende
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.vendas), 0, 'cliente de outra empresa não vê as vendas');
select throws_like(format($$select public.gestao_caixa_abrir(%L, 'Caixa 9', 0)$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'cliente de outra empresa não abre caixa');
reset role;

select * from finish();
rollback;
