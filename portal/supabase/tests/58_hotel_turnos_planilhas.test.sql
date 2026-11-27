-- Critérios: a recepção vê o movimento do hotel num intervalo de horário
-- (reserva feita, check-in, consumo, serviço extra, pagamento, recibo de
-- empresa, cancelamento, check-out), com quem fez cada coisa, e a lista dos
-- serviços extras do período (conta do quarto e empresas) para a planilha;
-- fora do intervalo não aparece; outra empresa não lê; período sem limite é recusado.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);
select set_config('testes.inicio', (now() - interval '1 minute')::text, true);

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "hotel"}');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.std', public.hotel_categoria_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Standard", "diaria": 200, "capacidade": 2, "pessoas_incluidas": 2}')::text, true);
select set_config('testes.q101', public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '101', 'categoria_id', current_setting('testes.std')))::text, true);
select set_config('testes.q102', public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '102', 'categoria_id', current_setting('testes.std')))::text, true);
select set_config('testes.marmita', public.hotel_extra_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Marmita", "natureza": "alimentacao", "unidade": "marmita", "preco": "22"}')::text, true);
reset role;

-- A recepção (só "Vender no caixa") faz o turno
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.maria', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Maria Silva", "cpf": "529.982.247-25"}')::text, true);
select set_config('testes.r1', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.maria'), 'quarto_id', current_setting('testes.q101'), 'adultos', 1,
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 1)::text)) ->> 'id'), true);
select set_config('testes.r2', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.maria'), 'quarto_id', current_setting('testes.q102'), 'adultos', 1,
  'entrada', (current_setting('testes.hoje')::date + 3)::text, 'saida', (current_setting('testes.hoje')::date + 4)::text)) ->> 'id'), true);
select public.hotel_checkin(current_setting('testes.r1')::uuid, '{}');
select public.hotel_extras_lancar(current_setting('testes.r1')::uuid, jsonb_build_object('itens',
  jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 2))));
select public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Turno da manhã — Ana', 50);
select public.hotel_pagamento_registrar(current_setting('testes.r1')::uuid, '{"forma": "dinheiro", "valor": "244"}');
select set_config('testes.obra', public.gestao_cliente_salvar(current_setting('testes.empresa_a')::uuid,
  '{"nome": "Construtora Rio Claro Ltda", "documento": "11.222.333/0001-81"}')::text, true);
select public.hotel_extras_recibo_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'contraparte_id', current_setting('testes.obra'), 'pagamento', 'na_hora', 'forma', 'pix',
  'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 10))));
select public.hotel_reserva_cancelar(current_setting('testes.r2')::uuid, 'Hóspede desistiu', false);
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.mov', public.hotel_movimento(current_setting('testes.empresa_a')::uuid,
  current_setting('testes.inicio')::timestamptz, now() + interval '1 minute')::text, true);
select is((select string_agg(distinct x ->> 'tipo', ',' order by x ->> 'tipo') from jsonb_array_elements(current_setting('testes.mov')::jsonb) x),
  'cancelamento,checkin,pagamento,recibo,reserva,servico', 'o movimento do turno traz reservas, check-in, serviço, pagamento, recibo e cancelamento');
select is((select count(*)::int from jsonb_array_elements(current_setting('testes.mov')::jsonb) x where x ->> 'tipo' = 'reserva'), 2, 'as duas reservas feitas no turno');
select is((select (x ->> 'valor')::numeric || '|' || (x ->> 'forma') || '|' || (x ->> 'quarto') || '|' || (x ->> 'hospede')
             from jsonb_array_elements(current_setting('testes.mov')::jsonb) x where x ->> 'tipo' = 'pagamento'),
  '244.00|dinheiro|101|Maria Silva', 'o pagamento com forma, quarto e hóspede');
select ok((select bool_and(x ->> 'quem' is not null) from jsonb_array_elements(current_setting('testes.mov')::jsonb) x), 'cada linha diz quem fez');
select is((select x ->> 'detalhe' from jsonb_array_elements(current_setting('testes.mov')::jsonb) x where x ->> 'tipo' = 'recibo'),
  'Marmita × 10', 'o recibo da empresa com os serviços');
select is(jsonb_array_length(public.hotel_movimento(current_setting('testes.empresa_a')::uuid,
  current_setting('testes.inicio')::timestamptz - interval '2 days', current_setting('testes.inicio')::timestamptz - interval '1 day')), 0,
  'fora do horário do turno não aparece nada');

-- Planilha dos serviços extras do dia: conta do quarto e empresa
select is((select string_agg((x ->> 'origem') || ':' || (x ->> 'quantidade')::numeric::int || 'x' || (x ->> 'servico') || '=' || (x ->> 'total'), ' | ' order by x ->> 'origem')
             from jsonb_array_elements(public.hotel_extras_periodo(current_setting('testes.empresa_a')::uuid,
                    current_setting('testes.hoje')::date, current_setting('testes.hoje')::date)) x),
  'empresa:10xMarmita=220.00 | hospede:2xMarmita=44.00', 'os extras do dia, na conta do quarto e para a empresa');
select throws_like(format($$select public.hotel_movimento(%L, now() - interval '30 days', now())$$, current_setting('testes.empresa_a')),
  '%Período inválido%', 'intervalo grande demais é recusado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_like(format($$select public.hotel_movimento(%L, now() - interval '1 day', now())$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'cliente de outra empresa não lê o movimento do hotel');
select throws_like(format($$select public.hotel_extras_periodo(%L, current_date, current_date)$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'nem a lista dos serviços extras');
reset role;

select * from finish();
rollback;
