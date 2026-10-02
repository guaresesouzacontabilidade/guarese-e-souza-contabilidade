-- Critérios: transferências entre contas não viram receita/despesa; cada lado
-- de uma transferência é conciliado uma única vez; diferenças de valor exigem
-- tratamento (juros, multa, desconto, taxa ou pagamento parcial); movimentações
-- ignoradas exigem motivo; o resumo da carteira respeita o acesso de cada um.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

\ir 00_setup.sql.inc

create or replace function pg_temp.cat(p_codigo text) returns uuid language sql as $$
  select id from public.categorias_financeiras
   where empresa_id = current_setting('testes.empresa_a')::uuid and (codigo = p_codigo or codigo_sistema = p_codigo);
$$;
create or replace function pg_temp.mov(p_descricao text) returns uuid language sql as $$
  select id from public.movimentos_bancarios where descricao = p_descricao;
$$;
create or replace function pg_temp.conta(p_nome text) returns uuid language sql as $$
  select id from public.contas_financeiras where nome = p_nome;
$$;

insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial, saldo_inicial_data) values
  (current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'BB', 5000, '2026-08-31'),
  (current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'Itaú', 0, '2026-08-31'),
  (current_setting('testes.empresa_a')::uuid, 'caixa', 'Caixa', 0, '2026-08-31');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.importar_extrato(current_setting('testes.empresa_a')::uuid, pg_temp.conta('BB'), 'extrato_ofx', 'bb-set', 'bb.ofx',
  repeat('1', 64), null, '{}', jsonb_build_array(
    jsonb_build_object('data', '2026-09-10', 'valor', -1000, 'descricao', 'TRANSF ENVIADA ITAU', 'ocorrencia', 1),
    jsonb_build_object('data', '2026-09-11', 'valor', -200, 'descricao', 'SAQUE CAIXA ELETRONICO', 'ocorrencia', 1),
    jsonb_build_object('data', '2026-09-12', 'valor', 515.50, 'descricao', 'PIX RECEBIDO CLIENTE Y', 'ocorrencia', 1),
    jsonb_build_object('data', '2026-09-13', 'valor', 300, 'descricao', 'PIX RECEBIDO CLIENTE Z', 'ocorrencia', 1),
    jsonb_build_object('data', '2026-09-14', 'valor', -99.90, 'descricao', 'DEBITO AUTOMATICO SEGURO', 'ocorrencia', 1),
    jsonb_build_object('data', '2026-09-15', 'valor', -50, 'descricao', 'SAQUE AGENCIA', 'ocorrencia', 1),
    jsonb_build_object('data', '2026-09-16', 'valor', -50, 'descricao', 'SAQUE AGENCIA 2', 'ocorrencia', 1)
  ));
select public.importar_extrato(current_setting('testes.empresa_a')::uuid, pg_temp.conta('Itaú'), 'extrato_ofx', 'itau-set', 'itau.ofx',
  repeat('2', 64), null, '{}', jsonb_build_array(
    jsonb_build_object('data', '2026-09-10', 'valor', 1000, 'descricao', 'TRANSF RECEBIDA BB', 'ocorrencia', 1)
  ));

-- -------------------------------------------------------------- transferências
select lives_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid,
                  array[pg_temp.mov('TRANSF ENVIADA ITAU'), pg_temp.mov('TRANSF RECEBIDA BB')], p_tipo => 'transferencia')$$,
                'saída do BB e entrada no Itaú conciliadas como transferência');
select is((select count(*)::int from public.transferencias where valor = 1000 and conta_origem_id = pg_temp.conta('BB')
            and conta_destino_id = pg_temp.conta('Itaú')), 1, 'uma transferência BB → Itaú registrada');
select is((select count(*)::int from public.movimentos_bancarios where descricao in ('TRANSF ENVIADA ITAU', 'TRANSF RECEBIDA BB')
            and status_conciliacao = 'conciliado'), 2, 'os dois lados ficam conciliados');
select is((select count(*)::int from public.baixas), 0, 'transferência não gera receita nem despesa');

select throws_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid,
                   array[pg_temp.mov('SAQUE CAIXA ELETRONICO')], p_tipo => 'transferencia')$$,
                 null, null, 'transferência de um lado só exige a outra conta');
select lives_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid,
                  array[pg_temp.mov('SAQUE CAIXA ELETRONICO')], p_tipo => 'transferencia', p_conta_contrapartida => pg_temp.conta('Caixa'))$$,
                'saque conciliado como transferência para o caixa');
select is(public.saldo_conta(pg_temp.conta('Caixa'), '2026-09-30'), 200.00::numeric, 'caixa recebe o valor do saque');

-- Transferência já registrada manualmente: cada lado só uma vez
reset role;
insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor, descricao)
values (current_setting('testes.empresa_a')::uuid, pg_temp.conta('BB'), pg_temp.conta('Caixa'), '2026-09-15', 50, 'Reforço do caixa');
select set_config('testes.transf', (select id::text from public.transferencias where descricao = 'Reforço do caixa'), true);
set local role authenticated;
select lives_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[pg_temp.mov('SAQUE AGENCIA')],
                  p_transferencias => array[current_setting('testes.transf')::uuid], p_tipo => 'transferencia')$$,
                'movimentação conciliada com a transferência já registrada');
select throws_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[pg_temp.mov('SAQUE AGENCIA 2')],
                   p_transferencias => array[current_setting('testes.transf')::uuid], p_tipo => 'transferencia')$$,
                 null, 'Esta transferência já foi conciliada com outra movimentação desta conta.',
                 'o mesmo lado da transferência não é conciliado duas vezes');
select is((select status_conciliacao from public.movimentos_bancarios where descricao = 'SAQUE AGENCIA 2'), 'pendente',
          'a segunda movimentação continua pendente');

-- -------------------------------------------------------------- diferenças de valor
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'receber', 'Venda cliente Y', pg_temp.cat('VENDAS'), '2026-09-05', '2026-09-10', 500),
       (current_setting('testes.empresa_a')::uuid, 'receber', 'Venda cliente Z', pg_temp.cat('VENDAS'), '2026-09-05', '2026-09-10', 400);

select throws_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[pg_temp.mov('PIX RECEBIDO CLIENTE Y')],
                   array(select id from public.lancamentos where descricao = 'Venda cliente Y'))$$,
                 null, null, 'valor recebido a maior exige informar o tratamento da diferença');
select throws_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[pg_temp.mov('PIX RECEBIDO CLIENTE Y')],
                   array(select id from public.lancamentos where descricao = 'Venda cliente Y'), p_tratamento => 'taxa')$$,
                 null, null, 'recebimento a maior não pode ser tratado como taxa');
select lives_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[pg_temp.mov('PIX RECEBIDO CLIENTE Y')],
                  array(select id from public.lancamentos where descricao = 'Venda cliente Y'), p_tratamento => 'juros')$$,
                'diferença tratada como juros');
select is((select juros from public.baixas b join public.lancamentos l on l.id = b.lancamento_id where l.descricao = 'Venda cliente Y'),
          15.50::numeric, 'juros de R$ 15,50 registrados na baixa');
select is((select situacao from public.lancamentos where descricao = 'Venda cliente Y'), 'quitado', 'lançamento quitado');

select lives_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[pg_temp.mov('PIX RECEBIDO CLIENTE Z')],
                  array(select id from public.lancamentos where descricao = 'Venda cliente Z'), p_tratamento => 'parcial')$$,
                'recebimento parcial conciliado');
select is((select situacao || ' ' || valor_baixado::text from public.lancamentos where descricao = 'Venda cliente Z'), 'parcial 300.00',
          'lançamento fica parcialmente recebido (R$ 300 de R$ 400)');

-- -------------------------------------------------------------- ignorar
select throws_ok($$select public.ignorar_movimento(pg_temp.mov('DEBITO AUTOMATICO SEGURO'), true, '')$$, null, null,
                 'ignorar exige motivo');
select lives_ok($$select public.ignorar_movimento(pg_temp.mov('DEBITO AUTOMATICO SEGURO'), true, 'Lançado em outra empresa do grupo')$$,
                'movimentação ignorada com motivo');

-- -------------------------------------------------------------- resumo da carteira
select is((select pendentes || ' ' || saidas_pendentes::text from public.resumo_conciliacao_carteira()
            where empresa_id = current_setting('testes.empresa_a')::uuid), '1 50.00',
          'resumo mostra uma pendência (R$ 50) — ignoradas não contam');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.resumo_conciliacao_carteira() where empresa_id = current_setting('testes.empresa_a')::uuid), 0,
          'cliente de outra empresa não vê o resumo da empresa A');
select is((select count(*)::int from public.movimentos_bancarios), 0, 'nem as movimentações da empresa A');
reset role;

select * from finish();
rollback;
