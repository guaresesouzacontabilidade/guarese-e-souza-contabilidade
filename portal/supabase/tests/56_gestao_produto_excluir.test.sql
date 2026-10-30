-- Excluir produto da loja: sem histórico, o produto é apagado (com os
-- lançamentos de estoque feitos à mão); com venda, compra por nota, NF-e
-- emitida, hotel, clínica ou carregamento, é desativado e o histórico fica.
-- Só o responsável pela loja exclui, e só da própria empresa.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.capa', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "CAPA-1", "descricao": "Capa importada por engano", "ncm": "39269090", "unidade": "UN", "valor_unitario": 50}')::text, true);
select set_config('testes.cabo', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "CABO-1", "descricao": "Cabo vendido", "ncm": "85444200", "unidade": "UN", "valor_unitario": 30}')::text, true);
select set_config('testes.fone', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "FONE-1", "descricao": "Fone que saiu em NF-e", "ncm": "85183000", "unidade": "UN", "valor_unitario": 90}')::text, true);
-- Estoque lançado à mão (como na importação da planilha) não segura o produto
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.capa'), 'quantidade', 5, 'custo_unitario', 20));
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.cabo'), 'quantidade', 10, 'custo_unitario', 12));
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 0)::text, true);
select public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.cabo'), 'quantidade', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 30))));
reset role;
-- NF-e emitida com o fone, sem passar pelo caixa (a nota guarda o código do produto nos itens)
insert into public.nfe_emitentes (id, empresa_id, nome, inscricao_estadual, logradouro, numero, bairro, municipio_ibge, cep, serie)
values ('0f000000-0000-0000-0000-00000000056a', current_setting('testes.empresa_a')::uuid, 'Loja A', '290000000', 'Rua A', '1', 'Centro', '1718204', '77500000', 1);
insert into public.nfe_emissoes (empresa_id, emitente_id, ambiente, serie, numero, codigo_numerico, pedido, dados, natureza, destinatario_nome, valor_total)
values (current_setting('testes.empresa_a')::uuid, '0f000000-0000-0000-0000-00000000056a', 'homologacao', 1, 1, '12345678', '{}'::jsonb,
        jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('codigo', 'FONE-1', 'descricao', 'Fone'))), 'VENDA', 'Cliente', 90);

-- A recepção (só vender) não exclui
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format('select public.gestao_produto_excluir(%L, %L)', current_setting('testes.empresa_a'), current_setting('testes.capa')), '42501', null,
  'quem só vende não exclui produto');
reset role;

-- Outra empresa não exclui
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format('select public.gestao_produto_excluir(%L, %L)', current_setting('testes.empresa_a'), current_setting('testes.capa')), '42501', null,
  'cliente de outra empresa não exclui');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.gestao_produto_excluir(current_setting('testes.empresa_a')::uuid, current_setting('testes.capa')::uuid), 'excluido',
  'produto sem histórico (só estoque lançado à mão) é apagado');
select is(public.gestao_produto_excluir(current_setting('testes.empresa_a')::uuid, current_setting('testes.cabo')::uuid), 'desativado',
  'produto já vendido é desativado');
select throws_like(format('select public.gestao_produto_excluir(%L, %L)', current_setting('testes.empresa_b'), current_setting('testes.fone')), '%Acesso negado%',
  'não exclui pela empresa errada');
reset role;
select ok(not exists (select 1 from public.nfe_produtos where id = current_setting('testes.capa')::uuid), 'a capa saiu do cadastro');
select ok(not exists (select 1 from public.estoque_movimentos where produto_id = current_setting('testes.capa')::uuid), 'e o estoque lançado à mão saiu junto');
select is((select ativo from public.nfe_produtos where id = current_setting('testes.cabo')::uuid), false, 'o cabo fica guardado, inativo');
select is((select count(*)::int from public.venda_itens where produto_id = current_setting('testes.cabo')::uuid), 1, 'a venda do cabo continua no histórico');

-- Produto que saiu em NF-e (sem venda no caixa) também é só desativado
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.gestao_produto_excluir(current_setting('testes.empresa_a')::uuid, current_setting('testes.fone')::uuid), 'desativado',
  'produto que saiu em NF-e é desativado (a nota depende dele)');
reset role;

select * from finish();
rollback;
