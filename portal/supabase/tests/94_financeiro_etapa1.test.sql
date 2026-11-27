-- Financeiro, etapa 1: permissões separadas (baixar, estornar, aprovar,
-- exportar), baixa segura contra clique duplo, estorno com justificativa e
-- histórico, competência × caixa, transferência fora do resultado, aprovação
-- por faixa de valor, renegociação sem contar a dívida duas vezes,
-- recorrência (esta, próximas, encerrar), parcelas escolhidas, lote, painel e
-- isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(54);

\ir 00_setup.sql.inc

-- Atalhos
create function pg_temp.a() returns uuid language sql as $$ select current_setting('testes.empresa_a')::uuid $$;
create function pg_temp.v(p text) returns uuid language sql as $$ select current_setting('t.' || p)::uuid $$;
create function pg_temp.cat(p_codigo text) returns uuid language sql as $$
  select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and (codigo_sistema = p_codigo or codigo = p_codigo) limit 1
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
select ok((select permissoes @> array['financeiro.baixar', 'financeiro.estornar', 'financeiro.aprovar', 'financeiro.exportar']
             from public.empresa_membros where empresa_id = pg_temp.a() and user_id = '00000000-0000-0000-0000-0000000000b1'),
  'o titular recebe baixar, estornar, aprovar e exportar');
select ok((select not (permissoes && array['financeiro.baixar', 'financeiro.estornar', 'financeiro.aprovar'])
             from public.empresa_membros where empresa_id = pg_temp.a() and user_id = '00000000-0000-0000-0000-0000000000b2'),
  'o colaborador não recebe permissões do financeiro');
update public.empresa_membros set permissoes = array['empresa.ver', 'financeiro.baixar']
 where empresa_id = pg_temp.a() and user_id = '00000000-0000-0000-0000-0000000000b2';
select ok((select 'financeiro.ver' = any(permissoes) from public.empresa_membros
            where empresa_id = pg_temp.a() and user_id = '00000000-0000-0000-0000-0000000000b2'),
  'quem pode baixar passa a ver o financeiro');

-- Contas e títulos do titular
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
with x as (insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial, saldo_inicial_data)
           values (pg_temp.a(), 'conta_corrente', 'Banco Teste', 1000, '2026-09-30') returning id)
select set_config('t.banco', id::text, true) from x;
with x as (insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial, saldo_inicial_data)
           values (pg_temp.a(), 'caixa', 'Caixa Teste', 0, '2026-09-30') returning id)
select set_config('t.caixa', id::text, true) from x;
with x as (insert into public.contrapartes (empresa_id, nome, papeis) values (pg_temp.a(), 'Cliente Teste', array['cliente']) returning id)
select set_config('t.cliente', id::text, true) from x;

-- -----------------------------------------------------------------------------
-- Venda parcelada: baixa parcial, clique duplo, saldo, apagar direto
-- -----------------------------------------------------------------------------
with x as (insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto)
           values (pg_temp.a(), 'receber', 'Venda parcelada (1/3)', pg_temp.cat('VENDAS'), pg_temp.v('cliente'), '2026-11-10', '2026-12-10', 300) returning id)
select set_config('t.r1', id::text, true) from x;
select set_config('t.b1', public.financeiro_baixar(pg_temp.a(), pg_temp.v('r1'), '2026-11-26', pg_temp.v('caixa'), 100,
  p_chave => '11111111-1111-1111-1111-111111111111')::text, true);
select is((select (situacao, valor_previsto - valor_baixado)::text from public.lancamentos where id = pg_temp.v('r1')),
  '(parcial,200.00)', 'baixa parcial: a parcela continua em aberto com o saldo restante');
select is(public.financeiro_baixar(pg_temp.a(), pg_temp.v('r1'), '2026-11-26', pg_temp.v('caixa'), 100,
  p_chave => '11111111-1111-1111-1111-111111111111'), pg_temp.v('b1'), 'clique duplo devolve a mesma baixa');
select is((select count(*)::int from public.baixas where lancamento_id = pg_temp.v('r1')), 1, 'sem baixa duplicada');
select throws_like(format($$select public.financeiro_baixar(%L, %L, '2026-11-26', %L, 250)$$, pg_temp.a(), pg_temp.v('r1'), pg_temp.v('caixa')),
  '%ultrapassa o saldo em aberto%', 'baixa maior que o saldo é recusada');
delete from public.baixas where id = pg_temp.v('b1');
select is((select count(*)::int from public.baixas where id = pg_temp.v('b1')), 1, 'baixa não se apaga direto (só por estorno)');

-- -----------------------------------------------------------------------------
-- Estorno com justificativa e histórico
-- -----------------------------------------------------------------------------
select throws_like(format($$select public.financeiro_estornar_baixa(%L, %L, 'abc')$$, pg_temp.a(), pg_temp.v('b1')),
  '%motivo do estorno%', 'estorno sem justificativa é recusado');
select lives_ok(format($$select public.financeiro_estornar_baixa(%L, %L, 'Recebimento lançado em duplicidade')$$, pg_temp.a(), pg_temp.v('b1')),
  'estorno com justificativa');
select is((select (situacao, valor_baixado)::text from public.lancamentos where id = pg_temp.v('r1')), '(aberto,0.00)',
  'o estorno reabre o título');
select is((select motivo_estorno from public.baixas_estornadas where id = pg_temp.v('b1')), 'Recebimento lançado em duplicidade',
  'a baixa estornada fica no histórico com o motivo');
reset role;

-- Quem só baixa não estorna
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('t.b2', public.financeiro_baixar(pg_temp.a(), pg_temp.v('r1'), '2026-11-26', pg_temp.v('caixa'), 50)::text, true);
select throws_ok(format($$select public.financeiro_estornar_baixa(%L, %L, 'Teste de permissão')$$, pg_temp.a(), pg_temp.v('b2')),
  '42501', null, 'quem só pode baixar não estorna');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.financeiro_estornar_baixa(pg_temp.a(), pg_temp.v('b2'), 'Limpeza do teste');

-- -----------------------------------------------------------------------------
-- Compra: pagar reduz o banco, competência × caixa, estorno reabre
-- -----------------------------------------------------------------------------
with x as (insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
           values (pg_temp.a(), 'pagar', 'Compra de mercadorias', pg_temp.cat('COMPRAS_MERCADORIAS'), '2026-10-15', '2026-11-20', 400) returning id)
select set_config('t.p1', id::text, true) from x;
select set_config('t.bp1', public.financeiro_baixar(pg_temp.a(), pg_temp.v('p1'), '2026-11-25', pg_temp.v('banco'), 400)::text, true);
select is(public.saldo_conta(pg_temp.v('banco'), '2026-11-27'), 600.00::numeric, 'o pagamento reduz o saldo do banco');
select is((select sum(valor) from public.relatorio_dre_linhas(pg_temp.a(), '2026-10-01', '2026-10-31') where categoria_id = pg_temp.cat('COMPRAS_MERCADORIAS')),
  400.00::numeric, 'a despesa entra no resultado do mês da competência (outubro)');
select is((select coalesce(sum(valor), 0) from public.relatorio_dre_linhas(pg_temp.a(), '2026-11-01', '2026-11-30') where categoria_id = pg_temp.cat('COMPRAS_MERCADORIAS')),
  0::numeric, 'e não no resultado do mês do pagamento (novembro)');
select is((select sum(valor_total) from public.baixas where empresa_id = pg_temp.a() and tipo = 'pagar' and data_pagamento between '2026-11-01' and '2026-11-30'),
  400.00::numeric, 'no caixa realizado ela aparece no mês do pagamento (novembro)');
select public.financeiro_estornar_baixa(pg_temp.a(), pg_temp.v('bp1'), 'Pagamento devolvido pelo banco');
select is((select (situacao, public.saldo_conta(pg_temp.v('banco'), '2026-11-27'))::text from public.lancamentos where id = pg_temp.v('p1')),
  '(aberto,1000.00)', 'o estorno reabre a conta a pagar e devolve o saldo do banco');

-- -----------------------------------------------------------------------------
-- Transferência: muda as duas contas e não infla o resultado
-- -----------------------------------------------------------------------------
insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor, descricao)
values (pg_temp.a(), pg_temp.v('banco'), pg_temp.v('caixa'), '2026-11-26', 250, 'Saque para o caixa');
select is((public.saldo_conta(pg_temp.v('banco'), '2026-11-27'), public.saldo_conta(pg_temp.v('caixa'), '2026-11-27'))::text,
  '(750.00,250.00)', 'a transferência tira de uma conta e põe na outra');
select is((select sum(valor) from public.relatorio_dre_linhas(pg_temp.a(), '2026-11-01', '2026-11-30') where tipo = 'receita_operacional'),
  300.00::numeric, 'a transferência não vira receita');

-- -----------------------------------------------------------------------------
-- Aprovação por faixa de valor
-- -----------------------------------------------------------------------------
select public.financeiro_aprovacao_salvar(pg_temp.a(), '[{"valor_minimo": 500, "aprovacoes": 1}]');
with x as (insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
           values (pg_temp.a(), 'pagar', 'Equipamento novo', pg_temp.cat('4.04'), '2026-11-27', '2026-12-05', 800) returning id)
select set_config('t.ap', id::text, true) from x;
select is((select aprovacao_status from public.lancamentos where id = pg_temp.v('ap')), 'pendente', 'pagamento acima da faixa aguarda aprovação');
select throws_like(format($$select public.financeiro_baixar(%L, %L, '2026-11-27', %L, 800)$$, pg_temp.a(), pg_temp.v('ap'), pg_temp.v('banco')),
  '%precisa ser aprovado%', 'pagamento sem aprovação não é baixado');
select throws_like(format($$select public.financeiro_aprovar(%L, array[%L]::uuid[], 'aprovado')$$, pg_temp.a(), pg_temp.v('ap')),
  '%não pode aprová-lo%', 'quem lançou não aprova o próprio pagamento');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is(public.financeiro_aprovar(pg_temp.a(), array[pg_temp.v('ap')], 'aprovado'), 1, 'outra pessoa aprova');
select is((select aprovacao_status from public.lancamentos where id = pg_temp.v('ap')), 'aprovado', 'pagamento aprovado');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.lancamentos set valor_previsto = 900 where id = pg_temp.v('ap');
select is((select aprovacao_status from public.lancamentos where id = pg_temp.v('ap')), 'pendente', 'mudou o valor, precisa aprovar de novo');
with x as (insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
           values (pg_temp.a(), 'pagar', 'Material de escritório', pg_temp.cat('4.04'), '2026-11-27', '2026-12-05', 100) returning id, aprovacao_status)
select is(aprovacao_status, 'nao_exige', 'pagamento abaixo da faixa não precisa de aprovação') from x;
select public.financeiro_aprovacao_salvar(pg_temp.a(), '[]');
select is((select aprovacao_status from public.lancamentos where id = pg_temp.v('ap')), 'nao_exige', 'sem faixas, nada aguarda aprovação');

-- -----------------------------------------------------------------------------
-- Renegociação
-- -----------------------------------------------------------------------------
with x as (insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto)
           values (pg_temp.a(), 'receber', 'Venda A', pg_temp.cat('VENDAS'), pg_temp.v('cliente'), '2026-11-05', '2026-11-15', 100) returning id)
select set_config('t.o1', id::text, true) from x;
with x as (insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto)
           values (pg_temp.a(), 'receber', 'Venda B', pg_temp.cat('VENDAS'), pg_temp.v('cliente'), '2026-11-06', '2026-11-16', 200) returning id)
select set_config('t.o2', id::text, true) from x;
select public.financeiro_baixar(pg_temp.a(), pg_temp.v('o2'), '2026-11-20', pg_temp.v('caixa'), 50);
select set_config('t.reneg', public.financeiro_renegociar(pg_temp.a(), array[pg_temp.v('o1'), pg_temp.v('o2')],
  '[{"vencimento": "2026-12-15", "valor": 140}, {"vencimento": "2027-01-15", "valor": 140}]', 'Cliente pediu mais prazo')::text, true);
select is((select count(*)::int from public.lancamentos where id in (pg_temp.v('o1'), pg_temp.v('o2')) and situacao = 'renegociado'), 2,
  'os títulos originais ficam renegociados (no histórico)');
select is((select (count(*), sum(valor_previsto), bool_and(fora_do_resultado), min(contraparte_id::text))::text from public.lancamentos where renegociacao_id = pg_temp.v('reneg')),
  format('(2,280.00,t,%s)', pg_temp.v('cliente')), 'o acordo cria as parcelas novas, com o mesmo cliente');
select is((select sum(valor_previsto - valor_baixado) from public.lancamentos
            where contraparte_id = pg_temp.v('cliente') and situacao in ('aberto', 'parcial') and id <> pg_temp.v('r1')),
  280.00::numeric, 'a dívida em aberto conta uma vez só (o acordo, não os originais)');
select is((select sum(valor) from public.relatorio_dre_linhas(pg_temp.a(), '2026-11-01', '2026-11-30') where tipo = 'receita_operacional'),
  600.00::numeric, 'no resultado, as vendas originais contam e as parcelas do acordo não');
select is((select valor from public.dre_ajustes where id = (select dre_ajuste_id from public.renegociacoes where id = pg_temp.v('reneg'))),
  30.00::numeric, 'os juros do acordo (R$ 30) entram como ajuste do mês');
select throws_like(format($$select public.financeiro_baixar(%L, %L, '2026-11-27', %L, 10)$$, pg_temp.a(), pg_temp.v('o1'), pg_temp.v('caixa')),
  '%renegociado%', 'título renegociado não recebe baixa');
select throws_like(format($$update public.lancamentos set situacao = 'cancelado', motivo_cancelamento = 'x' where renegociacao_id = %L$$, pg_temp.v('reneg')),
  '%não se cancela%', 'parcela do acordo não se cancela');
select lives_ok(format($$select public.financeiro_desfazer_renegociacao(%L, %L, 'Cliente desistiu do acordo')$$, pg_temp.a(), pg_temp.v('reneg')),
  'desfaz a renegociação');
select is((select string_agg(situacao, ',' order by descricao) from public.lancamentos where id in (pg_temp.v('o1'), pg_temp.v('o2')))
          || '|' || (select count(*) from public.lancamentos where renegociacao_id = pg_temp.v('reneg'))
          || '|' || (select count(*) from public.dre_ajustes where empresa_id = pg_temp.a()),
  'aberto,parcial|0|0', 'desfeita: originais voltam como estavam, acordo e ajuste somem');

-- -----------------------------------------------------------------------------
-- Recorrência: só esta, esta e as próximas, encerrar
-- -----------------------------------------------------------------------------
with x as (insert into public.recorrencias (empresa_id, tipo, descricao, categoria_id, valor, frequencia, dia_vencimento, data_inicio, data_fim, meses_a_frente)
           values (pg_temp.a(), 'pagar', 'Aluguel', pg_temp.cat('4.04'), 1500, 'mensal', 10, '2026-12-10', '2027-03-31', 6) returning id)
select set_config('t.rec', id::text, true) from x;
select public.gerar_recorrencias_empresa(pg_temp.a());
select is((select count(*)::int from public.lancamentos where recorrencia_id = pg_temp.v('rec')), 4, 'a recorrência gera dezembro a março');
select public.financeiro_recorrencia_alterar(pg_temp.a(),
  (select id from public.lancamentos where recorrencia_id = pg_temp.v('rec') and data_vencimento = '2027-01-10'), 'esta', '{"data_vencimento": "2027-01-20"}');
select public.gerar_recorrencias_empresa(pg_temp.a());
select is((select string_agg(to_char(data_vencimento, 'MM-DD'), ',' order by data_vencimento) from public.lancamentos where recorrencia_id = pg_temp.v('rec')),
  '12-10,01-20,02-10,03-10', 'mudar só esta não faz a recorrência gerar outra no lugar');
select is(public.financeiro_recorrencia_alterar(pg_temp.a(),
  (select id from public.lancamentos where recorrencia_id = pg_temp.v('rec') and data_vencimento = '2027-02-10'), 'proximas', '{"valor": 1600}'), 2,
  'esta e as próximas: fevereiro e março mudam');
select is((select string_agg(valor_previsto::text, ',' order by data_vencimento) from public.lancamentos where recorrencia_id = pg_temp.v('rec')),
  '1500.00,1500.00,1600.00,1600.00', 'dezembro e janeiro ficam como estavam');
select public.financeiro_recorrencia_alterar(pg_temp.a(),
  (select id from public.lancamentos where recorrencia_id = pg_temp.v('rec') and data_vencimento = '2027-03-10'), 'encerrar', '{}');
select is((select (situacao, (select data_fim from public.recorrencias where id = pg_temp.v('rec')))::text from public.lancamentos
            where recorrencia_id = pg_temp.v('rec') and data_vencimento = '2027-03-10'),
  '(cancelado,2027-03-09)', 'encerrar: março cancelado e a recorrência termina antes');

-- -----------------------------------------------------------------------------
-- Parcelas com datas e valores escolhidos; lote
-- -----------------------------------------------------------------------------
select set_config('t.parc', public.financeiro_criar_parcelas(pg_temp.a(),
  jsonb_build_object('tipo', 'receber', 'descricao', 'Contrato', 'categoria_id', pg_temp.cat('SERVICOS'), 'data_competencia', '2026-11-27'),
  '[{"vencimento": "2026-12-05", "valor": "100.50"}, {"vencimento": "2027-01-20", "valor": 200}, {"vencimento": "2027-02-02", "valor": "99.50"}]')::text, true);
select is((select string_agg(to_char(data_vencimento, 'MM-DD') || '=' || valor_previsto, ',' order by parcela_numero) from public.lancamentos where parcelamento_id = pg_temp.v('parc')),
  '12-05=100.50,01-20=200.00,02-02=99.50', 'parcelas com as datas e os valores escolhidos');
select throws_like(format($$select public.financeiro_criar_parcelas(%L, '{"tipo": "receber", "descricao": "Teste"}', '[{"vencimento": "2026-12-05", "valor": 10}]')$$, pg_temp.a()),
  '%entre 2 e 360%', 'parcelamento precisa de 2 parcelas ou mais');
select is((public.financeiro_baixar_lote(pg_temp.a(), array(select id from public.lancamentos where parcelamento_id = pg_temp.v('parc') and parcela_numero <= 2),
  '2026-11-27', pg_temp.v('banco'), 'pix', '22222222-2222-2222-2222-222222222222') ->> 'total')::numeric, 300.50::numeric,
  'baixa em lote quita os títulos escolhidos');
select is((public.financeiro_baixar_lote(pg_temp.a(), array(select id from public.lancamentos where parcelamento_id = pg_temp.v('parc') and parcela_numero <= 2),
  '2026-11-27', pg_temp.v('banco'), 'pix', '22222222-2222-2222-2222-222222222222') ->> 'quantidade')::int, 0,
  'repetir o mesmo lote não paga de novo');
select is(public.financeiro_lote_alterar(pg_temp.a(), array(select id from public.lancamentos where parcelamento_id = pg_temp.v('parc')), 'vencimento', '2027-03-01'),
  1, 'lote: muda o vencimento só do que está em aberto');

-- -----------------------------------------------------------------------------
-- Painel e histórico do cliente
-- -----------------------------------------------------------------------------
select is((public.financeiro_painel(pg_temp.a()) ->> 'saldo_disponivel')::numeric,
  public.saldo_conta(pg_temp.v('banco'), '2026-11-27') + public.saldo_conta(pg_temp.v('caixa'), '2026-11-27'),
  'painel: saldo disponível é a soma das contas');
select is(jsonb_array_length(public.financeiro_painel(pg_temp.a()) -> 'serie'), 61, 'painel: gráfico de 30 dias para trás e 30 para frente');
select is((public.financeiro_painel(pg_temp.a()) -> 'titulos' -> 'receber' -> 'vencido' ->> 'total')::numeric, 250.00::numeric,
  'painel: recebimentos vencidos (saldo em aberto)');
select is((public.financeiro_historico_contraparte(pg_temp.a(), pg_temp.v('cliente')) -> 'receber' ->> 'em_aberto')::numeric, 550.00::numeric,
  'histórico do cliente: valor em aberto');
reset role;

-- -----------------------------------------------------------------------------
-- Isolamento: quem é de outra empresa não vê nem mexe
-- -----------------------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.financeiro_painel(%L)$$, pg_temp.a()), '42501', null, 'outra empresa não abre o painel');
select throws_ok(format($$select public.financeiro_baixar(%L, %L, '2026-11-27', %L, 1)$$, pg_temp.a(), pg_temp.v('r1'), pg_temp.v('banco')),
  '42501', null, 'outra empresa não baixa');
select is((select count(*)::int from public.lancamentos where empresa_id = pg_temp.a())
          + (select count(*)::int from public.baixas_estornadas where empresa_id = pg_temp.a()), 0,
  'outra empresa não vê títulos nem estornos');
reset role;

select * from finish();
rollback;
