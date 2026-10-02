-- Critérios: transferências internas não alteram o resultado; compras no cartão e
-- pagamento da fatura não duplicam despesas; aportes/empréstimos não são receita;
-- principal e juros separados; maquininha separa bruto/taxa/líquido; valores
-- decimais exatos; competências fechadas bloqueiam alterações.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(32);

\ir 00_setup.sql.inc

create or replace function pg_temp.cat(p_codigo text) returns uuid language sql as $$
  select id from public.categorias_financeiras
   where empresa_id = current_setting('testes.empresa_a')::uuid and (codigo = p_codigo or codigo_sistema = p_codigo);
$$;
create or replace function pg_temp.dre(p_tipo text) returns numeric language sql as $$
  select coalesce(sum(valor), 0) from public.relatorio_dre_linhas(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')
   where tipo = p_tipo;
$$;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial, saldo_inicial_data)
values (current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'BB', 1000, '2026-08-31'),
       (current_setting('testes.empresa_a')::uuid, 'caixa', 'Caixa', 0, '2026-08-31'),
       (current_setting('testes.empresa_a')::uuid, 'cartao_credito', 'Cartão Empresa', 0, '2026-08-31');
select set_config('testes.bb', (select id::text from public.contas_financeiras where nome = 'BB'), true);
select set_config('testes.caixa', (select id::text from public.contas_financeiras where nome = 'Caixa'), true);
select set_config('testes.cartao', (select id::text from public.contas_financeiras where nome = 'Cartão Empresa'), true);

select is((select compoe_saldo_disponivel from public.contas_financeiras where nome = 'Cartão Empresa'), false,
          'cartão de crédito não compõe o saldo disponível');

-- 1) Venda à vista R$ 1.000,00
with l as (
  insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
  values (current_setting('testes.empresa_a')::uuid, 'receber', 'Venda à vista', pg_temp.cat('VENDAS'), '2026-09-05', '2026-09-05', 1000)
  returning id)
insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal)
select current_setting('testes.empresa_a')::uuid, id, '2026-09-05', current_setting('testes.bb')::uuid, 1000 from l;

-- 2) Transferência BB → Caixa
insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.bb')::uuid, current_setting('testes.caixa')::uuid, '2026-09-06', 200);

-- 3) Aporte dos sócios e 4) empréstimo recebido
with l as (
  insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
  values (current_setting('testes.empresa_a')::uuid, 'receber', 'Aporte do sócio', pg_temp.cat('APORTE'), '2026-09-07', '2026-09-07', 5000),
         (current_setting('testes.empresa_a')::uuid, 'receber', 'Empréstimo banco', pg_temp.cat('EMPRESTIMO_CAPTACAO'), '2026-09-07', '2026-09-07', 10000)
  returning id, valor_previsto)
insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal)
select current_setting('testes.empresa_a')::uuid, id, '2026-09-07', current_setting('testes.bb')::uuid, valor_previsto from l;

-- 5) Parcela de empréstimo: principal 800 + juros 120
select lives_ok($$select public.registrar_parcela_emprestimo(current_setting('testes.empresa_a')::uuid, 'Parcela 1/12 empréstimo',
                  '2026-09-25', 800, 120, current_setting('testes.bb')::uuid, null, '2026-09-25')$$,
                'parcela de empréstimo separa amortização e juros');

-- 6) Compra no cartão R$ 300 e 7) pagamento da fatura (transferência)
select lives_ok($$select public.registrar_compra_cartao(current_setting('testes.empresa_a')::uuid, current_setting('testes.cartao')::uuid,
                  'Material de escritório', '2026-09-10', 300, pg_temp.cat('4.08'))$$, 'compra no cartão registrada');
insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor, descricao)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.bb')::uuid, current_setting('testes.cartao')::uuid, '2026-09-30', 300, 'Fatura setembro');
select is((select tipo from public.transferencias where descricao = 'Fatura setembro'), 'pagamento_fatura_cartao',
          'pagamento de fatura classificado automaticamente como transferência para o cartão');

-- 8) Maquininha: bruto 500, taxa 15, líquido 485
select lives_ok($$select public.registrar_venda_maquininha(current_setting('testes.empresa_a')::uuid, 'Vendas cartão 12/09',
                  '2026-09-12', '2026-09-12', 500, 15, current_setting('testes.bb')::uuid, pg_temp.cat('VENDAS'))$$,
                'venda em maquininha registrada');
select is((select valor_total from public.baixas b join public.lancamentos l on l.id = b.lancamento_id where l.descricao = 'Vendas cartão 12/09'),
          485.00::numeric, 'valor líquido recebido = bruto − taxa');

-- 9) Retirada de sócio
with l as (
  insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
  values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Retirada sócio', pg_temp.cat('RETIRADA'), '2026-09-28', '2026-09-28', 1000)
  returning id)
insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal)
select current_setting('testes.empresa_a')::uuid, id, '2026-09-28', current_setting('testes.bb')::uuid, 1000 from l;

-- 10) Aluguel R$ 2.000 pago em duas partes, a segunda com juros
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Aluguel setembro', pg_temp.cat('4.04'), '2026-09-01', '2026-09-10', 2000);
select set_config('testes.aluguel', (select id::text from public.lancamentos where descricao = 'Aluguel setembro'), true);
insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.aluguel')::uuid, '2026-09-10', current_setting('testes.bb')::uuid, 1000);
select is((select situacao from public.lancamentos where id = current_setting('testes.aluguel')::uuid), 'parcial', 'pagamento parcial registrado');
select throws_ok($$insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal)
                   values (current_setting('testes.empresa_a')::uuid, current_setting('testes.aluguel')::uuid, '2026-09-15', current_setting('testes.bb')::uuid, 1000.01)$$,
                 null, null, 'baixa maior que o saldo em aberto é recusada');
insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal, juros)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.aluguel')::uuid, '2026-09-15', current_setting('testes.bb')::uuid, 1000, 20);
select is((select situacao from public.lancamentos where id = current_setting('testes.aluguel')::uuid), 'quitado', 'lançamento quitado após o restante');
select is((select valor_realizado from public.lancamentos where id = current_setting('testes.aluguel')::uuid), 2020.00::numeric,
          'valor realizado inclui juros (previsto 2.000, realizado 2.020)');
select throws_ok(format($$update public.lancamentos set situacao = 'cancelado' where id = %L$$, current_setting('testes.aluguel')),
                 null, null, 'não é possível cancelar lançamento com baixas');
select throws_ok($$insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
                   values (current_setting('testes.empresa_a')::uuid, 'receber', 'Categoria errada', pg_temp.cat('4.04'), '2026-09-01', '2026-09-01', 10)$$,
                 null, null, 'categoria de despesa não pode ser usada em conta a receber');
select throws_ok(format($$update public.lancamentos set valor_baixado = 0 where id = %L$$, current_setting('testes.aluguel')),
                 '42501', null, 'campos calculados não podem ser alterados diretamente');

-- Lançamento sugerido não recebe baixa nem entra no resultado
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto, status_revisao)
values (current_setting('testes.empresa_a')::uuid, 'receber', 'Sugestão de NF', pg_temp.cat('VENDAS'), '2026-09-20', '2026-10-20', 999, 'sugerido');
select throws_ok($$insert into public.baixas (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal)
                   select current_setting('testes.empresa_a')::uuid, id, '2026-09-20', current_setting('testes.bb')::uuid, 999
                     from public.lancamentos where descricao = 'Sugestão de NF'$$,
                 null, null, 'lançamento sugerido precisa ser confirmado antes da baixa');

-- Precisão decimal
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'receber', 'Centavos 1', pg_temp.cat('1.03'), '2026-09-02', '2026-09-02', 0.10),
       (current_setting('testes.empresa_a')::uuid, 'receber', 'Centavos 2', pg_temp.cat('1.03'), '2026-09-02', '2026-09-02', 0.20);
select is((select sum(valor_previsto) from public.lancamentos where descricao like 'Centavos%'), 0.30::numeric, '0,10 + 0,20 = 0,30 exatos (numeric)');

-- --------------------------------------------------------------- DRE gerencial
select is(pg_temp.dre('receita_operacional'), 1500.30::numeric, 'receita: venda + maquininha (bruto) + centavos; sem aporte/empréstimo/sugestão');
select is(pg_temp.dre('despesa_operacional'), 2300.00::numeric, 'despesas: aluguel + compra no cartão contada uma única vez');
select is(pg_temp.dre('despesa_financeira'), 155.00::numeric, 'despesa financeira: juros do empréstimo + taxa da maquininha + juros do aluguel');
select is((select count(*)::int from public.relatorio_dre_linhas(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')
            where tipo in ('aporte_socio', 'emprestimo_captacao', 'emprestimo_amortizacao', 'retirada_socio')), 0,
          'aporte, empréstimo, amortização e retirada ficam fora da DRE');

-- --------------------------------------------------------------- saldos
select is(public.saldo_conta(current_setting('testes.bb')::uuid, '2026-09-30'), 13045.00::numeric, 'saldo do banco confere com as operações');
select is(public.saldo_conta(current_setting('testes.cartao')::uuid, '2026-09-30'), 0.00::numeric, 'fatura paga zera o saldo do cartão');
select is(public.saldo_conta(current_setting('testes.caixa')::uuid, '2026-09-30'), 200.00::numeric, 'transferência entra no caixa');
select is((select sum(entrada) - sum(saida) from public.relatorio_fluxo_realizado(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')
            where conta_disponivel and (conta_contrapartida_disponivel is distinct from true)),
          12245.00::numeric, 'fluxo consolidado: transferências entre contas disponíveis se anulam; fatura do cartão é saída');
reset role;

-- --------------------------------------------------------------- fechamento
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.fechar_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$, null, null,
                 'não fecha sem concluir as etapas');
select public.iniciar_fechamento(current_setting('testes.empresa_a')::uuid, '2026-09-01');
select public.atualizar_etapa_fechamento(e.id, 'concluida') from public.fechamento_etapas e
  join public.competencias c on c.id = e.competencia_id
 where c.empresa_id = current_setting('testes.empresa_a')::uuid and c.competencia = '2026-09-01' and e.etapa <> 'publicacao';
select lives_ok($$select public.fechar_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'Revisado')$$, 'competência fechada');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
                   values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Despesa esquecida', pg_temp.cat('4.99'), '2026-09-15', '2026-09-15', 50)$$,
                 'P0001', null, 'competência fechada bloqueia novos lançamentos');
select throws_ok(format($$update public.lancamentos set valor_previsto = 2500 where id = %L$$, current_setting('testes.aluguel')),
                 'P0001', null, 'competência fechada bloqueia alterações de valor');
select throws_ok($$delete from public.transferencias where descricao = 'Fatura setembro'$$, 'P0001', null,
                 'competência fechada bloqueia exclusões');
select lives_ok($$insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
                  values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Despesa de outubro', pg_temp.cat('4.99'), '2026-10-02', '2026-10-02', 50)$$,
                'competência seguinte continua aberta');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.reabrir_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'Ajuste necessário no aluguel')$$,
                 '42501', null, 'reabertura exige permissão específica');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$select public.reabrir_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'curta')$$, null, null,
                 'reabertura exige justificativa');
select lives_ok($$select public.reabrir_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'Cliente enviou nota de despesa atrasada')$$,
                'administrador reabre com justificativa');
reset role;

select * from finish();
rollback;
