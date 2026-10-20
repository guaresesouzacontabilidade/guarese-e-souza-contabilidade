-- Reforma tributária no serviço da NFS-e: tabela oficial de correlação (Anexo VIII),
-- NBS e classificação do IBS/CBS conferidos ao salvar, atividade do Simples e a
-- cópia desses dados para a nota no pedido.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select ok((select count(*) from public.nfse_correlacao_ibscbs) > 1400, 'usuário do portal lê a tabela oficial de correlação');
select throws_ok($$insert into public.nfse_correlacao_ibscbs values ('14.01', '999999999', 'x', '050101', '000001', 'x')$$, '42501', null,
  'ninguém altera a tabela pelo navegador');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.servico', public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Lavanderia", "codigo_tributacao_nacional": "141001", "codigo_nbs": "126019000"}'::jsonb)::text, true);
select results_eq($$select cind_op, cclass_trib from public.nfse_servicos where id = current_setting('testes.servico')::uuid$$,
  $$values ('050101'::text, '000001'::text)$$, 'com o NBS, a classificação padrão vem da tabela (no estabelecimento, tributação integral)');
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Lavanderia", "codigo_tributacao_nacional": "141001", "codigo_nbs": "120013110"}'::jsonb)$$,
  '%NBS informado não corresponde%', 'NBS de outro serviço não é aceito');
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Lavanderia", "codigo_tributacao_nacional": "141001", "codigo_nbs": "126019000", "cind_op": "100301", "cclass_trib": "000001"}'::jsonb)$$,
  '%classificação do IBS/CBS escolhida não corresponde%', 'classificação fora da tabela para o NBS não é aceita');
select lives_ok($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.servico')::uuid,
  '{"nome": "Lavanderia", "codigo_tributacao_nacional": "141001", "codigo_nbs": "126019000", "cind_op": "050102", "cclass_trib": "000001", "atividade_sn": 7}'::jsonb)$$,
  'escolhe outra opção da tabela e a atividade do Simples');
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Lavanderia", "codigo_tributacao_nacional": "141001", "atividade_sn": 10}'::jsonb)$$,
  '%atividade do Simples escolhida não combina%', 'atividade 10 só para o transporte municipal (16.01)');
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Obra", "codigo_tributacao_nacional": "070201", "atividade_sn": 7}'::jsonb)$$,
  '%atividade do Simples escolhida não combina%', 'construção civil 7.02 só com as atividades 12 ou 13');
reset role;

-- A nota leva os dados do serviço no momento do pedido
insert into public.nfse_emissoes (empresa_id, servico_id, ambiente, serie, numero_dps, id_dps, competencia, codigo_municipio_emissor, local_prestacao,
                                  codigo_tributacao_nacional, descricao, valor, tomador_tipo)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.servico')::uuid, 'homologacao', 1, 777,
        'DPS' || '1718204' || '2' || '11444777000161' || '00001' || lpad('777', 15, '0'), current_date, '1718204', '1718204',
        '141001', 'Lavagem de enxoval', 100, 'nao_identificado');
select results_eq($$select cind_op, cclass_trib, atividade_sn from public.nfse_emissoes where numero_dps = 777$$,
  $$values ('050102'::text, '000001'::text, 7::smallint)$$, 'o pedido copia indicador, classificação e atividade do serviço');
select is((select count(*)::int from public.nfse_correlacao_ibscbs where cclass_trib !~ '^[0-9]{6}$' or nbs !~ '^[0-9]{9}$'), 0, 'códigos da tabela no formato do leiaute');

select * from finish();
rollback;
