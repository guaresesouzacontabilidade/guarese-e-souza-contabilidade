-- Critérios: cada empresa só vê os próprios vencimentos; cliente cadastra mas
-- não exclui; a rotina diária avisa cliente e escritório 30, 15 e 5 dias
-- antes e no vencimento, uma vez por marco, e a renovação recomeça o ciclo.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

\ir 00_setup.sql.inc

create or replace function pg_temp.avisos(p_usuario uuid)
returns int
language sql
as $$
  select count(*)::int from public.notificacoes where user_id = p_usuario and tipo = 'vencimento';
$$;

-- 1. Cadastro pelo cliente
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$insert into public.vencimentos (id, empresa_id, tipo, descricao, validade)
                  values ('00000000-0000-0000-0000-00000000e001', current_setting('testes.empresa_a')::uuid, 'certificado_digital',
                          'Certificado A1 da empresa', app.hoje() + 10)$$, 'cliente cadastra o vencimento do certificado');
select is((select count(*)::int from public.vencimentos where empresa_id = current_setting('testes.empresa_a')::uuid), 1, 'cliente vê o vencimento');
delete from public.vencimentos where id = '00000000-0000-0000-0000-00000000e001';
select is((select count(*)::int from public.vencimentos where id = '00000000-0000-0000-0000-00000000e001'), 1, 'cliente não exclui (só arquiva)');
select throws_ok($$insert into public.vencimentos (empresa_id, tipo, descricao, validade)
                   values (current_setting('testes.empresa_b')::uuid, 'alvara_funcionamento', 'Alvará', app.hoje() + 90)$$,
                 '42501', null, 'não cadastra em empresa de outro cliente');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.vencimentos where empresa_id = current_setting('testes.empresa_a')::uuid), 0,
          'cliente de outra empresa não vê os vencimentos');
reset role;

-- 2. Rotina diária: aviso no marco de 15 dias (faltam 10). As verificações
-- olham só para os registros deste teste (o banco pode ter outros dados).
create or replace function pg_temp.marcos(p_id uuid)
returns int
language sql
as $$
  select count(*)::int from public.vencimento_avisos where vencimento_id = p_id;
$$;
select public.rotina_vencimentos();
select is(pg_temp.marcos('00000000-0000-0000-0000-00000000e001'), 1, 'rotina gera um aviso');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1'), 1, 'cliente recebe o aviso');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a2'), 1, 'equipe da empresa recebe o aviso');
select public.rotina_vencimentos();
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1'), 1, 'rodar de novo no mesmo marco não repete o aviso');

-- 3. Mais perto do vencimento: novo marco (5 dias)
update public.vencimentos set validade = app.hoje() + 3 where id = '00000000-0000-0000-0000-00000000e001';
select public.rotina_vencimentos();
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1'), 2, 'marco de 5 dias gera novo aviso');

-- 4. Renovado: sem aviso enquanto faltar mais de 30 dias
update public.vencimentos set validade = app.hoje() + 365 where id = '00000000-0000-0000-0000-00000000e001';
select public.rotina_vencimentos();
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1'), 2, 'renovado não gera aviso');

-- 5. Cadastro de documento já vencido há muito tempo não gera aviso atrasado
insert into public.vencimentos (empresa_id, tipo, descricao, validade)
values (current_setting('testes.empresa_a')::uuid, 'cnd_federal', 'CND antiga', app.hoje() - 90);
select public.rotina_vencimentos();
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1'), 2, 'vencido há mais de 30 dias não gera aviso atrasado');

-- 6. Equipe exclui; aviso de vencimento pode ir por WhatsApp
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
delete from public.vencimentos where id = '00000000-0000-0000-0000-00000000e001';
reset role;
select is((select count(*)::int from public.vencimentos where id = '00000000-0000-0000-0000-00000000e001'), 0, 'equipe exclui');
select ok('vencimento' = any(app.tipos_aviso_whatsapp()), 'aviso de vencimento também pode ir por WhatsApp');

select * from finish();
rollback;
