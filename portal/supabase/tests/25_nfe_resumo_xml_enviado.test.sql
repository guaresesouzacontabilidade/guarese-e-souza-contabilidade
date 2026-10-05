-- Critérios: quando o XML completo de uma NF-e recebida só em resumo chega por
-- outro caminho (enviado em Documentos, por exemplo depois de a SEFAZ recusar a
-- ciência fora do prazo), o resumo passa a apontar para o documento; o resumo da
-- mesma chave em outra empresa não muda; um resumo já ligado não é trocado; NFS-e
-- e notas sem chave não mexem nos resumos.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

create or replace function pg_temp.documento(p_empresa uuid, p_nome text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_caminho text;
begin
  v_caminho := p_empresa::text || '/2026-09/' || v_id::text || '/v1-' || p_nome;
  insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, mime, tamanho, sha256,
                                 versao_atual, storage_path, upload_status, status, origem, verificacao_status)
  values (v_id, p_empresa, 'cliente', '2026-09-01', 'nfe_entrada_xml', p_nome, 'xml', 'application/xml', 1000, md5(p_nome) || md5(p_nome),
          1, v_caminho, 'concluido', 'recebido', 'upload', 'ok');
  return v_id;
end $$;

create or replace function pg_temp.fiscal(p_empresa uuid, p_documento uuid, p_modelo text, p_chave text, p_identificador text) returns void language sql as $$
  insert into public.documentos_fiscais (empresa_id, documento_id, modelo, tipo_documento, chave_acesso, identificador, competencia, operacao,
                                         situacao_arquivo, relacionado_empresa)
  values (p_empresa, p_documento, p_modelo, case when p_modelo = '55' then 'NF-e' else 'NFS-e' end, p_chave, p_identificador, '2026-09-01',
          'entrada', 'protocolo_autorizacao_no_arquivo', true);
$$;

-- Resumos: um recusado fora do prazo (empresa A), a mesma chave na empresa B e um já ligado
insert into public.nfe_resumos (empresa_id, chave, emitente_nome, data_emissao, valor, ciencia_retorno)
values
  (current_setting('testes.empresa_a')::uuid, '17260955566677000188550010000081011000081010', 'FORNECEDOR', '2026-09-02T10:00:00-03:00', 10,
   '596 - Rejeicao: Evento apresentado apos o prazo permitido para o evento: [10 dias]'),
  (current_setting('testes.empresa_b')::uuid, '17260955566677000188550010000081011000081010', 'FORNECEDOR', '2026-09-02T10:00:00-03:00', 10, null),
  (current_setting('testes.empresa_a')::uuid, '17260955566677000188550010000081021000081020', 'FORNECEDOR', '2026-09-03T10:00:00-03:00', 20, null);
select set_config('testes.doc_antigo', pg_temp.documento(current_setting('testes.empresa_a')::uuid, 'antigo.xml')::text, true);
update public.nfe_resumos set documento_id = current_setting('testes.doc_antigo')::uuid
 where chave = '17260955566677000188550010000081021000081020';

-- 1. XML enviado em Documentos (empresa A): o resumo recusado passa a apontar para ele
select set_config('testes.doc_novo', pg_temp.documento(current_setting('testes.empresa_a')::uuid, 'NFe-enviada.xml')::text, true);
select pg_temp.fiscal(current_setting('testes.empresa_a')::uuid, current_setting('testes.doc_novo')::uuid, '55',
                      '17260955566677000188550010000081011000081010', '17260955566677000188550010000081011000081010');
select is((select documento_id from public.nfe_resumos where empresa_id = current_setting('testes.empresa_a')::uuid
            and chave = '17260955566677000188550010000081011000081010'),
          current_setting('testes.doc_novo')::uuid, 'resumo da empresa ligado ao XML enviado');
select is((select documento_id from public.nfe_resumos where empresa_id = current_setting('testes.empresa_b')::uuid
            and chave = '17260955566677000188550010000081011000081010'),
          null, 'a mesma chave em outra empresa não muda');

-- 2. Resumo já ligado: não é trocado por outro XML da mesma chave
select set_config('testes.doc_outro', pg_temp.documento(current_setting('testes.empresa_a')::uuid, 'outro.xml')::text, true);
select pg_temp.fiscal(current_setting('testes.empresa_a')::uuid, current_setting('testes.doc_outro')::uuid, '55',
                      '17260955566677000188550010000081021000081020', 'outro-identificador');
select is((select documento_id from public.nfe_resumos where chave = '17260955566677000188550010000081021000081020'),
          current_setting('testes.doc_antigo')::uuid, 'resumo já ligado continua com o documento dele');

-- 3. NFS-e e nota sem chave não mexem nos resumos
insert into public.nfe_resumos (empresa_id, chave, emitente_nome, data_emissao, valor)
values (current_setting('testes.empresa_a')::uuid, '17260955566677000188550010000081031000081030', 'FORNECEDOR', '2026-09-04T10:00:00-03:00', 30);
select pg_temp.fiscal(current_setting('testes.empresa_a')::uuid, pg_temp.documento(current_setting('testes.empresa_a')::uuid, 'nfse.xml'),
                      'nfse_nacional', '17260955566677000188550010000081031000081030', 'nfse-1');
select pg_temp.fiscal(current_setting('testes.empresa_a')::uuid, pg_temp.documento(current_setting('testes.empresa_a')::uuid, 'sem-chave.xml'),
                      '55', null, 'sem-chave-1');
select is((select documento_id from public.nfe_resumos where chave = '17260955566677000188550010000081031000081030'),
          null, 'NFS-e e nota sem chave não ligam resumos');

-- 4. A função do gatilho não fica exposta a quem não entrou no portal
select ok(not has_function_privilege('anon', 'app.tg_ligar_resumo_nfe()', 'execute'), 'visitante sem login não executa a função do gatilho');

select * from finish();
rollback;
