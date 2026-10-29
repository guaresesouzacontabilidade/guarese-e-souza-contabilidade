-- Critérios: o processador grava os grupos de itens de cada achado
-- (criterios); o relatório de correções acha por eles todos os produtos e
-- notas do achado (só os itens do mesmo grupo); só a equipe com o auditor
-- monta o relatório — o cliente e quem não atende a empresa são barrados.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

\ir 00_setup.sql.inc

-- Notas de venda de 09/2026: dipirona saiu com CSOSN 102 em duas notas; o xampu, com CSOSN 500 (não entra)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-10', 'esc_outros', 'vendas.zip',
  'application/pdf', 1024, md5('relatorio') || md5('relatorio')) ->> 'documento_id'), true);
reset role;
insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, numero, data_emissao)
values
  ('00000000-0000-0000-0000-00000000f101', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '65', 'NFC-e', 'R101', '2026-09-01',
   'saida', 'protocolo_autorizacao_no_arquivo', true, '{}', '101', '2026-09-10 10:00-03'),
  ('00000000-0000-0000-0000-00000000f102', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '65', 'NFC-e', 'R102', '2026-09-01',
   'saida', 'protocolo_autorizacao_no_arquivo', true, '{}', '102', '2026-09-12 10:00-03');
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total, tributos)
values
  ('00000000-0000-0000-0000-00000000f101', current_setting('testes.empresa_a')::uuid, 1, '789', 'DIPIRONA 500MG', '30049099', '5102', 'UN', 10, 18, 180,
   '{"csosn": "102", "cst_pis": "49", "cst_cofins": "49"}'),
  ('00000000-0000-0000-0000-00000000f101', current_setting('testes.empresa_a')::uuid, 2, '790', 'SHAMPOO 300ML', '33051000', '5405', 'UN', 1, 20, 20,
   '{"csosn": "500", "cst_pis": "49", "cst_cofins": "49"}'),
  ('00000000-0000-0000-0000-00000000f102', current_setting('testes.empresa_a')::uuid, 1, '789', 'DIPIRONA 500MG', '30049099', '5102', 'UN', 10, 18, 180,
   '{"csosn": "102", "cst_pis": "49", "cst_cofins": "49"}');

-- Processador grava o achado com o grupo da dipirona
select set_config('request.jwt.claims', '{}', true);
insert into public.auditor_execucoes (id, empresa_id, origem, situacao)
values ('00000000-0000-0000-0000-00000000e101', current_setting('testes.empresa_a')::uuid, 'automatica', 'processando');
select public.auditor_registrar_resultado('00000000-0000-0000-0000-00000000e101', $$[
  {"regra":"st_simples","chave":"st_simples:2026-09","competencia":"2026-09-01","tipo":"oportunidade","confianca":"alta",
   "titulo":"ICMS-ST pago de novo no DAS — 09/2026","resumo":"Resumo de teste.","valor_base":"360.00","valor_estimado":"8.11",
   "memoria":[],"referencias":[],"fontes":[{"titulo":"LC 123/2006"}],
   "criterios":[{"competencia":"2026-09-01","operacao":"saida","modelo":"65","cfop":"5102","ncm":"30049099","gtin":null,"cest":null,"ex":null,
                 "csosn":"102","cst_icms":null,"cst_pis":"49","cst_cofins":"49","motivo":"comprado com ST, vendido como tributado"}]},
  {"regra":"ncm_invalido","chave":"ncm_invalido:2026-09","competencia":"2026-09-01","tipo":"risco","confianca":"alta",
   "titulo":"NCM inválido — 09/2026","resumo":"Resumo de teste.","valor_base":"10.00","valor_estimado":null,
   "memoria":[],"referencias":[],"fontes":[]}
]$$::jsonb, '{"notas": 2, "itens": 3, "periodo_inicio": "2021-09-01", "periodo_fim": "2026-10-01"}'::jsonb);
select set_config('testes.achado', (select id::text from public.auditor_achados where empresa_id = current_setting('testes.empresa_a')::uuid and chave = 'st_simples:2026-09'), true);
select set_config('testes.risco', (select id::text from public.auditor_achados where empresa_id = current_setting('testes.empresa_a')::uuid and chave = 'ncm_invalido:2026-09'), true);

select is((select jsonb_array_length(criterios) from public.auditor_achados where empresa_id = current_setting('testes.empresa_a')::uuid and chave = 'st_simples:2026-09'), 1, 'grava os grupos de itens do achado');
select is((select criterios from public.auditor_achados where empresa_id = current_setting('testes.empresa_a')::uuid and chave = 'ncm_invalido:2026-09'), '[]'::jsonb, 'achado sem grupos fica com a lista vazia');
select throws_ok($$update public.auditor_achados set criterios = '{}' where empresa_id = current_setting('testes.empresa_a')::uuid and chave = 'st_simples:2026-09'$$, '23514', null, 'critérios precisam ser uma lista');

-- Equipe monta o relatório
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.r', public.auditor_relatorio_itens(current_setting('testes.empresa_a')::uuid,
  array[current_setting('testes.achado')::uuid, current_setting('testes.risco')::uuid])::text, true);
select is(jsonb_array_length(current_setting('testes.r')::jsonb), 1, 'só o achado com grupos traz produtos');
select is(current_setting('testes.r')::jsonb -> 0 ->> 'id', current_setting('testes.achado'), 'produtos ligados ao achado certo');
select is(jsonb_array_length(current_setting('testes.r')::jsonb -> 0 -> 'produtos'), 1, 'só a dipirona (o xampu saiu com outro código)');
select results_eq(
  $$select p ->> 'codigo', p ->> 'descricao', (p ->> 'notas')::int, (p ->> 'valor')::numeric, jsonb_array_length(p -> 'lista'), p ->> 'motivo'
      from jsonb_array_elements(current_setting('testes.r')::jsonb -> 0 -> 'produtos') p$$,
  $$values ('789', 'DIPIRONA 500MG', 2, 360::numeric, 2, 'comprado com ST, vendido como tributado')$$,
  'produto com as duas notas, o valor e o motivo');
select throws_ok(format($$select public.auditor_relatorio_itens(%L, '{}')$$, current_setting('testes.empresa_a')), 'P0001', 'Escolha de 1 a 200 achados.', 'pede ao menos um achado');
reset role;

-- Cliente e equipe sem a empresa são barrados
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format($$select public.auditor_relatorio_itens(%L, array[%L]::uuid[])$$, current_setting('testes.empresa_a'), current_setting('testes.achado')),
  '42501', null, 'cliente não monta o relatório');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.auditor_relatorio_itens(%L, array[%L]::uuid[])$$, current_setting('testes.empresa_a'), current_setting('testes.achado')),
  '42501', null, 'cliente de outra empresa não monta o relatório');
reset role;
-- Achado de outra empresa não entra, mesmo pedindo pelo id
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is(public.auditor_relatorio_itens(current_setting('testes.empresa_b')::uuid, array[current_setting('testes.achado')::uuid]), '[]'::jsonb,
  'achado de outra empresa não aparece no relatório');
reset role;

select * from finish();
rollback;
