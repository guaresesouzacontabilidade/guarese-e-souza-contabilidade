-- Critérios: o comparativo de regimes busca até 24 meses anteriores (a RBT12
-- de cada um dos 12 meses); a previsão continua com 12; quem não tem acesso aos
-- cálculos da empresa não consulta nenhum dos dois.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(jsonb_array_length(public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'meses'), 13,
          'previsão: o mês e os 12 anteriores');
select is(jsonb_array_length(public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01', 24) -> 'meses'), 25,
          'comparativo: o mês e os 24 anteriores');
select is(jsonb_array_length(public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01', 500) -> 'meses'), 25,
          'no máximo 24 meses anteriores');
select is((public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01', 24) -> 'meses' -> 0 ->> 'competencia'), '2024-09-01',
          'começa 24 meses antes');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01', 24)$$,
                 '42501', null, 'cliente de outra empresa não consulta');
reset role;

select * from finish();
rollback;
