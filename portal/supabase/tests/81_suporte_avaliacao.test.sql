-- Critérios: cada pergunta fica registrada sem o texto; o texto só fica quando
-- o guia não respondeu ou a pessoa marcou "não ajudou", com os números longos
-- mascarados; só quem perguntou avalia; só a equipe do escritório lê e trata;
-- a limpeza é só do servidor.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.p1', public.suporte_registrar(jsonb_build_object(
  'empresa_id', current_setting('testes.empresa_a'), 'tela', '/e/' || current_setting('testes.empresa_a') || '/notas-servico', 'modo', 'guia',
  'achou', true, 'trechos', jsonb_build_array('Emitir nota de serviço'), 'atalhos', 1, 'pergunta', 'como emito nota para o CPF 123.456.789-09?'))::text, true);
select set_config('testes.p2', public.suporte_registrar(jsonb_build_object(
  'empresa_id', current_setting('testes.empresa_a'), 'tela', '/painel', 'modo', 'guia', 'achou', false,
  'pergunta', 'meu telefone (63) 99999-1234 não recebe o boleto'))::text, true);
select is((select count(*)::int from public.suporte_perguntas), 0, 'quem pergunta não lê as perguntas registradas');
reset role;
select is((select coalesce(pergunta, 'sem texto') || ' | ' || tela from public.suporte_perguntas where id = current_setting('testes.p1')::bigint),
  'sem texto | /e/:id/notas-servico', 'com resposta no guia: sem o texto e sem o número da empresa na tela');
select is((select pergunta from public.suporte_perguntas where id = current_setting('testes.p2')::bigint),
  'meu telefone ••• não recebe o boleto', 'sem resposta: guarda o texto com os números mascarados');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.suporte_avaliar(current_setting('testes.p1')::bigint, false, 'como emito nota para o CPF 123.456.789-09?');
reset role;
select is((select pergunta || ' ' || util from public.suporte_perguntas where id = current_setting('testes.p1')::bigint),
  'como emito nota para o CPF •••? false', '"não ajudou": a dúvida vai mascarada para o escritório');
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.suporte_avaliar(%s, true)$$, current_setting('testes.p2')), '%não encontrada%', 'só quem perguntou avalia');
select throws_like(format($$select public.suporte_tratar(%s, true)$$, current_setting('testes.p2')), '%equipe do escritório%', 'cliente não trata as dúvidas');
reset role;

-- Equipe do escritório lê e trata
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.suporte_perguntas where pergunta is not null), 2, 'a equipe vê as dúvidas sem resposta ou que não ajudaram');
select public.suporte_tratar(current_setting('testes.p2')::bigint, true);
select ok((select tratada_em is not null and tratada_por = '00000000-0000-0000-0000-0000000000a2' from public.suporte_perguntas where id = current_setting('testes.p2')::bigint),
  'dúvida marcada como tratada');
select throws_like($$select public.rotina_suporte_limpeza()$$, '%permission denied%', 'a limpeza é só do servidor');
reset role;

-- Limpeza: registros com mais de 180 dias somem
update public.suporte_perguntas set created_at = now() - interval '200 days' where id = current_setting('testes.p1')::bigint;
set local role service_role;
select is(public.rotina_suporte_limpeza(), 1, 'apaga o que passou de 180 dias');
reset role;
select is((select count(*)::int from public.suporte_perguntas), 1, 'fica só o recente');

select * from finish();
rollback;
