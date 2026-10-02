-- Critérios: todo arquivo enviado pelo cliente avisa quem acompanha a empresa
-- (e não avisa quem não acompanha); envios seguidos viram um aviso só; cada
-- pessoa escolhe de quais empresas quer aviso e se quer resumo por e-mail;
-- arquivo registrado pela equipe não gera aviso; recebido após o fechamento
-- não gera aviso duplicado; aparelhos (Web Push) só da própria pessoa, só em
-- serviços de notificação conhecidos e com as chaves fora do alcance do navegador.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(54);

\ir 00_setup.sql.inc

-- Envio completo (criar → arquivo no armazenamento → confirmar) como um usuário.
create or replace function pg_temp.enviar(p_usuario uuid, p_empresa uuid, p_nome text, p_competencia date default '2026-09-20')
returns uuid
language plpgsql
as $$
declare
  r jsonb;
begin
  perform pg_temp.como(p_usuario);
  r := public.criar_documento(p_empresa, p_competencia, 'extrato_bancario', p_nome, 'application/pdf', 2048, md5(p_nome) || md5(p_nome));
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('documentos', r ->> 'storage_path', p_usuario, jsonb_build_object('size', 2048, 'mimetype', 'application/pdf'));
  perform public.confirmar_upload((r ->> 'versao_id')::uuid);
  return (r ->> 'documento_id')::uuid;
end;
$$;

create or replace function pg_temp.avisos(p_usuario uuid, p_empresa uuid default null)
returns int
language sql
as $$
  select count(*)::int from public.notificacoes
   where user_id = p_usuario and tipo = 'arquivo_cliente' and (p_empresa is null or empresa_id = p_empresa);
$$;

create or replace function pg_temp.ultimo_aviso(p_usuario uuid)
returns public.notificacoes
language sql
as $$
  -- (dentro da transação do teste todos os avisos têm o mesmo horário: o não lido vem primeiro)
  select * from public.notificacoes
   where user_id = p_usuario and tipo = 'arquivo_cliente'
   order by (lida_em is null) desc, created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.preferencia(p_usuario uuid, p_valores jsonb)
returns void
language sql
as $$
  update public.perfis set preferencias = preferencias || p_valores where id = p_usuario;
$$;

select set_config('testes.a', current_setting('testes.empresa_a'), true);
select set_config('testes.b', current_setting('testes.empresa_b'), true);

-- 1. Primeiro arquivo do cliente da Empresa A
select set_config('testes.doc1', pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-1.pdf')::text, true);
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a1'), 1, 'administrador é avisado do arquivo enviado pelo cliente');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a2'), 1, 'contador responsável é avisado');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a3'), 0, 'equipe que não acompanha a empresa não é avisada');
select is((select count(*)::int from public.notificacoes where tipo = 'arquivo_cliente'
            and user_id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1')),
          0, 'clientes não recebem o aviso interno');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).titulo, 'Novo arquivo de Empresa A', 'título com o nome da empresa');
select ok((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).corpo like 'extrato-1.pdf · %competência 09/2026 · enviado por cliente.a',
          'texto com arquivo, competência e quem enviou');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).link,
          '/e/' || current_setting('testes.a') || '/documentos/' || current_setting('testes.doc1'), 'link abre o documento');
select is((select count(*)::int from public.envios where tipo = 'arquivo_cliente' and user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1')), 0, 'sem e-mail quando a pessoa não pediu');
select is((select count(*)::int from public.jobs where tipo = 'enviar_push'
            and payload ->> 'notificacao_id' in (select id::text from public.notificacoes where user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1'))),
          0, 'sem aparelho ativado, nada é enfileirado para notificação no aparelho');

-- 2. Envios seguidos viram um aviso só
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-2.pdf');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a1'), 1, 'segundo arquivo não cria outro aviso');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).quantidade, 2, 'aviso conta os arquivos');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).titulo, 'Empresa A enviou 2 arquivos', 'título resume o conjunto');
select ok((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).corpo like 'Último: extrato-2.pdf%', 'texto mostra o último arquivo');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).link,
          '/e/' || current_setting('testes.a') || '/documentos?status=recebido', 'link leva à lista de recebidos');

-- 3. Depois de lido, o próximo arquivo gera um aviso novo
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.notificacoes set lida_em = now() where tipo = 'arquivo_cliente';
reset role;
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-3.pdf');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a1'), 2, 'aviso lido não é reaproveitado');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).quantidade, 1, 'novo aviso começa a contagem');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a2'), 1, 'cada pessoa tem o próprio aviso (o da equipe continua agrupado)');

-- 4. Outra empresa: só quem a acompanha
select pg_temp.enviar('00000000-0000-0000-0000-0000000000c1', current_setting('testes.b')::uuid, 'nota-b.pdf');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a1', current_setting('testes.b')::uuid), 1, 'administrador avisado da Empresa B');
select is((select titulo from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a1' and tipo = 'arquivo_cliente'
             and empresa_id = current_setting('testes.b')::uuid and lida_em is null), 'Novo arquivo de Empresa B Serviços Ltda',
          'sem nome fantasia, usa a razão social');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a2', current_setting('testes.b')::uuid), 0, 'contador de outra empresa não é avisado');

-- 5. Preferências de cada pessoa
select pg_temp.preferencia('00000000-0000-0000-0000-0000000000a1', '{"aviso_arquivos": "responsavel"}');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000c1', current_setting('testes.b')::uuid, 'nota-b2.pdf');
select is((pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).quantidade, 1,
          '"só empresas em que sou responsável": administrador não recebe da empresa sem vínculo');
select pg_temp.preferencia('00000000-0000-0000-0000-0000000000a2', '{"aviso_arquivos": "nenhuma"}');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-4.pdf');
select is((select quantidade from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'arquivo_cliente' and lida_em is null),
          3, '"não avisar" não altera avisos anteriores');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-5.pdf');
select is((select quantidade from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'arquivo_cliente' and lida_em is null),
          3, '"não avisar": a pessoa deixa de receber');
select pg_temp.preferencia('00000000-0000-0000-0000-0000000000a2', '{"aviso_arquivos": "valor-invalido"}');
select pg_temp.preferencia('00000000-0000-0000-0000-0000000000a1', '{"aviso_arquivos": "todas"}');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-6.pdf');
select is((select quantidade from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'arquivo_cliente' and lida_em is null),
          4, 'valor desconhecido na preferência vale como "todas" (não quebra o envio do cliente)');

-- 6. Arquivo registrado pela equipe em nome do cliente não gera aviso
select set_config('testes.qtd', (select sum(quantidade)::text from public.notificacoes where tipo = 'arquivo_cliente'), true);
select pg_temp.enviar('00000000-0000-0000-0000-0000000000a2', current_setting('testes.a')::uuid, 'extrato-equipe.pdf');
select is((select sum(quantidade)::text from public.notificacoes where tipo = 'arquivo_cliente'), current_setting('testes.qtd'),
          'envio feito pela equipe não avisa o escritório');

-- 7. Recebido após o fechamento: um único aviso por pessoa
insert into public.competencias (empresa_id, competencia, status, fechada_em)
values (current_setting('testes.a')::uuid, '2026-08-01', 'fechada', now());
select set_config('testes.doc_fechado', pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'atrasado.pdf', '2026-08-10')::text, true);
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2'
            and link = '/e/' || current_setting('testes.a') || '/documentos/' || current_setting('testes.doc_fechado')),
          1, 'equipe recebe só o alerta de "recebido após o fechamento"');
select is((select tipo from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2'
            and link = '/e/' || current_setting('testes.a') || '/documentos/' || current_setting('testes.doc_fechado')),
          'documento_apos_fechamento', 'o alerta do fechamento prevalece');
select ok((select corpo from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a1' and tipo = 'arquivo_cliente'
            and empresa_id = current_setting('testes.a')::uuid and lida_em is null) like 'Último: atrasado.pdf%competência 08/2026%',
          'administrador (fora do alerta do fechamento) recebe o aviso do arquivo');

-- 8. Resumo por e-mail (opcional): enviado 10 minutos depois, descrevendo o conjunto
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.notificacoes set lida_em = now() where tipo = 'arquivo_cliente' and lida_em is null;
reset role;
select pg_temp.preferencia('00000000-0000-0000-0000-0000000000a1', '{"aviso_arquivos_email": true}');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-7.pdf');
select is((select count(*)::int from public.envios where tipo = 'arquivo_cliente' and user_id = '00000000-0000-0000-0000-0000000000a1'), 1,
          'e-mail registrado para quem pediu');
select ok((select j.executar_apos > now() + interval '9 minutes' from public.jobs j
            join public.envios e on j.payload ->> 'envio_id' = e.id::text
           where e.tipo = 'arquivo_cliente' and e.user_id = '00000000-0000-0000-0000-0000000000a1'), 'e-mail agendado para 10 minutos depois');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-8.pdf');
select is((select assunto from public.envios where tipo = 'arquivo_cliente' and user_id = '00000000-0000-0000-0000-0000000000a1'),
          'Empresa A enviou 2 arquivos', 'e-mail pendente passa a resumir o conjunto');
select pg_temp.preferencia('00000000-0000-0000-0000-0000000000a1', '{"email_notificacoes": false}');
update public.notificacoes set lida_em = now() where tipo = 'arquivo_cliente' and lida_em is null;
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-9.pdf');
select is((select count(*)::int from public.envios where tipo = 'arquivo_cliente' and user_id = '00000000-0000-0000-0000-0000000000a1'), 1,
          'quem desligou todos os e-mails não recebe o resumo');

-- 9. Aparelhos (Web Push)
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('testes.aparelho', public.registrar_aparelho_push(
  'https://fcm.googleapis.com/fcm/send/teste-a1', repeat('B', 87), repeat('a', 22), 'Chrome no Android')::text, true);
select is((select count(*)::int from public.push_aparelhos), 1, 'aparelho ativado e visível para a própria pessoa');
select is(public.registrar_aparelho_push('https://fcm.googleapis.com/fcm/send/teste-a1', repeat('C', 87), repeat('b', 22), null),
          current_setting('testes.aparelho')::uuid, 'ativar de novo o mesmo aparelho só renova');
select throws_ok($$select public.registrar_aparelho_push('https://exemplo.com.br/coletor', repeat('B', 87), repeat('a', 22), null)$$,
                 'P0001', null, 'endereço fora dos serviços de notificação é recusado');
select throws_ok($$select public.registrar_aparelho_push('https://updates.push.services.mozilla.com/wpush/v2/x', 'curta', repeat('a', 22), null)$$,
                 '23514', null, 'chave em formato inválido é recusada');
select throws_ok($$select chave_auth from public.push_aparelhos$$, '42501', null, 'chaves de cifragem não são legíveis pelo navegador');
select throws_ok($$select * from public.sistema_push_destinos(gen_random_uuid())$$, '42501', null,
                 'somente o servidor consulta os destinos de entrega');
reset role;
select is((select descricao from public.push_aparelhos where user_id = '00000000-0000-0000-0000-0000000000a1'), 'Chrome no Android', 'descrição mantida ao renovar sem informar outra');
select is((select chave_auth from public.push_aparelhos where user_id = '00000000-0000-0000-0000-0000000000a1'), repeat('b', 22), 'chaves renovadas');
select is((select count(*)::int from public.auditoria where acao = 'notificacoes_aparelho_ativadas' and user_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'ativação registrada uma vez na auditoria');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.push_aparelhos), 0, 'aparelhos de outra pessoa ficam ocultos');
select is(public.remover_aparelho_push(current_setting('testes.aparelho')::uuid, null), 0, 'não é possível desativar o aparelho de outra pessoa');
reset role;

-- Aviso novo → entrega enfileirada uma única vez enquanto pendente
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-10.pdf');
select set_config('testes.aviso_a1', (pg_temp.ultimo_aviso('00000000-0000-0000-0000-0000000000a1')).id::text, true);
select is((select count(*)::int from public.jobs where tipo = 'enviar_push' and payload ->> 'notificacao_id' = current_setting('testes.aviso_a1')),
          1, 'notificação no aparelho enfileirada');
select pg_temp.enviar('00000000-0000-0000-0000-0000000000b1', current_setting('testes.a')::uuid, 'extrato-11.pdf');
select is((select count(*)::int from public.jobs where tipo = 'enviar_push' and payload ->> 'notificacao_id' = current_setting('testes.aviso_a1')),
          1, 'envio pendente é reaproveitado (lê o texto atualizado)');
select is((select count(*)::int from public.jobs where tipo = 'enviar_push'
            and payload ->> 'notificacao_id' in (select id::text from public.notificacoes where user_id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1') and user_id <> '00000000-0000-0000-0000-0000000000a1')),
          0, 'nada é enfileirado para quem não ativou aparelho');

set local role service_role;
select is((select count(*)::int from public.sistema_push_destinos(current_setting('testes.aviso_a1')::uuid)), 1, 'servidor obtém o destino com sessão ativa');
reset role;
delete from auth.sessions where id = '00000000-0000-0000-0000-0000000000a1';
set local role service_role;
select is((select count(*)::int from public.sistema_push_destinos(current_setting('testes.aviso_a1')::uuid)), 0,
          'ao sair do portal (sessão encerrada) o aparelho deixa de receber');
select lives_ok(format($$select public.sistema_push_resultado(%L::uuid, false, true)$$, current_setting('testes.aparelho')),
                'endereço expirado é removido pelo servidor');
reset role;
select is((select count(*)::int from public.push_aparelhos where user_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'aparelho expirado removido');

-- Aviso de teste (com limite)
insert into auth.sessions (id, user_id, created_at, updated_at, aal)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', now(), now(), 'aal1');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select ok(public.enviar_aviso_teste() is not null, 'aviso de teste criado');
select is((select count(*)::int from (select public.enviar_aviso_teste() from generate_series(1, 4)) x), 4, 'testes seguintes permitidos até o limite');
select throws_ok($$select public.enviar_aviso_teste()$$, 'P0001', null, 'muitos testes seguidos são bloqueados');
reset role;

-- Tempo real
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes'),
          'avisos publicados em tempo real (filtrados pela RLS)');

select * from finish();
rollback;
