-- Critérios: só a sessão confirmada com o código (aal2) pode ser mantida até
-- o fim do dia; fechado o portal, ela fica travada e o banco não entrega nada
-- a ela (nem a própria pessoa consegue destravar pela API); o servidor destrava
-- depois de conferir a senha e conta as tentativas erradas; passado o dia, ou
-- sem a verificação em duas etapas, fechar o portal encerra a sessão.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

\ir 00_setup.sql.inc

-- Sem o código confirmado, não mantém a sessão
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$ select public.sessao_manter_hoje() $$, '42501', null, 'sessão sem o código (aal1) não fica mantida');
select is(public.sessao_portal_fechado(), 'encerrar', 'sem sessão mantida, fechar o portal encerra');
reset role;

-- Com o código confirmado (aal2)
update auth.sessions set aal = 'aal2' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1', 'aal2');
set local role authenticated;
select ok(public.sessao_manter_hoje() between now() and now() + interval '24 hours', 'mantida até o fim do dia de hoje');
select ok((select count(*) from public.empresas) > 0, 'antes de fechar, vê a própria empresa');
select is(public.sessao_portal_fechado(), 'bloqueada', 'portal fechado: a sessão fica travada');
select is((public.estado_acesso() ->> 'sessao_bloqueada')::boolean, true, 'o estado avisa que está travada (a tela pede a senha)');
select is((select count(*)::int from public.empresas), 0, 'travada: o banco não entrega nenhum dado');
select is((public.estado_acesso() ->> 'valido')::boolean, false, 'travada: o acesso não vale');
select throws_ok($$ select public.sessao_desbloqueio('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', true) $$,
  '42501', null, 'a própria pessoa não destrava pela API (só o servidor, com a senha)');
select throws_ok($$ update public.sessoes_portal set bloqueada_em = null $$, '42501', null, 'nem mexendo direto na tabela');
reset role;

-- Servidor: senha errada conta tentativa; certa destrava
select is(public.sessao_desbloqueio('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', false), 1, 'senha errada: 1 tentativa');
select is(public.sessao_desbloqueio('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', true), 0, 'senha certa: destrava');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1', 'aal2');
set local role authenticated;
select ok((select count(*) from public.empresas) > 0, 'destravada: volta a ver a empresa');
reset role;

-- Passado o dia, fechar o portal encerra (e o registro some)
update public.sessoes_portal set manter_ate = now() - interval '1 minute' where session_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1', 'aal2');
set local role authenticated;
select is(public.sessao_portal_fechado(), 'encerrar', 'outro dia: fechar o portal encerra a sessão');
reset role;
select is((select count(*)::int from public.sessoes_portal where session_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'registro da sessão apagado');

-- Outra pessoa não trava nem destrava a sessão de ninguém
select pg_temp.como('00000000-0000-0000-0000-0000000000b2', 'aal2');
set local role authenticated;
select is(public.sessao_portal_fechado(), 'encerrar', 'sem sessão mantida própria, só encerra a dela');
reset role;

select * from finish();
rollback;
