-- Critérios: o escritório liga a gestão na modalidade "veterinaria" (com as
-- contas do caixa, o catálogo de vacinas e os serviços iniciais); o
-- responsável cadastra o veterinário ligado ao próprio usuário (CRMV e
-- cadastro no MAPA); a recepção cadastra tutor e animal, agenda e cobra, mas
-- não registra atos clínicos; o veterinário abre, preenche e finaliza o
-- atendimento, que depois só recebe adendos (sem rasuras); a vacina aplicada
-- na clínica exige fabricante, partida, fabricação e validade, calcula a
-- próxima dose e aparece nos lembretes; a receita magistral controlada leva a
-- numeração do MAPA e a validade de 30 dias, a de antimicrobiano 10 dias, e
-- receita emitida não muda; o atestado de óbito registra o óbito; cada
-- pagamento vira lançamento no Financeiro e entra no caixa aberto; o e-mail
-- automático só vai a quem autorizou; cada empresa só vê a própria clínica e
-- ninguém grava direto nas tabelas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(39);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);

-- 1. Sem a modalidade, nada funciona
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.vet_tutor_salvar(%L, null, '{"nome": "Ana"}')$$, current_setting('testes.empresa_a')),
  '%não está ligada%', 'sem a gestão ligada não há clínica');
reset role;

-- 2. O escritório liga na modalidade clínica veterinária
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "veterinaria"}');
reset role;
select is((select nome from public.contas_financeiras c join public.gestao_config g on g.conta_dinheiro_id = c.id
            where g.empresa_id = current_setting('testes.empresa_a')::uuid), 'Caixa da clínica', 'clínica ligada com o caixa da clínica');
select ok((select count(*) >= 5 from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid), 'catálogo inicial de vacinas criado');
select ok(exists (select 1 from public.vet_config where empresa_id = current_setting('testes.empresa_a')::uuid and mensagem_vacina like '%{animal}%'),
  'configuração com a mensagem de lembrete padrão');

-- 3. O responsável (dono, que também é veterinário) se cadastra e ajusta os preços
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.vet', public.vet_veterinario_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Dra. Teste da Silva', 'crmv', '1234', 'crmv_uf', 'TO', 'cadastro_mapa', '998877', 'perfil_id', '00000000-0000-0000-0000-0000000000b1',
  'responsavel_tecnico', true))::text, true);
select throws_like(format($$select public.vet_veterinario_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('nome', 'Fulano', 'crmv', '55', 'crmv_uf', 'TO', 'perfil_id', '00000000-0000-0000-0000-0000000000c1')),
  '%acesso a esta empresa%', 'só usuário da própria empresa pode ser ligado ao veterinário');
select set_config('testes.consulta', public.vet_servico_salvar(current_setting('testes.empresa_a')::uuid,
  (select id from public.vet_servicos where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Consulta'),
  '{"nome": "Consulta", "categoria": "consulta", "preco": 150}')::text, true);
reset role;

-- 4. A recepção (só "vender") cadastra tutor e animal e agenda, mas não atende
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.vet_tutor_salvar(%L, null, '{"nome": "Ana", "cpf": "11111111111"}')$$, current_setting('testes.empresa_a')),
  '%CPF inválido%', 'CPF inválido é recusado');
select set_config('testes.tutor', public.vet_tutor_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Ana Tutora', 'cpf', '529.982.247-25', 'telefone', '(63) 99999-1234', 'email', 'ana@teste.local', 'logradouro', 'Rua A', 'numero', '10',
  'cidade', 'Palmas', 'uf', 'TO', 'aceita_email', true))::text, true);
select set_config('testes.rex', public.vet_paciente_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'tutor_id', current_setting('testes.tutor'), 'nome', 'Rex', 'especie', 'canina', 'raca', 'SRD', 'sexo', 'macho', 'microchip', '985112345678901'))::text, true);
select throws_like(format($$select public.vet_paciente_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'tutor_id', current_setting('testes.tutor'), 'nome', 'Bidu', 'especie', 'canina', 'microchip', '985112345678901')),
  '%microchip já está cadastrado%', 'microchip repetido é recusado');
select set_config('testes.agenda', public.vet_agenda_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'paciente_id', current_setting('testes.rex'), 'inicio', now() + interval '1 hour', 'tipo', 'consulta'))::text, true);
select throws_like(format($$select public.vet_atendimento_abrir(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('paciente_id', current_setting('testes.rex'))), '%Só o médico-veterinário%', 'a recepção não abre atendimento');
select throws_like(format($$select public.vet_vacinacao_registrar(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('paciente_id', current_setting('testes.rex'), 'vacina_nome', 'V10')), '%Só o médico-veterinário%', 'a recepção não registra vacina aplicada na clínica');
-- Vacina de carteira anterior (outra clínica) a recepção pode registrar
select ok(public.vet_vacinacao_registrar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'paciente_id', current_setting('testes.rex'), 'vacina_nome', 'Antirrábica', 'origem', 'externa', 'dose', 'unica',
  'aplicada_em', (current_setting('testes.hoje')::date - 400)::text, 'veterinario_externo', 'Clínica anterior')) is not null,
  'a recepção registra vacina de carteira anterior');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format($$insert into public.vet_tutores (empresa_id, nome) values (%L, 'Direto')$$, current_setting('testes.empresa_a')), '42501', null,
  'ninguém grava direto nas tabelas (sem permissão de escrita)');
reset role;

-- 5. A veterinária atende pelo agendamento, aplica a vacina e finaliza
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.atend', public.vet_atendimento_abrir(current_setting('testes.empresa_a')::uuid,
  jsonb_build_object('agendamento_id', current_setting('testes.agenda')))::text, true);
select is((select status from public.vet_agenda where id = current_setting('testes.agenda')::uuid), 'em_atendimento', 'o agendamento passa a "em atendimento"');
select throws_like(format($$select public.vet_atendimento_finalizar(%L)$$, current_setting('testes.atend')),
  '%Preencha o atendimento%', 'atendimento vazio não é finalizado');
select public.vet_atendimento_salvar(current_setting('testes.atend')::uuid, jsonb_build_object(
  'relato', 'Tutora relata coceira há 5 dias.', 'peso_kg', '12,5', 'temperatura', '38,6', 'diagnostico_presuntivo', 'Dermatite alérgica',
  'retorno_em', (current_setting('testes.hoje')::date + 15)::text, 'retorno_motivo', 'Reavaliar a pele'));
select is((select peso_kg from public.vet_pacientes where id = current_setting('testes.rex')::uuid), 12.5::numeric, 'o peso do atendimento vai para o cadastro');
select throws_like(format($$select public.vet_vacinacao_registrar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'atendimento_id', current_setting('testes.atend'), 'vacina_id', (select id from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid and nome like 'Polivalente canina%'),
  'dose', '1', 'partida', 'L123')), '%fabricante, a partida%', 'vacina da clínica exige fabricante, partida, fabricação e validade');
select throws_like(format($$select public.vet_vacinacao_registrar(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'atendimento_id', current_setting('testes.atend'), 'vacina_id', (select id from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid and nome like 'Polivalente canina%'),
  'dose', '1', 'fabricante', 'Lab X', 'partida', 'L123', 'fabricacao', (current_setting('testes.hoje')::date - 300)::text,
  'validade', (current_setting('testes.hoje')::date - 1)::text)), '%vencida%', 'vacina vencida não é aplicada');
select set_config('testes.vac', public.vet_vacinacao_registrar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'atendimento_id', current_setting('testes.atend'), 'vacina_id', (select id from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid and nome like 'Polivalente canina%'),
  'dose', '1', 'fabricante', 'Lab X', 'partida', 'L123', 'fabricacao', (current_setting('testes.hoje')::date - 60)::text,
  'validade', (current_setting('testes.hoje')::date + 300)::text))::text, true);
select is((select proxima_dose_em from public.vet_vacinacoes where id = current_setting('testes.vac')::uuid), current_setting('testes.hoje')::date + 21,
  '1ª dose do esquema de 3: próxima dose em 21 dias');
select public.vet_atendimento_finalizar(current_setting('testes.atend')::uuid);
select is((select status from public.vet_agenda where id = current_setting('testes.agenda')::uuid), 'concluido', 'finalizar conclui o agendamento');
select throws_like(format($$select public.vet_atendimento_salvar(%L, '{"relato": "mudei"}')$$, current_setting('testes.atend')),
  '%Registre um adendo%', 'atendimento finalizado não muda');
select ok(public.vet_adendo_registrar(current_setting('testes.atend')::uuid, 'Resultado do raspado de pele: negativo.') is not null, 'correção entra como adendo');
reset role;
-- Nem o processador apaga ou altera o prontuário finalizado
select throws_like(format($$update public.vet_atendimentos set relato = 'x' where id = %L$$, current_setting('testes.atend')), '%não pode ser alterado%',
  'nem direto no banco o prontuário finalizado muda');
select throws_like(format($$delete from public.vet_adendos where atendimento_id = %L$$, current_setting('testes.atend')), '%não pode ser alterado nem apagado%',
  'adendo não é apagado');

-- 6. Receitas
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.rec_mag', public.vet_receita_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'paciente_id', current_setting('testes.rex'), 'tipo', 'magistral_controlada', 'itens', jsonb_build_array(jsonb_build_object(
    'medicamento', 'Gabapentina', 'concentracao', '50 mg/mL', 'forma_farmaceutica', 'Suspensão oral', 'quantidade', '30 mL',
    'posologia', 'Dar 1 mL a cada 12 horas por 15 dias', 'via', 'oral'))))::text, true);
select ok((select numero_controle = '998877-0001-' || to_char(current_setting('testes.hoje')::date, 'YY') and validade = current_setting('testes.hoje')::date + 30
             from public.vet_receitas where id = current_setting('testes.rec_mag')::uuid),
  'magistral controlada: numeração com o cadastro no MAPA e validade de 30 dias');
select set_config('testes.rec_atb', public.vet_receita_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'paciente_id', current_setting('testes.rex'), 'tipo', 'antimicrobiano', 'itens', jsonb_build_array(jsonb_build_object(
    'medicamento', 'Amoxicilina', 'concentracao', '250 mg', 'quantidade', '20 comprimidos', 'posologia', '1 comprimido a cada 12 horas por 10 dias'))))::text, true);
select is((select validade from public.vet_receitas where id = current_setting('testes.rec_atb')::uuid), current_setting('testes.hoje')::date + 10,
  'antimicrobiano: validade de 10 dias');
select throws_like(format($$select public.vet_receita_emitir(%L, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'paciente_id', current_setting('testes.rex'), 'itens', jsonb_build_array(jsonb_build_object('medicamento', 'Dipirona')))),
  '%quantidade e a posologia%', 'item sem quantidade e posologia é recusado');
reset role;
select throws_like(format($$update public.vet_receitas set observacoes = 'alterada' where id = %L$$, current_setting('testes.rec_mag')),
  '%não pode ser alterada%', 'receita emitida não muda');

-- 7. Lembretes: o retorno e a próxima dose aparecem; o e-mail só vai a quem autorizou
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.vet_lembretes_pendentes(current_setting('testes.empresa_a')::uuid,
  current_setting('testes.hoje')::date + 30)) l where l ->> 'paciente_id' = current_setting('testes.rex')), 2,
  'lembretes: a próxima dose da vacina e o retorno (a antirrábica antiga ficou para trás)');
select ok(public.vet_aviso_registrar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'vacina', 'referencia_id', current_setting('testes.vac'), 'canal', 'whatsapp')) is not null, 'a recepção registra o aviso pelo WhatsApp');
reset role;
update public.vet_config set lembrete_email = true, lembrete_dias_antes = 30 where empresa_id = current_setting('testes.empresa_a')::uuid;
select is(app.vet_lembretes_email(), 2, 'rotina: e-mail da vacina e do retorno para a tutora que autorizou');
select is(app.vet_lembretes_email(), 0, 'sem e-mail repetido no dia seguinte');
select ok((select count(*) = 2 from public.envios where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'lembrete_veterinario'
             and destinatario = 'ana@teste.local' and conteudo like '%Rex%'), 'o e-mail traz o nome do animal');

-- 8. Conta, pagamento e caixa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Recepção', 50)::text, true);
select set_config('testes.conta', public.vet_conta_abrir(current_setting('testes.empresa_a')::uuid, jsonb_build_object('atendimento_id', current_setting('testes.atend')))::text, true);
select public.vet_conta_item_lancar(current_setting('testes.conta')::uuid, jsonb_build_object('servico_id', current_setting('testes.consulta')));
select public.vet_conta_item_lancar(current_setting('testes.conta')::uuid, jsonb_build_object('descricao', 'Vacina V10', 'valor_unitario', '90'));
select throws_like(format($$select public.vet_pagamento_registrar(%L, '{"forma": "dinheiro", "valor": 500}')$$, current_setting('testes.conta')),
  '%passa do que falta pagar%', 'não recebe mais do que o saldo');
select public.vet_pagamento_registrar(current_setting('testes.conta')::uuid, '{"forma": "dinheiro", "valor": 240}');
select public.vet_conta_fechar(current_setting('testes.conta')::uuid);
reset role;
select ok((select l.origem = 'veterinaria' and l.valor_previsto = 240 and exists (select 1 from public.baixas b where b.lancamento_id = l.id)
             from public.lancamentos l join public.vet_pagamentos p on p.lancamento_id = l.id where p.conta_id = current_setting('testes.conta')::uuid),
  'o pagamento vira lançamento recebido no Financeiro');
select is((app.caixa_resumo(current_setting('testes.caixa')::uuid) ->> 'dinheiro_esperado')::numeric, 290::numeric,
  'o dinheiro da clínica entra na conferência do caixa');

-- 9. Atestado de óbito registra o óbito e cancela a agenda futura
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.vet_agenda_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'paciente_id', current_setting('testes.rex'), 'inicio', now() + interval '10 days', 'tipo', 'retorno'));
select public.vet_documento_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'atestado_obito', 'paciente_id', current_setting('testes.rex'), 'dados', jsonb_build_object(
    'data_hora', now() - interval '1 hour', 'causa', 'Parada cardiorrespiratória', 'local', 'Clínica', 'cidade_uf', 'Palmas/TO',
    'destinacao', 'Cremação em empresa licenciada')));
reset role;
select ok((select obito_em is not null from public.vet_pacientes where id = current_setting('testes.rex')::uuid), 'o atestado de óbito registra o óbito no animal');
select is((select count(*)::int from public.vet_agenda where paciente_id = current_setting('testes.rex')::uuid and inicio > now() and status = 'cancelado'), 1,
  'a agenda futura do animal é cancelada');

-- 10. Cada empresa só vê a própria clínica
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.vet_pacientes), 0, 'cliente de outra empresa não vê os animais');
select is((select count(*)::int from public.vet_atendimentos), 0, 'nem o prontuário');
select throws_like(format($$select public.vet_paciente_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'tutor_id', current_setting('testes.tutor'), 'nome', 'Intruso', 'especie', 'felina')), '%Acesso negado%', 'nem cadastra na clínica dos outros');
reset role;

select * from finish();
rollback;
