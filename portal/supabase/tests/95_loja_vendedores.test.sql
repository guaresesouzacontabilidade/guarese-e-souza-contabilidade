-- Vendedores da loja e comissões: cadastro só por quem gerencia; vendedor no
-- orçamento e na venda (o do orçamento vai junto; sem escolha, vale o ligado ao
-- login); % gravado na venda; base sem frete; vendedor obrigatório e inativo;
-- cada vendedor vê só as próprias comissões; troca com motivo; lançar no
-- Contas a pagar uma vez só.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(23);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;
-- b2: só vende (balcão)
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select set_config('testes.cat', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and natureza = 'despesa' and not sintetica and ativa order by codigo limit 1), true);

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prod', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "MESA-1", "descricao": "Mesa", "ncm": "94036000", "unidade": "UN", "valor_unitario": 100}')::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.prod'), 'quantidade', 50, 'custo_unitario', 40));
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 0)::text, true);
insert into public.loja_vendedores (empresa_id, nome, comissao_percentual)
values (current_setting('testes.empresa_a')::uuid, 'Ana Vendas', 5);
insert into public.loja_vendedores (empresa_id, nome, comissao_percentual, usuario_id)
values (current_setting('testes.empresa_a')::uuid, 'Bruno Balcão', 3, '00000000-0000-0000-0000-0000000000b2');
select set_config('testes.ana', (select id::text from public.loja_vendedores where nome = 'Ana Vendas'), true);
select set_config('testes.bruno', (select id::text from public.loja_vendedores where nome = 'Bruno Balcão'), true);
reset role;

-- Cadastro: só quem gerencia
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$insert into public.loja_vendedores (empresa_id, nome) values (%L, 'Carlos')$$, current_setting('testes.empresa_a')),
  '42501', null, 'quem só vende não cadastra vendedor');
select is((select count(*)::int from public.loja_vendedores), 1, 'o vendedor com login vê só o próprio cadastro (sem o % dos outros)');
select is((select count(*)::int from public.loja_vendedores_lista(current_setting('testes.empresa_a')::uuid) where ativo), 2, 'no caixa aparecem os vendedores ativos');
select is((select nome from public.loja_vendedores_lista(current_setting('testes.empresa_a')::uuid) where meu), 'Bruno Balcão', 'e o dele vem marcado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format('select * from public.loja_vendedores_lista(%L)', current_setting('testes.empresa_a')), '42501', null,
  'outra empresa não vê os vendedores');
select is((select count(*)::int from public.loja_vendedores), 0, 'nem pela tabela');
reset role;

-- Orçamento com a Ana; outro sem escolha, feito pelo Bruno (vale o login dele)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.orc', (public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'loja_vendedor_id', current_setting('testes.ana'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 2)))) ->> 'id'), true);
reset role;
select is((select loja_vendedor_id::text from public.vendas where id = current_setting('testes.orc')::uuid), current_setting('testes.ana'),
  'o orçamento guarda o vendedor escolhido');

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.orc2', (public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 1)))) ->> 'id'), true);
select set_config('testes.caixa2', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 2', 0)::text, true);
-- Bruno converte o orçamento da Ana em venda: a venda é da Ana (com desconto e frete)
select set_config('testes.venda1', (public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa2'), 'orcamento_id', current_setting('testes.orc'), 'desconto', 10, 'frete', 15,
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 2)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 205)))) ->> 'id'), true);
-- Venda direta do Bruno, sem escolher vendedor
select set_config('testes.venda2', (public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa2'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100)))) ->> 'id'), true);
reset role;
select is((select loja_vendedor_id::text from public.vendas where id = current_setting('testes.orc2')::uuid), current_setting('testes.bruno'),
  'sem escolha, o orçamento fica com o vendedor ligado a quem está logado');
select is((select loja_vendedor_id::text from public.vendas where id = current_setting('testes.venda1')::uuid), current_setting('testes.ana'),
  'na conversão, o vendedor do orçamento vai para a venda');
select results_eq(format('select percentual, base, valor from public.venda_comissoes where venda_id = %L', current_setting('testes.venda1')),
  $$values (5.00::numeric(5,2), 190.00::numeric(15,2), 9.50::numeric(15,2))$$,
  'comissão de 5% sobre os produtos com desconto, sem o frete (R$ 190 → R$ 9,50)');
select is((select valor from public.venda_comissoes where venda_id = current_setting('testes.venda2')::uuid), 3.00::numeric(15,2),
  'venda do Bruno: 3% de R$ 100');

-- Mudar o % depois não mexe nas vendas antigas
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.loja_vendedores set comissao_percentual = 10 where id = current_setting('testes.ana')::uuid;
reset role;
select is((select percentual from public.venda_comissoes where venda_id = current_setting('testes.venda1')::uuid), 5.00::numeric(5,2),
  'o % fica gravado na venda');

-- Cada vendedor vê só as próprias comissões; quem gerencia vê todas
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.venda_comissoes), 1, 'o Bruno vê só a comissão dele');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.venda_comissoes), 2, 'quem gerencia a loja vê todas');
reset role;

-- Vendedor obrigatório e vendedor inativo
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.loja_vendedor_obrigatorio_definir(current_setting('testes.empresa_a')::uuid, true);
select throws_like(format($$select public.gestao_venda_finalizar(%L, jsonb_build_object('sessao_id', %L,
  'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 100))))$$,
  current_setting('testes.empresa_a'), current_setting('testes.caixa'), current_setting('testes.prod')),
  'Escolha o vendedor.', 'com vendedor obrigatório, a venda sem vendedor é recusada');
update public.loja_vendedores set ativo = false where id = current_setting('testes.bruno')::uuid;
select throws_like(format($$select public.gestao_orcamento_salvar(%L, null, jsonb_build_object('loja_vendedor_id', %L,
  'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1))))$$,
  current_setting('testes.empresa_a'), current_setting('testes.bruno'), current_setting('testes.prod')),
  '%está inativo%', 'vendedor inativo não entra em orçamento novo');
update public.loja_vendedores set ativo = true where id = current_setting('testes.bruno')::uuid;
select public.loja_vendedor_obrigatorio_definir(current_setting('testes.empresa_a')::uuid, false);
reset role;

-- Troca de vendedor: só quem gerencia, com motivo, e fica no histórico
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format('select public.loja_venda_trocar_vendedor(%L, %L, %L)', current_setting('testes.venda2'), current_setting('testes.ana'), 'Teste'),
  '42501', null, 'quem só vende não troca o vendedor');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format('select public.loja_venda_trocar_vendedor(%L, %L, %L)', current_setting('testes.venda2'), current_setting('testes.ana'), ''),
  '%motivo%', 'a troca pede o motivo');
select public.loja_venda_trocar_vendedor(current_setting('testes.venda2')::uuid, current_setting('testes.ana')::uuid, 'Atendimento foi da Ana');
reset role;
select results_eq(format('select loja_vendedor_id::text, percentual from public.venda_comissoes where venda_id = %L', current_setting('testes.venda2')),
  format($$values (%L, 10.00::numeric(5,2))$$, current_setting('testes.ana')),
  'a comissão passa para a Ana, com o % dela hoje');
select is((select count(*)::int from public.venda_vendedor_trocas where venda_id = current_setting('testes.venda2')::uuid and motivo = 'Atendimento foi da Ana'), 1,
  'a troca fica no histórico');

-- Lançar as comissões no Contas a pagar: um título por vendedor, uma vez só
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.loja_comissoes_lancar(current_setting('testes.empresa_a')::uuid, app.hoje() - 30, app.hoje(), app.hoje() + 10,
  current_setting('testes.cat')::uuid) ->> 'total', '19.50', 'lança R$ 19,50 (9,50 + 10,00) das vendas da Ana');
select is(public.loja_comissoes_lancar(current_setting('testes.empresa_a')::uuid, app.hoje() - 30, app.hoje(), app.hoje() + 10,
  current_setting('testes.cat')::uuid) ->> 'lancamentos', '0', 'lançar de novo não duplica');
select throws_like(format('select public.loja_venda_trocar_vendedor(%L, %L, %L)', current_setting('testes.venda2'), current_setting('testes.bruno'), 'Voltar'),
  '%já foi lançada%', 'com a comissão lançada, não troca o vendedor');
reset role;

select * from finish();
rollback;
