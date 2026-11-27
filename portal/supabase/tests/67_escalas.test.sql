-- Escalas de trabalho: permissões, rascunho x publicada, isolamento entre
-- empresas e o assistente de IA (chave invisível, desconectado até ligar,
-- limite diário por empresa).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

-- Permissões padrão
select ok(app.pode(current_setting('testes.empresa_a')::uuid, 'escalas.gerenciar') is not null, 'função de permissão responde');
select ok('escalas.gerenciar' = any(app.permissoes_padrao('cliente_titular')), 'o empresário monta escalas por padrão');
select ok(not ('escalas.ver' = any(app.permissoes_padrao('cliente_colaborador'))), 'o colaborador do cliente não vê escalas por padrão');
select lives_ok($$update public.empresas set ferramentas_desligadas = array['escalas'] where id = current_setting('testes.empresa_b')::uuid$$,
  'a ferramenta de escalas pode ser desligada pelo escritório');

-- Empresário titular: cadastra funcionários e monta a escala
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$insert into public.escala_funcionarios (empresa_id, nome, cargo, jornada_semanal, nao_trabalha, domingo_quinzenal)
  values (current_setting('testes.empresa_a')::uuid, 'Maria Teste', 'Atendente', 44, array[3]::smallint[], true)$$, 'empresário cadastra funcionário da escala');
select throws_ok($$insert into public.escala_funcionarios (empresa_id, nome, jornada_semanal) values (current_setting('testes.empresa_a')::uuid, 'Hora Demais', 48)$$,
  '23514', null, 'jornada acima de 44 horas por semana é recusada');
select throws_ok($$insert into public.escala_funcionarios (empresa_id, nome, nao_trabalha) values (current_setting('testes.empresa_a')::uuid, 'Dia Errado', array[7]::smallint[])$$,
  '23514', null, 'dia da semana inválido é recusado');
select lives_ok($$insert into public.escalas (id, empresa_id, nome, competencia, config, grade)
  values ('00000000-0000-0000-0000-00000000e501', current_setting('testes.empresa_a')::uuid, 'Loja — dezembro', '2026-12-01', '{"turnos": []}', '{}')$$,
  'empresário cria a escala em rascunho');
select throws_ok($$insert into public.escalas (empresa_id, nome, competencia) values (current_setting('testes.empresa_a')::uuid, 'Meio do mês', '2026-12-15')$$,
  '23514', null, 'a escala é sempre do mês inteiro (dia 1)');
reset role;

-- Colaborador com "ver escalas": não vê o rascunho nem os funcionários; vê depois de publicada
update public.empresa_membros set permissoes = permissoes || array['escalas.ver']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.escalas), 0, 'quem só vê não enxerga o rascunho');
select is((select count(*)::int from public.escala_funcionarios), 0, 'quem só vê não enxerga o cadastro dos funcionários');
select throws_ok($$insert into public.escalas (empresa_id, nome, competencia) values (current_setting('testes.empresa_a')::uuid, 'Intrusa', '2026-12-01')$$,
  '42501', null, 'quem só vê não cria escala');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.escalas set status = 'publicada' where id = '00000000-0000-0000-0000-00000000e501';
select ok((select publicada_em is not null and publicada_por = '00000000-0000-0000-0000-0000000000b1'::uuid from public.escalas where id = '00000000-0000-0000-0000-00000000e501'),
  'publicar registra quem e quando');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.escalas), 1, 'depois de publicada, quem só vê enxerga a escala');
reset role;

-- Cliente de outra empresa: não vê nem cria nada na empresa A
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.escalas where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'outra empresa não vê as escalas');
select throws_ok($$insert into public.escala_funcionarios (empresa_id, nome) values (current_setting('testes.empresa_a')::uuid, 'Invasor')$$,
  '42501', null, 'outra empresa não cadastra funcionário');
reset role;

-- Assistente de IA: desconectado até o administrador cadastrar a chave
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like($$select * from public.escala_ia_reservar(current_setting('testes.empresa_a')::uuid, 'sugerir')$$,
  '%desconectado%', 'sem chave, o assistente responde que está desconectado');
select is((select count(*)::int from public.escritorio_ia), 0, 'cliente não lê a configuração da IA');
select throws_ok($$select public.escritorio_ia_salvar_chave('v1:QUJD', 'abcd')$$, '42501', null, 'cliente não cadastra a chave');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$select count(*) from public.escritorio_ia_segredo$$, '42501', null, 'nem o administrador lê a chave cifrada pelo navegador');
select lives_ok($$select public.escritorio_ia_salvar_chave('v1:QUJDREVGRw==', 'wxyz'); select public.escritorio_ia_configurar(true, 'claude-opus-5-5', 1)$$,
  'administrador cadastra a chave e liga o assistente com limite de 1 por dia');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select ok((select uso_id is not null from public.escala_ia_reservar(current_setting('testes.empresa_a')::uuid, 'sugerir')), 'com a chave, o pedido é reservado e registrado');
select throws_like($$select * from public.escala_ia_reservar(current_setting('testes.empresa_a')::uuid, 'ajustar')$$,
  '%Limite de 1 pedidos por dia%', 'passou do limite diário da empresa, o pedido é recusado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select * from public.escala_ia_reservar(current_setting('testes.empresa_a')::uuid, 'sugerir')$$, '42501', null,
  'cliente de outra empresa não usa o assistente na empresa A');
reset role;

select * from finish();
rollback;
