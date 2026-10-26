-- Critérios: importar a nota de compra lança TODOS os itens de uma vez, tudo
-- ou nada: o item vai para o produto do mesmo código de barras ou da mesma
-- descrição; o que não existe vira produto novo uma vez só (mesmo repetido na
-- nota), com preço de venda = custo + margem; os vínculos ficam lembrados.
-- Faltando dado (NCM, margem), nada é gravado e o motivo volta. A nota lida
-- do PDF fica registrada pela chave: não entra duas vezes, nem quando o XML
-- dela chega depois. PDF de nota que já está no portal usa os dados do XML.
-- Nota emitida pela própria empresa não entra pelo PDF. Só o gerente importa.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

-- O escritório liga a loja; o gerente tem um prego (com código de barras) e um martelo
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-10-10', 'esc_outros', 'compras.zip',
  'application/pdf', 1024, md5('importar') || md5('importar')) ->> 'documento_id'), true);
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prego', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'codigo', 'P-1', 'descricao', 'Prego 17x27', 'ncm', '73170020', 'unidade', 'KG', 'valor_unitario', 25, 'gtin', '7891234567895'))::text, true);
select set_config('testes.martelo', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'codigo', 'P-2', 'descricao', 'Martelo  unha 27mm', 'ncm', '82052000', 'unidade', 'UN', 'valor_unitario', 55))::text, true);
reset role;

insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, emitente_documento, emitente_nome, numero, chave_acesso)
values
  ('00000000-0000-0000-0000-00000000d601', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E601', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', 'Ferragens Teste', '601', '17261033444555000181550010000006011000006010'),
  ('00000000-0000-0000-0000-00000000d602', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E602', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', 'Ferragens Teste', '602', null),
  ('00000000-0000-0000-0000-00000000d604', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E604', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', 'Ferragens Teste', '604', '17261033444555000181550010000006041000006044');
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, codigo, descricao, ncm, gtin, unidade, quantidade, valor_unitario, valor_total, valor_desconto, tributos)
values
  ('00000000-0000-0000-0000-00000000d601', current_setting('testes.empresa_a')::uuid, 1, 'PRG', 'PREGO 17X27 KG', '73170020', '7891234567895', 'KG', 10, 12, 120, null, '{}'),
  ('00000000-0000-0000-0000-00000000d601', current_setting('testes.empresa_a')::uuid, 2, 'MART', 'MARTELO UNHA 27MM', '82052000', null, 'UN', 4, 30, 120, null, '{}'),
  ('00000000-0000-0000-0000-00000000d601', current_setting('testes.empresa_a')::uuid, 3, 'SERR', 'SERROTE 22 POL', '82021000', null, 'UN', 2, 70, 140, 10, '{}'),
  ('00000000-0000-0000-0000-00000000d601', current_setting('testes.empresa_a')::uuid, 4, 'SERR', 'SERROTE 22 POL', '82021000', null, 'UN', 1, 65, 65, null, '{}'),
  ('00000000-0000-0000-0000-00000000d602', current_setting('testes.empresa_a')::uuid, 1, 'X1', 'ITEM SEM NCM', null, null, 'UN', 1, 10, 10, null, '{}'),
  ('00000000-0000-0000-0000-00000000d604', current_setting('testes.empresa_a')::uuid, 1, 'PRG', 'PREGO 17X27 KG', '73170020', null, 'KG', 5, 12, 60, null, '{}');

-- 1. Nota do XML: código de barras, mesma descrição, produto novo (repetido na nota)
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.gestao_importar_nota(%L, '00000000-0000-0000-0000-00000000d601', null, 50)$$, current_setting('testes.empresa_a')),
  '42501', null, 'quem não gerencia a loja não importa nota');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.r1', public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000d601', null, 50)::text, true);
select is((current_setting('testes.r1')::jsonb - 'produtos' - 'documento_fiscal_id' - 'nota_pdf_id'),
  '{"situacao": "lancada", "origem": "xml", "numero": "601", "fornecedor": "Ferragens Teste", "itens": 4, "produtos_novos": 1}'::jsonb,
  'todos os itens lançados de uma vez, com um produto novo');
select is((select string_agg(p ->> 'modo', ',') from jsonb_array_elements(current_setting('testes.r1')::jsonb -> 'produtos') p),
  'gtin,descricao,novo,novo', 'prego pelo código de barras, martelo pela descrição, serrote novo');
select is((select estoque_atual::text from public.nfe_produtos where id = current_setting('testes.prego')::uuid), '10.0000', 'prego: 10 kg no estoque');
select is((select (estoque_atual, preco_custo)::text from public.nfe_produtos where id = current_setting('testes.martelo')::uuid), '(4.0000,30.0000)',
  'martelo: 4 unidades com o custo da nota');
select is((select count(*)::int from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'SERROTE 22 POL'), 1,
  'item repetido na nota: um produto só');
select is((select (estoque_atual, preco_custo, valor_unitario::numeric(10,2), ncm, unidade)::text from public.nfe_produtos
            where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'SERROTE 22 POL'),
  '(3.0000,65.0000,97.50,82021000,UN)', 'serrote: 3 no estoque, custo líquido do desconto e preço = custo + 50%');
select is((select margem_entrada::text from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid), '50.00', 'margem lembrada');
select is((select string_agg(codigo_fornecedor, ',' order by codigo_fornecedor) from public.estoque_vinculos
            where empresa_id = current_setting('testes.empresa_a')::uuid and fornecedor_documento = '33444555000181'),
  'MART,PRG,SERR', 'vínculos lembrados: a próxima nota do fornecedor entra sozinha');
select is(public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000d601', null, 50) ->> 'situacao', 'ja_lancada',
  'a mesma nota não entra duas vezes');
select throws_like(format($$select public.gestao_entrada_nota(%L, '00000000-0000-0000-0000-00000000d601', '[{"numero_item": 1, "produto_id": "%s", "quantidade": 1, "custo_unitario": 1}]')$$,
  current_setting('testes.empresa_a'), current_setting('testes.prego')), '%já deu entrada%', 'nem pela conferência manual');

-- 2. Falta dado: nada é gravado e o motivo volta
select set_config('testes.qtd', (select count(*)::text from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid), true);
select is(public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000d602', null, 30) -> 'motivos',
  '["Item 1 (ITEM SEM NCM): sem NCM para cadastrar o produto novo."]'::jsonb, 'item novo sem NCM: pede conferência');
select is(public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000d602', null, null) -> 'motivos',
  '["Informe a margem de lucro para cadastrar os produtos novos.", "Item 1 (ITEM SEM NCM): sem NCM para cadastrar o produto novo."]'::jsonb,
  'sem a margem, não cria produto novo');
select is((select count(*)::text from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid), current_setting('testes.qtd'),
  'em conferência, nenhum produto é criado');
select is((select count(*)::int from public.estoque_movimentos where documento_fiscal_id = '00000000-0000-0000-0000-00000000d602'), 0,
  'e nada entra no estoque');

-- 3. Nota lida do PDF (outro fornecedor): martelo pela descrição e um alicate novo
select set_config('testes.pdf', jsonb_build_object(
  'chave', '17261044555666000172550010000007001000007005', 'numero', '700', 'serie', '1', 'emitente_documento', '44555666000172',
  'emitente_nome', 'Distribuidora PDF', 'data_emissao', '2026-10-20', 'valor_total', '150.00',
  'itens', jsonb_build_array(
    jsonb_build_object('numero_item', 1, 'codigo', 'M-27', 'descricao', 'MARTELO UNHA 27MM', 'ncm', '82052000', 'unidade', 'UN', 'quantidade', '2', 'valor_total', '62'),
    jsonb_build_object('numero_item', 2, 'codigo', 'AL-8', 'descricao', 'ALICATE UNIVERSAL 8', 'ncm', '82032000', 'unidade', 'UN', 'quantidade', '3', 'valor_total', '88', 'valor_desconto', '1')
  ))::text, true);
select set_config('testes.r2', public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, null, current_setting('testes.pdf')::jsonb, 40)::text, true);
select is((current_setting('testes.r2')::jsonb ->> 'situacao') || '/' || (current_setting('testes.r2')::jsonb ->> 'origem') || '/' || (current_setting('testes.r2')::jsonb ->> 'produtos_novos'),
  'lancada/pdf/1', 'nota do PDF lançada, com o alicate novo');
select is((select (estoque_atual, valor_unitario::numeric(10,2))::text from public.nfe_produtos
            where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'ALICATE UNIVERSAL 8'),
  '(3.0000,40.60)', 'alicate: 3 unidades, preço = (88 − 1) ÷ 3 + 40%');
select is((select count(*)::int from public.estoque_movimentos m join public.nfe_produtos p on p.id = m.produto_id
            where p.empresa_id = current_setting('testes.empresa_a')::uuid and m.observacao = 'Nota 700 — Distribuidora PDF (lida do PDF)'), 2,
  'os movimentos dizem de qual nota vieram');
select is(public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, null, current_setting('testes.pdf')::jsonb, 40) ->> 'situacao', 'ja_lancada',
  'o mesmo PDF não entra duas vezes');
select is((select count(*)::int from public.estoque_notas_pdf), 1, 'o gerente vê a nota lançada pelo PDF');
select throws_ok($$insert into public.estoque_notas_pdf (empresa_id, chave, emitente_documento) values (gen_random_uuid(), repeat('1', 44), '44555666000172')$$,
  '42501', null, 'ninguém grava direto na tabela');
select throws_like(format($$select public.gestao_importar_nota(%L, null, %L, 40)$$, current_setting('testes.empresa_a'),
    jsonb_set(jsonb_set(current_setting('testes.pdf')::jsonb, '{chave}', '"17261011444777000161550010000000011000000015"'), '{emitente_documento}', '"11444777000161"')),
  '%emitida pela própria empresa%', 'nota emitida pela própria empresa não entra pelo PDF');

-- 4. PDF de nota que já está no portal pelo XML: usa os dados do XML
select is(public.gestao_importar_nota(current_setting('testes.empresa_a')::uuid, null,
    jsonb_set(current_setting('testes.pdf')::jsonb, '{chave}', '"17261033444555000181550010000006041000006044"'), 40) ->> 'documento_fiscal_id',
  '00000000-0000-0000-0000-00000000d604', 'o PDF de uma nota que já tem XML entra pelo XML');
reset role;

-- 5. O XML da nota lançada pelo PDF chega depois: não entra de novo
insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, emitente_documento, emitente_nome, numero, chave_acesso)
values ('00000000-0000-0000-0000-00000000d700', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E700', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '44555666000172', 'Distribuidora PDF', '700', '17261044555666000172550010000007001000007005');
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, codigo, descricao, ncm, unidade, quantidade, valor_unitario, valor_total, tributos)
values ('00000000-0000-0000-0000-00000000d700', current_setting('testes.empresa_a')::uuid, 1, 'M-27', 'MARTELO UNHA 27MM', '82052000', 'UN', 2, 31, 62, '{}');
update public.gestao_config set entrada_automatica = true where empresa_id = current_setting('testes.empresa_a')::uuid;
select is(public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000d700') ->> 'situacao', 'ja_lancada',
  'o XML que chega depois não entra de novo no estoque');

select * from finish();
rollback;
