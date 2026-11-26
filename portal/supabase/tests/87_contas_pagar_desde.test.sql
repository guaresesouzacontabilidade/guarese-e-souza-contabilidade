-- Data de início do contas a pagar: antes dela, contas automáticas (notas e
-- importação) não são criadas; manual continua livre; contas a receber não
-- mudam; só quem edita o financeiro define; isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

\ir 00_setup.sql.inc

-- Titular define a data
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.financeiro_definir_pagar_desde(%L, '2026-11-26')$$, current_setting('testes.empresa_a')), 'titular define a data de início');
select is((select pagar_desde from public.financeiro_config where empresa_id = current_setting('testes.empresa_a')::uuid), date '2026-11-26', 'data guardada e visível para quem vê o financeiro');
select throws_like(format($$select public.financeiro_definir_pagar_desde(%L, '1990-01-01')$$, current_setting('testes.empresa_a')), '%inválida%', 'data absurda recusada');

-- Importação: só as contas a partir da data
select is((public.importar_lancamentos(current_setting('testes.empresa_a')::uuid, 'chave-desde-1', 'contas.pdf', repeat('a', 64), null, '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('tipo', 'pagar', 'descricao', 'CONTA ANTIGA', 'data_competencia', '2026-11-10', 'data_vencimento', '2026-11-10', 'valor', '100.00', 'ocorrencia', 1),
      jsonb_build_object('tipo', 'pagar', 'descricao', 'CONTA NOVA', 'data_competencia', '2026-12-10', 'data_vencimento', '2026-12-10', 'valor', '200.00', 'ocorrencia', 1),
      jsonb_build_object('tipo', 'receber', 'descricao', 'RECEBER ANTIGO', 'data_competencia', '2026-11-10', 'data_vencimento', '2026-11-10', 'valor', '300.00', 'ocorrencia', 1)),
    0, '[]'::jsonb) ->> 'novas')::int, 2, 'importação: a conta a pagar antiga não entra (a nova e a receber entram)');
reset role;
select is((select count(*)::int from public.lancamentos where empresa_id = current_setting('testes.empresa_a')::uuid and descricao = 'CONTA ANTIGA'), 0, 'conta a pagar antes da data não foi criada');
select is((select count(*)::int from public.lancamentos where empresa_id = current_setting('testes.empresa_a')::uuid and descricao in ('CONTA NOVA', 'RECEBER ANTIGO')), 2, 'a partir da data e contas a receber continuam entrando');

-- Nota fiscal de compra antiga não vira conta a pagar; lançamento manual antigo continua livre
insert into public.lancamentos (empresa_id, tipo, descricao, data_competencia, data_vencimento, valor_previsto, status_revisao, origem)
values (current_setting('testes.empresa_a')::uuid, 'pagar', 'NF ANTIGA', '2026-11-01', '2026-11-15', 50, 'sugerido', 'nfe'),
       (current_setting('testes.empresa_a')::uuid, 'pagar', 'MANUAL ANTIGO', '2026-11-01', '2026-11-15', 50, 'sugerido', 'manual');
select is((select string_agg(descricao, ',' order by descricao) from public.lancamentos where empresa_id = current_setting('testes.empresa_a')::uuid and descricao in ('NF ANTIGA', 'MANUAL ANTIGO')),
  'MANUAL ANTIGO', 'nota antiga não cria conta a pagar; lançamento manual entra');

-- Outra empresa sem data: nada muda
insert into public.lancamentos (empresa_id, tipo, descricao, data_competencia, data_vencimento, valor_previsto, status_revisao, origem)
values (current_setting('testes.empresa_b')::uuid, 'pagar', 'NF ANTIGA B', '2026-11-01', '2026-11-15', 50, 'sugerido', 'nfe');
select is((select count(*)::int from public.lancamentos where descricao = 'NF ANTIGA B'), 1, 'empresa sem data de início: tudo continua como antes');

-- Colaborador sem editar o financeiro e gestor de outra empresa não mudam a data
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.financeiro_definir_pagar_desde(%L, null)$$, current_setting('testes.empresa_a')), '42501', null, 'colaborador sem editar o financeiro não muda a data');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.financeiro_definir_pagar_desde(%L, null)$$, current_setting('testes.empresa_a')), '42501', null, 'gestor de outra empresa não muda a data');
reset role;

select * from finish();
rollback;
