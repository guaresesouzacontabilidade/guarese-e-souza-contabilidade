-- Conversão de unidade entre compra e venda no cadastro do produto: quem
-- gerencia a loja diz em que unidade compra e quanto cada uma rende na unidade
-- de venda (1 peça = 3 metros). A nota de compra na unidade de compra vira
-- metros no estoque, com o custo por metro; a unidade escrita de outro jeito
-- (PÇ, UND, MTS) conta como a mesma; unidade que não bate fica para conferir.
-- A planilha de produtos traz a conversão e, quando não traz, mantém a atual.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(23);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';

-- 1. Cadastro com a conversão
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.vigota', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'codigo', 'VIG-88', 'descricao', 'Vigota 8x8 tachi preto', 'ncm', '44071100', 'unidade', 'm', 'valor_unitario', 18,
  'gtin', '7891234567895', 'comprimento_m', 3, 'unidade_compra', 'pc', 'fator_compra', '3'))::text, true);
select is((select (unidade, unidade_compra, fator_compra::numeric(10,2))::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '(M,PC,3.00)', 'compro em peça e vendo em metro: 1 peça rende 3 metros');
select throws_ok(format($$select public.gestao_produto_salvar(%L, %L, '{"descricao": "Vigota 8x8 tachi preto", "ncm": "44071100", "unidade": "M", "valor_unitario": 18, "unidade_compra": "M", "fator_compra": 3}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.vigota')), 'P0001', 'A unidade de compra precisa ser diferente da unidade de venda.',
  'unidade de compra igual à de venda é recusada');
select throws_ok(format($$select public.gestao_produto_salvar(%L, %L, '{"descricao": "Vigota 8x8 tachi preto", "ncm": "44071100", "unidade": "M", "valor_unitario": 18, "unidade_compra": "PC", "fator_compra": 0}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.vigota')), 'P0001', 'Informe quanto cada PC rende em M, maior que zero.',
  'rendimento zero é recusado');
select throws_ok(format($$select public.gestao_produto_salvar(%L, %L, '{"descricao": "Vigota 8x8 tachi preto", "ncm": "44071100", "unidade": "M", "valor_unitario": 18, "unidade_compra": "PC", "fator_compra": "três"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.vigota')), 'P0001', 'O rendimento precisa ser um número (ex.: 3 ou 2,5).',
  'rendimento que não é número é recusado');
select throws_ok(format($$select public.gestao_produto_salvar(%L, %L, '{"descricao": "Vigota 8x8 tachi preto", "ncm": "44071100", "unidade": "M", "valor_unitario": 18, "unidade_compra": "", "fator_compra": 3}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.vigota')), 'P0001', 'Escolha a unidade de compra.',
  'rendimento sem a unidade de compra é recusado');
-- Salvar sem mexer na conversão (ex.: outra tela ou a planilha) mantém a atual
select lives_ok(format($$select public.gestao_produto_salvar(%L, %L, '{"codigo": "VIG-88", "descricao": "Vigota 8x8 tachi preto", "ncm": "44071100", "unidade": "M", "valor_unitario": 19, "gtin": "7891234567895"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.vigota')), 'salva o preço sem mandar a conversão');
select is((select (unidade_compra, fator_compra::numeric(10,2), valor_unitario::numeric(10,2))::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '(PC,3.00,19.00)', 'a conversão continua a mesma');
-- Desligar a chave apaga a conversão
select public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.vigota')::uuid, jsonb_build_object(
  'codigo', 'VIG-88', 'descricao', 'Vigota 8x8 tachi preto', 'ncm', '44071100', 'unidade', 'M', 'valor_unitario', 19, 'gtin', '7891234567895',
  'unidade_compra', '', 'fator_compra', ''));
select is((select (unidade_compra, fator_compra)::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '(,)', 'desligar "compro em uma unidade e vendo em outra" apaga a conversão');
select public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.vigota')::uuid, jsonb_build_object(
  'codigo', 'VIG-88', 'descricao', 'Vigota 8x8 tachi preto', 'ncm', '44071100', 'unidade', 'M', 'valor_unitario', 19, 'gtin', '7891234567895',
  'unidade_compra', 'PC', 'fator_compra', 3));
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.gestao_produto_salvar(%L, %L, '{"descricao": "Vigota", "ncm": "44071100", "unidade": "M", "valor_unitario": 19, "unidade_compra": "PC", "fator_compra": 1}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.vigota')), '42501', null, 'quem só vende não muda a conversão');
reset role;

-- 2. Unidades escritas de jeitos diferentes
select is(array[app.unidade_classe('Pç'), app.unidade_classe('und'), app.unidade_classe('PEÇA'), app.unidade_classe('mts'), app.unidade_classe('M³'), app.unidade_classe('cxa')],
  array['UN', 'UN', 'UN', 'M', 'M3', 'CX'], 'PÇ, UND e PEÇA contam como unidade; MTS como metro; M³ e CXA reconhecidos');
select ok(not has_function_privilege('authenticated', 'app.fator_da_nota(uuid, text)', 'execute'), 'a regra interna da conversão não é chamada pelo navegador');

-- 3. Notas de compra (entrada automática)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-11-10', 'esc_outros', 'compras.zip',
  'application/pdf', 1024, md5('conversao') || md5('conversao')) ->> 'documento_id'), true);
reset role;
insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, emitente_documento, emitente_nome, numero)
select ('00000000-0000-0000-0000-00000000c90' || n)::uuid, current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'C90' || n,
       '2026-11-01', 'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', 'Serraria Fornecedora', '90' || n
  from generate_series(1, 4) n;
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, codigo, descricao, ncm, gtin, unidade, quantidade, valor_unitario, valor_total, tributos)
values
  ('00000000-0000-0000-0000-00000000c901', current_setting('testes.empresa_a')::uuid, 1, 'V88', 'VIGOTA 8X8 TACHI', '44071100', '7891234567895', 'PÇ', 10, 30, 300, '{}'),
  ('00000000-0000-0000-0000-00000000c902', current_setting('testes.empresa_a')::uuid, 1, 'V88', 'VIGOTA 8X8 TACHI', '44071100', '7891234567895', 'MTS', 12, 10.5, 126, '{}'),
  ('00000000-0000-0000-0000-00000000c903', current_setting('testes.empresa_a')::uuid, 1, 'V88', 'VIGOTA 8X8 TACHI', '44071100', '7891234567895', 'CX', 2, 400, 800, '{}'),
  ('00000000-0000-0000-0000-00000000c904', current_setting('testes.empresa_a')::uuid, 1, 'V88X', 'VIGOTA 8X8 TACHI', '44071100', '7891234567895', 'UN', 5, 33, 165, '{}');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_entrada_automatica_definir(current_setting('testes.empresa_a')::uuid, true);
reset role;

select is(public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000c901') ->> 'situacao', 'lancada', 'nota em peças entra sozinha');
select is((select (estoque_atual, preco_custo)::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '(30.0000,10.0000)', '10 peças = 30 metros, a R$ 10,00 o metro (R$ 30,00 a peça ÷ 3)');
select is(public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000c902') ->> 'situacao', 'lancada', 'nota já em metros (MTS) entra sozinha');
select is((select estoque_atual::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '42.0000', 'nota em metros não é convertida: 12 metros a mais');
select is(public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000c903'), '{"faltam": 1, "situacao": "pendente"}'::jsonb,
  'nota em caixa (nem peça nem metro): espera alguém conferir, sem chutar');
select is((select estoque_atual::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '42.0000', 'o estoque não muda com a nota que espera conferência');

-- 4. Importar a nota de uma vez (pelo código de barras)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000c904', null, null) ->> 'situacao', 'lancada',
  'importar a nota em UN (unidade = peça) pelo código de barras');
select is((select estoque_atual::text from public.nfe_produtos where id = current_setting('testes.vigota')::uuid),
  '57.0000', '5 unidades = 15 metros');
select is((select fator::numeric(10,2)::text from public.estoque_vinculos where empresa_id = current_setting('testes.empresa_a')::uuid and codigo_fornecedor = 'V88X'),
  '3.00', 'o vínculo com o fornecedor guarda o rendimento para as próximas notas');

-- 5. Planilha de produtos
select is(public.gestao_importar_produtos(current_setting('testes.empresa_a')::uuid, jsonb_build_array(
    jsonb_build_object('linha', 2, 'codigo', 'TAB-30', 'descricao', 'Tábua pinus 30cm', 'ncm', '44071100', 'unidade', 'M',
                       'preco_venda', 12, 'unidade_compra', 'PC', 'fator_compra', '4,5'),
    jsonb_build_object('linha', 3, 'codigo', 'VIG-88', 'preco_venda', 20)
  )) ->> 'novos', '1', 'planilha cria o produto com a conversão');
reset role;
select is((select string_agg(codigo || ':' || coalesce(unidade_compra, '-') || '=' || coalesce(fator_compra::numeric(10,2)::text, '-'), ', ' order by codigo)
             from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid and codigo in ('TAB-30', 'VIG-88')),
  'TAB-30:PC=4.50, VIG-88:PC=3.00', 'vírgula vale como decimal; a linha sem conversão mantém a que já existia');
-- Venda passou a ser em peça: a conversão perde o sentido e sai
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_importar_produtos(current_setting('testes.empresa_a')::uuid, '[{"linha": 2, "codigo": "TAB-30", "unidade": "PC"}]');
reset role;
select is((select (unidade, unidade_compra)::text from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = 'TAB-30'),
  '(PC,)', 'venda na mesma unidade da compra: a conversão some');

select * from finish();
rollback;
