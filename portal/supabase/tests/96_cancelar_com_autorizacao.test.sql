-- Cancelar venda ou orçamento só com a autorização de quem pode cancelar
-- (permissão gestao.cancelar, conferida pela senha no servidor): uso único,
-- vale 2 minutos, só para quem pediu e para aquela venda; o banco recusa sem
-- ela e guarda quem autorizou. Ninguém do navegador grava autorização.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;
-- b2: só vende (balcão)
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';

select ok((select 'gestao.cancelar' = any(permissoes) from public.empresa_membros
  where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'),
  'o dono (titular) já vem com a permissão de cancelar');
select ok(not ('gestao.cancelar' = any(app.permissoes_padrao('cliente_colaborador'))) and not ('gestao.cancelar' = any(app.permissoes_padrao('equipe'))),
  'colaborador e escritório não vêm com ela');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prod', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "BANCO-1", "descricao": "Banco de madeira", "ncm": "94016100", "unidade": "UN", "valor_unitario": 80}')::text, true);
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.orc1', (public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 1)))) ->> 'id'), true);
select set_config('testes.orc2', (public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 2)))) ->> 'id'), true);
select is((select array_agg(nome)::text from public.loja_autorizadores_cancelamento(current_setting('testes.empresa_a')::uuid)),
  (select array_agg(nome)::text from public.perfis where id = '00000000-0000-0000-0000-0000000000b1'),
  'no caixa aparece só o nome de quem pode autorizar');
select throws_ok(format('select public.gestao_venda_cancelar(%L, %L)', current_setting('testes.orc1'), 'Cliente desistiu'), '42501', null,
  'sem autorização, o balcão não cancela o orçamento');
select throws_ok($$insert into public.venda_cancelamento_autorizacoes (empresa_id, venda_id, autorizado_por, solicitado_por)
  values (current_setting('testes.empresa_a')::uuid, current_setting('testes.orc1')::uuid, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')$$,
  '42501', null, 'ninguém grava autorização pelo navegador');
select throws_ok('select count(*) from public.venda_cancelamento_autorizacoes', '42501', null, 'nem lê as autorizações');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format('select * from public.loja_autorizadores_cancelamento(%L)', current_setting('testes.empresa_a')), '42501', null,
  'outra empresa não vê quem autoriza');
reset role;

-- Autorização de outra pessoa ou vencida não serve
insert into public.venda_cancelamento_autorizacoes (empresa_id, venda_id, autorizado_por, solicitado_por)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.orc1')::uuid, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');
insert into public.venda_cancelamento_autorizacoes (empresa_id, venda_id, autorizado_por, solicitado_por, criada_em, expira_em)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.orc1')::uuid, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
        now() - interval '10 minutes', now() - interval '8 minutes');
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format('select public.gestao_venda_cancelar(%L, %L)', current_setting('testes.orc1'), 'Cliente desistiu'), '42501', null,
  'autorização pedida por outra pessoa ou vencida não serve');
reset role;

-- Autorização válida: cancela e guarda quem pediu e quem autorizou
insert into public.venda_cancelamento_autorizacoes (empresa_id, venda_id, autorizado_por, solicitado_por)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.orc1')::uuid, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select lives_ok(format('select public.gestao_venda_cancelar(%L, %L)', current_setting('testes.orc1'), 'Cliente desistiu'),
  'com a autorização do dono, o balcão cancela');
-- A autorização do orçamento 1 não vale para o orçamento 2
select throws_ok(format('select public.gestao_venda_cancelar(%L, %L)', current_setting('testes.orc2'), 'Cliente desistiu'), '42501', null,
  'a autorização vale só para aquela venda');
reset role;
select results_eq(format('select status, cancelada_por::text, cancelamento_autorizado_por::text from public.vendas where id = %L', current_setting('testes.orc1')),
  $$values ('cancelada'::text, '00000000-0000-0000-0000-0000000000b2'::text, '00000000-0000-0000-0000-0000000000b1'::text)$$,
  'fica registrado quem pediu e quem autorizou');
select is((select count(*)::int from public.venda_cancelamento_autorizacoes
  where venda_id = current_setting('testes.orc1')::uuid and usada_em is not null), 1, 'a autorização é usada uma vez só');

-- Quem autorizou perdeu a permissão: não vale mais
insert into public.venda_cancelamento_autorizacoes (empresa_id, venda_id, autorizado_por, solicitado_por)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.orc2')::uuid, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
update public.empresa_membros set permissoes = array_remove(permissoes, 'gestao.cancelar')
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format('select public.gestao_venda_cancelar(%L, %L)', current_setting('testes.orc2'), 'Cliente desistiu'),
  '%não tem mais a permissão%', 'sem a permissão, a autorização dele não vale');
reset role;
select is((select status from public.vendas where id = current_setting('testes.orc2')::uuid), 'aberto', 'e o orçamento 2 continua em aberto');

select * from finish();
rollback;
