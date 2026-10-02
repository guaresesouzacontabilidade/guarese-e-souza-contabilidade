-- Critérios: o WhatsApp do cliente é cadastrado por quem gerencia os acessos da
-- empresa (com validação); só recebe aviso por WhatsApp quem autorizou e quando
-- o escritório ativou; avisos seguidos viram uma única mensagem; equipe não
-- recebe WhatsApp; e-mail de mensagem espera 2 minutos; abrir a conversa marca
-- os avisos dela como lidos.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(20);

\ir 00_setup.sql.inc

-- Documento publicado pelo escritório (a2) para a Empresa A.
create or replace function pg_temp.publicar(p_nome text)
returns uuid
language plpgsql
as $$
declare
  r jsonb;
begin
  perform pg_temp.como('00000000-0000-0000-0000-0000000000a2');
  r := public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-10', 'esc_outros', p_nome, 'application/pdf', 1024, md5(p_nome) || md5(p_nome));
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('documentos', r ->> 'storage_path', '00000000-0000-0000-0000-0000000000a2', jsonb_build_object('size', 1024, 'mimetype', 'application/pdf'));
  perform public.confirmar_upload((r ->> 'versao_id')::uuid);
  return (r ->> 'documento_id')::uuid;
end;
$$;

create or replace function pg_temp.whatsapps(p_usuario uuid)
returns int
language sql
as $$
  select count(*)::int from public.envios where user_id = p_usuario and canal = 'whatsapp';
$$;

-- 1. Cadastro do WhatsApp com autorização
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.definir_whatsapp_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b1', '(63) 99999-1234', true)$$,
                'administrador cadastra o WhatsApp do cliente com autorização');
select throws_ok($$select public.definir_whatsapp_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b1', '123', true)$$,
                 'P0001', null, 'número inválido é recusado');
select throws_ok($$select public.definir_whatsapp_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000c1', '63999990000', true)$$,
                 'P0001', null, 'pessoa que não é cliente da empresa é recusada');
select throws_ok($$select public.definir_whatsapp_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000a2', '63999990000', true)$$,
                 'P0001', null, 'equipe do escritório não recebe avisos por WhatsApp');
reset role;
select is((select telefone from public.perfis where id = '00000000-0000-0000-0000-0000000000b1'), '63999991234', 'número guardado só com dígitos');
select is((select preferencias ->> 'whatsapp_avisos' from public.perfis where id = '00000000-0000-0000-0000-0000000000b1'), 'true', 'autorização registrada');
select is((select count(*)::int from public.auditoria where acao = 'whatsapp_avisos_definido' and entidade_id = '00000000-0000-0000-0000-0000000000b1'), 1,
          'cadastro registrado na auditoria');

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.definir_whatsapp_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b1', '63988887777', false)$$,
                 '42501', null, 'cliente de outra empresa não altera o WhatsApp');
reset role;

-- 2. Escritório ainda não ativou o WhatsApp: nada é programado
select pg_temp.publicar('balancete-agosto.pdf');
reset role;
select is(pg_temp.whatsapps('00000000-0000-0000-0000-0000000000b1'), 0, 'sem a integração ativada, nenhum WhatsApp é programado');

-- 3. Ativado: um WhatsApp para quem autorizou, reunindo os avisos seguidos
update public.escritorio set avisos_whatsapp_ativo = true, whatsapp_template_aviso = 'aviso_portal' where id = 1;
select pg_temp.publicar('guia-das.pdf');
reset role;
select is(pg_temp.whatsapps('00000000-0000-0000-0000-0000000000b1'), 1, 'cliente que autorizou tem um WhatsApp programado');
select ok((select j.executar_apos > now() + interval '1 minute' from public.jobs j
            join public.envios e on j.payload ->> 'envio_id' = e.id::text
           where e.user_id = '00000000-0000-0000-0000-0000000000b1' and e.canal = 'whatsapp'),
          'WhatsApp sai 2 minutos depois (dá tempo de reunir os avisos)');
select is((select destinatario from public.envios where user_id = '00000000-0000-0000-0000-0000000000b1' and canal = 'whatsapp'), '63999991234',
          'enviado para o número cadastrado');
select pg_temp.publicar('folha-setembro.pdf');
reset role;
select is(pg_temp.whatsapps('00000000-0000-0000-0000-0000000000b1'), 1, 'avisos seguidos viram uma única mensagem');
select is(pg_temp.whatsapps('00000000-0000-0000-0000-0000000000b2'), 0, 'quem não autorizou não recebe WhatsApp');
select is((select count(*)::int from public.envios where canal = 'whatsapp'
            and user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3')),
          0, 'equipe do escritório não recebe WhatsApp');

-- 4. O próprio cliente ativa no seu perfil (Minha conta)
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
update public.perfis set telefone = '63977776666', preferencias = preferencias || '{"whatsapp_avisos": true}'::jsonb
 where id = '00000000-0000-0000-0000-0000000000b2';
reset role;
select pg_temp.publicar('relatorio-mensal.pdf');
reset role;
select is(pg_temp.whatsapps('00000000-0000-0000-0000-0000000000b2'),
          case when exists (select 1 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b2' and tipo = 'documento_escritorio') then 1 else 0 end,
          'cliente que ativou no próprio perfil passa a receber (se tiver acesso aos documentos)');

-- 5. Mensagem do escritório: e-mail com 2 minutos de espera; abrir a conversa marca o aviso como lido
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.conversa', public.criar_conversa(current_setting('testes.empresa_a')::uuid, 'Documentos de setembro',
  'Por favor, envie o extrato de setembro.', 'solicitacao')::text, true);
reset role;
select ok((select j.executar_apos > now() + interval '1 minute' from public.jobs j
            join public.envios e on j.payload ->> 'envio_id' = e.id::text
           where e.user_id = '00000000-0000-0000-0000-0000000000b1' and e.canal = 'email' and e.tipo = 'mensagem'),
          'e-mail da mensagem espera 2 minutos (bate-papo ao vivo não gera e-mail a cada resposta)');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'mensagem' and lida_em is null), 1,
          'cliente recebe o aviso da solicitação no sino');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.marcar_conversa_lida(current_setting('testes.conversa')::uuid);
reset role;
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'mensagem' and lida_em is null), 0,
          'abrir a conversa marca o aviso dela como lido');
select is(pg_temp.whatsapps('00000000-0000-0000-0000-0000000000b1'), 1, 'a mensagem entra no mesmo WhatsApp pendente');

select * from finish();
rollback;
