-- Critérios: cada empresa tem um mês inicial para a busca automática (padrão:
-- o mês anterior); só quem gerencia o certificado muda o mês, nunca para depois
-- do mês atual; o resumo mês a mês respeita o acesso de cada um; só o
-- administrador apaga as notas automáticas anteriores ao mês inicial — com o
-- que veio delas (nota lida, lançamento sugerido, resumo, achado não
-- publicado) e sem tocar no que foi enviado por pessoas nem em mês fechado; os
-- arquivos saem do armazenamento pela fila; recuar o mês libera as NFS-e
-- ignoradas para nova busca (a NF-e não volta); a troca do certificado não
-- muda o mês escolhido no primeiro cadastro.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(37);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

-- Documento trazido pela busca automática (como o processador grava)
create or replace function pg_temp.doc_auto(p_comp date, p_categoria text, p_nome text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_emp uuid := current_setting('testes.empresa_a')::uuid; v_caminho text;
begin
  v_caminho := v_emp::text || '/' || to_char(p_comp, 'YYYY-MM') || '/' || v_id::text || '/v1-' || p_nome;
  insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, mime, tamanho, sha256,
                                 versao_atual, storage_path, upload_status, status, origem, verificacao_status)
  values (v_id, v_emp, 'cliente', p_comp, p_categoria, p_nome, 'xml', 'application/xml', 1000, md5(p_nome) || md5(p_nome),
          1, v_caminho, 'concluido', 'recebido', 'automatica', 'ok');
  insert into public.documento_versoes (documento_id, empresa_id, versao, storage_path, nome_original, mime, tamanho, sha256, upload_concluido_em)
  values (v_id, v_emp, 1, v_caminho, p_nome, 'application/xml', 1000, md5(p_nome) || md5(p_nome), now());
  return v_id;
end $$;

create or replace function pg_temp.nota(p_chave text, p_data text, p_valor numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'tipo', 'nota', 'modelo', '55', 'tipo_documento', 'NF-e', 'chave_acesso', p_chave, 'identificador', p_chave,
    'numero', right(p_chave, 9), 'serie', '1', 'data_emissao', p_data,
    'emitente_documento', '11444777000161', 'emitente_nome', 'Empresa A Comércio Ltda',
    'destinatario_documento', '98765432000198', 'destinatario_nome', 'Cliente X Ltda',
    'tp_nf', '1', 'operacao', 'saida', 'valor_total', p_valor, 'situacao_arquivo', 'protocolo_autorizacao_no_arquivo',
    'relacionado_empresa', true,
    'itens', jsonb_build_array(jsonb_build_object('numero_item', 1, 'descricao', 'Produto', 'cfop', '5102', 'quantidade', 1,
                                                  'valor_unitario', p_valor, 'valor_total', p_valor)),
    'sugestao', jsonb_build_object('tipo', 'receber', 'descricao', 'Venda ' || right(p_chave, 9),
                                   'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'valor', p_valor))));
$$;

-- Agosto (antes do mês inicial) e setembro, trazidos pela busca; agosto também tem um arquivo enviado pelo cliente
select set_config('testes.ago', pg_temp.doc_auto('2026-08-01', 'nfe_saida_xml', 'NFe-NSU-5.xml')::text, true);
select set_config('testes.set', pg_temp.doc_auto('2026-09-01', 'nfe_saida_xml', 'NFe-NSU-6.xml')::text, true);
select public.registrar_xml_fiscal(current_setting('testes.ago')::uuid, pg_temp.nota('17260811444777000161550010000000051000000051', '2026-08-20T10:00:00-03:00', 800));
select public.registrar_xml_fiscal(current_setting('testes.set')::uuid, pg_temp.nota('17260911444777000161550010000000061000000061', '2026-09-20T10:00:00-03:00', 900));
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.upload', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-08-01', 'nfe_saida_xml', 'enviada.xml',
                                    'application/xml', 1000, repeat('e', 64)) ->> 'documento_id'), true);
select set_config('request.jwt.claims', '', true);
update public.documentos set upload_status = 'concluido' where id = current_setting('testes.upload')::uuid;

insert into public.notas_automaticas (empresa_id, buscar_desde, nfse_ult_nsu) values (current_setting('testes.empresa_a')::uuid, null, 10);
insert into public.notas_automaticas_nsu (empresa_id, servico, nsu, tipo, documento_id) values
  (current_setting('testes.empresa_a')::uuid, 'nfse', '5', 'NFSE', current_setting('testes.ago')::uuid),
  (current_setting('testes.empresa_a')::uuid, 'nfse', '6', 'NFSE', current_setting('testes.set')::uuid);
insert into public.notas_automaticas_nsu (empresa_id, servico, nsu, tipo, ignorado, competencia) values
  (current_setting('testes.empresa_a')::uuid, 'nfse', '7', 'NFSE', true, '2026-07-01'),
  (current_setting('testes.empresa_a')::uuid, 'nfe', '8', 'procNFe', true, '2026-08-01');
insert into public.nfe_resumos (empresa_id, chave, data_emissao, valor) values
  (current_setting('testes.empresa_a')::uuid, '17260855566677000188550010000000071000000071', '2026-08-25T09:00:00-03:00', 10),
  (current_setting('testes.empresa_a')::uuid, '17260955566677000188550010000000081000000081', '2026-09-25T09:00:00-03:00', 20);
insert into public.auditor_achados (empresa_id, regra, chave, competencia, tipo, confianca, titulo, resumo) values
  (current_setting('testes.empresa_a')::uuid, 'teste_mes', '17260811444777000161550010000000051000000051', '2026-08-01', 'risco', 'alta', 'Achado de agosto', 'Resumo do achado');

select is((select count(*)::int from public.lancamentos where documento_fiscal_id in
            (select id from public.documentos_fiscais where documento_id = current_setting('testes.ago')::uuid)), 1,
          'nota de agosto gerou um lançamento sugerido');

-- 1. Padrão para empresas novas: o mês anterior
insert into public.notas_automaticas (empresa_id) values (current_setting('testes.empresa_b')::uuid);
select is((select buscar_desde from public.notas_automaticas where empresa_id = current_setting('testes.empresa_b')::uuid),
          (date_trunc('month', (now() at time zone 'America/Araguaina')::date) - interval '1 month')::date,
          'empresa nova começa no mês anterior');

-- 2. Quem muda o mês inicial
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$, '42501', null,
                 'colaborador sem a permissão do certificado não muda o mês');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$, '42501', null,
                 'outra empresa não muda o mês');
select is((select count(*)::int from public.notas_automaticas_por_mes(current_setting('testes.empresa_a')::uuid)), 0,
          'outra empresa não vê o resumo por mês');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid,
                     (date_trunc('month', now()) + interval '1 month')::date)$$, 'P0001', 'O mês inicial não pode ser depois do mês atual.',
                 'mês inicial no futuro é recusado');
select throws_ok($$select public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid, '2026-09-15')$$, 'P0001', 'Mês inicial inválido.',
                 'mês inicial precisa ser o primeiro dia do mês');
select is((public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid, '2026-09-01') ->> 'anteriores_no_portal')::int, 1,
          'titular escolhe setembro: 1 arquivo automático anterior no portal (o enviado pelo cliente não conta)');
select is((select array_agg(competencia::text || '=' || total order by competencia)
             from public.notas_automaticas_por_mes(current_setting('testes.empresa_a')::uuid)),
          array['2026-08-01=1', '2026-09-01=1'], 'titular vê o resumo mês a mês das notas automáticas');
select is((select nfe_saida from public.notas_automaticas_por_mes(current_setting('testes.empresa_a')::uuid) where competencia = '2026-09-01'), 1,
          'resumo separa por tipo (NF-e de saída)');
reset role;
select is((select buscar_desde from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid), date '2026-09-01',
          'mês inicial gravado');
select ok(exists (select 1 from public.auditoria where acao = 'notas_automaticas_mes_inicial' and empresa_id = current_setting('testes.empresa_a')::uuid),
          'mudança do mês fica na auditoria');

-- 3. Só o administrador apaga, com motivo; mês fechado não muda
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.apagar_notas_anteriores(current_setting('testes.empresa_a')::uuid, 'Começar do zero')$$, '42501', 'Acesso negado.',
                 'cliente não apaga');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.apagar_notas_anteriores(current_setting('testes.empresa_a')::uuid, 'Começar do zero')$$, '42501', 'Acesso negado.',
                 'equipe não apaga (só o administrador)');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$select public.apagar_notas_anteriores(current_setting('testes.empresa_a')::uuid, 'ok')$$, 'P0001',
                 'Informe o motivo (pelo menos 5 letras).', 'motivo é obrigatório');
reset role;
insert into public.competencias (empresa_id, competencia, status) values (current_setting('testes.empresa_a')::uuid, '2026-08-01', 'fechada');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$select public.apagar_notas_anteriores(current_setting('testes.empresa_a')::uuid, 'Começar do zero')$$, 'P0001',
                 'O mês 08/2026 está fechado. Reabra o fechamento antes de apagar os documentos dele.', 'mês fechado não é apagado');
reset role;
update public.competencias set status = 'aberta' where empresa_id = current_setting('testes.empresa_a')::uuid and competencia = '2026-08-01';

-- 4. Administrador apaga as notas automáticas anteriores a setembro
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('testes.res', public.apagar_notas_anteriores(current_setting('testes.empresa_a')::uuid, 'Começar a usar o portal em setembro')::text, true);
reset role;
select is(current_setting('testes.res')::jsonb - 'ate',
          '{"documentos": 1, "notas": 1, "lancamentos": 1, "eventos": 0, "resumos": 1, "achados": 1, "sped": 0}'::jsonb,
          'apaga o arquivo, a nota lida, o lançamento sugerido, os resumos e o achado de agosto');
select is((select count(*)::int from public.documentos where id = current_setting('testes.ago')::uuid), 0, 'arquivo automático de agosto saiu');
select is((select count(*)::int from public.documentos where id in (current_setting('testes.set')::uuid, current_setting('testes.upload')::uuid)), 2,
          'setembro e o arquivo enviado pelo cliente ficam');
select is((select count(*)::int from public.documentos_fiscais where empresa_id = current_setting('testes.empresa_a')::uuid), 1, 'só a nota de setembro fica lida');
select is((select count(*)::int from public.lancamentos where empresa_id = current_setting('testes.empresa_a')::uuid and origem = 'nfe'), 1,
          'só o lançamento de setembro fica');
select is((select array_agg(chave) from public.nfe_resumos where empresa_id = current_setting('testes.empresa_a')::uuid),
          array['17260955566677000188550010000000081000000081'], 'resumo de NF-e de agosto sai; o de setembro fica');
select is((select ignorado::text || '/' || competencia::text || '/' || coalesce(documento_id::text, 'sem documento')
             from public.notas_automaticas_nsu where empresa_id = current_setting('testes.empresa_a')::uuid and servico = 'nfse' and nsu = '5'),
          'true/2026-08-01/sem documento', 'NSU do arquivo apagado fica como ignorado, com o mês');
select ok(exists (select 1 from public.jobs where tipo = 'remover_arquivos' and empresa_id = current_setting('testes.empresa_a')::uuid
                    and payload -> 'caminhos' ? (current_setting('testes.empresa_a') || '/2026-08/' || current_setting('testes.ago') || '/v1-NFe-NSU-5.xml')),
          'arquivo vai para a fila de remoção do armazenamento');
select ok(exists (select 1 from public.auditoria where acao = 'apagar_documentos' and empresa_id = current_setting('testes.empresa_a')::uuid
                    and detalhes ->> 'motivo' = 'Começar a usar o portal em setembro'),
          'exclusão fica na auditoria, com o motivo');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((public.apagar_notas_anteriores(current_setting('testes.empresa_a')::uuid, 'De novo, nada a apagar') ->> 'documentos')::int, 0,
          'repetir não apaga mais nada');
reset role;

-- 5. Recuar o mês: NFS-e ignoradas voltam para a fila da busca; NF-e não
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.recuo', public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid, '2026-07-01')::text, true);
reset role;
select is((current_setting('testes.recuo')::jsonb ->> 'nfse_rebuscar')::int, 2, 'duas NFS-e ignoradas (julho e agosto) serão buscadas de novo');
select is((current_setting('testes.recuo')::jsonb ->> 'nfe_sem_volta')::int, 1, 'a NF-e ignorada de agosto não volta');
select is((select nfse_ult_nsu from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid), 4::bigint,
          'busca da NFS-e volta ao primeiro NSU liberado');
select is((select count(*)::int from public.notas_automaticas_nsu where empresa_id = current_setting('testes.empresa_a')::uuid and servico = 'nfse' and ignorado), 0,
          'NSU liberados saem do controle');
select is((select count(*)::int from public.notas_automaticas_nsu where empresa_id = current_setting('testes.empresa_a')::uuid and servico = 'nfe' and ignorado), 1,
          'NSU da NF-e continua ignorado');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((public.definir_inicio_notas(current_setting('testes.empresa_a')::uuid, '2026-10-01') ->> 'nfse_rebuscar')::int, 0,
          'avançar o mês não busca nada de novo');
reset role;

-- 6. Cadastro do certificado escolhe o mês; a troca não muda
create or replace function pg_temp.cadastrar_b(p_desde date) returns uuid language sql as $$
  select public.registrar_certificado(current_setting('testes.empresa_b')::uuid, 'EMPRESA B:12345678000195', '12345678000195', 'AC TESTE', '0B1C',
    repeat('D', 64), now() - interval '1 day', now() + interval '300 days', 'Autorização de teste.', 'v1:QUJDRA==', p_desde);
$$;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select isnt(pg_temp.cadastrar_b('2026-07-01'), null, 'titular cadastra o certificado escolhendo julho');
reset role;
select is((select buscar_desde from public.notas_automaticas where empresa_id = current_setting('testes.empresa_b')::uuid), date '2026-07-01',
          'mês escolhido no cadastro vale para a busca');
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select isnt(pg_temp.cadastrar_b('2026-01-01'), null, 'troca do certificado');
reset role;
select is((select buscar_desde from public.notas_automaticas where empresa_id = current_setting('testes.empresa_b')::uuid), date '2026-07-01',
          'troca do certificado não muda o mês inicial');
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select pg_temp.cadastrar_b((date_trunc('month', now()) + interval '2 months')::date)$$, 'P0001',
                 'O mês inicial não pode ser depois do mês atual.', 'cadastro com mês no futuro é recusado');
reset role;

select * from finish();
rollback;
