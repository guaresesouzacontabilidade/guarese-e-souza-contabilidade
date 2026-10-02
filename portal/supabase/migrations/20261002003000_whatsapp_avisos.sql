-- =============================================================================
-- Avisos ao cliente por WhatsApp (e e-mail) quando o escritório envia
-- documentos, mensagens e solicitações
--
--  * Só recebe quem autorizou: o próprio cliente (Minha conta) ou o escritório,
--    ao cadastrar o número com a autorização do cliente.
--  * Avisos seguidos viram uma única mensagem de WhatsApp, enviada 2 minutos
--    depois; se a pessoa já viu tudo no portal, nada é enviado.
--  * E-mail de mensagem também espera 2 minutos e é dispensado se a conversa
--    já foi lida (bate-papo ao vivo não gera e-mail a cada resposta).
--  * Fica desligado até o escritório ativar e configurar o modelo aprovado na
--    API oficial do WhatsApp (Meta). Nada é simulado.
-- =============================================================================

alter table public.escritorio
  add column avisos_whatsapp_ativo boolean not null default false,
  add column whatsapp_template_aviso text check (whatsapp_template_aviso is null or (whatsapp_template_aviso ~ '^[a-z0-9_]+$' and length(whatsapp_template_aviso) <= 512));

grant update (avisos_whatsapp_ativo, whatsapp_template_aviso) on public.escritorio to authenticated;  -- política: somente administrador

-- Tipos de aviso que também podem ir por WhatsApp (do escritório para o cliente).
create or replace function app.tipos_aviso_whatsapp()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['documento_escritorio', 'relatorio_publicado', 'mensagem', 'item_solicitado', 'item_correcao',
               'documento_correcao', 'pendencia_fechamento']::text[];
$$;

-- Programa o WhatsApp do aviso (um envio pendente por pessoa reúne os avisos seguintes).
create or replace function app.agendar_whatsapp(p_user_id uuid, p_empresa_id uuid, p_notificacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.perfis;
  v_numero text;
  v_envio uuid;
begin
  if not coalesce((select e.avisos_whatsapp_ativo from public.escritorio e where e.id = 1), false) then
    return;
  end if;
  select * into v_perfil from public.perfis where id = p_user_id;
  if not found then
    return;
  end if;
  v_numero := regexp_replace(coalesce(v_perfil.telefone, ''), '\D', '', 'g');
  if not v_perfil.ativo or v_perfil.tipo <> 'cliente'
     or coalesce(v_perfil.preferencias ->> 'whatsapp_avisos', 'false') <> 'true'
     or length(v_numero) not between 10 and 13 then
    return;
  end if;
  if exists (select 1 from public.envios v
              where v.user_id = p_user_id and v.canal = 'whatsapp' and v.tipo = 'aviso' and v.status = 'pendente') then
    return;
  end if;
  insert into public.envios (empresa_id, user_id, canal, destinatario, assunto, tipo, referencia_tipo, referencia_id, solicitado_por)
  values (p_empresa_id, p_user_id, 'whatsapp', v_numero, 'Avisos do portal', 'aviso', 'notificacao', p_notificacao_id::text, auth.uid())
  returning id into v_envio;
  perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), p_empresa_id,
                         'envio:' || v_envio::text, now() + interval '2 minutes', 40);
end;
$$;

-- Notificação no sistema: e-mail (mensagens com 2 minutos de espera), WhatsApp
-- para os avisos do escritório e notificação nos aparelhos ativados.
create or replace function app.notificar(
  p_user_id uuid,
  p_empresa_id uuid,
  p_tipo text,
  p_titulo text,
  p_corpo text default null,
  p_link text default null,
  p_email boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.perfis;
  v_id uuid;
  v_envio uuid;
begin
  select * into v_perfil from public.perfis where id = p_user_id;
  if not found or not v_perfil.ativo then
    return null;
  end if;
  insert into public.notificacoes (user_id, empresa_id, tipo, titulo, corpo, link)
  values (p_user_id, p_empresa_id, p_tipo, p_titulo, p_corpo, p_link)
  returning id into v_id;

  if p_email
     and coalesce(v_perfil.email, '') <> ''
     and coalesce(v_perfil.preferencias ->> 'email_notificacoes', 'true') <> 'false' then
    insert into public.envios (empresa_id, user_id, canal, destinatario, assunto, conteudo, tipo, referencia_tipo, referencia_id, solicitado_por)
    values (p_empresa_id, p_user_id, 'email', v_perfil.email, p_titulo, p_corpo, p_tipo, 'notificacao', v_id::text, auth.uid())
    returning id into v_envio;
    perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), p_empresa_id, 'envio:' || v_envio::text,
                           case when p_tipo = 'mensagem' then now() + interval '2 minutes' else now() end, 50);
  end if;

  if p_tipo = any (app.tipos_aviso_whatsapp()) then
    perform app.agendar_whatsapp(p_user_id, p_empresa_id, v_id);
  end if;

  perform app.avisar_aparelhos(v_id);
  return v_id;
end;
$$;

-- Abrir a conversa marca como lidos os avisos dela (o e-mail e o WhatsApp
-- pendentes deixam de ser necessários).
create or replace function public.marcar_conversa_lida(p_conversa_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.conversas where id = p_conversa_id;
  if v_empresa is null then
    return;
  end if;
  perform app.exigir(v_empresa, 'mensagens.usar');
  insert into public.conversa_leituras (conversa_id, user_id) values (p_conversa_id, auth.uid())
  on conflict (conversa_id, user_id) do update set lida_em = now();
  update public.notificacoes
     set lida_em = now()
   where user_id = auth.uid()
     and lida_em is null
     and link = '/e/' || v_empresa::text || '/mensagens/' || p_conversa_id::text;
end;
$$;

-- O escritório (ou o titular, para seus colaboradores) cadastra o WhatsApp do
-- cliente e registra a autorização para receber avisos.
create or replace function public.definir_whatsapp_membro(p_empresa_id uuid, p_user_id uuid, p_telefone text, p_autorizado boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_ativo boolean;
begin
  perform app.exigir(p_empresa_id, 'usuarios.gerenciar');
  if not exists (
    select 1 from public.empresa_membros m
      join public.perfis p on p.id = m.user_id
     where m.empresa_id = p_empresa_id and m.user_id = p_user_id and m.ativo
       and m.papel in ('cliente_titular', 'cliente_colaborador') and p.tipo = 'cliente'
  ) then
    raise exception 'Esta pessoa não é cliente desta empresa.';
  end if;
  if v_numero <> '' and length(v_numero) not between 10 and 13 then
    raise exception 'WhatsApp inválido. Use DDD + número.';
  end if;
  if coalesce(p_autorizado, false) and v_numero = '' then
    raise exception 'Informe o número de WhatsApp para ativar os avisos.';
  end if;
  v_ativo := coalesce(p_autorizado, false) and v_numero <> '';
  update public.perfis
     set telefone = nullif(v_numero, ''),
         preferencias = coalesce(preferencias, '{}'::jsonb) || jsonb_build_object('whatsapp_avisos', v_ativo)
   where id = p_user_id;
  perform app.registrar_auditoria('whatsapp_avisos_definido', 'perfis', p_user_id::text, p_empresa_id,
                                  jsonb_build_object('avisos_whatsapp', v_ativo));
end;
$$;

revoke execute on function public.definir_whatsapp_membro(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.definir_whatsapp_membro(uuid, uuid, text, boolean) to authenticated;
grant execute on function app.tipos_aviso_whatsapp(), app.agendar_whatsapp(uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function app.tipos_aviso_whatsapp(), app.agendar_whatsapp(uuid, uuid, uuid) from public, anon;
