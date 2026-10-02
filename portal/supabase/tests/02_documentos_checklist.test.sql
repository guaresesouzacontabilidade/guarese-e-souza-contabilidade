-- Critérios: envios vinculados à empresa e competência corretas; checklist
-- distingue envio de conferência; duplicidades detectadas; versões preservadas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

\ir 00_setup.sql.inc

-- Conta bancária para itens "por conta"
insert into public.contas_financeiras (empresa_id, tipo, nome, banco_nome, saldo_inicial, saldo_inicial_data)
values (current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'Banco do Brasil 1234-5', 'Banco do Brasil', 1000, '2026-08-31');

-- Checklist de setembro/2026 gerado de forma idempotente
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select ok(public.gerar_checklist_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-15') > 0, 'checklist do mês gerado');
select is(public.gerar_checklist_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01'), 0, 'geração repetida não duplica itens');
select ok(exists (select 1 from public.checklist_itens where competencia = '2026-09-01' and titulo like 'Extrato bancário do mês — Banco do Brasil%'),
          'item de extrato criado por conta bancária');
select is((select prazo from public.checklist_itens where competencia = '2026-09-01' and titulo like 'Extrato bancário%'), '2026-10-10'::date,
          'prazo calculado no mês seguinte à competência');

select set_config('testes.item', (select id::text from public.checklist_itens where competencia = '2026-09-01' and titulo like 'Extrato bancário%'), true);

-- Envio vinculado ao item
select set_config('testes.doc1', public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-20', 'extrato_bancario',
  'extrato-setembro.ofx', 'application/x-ofx', 4096, repeat('1', 64), 'Extrato completo', current_setting('testes.item')::uuid)::text, true);
select is((select competencia from public.documentos where id = (current_setting('testes.doc1')::jsonb ->> 'documento_id')::uuid), '2026-09-01'::date,
          'competência normalizada para o 1º dia do mês, separada da data de envio');
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('documentos', current_setting('testes.doc1')::jsonb ->> 'storage_path', '00000000-0000-0000-0000-0000000000b1',
        jsonb_build_object('size', 4096, 'mimetype', 'application/x-ofx'));
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.confirmar_upload(%L::uuid)$$, current_setting('testes.doc1')::jsonb ->> 'versao_id'), 'recebimento confirmado');
select is((select status from public.documentos where id = (current_setting('testes.doc1')::jsonb ->> 'documento_id')::uuid), 'recebido', 'documento com status Recebido');
select ok((select enviado_em is not null from public.documentos where id = (current_setting('testes.doc1')::jsonb ->> 'documento_id')::uuid), 'data do envio registrada');
select is((select status from public.checklist_itens where id = current_setting('testes.item')::uuid), 'enviado',
          'item fica "enviado — aguardando conferência", não concluído');
select is((public.resumo_checklist(current_setting('testes.empresa_a')::uuid, '2026-09-01') ->> 'concluidos')::int, 0,
          'envio sem conferência não conta como concluído');
reset role;
select ok(exists (select 1 from public.jobs where tipo = 'processar_documento'), 'processamento em segundo plano enfileirado');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

-- Duplicidade pelo conteúdo
select is(public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-20', 'extrato_bancario',
  'outro-nome.ofx', 'application/x-ofx', 4096, repeat('1', 64)) ->> 'situacao', 'duplicado', 'arquivo idêntico detectado como duplicado');

-- Formato não permitido
select throws_ok(format($$select public.criar_documento(%L::uuid, '2026-09-20', 'nfe_saida_xml', 'nota.exe', 'application/octet-stream', 10, repeat('2', 64))$$,
                        current_setting('testes.empresa_a')), null, null, 'extensão não permitida é recusada');

-- Cliente não altera status
select throws_ok(format($$select public.alterar_status_documento(%L::uuid, 'aprovado')$$, current_setting('testes.doc1')::jsonb ->> 'documento_id'),
                 '42501', null, 'cliente não aprova documento');
select throws_ok(format($$update public.documentos set status = 'aprovado' where id = %L$$, current_setting('testes.doc1')::jsonb ->> 'documento_id'),
                 '42501', null, 'cliente não altera status diretamente na tabela');
reset role;

-- Equipe conferindo
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok(format($$select public.alterar_status_documento(%L::uuid, 'correcao', '')$$, current_setting('testes.doc1')::jsonb ->> 'documento_id'),
                 null, null, 'correção exige motivo');
select lives_ok(format($$select public.alterar_status_documento(%L::uuid, 'correcao', 'Extrato sem os dias 25 a 30')$$, current_setting('testes.doc1')::jsonb ->> 'documento_id'),
                'equipe solicita correção com motivo');
select is((select status from public.checklist_itens where id = current_setting('testes.item')::uuid), 'correcao', 'item passa a "precisa de correção"');
reset role;
select ok(exists (select 1 from public.notificacoes where tipo = 'documento_correcao' and user_id = '00000000-0000-0000-0000-0000000000b1'),
          'cliente notificado da correção');
select ok(exists (select 1 from public.envios where tipo = 'documento_correcao' and canal = 'email' and status = 'pendente'),
          'e-mail de correção registrado no histórico de envios');

-- Substituição preserva o original
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.v2', public.substituir_documento((current_setting('testes.doc1')::jsonb ->> 'documento_id')::uuid,
  'extrato-setembro-completo.ofx', 'application/x-ofx', 5000, repeat('3', 64), 'Extrato completo')::text, true);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('documentos', current_setting('testes.v2')::jsonb ->> 'storage_path', '00000000-0000-0000-0000-0000000000b1',
        jsonb_build_object('size', 5000, 'mimetype', 'application/x-ofx'));
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.confirmar_upload(%L::uuid)$$, current_setting('testes.v2')::jsonb ->> 'versao_id'), 'nova versão recebida');
select is((select count(*)::int from public.documento_versoes where documento_id = (current_setting('testes.doc1')::jsonb ->> 'documento_id')::uuid), 2,
          'versão original preservada no histórico');
select is((select status from public.documentos where id = (current_setting('testes.doc1')::jsonb ->> 'documento_id')::uuid), 'recebido',
          'documento substituído volta a Recebido');
select is((select status from public.checklist_itens where id = current_setting('testes.item')::uuid), 'enviado', 'item volta a aguardar conferência');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.alterar_status_documento(%L::uuid, 'aprovado')$$, current_setting('testes.doc1')::jsonb ->> 'documento_id'),
                'equipe aprova após conferência');
select is((select status from public.checklist_itens where id = current_setting('testes.item')::uuid), 'concluido',
          'item concluído somente após a conferência');
reset role;

-- "Não se aplica" com revisão do escritório
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.item_na', (select id::text from public.checklist_itens where competencia = '2026-09-01' and categoria_codigo = 'folha_pagamento' limit 1), true);
select lives_ok(format($$select public.solicitar_nao_aplica(%L::uuid, 'Sem funcionários neste mês')$$, current_setting('testes.item_na')),
                'cliente solicita "não se aplica" com justificativa');
select is((select status from public.checklist_itens where id = current_setting('testes.item_na')::uuid), 'nao_se_aplica_solicitado',
          'solicitação aguarda revisão do escritório');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.revisar_nao_aplica(%L::uuid, true, 'Confirmado')$$, current_setting('testes.item_na')),
                'escritório aprova "não se aplica"');
reset role;

select * from finish();
rollback;
