-- Critérios: a chegada de uma NFS-e agenda a análise do auditor; as notas de
-- serviço chegam às regras com os tributos lidos; só o processador lê esses
-- dados; NFS-e lidas antes da leitura 3 entram na fila de releitura.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

\ir 00_setup.sql.inc

create or replace function pg_temp.enviar(p_nome text, p_hash text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'nfse', p_nome, 'application/xml', 1000, p_hash);
  insert into storage.objects (bucket_id, name, metadata) values ('documentos', r ->> 'storage_path', '{"size": 1000, "mimetype": "application/xml"}');
  perform public.confirmar_upload((r ->> 'versao_id')::uuid);
  return (r ->> 'documento_id')::uuid;
end $$;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.doc', pg_temp.enviar('nfse-777.xml', repeat('e', 64))::text, true);
select set_config('request.jwt.claims', '', true);
delete from public.jobs where tipo = 'auditor_fiscal';
select public.registrar_xml_fiscal(current_setting('testes.doc')::uuid, jsonb_build_object(
  'tipo', 'nota', 'modelo', 'nfse_nacional', 'tipo_documento', 'NFS-e', 'identificador', 'NFS-TESTE-777', 'numero', '777',
  'data_emissao', '2026-09-15T10:59:00-03:00', 'emitente_documento', '11444777000161', 'emitente_nome', 'Empresa A Comércio Ltda',
  'destinatario_documento', '98765432000198', 'destinatario_nome', 'Tomador X Ltda', 'operacao', 'saida',
  'valor_total', 8885, 'valor_servicos', 10000, 'situacao_arquivo', 'nao_aplicavel', 'relacionado_empresa', true, 'leitura_versao', 3,
  'tributos', jsonb_build_object('iss', '500.00', 'iss_retido', 'sim', 'tp_ret_iss', '2', 'aliq_iss', '5.00', 'op_simp_nac', '3',
                                 'ret_irrf', '150.00', 'ret_csll', '465.00', 'total_ret', '1115.00')));

select is((select count(*)::int from public.jobs where tipo = 'auditor_fiscal' and empresa_id = current_setting('testes.empresa_a')::uuid
            and chave_idempotencia like 'auditor:auto:%'), 1, 'NFS-e da empresa agenda a análise do auditor');
select is(jsonb_array_length(public.auditor_servicos(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-01')), 1,
  'a nota de serviço chega às regras');
select is(public.auditor_servicos(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-01') -> 0 -> 'tributos' ->> 'ret_irrf', '150.00',
  'com as retenções lidas da nota');
select is((public.auditor_dados(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-01') ->> 'notas_servico')::int, 1,
  'a análise conta as notas de serviço');
update public.documentos_fiscais set leitura_versao = 2 where documento_id = current_setting('testes.doc')::uuid;
select is((public.auditor_dados(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-01') ->> 'leitura_antiga')::int, 1,
  'NFS-e lida antes da leitura 3 entra na releitura');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.auditor_servicos(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-01')$$, '42501', null,
  'equipe não lê os dados do auditor direto (só o processador)');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.auditor_servicos(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-01')$$, '42501', null,
  'cliente não lê os dados do auditor');
reset role;

select * from finish();
rollback;
