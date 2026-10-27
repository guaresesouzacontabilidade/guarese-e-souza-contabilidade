-- Critérios: o escritório liga a gestão na modalidade "hotel" (com as contas
-- da recepção); o gerente cadastra categorias, quartos e tarifas; a reserva
-- calcula as diárias pela tabela e pelas tarifas do período e não deixa o
-- mesmo quarto em duas reservas nas mesmas noites nem passar da capacidade;
-- o check-in exige o quarto liberado pela governança e o documento do
-- hóspede; o consumo baixa o estoque; a taxa de serviço incide só sobre o
-- consumo; o desconto é do gerente; cada pagamento vira lançamento recebido
-- no Financeiro e entra no caixa aberto; o check-out lança as diárias, exige a
-- conta fechada e manda o quarto para a limpeza; cada empresa só vê o próprio
-- hotel e ninguém grava direto nas tabelas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(41);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);
insert into public.nfe_produtos (id, empresa_id, codigo, descricao, ncm, unidade, valor_unitario, controla_estoque, estoque_atual)
values ('0d000000-0000-0000-0000-0000000000e1', current_setting('testes.empresa_a')::uuid, 'AGUA', 'Água mineral 500 ml', '22011000', 'UN', 5, true, 10);

-- 1. Sem a modalidade hotel, nada funciona
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.hotel_categoria_salvar(%L, null, '{"nome": "Standard", "diaria": 200}')$$, current_setting('testes.empresa_a')),
  '%não está ligada%', 'sem a gestão ligada não há hotel');
reset role;

-- 2. O escritório liga na modalidade hotel
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "hotel"}');
reset role;
select ok((select g.ativa and g.modalidade = 'hotel' and g.conta_dinheiro_id is not null and g.conta_pix_id is not null and g.conta_cartao_id is not null
             from public.gestao_config g where g.empresa_id = current_setting('testes.empresa_a')::uuid),
  'hotel ligado com as contas do caixa, do banco e da maquininha');
select is((select nome from public.contas_financeiras c join public.gestao_config g on g.conta_dinheiro_id = c.id
            where g.empresa_id = current_setting('testes.empresa_a')::uuid), 'Caixa da recepção', 'a conta do dinheiro é o caixa da recepção');
select ok(exists (select 1 from public.hotel_config where empresa_id = current_setting('testes.empresa_a')::uuid), 'configuração do hotel criada');

-- 3. O gerente (dono) cadastra categorias, quartos e uma tarifa
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.std', public.hotel_categoria_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Standard", "diaria": 200, "capacidade": 3, "pessoas_incluidas": 2, "adicional_pessoa": 50}')::text, true);
select set_config('testes.luxo', public.hotel_categoria_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Luxo", "diaria": 300, "capacidade": 2}')::text, true);
select set_config('testes.q101', public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '101', 'categoria_id', current_setting('testes.std')))::text, true);
select set_config('testes.q102', public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '102', 'categoria_id', current_setting('testes.std')))::text, true);
select set_config('testes.q201', public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '201', 'categoria_id', current_setting('testes.luxo')))::text, true);
select throws_like(format($$select public.hotel_quarto_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('numero', '101', 'categoria_id', current_setting('testes.luxo'))), '%Já existe o quarto 101%', 'número de quarto repetido é recusado');
select public.hotel_tarifa_salvar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'categoria_id', current_setting('testes.std'), 'nome', 'Feriado', 'inicio', (current_setting('testes.hoje')::date + 1)::text,
  'fim', (current_setting('testes.hoje')::date + 1)::text, 'diaria', 260));
reset role;

-- 4. O colaborador sem a permissão da gestão não opera o hotel
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.hotel_hospede_salvar(%L, null, '{"nome": "Fulano"}')$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'colaborador sem permissão não cadastra hóspede');
reset role;

-- 5. Hóspedes
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.hotel_hospede_salvar(%L, null, '{"nome": "Maria Silva", "cpf": "123.456.789-00"}')$$, current_setting('testes.empresa_a')),
  '%CPF inválido%', 'CPF inválido é recusado');
select set_config('testes.maria', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Maria Silva", "cpf": "529.982.247-25", "telefone": "(63) 99999-0000", "cidade": "Palmas", "uf": "to"}')::text, true);
select set_config('testes.joao', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "João Sem Documento"}')::text, true);
select is(public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Maria S. Silva", "cpf": "52998224725"}')::text,
  current_setting('testes.maria'), 'o mesmo CPF atualiza o cadastro existente (sem duplicar)');
reset role;
select is((select (nome, telefone, uf)::text from public.hotel_hospedes where id = current_setting('testes.maria')::uuid),
  '("Maria S. Silva",,)', 'o cadastro guarda o que veio no último salvamento');

-- 6. Reservas: diárias pela tabela e pela tarifa do período; sem sobreposição; capacidade
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.r1', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.maria'), 'quarto_id', current_setting('testes.q101'), 'adultos', 3,
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 3)::text, 'origem', 'whatsapp')) ->> 'id'), true);
select throws_like(format($$select public.hotel_reserva_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'hospede_id', current_setting('testes.joao'), 'quarto_id', current_setting('testes.q101'),
  'entrada', (current_setting('testes.hoje')::date + 2)::text, 'saida', (current_setting('testes.hoje')::date + 4)::text)),
  '%quarto 101 já está reservado%', 'o mesmo quarto não fica em duas reservas nas mesmas noites');
select throws_like(format($$select public.hotel_reserva_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'hospede_id', current_setting('testes.joao'), 'quarto_id', current_setting('testes.q201'), 'adultos', 2, 'criancas', 1,
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 1)::text)),
  '%comporta até 2%', 'a capacidade do quarto é respeitada');
select set_config('testes.r2', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.joao'), 'quarto_id', current_setting('testes.q101'),
  'entrada', (current_setting('testes.hoje')::date + 3)::text, 'saida', (current_setting('testes.hoje')::date + 5)::text)) ->> 'id'), true);
select set_config('testes.r3', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.joao'), 'quarto_id', current_setting('testes.q102'),
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 1)::text)) ->> 'id'), true);
reset role;
select is((select valor_previsto from public.hotel_reservas where id = current_setting('testes.r1')::uuid), 810.00::numeric(12,2),
  '3 noites para 3 adultos: (200 + 50) + (260 + 50) + (200 + 50) = 810');
select is((select array_agg(numero order by numero) from public.hotel_reservas where empresa_id = current_setting('testes.empresa_a')::uuid),
  array[1, 2, 3]::bigint[], 'reservas numeradas em sequência; a saída de uma pode ser a entrada da outra');

-- 7. Check-in: governança e documento
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.hotel_quarto_limpeza(current_setting('testes.q101')::uuid, 'sujo', null);
select throws_like(format($$select public.hotel_checkin(%L, '{}')$$, current_setting('testes.r1')), '%não foi liberado pela governança%',
  'quarto sujo não recebe check-in');
select public.hotel_quarto_limpeza(current_setting('testes.q101')::uuid, 'limpo', null);
select lives_ok(format($$select public.hotel_checkin(%L, '{"motivo_viagem": "negocios", "meio_transporte": "automovel", "placa_veiculo": "abc-1d23"}')$$,
  current_setting('testes.r1')), 'check-in no quarto limpo');
select throws_like(format($$select public.hotel_checkin(%L, '{}')$$, current_setting('testes.r3')), '%CPF ou outro documento%',
  'sem documento do hóspede não há check-in (ficha de registro)');
select throws_like(format($$select public.hotel_quarto_limpeza(%L, 'manutencao', 'Ar-condicionado')$$, current_setting('testes.q101')), '%está ocupado%',
  'quarto ocupado não vai para manutenção');
reset role;
select is((select (status, placa_veiculo, motivo_viagem)::text from public.hotel_reservas where id = current_setting('testes.r1')::uuid),
  '(hospedado,ABC1D23,negocios)', 'hospedado com os dados da ficha (placa limpa)');

-- 8. Consumo, taxa de serviço e desconto
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.hotel_configurar(current_setting('testes.empresa_a')::uuid, '{"taxa_servico": "10"}');
select public.hotel_consumo_lancar(current_setting('testes.r1')::uuid, '{"setor": "frigobar", "itens": [{"produto_id": "0d000000-0000-0000-0000-0000000000e1", "quantidade": 2}]}');
select throws_like(format($$select public.hotel_consumo_lancar(%L, '{"itens": [{"produto_id": "0d000000-0000-0000-0000-0000000000e1", "quantidade": 1}]}')$$,
  current_setting('testes.r2')), '%de quem está hospedado%', 'consumo só na conta de quem está hospedado');
select public.hotel_servico_lancar(current_setting('testes.r1')::uuid, '{"tipo": "desconto", "descricao": "Cortesia da casa", "valor": "20"}');
reset role;
select is((select estoque_atual from public.nfe_produtos where id = '0d000000-0000-0000-0000-0000000000e1'), 8.0000::numeric(18,4),
  'o consumo baixa o estoque');
select is((select tipo from public.estoque_movimentos where produto_id = '0d000000-0000-0000-0000-0000000000e1' order by created_at desc limit 1),
  'consumo_hotel', 'movimento de estoque do consumo do hotel');

-- 9. O colaborador com a permissão de vender (recepção) não dá desconto
reset role;
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.hotel_servico_lancar(%L, '{"tipo": "desconto", "descricao": "Desconto", "valor": "10"}')$$,
  current_setting('testes.r1')), '%Acesso negado%', 'a recepção não dá desconto');
select lives_ok(format($$select public.hotel_servico_lancar(%L, '{"tipo": "servico", "descricao": "Lavanderia", "valor": "30"}')$$,
  current_setting('testes.r1')), 'a recepção lança serviço na conta');
reset role;

-- 10. Resumo da conta (saindo hoje: uma noite)
select is((select (r ->> 'diarias')::numeric || '|' || (r ->> 'consumo')::numeric || '|' || (r ->> 'taxa_servico')::numeric || '|' || (r ->> 'saldo')::numeric
             from (select app.hotel_resumo(current_setting('testes.r1')::uuid) r) x),
  '250.00|10.00|1.00|271.00', 'saindo hoje: 1 diária (250) + consumo (10) + taxa de 10% do consumo (1) + lavanderia (30) − desconto (20) = 271');

-- 11. Pagamentos no Financeiro e no caixa
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Recepção', 100)::text, true);
select public.hotel_pagamento_registrar(current_setting('testes.r1')::uuid, '{"forma": "pix", "valor": "100"}');
select throws_like(format($$select public.hotel_checkout(%L)$$, current_setting('testes.r1')), '%Falta receber R$ 171,00%',
  'o check-out exige a conta fechada');
select public.hotel_pagamento_registrar(current_setting('testes.r1')::uuid, '{"forma": "dinheiro", "valor": "171"}');
select lives_ok(format($$select public.hotel_checkout(%L)$$, current_setting('testes.r1')), 'check-out com a conta fechada');
reset role;
select is((select sum(valor_previsto) from public.lancamentos where origem = 'hotel' and origem_referencia = current_setting('testes.r1')),
  271.00::numeric, 'os pagamentos viraram lançamentos a receber do hotel');
select ok((select bool_and(l.situacao = 'quitado') and bool_and(c.codigo_sistema = 'SERVICOS')
             from public.lancamentos l join public.categorias_financeiras c on c.id = l.categoria_id
            where l.origem = 'hotel' and l.origem_referencia = current_setting('testes.r1')),
  'recebidos na hora, na categoria Prestação de serviços');
select is((select ((r ->> 'hotel_total')::numeric, (r ->> 'dinheiro_esperado')::numeric)::text
             from (select app.caixa_resumo(current_setting('testes.caixa')::uuid) r) x),
  '(271.00,271.00)', 'os recebimentos entram no caixa aberto; o dinheiro esperado soma o recebido em dinheiro');
select is((select (status, saida = current_setting('testes.hoje')::date + 1)::text from public.hotel_reservas where id = current_setting('testes.r1')::uuid),
  '(encerrada,t)', 'encerrada, com a saída na data real');
select is((select count(*)::int from public.hotel_conta_itens where reserva_id = current_setting('testes.r1')::uuid and tipo in ('diaria', 'taxa_servico')),
  2, 'o check-out lançou a diária e a taxa de serviço');
select is((select limpeza from public.hotel_quartos where id = current_setting('testes.q101')::uuid), 'sujo', 'o quarto vai para a limpeza');

-- 12. Conta fechada não muda
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.hotel_pagamento_estornar(%L, 'teste')$$,
  (select id from public.hotel_pagamentos where reserva_id = current_setting('testes.r1')::uuid limit 1)), '%já foi fechada%', 'pagamento de conta fechada não é estornado');

-- 13. Sinal da reserva futura, estorno e cancelamento
select set_config('testes.sinal', public.hotel_pagamento_registrar(current_setting('testes.r2')::uuid, '{"forma": "cartao_credito", "valor": "150"}')::text, true);
select public.hotel_pagamento_estornar(current_setting('testes.sinal')::uuid, 'Cliente desistiu');
select throws_like(format($$select public.hotel_reserva_cancelar(%L, 'Teste', true)$$, current_setting('testes.r2')), '%a partir do dia da entrada%',
  'no-show só a partir do dia da entrada');
select public.hotel_reserva_cancelar(current_setting('testes.r2')::uuid, 'Cliente desistiu', false);
reset role;
select ok((select p.adiantamento and p.cancelado_em is not null and l.situacao = 'cancelado'
             from public.hotel_pagamentos p join public.lancamentos l on l.id = p.lancamento_id where p.id = current_setting('testes.sinal')::uuid),
  'o sinal estornado cancela o lançamento no Financeiro');
select is((select status from public.hotel_reservas where id = current_setting('testes.r2')::uuid), 'cancelada', 'reserva cancelada');

-- 14. Isolamento: cada empresa só vê o próprio hotel; ninguém grava direto
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.hotel_reservas), 0, 'cliente de outra empresa não vê as reservas');
select is((select count(*)::int from public.hotel_hospedes), 0, 'cliente de outra empresa não vê os hóspedes');
select throws_like(format($$select public.hotel_reserva_cancelar(%L, 'invasão', false)$$, current_setting('testes.r3')), '%Acesso negado%',
  'cliente de outra empresa não mexe nas reservas');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$insert into public.hotel_hospedes (empresa_id, nome) values (%L, 'Direto')$$, current_setting('testes.empresa_a')),
  '%permission denied%', 'ninguém grava direto na tabela de hóspedes');
select throws_like(format($$update public.hotel_reservas set status = 'encerrada' where id = %L$$, current_setting('testes.r3')),
  '%permission denied%', 'ninguém muda a reserva direto na tabela');
reset role;

select * from finish();
rollback;
