-- Critérios: o arquivo do SPED (EFD ICMS/IPI) é conferido com os XML do
-- portal — nota emitida ou recebida fora do SPED, cancelada escriturada como
-- regular (e o contrário), valor e ICMS diferentes do XML, crédito de ICMS não
-- aproveitado na compra para revenda e nota sem XML; só a equipe vê; o arquivo
-- mais recente do período é o que vale; só o processador grava as notas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

create or replace function pg_temp.chave(p_cnpj text, p_numero int) returns text language sql as $$
  select '172609' || p_cnpj || '55001' || lpad(p_numero::text, 9, '0') || '1' || lpad(p_numero::text, 8, '0') || '0';
$$;

-- Um documento com os XML (enviado pelo cliente A)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'nfe_saida_xml', 'notas.zip',
  'application/zip', 1000, repeat('f', 64)) ->> 'documento_id'), true);
select set_config('request.jwt.claims', '', true);

create or replace function pg_temp.xml(p_chave text, p_numero text, p_emit text, p_dest text, p_operacao text, p_valor numeric, p_icms numeric)
returns void language plpgsql as $$
begin
  perform public.registrar_xml_fiscal(current_setting('testes.doc')::uuid, jsonb_build_object(
    'tipo', 'nota', 'modelo', '55', 'tipo_documento', 'NF-e', 'chave_acesso', p_chave, 'identificador', p_chave, 'numero', p_numero,
    'serie', '1', 'data_emissao', '2026-09-10T10:00:00-03:00', 'emitente_documento', p_emit, 'emitente_nome', 'EMITENTE ' || p_emit,
    'destinatario_documento', p_dest, 'destinatario_nome', 'DESTINATARIO ' || p_dest, 'tp_nf', '1', 'operacao', p_operacao,
    'valor_total', p_valor, 'situacao_arquivo', 'protocolo_autorizacao_no_arquivo', 'relacionado_empresa', true,
    'tributos', jsonb_build_object('icms', p_icms::text)));
end $$;

-- XML no portal: empresa A = 11444777000161; fornecedor 33444555000191; cliente 98765432000198
select pg_temp.xml(pg_temp.chave('11444777000161', 1001), '1001', '11444777000161', '98765432000198', 'saida', 1000, 180);
select pg_temp.xml(pg_temp.chave('33444555000191', 5501), '5501', '33444555000191', '11444777000161', 'entrada', 2000, 240);
select pg_temp.xml(pg_temp.chave('11444777000161', 1003), '1003', '11444777000161', '98765432000198', 'saida', 300, 54);
select pg_temp.xml(pg_temp.chave('11444777000161', 1004), '1004', '11444777000161', '98765432000198', 'saida', 500, 90);
select pg_temp.xml(pg_temp.chave('33444555000191', 5502), '5502', '33444555000191', '11444777000161', 'entrada', 800, 96);
select pg_temp.xml(pg_temp.chave('11444777000161', 1007), '1007', '11444777000161', '98765432000198', 'saida', 700, 0);
select pg_temp.xml(pg_temp.chave('11444777000161', 1008), '1008', '11444777000161', '98765432000198', 'saida', 900, 0);
update public.documentos_fiscais set cancelada_evento = true where chave_acesso = pg_temp.chave('11444777000161', 1003);

select ok(exists (select 1 from public.categorias_documento where codigo = 'sped_fiscal' and 'txt' = any(extensoes)), 'categoria dos arquivos do SPED');

-- Arquivo do SPED de 09/2026 (processador)
select set_config('testes.sped', public.sped_registrar_arquivo(current_setting('testes.doc')::uuid, 1, 'sped-092026.txt',
  '{"tipo":"efd_icms_ipi","versao_leiaute":"020","finalidade":"original","inicio":"2026-09-01","fim":"2026-09-30","cnpj":"11444777000161","uf":"TO","perfil":"A"}'::jsonb,
  'processando')::text, true);
select is(public.sped_gravar_documentos(current_setting('testes.sped')::uuid, jsonb_build_array(
  jsonb_build_object('linha', 8, 'ind_oper', '1', 'ind_emit', '0', 'cod_mod', '55', 'cod_sit', '00', 'serie', '001', 'numero', '1001',
    'chave', pg_temp.chave('11444777000161', 1001), 'dt_doc', '2026-09-10', 'vl_doc', 1000, 'vl_icms', 170, 'vl_icms_st', 0, 'vl_ipi', 0, 'cfops', array['5102']),
  jsonb_build_object('linha', 10, 'ind_oper', '0', 'ind_emit', '1', 'cod_mod', '55', 'cod_sit', '00', 'serie', '001', 'numero', '5501',
    'chave', pg_temp.chave('33444555000191', 5501), 'dt_doc', '2026-09-10', 'dt_e_s', '2026-09-12', 'vl_doc', 2000, 'vl_icms', 0, 'cfops', array['1102']),
  jsonb_build_object('linha', 13, 'ind_oper', '1', 'ind_emit', '0', 'cod_mod', '55', 'cod_sit', '00', 'serie', '001', 'numero', '1003',
    'chave', pg_temp.chave('11444777000161', 1003), 'dt_doc', '2026-09-10', 'vl_doc', 300, 'vl_icms', 54, 'cfops', array['5102']),
  jsonb_build_object('linha', 15, 'ind_oper', '1', 'ind_emit', '0', 'cod_mod', '55', 'cod_sit', '00', 'serie', '001', 'numero', '1006',
    'chave', pg_temp.chave('11444777000161', 1006), 'dt_doc', '2026-09-11', 'vl_doc', 400, 'vl_icms', 72, 'cfops', array['5102']),
  jsonb_build_object('linha', 17, 'ind_oper', '1', 'ind_emit', '0', 'cod_mod', '55', 'cod_sit', '02', 'serie', '001', 'numero', '1007',
    'chave', pg_temp.chave('11444777000161', 1007)),
  jsonb_build_object('linha', 18, 'ind_oper', '1', 'ind_emit', '0', 'cod_mod', '55', 'cod_sit', '00', 'serie', '001', 'numero', '1008',
    'chave', pg_temp.chave('11444777000161', 1008), 'dt_doc', '2026-09-10', 'vl_doc', 950, 'vl_icms', 0, 'cfops', array['5102'])
)), 6, 'grava as notas escrituradas');
select is(public.sped_concluir(current_setting('testes.sped')::uuid, '{"registros": 30}'::jsonb, '[]'::jsonb) ->> 'alta', '4',
  'conclusão confere com os XML');

create or replace function pg_temp.achado(p_regra text, p_numero text) returns public.sped_divergencias language sql as $$
  select * from public.sped_divergencias where arquivo_id = current_setting('testes.sped')::uuid and regra = p_regra and numero = p_numero;
$$;
select is((pg_temp.achado('icms_divergente', '1001')).diferenca, -10.00::numeric, 'ICMS escriturado diferente do XML (R$ 10 a menos)');
select is((pg_temp.achado('credito_nao_aproveitado', '5501')).valor_xml, 240.00::numeric, 'compra para revenda com ICMS no XML e sem crédito no SPED');
select is((pg_temp.achado('cancelada_escriturada', '1003')).gravidade, 'alta', 'nota cancelada escriturada como regular');
select is((pg_temp.achado('nao_escriturada_saida', '1004')).valor_xml, 500.00::numeric, 'nota emitida no mês e fora do SPED');
select is((pg_temp.achado('nao_escriturada_entrada', '5502')).gravidade, 'media', 'nota recebida no mês e fora do SPED');
select is((pg_temp.achado('sem_xml', '1006')).gravidade, 'baixa', 'nota escriturada sem XML no portal');
select is((pg_temp.achado('cancelada_no_sped', '1007')).gravidade, 'media', 'escriturada como cancelada sem o evento de cancelamento');
select is((pg_temp.achado('valor_divergente', '1008')).diferenca, 50.00::numeric, 'valor total diferente do XML');
select is((select count(*)::int from public.sped_divergencias where arquivo_id = current_setting('testes.sped')::uuid and numero = '5501' and regra <> 'credito_nao_aproveitado'), 0,
  'nota que bate com o XML não gera outros achados');
select is((select resumo ->> 'com_xml' from public.sped_arquivos where id = current_setting('testes.sped')::uuid), '5', 'resumo conta as notas com XML');
select ok(exists (select 1 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'sped_conferido'),
  'a equipe é avisada do resultado');

-- Acesso
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.sped_arquivos), 0, 'cliente não vê a conferência do SPED (uso interno da equipe)');
select throws_ok($$select public.sped_conferir_de_novo(current_setting('testes.sped')::uuid)$$, '42501', null, 'cliente não confere o SPED');
select throws_ok($$select public.sped_gravar_documentos(current_setting('testes.sped')::uuid, '[]'::jsonb)$$, '42501', null, 'usuário não grava notas direto');
select throws_ok($$select public.sped_carteira()$$, '42501', null, 'cliente não vê a carteira');
reset role;

-- Chegou o XML que faltava: conferir de novo
select set_config('request.jwt.claims', '', true);
select pg_temp.xml(pg_temp.chave('11444777000161', 1006), '1006', '11444777000161', '98765432000198', 'saida', 400, 72);
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.sped_arquivos where empresa_id = current_setting('testes.empresa_a')::uuid), 1, 'equipe vê o arquivo do SPED');
select is((public.sped_conferir_de_novo(current_setting('testes.sped')::uuid) -> 'regras' ->> 'sem_xml'), null, 'conferir de novo: a nota sem XML some');
select is((select count(*)::int from jsonb_array_elements(public.sped_carteira()) e where e ->> 'empresa_id' = current_setting('testes.empresa_a')), 1,
  'a carteira mostra o último SPED da empresa');
reset role;

-- Arquivo substituto do mesmo período passa a valer
select set_config('request.jwt.claims', '', true);
select set_config('testes.sped2', public.sped_registrar_arquivo(current_setting('testes.doc')::uuid, 2, 'sped-092026-retificado.txt',
  '{"tipo":"efd_icms_ipi","finalidade":"substituto","inicio":"2026-09-01","fim":"2026-09-30","cnpj":"11444777000161"}'::jsonb, 'processando')::text, true);
select public.sped_concluir(current_setting('testes.sped2')::uuid, '{}'::jsonb, '[]'::jsonb);
select is((select string_agg(nome_arquivo || '=' || vigente, ',' order by nome_arquivo desc) from public.sped_arquivos
            where empresa_id = current_setting('testes.empresa_a')::uuid),
  'sped-092026.txt=false,sped-092026-retificado.txt=true', 'o arquivo mais recente do período é o que vale');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.sped_excluir_arquivo(current_setting('testes.sped2')::uuid)$$, 'equipe tira um arquivo da conferência');
reset role;
select is((select vigente from public.sped_arquivos where id = current_setting('testes.sped')::uuid), true, 'o anterior volta a valer');

select * from finish();
rollback;
