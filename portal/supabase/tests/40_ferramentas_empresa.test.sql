-- Critérios: a equipe liga e desliga as ferramentas de cada empresa (só as
-- conhecidas, sem repetição); o cliente que pode editar o cadastro não mexe
-- nas ferramentas, mas continua editando os outros dados.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$update public.empresas set ferramentas_desligadas = array['maquininhas', 'cte', 'cte'] where id = current_setting('testes.empresa_a')::uuid$$,
                'equipe desliga ferramentas');
select is((select ferramentas_desligadas from public.empresas where id = current_setting('testes.empresa_a')::uuid), array['cte', 'maquininhas']::text[],
          'sem repetição e em ordem');
select throws_ok($$update public.empresas set ferramentas_desligadas = array['foguete'] where id = current_setting('testes.empresa_a')::uuid$$,
                 '23514', null, 'só ferramentas conhecidas');
reset role;

-- O empresário recebe a permissão de editar o cadastro
update public.empresa_membros set permissoes = permissoes || array['empresa.editar']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1';

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$update public.empresas set ferramentas_desligadas = '{}' where id = current_setting('testes.empresa_a')::uuid$$,
                 '42501', null, 'o cliente não religa as ferramentas');
select lives_ok($$update public.empresas set telefone = '63999990000' where id = current_setting('testes.empresa_a')::uuid$$,
                'o cliente continua editando o cadastro');
select is((select ferramentas_desligadas from public.empresas where id = current_setting('testes.empresa_a')::uuid), array['cte', 'maquininhas']::text[],
          'as ferramentas ficam como o escritório deixou');
reset role;

select * from finish();
rollback;
