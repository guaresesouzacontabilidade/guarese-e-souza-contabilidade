-- Lista nacional de serviços da NFS-e: leitura para usuários do portal,
-- ninguém altera pelo navegador, e o cadastro do serviço só aceita código da lista.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.nfse_lista_servicos), 338, 'usuário do portal lê os 338 códigos da lista nacional');
select throws_ok($$insert into public.nfse_lista_servicos (codigo, item, subitem, desdobro, descricao) values ('990101', 99, 1, 1, 'Inventado')$$,
  '42501', null, 'ninguém inclui código na lista pelo navegador');
select throws_ok($$update public.nfse_lista_servicos set descricao = 'x' where codigo = '171901'$$, '42501', null,
  'ninguém altera a lista pelo navegador');
reset role;

set local role anon;
select throws_ok($$select count(*) from public.nfse_lista_servicos$$, '42501', null, 'visitante sem login não lê a lista');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Inventado", "codigo_tributacao_nacional": "179999"}'::jsonb)$$, '%não está na lista nacional%', 'código fora da lista não é aceito');
select set_config('testes.servico', public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Revisão de veículos", "codigo_tributacao_nacional": "140101", "cnae": "4520-0/01"}'::jsonb)::text, true);
select is((select cnae from public.nfse_servicos where id = current_setting('testes.servico')::uuid), '4520-0/01', 'serviço guarda a atividade (CNAE) de origem');
select lives_ok($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.servico')::uuid,
  '{"nome": "Revisão de veículos", "codigo_tributacao_nacional": "140101"}'::jsonb)$$, 'a atividade é opcional');
select is((select cnae from public.nfse_servicos where id = current_setting('testes.servico')::uuid), null, 'sem atividade, o campo fica vazio');
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Revisão", "codigo_tributacao_nacional": "140101", "cnae": "4520001"}'::jsonb)$$, '%violates check constraint%', 'atividade no formato da CNAE (0000-0/00)');
reset role;

select * from finish();
rollback;
