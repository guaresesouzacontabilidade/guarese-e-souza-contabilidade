-- Critérios: a loja guarda a operação e a inscrição da NF-e das vendas e se a
-- caixinha "Emitir NF-e" vem marcada; só aceita operação e inscrição da própria
-- empresa; o gerente da loja ajusta a preferência; mudar outras preferências
-- não apaga a escolha da NF-e.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

\ir 00_setup.sql.inc

-- Operação e inscrição da NF-e de cada empresa (cadastradas pelo escritório)
insert into public.nfe_operacoes (id, empresa_id, nome, natureza, destino, cfop, icms_cst, pis_cst, cofins_cst)
values ('0e000000-0000-0000-0000-00000000000a', current_setting('testes.empresa_a')::uuid, 'Venda no TO', 'VENDA DE MERCADORIA', 'interna', '5102', '102', '49', '49'),
       ('0e000000-0000-0000-0000-00000000000b', current_setting('testes.empresa_b')::uuid, 'Venda no TO', 'VENDA DE MERCADORIA', 'interna', '5102', '102', '49', '49');
insert into public.nfe_emitentes (id, empresa_id, nome, inscricao_estadual, logradouro, numero, bairro, municipio_ibge, cep, serie)
values ('0f000000-0000-0000-0000-00000000000a', current_setting('testes.empresa_a')::uuid, 'Loja A', '290000000', 'Rua A', '1', 'Centro', '1718204', '77500000', 2);

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true}');
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid,
  '{"nfe_operacao_id": "0e000000-0000-0000-0000-00000000000a", "nfe_emitente_id": "0f000000-0000-0000-0000-00000000000a", "nfe_marcada_padrao": true}');
reset role;
select ok((select nfe_operacao_id = '0e000000-0000-0000-0000-00000000000a' and nfe_emitente_id = '0f000000-0000-0000-0000-00000000000a' and nfe_marcada_padrao
             from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'a loja guarda a operação, a inscrição e a caixinha marcada');

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like(format($$select public.gestao_configurar(%L, '{"nfe_operacao_id": "0e000000-0000-0000-0000-00000000000b"}')$$, current_setting('testes.empresa_a')),
  '%não é desta empresa%', 'operação de outra empresa é recusada');
reset role;

-- O titular (gerente da loja) muda outra preferência: a escolha da NF-e continua
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"desconto_maximo_operador": 5}');
reset role;
select ok((select nfe_operacao_id is not null and nfe_marcada_padrao from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'mudar o desconto não apaga a escolha da NF-e');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"nfe_marcada_padrao": false, "nfe_operacao_id": ""}');
reset role;
select ok((select nfe_operacao_id is null and not nfe_marcada_padrao from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'o gerente desmarca a caixinha e tira a operação');

-- Outra empresa não lê a configuração da loja A
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'cliente de outra empresa não vê a configuração');
reset role;

select * from finish();
rollback;
