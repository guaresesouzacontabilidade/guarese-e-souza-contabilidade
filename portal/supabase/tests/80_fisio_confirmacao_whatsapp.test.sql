-- Critérios: a confirmação pelo WhatsApp fica desligada até a clínica informar
-- o número e o modelo; no modo teste tudo vai para o número de teste; fora do
-- teste, só para o paciente que autorizou o WhatsApp; atendimento de hoje entra
-- na fila no horário de envio (amanhã não); o paciente confirma ou desmarca
-- pelo link sem login (só vê o primeiro nome, o dia e a clínica); a recepção
-- é avisada de quem desmarcou; remarcar para outro dia recomeça; só o servidor
-- roda a rotina e grava o resultado; outra empresa não mexe.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(25);

\ir 00_setup.sql.inc

-- Horários: hoje (ainda no futuro) e amanhã
select set_config('testes.hoje', greatest(now() + interval '2 minutes',
  least(now() + interval '3 hours', ((now() at time zone 'America/Araguaina')::date + time '23:58') at time zone 'America/Araguaina'))::text, true);
select set_config('testes.amanha', ((((now() at time zone 'America/Araguaina')::date + 1) + time '10:00') at time zone 'America/Araguaina')::text, true);

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "fisioterapia"}');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.ana', public.fisio_paciente_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Ana Paciente Silva', 'telefone', '(63) 99999-1234', 'consentimento', true))::text, true);
select set_config('testes.bia', public.fisio_paciente_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Bia Sem WhatsApp', 'telefone', '(63) 99999-5678', 'aceita_whatsapp', false, 'consentimento', true))::text, true);

-- 1. Configuração
select throws_like(format($$select public.fisio_configurar_whatsapp(%L, '{"whatsapp_ativo": true}')$$, current_setting('testes.empresa_a')),
  '%Phone Number ID%', 'ligar pede o número e o modelo');
select throws_like(format($$select public.fisio_configurar_whatsapp(%L, '{"whatsapp_ativo": true, "whatsapp_phone_number_id": "123456789", "whatsapp_modelo": "confirmacao_atendimento"}')$$,
  current_setting('testes.empresa_a')), '%número de teste%', 'no modo teste (padrão) pede o número de teste');
select public.fisio_configurar_whatsapp(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'whatsapp_ativo', true, 'whatsapp_phone_number_id', '123456789', 'whatsapp_modelo', 'confirmacao_atendimento',
  'whatsapp_modo_teste', true, 'whatsapp_numero_teste', '(63) 98888-7777', 'whatsapp_hora_envio', '07:00'));
select ok((select whatsapp_ativo and whatsapp_modo_teste and whatsapp_numero_teste = '63988887777' from public.fisio_config
            where empresa_id = current_setting('testes.empresa_a')::uuid), 'ligada no modo teste');
reset role;

-- 2. Atendimento de hoje: vai para o número de teste, no horário do envio; amanhã não
insert into public.fisio_agenda (id, empresa_id, inicio, paciente_id) values
  ('00000000-0000-0000-0000-00000000f001', current_setting('testes.empresa_a')::uuid, current_setting('testes.hoje')::timestamptz, current_setting('testes.ana')::uuid),
  ('00000000-0000-0000-0000-00000000f002', current_setting('testes.empresa_a')::uuid, current_setting('testes.amanha')::timestamptz, current_setting('testes.ana')::uuid);
select is((select destinatario from public.envios where tipo = 'fisio_confirmacao' and referencia_id = '00000000-0000-0000-0000-00000000f001'), '63988887777',
  'modo teste: a confirmação vai para o número de teste');
select is((select confirmacao_envio || ' ' || confirmacao_destino from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f001'), 'pendente teste',
  'na fila, marcada como teste');
select ok((select confirmacao_codigo ~ '^[a-z0-9]{16}$' from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f001'), 'link com código aleatório');
select ok((select j.executar_apos >= greatest(now(), ((now() at time zone 'America/Araguaina')::date + time '07:00') at time zone 'America/Araguaina') - interval '1 second'
             from public.jobs j join public.envios e on j.payload ->> 'envio_id' = e.id::text
            where e.referencia_id = '00000000-0000-0000-0000-00000000f001'), 'sai no horário do envio (ou já, se passou)');
select is((select count(*)::int from public.envios where referencia_id = '00000000-0000-0000-0000-00000000f002'), 0, 'atendimento de amanhã ainda não entra na fila');
set local role service_role;
select is((public.rotina_fisio_confirmacoes() ->> 'programadas')::int, 0, 'a rotina do dia não repete o que já está na fila');
reset role;

-- 3. Fora do teste: só para o paciente que autorizou
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.fisio_configurar_whatsapp(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'whatsapp_ativo', true, 'whatsapp_phone_number_id', '123456789', 'whatsapp_modelo', 'confirmacao_atendimento', 'whatsapp_modo_teste', false));
reset role;
insert into public.fisio_agenda (id, empresa_id, inicio, paciente_id) values
  ('00000000-0000-0000-0000-00000000f003', current_setting('testes.empresa_a')::uuid, current_setting('testes.hoje')::timestamptz + interval '1 minute', current_setting('testes.ana')::uuid),
  ('00000000-0000-0000-0000-00000000f004', current_setting('testes.empresa_a')::uuid, current_setting('testes.hoje')::timestamptz + interval '1 minute', current_setting('testes.bia')::uuid);
select is((select destinatario from public.envios where referencia_id = '00000000-0000-0000-0000-00000000f003'), '63999991234', 'sem o teste, vai para o celular do paciente');
select is((select confirmacao_envio from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f004'), 'dispensado',
  'paciente que não autorizou o WhatsApp não recebe');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like($$select public.fisio_confirmacao_enviar('00000000-0000-0000-0000-00000000f003')$$, '%já está na fila%', 'não duplica o envio na fila');
select throws_like($$select public.fisio_confirmacao_enviar('00000000-0000-0000-0000-00000000f004')$$, '%não autorizou%', 'envio na hora respeita a autorização');
reset role;

-- 4. Link do paciente (sem login)
select set_config('testes.cod1', (select confirmacao_codigo from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f001'), true);
select set_config('testes.cod3', (select confirmacao_codigo from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f003'), true);
-- Visitante sem login (sem usuário)
select set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
set local role anon;
select is((select (r ->> 'paciente') || ' ' || (r ->> 'pode_responder') from public.fisio_confirmacao_ver(current_setting('testes.cod1')) r), 'Ana true',
  'o paciente vê o primeiro nome e pode responder');
select ok(not (public.fisio_confirmacao_ver(current_setting('testes.cod1'))::text ~ '99999|Silva|cpf'), 'sem telefone nem sobrenome do paciente');
select is(public.fisio_confirmacao_responder(current_setting('testes.cod1'), 'confirmou'), 'confirmado', 'confirma pelo link');
select is(public.fisio_confirmacao_responder(current_setting('testes.cod3'), 'desmarcou', 'Viagem a trabalho'), 'desmarcado', 'desmarca pelo link');
select throws_like(format($$select public.fisio_confirmacao_responder(%L, 'confirmou')$$, current_setting('testes.cod3')), '%não pode mais%',
  'horário desmarcado não muda mais pelo link');
select throws_like($$select public.fisio_confirmacao_responder('aaaaaaaaaaaaaaaa', 'confirmou')$$, '%inválido%', 'código errado não mexe em nada');
reset role;
select is((select status || ' ' || confirmacao_resposta from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f001'), 'confirmado confirmou',
  'agenda mostra a confirmação do paciente');
select ok((select count(*) > 0 from public.notificacoes where tipo = 'fisio_desmarcou' and titulo like 'Ana desmarcou%'), 'a recepção é avisada de quem desmarcou');

-- 5. Remarcou para amanhã: a confirmação recomeça
update public.fisio_agenda set inicio = current_setting('testes.amanha')::timestamptz + interval '1 hour' where id = '00000000-0000-0000-0000-00000000f001';
select is((select coalesce(confirmacao_envio, 'nada') || ' ' || coalesce(confirmacao_resposta, 'nada') from public.fisio_agenda where id = '00000000-0000-0000-0000-00000000f001'),
  'nada nada', 'remarcar para outro dia limpa a confirmação');

-- 6. Só o servidor roda a rotina e grava o resultado; outra empresa não mexe
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like($$select public.rotina_fisio_confirmacoes()$$, '%permission denied%', 'a rotina é só do servidor');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_like(format($$select public.fisio_configurar_whatsapp(%L, '{"whatsapp_ativo": false}')$$, current_setting('testes.empresa_a')),
  '%permissão%', 'outra empresa não configura');
reset role;
select ok(not has_table_privilege('authenticated', 'public.fisio_whatsapp_segredo', 'select'), 'o token da clínica não é lido pelo navegador');

select * from finish();
rollback;
