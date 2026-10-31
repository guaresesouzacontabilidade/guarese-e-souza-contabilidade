-- Critérios: a recepção cadastra uma EMPRESA como hóspede (CNPJ válido), que
-- entra nos clientes do Financeiro; a reserva no nome dela fica faturada para
-- ela sozinha; o check-in é aceito sem saber quem vem, mas o check-out só fecha
-- com quem se hospedou informado (uma pessoa com CPF ou documento); a conta é
-- faturada para a empresa; cadastro com reservas não troca entre pessoa e
-- empresa; outra empresa não mexe.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);

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
reset role;

update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;

-- 1. Empresa como hóspede
select throws_like(format($$select public.hotel_hospede_salvar(%L, null, '{"tipo_pessoa": "PJ", "nome": "Construtora X", "cnpj": "11.222.333/0001-00"}')$$,
  current_setting('testes.empresa_a')), '%CNPJ inválido%', 'CNPJ inválido é recusado');
select set_config('testes.obra', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"tipo_pessoa": "PJ", "nome": "Construtora Rio Claro Ltda", "cnpj": "11.222.333/0001-81", "cpf": "529.982.247-25", "telefone": "63999990000"}')::text, true);
select is((select tipo_pessoa || '|' || cnpj || '|' || coalesce(cpf, '-') from public.hotel_hospedes where id = current_setting('testes.obra')::uuid),
  'PJ|11222333000181|-', 'a empresa fica com o CNPJ (sem CPF)');
reset role;
select is((select count(*)::int from public.contrapartes where empresa_id = current_setting('testes.empresa_a')::uuid and documento = '11222333000181' and 'cliente' = any(papeis)),
  1, 'a empresa entra nos clientes do Financeiro');

-- 2. Reserva no nome da empresa: faturada para ela sozinha
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.r1', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.obra'), 'quarto_id', current_setting('testes.q101'), 'adultos', 1,
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 1)::text)) ->> 'id'), true);
reset role;
select is((select c.documento from public.hotel_reservas r join public.contrapartes c on c.id = r.empresa_faturar_id where r.id = current_setting('testes.r1')::uuid),
  '11222333000181', 'a reserva da empresa fica faturada para ela');

-- 3. Check-in sem saber quem vem; check-out só com quem se hospedou
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select lives_ok(format($$select public.hotel_checkin(%L, '{}')$$, current_setting('testes.r1')), 'check-in da reserva da empresa sem o funcionário ainda');
select throws_like(format($$select public.hotel_checkout(%L)$$, current_setting('testes.r1')), '%informe quem se hospedou%',
  'check-out recusado sem quem se hospedou');
select throws_like(format($$select public.hotel_reserva_ocupante(%L, %L)$$, current_setting('testes.r1'), current_setting('testes.obra')),
  '%escolha o funcionário, não a empresa%', 'quem se hospeda não pode ser a própria empresa');
select set_config('testes.semdoc', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Sem Documento"}')::text, true);
select throws_like(format($$select public.hotel_reserva_ocupante(%L, %L)$$, current_setting('testes.r1'), current_setting('testes.semdoc')),
  '%CPF ou outro documento%', 'quem se hospedou precisa de CPF ou documento (ficha de registro)');
select set_config('testes.joao', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "João Pedreiro", "cpf": "529.982.247-25"}')::text, true);
select lives_ok(format($$select public.hotel_reserva_ocupante(%L, %L)$$, current_setting('testes.r1'), current_setting('testes.joao')),
  'a recepção informa o funcionário que se hospedou');
-- Conta faturada para a empresa (a empresa da reserva é a padrão) e check-out
select public.hotel_pagamento_registrar(current_setting('testes.r1')::uuid,
  jsonb_build_object('forma', 'faturado', 'valor', '200', 'vencimento', (current_setting('testes.hoje')::date + 10)::text));
select is((public.hotel_checkout(current_setting('testes.r1')::uuid) ->> 'saldo')::numeric, 0::numeric, 'check-out fecha com a conta faturada para a empresa');
reset role;
select is((select r.status || '|' || o.nome from public.hotel_reservas r join public.hotel_hospedes o on o.id = r.ocupante_id where r.id = current_setting('testes.r1')::uuid),
  'encerrada|João Pedreiro', 'a reserva guarda quem se hospedou pela empresa');

-- 4. Reserva de pessoa não tem "quem se hospedou"; cadastro com reserva não vira empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.r2', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.joao'), 'quarto_id', current_setting('testes.q102'), 'adultos', 1,
  'entrada', (current_setting('testes.hoje')::date + 2)::text, 'saida', (current_setting('testes.hoje')::date + 3)::text)) ->> 'id'), true);
select throws_like(format($$select public.hotel_reserva_ocupante(%L, %L)$$, current_setting('testes.r2'), current_setting('testes.joao')),
  '%no nome de uma pessoa%', 'reserva de pessoa não usa "quem se hospedou"');
select throws_like(format($$select public.hotel_hospede_salvar(%L, %L, '{"tipo_pessoa": "PJ", "nome": "João ME", "cnpj": "11.444.777/0001-61"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.joao')), '%não dá para trocar entre pessoa e empresa%',
  'cadastro com reservas não troca entre pessoa e empresa');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_like(format($$select public.hotel_reserva_ocupante(%L, %L)$$, current_setting('testes.r2'), current_setting('testes.joao')),
  '%Acesso negado%', 'outra empresa não mexe na reserva');
reset role;

select * from finish();
rollback;
