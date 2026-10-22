-- Critérios: na previsão, "compras" continua com todas as compras do mês, e
-- "compras_credito_pis" só com as que dão crédito de PIS/Cofins: fica de fora a
-- compra de produtor pessoa física (nota do produtor ou nota de entrada emitida
-- pela própria empresa com o CPF do produtor) e a compra sem as contribuições
-- (CST de saída 04 a 09 ou de entrada 70 a 75).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-10', 'esc_outros', 'notas.zip',
  'application/pdf', 1024, md5('compras') || md5('compras')) ->> 'documento_id'), true);
reset role;

insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, emitente_documento, destinatario_documento)
values
  -- Fornecedor pessoa jurídica com PIS/Cofins: credita
  ('00000000-0000-0000-0000-00000000e001', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'C1', '2026-09-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33.444.555/0001-81', '11444777000161'),
  -- Nota do produtor rural pessoa física: não credita
  ('00000000-0000-0000-0000-00000000e002', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'C2', '2026-09-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '987.654.321-00', '11444777000161'),
  -- Nota de entrada emitida pela própria empresa na compra do produtor (CPF no destinatário): não credita
  ('00000000-0000-0000-0000-00000000e003', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'C3', '2026-09-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '11444777000161', '98765432100'),
  -- Pessoa jurídica, mas a venda saiu com suspensão (CST 09): não credita
  ('00000000-0000-0000-0000-00000000e004', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'C4', '2026-09-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{}', '33444555000181', '11444777000161');
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, cfop, valor_total, tributos)
values
  ('00000000-0000-0000-0000-00000000e001', current_setting('testes.empresa_a')::uuid, 1, '6102', 1000, '{"icms": "70.00", "cst_pis": "01", "cst_cofins": "01"}'),
  ('00000000-0000-0000-0000-00000000e002', current_setting('testes.empresa_a')::uuid, 1, '5101', 2000, '{}'),
  ('00000000-0000-0000-0000-00000000e003', current_setting('testes.empresa_a')::uuid, 1, '1102', 4000, '{"cst_pis": "98"}'),
  ('00000000-0000-0000-0000-00000000e004', current_setting('testes.empresa_a')::uuid, 1, '5102', 800, '{"icms": "96.00", "cst_pis": "09", "cst_cofins": "09"}');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.mes', (public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'meses' -> 12)::text, true);
select is((current_setting('testes.mes')::jsonb ->> 'compras')::numeric, 7800::numeric, 'compras: todas as compras do mês');
select is((current_setting('testes.mes')::jsonb ->> 'icms_compras')::numeric, 166::numeric, 'ICMS de todas as compras');
select is((current_setting('testes.mes')::jsonb ->> 'compras_credito_pis')::numeric, 1000::numeric,
          'crédito de PIS/Cofins só na compra de pessoa jurídica com as contribuições');
select is((current_setting('testes.mes')::jsonb ->> 'icms_compras_credito_pis')::numeric, 70::numeric, 'ICMS só das compras que creditam');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$,
                 '42501', null, 'cliente de outra empresa não consulta');
reset role;

select * from finish();
rollback;
