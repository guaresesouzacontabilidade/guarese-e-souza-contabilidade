-- Critérios: o gerente cadastra os serviços extras (refeição/marmita, lavanderia,
-- aluguel de carro) com preço e unidade; a recepção lança na conta de quem está
-- hospedado a quantidade × o preço do cadastro (preço diferente só o gerente),
-- com a natureza separada para a contabilidade; a recepção atualiza as
-- observações do hóspede; o gerente escolhe o modelo, a cor e os dados dos
-- documentos do hotel; outra empresa não vê nem lança; ninguém grava direto.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);

-- Hotel com um quarto, uma hóspede hospedada e outra reserva só confirmada
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
select set_config('testes.maria', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Maria Silva", "cpf": "529.982.247-25"}')::text, true);
select set_config('testes.r1', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.maria'), 'quarto_id', current_setting('testes.q101'), 'adultos', 1,
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 2)::text)) ->> 'id'), true);
select public.hotel_checkin(current_setting('testes.r1')::uuid, '{}');
select set_config('testes.r2', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.maria'), 'quarto_id', current_setting('testes.q102'), 'adultos', 1,
  'entrada', (current_setting('testes.hoje')::date + 5)::text, 'saida', (current_setting('testes.hoje')::date + 6)::text)) ->> 'id'), true);

-- 1. O gerente cadastra os serviços extras
select set_config('testes.marmita', public.hotel_extra_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Marmita", "natureza": "alimentacao", "unidade": "marmita", "preco": "22"}')::text, true);
select set_config('testes.lav', public.hotel_extra_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Lavanderia (por peça)", "natureza": "lavanderia", "unidade": "peca", "preco": "12.50"}')::text, true);
select set_config('testes.carro', public.hotel_extra_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Aluguel de carro", "natureza": "locacao", "unidade": "dia", "preco": "180"}')::text, true);
select is((select count(*)::int from public.hotel_extras where empresa_id = current_setting('testes.empresa_a')::uuid), 3, 'três serviços extras cadastrados');
select throws_like(format($$select public.hotel_extra_salvar(%L, null, '{"nome": " marmita ", "natureza": "alimentacao", "unidade": "marmita", "preco": "20"}')$$,
  current_setting('testes.empresa_a')), '%Já existe o serviço%', 'nome repetido é recusado');
select throws_like(format($$select public.hotel_extra_salvar(%L, null, '{"nome": "Passeio", "natureza": "turismo", "unidade": "uso", "preco": "50"}')$$,
  current_setting('testes.empresa_a')), '%tipo do serviço%', 'natureza fora da lista é recusada');
select throws_like(format($$select public.hotel_extra_salvar(%L, null, '{"nome": "Passeio", "natureza": "outro", "unidade": "uso", "preco": "-1"}')$$,
  current_setting('testes.empresa_a')), '%preço%', 'preço negativo é recusado');
reset role;

-- 2. A recepção (só "Vender no caixa") não cadastra, mas lança na conta
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.hotel_extra_salvar(%L, null, '{"nome": "Passeio", "natureza": "outro", "unidade": "uso", "preco": "50"}')$$,
  current_setting('testes.empresa_a')), '%Acesso negado%', 'a recepção não cadastra serviço extra');
select is(public.hotel_extras_lancar(current_setting('testes.r1')::uuid, jsonb_build_object('itens', jsonb_build_array(
  jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 3),
  jsonb_build_object('extra_id', current_setting('testes.lav'), 'quantidade', 5),
  jsonb_build_object('extra_id', current_setting('testes.carro'), 'quantidade', 2)))), 3, 'a recepção lança três serviços');
select is((select string_agg(setor || ':' || quantidade::numeric(10,0) || 'x' || valor_unitario || '=' || total, ' | ' order by total)
             from public.hotel_conta_itens where reserva_id = current_setting('testes.r1')::uuid and extra_id is not null),
  'lavanderia:5x12.50=62.50 | alimentacao:3x22.00=66.00 | locacao:2x180.00=360.00', 'quantidade × preço, com a natureza de cada serviço');
select ok((select bool_and(tipo = 'servico') from public.hotel_conta_itens where extra_id is not null), 'entram como serviço (sem taxa de serviço do consumo)');
select is((public.hotel_conta_resumo(current_setting('testes.r1')::uuid) ->> 'servicos')::numeric, 488.50::numeric, 'os extras somam na conta do hóspede');
select throws_like(format($$select public.hotel_extras_lancar(%L, %L)$$, current_setting('testes.r1'),
  jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1, 'valor_unitario', '15')))),
  '%Só o gerente%', 'a recepção não muda o preço do cadastro');
select throws_like(format($$select public.hotel_extras_lancar(%L, %L)$$, current_setting('testes.r1'),
  jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 0)))),
  '%Quantidade inválida%', 'quantidade zero é recusada');
select throws_like(format($$select public.hotel_extras_lancar(%L, %L)$$, current_setting('testes.r2'),
  jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  '%quem está hospedado%', 'só na conta de quem está hospedado');
select throws_like(format($$select public.hotel_extras_lancar(%L, %L)$$, current_setting('testes.r1'),
  jsonb_build_object('data', (current_setting('testes.hoje')::date - 3)::text,
    'itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  '%dentro da hospedagem%', 'a data precisa estar dentro da hospedagem');

-- 3. Observações sobre o hóspede: a recepção atualiza
select lives_ok(format($$select public.hotel_hospede_observacoes(%L, 'Prefere quarto no térreo. Alergia a camarão.')$$, current_setting('testes.maria')),
  'a recepção registra as observações do hóspede');
select throws_like(format($$select public.hotel_hospede_observacoes(%L, %L)$$, current_setting('testes.maria'), repeat('x', 1001)),
  '%até 1.000%', 'observações com mais de 1.000 letras são recusadas');
select throws_like(format($$select public.hotel_documentos_configurar(%L, '{"modelo": "faixa"}')$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'a recepção não muda os documentos do hotel');
reset role;
select is((select observacoes from public.hotel_hospedes where id = current_setting('testes.maria')::uuid),
  'Prefere quarto no térreo. Alergia a camarão.', 'observações gravadas no cadastro');

-- 4. O gerente lança com outro preço e configura os documentos
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.hotel_extras_lancar(current_setting('testes.r1')::uuid, jsonb_build_object('itens', jsonb_build_array(
  jsonb_build_object('extra_id', current_setting('testes.carro'), 'quantidade', 1, 'valor_unitario', '150')))), 1, 'o gerente lança com preço combinado');
select public.hotel_documentos_configurar(current_setting('testes.empresa_a')::uuid,
  '{"modelo": "faixa", "cor": "#1F6F4A", "nome": "Hotel Teste", "whatsapp": "(63) 99999-0000", "cadastur": "12.345678.10.0001-1"}');
select throws_like(format($$select public.hotel_documentos_configurar(%L, '{"modelo": "neon"}')$$, current_setting('testes.empresa_a')),
  '%modelo%', 'modelo fora da lista é recusado');
select throws_like(format($$select public.hotel_documentos_configurar(%L, '{"cor": "verde"}')$$, current_setting('testes.empresa_a')),
  '%Cor inválida%', 'cor fora do padrão é recusada');
reset role;
select is((select doc_modelo || ' ' || doc_cor || ' ' || doc_nome || ' ' || doc_cadastur from public.hotel_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'faixa #1f6f4a Hotel Teste 12.345678.10.0001-1', 'modelo, cor e dados dos documentos gravados');

-- 5. Outra empresa não vê nem lança; ninguém grava direto
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.hotel_extras), 0, 'outra empresa não vê os serviços extras');
select throws_ok(format($$select public.hotel_extras_lancar(%L, %L)$$, current_setting('testes.r1'),
  jsonb_build_object('itens', jsonb_build_array(jsonb_build_object('extra_id', current_setting('testes.marmita'), 'quantidade', 1)))),
  null, 'outra empresa não lança na conta');
select throws_like(format($$insert into public.hotel_extras (empresa_id, nome, natureza, unidade, preco) values (%L, 'X', 'outro', 'uso', 1)$$,
  current_setting('testes.empresa_a')), '%permission denied%', 'ninguém grava direto no cadastro de serviços');
reset role;

select * from finish();
rollback;
