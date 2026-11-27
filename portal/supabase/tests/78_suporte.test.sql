-- Critérios: o assistente do suporte vem desligado (a busca no guia segue
-- valendo); só o administrador liga, e só com a chave cadastrada; cada pessoa
-- tem um limite de perguntas por dia; o registro não guarda o texto e só quem
-- reservou fecha; o cliente só pergunta sobre a própria empresa.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

\ir 00_setup.sql.inc

-- 1. Desligado: a reserva é recusada com aviso de desconectado
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select * from public.suporte_ia_reservar(%L)$$, current_setting('testes.empresa_a')), '%desconectado%', 'vem desligado');
select throws_ok($$select public.escritorio_ia_suporte(true, 5)$$, '42501', null, 'cliente não liga o assistente');
reset role;

-- 2. Administrador: sem chave não liga; com chave liga com limite de 2 por pessoa
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like($$select public.escritorio_ia_suporte(true, 2)$$, '%chave%', 'sem chave não liga');
reset role;
insert into public.escritorio_ia_segredo (id, chave_cifrada) values (1, 'v1:QUJDRA==') on conflict (id) do update set chave_cifrada = excluded.chave_cifrada;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.escritorio_ia_suporte(true, 2)$$, 'administrador liga com a chave cadastrada');
reset role;

-- 3. Cliente: reserva dentro do limite, o registro não tem texto, outra empresa não
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.uso', (select uso_id from public.suporte_ia_reservar(current_setting('testes.empresa_a')::uuid))::text, true);
select ok(current_setting('testes.uso')::bigint > 0, 'primeira pergunta reservada');
select throws_like(format($$select * from public.suporte_ia_reservar(%L)$$, current_setting('testes.empresa_b')), '%fora do seu acesso%', 'outra empresa não');
select public.suporte_ia_reservar(null);
select throws_like($$select * from public.suporte_ia_reservar(null)$$, '%Limite de 2%', 'limite por pessoa por dia');
reset role;

-- Outro usuário não fecha o registro alheio; o dono fecha
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select public.suporte_ia_concluir(current_setting('testes.uso')::bigint, true, 100, 50, null);
reset role;
select is((select ok from public.suporte_ia_usos where id = current_setting('testes.uso')::bigint), null::boolean, 'outro usuário não fecha o registro');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.suporte_ia_concluir(current_setting('testes.uso')::bigint, true, 100, 50, null);
select is((select ok::text || ' ' || tokens_entrada || ' ' || tokens_saida from public.suporte_ia_usos where id = current_setting('testes.uso')::bigint), 'true 100 50',
  'quem reservou fecha o registro');
reset role;
select hasnt_column('public', 'suporte_ia_usos', 'pergunta', 'o registro não guarda a pergunta');

select * from finish();
rollback;
