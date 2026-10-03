-- Critérios: com o envio por e-mail ligado, o lembrete de pendências registra
-- os canais "sistema" e "email" e prepara o e-mail dos destinatários; a rotina
-- diária manda os lembretes do dia sem falhar e segue para as demais etapas;
-- o lembrete enviado pela equipe (botão) também funciona. Antes, o canal
-- e-mail derrubava a rotina diária inteira ("malformed array literal").
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

update public.escritorio set lembretes_email_ativo = true, lembretes_whatsapp_ativo = false, lembretes_dias = array[0] where id = 1;
-- Pendência obrigatória da empresa A que vence hoje
insert into public.checklist_itens (empresa_id, competencia, categoria_codigo, titulo, obrigatorio, prazo, status)
values (current_setting('testes.empresa_a')::uuid, date_trunc('month', app.hoje())::date, 'extrato_bancario', 'Extrato bancário do mês',
        true, app.hoje(), 'pendente');

-- 1. Rotina diária com lembrete por e-mail
select lives_ok($$ select public.rotina_diaria() $$, 'rotina diária roda com lembrete por e-mail');
select is((select canais from public.lembretes where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'automatico'),
          array['sistema', 'email'], 'lembrete automático registrado nos canais sistema e e-mail');
select ok((select count(*) > 0 from public.envios where empresa_id = current_setting('testes.empresa_a')::uuid and canal = 'email'),
          'e-mail do lembrete preparado para o cliente');
select ok(exists (select 1 from public.jobs where tipo = 'enviar_envio' and empresa_id = current_setting('testes.empresa_a')::uuid),
          'envio do e-mail vai para a fila');
select lives_ok($$ select public.rotina_operacional() $$, 'a etapa seguinte da rotina (obrigações) também roda');

-- 2. Lembrete enviado pela equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$ select public.enviar_lembrete_manual(current_setting('testes.empresa_a')::uuid, app.hoje(), 'Falta só o extrato.') $$,
                'equipe envia o lembrete com e-mail ligado');
reset role;
select is((select canais from public.lembretes where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'manual'),
          array['sistema', 'email'], 'lembrete manual registrado nos canais sistema e e-mail');

select * from finish();
rollback;
