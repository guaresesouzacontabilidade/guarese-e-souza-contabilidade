-- =============================================================================
-- Migração 0600: central de mensagens e solicitações (cliente ↔ escritório)
-- =============================================================================

-- Empresas em que o usuário atua como equipe do escritório.
create or replace function app.empresas_equipe()
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text;
  v_ids uuid[];
begin
  v_tipo := app.tipo_usuario();
  if v_tipo is null or v_tipo = 'cliente' or not app.usuario_valido() then
    return array[]::uuid[];
  end if;
  if v_tipo = 'admin' then
    select coalesce(array_agg(id), array[]::uuid[]) into v_ids from public.empresas;
    return v_ids;
  end if;
  select coalesce(array_agg(m.empresa_id), array[]::uuid[]) into v_ids
    from public.empresa_membros m
   where m.user_id = auth.uid() and m.ativo and m.papel = 'equipe';
  return v_ids;
end;
$$;

create table public.conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  assunto text not null check (length(trim(assunto)) between 1 and 200),
  tipo text not null default 'mensagem' check (tipo in ('mensagem', 'solicitacao')),
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  aguardando text check (aguardando in ('cliente', 'escritorio')),
  competencia date check (competencia is null or extract(day from competencia) = 1),
  documento_id uuid references public.documentos(id) on delete set null,
  checklist_item_id uuid references public.checklist_itens(id) on delete set null,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ultima_mensagem_em timestamptz not null default now()
);
create index conversas_empresa_idx on public.conversas (empresa_id, ultima_mensagem_em desc);
create index conversas_documento_idx on public.conversas (documento_id);
create trigger conversas_updated_at before update on public.conversas
  for each row execute function app.tg_updated_at();

create table public.mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  autor_id uuid references public.perfis(id) on delete set null default auth.uid(),
  corpo text not null check (length(corpo) between 1 and 10000),
  interna boolean not null default false,
  documento_ids uuid[] not null default array[]::uuid[],
  created_at timestamptz not null default now()
);
create index mensagens_conversa_idx on public.mensagens (conversa_id, created_at);

create table public.conversa_leituras (
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  user_id uuid not null references public.perfis(id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (conversa_id, user_id)
);

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function app.validar_anexos(p_empresa_id uuid, p_documento_ids uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_documento_ids is null or cardinality(p_documento_ids) = 0 then
    return;
  end if;
  if exists (
    select 1 from unnest(p_documento_ids) as a(id)
     where not exists (select 1 from public.documentos d where d.id = a.id and d.empresa_id = p_empresa_id)
  ) then
    raise exception 'Anexo inválido para esta empresa.';
  end if;
end;
$$;

create or replace function public.criar_conversa(
  p_empresa_id uuid,
  p_assunto text,
  p_corpo text,
  p_tipo text default 'mensagem',
  p_competencia date default null,
  p_documento_id uuid default null,
  p_checklist_item_id uuid default null,
  p_documento_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_equipe boolean;
begin
  perform app.exigir(p_empresa_id, 'mensagens.usar');
  if coalesce(trim(p_assunto), '') = '' or coalesce(trim(p_corpo), '') = '' then
    raise exception 'Informe o assunto e a mensagem.';
  end if;
  if p_tipo not in ('mensagem', 'solicitacao') then
    raise exception 'Tipo inválido.';
  end if;
  if p_documento_id is not null and not exists (select 1 from public.documentos where id = p_documento_id and empresa_id = p_empresa_id) then
    raise exception 'Documento inválido para esta empresa.';
  end if;
  if p_checklist_item_id is not null and not exists (select 1 from public.checklist_itens where id = p_checklist_item_id and empresa_id = p_empresa_id) then
    raise exception 'Item do checklist inválido para esta empresa.';
  end if;
  perform app.validar_anexos(p_empresa_id, p_documento_ids);
  v_equipe := p_empresa_id = any(app.empresas_equipe());

  insert into public.conversas (empresa_id, assunto, tipo, competencia, documento_id, checklist_item_id, aguardando)
  values (p_empresa_id, trim(p_assunto), p_tipo, app.competencia_de(p_competencia), p_documento_id, p_checklist_item_id,
          case when v_equipe then 'cliente' else 'escritorio' end)
  returning id into v_id;

  insert into public.mensagens (conversa_id, empresa_id, corpo, documento_ids)
  values (v_id, p_empresa_id, trim(p_corpo), coalesce(p_documento_ids, array[]::uuid[]));

  insert into public.conversa_leituras (conversa_id, user_id) values (v_id, auth.uid())
  on conflict (conversa_id, user_id) do update set lida_em = now();

  if v_equipe then
    perform app.notificar_clientes(p_empresa_id, 'mensagens.usar', 'mensagem',
      case when p_tipo = 'solicitacao' then 'Nova solicitação do escritório: ' else 'Nova mensagem do escritório: ' end || trim(p_assunto),
      left(trim(p_corpo), 300), '/e/' || p_empresa_id::text || '/mensagens/' || v_id::text, true);
  else
    perform app.notificar_equipe(p_empresa_id, 'mensagem',
      'Nova mensagem do cliente: ' || trim(p_assunto),
      left(trim(p_corpo), 300), '/e/' || p_empresa_id::text || '/mensagens/' || v_id::text, false);
  end if;
  return v_id;
end;
$$;

create or replace function public.enviar_mensagem(
  p_conversa_id uuid,
  p_corpo text,
  p_interna boolean default false,
  p_documento_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversas;
  v_id uuid;
  v_equipe boolean;
begin
  select * into v_conv from public.conversas where id = p_conversa_id for update;
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  perform app.exigir(v_conv.empresa_id, 'mensagens.usar');
  if coalesce(trim(p_corpo), '') = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  v_equipe := v_conv.empresa_id = any(app.empresas_equipe());
  if coalesce(p_interna, false) and not v_equipe then
    raise exception 'Somente a equipe pode registrar notas internas.';
  end if;
  perform app.validar_anexos(v_conv.empresa_id, p_documento_ids);

  insert into public.mensagens (conversa_id, empresa_id, corpo, interna, documento_ids)
  values (v_conv.id, v_conv.empresa_id, trim(p_corpo), coalesce(p_interna, false), coalesce(p_documento_ids, array[]::uuid[]))
  returning id into v_id;

  if not coalesce(p_interna, false) then
    update public.conversas
       set ultima_mensagem_em = now(),
           status = 'aberta',
           aguardando = case when v_equipe then 'cliente' else 'escritorio' end
     where id = v_conv.id;
  end if;

  insert into public.conversa_leituras (conversa_id, user_id) values (v_conv.id, auth.uid())
  on conflict (conversa_id, user_id) do update set lida_em = now();

  if coalesce(p_interna, false) then
    return v_id;
  end if;
  if v_equipe then
    perform app.notificar_clientes(v_conv.empresa_id, 'mensagens.usar', 'mensagem',
      'Resposta do escritório: ' || v_conv.assunto, left(trim(p_corpo), 300),
      '/e/' || v_conv.empresa_id::text || '/mensagens/' || v_conv.id::text, true);
  else
    perform app.notificar_equipe(v_conv.empresa_id, 'mensagem',
      'Resposta do cliente: ' || v_conv.assunto, left(trim(p_corpo), 300),
      '/e/' || v_conv.empresa_id::text || '/mensagens/' || v_conv.id::text, false);
  end if;
  return v_id;
end;
$$;

create or replace function public.alterar_status_conversa(p_conversa_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv public.conversas;
begin
  select * into v_conv from public.conversas where id = p_conversa_id for update;
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  perform app.exigir(v_conv.empresa_id, 'mensagens.usar');
  if p_status not in ('aberta', 'resolvida') then
    raise exception 'Status inválido.';
  end if;
  update public.conversas
     set status = p_status, aguardando = case when p_status = 'resolvida' then null else aguardando end
   where id = v_conv.id;
end;
$$;

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
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;
alter table public.conversa_leituras enable row level security;

create policy conversas_leitura on public.conversas for select to authenticated
  using (empresa_id = any ((select app.empresas_com('mensagens.usar'))::uuid[]));

create policy mensagens_leitura on public.mensagens for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('mensagens.usar'))::uuid[])
    and (not interna or empresa_id = any ((select app.empresas_equipe())::uuid[]))
  );

create policy conversa_leituras_leitura on public.conversa_leituras for select to authenticated
  using (user_id = (select auth.uid()));
