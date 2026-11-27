-- Critérios: o escritório liga a gestão na modalidade "fisioterapia" (com o
-- caixa da clínica e a configuração padrão); o responsável cadastra o
-- fisioterapeuta ligado ao próprio usuário (CREFITO); a recepção cadastra o
-- paciente, o pacote e a agenda com repetição semanal (sem choque de horário),
-- mas não abre nem lê o prontuário; o fisioterapeuta avalia (não finaliza sem
-- queixa, diagnóstico e plano terapêutico), evolui a sessão (que vira
-- "realizada" e conta no pacote) e depois só registra adendos; a alta cancela
-- os próximos horários; o recebimento vira lançamento no Financeiro; o
-- repasse do mês conta as sessões; o escritório e outra empresa não leem o
-- prontuário; ninguém grava direto nas tabelas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(35);

\ir 00_setup.sql.inc

-- Próxima segunda-feira às 08:00 (fuso da clínica)
select set_config('testes.segunda', ((date_trunc('week', (now() at time zone 'America/Araguaina')::date + 7)::date + time '08:00') at time zone 'America/Araguaina')::text, true);

-- 1. Sem a modalidade, nada funciona
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.fisio_paciente_salvar(%L, null, '{"nome": "Ana Paciente"}')$$, current_setting('testes.empresa_a')),
  '%não está ligada%', 'sem a gestão ligada não há clínica de fisioterapia');
reset role;

-- 2. O escritório liga na modalidade clínica de fisioterapia
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "fisioterapia"}');
reset role;
select is((select nome from public.contas_financeiras c join public.gestao_config g on g.conta_dinheiro_id = c.id
            where g.empresa_id = current_setting('testes.empresa_a')::uuid), 'Caixa da clínica', 'clínica ligada com o caixa da clínica');
select ok(exists (select 1 from public.fisio_config where empresa_id = current_setting('testes.empresa_a')::uuid and mensagem_confirmacao like '%{paciente}%'),
  'configuração com a mensagem de confirmação padrão');

-- 3. O responsável (dono, que também é fisioterapeuta) se cadastra
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.fisio_profissional_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('nome', 'Dra. Fisio', 'crefito', '', 'crefito_regiao', 11)), '%CREFITO%', 'CREFITO é obrigatório');
select set_config('testes.prof', public.fisio_profissional_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Dra. Fisio Teste', 'crefito', '123456-f', 'crefito_regiao', 11, 'perfil_id', '00000000-0000-0000-0000-0000000000b1',
  'repasse_percentual', '40', 'responsavel_tecnico', true))::text, true);
select is((select crefito from public.fisio_profissionais where id = current_setting('testes.prof')::uuid), '123456-F', 'CREFITO guardado em maiúsculas');
select throws_like(format($$select public.fisio_profissional_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('nome', 'Fulano', 'crefito', '55', 'crefito_regiao', 11, 'perfil_id', '00000000-0000-0000-0000-0000000000c1')),
  '%acesso a esta empresa%', 'só usuário da própria empresa pode ser ligado ao fisioterapeuta');
select public.fisio_configurar(current_setting('testes.empresa_a')::uuid, '{"nome_clinica": "Clínica Teste", "valor_sessao": "100", "duracao_padrao_min": 50}');
reset role;

-- 4. A recepção (só "vender") cadastra paciente, pacote e agenda, mas não abre o prontuário
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.fisio_paciente_salvar(%L, null, '{"nome": "Ana Paciente", "cpf": "11111111111"}')$$, current_setting('testes.empresa_a')),
  '%CPF inválido%', 'CPF inválido é recusado');
select set_config('testes.pac', public.fisio_paciente_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Ana Paciente', 'cpf', '529.982.247-25', 'nascimento', '1980-05-10', 'telefone', '(63) 99999-1234', 'profissao', 'Professora',
  'consentimento', true))::text, true);
select ok((select consentimento_em is not null from public.fisio_pacientes where id = current_setting('testes.pac')::uuid), 'consentimento LGPD registrado com data');
select set_config('testes.pacote', public.fisio_pacote_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'paciente_id', current_setting('testes.pac'), 'sessoes', 10, 'valor_total', '800,00', 'convenio', 'Particular'))::text, true);
-- Avaliação na segunda às 08:00 e sessões seg/qua/sex às 09:00 por 2 semanas
select is(public.fisio_agenda_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'paciente_id', current_setting('testes.pac'), 'profissional_id', current_setting('testes.prof'), 'tipo', 'avaliacao',
  'inicio', current_setting('testes.segunda'))), 1, 'avaliação agendada');
select is(public.fisio_agenda_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'paciente_id', current_setting('testes.pac'), 'profissional_id', current_setting('testes.prof'), 'tipo', 'sessao',
  'inicio', (current_setting('testes.segunda')::timestamptz + interval '1 hour'), 'dias_semana', jsonb_build_array(1, 3, 5), 'semanas', 2)), 6,
  'seg, qua e sex por 2 semanas: 6 sessões');
select is((select count(*)::int from public.fisio_agenda where paciente_id = current_setting('testes.pac')::uuid and pacote_id = current_setting('testes.pacote')::uuid),
  6, 'as sessões entram no pacote ativo do paciente');
select is((select count(distinct serie_id)::int from public.fisio_agenda where paciente_id = current_setting('testes.pac')::uuid and tipo = 'sessao'),
  1, 'as sessões repetidas formam uma série');
select throws_like(format($$select public.fisio_agenda_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'nome_avulso', 'Outro Paciente', 'profissional_id', current_setting('testes.prof'), 'inicio', (current_setting('testes.segunda')::timestamptz + interval '1 hour 20 minutes'))),
  '%já tem horário%', 'choque de horário do fisioterapeuta é recusado');
select throws_like(format($$select public.fisio_avaliacao_abrir(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('paciente_id', current_setting('testes.pac'))), '%Só o fisioterapeuta%', 'a recepção não abre avaliação');
select throws_like(format($$select public.fisio_evolucao_abrir(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('paciente_id', current_setting('testes.pac'))), '%Só o fisioterapeuta%', 'a recepção não abre evolução');
select throws_ok(format($$insert into public.fisio_pacientes (empresa_id, nome) values (%L, 'Direto')$$, current_setting('testes.empresa_a')), '42501', null,
  'ninguém grava direto nas tabelas');
reset role;

-- 5. A fisioterapeuta avalia pelo agendamento
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.ag_av', (select id::text from public.fisio_agenda where paciente_id = current_setting('testes.pac')::uuid and tipo = 'avaliacao'), true);
select set_config('testes.av', public.fisio_avaliacao_abrir(current_setting('testes.empresa_a')::uuid, jsonb_build_object('agendamento_id', current_setting('testes.ag_av')))::text, true);
select is(public.fisio_avaliacao_abrir(current_setting('testes.empresa_a')::uuid, jsonb_build_object('agendamento_id', current_setting('testes.ag_av'))),
  current_setting('testes.av')::uuid, 'abrir de novo pelo agendamento volta para a mesma avaliação');
select throws_like(format($$select public.fisio_avaliacao_finalizar(%L)$$, current_setting('testes.av')), '%queixa principal%',
  'não finaliza sem a queixa principal');
select public.fisio_avaliacao_salvar(current_setting('testes.av')::uuid, jsonb_build_object(
  'queixa_principal', 'Dor lombar há 3 meses', 'dor_eva', 7, 'exame_fisico', 'Contratura paravertebral', 'cid', 'm54.5',
  'diagnostico', 'Disfunção cinético-funcional da coluna lombar', 'prognostico', 'Bom'));
select throws_like(format($$select public.fisio_avaliacao_finalizar(%L)$$, current_setting('testes.av')), '%plano terapêutico%',
  'não finaliza sem o plano terapêutico');
select throws_like(format($$select public.fisio_avaliacao_salvar(%L, '{"dor_eva": 12}')$$, current_setting('testes.av')), '%0 a 10%', 'dor só de 0 a 10');
select public.fisio_avaliacao_salvar(current_setting('testes.av')::uuid, jsonb_build_object(
  'queixa_principal', 'Dor lombar há 3 meses', 'dor_eva', 7, 'exame_fisico', 'Contratura paravertebral', 'cid', 'm54.5',
  'diagnostico', 'Disfunção cinético-funcional da coluna lombar', 'prognostico', 'Bom',
  'objetivos', 'Reduzir a dor e ganhar mobilidade', 'condutas', 'Cinesioterapia, terapia manual, TENS', 'frequencia_semanal', 3, 'sessoes_previstas', 10));
select public.fisio_avaliacao_finalizar(current_setting('testes.av')::uuid);
select is((select cid from public.fisio_avaliacoes where id = current_setting('testes.av')::uuid), 'M54.5', 'CID do pedido médico guardada');
select is((select status from public.fisio_agenda where id = current_setting('testes.ag_av')::uuid), 'realizado', 'avaliação finalizada marca o horário como realizado');
select throws_like(format($$select public.fisio_avaliacao_salvar(%L, '{"queixa_principal": "Mudou"}')$$, current_setting('testes.av')),
  '%finalizado%', 'avaliação finalizada não muda');
select ok(public.fisio_adendo_registrar('avaliacao', current_setting('testes.av')::uuid, 'Paciente trouxe ressonância: protrusão L4-L5.') is not null,
  'correção entra como adendo');

-- 6. Evolução da primeira sessão (SOAP, dor antes e depois)
select set_config('testes.ag1', (select id::text from public.fisio_agenda where paciente_id = current_setting('testes.pac')::uuid and tipo = 'sessao' order by inicio limit 1), true);
select set_config('testes.ev', public.fisio_evolucao_abrir(current_setting('testes.empresa_a')::uuid, jsonb_build_object('agendamento_id', current_setting('testes.ag1')))::text, true);
select throws_like(format($$select public.fisio_evolucao_finalizar(%L)$$, current_setting('testes.ev')), '%Escreva a evolução%', 'evolução vazia não finaliza');
select public.fisio_evolucao_salvar(current_setting('testes.ev')::uuid, jsonb_build_object(
  'subjetivo', 'Relata melhora ao acordar', 'objetivo', 'Flexão lombar 60°', 'analise', 'Evolução favorável', 'plano', 'Manter conduta',
  'condutas', jsonb_build_array('Cinesioterapia', 'TENS', 'TENS'), 'dor_antes', 6, 'dor_depois', 3));
select public.fisio_evolucao_finalizar(current_setting('testes.ev')::uuid);
select is((select condutas from public.fisio_evolucoes where id = current_setting('testes.ev')::uuid), array['Cinesioterapia', 'TENS'], 'recursos da sessão sem repetição');
select is((select usadas from public.fisio_pacotes_resumo(current_setting('testes.empresa_a')::uuid, current_setting('testes.pac')::uuid)), 1,
  'a sessão realizada conta no pacote');
reset role;

-- 7. A recepção não lê o prontuário; vê a agenda e o pacote
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.fisio_avaliacoes), 0, 'a recepção não lê avaliações');
select is((select count(*)::int from public.fisio_evolucoes), 0, 'a recepção não lê evoluções');
select is((select count(*)::int from public.fisio_agenda where paciente_id = current_setting('testes.pac')::uuid), 7, 'a recepção vê a agenda');
-- Recebimento do pacote vira lançamento no Financeiro
select set_config('testes.rec', public.fisio_recebimento_registrar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'paciente_id', current_setting('testes.pac'), 'pacote_id', current_setting('testes.pacote'), 'forma', 'pix', 'valor', '400,00'))::text, true);
reset role;
select ok(exists (select 1 from public.lancamentos l join public.fisio_recebimentos r on r.lancamento_id = l.id
                  where r.id = current_setting('testes.rec')::uuid and l.origem = 'fisioterapia' and l.valor_previsto = 400),
  'recebimento vira lançamento no Financeiro');

-- 8. O escritório e a outra empresa não leem o prontuário
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from public.fisio_avaliacoes) + (select count(*)::int from public.fisio_evolucoes) + (select count(*)::int from public.fisio_adendos),
  0, 'o administrador do escritório não lê o prontuário');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.fisio_pacientes) + (select count(*)::int from public.fisio_agenda), 0, 'outra empresa não vê a clínica');
reset role;

-- 9. Repasse do mês e alta
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select sessoes || '/' || avaliacoes || '/' || valor_sessoes || '/' || repasse
             from public.fisio_repasse(current_setting('testes.empresa_a')::uuid, (current_setting('testes.segunda')::timestamptz at time zone 'America/Araguaina')::date)),
  '1/1/180.00/72.00', 'repasse: 1 sessão do pacote (80) + avaliação avulsa (100), 40%');
select set_config('testes.alta', public.fisio_evolucao_abrir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'paciente_id', current_setting('testes.pac'), 'tipo', 'alta'))::text, true);
select public.fisio_evolucao_salvar(current_setting('testes.alta')::uuid, jsonb_build_object(
  'analise', 'Objetivos alcançados: sem dor e mobilidade completa', 'alta_motivo', 'objetivos_alcancados'));
select public.fisio_evolucao_finalizar(current_setting('testes.alta')::uuid);
select is((select count(*)::int from public.fisio_agenda where paciente_id = current_setting('testes.pac')::uuid and status = 'cancelado' and motivo = 'Alta do paciente'),
  5, 'a alta cancela os próximos horários');
reset role;

select * from finish();
rollback;
