-- Importação do relatório de contas a pagar (PDF lido no portal): tipo de
-- documento próprio; conta sugerida pelo histórico entra preenchida, mas fica
-- "sugerida" para revisar; conta escrita no arquivo confirma direto; conta de
-- outra empresa é ignorada; reimportar não duplica; só quem pode importar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

\ir 00_setup.sql.inc

select ok(exists (select 1 from public.categorias_documento where codigo = 'relatorio_contas' and 'pdf' = any (extensoes) and not escritorio),
  'tipo de documento para o relatório de contas (PDF, Excel ou CSV)');

select set_config('testes.cat_a', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and not sintetica and ativa and natureza = 'despesa' order by codigo limit 1), true);
select set_config('testes.cod_a', (select codigo from public.categorias_financeiras where id = current_setting('testes.cat_a')::uuid), true);
select set_config('testes.cat_b', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_b')::uuid and not sintetica and ativa and natureza = 'despesa' order by codigo limit 1), true);

create or replace function pg_temp.linhas() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('tipo', 'pagar', 'descricao', 'TORAS DE PINUS (1/6)', 'data_competencia', '2027-01-25', 'data_vencimento', '2027-01-25', 'valor', '8450.00',
                       'categoria_sugerida_id', current_setting('testes.cat_a'), 'ocorrencia', 1),
    jsonb_build_object('tipo', 'pagar', 'descricao', 'ALUGUEL GALPAO', 'data_competencia', '2027-01-10', 'data_vencimento', '2027-01-10', 'valor', '4000.00',
                       'categoria_codigo', current_setting('testes.cod_a'), 'ocorrencia', 1),
    jsonb_build_object('tipo', 'pagar', 'descricao', 'FRETE DE OUTRA EMPRESA', 'data_competencia', '2027-01-12', 'data_vencimento', '2027-01-12', 'valor', '500.00',
                       'categoria_sugerida_id', current_setting('testes.cat_b'), 'ocorrencia', 1),
    jsonb_build_object('tipo', 'pagar', 'descricao', 'DESPESA SEM CONTA', 'data_competencia', '2027-01-15', 'data_vencimento', '2027-01-15', 'valor', '120.00', 'ocorrencia', 1)
  );
$$;

-- Titular importa
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.importar_lancamentos(current_setting('testes.empresa_a')::uuid, 'chave-relatorio-1', 'contas-a-pagar.pdf', repeat('e', 64), null,
            '{}'::jsonb, pg_temp.linhas(), 0, '[]'::jsonb) ->> 'novas')::int, 4, 'as 4 contas do relatório entram');
reset role;

select is((select (status_revisao, categoria_id::text = current_setting('testes.cat_a'))::text from public.lancamentos
            where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'TORAS DE PINUS (1/6)'),
  '(sugerido,t)', 'conta sugerida pelo histórico vem preenchida, mas fica para revisar');
select is((select status_revisao from public.lancamentos where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'ALUGUEL GALPAO'),
  'confirmado', 'conta escrita no arquivo confirma direto');
select is((select (status_revisao, categoria_id is null)::text from public.lancamentos
            where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'FRETE DE OUTRA EMPRESA'),
  '(sugerido,t)', 'conta de outra empresa é ignorada');
select is((select (status_revisao, categoria_id is null, data_vencimento, valor_previsto)::text from public.lancamentos
            where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'DESPESA SEM CONTA'),
  '(sugerido,t,2027-01-15,120.00)', 'sem conta: fica para classificar, com a data e o valor do relatório');
select is((select count(*)::int from public.lancamentos where empresa_id = current_setting('testes.empresa_a')::uuid and origem = 'importacao' and tipo = 'pagar'), 4,
  'contas a pagar gravadas');

-- Mesmo arquivo de novo: nada duplica
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.importar_lancamentos(current_setting('testes.empresa_a')::uuid, 'chave-relatorio-1', 'contas-a-pagar.pdf', repeat('e', 64), null,
            '{}'::jsonb, pg_temp.linhas(), 0, '[]'::jsonb) ->> 'reenvio', 'true', 'mesmo arquivo: reconhecido como reenvio');
-- Relatório do mês seguinte com as mesmas parcelas + uma nova
select is((public.importar_lancamentos(current_setting('testes.empresa_a')::uuid, 'chave-relatorio-2', 'contas-a-pagar-dez.pdf', repeat('f', 64), null,
            '{}'::jsonb, pg_temp.linhas() || jsonb_build_array(jsonb_build_object('tipo', 'pagar', 'descricao', 'TORAS DE PINUS (2/6)',
              'data_competencia', '2027-02-25', 'data_vencimento', '2027-02-25', 'valor', '8450.00', 'ocorrencia', 1)), 0, '[]'::jsonb)
          - 'importacao_id' - 'reenvio' - 'invalidas' - 'periodo_fechado')::text,
  '{"novas": 1, "duplicadas": 4}', 'relatório seguinte: só a parcela nova entra');
reset role;

-- Colaborador sem permissão de importar e outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.importar_lancamentos(%L, 'chave-relatorio-3', 'x.pdf', '', null, '{}'::jsonb, pg_temp.linhas(), 0, '[]'::jsonb)$$,
  current_setting('testes.empresa_a')), '42501', null, 'colaborador sem a permissão de importar não importa');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.importar_lancamentos(%L, 'chave-relatorio-4', 'x.pdf', '', null, '{}'::jsonb, pg_temp.linhas(), 0, '[]'::jsonb)$$,
  current_setting('testes.empresa_a')), '42501', null, 'gestor de outra empresa não importa na empresa A');
select is((select count(*)::int from public.lancamentos where descricao like 'TORAS DE PINUS%'), 0, 'e não vê os lançamentos da empresa A');
reset role;

select * from finish();
rollback;
