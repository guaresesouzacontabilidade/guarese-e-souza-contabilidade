-- Critérios: o mapa da carteira mostra, para cada empresa que a pessoa da
-- equipe atende, os números das 6 etapas do mês (documentos, notas, extrato,
-- impostos, obrigações e fechamento) lidos do que o portal já guarda; a equipe
-- marca etapas como concluídas ou "não se aplica" (no mês ou em todos os meses)
-- e escreve anotações internas; cliente e equipe que não atende a empresa não
-- veem nem mexem.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

\ir 00_setup.sql.inc

select set_config('t.hoje', app.hoje()::text, true);
-- Competência antiga (nada gerado sozinho nela)
select set_config('t.comp', '2025-06-01', true);

-- ---------------------------------------------------------------- dados da Empresa A em 06/2025
-- Checklist: 1 conferido, 1 atrasado, 1 com o cliente no prazo, 1 enviado para conferir, 1 opcional
insert into public.checklist_itens (empresa_id, competencia, categoria_codigo, titulo, prazo, status, obrigatorio) values
  (current_setting('testes.empresa_a')::uuid, '2025-06-01', 'extrato_bancario', 'Extrato do Banco X', current_setting('t.hoje')::date - 30, 'concluido', true),
  (current_setting('testes.empresa_a')::uuid, '2025-06-01', 'folha_pagamento', 'Folha de ponto', current_setting('t.hoje')::date - 3, 'pendente', true),
  (current_setting('testes.empresa_a')::uuid, '2025-06-01', 'comprovante', 'Comprovantes de PIX', current_setting('t.hoje')::date + 5, 'pendente', true),
  (current_setting('testes.empresa_a')::uuid, '2025-06-01', 'boleto', 'Boletos pagos', current_setting('t.hoje')::date + 5, 'enviado', true),
  (current_setting('testes.empresa_a')::uuid, '2025-06-01', 'outros', 'Opcional', current_setting('t.hoje')::date - 9, 'pendente', false);

-- Tarefas: apuração concluída, pagamento sem guia e vencido, entrega esperando o cliente
select set_config('t.obr', (select id::text from public.obrigacoes order by codigo limit 1), true);
insert into public.tarefas (empresa_id, obrigacao_id, competencia, etapa, status, prazo_legal, prazo_interno, concluida_em) values
  (current_setting('testes.empresa_a')::uuid, current_setting('t.obr')::uuid, '2025-06-01', 'apuracao', 'concluida', null,
   current_setting('t.hoje')::date - 10, now() - interval '20 days');
insert into public.tarefas (empresa_id, obrigacao_id, competencia, etapa, status, prazo_legal, prazo_interno) values
  (current_setting('testes.empresa_a')::uuid, current_setting('t.obr')::uuid, '2025-06-01', 'pagamento', 'pendente',
   current_setting('t.hoje')::date - 1, current_setting('t.hoje')::date - 3),
  (current_setting('testes.empresa_a')::uuid, current_setting('t.obr')::uuid, '2025-06-01', 'entrega', 'aguardando_cliente',
   current_setting('t.hoje')::date + 12, current_setting('t.hoje')::date + 10);

-- Extrato: duas contas correntes; uma com 2 lançamentos no mês (1 pendente), a outra sem extrato
insert into public.contas_financeiras (id, empresa_id, tipo, nome, saldo_inicial_data) values
  ('00000000-0000-0000-0000-00000000c0a1', current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'Banco X', '2025-01-31'),
  ('00000000-0000-0000-0000-00000000c0a2', current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'Banco Y', '2025-01-31');
insert into public.movimentos_bancarios (empresa_id, conta_financeira_id, data, valor, descricao, chave_dedupe, status_conciliacao) values
  (current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000c0a1', '2025-06-10', 150, 'PIX recebido', 'k1', 'pendente'),
  (current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-00000000c0a1', '2025-06-12', -80, 'Tarifa', 'k2', 'conciliado');

-- Notas: 1 XML de entrada no portal e 1 resumo da SEFAZ ainda sem o XML completo
insert into public.documentos (empresa_id, direcao, competencia, categoria_codigo, nome_original, status, upload_status, extensao)
values (current_setting('testes.empresa_a')::uuid, 'cliente', '2025-06-01', 'nfe_entrada_xml', 'nota-1.xml', 'recebido', 'concluido', 'xml');
insert into public.nfe_resumos (empresa_id, chave, data_emissao, situacao)
values (current_setting('testes.empresa_a')::uuid, repeat('1', 44), '2025-06-15 10:00:00-03', 'autorizada');

-- Fechamento iniciado
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.iniciar_fechamento(current_setting('testes.empresa_a')::uuid, '2025-06-01');
reset role;

-- ---------------------------------------------------------------- 1. Quem vê
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like($$select * from public.operacional_mapa('2025-06-01')$$, '%Acesso negado%', 'cliente não vê o mapa da carteira');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*)::int from public.operacional_mapa('2025-06-01') m where m.empresa_id = current_setting('testes.empresa_a')::uuid),
  0, 'equipe que não atende a empresa não a vê no mapa');
select throws_like(format($$select public.operacional_marcar(%L, 'notas', '2025-06-01', 'concluida')$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'equipe que não atende a empresa não marca etapa');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
create temp table m as select * from public.operacional_mapa('2025-06-01') x where x.empresa_id = current_setting('testes.empresa_a')::uuid;
reset role;
select is((select count(*)::int from m), 1, 'o contador da empresa a vê no mapa');

-- ---------------------------------------------------------------- 2. Números de cada etapa
select is((select format('%s|%s|%s|%s|%s|%s', d->>'total', d->>'ok', d->>'cliente', d->>'atrasados', d->>'conferir', d->>'tarde')
             from (select dados->'documentos' d from m) x),
  '4|1|1|1|1|true', 'documentos: obrigatórios, conferidos, com o cliente, atrasados e para conferir');
select is((select dados->'documentos'->'faltam'->>0 from m), 'Folha de ponto', 'documentos: o que falta, do prazo mais antigo');
select is((select format('%s|%s|%s|%s', d->>'total', d->>'ok', d->>'atrasadas', d->>'prazo') from (select dados->'impostos' d from m) x),
  format('2|1|1|%s', current_setting('t.hoje')::date - 1), 'impostos: pagamento sem guia e vencido fica atrasado');
select is((select format('%s|%s|%s', d->>'total', d->>'cliente', d->>'ok') from (select dados->'obrigacoes' d from m) x),
  '1|1|0', 'obrigações: entrega esperando o cliente');
select is((select format('%s|%s|%s|%s', d->>'contas', d->>'movimentos', d->>'pendentes', d->>'contas_sem_extrato') from (select dados->'extrato' d from m) x),
  '2|2|1|1', 'extrato: lançamentos do mês, pendentes e conta sem extrato');
select is((select format('%s|%s|%s', d->>'docs', d->>'sem_xml', d->>'auto') from (select dados->'notas' d from m) x),
  '1|1|sem', 'notas: XML no portal, resumo sem XML e busca automática desligada');
select is((select format('%s|%s', d->>'status', d->>'etapa') from (select dados->'fechamento' d from m) x),
  'em_fechamento|coleta', 'fechamento: em andamento, na coleta');

-- Guia enviada: para o escritório o pagamento está feito
insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, upload_status, extensao)
values ('00000000-0000-0000-0000-00000000d0c1', current_setting('testes.empresa_a')::uuid, 'escritorio', '2025-06-01', 'esc_guia', 'guia.pdf', 'concluido', 'pdf');
update public.tarefas set guia_documento_id = '00000000-0000-0000-0000-00000000d0c1'
 where empresa_id = current_setting('testes.empresa_a')::uuid and competencia = '2025-06-01' and etapa = 'pagamento';
select is((select format('%s|%s', d->>'ok', d->>'atrasadas') from (select app.operacional_dados(current_setting('testes.empresa_a')::uuid, '2025-06-01')->'impostos' d) x),
  '2|0', 'impostos: com a guia enviada, o pagamento conta como feito');

-- ---------------------------------------------------------------- 3. Marcações
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.operacional_marcar(%L, 'notas', '2025-06-01', 'concluida', 'Conferido no sistema antigo')$$,
  current_setting('testes.empresa_a')), 'a equipe marca a etapa como concluída no mês');
select is((select dados->'marcacoes'->'notas'->>'situacao' || '|' || (dados->'marcacoes'->'notas'->>'observacao')
             from public.operacional_mapa('2025-06-01', current_setting('testes.empresa_a')::uuid)),
  'concluida|Conferido no sistema antigo', 'a marcação aparece no mapa com a observação');
select lives_ok(format($$select public.operacional_marcar(%L, 'extrato', null, 'nao_se_aplica', null, true)$$,
  current_setting('testes.empresa_a')), '"não se aplica" em todos os meses');
select is((select dados->'marcacoes'->'extrato'->>'todas' from public.operacional_mapa('2025-07-01', current_setting('testes.empresa_a')::uuid)),
  'true', '"não se aplica" de todos os meses vale em outro mês');
select throws_like(format($$select public.operacional_marcar(%L, 'impostos', null, 'concluida', null, true)$$, current_setting('testes.empresa_a')),
  '%Só "não se aplica"%', 'concluída vale só para um mês');
select public.operacional_desmarcar(current_setting('testes.empresa_a')::uuid, 'notas', '2025-06-01');
select is((select (dados->'marcacoes') ? 'notas' from public.operacional_mapa('2025-06-01', current_setting('testes.empresa_a')::uuid)),
  false, 'desmarcar volta a etapa ao que os dados mostram');

-- ---------------------------------------------------------------- 4. Anotações, histórico e últimas ações
select set_config('t.nota', public.operacional_anotar(current_setting('testes.empresa_a')::uuid,
  'Cliente manda o extrato só depois do dia 10.')::text, true);
select is((select count(*)::int from public.operacional_historico(current_setting('testes.empresa_a')::uuid, '2025-06-01', 3)),
  3, 'histórico dos últimos meses');
select ok((select bool_or(texto like 'Fechamento iniciado (06/2025)%') from public.operacional_ultimas_acoes(current_setting('testes.empresa_a')::uuid)),
  'últimas ações mostram o fechamento iniciado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.operacional_anotacoes), 0, 'cliente não vê as anotações da equipe');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000a3', 'equipe');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_like(format($$select public.operacional_anotacao_excluir(%L)$$, current_setting('t.nota')),
  '%Só quem escreveu%', 'outra pessoa da equipe não apaga a anotação');
reset role;

select * from finish();
rollback;
