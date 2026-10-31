-- Critérios: a recepção lança serviços extras para uma EMPRESA (sem hóspede)
-- e cada lançamento vira um recibo numerado; pago na hora entra no Financeiro
-- já recebido (e no caixa aberto da pessoa), a prazo entra como conta a
-- receber da empresa com vencimento; preço diferente do cadastro só o gerente;
-- só o gerente cancela (o Financeiro é cancelado junto, e o recibo já recebido
-- no Financeiro não cancela); outra empresa não vê; ninguém grava direto.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "hotel"}');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.marmita', public.hotel_extra_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Marmita", "natureza": "alimentacao", "unidade": "marmita", "preco": "22"}')::text, true);
select set_config('testes.lav', public.hotel_extra_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Lavanderia (por peça)", "natureza": "lavanderia", "unidade": "peca", "preco": "12.50"}')::text, true);
reset role;
-- Empresa cliente de outro CNPJ, cadastrada na empresa B (não serve para o hotel A)
insert into public.contrapartes (id, empresa_id, nome, documento, tipo_pessoa, papeis)
values ('0f000000-0000-0000-0000-0000000057b1', current_setting('testes.empresa_b')::uuid, 'Outra Construtora', '11444777000161', 'PJ', array['cliente']);

-- A recepção (só "Vender no caixa") cadastra a empresa e lança
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.obra', public.gestao_cliente_salvar(current_setting('testes.empresa_a')::uuid,
  '{"nome": "Construtora Rio Claro Ltda", "documento": "11.222.333/0001-81"}')::text, true);

-- 1. Pago na hora (Pix), sem caixa aberto
select set_config('testes.rec1', public.hotel_extras_recibo_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'solicitante', 'Eng. Paulo (obra da ponte)', 'pagamento', 'na_hora', 'forma', 'pix',
  'itens', jsonb_build_array(
    jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 3),
    jsonb_build_object('extra_id', current_setting('testes.lav'), 'quantidade', 5))))::text, true);
select is((current_setting('testes.rec1')::jsonb ->> 'numero')::int, 1, 'o primeiro recibo é o nº 1');
select is((current_setting('testes.rec1')::jsonb ->> 'total')::numeric, 128.50::numeric, 'total = 3 × 22,00 + 5 × 12,50');
select is((select string_agg(natureza || ':' || unidade || ':' || quantidade::numeric(10,0) || 'x' || valor_unitario || '=' || total, ' | ' order by total)
             from public.hotel_extras_recibo_itens where recibo_id = (current_setting('testes.rec1')::jsonb ->> 'id')::uuid),
  'lavanderia:peca:5x12.50=62.50 | alimentacao:marmita:3x22.00=66.00', 'os serviços do recibo com a natureza e a unidade');
reset role;
select is((select l.situacao || '|' || l.valor_previsto || '|' || l.numero_documento || '|' || l.origem || '|' || (l.contraparte_id::text = current_setting('testes.obra'))::text
             from public.lancamentos l join public.hotel_extras_recibos r on r.lancamento_id = l.id
            where r.id = (current_setting('testes.rec1')::jsonb ->> 'id')::uuid),
  'quitado|128.50|REC 1|hotel|true', 'no Financeiro: receita já recebida, em nome da empresa, com o nº do recibo');
select is((select sessao_id from public.hotel_extras_recibos where id = (current_setting('testes.rec1')::jsonb ->> 'id')::uuid), null,
  'sem caixa aberto, não entra em caixa nenhum');

-- 2. Pago na hora em dinheiro, com o caixa aberto: entra na gaveta
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Recepção', 50)::text, true);
select set_config('testes.rec2', public.hotel_extras_recibo_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'na_hora', 'forma', 'dinheiro',
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 10))))::text, true);
reset role;
select is((current_setting('testes.rec2')::jsonb ->> 'numero')::int, 2, 'o recibo seguinte é o nº 2');
select is((select (app.caixa_resumo(current_setting('testes.caixa')::uuid) ->> 'dinheiro_esperado')::numeric), 270.00::numeric,
  'o dinheiro do recibo entra na gaveta esperada (50 + 220)');
select is((select (app.caixa_resumo(current_setting('testes.caixa')::uuid) ->> 'hotel_quantidade')::int), 1, 'e conta nos recebimentos do hotel do caixa');

-- 3. A prazo: conta a receber da empresa, com vencimento
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.rec3', public.hotel_extras_recibo_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'a_prazo', 'vencimento', (current_setting('testes.hoje')::date + 15)::text,
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 30))))::text, true);
reset role;
select is((select l.situacao || '|' || l.valor_previsto || '|' || (l.data_vencimento = current_setting('testes.hoje')::date + 15)::text
                  || '|' || (l.contraparte_id::text = current_setting('testes.obra'))::text || '|' || (r.sessao_id is null)::text
             from public.lancamentos l join public.hotel_extras_recibos r on r.lancamento_id = l.id
            where r.id = (current_setting('testes.rec3')::jsonb ->> 'id')::uuid),
  'aberto|660.00|true|true|true', 'a prazo: conta a receber da empresa com o vencimento, fora do caixa');

-- 4. Recusas
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.hotel_extras_recibo_lancar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'a_prazo',
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  '%vencimento%', 'a prazo sem vencimento é recusado');
select throws_like(format($$select public.hotel_extras_recibo_lancar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'na_hora',
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  '%como a empresa pagou%', 'pago na hora sem a forma é recusado');
select throws_like(format($$select public.hotel_extras_recibo_lancar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'contraparte_id', '0f000000-0000-0000-0000-0000000057b1', 'pagamento', 'na_hora', 'forma', 'pix',
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  '%Escolha a empresa%', 'empresa do cadastro de outro cliente do escritório é recusada');
select throws_like(format($$select public.hotel_extras_recibo_lancar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'na_hora', 'forma', 'pix',
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1, 'valor_unitario', '15')))),
  '%Só o gerente%', 'a recepção não muda o preço do cadastro');
select throws_like(format($$select public.hotel_extras_recibo_lancar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'na_hora', 'forma', 'pix', 'data', (current_setting('testes.hoje')::date + 1)::text,
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  '%hoje ou dos últimos 90 dias%', 'data futura é recusada');

-- 5. Só o gerente cancela
select throws_like(format($$select public.hotel_extras_recibo_cancelar(%L, 'lançado errado')$$, current_setting('testes.rec2')::jsonb ->> 'id'),
  '%Acesso negado%', 'a recepção não cancela recibo');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.hotel_extras_recibo_cancelar(%L, 'Marmitas devolvidas pela obra')$$, current_setting('testes.rec2')::jsonb ->> 'id'),
  'o gerente cancela o recibo pago em dinheiro com o caixa aberto');
select throws_like(format($$select public.hotel_extras_recibo_cancelar(%L, 'de novo')$$, current_setting('testes.rec2')::jsonb ->> 'id'),
  '%já foi cancelado%', 'não cancela duas vezes');
reset role;
select is((select l.situacao || '|' || (select count(*) from public.baixas b where b.lancamento_id = l.id)
             from public.lancamentos l join public.hotel_extras_recibos r on r.lancamento_id = l.id
            where r.id = (current_setting('testes.rec2')::jsonb ->> 'id')::uuid),
  'cancelado|0', 'o lançamento do Financeiro é cancelado e o recebimento sai');
select is((select (app.caixa_resumo(current_setting('testes.caixa')::uuid) ->> 'dinheiro_esperado')::numeric), 50.00::numeric,
  'o dinheiro do recibo cancelado sai da gaveta esperada');

-- Recibo a prazo que a empresa já pagou (recebido no Financeiro) não cancela pelo hotel
insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem)
select r.empresa_id, r.lancamento_id, 'receber', app.hoje(), g.conta_pix_id, 660, 'pix', 'manual'
  from public.hotel_extras_recibos r join public.gestao_config g on g.empresa_id = r.empresa_id
 where r.id = (current_setting('testes.rec3')::jsonb ->> 'id')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.hotel_extras_recibo_cancelar(%L, 'engano')$$, current_setting('testes.rec3')::jsonb ->> 'id'),
  '%já foi recebido ou conciliado no Financeiro%', 'recibo já recebido no Financeiro não cancela pelo hotel');
reset role;

-- A lista do período mostra a situação para a recepção (que não lê o Financeiro)
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select string_agg((x ->> 'numero') || ':' || (x ->> 'situacao'), ' ' order by (x ->> 'numero')::int)
             from jsonb_array_elements(public.hotel_extras_recibos_listar(current_setting('testes.empresa_a')::uuid,
                    current_setting('testes.hoje')::date - 30, current_setting('testes.hoje')::date)) x),
  '1:pago 2:cancelado 3:pago', 'a recepção vê cada recibo como pago, a receber ou cancelado');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_like(format($$select public.hotel_extras_recibos_listar(%L, current_date - 30, current_date)$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'cliente de outra empresa não lista os recibos do hotel');
reset role;

-- 6. Outra empresa não vê; ninguém grava direto
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.hotel_extras_recibos), 0, 'cliente de outra empresa não vê os recibos');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format($$insert into public.hotel_extras_recibos (empresa_id, numero, contraparte_id, total, pagamento, forma)
  values (%L, 99, %L, 10, 'na_hora', 'pix')$$, current_setting('testes.empresa_a'), current_setting('testes.obra')),
  '42501', null, 'ninguém grava recibo direto na tabela');
reset role;

select * from finish();
rollback;
