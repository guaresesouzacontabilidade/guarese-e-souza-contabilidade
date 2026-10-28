-- Critérios: os dados da EFD ICMS/IPI (notas com itens, participantes, contador)
-- são só da equipe que gerencia os cálculos da empresa; o CPF do contador fica
-- numa tabela que o cliente não lê e que só o administrador altera; o código de
-- ajuste dos lançamentos é do estado da empresa e do mesmo tipo do lançamento;
-- o histórico e o arquivo gerado (armazenamento "efd") são só da equipe; a
-- leitura do XML grava o complemento usado na EFD.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(37);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

-- Empresa A em Mato Grosso, regime normal
update public.empresas set municipio_ibge = '5103403', uf = 'MT', regime_tributario = 'lucro_real', contribuinte_icms = true, inscricao_estadual = '131234567'
 where id = current_setting('testes.empresa_a')::uuid;

create or replace function pg_temp.nota(p_empresa uuid, p_ident text, p_leitura int) returns uuid language plpgsql as $$
declare v_doc uuid := gen_random_uuid(); v_id uuid := gen_random_uuid();
begin
  insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, mime, tamanho, sha256,
                                 versao_atual, storage_path, upload_status, status, origem, verificacao_status)
  values (v_doc, p_empresa, 'cliente', '2026-09-01', 'nfe_entrada_xml', p_ident || '.xml', 'xml', 'application/xml', 1000, md5(p_ident) || md5(p_ident),
          1, p_empresa::text || '/2026-09/' || v_doc::text || '/v1-' || p_ident || '.xml', 'concluido', 'recebido', 'upload', 'ok');
  insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                         situacao_arquivo, relacionado_empresa, emitente_documento, emitente_nome, emitente_uf,
                                         valor_total, valor_produtos, tributos, leitura_versao)
  values (v_id, p_empresa, v_doc, '55', 'NF-e', p_ident, '2026-09-01', 'entrada', 'protocolo_autorizacao_no_arquivo', true,
          '55666777000181', 'FORNECEDOR TESTE', 'GO', 1000, 1000, '{"icms": "120"}', p_leitura);
  insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, codigo, cfop, unidade, quantidade, valor_total, tributos)
  values (v_id, p_empresa, 1, 'P1', '6102', 'SC', 10, 1000, '{"icms": "120", "cst_icms": "00", "orig": "0"}');
  return v_id;
end $$;
select set_config('testes.nota', pg_temp.nota(current_setting('testes.empresa_a')::uuid, 'efd-1', 4)::text, true);

-- 1. Dados da EFD: só a equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(jsonb_array_length(public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'notas'), 1, 'equipe recebe as notas do mês');
select is(public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{notas,0,itens,0,codigo}', 'P1', 'com os itens e o código do fornecedor');
select is(public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{empresa,municipio_ibge}', '5103403', 'e o município da empresa');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$, '42501', null, 'cliente não lê os dados da EFD');
select throws_ok($$select public.efd_salvar_configuracao(current_setting('testes.empresa_a')::uuid, '{"perfil": "A"}')$$, '42501', null, 'cliente não muda a configuração');
select throws_ok($$select public.efd_registrar_geracao(current_setting('testes.empresa_a')::uuid, '2026-09-01', '{}')$$, '42501', null, 'cliente não registra arquivo');
select throws_ok($$select public.efd_reler_notas(current_setting('testes.empresa_a')::uuid, '2026-09-01', 5)$$, '42501', null, 'cliente não pede a releitura');
reset role;

-- 2. Contador: CPF só para a equipe; só o administrador altera
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$update public.escritorio set contador_nome = 'Contadora Teste', contador_crc = 'TO-012345/O-6' where id = 1$$, 'administrador grava nome e CRC do contador');
select lives_ok($$update public.escritorio_contador set cpf = '52998224725', email = 'contador@teste.local' where id = 1$$, 'administrador grava o CPF do contador');
select throws_ok($$update public.escritorio_contador set cpf = '11111111112' where id = 1$$, '23514', null, 'CPF inválido é recusado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select cpf from public.escritorio_contador where id = 1), '52998224725', 'equipe lê o CPF do contador');
update public.escritorio_contador set cpf = '39053344705' where id = 1;
select is((select cpf from public.escritorio_contador where id = 1), '52998224725', 'equipe (não administradora) não altera');
select is(public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{contador,cpf}', '52998224725', 'o gerador recebe o CPF');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*) from public.escritorio_contador)::int, 0, 'cliente não vê o CPF do contador');
reset role;

-- 3. Código de ajuste (tabela 5.1.1) nos lançamentos
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor, codigo_ajuste)
                  values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'outro_credito', 'CIAP 1/48', 50, 'mt020001')$$,
                'lançamento com o código do estado e do tipo');
select is((select codigo_ajuste from public.icms_lancamentos where descricao = 'CIAP 1/48'), 'MT020001', 'código gravado em maiúsculas');
select throws_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor, codigo_ajuste)
                   values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'outro_credito', 'Errado', 10, 'MT000001')$$,
                 'P0001', null, 'tipo do código diferente do lançamento é recusado');
select throws_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor, codigo_ajuste)
                   values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'outro_credito', 'Errado', 10, 'TO020001')$$,
                 'P0001', null, 'código de outro estado é recusado');
select throws_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor, codigo_ajuste)
                   values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'guia_extra', 'Guia', 10, 'MT020001')$$,
                 'P0001', null, 'guia à parte não leva código de ajuste');
select lives_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor)
                  values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'deducao', 'Incentivo', 5)$$, 'lançamento sem código continua aceito');
select lives_ok($$select public.icms_definir_codigo_ajuste((select id from public.icms_lancamentos where descricao = 'Incentivo'), 'MT040001')$$,
                'equipe informa o código depois');
select is(public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'lancamentos_codigos' ->> (select id::text from public.icms_lancamentos where descricao = 'Incentivo'),
          'MT040001', 'o gerador recebe o código de cada lançamento');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.icms_definir_codigo_ajuste((select id from public.icms_lancamentos limit 1), 'MT020002')$$, null, null,
                 'cliente não muda o código');
reset role;

-- 4. Configuração, histórico e arquivo (equipe)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.efd_salvar_configuracao(current_setting('testes.empresa_a')::uuid, '{"perfil": "A", "codigo_receita": "1112"}')$$, 'equipe salva a configuração');
select set_config('testes.geracao', public.efd_registrar_geracao(current_setting('testes.empresa_a')::uuid, '2026-09-15',
  jsonb_build_object('nome_arquivo', 'EFD-ICMS-IPI_teste_202609.txt', 'sha256', repeat('a', 64), 'tamanho', 100, 'linhas', 10))::text, true);
select ok(current_setting('testes.geracao')::jsonb ->> 'caminho' like current_setting('testes.empresa_a') || '/2026-09/%.txt', 'arquivo na pasta da empresa e do mês');
select is(jsonb_array_length(public.dados_efd_icms_ipi(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'geracoes'), 1, 'histórico do mês');
select is(public.efd_reler_notas(current_setting('testes.empresa_a')::uuid, '2026-09-01', 5), 1, 'releitura das notas lidas antes da versão 5');
reset role;

insert into storage.objects (bucket_id, name, owner, metadata)
values ('efd', current_setting('testes.geracao')::jsonb ->> 'caminho', null, '{"size": 100, "mimetype": "text/plain"}');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'efd')::int, 1, 'equipe acessa o arquivo gerado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'efd')::int + (select count(*) from public.efd_geracoes)::int, 0,
          'cliente não vê o histórico nem o arquivo');
reset role;

-- 5. Leitura do XML grava o complemento da EFD
select public.atualizar_leitura_xml_fiscal(current_setting('testes.nota')::uuid,
  '{"tipo": "nota", "leitura_versao": 5, "tributos": {"icms": "120"}, "itens": [], "complemento": {"mod_frete": "1", "emitente": {"cmun": "5208707"}}}');
select is((select complemento ->> 'mod_frete' from public.documentos_fiscais where id = current_setting('testes.nota')::uuid), '1', 'complemento gravado');
select is((select leitura_versao from public.documentos_fiscais where id = current_setting('testes.nota')::uuid)::int, 5, 'leitura na versão 5');

-- 6. CT-e emitido pela empresa entra nos débitos da Apuração do ICMS (como no D190)
do $$
declare v_doc uuid := gen_random_uuid(); v_emp uuid := current_setting('testes.empresa_a')::uuid;
begin
  insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, mime, tamanho, sha256,
                                 versao_atual, storage_path, upload_status, status, origem, verificacao_status)
  values (v_doc, v_emp, 'cliente', '2026-09-01', 'cte_xml', 'cte-1.xml', 'xml', 'application/xml', 1000, md5('cte') || md5('cte'),
          1, v_emp::text || '/2026-09/' || v_doc::text || '/v1-cte-1.xml', 'concluido', 'recebido', 'upload', 'ok');
  insert into public.documentos_fiscais (empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                         situacao_arquivo, relacionado_empresa, emitente_documento, cfops, valor_total, tributos, complemento, leitura_versao)
  values (v_emp, v_doc, '57', 'CT-e', 'cte-1', '2026-09-01', 'saida', 'protocolo_autorizacao_no_arquivo', true, '11444777000161',
          array['6353'], 300, '{"icms": "36"}', '{"cte": {"bc_icms": "300.00"}}', 5);
end $$;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select s ->> 'icms' from jsonb_array_elements(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'saidas') s
            where s ->> 'cfop' = '6353'), '36', 'ICMS do CT-e emitido nos débitos da apuração');
select is((select s ->> 'base' from jsonb_array_elements(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'saidas') s
            where s ->> 'cfop' = '6353'), '300.00', 'com a base do CT-e');

-- 7. Crédito presumido do transportador (MT: 20% do ICMS dos CT-e interestaduais)
select throws_ok($$select public.efd_salvar_configuracao(current_setting('testes.empresa_a')::uuid, '{"perfil": "A", "credito_presumido_cte": "20"}')$$,
                 'P0001', null, 'percentual sem o código do ajuste é recusado');
select throws_ok($$select public.efd_salvar_configuracao(current_setting('testes.empresa_a')::uuid,
                   '{"perfil": "A", "credito_presumido_cte": "20", "credito_presumido_codigo": "TO10001003"}')$$,
                 'P0001', null, 'código de outro estado é recusado');
select lives_ok($$select public.efd_salvar_configuracao(current_setting('testes.empresa_a')::uuid,
                  '{"perfil": "A", "codigo_receita": "1112", "credito_presumido_cte": "20", "credito_presumido_codigo": "MT10001003"}')$$,
                'equipe configura o crédito presumido');
select is(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{credito_presumido_cte,valor}', '7.20',
          'crédito do mês: 20% do ICMS do CT-e interestadual');
reset role;

select * from finish();
rollback;
