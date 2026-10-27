-- Critérios: a frota é da empresa (outra empresa não vê); quem lança precisa
-- do financeiro; o km do hodômetro não volta e não salta além do possível
-- (o erro de digitação "3.440.057" no lugar de "344.057" é barrado).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$insert into public.frota_veiculos (empresa_id, placa, descricao, km_inicial, custo_motorista_mensal)
  values (%L, 'ABC1D23', 'Volvo FH 540', 340000, 6500)$$, current_setting('testes.empresa_a')), 'o titular cadastra o caminhão');
select set_config('testes.vei', (select id::text from public.frota_veiculos where placa = 'ABC1D23'), true);
select lives_ok(format($$insert into public.frota_despesas (empresa_id, veiculo_id, data, grupo, descricao, litros, km, valor)
  values (%L, %L, '2026-10-01', 'combustivel', 'Óleo diesel S10', 500, 341000, 3150)$$, current_setting('testes.empresa_a'), current_setting('testes.vei')),
  'abastecimento com o km certo');
select throws_like(format($$insert into public.frota_despesas (empresa_id, veiculo_id, data, grupo, descricao, litros, km, valor)
  values (%L, %L, '2026-10-03', 'combustivel', 'Óleo diesel S10', 400, 3410570, 2520)$$, current_setting('testes.empresa_a'), current_setting('testes.vei')),
  '%mais do que um caminhão roda%', 'km com um número a mais é barrado');
select throws_like(format($$insert into public.frota_despesas (empresa_id, veiculo_id, data, grupo, descricao, litros, km, valor)
  values (%L, %L, '2026-10-03', 'combustivel', 'Óleo diesel S10', 400, 340500, 2520)$$, current_setting('testes.empresa_a'), current_setting('testes.vei')),
  '%não volta%', 'km menor que o anterior é barrado');
select lives_ok(format($$insert into public.frota_despesas (empresa_id, veiculo_id, data, grupo, descricao, litros, km, valor)
  values (%L, %L, '2026-10-03', 'combustivel', 'Óleo diesel S10', 400, 342100, 2520)$$, current_setting('testes.empresa_a'), current_setting('testes.vei')),
  'km dentro do possível (1.100 km em 2 dias)');
select lives_ok(format($$insert into public.frota_viagens (empresa_id, veiculo_id, data, cte_numero, valor_frete, comissao_motorista)
  values (%L, %L, '2026-10-02', '1001', 9370.43, 1031)$$, current_setting('testes.empresa_a'), current_setting('testes.vei')), 'viagem lançada');
reset role;

-- Outra empresa não vê a frota
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.frota_veiculos), 0, 'cliente de outra empresa não vê os caminhões');
select throws_ok(format($$insert into public.frota_viagens (empresa_id, veiculo_id, data, valor_frete) values (%L, %L, '2026-10-02', 1)$$,
  current_setting('testes.empresa_a'), current_setting('testes.vei')), '42501', null, 'nem lança viagem neles');
reset role;

select * from finish();
rollback;
