-- Critérios: a competência da nota segue a data de emissão escrita no XML
-- (horário de Brasília); o lote de XML só é pedido e baixado por quem pode
-- baixar os documentos da empresa; o lote pedido pela equipe não aparece ao
-- cliente; preparar, gravar e concluir são só do processador; o download
-- registra o acesso a cada documento e é recusado se algum arquivo foi
-- excluído depois; a carteira avisa uma vez, no fim; lotes vencidos têm os
-- arquivos apagados.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(35);

\ir 00_setup.sql.inc

create or replace function pg_temp.enviar(p_categoria text, p_nome text, p_hash text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-01', p_categoria, p_nome, 'application/xml', 1000, p_hash);
  insert into storage.objects (bucket_id, name, metadata) values ('documentos', r ->> 'storage_path', '{"size": 1000, "mimetype": "application/xml"}');
  perform public.confirmar_upload((r ->> 'versao_id')::uuid);
  return (r ->> 'documento_id')::uuid;
end $$;

create or replace function pg_temp.nfe(p_chave text, p_operacao text, p_data text, p_valor numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'tipo', 'nota', 'modelo', '55', 'tipo_documento', 'NF-e', 'chave_acesso', p_chave, 'identificador', p_chave,
    'numero', right(p_chave, 9), 'serie', '1', 'data_emissao', p_data,
    'emitente_documento', '11444777000161', 'emitente_nome', 'Empresa A Comércio Ltda',
    'destinatario_documento', '98765432000198', 'destinatario_nome', 'Cliente X Ltda',
    'tp_nf', '1', 'operacao', p_operacao, 'valor_total', p_valor, 'situacao_arquivo', 'protocolo_autorizacao_no_arquivo',
    'relacionado_empresa', true,
    'itens', jsonb_build_array(jsonb_build_object('numero_item', 1, 'descricao', 'Produto', 'cfop', '5102', 'quantidade', 1,
                                                  'valor_unitario', p_valor, 'valor_total', p_valor)));
$$;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.doc1', pg_temp.enviar('nfe_saida_xml', 'nfe-1.xml', repeat('a', 64))::text, true);
select set_config('testes.doc2', pg_temp.enviar('nfe_entrada_xml', 'nfe-2.xml', repeat('b', 64))::text, true);
select set_config('testes.doc3', pg_temp.enviar('nfe_saida_xml', 'nfe-3.xml', repeat('c', 64))::text, true);
select set_config('request.jwt.claims', '', true);
select public.registrar_xml_fiscal(current_setting('testes.doc1')::uuid,
  pg_temp.nfe('17260911444777000161550010000000011000000011', 'saida', '2026-09-15T10:00:00-03:00', 1000));
select public.registrar_xml_fiscal(current_setting('testes.doc2')::uuid,
  pg_temp.nfe('17260911444777000161550010000000021000000021', 'entrada', '2026-09-30T22:30:00-03:00', 500));
select public.registrar_xml_fiscal(current_setting('testes.doc3')::uuid,
  pg_temp.nfe('17261011444777000161550010000000031000000031', 'saida', '2026-10-01T01:00:00-03:00', 700));

-- 1. Competência pela data local de emissão
select is((select competencia from public.documentos_fiscais where documento_id = current_setting('testes.doc2')::uuid), date '2026-09-01',
  'nota emitida em 30/09 às 22h30 (Brasília) fica em setembro');
select is((select competencia from public.documentos_fiscais where documento_id = current_setting('testes.doc3')::uuid), date '2026-10-01',
  'nota emitida em 01/10 à 1h fica em outubro');
select is(app.instante_do_texto('2026-09-30'), timestamptz '2026-09-30 12:00:00-03', 'data sem hora vira meio-dia de Brasília');

-- 2. Pedido do lote
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.lote_cli', public.solicitar_lote_xml(current_setting('testes.empresa_a')::uuid, '2026-09-10',
  array['nfe_saida', 'nfe_entrada', 'eventos'])::text, true);
select is(public.solicitar_lote_xml(current_setting('testes.empresa_a')::uuid, '2026-09-01', array['eventos', 'nfe_entrada', 'nfe_saida'])::text,
  current_setting('testes.lote_cli'), 'o mesmo pedido em preparo é reaproveitado');
select throws_ok($$select public.solicitar_lote_xml(current_setting('testes.empresa_a')::uuid, '2026-09-01', array['nfe_saida', 'boleto'])$$,
  'P0001', 'Tipo de nota inválido.', 'tipo de nota desconhecido é recusado');
select throws_ok($$select public.preparar_lote_xml(current_setting('testes.lote_cli')::uuid)$$, '42501', null, 'cliente não prepara o lote (só o processador)');
select throws_ok($$select public.concluir_lote_xml(current_setting('testes.lote_cli')::uuid, 'pronto')$$, '42501', null, 'cliente não conclui o lote');
select throws_ok($$select public.solicitar_lotes_xml_carteira('2026-09-01', array['nfe_saida'])$$, '42501', null, 'cliente não pede o lote da carteira');
reset role;
select is((select equipe from public.xml_lotes where id = current_setting('testes.lote_cli')::uuid), false, 'lote pedido pelo cliente não é exclusivo da equipe');
select is((select count(*)::int from public.jobs where tipo = 'gerar_lote_xml' and chave_idempotencia = 'lote:' || current_setting('testes.lote_cli')), 1,
  'lote entra na fila do processador');

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select public.solicitar_lote_xml(current_setting('testes.empresa_a')::uuid, '2026-09-01', array['nfe_saida'])$$,
  '42501', null, 'colaborador sem permissão de baixar não pede o lote');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.solicitar_lote_xml(current_setting('testes.empresa_a')::uuid, '2026-09-01', array['nfe_saida'])$$,
  '42501', null, 'cliente de outra empresa não pede o lote');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.lote_eq', public.solicitar_lote_xml(current_setting('testes.empresa_a')::uuid, '2026-09-01', array['nfe_saida'])::text, true);
select is((select count(*)::int from public.xml_lotes where empresa_id = current_setting('testes.empresa_a')::uuid), 2, 'equipe vê os lotes da empresa');
reset role;
select is((select equipe from public.xml_lotes where id = current_setting('testes.lote_eq')::uuid), true, 'lote pedido pela equipe fica só com a equipe');

-- 3. Visibilidade
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.xml_lotes), 1, 'cliente vê só o lote que não é exclusivo da equipe');
select throws_ok($$select public.baixar_lote_xml(current_setting('testes.lote_eq')::uuid, 1)$$, 'P0001', 'Lote não encontrado.',
  'cliente não baixa o lote da equipe');
select throws_ok($$select public.baixar_lote_xml(current_setting('testes.lote_cli')::uuid, 1)$$, 'P0001', 'Este lote não está mais disponível. Gere de novo.',
  'lote ainda em preparo não é baixado');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.xml_lotes), 0, 'outra empresa não vê os lotes');
reset role;

-- 4. Processador: prepara, grava a parte e conclui
select set_config('request.jwt.claims', '', true);
select is((public.preparar_lote_xml(current_setting('testes.lote_cli')::uuid) ->> 'arquivos')::int, 2, 'lote de setembro tem as duas notas do mês');
select ok(exists (select 1 from public.xml_lote_itens where lote_id = current_setting('testes.lote_cli')::uuid
                   and arquivo = 'NF-e de saida/17260911444777000161550010000000011000000011.xml'), 'arquivo vai para a pasta do tipo, com a chave no nome');
select public.registrar_parte_lote_xml(current_setting('testes.lote_cli')::uuid,
  jsonb_build_object('numero', 1, 'caminho', current_setting('testes.empresa_a') || '/lotes-xml/' || current_setting('testes.lote_cli') || '/parte-1.zip',
                     'nome', 'xml-2026-09-empresa-a.zip', 'arquivos', 2, 'bytes', 1234), 2, array[]::int[]);
select public.concluir_lote_xml(current_setting('testes.lote_cli')::uuid, 'pronto');
select is((select situacao from public.xml_lotes where id = current_setting('testes.lote_cli')::uuid), 'pronto', 'lote concluído fica pronto');
select ok((select expira_em between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from public.xml_lotes
            where id = current_setting('testes.lote_cli')::uuid), 'lote fica disponível por 7 dias');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'lote_xml'), 1,
  'quem pediu é avisado');

-- 5. Download
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.baixar_lote_xml(current_setting('testes.lote_cli')::uuid, 1) ->> 'nome', 'xml-2026-09-empresa-a.zip', 'cliente baixa o próprio lote');
select throws_ok($$select public.baixar_lote_xml(current_setting('testes.lote_cli')::uuid, 2)$$, 'P0001', 'Parte do lote não encontrada.',
  'parte inexistente é recusada');
reset role;
select is((select count(*)::int from public.documento_acessos where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'download_lote'), 2,
  'o download registra o acesso a cada documento do lote');
update public.documentos set excluido_em = now() where id = current_setting('testes.doc1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.baixar_lote_xml(current_setting('testes.lote_cli')::uuid, 1)$$, 'P0001',
  'Algum arquivo deste lote foi excluído depois que ele foi gerado. Gere o lote de novo.', 'lote com documento excluído depois não é entregue');
reset role;
update public.documentos set excluido_em = null where id = current_setting('testes.doc1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.baixar_lote_xml(current_setting('testes.lote_cli')::uuid, 1)$$, '42501', null, 'outra empresa não baixa o lote');
reset role;

-- 6. Carteira: só empresas com notas do tipo; um aviso, no fim
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((public.solicitar_lotes_xml_carteira('2026-09-01', array['nfe_saida']) ->> 'empresas')::int, 1, 'carteira gera lote só para quem tem notas no mês');
select is((public.solicitar_lotes_xml_carteira('2026-09-01', array['nfse_prestada']) ->> 'empresas')::int, 0, 'sem notas do tipo, nenhum lote');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.xml_lotes (id, empresa_id, competencia, tipos, pedido_id, situacao, equipe, solicitado_por) values
  ('00000000-0000-0000-0000-00000000f001', current_setting('testes.empresa_a')::uuid, '2026-08-01', array['nfe_saida'], '00000000-0000-0000-0000-00000000f0f0', 'gerando', true, '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-00000000f002', current_setting('testes.empresa_b')::uuid, '2026-08-01', array['nfe_saida'], '00000000-0000-0000-0000-00000000f0f0', 'gerando', true, '00000000-0000-0000-0000-0000000000a3');
select public.concluir_lote_xml('00000000-0000-0000-0000-00000000f001', 'pronto',
  '[{"numero": 1, "caminho": "x/lotes-xml/f001/parte-1.zip", "nome": "a.zip", "arquivos": 3, "bytes": 10}]');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a3' and tipo = 'lote_xml'), 0,
  'carteira não avisa enquanto há lote em preparo');
select public.concluir_lote_xml('00000000-0000-0000-0000-00000000f002', 'vazio');
select is((select corpo from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a3' and tipo = 'lote_xml'),
  '1 empresa com arquivos, 1 sem notas. Disponível por 7 dias.', 'carteira avisa uma vez, no fim, com o resumo');

-- 7. Lotes vencidos e apagados levam os arquivos
update public.xml_lotes set expira_em = now() - interval '1 minute' where id = current_setting('testes.lote_cli')::uuid;
select public.rotina_lotes_xml();
select is((select situacao from public.xml_lotes where id = current_setting('testes.lote_cli')::uuid), 'expirado', 'lote vencido expira');
select ok(exists (select 1 from public.jobs where tipo = 'remover_arquivos' and chave_idempotencia = 'lote-expirado:' || current_setting('testes.lote_cli')
                   and payload -> 'caminhos' ? (current_setting('testes.empresa_a') || '/lotes-xml/' || current_setting('testes.lote_cli') || '/parte-1.zip')),
  'arquivo do lote vencido é apagado pelo processador');
delete from public.xml_lotes where id = '00000000-0000-0000-0000-00000000f001';
select ok(exists (select 1 from public.jobs where tipo = 'remover_arquivos' and chave_idempotencia = 'lote-apagado:00000000-0000-0000-0000-00000000f001'),
  'lote apagado (ex.: empresa excluída) leva os arquivos');

select * from finish();
rollback;
