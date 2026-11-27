-- =============================================================================
-- Avisos de arquivos enviados pelos clientes e notificações no aparelho
--
--  * Cada arquivo que o cliente envia (ou nova versão) gera um aviso no sino de
--    quem acompanha a empresa. Envios seguidos da mesma empresa viram um único
--    aviso ("enviou 5 arquivos") enquanto ele não for lido (janela de 30 min).
--  * Cada pessoa do escritório escolhe em Minha conta: todas as empresas que
--    acessa, só as empresas em que é o contador responsável, ou nenhuma; e se
--    quer também um resumo por e-mail (enviado 10 minutos após o 1º arquivo).
--  * Notificações no aparelho (Web Push): cada pessoa ativa nos aparelhos que
--    quiser. O aviso só é entregue enquanto a sessão daquele aparelho estiver
--    ativa — ao sair do portal, o aparelho deixa de receber.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Avisos agrupados e em tempo real
-- -----------------------------------------------------------------------------
alter table public.notificacoes
  add column quantidade int not null default 1 check (quantidade >= 1);

-- O sino atualiza sem recarregar a página (Supabase Realtime, filtrado pela RLS).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes') then
    alter publication supabase_realtime add table public.notificacoes;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Aparelhos com notificações ativadas (Web Push)
-- -----------------------------------------------------------------------------
-- Só endereços dos serviços de notificação dos navegadores (Google, Mozilla,
-- Apple e Microsoft): o servidor nunca envia avisos para outros destinos.
create or replace function app.push_endpoint_valido(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    length(p_endpoint) <= 1000
    and p_endpoint ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?/[^[:space:]]*$',
    false);
$$;

create table public.push_aparelhos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.perfis(id) on delete cascade,
  sessao_id uuid,
  endpoint text not null unique check (app.push_endpoint_valido(endpoint)),
  chave_p256dh text not null check (chave_p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  chave_auth text not null check (chave_auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  descricao text check (descricao is null or length(descricao) <= 120),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ultimo_envio_em timestamptz,
  falhas_seguidas int not null default 0
);
create index push_aparelhos_usuario_idx on public.push_aparelhos (user_id);

alter table public.push_aparelhos enable row level security;
create policy push_aparelhos_leitura on public.push_aparelhos for select to authenticated
  using (user_id = (select auth.uid()) and (select app.usuario_valido()));
-- As chaves de cifragem e a sessão nunca voltam ao navegador.
grant select (id, endpoint, descricao, created_at, ultimo_envio_em) on public.push_aparelhos to authenticated;

-- Ativa (ou renova) o aparelho atual para a pessoa logada. O mesmo navegador
-- usado por outra pessoa passa a pertencer a quem o ativou por último.
create or replace function public.registrar_aparelho_push(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_descricao text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_novo boolean;
begin
  if auth.uid() is null or not app.usuario_valido() then
    raise exception 'Sessão inválida. Entre novamente no portal.';
  end if;
  if not app.push_endpoint_valido(p_endpoint) then
    raise exception 'Este navegador informou um endereço de notificação não reconhecido.';
  end if;
  insert into public.push_aparelhos (user_id, sessao_id, endpoint, chave_p256dh, chave_auth, descricao)
  values (auth.uid(), app.try_uuid(auth.jwt() ->> 'session_id'), p_endpoint, p_p256dh, p_auth,
          nullif(left(trim(coalesce(p_descricao, '')), 120), ''))
  on conflict (endpoint) do update
     set user_id = excluded.user_id,
         sessao_id = excluded.sessao_id,
         chave_p256dh = excluded.chave_p256dh,
         chave_auth = excluded.chave_auth,
         descricao = coalesce(excluded.descricao, public.push_aparelhos.descricao),
         atualizado_em = now(),
         falhas_seguidas = 0
  returning id, (xmax = 0) into v_id, v_novo;

  -- No máximo 10 aparelhos por pessoa (os mais antigos saem).
  delete from public.push_aparelhos a
   where a.id in (select x.id from public.push_aparelhos x
                   where x.user_id = auth.uid()
                   order by x.atualizado_em desc
                  offset 10);

  if v_novo then
    perform app.registrar_auditoria('notificacoes_aparelho_ativadas', 'push_aparelhos', v_id::text, null,
                                    jsonb_build_object('aparelho', nullif(left(trim(coalesce(p_descricao, '')), 120), '')));
  end if;
  return v_id;
end;
$$;

-- Desativa um aparelho da própria pessoa (pelo id, na lista, ou pelo endereço,
-- no próprio navegador).
create or replace function public.remover_aparelho_push(p_id uuid default null, p_endpoint text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[];
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida. Entre novamente no portal.';
  end if;
  with removidos as (
    delete from public.push_aparelhos
     where user_id = auth.uid()
       and ((p_id is not null and id = p_id) or (p_endpoint is not null and endpoint = p_endpoint))
    returning id
  )
  select array_agg(id::text) into v_ids from removidos;
  if cardinality(v_ids) > 0 then
    perform app.registrar_auditoria('notificacoes_aparelho_desativadas', 'push_aparelhos', v_ids[1], null,
                                    jsonb_build_object('quantidade', cardinality(v_ids)));
  end if;
  return coalesce(cardinality(v_ids), 0);
end;
$$;

-- Enfileira a entrega de um aviso nos aparelhos da pessoa (se houver algum).
-- Um envio pendente por aviso basta: ele lê o texto mais recente ao executar.
create or replace function app.avisar_aparelhos(p_notificacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.notificacoes;
begin
  select * into v_n from public.notificacoes where id = p_notificacao_id;
  if not found or v_n.lida_em is not null
     or not exists (select 1 from public.push_aparelhos a where a.user_id = v_n.user_id) then
    return;
  end if;
  if exists (select 1 from public.jobs j
              where j.tipo = 'enviar_push' and j.status = 'pendente'
                and j.payload ->> 'notificacao_id' = p_notificacao_id::text) then
    return;
  end if;
  perform app.enfileirar(
    'enviar_push',
    jsonb_build_object('notificacao_id', p_notificacao_id),
    v_n.empresa_id,
    'push:' || p_notificacao_id::text || ':' || v_n.quantidade::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::text,
    now(),
    10
  );
end;
$$;

-- Destinos de um aviso: aparelhos da pessoa cuja sessão ainda está ativa
-- (somente o processador da fila, com a chave secreta do servidor).
create or replace function public.sistema_push_destinos(p_notificacao_id uuid)
returns table (aparelho_id uuid, endpoint text, chave_p256dh text, chave_auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.endpoint, a.chave_p256dh, a.chave_auth
    from public.notificacoes n
    join public.perfis p on p.id = n.user_id and p.ativo
    join public.push_aparelhos a on a.user_id = n.user_id
   where n.id = p_notificacao_id
     and n.lida_em is null
     and exists (select 1 from auth.sessions s
                  where s.id = a.sessao_id and s.user_id = a.user_id
                    and (s.not_after is null or s.not_after > now()));
$$;

-- Resultado da entrega: endereços expirados (404/410) são removidos; após 10
-- falhas seguidas o aparelho também sai da lista.
create or replace function public.sistema_push_resultado(p_aparelho_id uuid, p_entregue boolean, p_remover boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_remover then
    delete from public.push_aparelhos where id = p_aparelho_id;
  elsif p_entregue then
    update public.push_aparelhos set ultimo_envio_em = now(), falhas_seguidas = 0 where id = p_aparelho_id;
  else
    update public.push_aparelhos set falhas_seguidas = falhas_seguidas + 1 where id = p_aparelho_id;
    delete from public.push_aparelhos where id = p_aparelho_id and falhas_seguidas >= 10;
  end if;
end;
$$;

-- Aviso de teste para a própria pessoa (Minha conta → "Enviar aviso de teste").
create or replace function public.enviar_aviso_teste()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.usuario_valido() then
    raise exception 'Sessão inválida. Entre novamente no portal.';
  end if;
  if (select count(*) from public.notificacoes n
       where n.user_id = auth.uid() and n.tipo = 'teste' and n.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Muitos testes seguidos. Aguarde alguns minutos e tente de novo.';
  end if;
  return app.notificar(auth.uid(), null, 'teste', 'Aviso de teste do Portal',
                       'Se este aviso apareceu no seu aparelho, as notificações estão funcionando.', '/conta#avisos', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Notificação no sistema (agora também entregue nos aparelhos ativados)
-- -----------------------------------------------------------------------------
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
    perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), p_empresa_id, 'envio:' || v_envio::text, now(), 50);
  end if;

  perform app.avisar_aparelhos(v_id);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Aviso de arquivo enviado pelo cliente
-- -----------------------------------------------------------------------------
-- Quem do escritório recebe o aviso, conforme a preferência de cada pessoa:
--   todas       → administradores: todas as empresas; equipe: as empresas que acompanha
--   responsavel → só as empresas em que é o contador responsável
--   nenhuma     → não recebe
-- Valores desconhecidos valem como "todas". E-mail só com opção explícita.
create or replace function app.destinatarios_aviso_arquivo(p_empresa_id uuid)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         case when coalesce(p.preferencias ->> 'aviso_arquivos_email', 'false') = 'true'
               and coalesce(p.preferencias ->> 'email_notificacoes', 'true') <> 'false'
               and coalesce(p.email, '') <> ''
              then p.email end
    from public.perfis p
    join public.empresas e on e.id = p_empresa_id
   where p.ativo
     and p.tipo in ('admin', 'equipe')
     and case coalesce(p.preferencias ->> 'aviso_arquivos', 'todas')
           when 'nenhuma' then false
           when 'responsavel' then e.contador_responsavel_id is not distinct from p.id
           else p.tipo = 'admin'
                or e.contador_responsavel_id is not distinct from p.id
                or exists (select 1 from public.empresa_membros m
                            where m.empresa_id = p_empresa_id and m.user_id = p.id and m.ativo and m.papel = 'equipe')
         end;
$$;

create or replace function app.avisar_arquivo_cliente(p_documento_id uuid, p_arquivo text, p_versao int default 1)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_empresa text;
  v_autor text;
  v_categoria text;
  v_detalhe text;
  v_link_doc text;
  v_link_lista text;
  v_qtd int;
  v_titulo text;
  v_n public.notificacoes;
  v_id uuid;
  v_envio uuid;
  v_total int := 0;
  r record;
begin
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found or v_doc.direcao <> 'cliente' then
    return 0;
  end if;
  -- Arquivo registrado pela própria equipe em nome do cliente: sem aviso.
  if app.tipo_usuario() in ('admin', 'equipe') then
    return 0;
  end if;

  select coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social) into v_empresa
    from public.empresas e where e.id = v_doc.empresa_id;
  select nullif(trim(p.nome), '') into v_autor from public.perfis p where p.id = auth.uid();
  select c.nome into v_categoria from public.categorias_documento c where c.codigo = v_doc.categoria_codigo;

  v_link_doc := '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text;
  v_link_lista := '/e/' || v_doc.empresa_id::text || '/documentos?status=recebido';
  v_detalhe := concat_ws(' · ',
    coalesce(nullif(trim(p_arquivo), ''), 'arquivo') || case when coalesce(p_versao, 1) > 1 then ' (nova versão)' else '' end,
    v_categoria,
    case when v_doc.competencia is not null then 'competência ' || to_char(v_doc.competencia, 'MM/YYYY') end,
    case when v_autor is not null then 'enviado por ' || v_autor end);

  for r in
    select d.user_id, d.email from app.destinatarios_aviso_arquivo(v_doc.empresa_id) d
     where d.user_id is distinct from auth.uid()
  loop
    -- Quem já foi avisado deste arquivo nesta mesma operação (ex.: recebido após
    -- o fechamento) não recebe um segundo aviso.
    if exists (select 1 from public.notificacoes n
                where n.user_id = r.user_id and n.link = v_link_doc and n.created_at = now()) then
      continue;
    end if;

    select * into v_n
      from public.notificacoes n
     where n.user_id = r.user_id
       and n.empresa_id = v_doc.empresa_id
       and n.tipo = 'arquivo_cliente'
       and n.lida_em is null
       and n.created_at > now() - interval '30 minutes'
     order by n.created_at desc
     limit 1
     for update;

    if found then
      v_qtd := v_n.quantidade + 1;
      v_titulo := v_empresa || ' enviou ' || v_qtd || ' arquivos';
      update public.notificacoes
         set quantidade = v_qtd, titulo = v_titulo, corpo = 'Último: ' || v_detalhe, link = v_link_lista, created_at = now()
       where id = v_n.id;
      -- O resumo por e-mail ainda não enviado passa a descrever o conjunto.
      update public.envios
         set assunto = v_titulo, conteudo = 'Último: ' || v_detalhe
       where referencia_tipo = 'notificacao' and referencia_id = v_n.id::text and status = 'pendente';
      perform app.avisar_aparelhos(v_n.id);
    else
      v_id := app.notificar(r.user_id, v_doc.empresa_id, 'arquivo_cliente', 'Novo arquivo de ' || v_empresa,
                            v_detalhe, v_link_doc, false);
      if v_id is not null and r.email is not null then
        insert into public.envios (empresa_id, user_id, canal, destinatario, assunto, conteudo, tipo, referencia_tipo, referencia_id, solicitado_por)
        values (v_doc.empresa_id, r.user_id, 'email', r.email, 'Novo arquivo de ' || v_empresa, v_detalhe,
                'arquivo_cliente', 'notificacao', v_id::text, auth.uid())
        returning id into v_envio;
        perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), v_doc.empresa_id,
                               'envio:' || v_envio::text, now() + interval '10 minutes', 50);
      end if;
    end if;
    v_total := v_total + 1;
  end loop;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Confirmação de envio: passa a avisar o escritório de todo arquivo do cliente
-- (o restante da função é idêntico à versão anterior)
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_upload(p_versao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao public.documento_versoes;
  v_doc public.documentos;
  v_obj record;
  v_tamanho bigint;
  v_mime text;
  v_fechada boolean;
begin
  select * into v_versao from public.documento_versoes where id = p_versao_id for update;
  if not found then
    raise exception 'Envio não encontrado.';
  end if;
  select * into v_doc from public.documentos where id = v_versao.documento_id for update;

  if v_doc.direcao = 'escritorio' then
    perform app.exigir(v_doc.empresa_id, 'documentos.publicar');
  else
    perform app.exigir(v_doc.empresa_id, 'documentos.enviar');
  end if;
  if v_versao.enviado_por is distinct from auth.uid() and not app.e_equipe_da_empresa(v_doc.empresa_id) then
    raise exception 'Somente quem iniciou o envio pode confirmá-lo.';
  end if;

  if v_versao.upload_concluido_em is not null then
    return jsonb_build_object('documento_id', v_doc.id, 'versao', v_versao.versao, 'ja_confirmado', true);
  end if;

  select o.metadata into v_obj
    from storage.objects o
   where o.bucket_id = 'documentos' and o.name = v_versao.storage_path;
  if not found then
    raise exception 'O arquivo não chegou ao armazenamento. Tente enviar novamente.';
  end if;
  v_tamanho := coalesce((v_obj.metadata ->> 'size')::bigint, v_versao.tamanho);
  v_mime := coalesce(v_obj.metadata ->> 'mimetype', v_versao.mime);

  update public.documento_versoes
     set upload_concluido_em = now(), tamanho = v_tamanho, mime = left(v_mime, 150)
   where id = v_versao.id;

  v_fechada := app.competencia_fechada(v_doc.empresa_id, v_doc.competencia);

  if v_versao.versao = 1 then
    update public.documentos
       set upload_status = 'concluido',
           enviado_em = now(),
           tamanho = v_tamanho,
           mime = left(v_mime, 150),
           publicado_em = case when direcao = 'escritorio' then now() else null end,
           recebido_apos_fechamento = (direcao = 'cliente' and v_fechada)
     where id = v_doc.id;
    insert into public.documento_historico (documento_id, empresa_id, acao, status_novo, detalhes)
    values (v_doc.id, v_doc.empresa_id,
            case when v_doc.direcao = 'escritorio' then 'publicado' else 'recebido' end,
            v_doc.status,
            jsonb_build_object('versao', 1, 'arquivo', v_versao.nome_original, 'tamanho', v_tamanho));
  else
    update public.documentos
       set versao_atual = v_versao.versao,
           storage_path = v_versao.storage_path,
           nome_original = v_versao.nome_original,
           extensao = app.extensao_arquivo(v_versao.nome_original),
           tamanho = v_tamanho,
           mime = left(v_mime, 150),
           sha256 = v_versao.sha256,
           status = case when direcao = 'cliente' then 'recebido' else null end,
           status_motivo = null,
           status_alterado_em = now(),
           status_alterado_por = auth.uid(),
           verificacao_status = 'pendente',
           processamento_status = 'pendente',
           recebido_apos_fechamento = recebido_apos_fechamento or (direcao = 'cliente' and v_fechada)
     where id = v_doc.id;
    insert into public.documento_historico (documento_id, empresa_id, acao, status_anterior, status_novo, motivo, detalhes)
    values (v_doc.id, v_doc.empresa_id, 'substituido', v_doc.status,
            case when v_doc.direcao = 'cliente' then 'recebido' else null end,
            v_versao.motivo,
            jsonb_build_object('versao', v_versao.versao, 'arquivo', v_versao.nome_original));
  end if;

  perform app.enfileirar(
    'processar_documento',
    jsonb_build_object('documento_id', v_doc.id, 'versao_id', v_versao.id),
    v_doc.empresa_id,
    'processar_documento:' || v_versao.id::text,
    now(),
    20
  );

  if v_doc.checklist_item_id is not null then
    perform app.recalcular_item_checklist(v_doc.checklist_item_id);
  end if;

  if v_doc.direcao = 'escritorio' then
    perform app.notificar_clientes(
      v_doc.empresa_id, 'documentos.ver', 'documento_escritorio',
      'Novo documento disponível: ' || coalesce(v_doc.titulo, v_doc.nome_original),
      'O escritório disponibilizou um documento para sua empresa.',
      '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
      true
    );
  else
    if v_fechada then
      perform app.notificar_equipe(
        v_doc.empresa_id, 'documento_apos_fechamento',
        'Documento recebido após o fechamento',
        'O documento "' || v_versao.nome_original || '" chegou para a competência ' || to_char(v_doc.competencia, 'MM/YYYY') || ', que já está fechada. Avalie o impacto.',
        '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
        true
      );
    end if;
    -- Aviso ao escritório: o cliente enviou um arquivo (agrupado por empresa).
    perform app.avisar_arquivo_cliente(v_doc.id, v_versao.nome_original, v_versao.versao);
  end if;

  return jsonb_build_object('documento_id', v_doc.id, 'versao', v_versao.versao, 'ja_confirmado', false,
                            'recebido_apos_fechamento', v_fechada);
end;
$$;


-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
revoke execute on function
  public.registrar_aparelho_push(text, text, text, text),
  public.remover_aparelho_push(uuid, text),
  public.enviar_aviso_teste(),
  public.sistema_push_destinos(uuid),
  public.sistema_push_resultado(uuid, boolean, boolean)
from public, anon;
revoke execute on function
  public.sistema_push_destinos(uuid),
  public.sistema_push_resultado(uuid, boolean, boolean)
from authenticated;
grant execute on function
  public.registrar_aparelho_push(text, text, text, text),
  public.remover_aparelho_push(uuid, text),
  public.enviar_aviso_teste()
to authenticated;
grant execute on function
  public.sistema_push_destinos(uuid),
  public.sistema_push_resultado(uuid, boolean, boolean)
to service_role;
grant execute on function
  app.push_endpoint_valido(text),
  app.avisar_aparelhos(uuid),
  app.destinatarios_aviso_arquivo(uuid),
  app.avisar_arquivo_cliente(uuid, text, int)
to authenticated, service_role;
revoke execute on function
  app.push_endpoint_valido(text),
  app.avisar_aparelhos(uuid),
  app.destinatarios_aviso_arquivo(uuid),
  app.avisar_arquivo_cliente(uuid, text, int)
from public, anon;
