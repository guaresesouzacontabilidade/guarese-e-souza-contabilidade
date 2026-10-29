-- NF-e: regra fiscal própria do produto. Na mesma nota, a ração com ST sai com a
-- operação dela (CFOP 5.405, CSOSN 500) e o resto com a operação da nota; só na
-- venda comum e no mesmo destino; CSOSN 500/CST 60 aceitos; permissões.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(21);

\ir 00_setup.sql.inc

insert into public.nfe_emitentes (id, empresa_id, nome, inscricao_estadual, logradouro, numero, bairro, municipio_ibge, cep, serie)
values ('0f000000-0000-0000-0000-00000000005a', current_setting('testes.empresa_a')::uuid, 'Clínica', '290000000', 'Rua A', '1', 'Centro', '1718204', '77500000', 1);

-- Equipe: Simples Nacional, venda no balcão (5.102/102) e venda com ST (5.405/500)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": false, "crt": 1, "presenca": 1}'::jsonb)$$,
  'equipe configura a empresa do Simples');
select set_config('testes.op_balcao', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda no balcão",
  "natureza": "VENDA DE MERCADORIA", "destino": "interna", "consumidor_final": true, "cfop": "5102", "icms_cst": "102", "pis_cst": "49", "cofins_cst": "49"}'::jsonb)::text, true);
select set_config('testes.op_st', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda com ST",
  "natureza": "VENDA DE MERCADORIA COM ST", "destino": "interna", "consumidor_final": true, "cfop": "5405", "icms_cst": "500", "pis_cst": "49", "cofins_cst": "49",
  "informacoes": "ICMS retido anteriormente por substituicao tributaria."}'::jsonb)::text, true);
select ok(current_setting('testes.op_st') <> '', 'Simples aceita o CSOSN 500 (ICMS cobrado antes por substituição tributária)');
select throws_like($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "X", "natureza": "X", "destino": "interna",
  "cfop": "5405", "icms_cst": "60", "pis_cst": "49", "cofins_cst": "49"}'::jsonb)$$, '%usa CSOSN%', 'Simples não usa o CST 60 (é do regime normal)');
select set_config('testes.op_fora', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda para outro estado",
  "natureza": "VENDA DE MERCADORIA", "destino": "interestadual", "cfop": "6102", "icms_cst": "102", "pis_cst": "49", "cofins_cst": "49"}'::jsonb)::text, true);
select set_config('testes.op_devolucao', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Devolução de compra",
  "natureza": "DEVOLUCAO DE COMPRA", "finalidade": 4, "destino": "interna", "cfop": "5202", "icms_cst": "900", "pis_cst": "49", "cofins_cst": "49"}'::jsonb)::text, true);

select set_config('testes.shampoo', public.nfe_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "1", "descricao": "Shampoo neutro", "ncm": "33051000", "unidade": "UN"}'::jsonb)::text, true);
select set_config('testes.racao', public.nfe_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'codigo', '2', 'descricao', 'Ração cães adultos 15 kg', 'ncm', '23091000', 'cest', '2200100', 'unidade', 'UN', 'operacao_id', current_setting('testes.op_st')))::text, true);
select is((select operacao_id::text from public.nfe_produtos where id = current_setting('testes.racao')::uuid), current_setting('testes.op_st'),
  'o produto guarda a regra fiscal própria');
select throws_like(format($$select public.nfe_produto_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'codigo', '3', 'descricao', 'Produto X', 'ncm', '23091000', 'unidade', 'UN', 'operacao_id', current_setting('testes.op_devolucao'))),
  '%operação de venda ligada%', 'a regra própria precisa ser uma operação de venda');
-- Editar sem mandar a regra (ex.: outro formulário) mantém a que está gravada
select lives_ok(format($$select public.nfe_produto_salvar(%L, %L, '{"codigo": "2", "descricao": "Ração cães adultos 15 kg", "ncm": "23091000", "unidade": "UN"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.racao')), 'editar o produto sem o campo da regra');
select is((select operacao_id::text from public.nfe_produtos where id = current_setting('testes.racao')::uuid), current_setting('testes.op_st'),
  'a regra própria continua a mesma');
reset role;

-- Empresário: o cliente do balcão e a nota mista
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.tutor', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cpf", "documento": "529.982.247-25",
  "nome": "Tutor da Clínica", "indicador_ie": 9, "logradouro": "Rua B", "numero": "10", "bairro": "Centro", "municipio_ibge": "1718204"}'::jsonb)::text, true);
select set_config('testes.cliente_go', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cpf", "documento": "111.444.777-35",
  "nome": "Cliente de Goiás", "indicador_ie": 9, "logradouro": "Rua C", "numero": "5", "bairro": "Centro", "municipio_ibge": "5218805"}'::jsonb)::text, true);
select set_config('testes.pedido', jsonb_build_object(
  'emitente_id', '0f000000-0000-0000-0000-00000000005a', 'operacao_id', current_setting('testes.op_balcao'), 'destinatario_id', current_setting('testes.tutor'),
  'itens', jsonb_build_array(
    jsonb_build_object('produto_id', current_setting('testes.shampoo'), 'quantidade', '2', 'valor_unitario', '25'),
    jsonb_build_object('produto_id', current_setting('testes.racao'), 'quantidade', '1', 'valor_unitario', '189.90')),
  'transporte', jsonb_build_object('modalidade', 9), 'pagamento', jsonb_build_object('forma', '17'))::text, true);
select set_config('testes.previa', public.nfe_previa(current_setting('testes.empresa_a')::uuid, current_setting('testes.pedido')::jsonb)::text, true);
select is((select string_agg((i ->> 'cfop') || '/' || (i #>> '{icms,cst}'), ' ') from jsonb_array_elements(current_setting('testes.previa')::jsonb -> 'itens') i),
  '5102/102 5405/500', 'na mesma nota: shampoo com a operação da nota e ração com a regra própria (5.405/500)');
select is(current_setting('testes.previa')::jsonb #>> '{itens,1,operacao}', 'Venda com ST', 'a prévia mostra a regra própria do item');
select is(current_setting('testes.previa')::jsonb #> '{itens,0,operacao}', 'null'::jsonb, 'item com a operação da nota fica sem marcação');
select is(current_setting('testes.previa')::jsonb ->> 'natureza', 'VENDA DE MERCADORIA', 'natureza, consumidor final e o resto da nota vêm da operação da nota');
select matches(current_setting('testes.previa')::jsonb ->> 'informacoesComplementares', 'substituicao tributaria',
  'o texto da operação com ST entra nas informações da nota');
select throws_ok($$select public.nfe_produtos_definir_operacao(current_setting('testes.empresa_a')::uuid, null, array[current_setting('testes.racao')::uuid])$$,
  '42501', null, 'o empresário não muda a regra fiscal dos produtos');

-- Para outro estado a regra própria (dentro do estado) não vale: avisa em vez de sair errado
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.pedido')::jsonb
  || jsonb_build_object('operacao_id', current_setting('testes.op_fora'), 'destinatario_id', current_setting('testes.cliente_go'))),
  '%regra fiscal própria (operação "Venda com ST") só para venda dentro do estado%', 'regra própria de outro destino: a nota não sai');
-- Devolução: todos os itens com a operação da nota
select is((select string_agg((i ->> 'cfop') || '/' || (i #>> '{icms,cst}'), ' ') from jsonb_array_elements(public.nfe_previa(current_setting('testes.empresa_a')::uuid,
  current_setting('testes.pedido')::jsonb || jsonb_build_object('operacao_id', current_setting('testes.op_devolucao'),
  'referencias', jsonb_build_array('17261011444777000161550010000000011482137650'))) -> 'itens') i),
  '5202/900 5202/900', 'na devolução a regra própria não vale: todos os itens com a operação da nota');
reset role;

-- Equipe: vários produtos de uma vez e proteção da operação em uso
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(public.nfe_produtos_definir_operacao(current_setting('testes.empresa_a')::uuid, current_setting('testes.op_st')::uuid,
  array[current_setting('testes.shampoo')::uuid, current_setting('testes.racao')::uuid]), 1, 'regra própria em vários produtos (só muda o que estava diferente)');
select is(public.nfe_produtos_definir_operacao(current_setting('testes.empresa_a')::uuid, null, array[current_setting('testes.shampoo')::uuid]), 1,
  'sem regra própria: o produto volta à operação da nota');
select throws_like(format($$select public.nfe_operacao_salvar(%L, %L, '{"nome": "Venda com ST", "natureza": "VENDA COM ST", "destino": "interna",
  "cfop": "5405", "icms_cst": "500", "pis_cst": "49", "cofins_cst": "49", "ativa": false}')$$, current_setting('testes.empresa_a'), current_setting('testes.op_st')),
  '%Tire a regra desses produtos%', 'operação em uso como regra própria não é desligada');
select throws_like(format($$select public.nfe_operacao_salvar(%L, %L, '{"nome": "Venda com ST", "natureza": "VENDA COM ST", "finalidade": 4, "destino": "interna",
  "cfop": "5405", "icms_cst": "500", "pis_cst": "49", "cofins_cst": "49"}')$$, current_setting('testes.empresa_a'), current_setting('testes.op_st')),
  '%continuar como venda%', 'operação em uso como regra própria continua de venda');
reset role;

-- Regra própria que não combina com o regime (gravada por fora) ou desligada: a nota não sai
update public.nfe_operacoes set icms_cst = '60' where id = current_setting('testes.op_st')::uuid;
select throws_like(format($$select app.nfe_montar_dados(%L, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.pedido')),
  '%regra própria do produto Ração%não combina com o regime%', 'regra própria com CST do regime normal numa empresa do Simples');
update public.nfe_operacoes set icms_cst = '500', ativa = false where id = current_setting('testes.op_st')::uuid;
select throws_like(format($$select app.nfe_montar_dados(%L, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.pedido')),
  '%regra fiscal própria do produto Ração cães adultos 15 kg foi desativada%', 'regra própria desligada: avisa para falar com o escritório');

select * from finish();
rollback;
