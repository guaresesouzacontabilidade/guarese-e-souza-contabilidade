-- =============================================================================
-- Migração 0200: empresas clientes, vínculos, permissões e funções de acesso
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catálogo de permissões
-- -----------------------------------------------------------------------------
create or replace function app.permissoes_validas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'empresa.ver',
    'empresa.editar',
    'usuarios.gerenciar',
    'documentos.ver',
    'documentos.enviar',
    'documentos.baixar',
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'financeiro.ver',
    'financeiro.editar',
    'financeiro.importar',
    'conciliacao.executar',
    'relatorios.ver',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'mensagens.usar'
  ]::text[];
$$;

-- Permissões que somente a equipe do escritório pode receber.
create or replace function app.permissoes_exclusivas_equipe()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir'
  ]::text[];
$$;

create or replace function app.permissoes_padrao(p_papel text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'equipe' then array[
      'empresa.ver', 'empresa.editar', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar', 'documentos.revisar', 'documentos.publicar',
      'checklist.gerenciar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar', 'conciliacao.executar',
      'relatorios.ver', 'relatorios.publicar',
      'fechamento.gerenciar',
      'mensagens.usar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end::text[];
$$;

-- -----------------------------------------------------------------------------
-- Empresas clientes
-- -----------------------------------------------------------------------------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null check (length(trim(razao_social)) > 1),
  nome_fantasia text,
  tipo_pessoa text not null default 'PJ' check (tipo_pessoa in ('PJ', 'PF')),
  documento text not null,                 -- CNPJ (PJ) ou CPF (PF), somente dígitos
  inscricao_estadual text,
  inscricao_municipal text,
  regime_tributario text not null check (regime_tributario in (
    'mei', 'simples_nacional', 'lucro_presumido', 'lucro_real',
    'imune_isenta', 'produtor_rural', 'pessoa_fisica', 'outro'
  )),
  atividade_principal text,
  cnae text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf char(2),
  cep text,
  email text,
  telefone text,
  contador_responsavel_id uuid references public.perfis(id) on delete set null,
  data_inicio_atendimento date,
  servicos text[] not null default array['contabil', 'fiscal']::text[]
    check (servicos <@ array['contabil', 'fiscal', 'folha', 'financeiro', 'societario', 'imposto_renda']::text[]),
  controla_estoque boolean not null default false,
  observacoes text,
  ativa boolean not null default true,
  demonstracao boolean not null default false,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint empresas_documento_unico unique (documento),
  constraint empresas_documento_valido check (
    (tipo_pessoa = 'PJ' and app.cnpj_valido(documento)) or
    (tipo_pessoa = 'PF' and app.cpf_valido(documento))
  )
);

create index empresas_nome_idx on public.empresas using gin (app.normalizar(razao_social || ' ' || coalesce(nome_fantasia, '')) extensions.gin_trgm_ops);
create trigger empresas_updated_at before update on public.empresas
  for each row execute function app.tg_updated_at();
create trigger auditoria_empresas after insert or update or delete on public.empresas
  for each row execute function app.tg_auditoria();

-- Responsáveis e contatos da empresa
create table public.empresa_contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  funcao text not null default 'outro' check (funcao in ('socio_administrador', 'socio', 'financeiro', 'rh', 'fiscal', 'outro')),
  email text,
  telefone text,
  whatsapp text,
  principal boolean not null default false,
  recebe_lembretes boolean not null default true,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index empresa_contatos_empresa_idx on public.empresa_contatos (empresa_id);
create trigger empresa_contatos_updated_at before update on public.empresa_contatos
  for each row execute function app.tg_updated_at();
create trigger auditoria_empresa_contatos after insert or update or delete on public.empresa_contatos
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- Vínculos de usuários com empresas e permissões por operação
-- -----------------------------------------------------------------------------
create table public.empresa_membros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references public.perfis(id) on delete cascade,
  papel text not null check (papel in ('equipe', 'cliente_titular', 'cliente_colaborador')),
  permissoes text[] not null default array[]::text[],
  ativo boolean not null default true,
  convidado_por uuid references public.perfis(id) on delete set null,
  convidado_em timestamptz not null default now(),
  revogado_por uuid references public.perfis(id) on delete set null,
  revogado_em timestamptz,
  motivo_revogacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint empresa_membros_unico unique (empresa_id, user_id),
  constraint empresa_membros_permissoes_validas check (permissoes <@ app.permissoes_validas())
);
create index empresa_membros_usuario_idx on public.empresa_membros (user_id) where ativo;
create index empresa_membros_empresa_idx on public.empresa_membros (empresa_id) where ativo;
create trigger empresa_membros_updated_at before update on public.empresa_membros
  for each row execute function app.tg_updated_at();
create trigger auditoria_empresa_membros after insert or update or delete on public.empresa_membros
  for each row execute function app.tg_auditoria();

-- Coerência entre tipo do usuário, papel e permissões.
create or replace function app.tg_validar_membro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from public.perfis where id = new.user_id;
  if v_tipo is null then
    raise exception 'Usuário inexistente.';
  end if;
  if new.papel = 'equipe' and v_tipo not in ('admin', 'equipe') then
    raise exception 'Somente usuários da equipe do escritório podem ter o papel "equipe".';
  end if;
  if new.papel <> 'equipe' and v_tipo <> 'cliente' then
    raise exception 'Usuários da equipe não podem ser vinculados como clientes.';
  end if;
  if new.papel <> 'equipe' and new.permissoes && app.permissoes_exclusivas_equipe() then
    raise exception 'Permissões exclusivas da equipe não podem ser concedidas a clientes.';
  end if;
  -- Quem pode ver qualquer coisa precisa ao menos ver a empresa.
  if cardinality(new.permissoes) > 0 and not ('empresa.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'empresa.ver');
  end if;
  -- Baixar documentos implica ver documentos.
  if 'documentos.baixar' = any(new.permissoes) and not ('documentos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'documentos.ver');
  end if;
  if 'financeiro.editar' = any(new.permissoes) and not ('financeiro.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'financeiro.ver');
  end if;
  return new;
end;
$$;

create trigger empresa_membros_validar before insert or update on public.empresa_membros
  for each row execute function app.tg_validar_membro();

-- Registro de convites enviados (o usuário é criado no Supabase Auth)
create table public.convites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nome text,
  user_id uuid references public.perfis(id) on delete cascade,
  tipo_usuario text not null check (tipo_usuario in ('admin', 'equipe', 'cliente')),
  empresa_id uuid references public.empresas(id) on delete cascade,
  papel text check (papel in ('equipe', 'cliente_titular', 'cliente_colaborador')),
  permissoes text[] not null default array[]::text[],
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'cancelado')),
  envio_status text not null default 'pendente' check (envio_status in ('pendente', 'enviado', 'falhou', 'email_nao_configurado', 'link_copiado')),
  envio_erro text,
  convidado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  ultimo_envio_em timestamptz,
  aceito_em timestamptz
);
create index convites_email_idx on public.convites (lower(email));
create index convites_empresa_idx on public.convites (empresa_id);

-- -----------------------------------------------------------------------------
-- Funções de autorização (avaliadas no banco — valem para API, arquivos e RLS)
-- -----------------------------------------------------------------------------

-- A sessão do token ainda existe? (permite revogação imediata de sessões)
create or replace function app.sessao_valida()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when app.try_uuid(auth.jwt() ->> 'session_id') is null then false
    else exists (
      select 1
        from auth.sessions s
       where s.id = app.try_uuid(auth.jwt() ->> 'session_id')
         and s.user_id = auth.uid()
         and (s.not_after is null or s.not_after > now())
    )
  end;
$$;

-- Se o usuário cadastrou 2FA, exige sessão com nível aal2.
create or replace function app.aal_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

create or replace function app.tipo_usuario()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.tipo from public.perfis p where p.id = auth.uid() and p.ativo;
$$;

create or replace function app.usuario_valido()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text;
  v_exige boolean;
begin
  v_tipo := app.tipo_usuario();
  if v_tipo is null then
    return false;
  end if;
  if not app.sessao_valida() or not app.aal_ok() then
    return false;
  end if;
  select case when v_tipo in ('admin', 'equipe') then e.exigir_2fa_equipe else e.exigir_2fa_clientes end
    into v_exige
    from public.escritorio e
   where e.id = 1;
  if coalesce(v_exige, false) and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    return false;
  end if;
  return true;
end;
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.tipo_usuario() = 'admin' and app.usuario_valido();
$$;

create or replace function app.is_equipe()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.tipo_usuario() in ('admin', 'equipe') and app.usuario_valido();
$$;

-- Empresas em que o usuário possui determinada permissão.
create or replace function app.empresas_com(p_permissao text)
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
  if v_tipo is null or not app.usuario_valido() then
    return array[]::uuid[];
  end if;
  if v_tipo = 'admin' then
    select coalesce(array_agg(e.id), array[]::uuid[]) into v_ids from public.empresas e;
    return v_ids;
  end if;
  select coalesce(array_agg(m.empresa_id), array[]::uuid[])
    into v_ids
    from public.empresa_membros m
   where m.user_id = auth.uid()
     and m.ativo
     and p_permissao = any(m.permissoes);
  return v_ids;
end;
$$;

create or replace function app.pode(p_empresa_id uuid, p_permissao text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  if p_empresa_id is null then
    return false;
  end if;
  v_tipo := app.tipo_usuario();
  if v_tipo is null or not app.usuario_valido() then
    return false;
  end if;
  if v_tipo = 'admin' then
    return exists (select 1 from public.empresas e where e.id = p_empresa_id);
  end if;
  return exists (
    select 1 from public.empresa_membros m
     where m.empresa_id = p_empresa_id
       and m.user_id = auth.uid()
       and m.ativo
       and p_permissao = any(m.permissoes)
  );
end;
$$;

-- Lança erro amigável quando não há permissão (usada nas funções RPC).
create or replace function app.exigir(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.pode(p_empresa_id, p_permissao) then
    raise exception 'Acesso negado: você não tem a permissão "%" nesta empresa.', p_permissao
      using errcode = '42501';
  end if;
end;
$$;

grant execute on all functions in schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.escritorio enable row level security;
alter table public.perfis enable row level security;
alter table public.empresas enable row level security;
alter table public.empresa_contatos enable row level security;
alter table public.empresa_membros enable row level security;
alter table public.convites enable row level security;
alter table public.auditoria enable row level security;

-- Escritório: leitura para usuários válidos; alteração somente administrador.
create policy escritorio_leitura on public.escritorio for select to authenticated
  using ((select app.usuario_valido()));
create policy escritorio_alteracao on public.escritorio for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Perfis
create policy perfis_leitura on public.perfis for select to authenticated
  using (
    id = (select auth.uid())
    or (select app.is_admin())
    or (tipo in ('admin', 'equipe') and (select app.usuario_valido()))
    or exists (
      select 1 from public.empresa_membros m
       where m.user_id = perfis.id
         and m.empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[])
    )
  );
create policy perfis_alteracao_propria on public.perfis for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Empresas
create policy empresas_leitura on public.empresas for select to authenticated
  using (id = any ((select app.empresas_com('empresa.ver'))::uuid[]));
create policy empresas_insercao on public.empresas for insert to authenticated
  with check ((select app.is_admin()));
create policy empresas_alteracao on public.empresas for update to authenticated
  using (id = any ((select app.empresas_com('empresa.editar'))::uuid[]))
  with check (id = any ((select app.empresas_com('empresa.editar'))::uuid[]));

-- Contatos
create policy empresa_contatos_leitura on public.empresa_contatos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]));
create policy empresa_contatos_escrita on public.empresa_contatos for all to authenticated
  using (empresa_id = any ((select app.empresas_com('empresa.editar'))::uuid[]))
  with check (empresa_id = any ((select app.empresas_com('empresa.editar'))::uuid[]));

-- Vínculos: leitura para quem vê a empresa; escrita apenas por funções RPC.
create policy empresa_membros_leitura on public.empresa_membros for select to authenticated
  using (
    user_id = (select auth.uid())
    or empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[])
  );

-- Convites
create policy convites_leitura on public.convites for select to authenticated
  using (
    (select app.is_admin())
    or empresa_id = any ((select app.empresas_com('usuarios.gerenciar'))::uuid[])
  );

-- Auditoria: somente administrador lê; ninguém altera pela API.
create policy auditoria_leitura on public.auditoria for select to authenticated
  using ((select app.is_admin()));
