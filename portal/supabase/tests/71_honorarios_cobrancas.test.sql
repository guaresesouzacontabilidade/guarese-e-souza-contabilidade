-- Honorários do escritório: só o administrador e quem ele autoriza mexem; o
-- mês gera a cobrança com os extras; o cliente vê só a própria cobrança
-- aprovada; a baixa separa juros, multa e desconto na DRE; lançamento sem
-- linha da DRE fica "a classificar"; desfazer e cancelar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(30);

\ir 00_setup.sql.inc

-- Mês de referência três meses atrás (vencimento no mês seguinte, já passado)
select set_config('testes.comp', (date_trunc('month', now()) - interval '3 months')::date::text, true);
select set_config('testes.venc', ((date_trunc('month', now()) - interval '2 months')::date + 9)::text, true);

-- 3 funcionários ativos na empresa A durante o mês
insert into public.colaboradores (empresa_id, nome, admissao, salario)
select current_setting('testes.empresa_a')::uuid, 'Funcionário ' || n, current_setting('testes.comp')::date - 60, 2000
  from generate_series(1, 3) n;

-- 1. Equipe sem autorização não mexe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok(format($$select public.honorarios_ficha_salvar(null, '{"empresa_id": "%s", "valor_mensal": 800, "dia_vencimento": 10, "inicio": "2026-01-01"}')$$,
  current_setting('testes.empresa_a')), '42501', null, 'equipe sem autorização não cria ficha');
select is((select count(*) from public.escritorio_categorias)::int, 0, 'equipe sem autorização não vê o plano de contas do escritório');
select throws_ok($$select public.honorarios_acesso_definir('00000000-0000-0000-0000-0000000000a2', true)$$, '42501', null, 'equipe não se autoriza');
reset role;

-- 2. O administrador autoriza; a equipe autorizada cria a ficha
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.honorarios_acesso_definir('00000000-0000-0000-0000-0000000000a2', true)$$, 'administrador autoriza alguém da equipe');
select throws_ok($$select public.honorarios_acesso_definir('00000000-0000-0000-0000-0000000000b1', true)$$, 'P0001', null, 'cliente não recebe acesso ao financeiro do escritório');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.ficha', public.honorarios_ficha_salvar(null, jsonb_build_object(
  'empresa_id', current_setting('testes.empresa_a'), 'valor_mensal', 800, 'dia_vencimento', 10,
  'inicio', (current_setting('testes.comp')::date - 365)::text, 'servicos', jsonb_build_array('contabil', 'fiscal', 'folha'),
  'funcionarios_inclusos', 2, 'valor_funcionario_extra', 30,
  'contato_email', 'Financeiro@EmpresaA.test', 'contato_whatsapp', '(63) 99999-0000', 'whatsapp_autorizado', true))::text, true);
select is((select contato_whatsapp || ' ' || contato_email from public.honorarios_fichas where id = current_setting('testes.ficha')::uuid),
  '5563999990000 financeiro@empresaa.test', 'contatos normalizados (WhatsApp com 55, e-mail minúsculo)');
select throws_like(format($$select public.honorarios_ficha_salvar(null, '{"empresa_id": "%s", "valor_mensal": 500, "dia_vencimento": 5, "inicio": "2026-01-01"}')$$,
  current_setting('testes.empresa_a')), '%já tem uma ficha%', 'uma ficha por empresa');

-- 3. O mês gera a cobrança com o extra de funcionário (3 de 2 inclusos)
select is(public.honorarios_gerar(current_setting('testes.comp')::date), 1, 'gera a cobrança do mês');
select is(public.honorarios_gerar(current_setting('testes.comp')::date), 0, 'gerar de novo não duplica');
select set_config('testes.cob', (select id::text from public.honorarios_cobrancas where ficha_id = current_setting('testes.ficha')::uuid), true);
select results_eq(
  format($$select valor, vencimento, situacao from public.honorarios_cobrancas where id = '%s'$$, current_setting('testes.cob')),
  format($$values (830.00::numeric, '%s'::date, 'rascunho'::text)$$, current_setting('testes.venc')),
  'R$ 800 + 1 funcionário a mais (R$ 30), vencendo no dia 10 do mês seguinte, em rascunho');
select is((select count(*) from public.honorarios_cobranca_itens where cobranca_id = current_setting('testes.cob')::uuid)::int, 2, 'dois itens: honorário e extra');
reset role;

-- 4. Rascunho não aparece para o cliente nem para a equipe sem autorização
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*) from public.honorarios_cobrancas)::int, 0, 'cliente não vê rascunho');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*) from public.honorarios_cobrancas)::int, 0, 'equipe sem autorização não vê cobranças');
reset role;

-- 5. Aprovar: Pix copiado, link de pagamento, e-mail agendado (WhatsApp desligado na configuração)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.honorarios_config_salvar('{"pix_chave": "11444777000161", "pix_tipo": "cnpj", "pix_nome": "ESCRITORIO TESTE", "pix_cidade": "PALMAS"}')$$, 'configura a chave Pix');
select is(public.honorarios_cobrancas_aprovar(array[current_setting('testes.cob')::uuid]), 1, 'aprova a cobrança');
select ok((select situacao = 'aberta' and pix_txid ~ '^HON[0-9]{10}$' and pix_chave = '11444777000161' and token_publico ~ '^[0-9a-f]{32}$'
             from public.honorarios_cobrancas where id = current_setting('testes.cob')::uuid), 'aberta com txid, chave Pix e link de pagamento');
select results_eq(
  format($$select canal, motivo from public.honorarios_lembretes where cobranca_id = '%s' order by canal$$, current_setting('testes.cob')),
  $$values ('email'::text, 'emissao'::text)$$, 'só o e-mail sai (WhatsApp desligado)');
reset role;

-- 6. O cliente da empresa vê a cobrança e os itens; outra empresa não
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*) from public.honorarios_cobrancas)::int, 1, 'cliente vê a cobrança aprovada da própria empresa');
select is((select count(*) from public.honorarios_cobranca_itens)::int, 2, 'e os itens dela');
select throws_ok(format($$select public.honorarios_cobranca_baixar('%s', '{"pago_em": "2026-01-01", "valor_pago": 1}')$$, current_setting('testes.cob')),
  '42501', null, 'cliente não dá baixa');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*) from public.honorarios_cobrancas)::int, 0, 'cliente de outra empresa não vê');
reset role;

-- 7. Baixa com 10 dias de atraso: multa 2% (16,60) + juros 1% ao mês (2,77)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.honorarios_cobranca_baixar('%s', '{"pago_em": "%s", "valor_pago": 800}')$$,
  current_setting('testes.cob'), current_setting('testes.venc')), '%menor que o da cobrança%', 'valor menor sem desconto é recusado');
select is(public.honorarios_cobranca_baixar(current_setting('testes.cob')::uuid, jsonb_build_object(
  'pago_em', (current_setting('testes.venc')::date + 10)::text, 'valor_pago', 849.37)),
  '{"multa": 16.60, "juros": 2.77, "desconto": 0}'::jsonb, 'separa multa e juros');
select results_eq(
  format($$select c.chave, l.valor from public.escritorio_lancamentos l join public.escritorio_categorias c on c.id = l.categoria_id
            where l.cobranca_id = '%s' order by c.codigo$$, current_setting('testes.cob')),
  $$values ('HON_MENSAL'::text, 800.00::numeric), ('HON_EXTRA', 30.00), ('JUROS_MULTA', 19.37)$$,
  'cada item na sua linha da DRE e os juros e a multa separados');

-- 8. Lançamento manual: sem linha fica "a classificar"; linha de despesa não aceita receita
select ok(public.escritorio_lancamento_salvar(null, '{"natureza": "receita", "data": "2026-10-05", "descricao": "PIX RECEBIDO", "valor": 150}') is not null,
  'entra sem linha da DRE');
select is((select count(*) from public.escritorio_lancamentos where categoria_id is null)::int, 1, 'fica a classificar');
select throws_like(format($$select public.escritorio_lancamento_salvar(null, '{"natureza": "receita", "data": "2026-10-05", "descricao": "Aluguel", "valor": 10, "categoria_id": "%s"}')$$,
  (select id from public.escritorio_categorias where codigo = '4.01')), '%é de despesa%', 'linha de despesa não aceita receita');
select throws_like($$select public.escritorio_lancamento_salvar(null, '{"natureza": "despesa", "data": "2026-10-05", "descricao": "", "valor": 10}')$$,
  '%descrição%', 'sem descrição não entra');

-- 9. Desfazer o pagamento: lançamentos saem e a cobrança volta a ficar em aberto
select lives_ok(format($$select public.honorarios_cobranca_estornar('%s', 'Lançado por engano')$$, current_setting('testes.cob')), 'desfaz o pagamento');
select ok((select situacao = 'aberta' from public.honorarios_cobrancas where id = current_setting('testes.cob')::uuid)
          and not exists (select 1 from public.escritorio_lancamentos where cobranca_id = current_setting('testes.cob')::uuid),
  'volta para em aberto sem lançamentos');
reset role;

select * from finish();
rollback;
