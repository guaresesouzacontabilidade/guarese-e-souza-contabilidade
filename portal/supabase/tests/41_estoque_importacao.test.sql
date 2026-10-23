-- Critérios: a planilha cria e atualiza produtos e acerta o estoque, tudo ou
-- nada (a linha com erro aparece na mensagem); só o gerente importa. A entrada
-- pela nota cria o produto a partir do item e lembra o vínculo do fornecedor
-- com o fator de conversão (caixa → kg). Com a entrada automática ligada, a
-- próxima nota do mesmo fornecedor entra sozinha (quantidade × fator e custo
-- por unidade da loja); nota com item sem vínculo fica esperando conferência,
-- com aviso ao gerente. Só o servidor chama a entrada automática.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

\ir 00_setup.sql.inc

-- O escritório liga a loja
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

-- 1. Planilha: um produto novo e um existente (só o que veio muda)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.p200', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'codigo', 'P-200', 'descricao', 'Parafuso sextavado 1/4', 'ncm', '73181500', 'unidade', 'UN', 'valor_unitario', 0.8, 'grupo', 'Fixação'))::text, true);
select is(public.gestao_importar_produtos(current_setting('testes.empresa_a')::uuid, jsonb_build_array(
    jsonb_build_object('linha', 2, 'codigo', 'P-100', 'descricao', 'Prego 17x27', 'ncm', '73170020', 'unidade', 'kg',
                       'preco_venda', 25, 'preco_custo', 14, 'estoque', 40, 'estoque_minimo', 10),
    jsonb_build_object('linha', 3, 'codigo', 'P-200', 'preco_venda', 0.95, 'estoque', 300)
  )), '{"novos": 1, "estoque": 2, "atualizados": 1}'::jsonb, 'planilha: 1 novo, 1 atualizado e o estoque dos dois');
select is((select (estoque_atual, custo_medio, estoque_minimo, unidade)::text from public.nfe_produtos
            where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = 'P-100'),
  '(40.0000,14.000000,10.0000,KG)', 'produto novo com o saldo e o custo da planilha');
select is((select (descricao, valor_unitario::numeric(10,2), grupo, estoque_atual)::text from public.nfe_produtos where id = current_setting('testes.p200')::uuid),
  '("Parafuso sextavado 1/4",0.95,Fixação,300.0000)', 'existente: só o preço e o estoque mudam');
select set_config('testes.qtd', (select count(*)::text from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid), true);
select throws_like(format($$select public.gestao_importar_produtos(%L, %L)$$, current_setting('testes.empresa_a'),
    '[{"linha": 2, "codigo": "P-300", "descricao": "Arruela", "ncm": "73182200", "unidade": "UN", "preco_venda": 0.1},
      {"linha": 3, "codigo": "P-301", "descricao": "Sem NCM", "unidade": "UN", "preco_venda": 1}]'),
  'Linha 3:%', 'linha com erro: a mensagem diz qual é');
select is((select count(*)::text from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid), current_setting('testes.qtd'),
  'tudo ou nada: com uma linha errada, nada é gravado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.gestao_importar_produtos(%L, '[{"linha": 2, "codigo": "X"}]')$$, current_setting('testes.empresa_a')),
  '42501', null, 'quem não gerencia a loja não importa');
reset role;

-- 2. Nota de compra: caixa de prego (12 kg) e um martelo que ainda não existe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-10-10', 'esc_outros', 'compras.zip',
  'application/pdf', 1024, md5('estoque') || md5('estoque')) ->> 'documento_id'), true);
reset role;
insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, emitente_documento, emitente_nome, numero)
values
  ('00000000-0000-0000-0000-00000000d501', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E501', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33.444.555/0001-81', 'Ferragens Fornecedor Teste', '501'),
  ('00000000-0000-0000-0000-00000000d502', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E502', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', 'Ferragens Fornecedor Teste', '502'),
  ('00000000-0000-0000-0000-00000000d503', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'E503', '2026-10-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', 'Ferragens Fornecedor Teste', '503');
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, codigo, descricao, ncm, unidade, quantidade, valor_unitario, valor_total, tributos)
values
  ('00000000-0000-0000-0000-00000000d501', current_setting('testes.empresa_a')::uuid, 1, 'CX-PREGO', 'CX PREGO 17X27 12KG', '73170020', 'CX', 2, 150, 300, '{}'),
  ('00000000-0000-0000-0000-00000000d501', current_setting('testes.empresa_a')::uuid, 2, 'MART-01', 'MARTELO UNHA 27MM', '82052000', 'UN', 3, 30, 90, '{}'),
  ('00000000-0000-0000-0000-00000000d502', current_setting('testes.empresa_a')::uuid, 1, 'CX-PREGO', 'CX PREGO 17X27 12KG', '73170020', 'CX', 1, 156, 156, '{}'),
  ('00000000-0000-0000-0000-00000000d502', current_setting('testes.empresa_a')::uuid, 2, 'MART-01', 'MARTELO UNHA 27MM', '82052000', 'UN', 2, 32, 64, '{}'),
  ('00000000-0000-0000-0000-00000000d503', current_setting('testes.empresa_a')::uuid, 1, 'SERROTE', 'SERROTE 22 POL', '82021000', 'UN', 1, 70, 70, '{}');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.gestao_entrada_nota(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000d501', jsonb_build_array(
    jsonb_build_object('numero_item', 1, 'produto_id', (select id from public.nfe_produtos where codigo = 'P-100' and empresa_id = current_setting('testes.empresa_a')::uuid),
                       'quantidade', 24, 'custo_unitario', 12.5, 'fator', 12),
    jsonb_build_object('numero_item', 2, 'novo', jsonb_build_object('descricao', 'Martelo unha 27mm', 'ncm', '82052000', 'unidade', 'UN', 'valor_unitario', 55),
                       'quantidade', 3, 'custo_unitario', 30)
  )), 2, 'entrada pela nota: um produto existente e um criado a partir do item');
reset role;
select is((select estoque_atual::text from public.nfe_produtos where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = 'P-100'),
  '64.0000', 'duas caixas de 12 kg: 24 kg a mais');
select is((select (estoque_atual, preco_custo, valor_unitario::numeric(10,2))::text from public.nfe_produtos
            where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'Martelo unha 27mm'),
  '(3.0000,30.0000,55.00)', 'produto novo com estoque, custo e o preço de venda informado');
select is((select string_agg(codigo_fornecedor || '=' || fator::numeric(10,1), ', ' order by codigo_fornecedor) from public.estoque_vinculos
            where empresa_id = current_setting('testes.empresa_a')::uuid and fornecedor_documento = '33444555000181'),
  'CX-PREGO=12.0, MART-01=1.0', 'vínculos do fornecedor lembrados, com o fator da caixa');

-- 3. Entrada automática
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.gestao_entrada_automatica_definir(%L, true)$$, current_setting('testes.empresa_a')),
  'o gerente liga a entrada automática');
select throws_ok($$select public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000d502')$$,
  '42501', null, 'só o servidor chama a entrada automática');
reset role;

select is(public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000d502') ->> 'situacao', 'lancada',
  'nota com todos os itens ligados entra sozinha');
select is((select string_agg(descricao || ':' || estoque_atual::numeric(10,1) || '@' || preco_custo::numeric(10,2), ', ' order by descricao) from public.nfe_produtos
            where empresa_id = current_setting('testes.empresa_a')::uuid and (codigo = 'P-100' or descricao = 'Martelo unha 27mm')),
  'Martelo unha 27mm:5.0@32.00, Prego 17x27:76.0@13.00', '1 caixa = 12 kg a R$ 13,00/kg; martelos com o custo da nota');
select is(public.estoque_entrada_automatica('00000000-0000-0000-0000-00000000d503'), '{"faltam": 1, "situacao": "pendente"}'::jsonb,
  'item sem vínculo: a nota espera a conferência');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'estoque_entrada'), 2,
  'o gerente é avisado da nota lançada e da que espera conferência');

select * from finish();
rollback;
