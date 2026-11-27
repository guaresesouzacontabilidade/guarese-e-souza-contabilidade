-- =============================================================================
-- Migração 0250: fila de processamento em segundo plano, notificações e envios
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fila de tarefas (importações, OCR, e-mails, WhatsApp, relatórios, rotinas)
-- -----------------------------------------------------------------------------
create table public.jobs (
  id bigint generated always as identity primary key,
  tipo text not null,
  payload jsonb not null default '{}'::jsonb,
  empresa_id uuid references public.empresas(id) on delete cascade,
  status text not null default 'pendente'
    check (status in ('pendente', 'executando', 'concluido', 'falhou', 'cancelado')),
  prioridade int not null default 100,
  tentativas int not null default 0,
  max_tentativas int not null default 5,
  executar_apos timestamptz not null default now(),
  bloqueado_ate timestamptz,
  chave_idempotencia text unique,
  worker text,
  erro text,
  resultado jsonb,
  created_at timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
create index jobs_fila_idx on public.jobs (prioridade, executar_apos) where status = 'pendente';
create index jobs_execucao_idx on public.jobs (bloqueado_ate) where status = 'executando';
create index jobs_empresa_idx on public.jobs (empresa_id, created_at desc);

-- Enfileira uma tarefa de forma idempotente (mesma chave = mesma tarefa).
create or replace function app.enfileirar(
  p_tipo text,
  p_payload jsonb default '{}'::jsonb,
  p_empresa_id uuid default null,
  p_chave text default null,
  p_executar_apos timestamptz default now(),
  p_prioridade int default 100
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.jobs (tipo, payload, empresa_id, chave_idempotencia, executar_apos, prioridade)
  values (p_tipo, coalesce(p_payload, '{}'::jsonb), p_empresa_id, p_chave, coalesce(p_executar_apos, now()), p_prioridade)
  on conflict (chave_idempotencia) do nothing
  returning id into v_id;
  if v_id is null and p_chave is not null then
    select id into v_id from public.jobs where chave_idempotencia = p_chave;
  end if;
  return v_id;
end;
$$;

-- Reserva tarefas para um processador (somente service_role).
create or replace function public.jobs_reservar(p_limite int default 10, p_worker text default null, p_tipos text[] default null)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Tarefas travadas além do limite de tentativas são encerradas como falha.
  update public.jobs
     set status = 'falhou',
         erro = coalesce(erro, '') || ' [tempo de execução esgotado]',
         concluido_em = now()
   where status = 'executando'
     and bloqueado_ate < now()
     and tentativas >= max_tentativas;

  return query
  with candidatos as (
    select j.id
      from public.jobs j
     where (
             (j.status = 'pendente' and j.executar_apos <= now())
          or (j.status = 'executando' and j.bloqueado_ate < now() and j.tentativas < j.max_tentativas)
           )
       and (p_tipos is null or j.tipo = any(p_tipos))
     order by j.prioridade, j.executar_apos, j.id
     limit greatest(1, least(coalesce(p_limite, 10), 100))
     for update skip locked
  )
  update public.jobs j
     set status = 'executando',
         tentativas = j.tentativas + 1,
         iniciado_em = now(),
         bloqueado_ate = now() + interval '10 minutes',
         worker = p_worker
    from candidatos c
   where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.jobs_concluir(p_id bigint, p_resultado jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
     set status = 'concluido', resultado = p_resultado, erro = null, concluido_em = now(), bloqueado_ate = null
   where id = p_id;
$$;

create or replace function public.jobs_falhar(p_id bigint, p_erro text, p_reprogramar_segundos int default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = p_id for update;
  if not found then
    return;
  end if;
  if v_job.tentativas >= v_job.max_tentativas or p_reprogramar_segundos is null then
    update public.jobs
       set status = 'falhou',
           erro = left(p_erro, 4000),
           concluido_em = now(),
           bloqueado_ate = null
     where id = p_id;
  else
    update public.jobs
       set status = 'pendente',
           erro = left(p_erro, 4000),
           executar_apos = now() + make_interval(secs => p_reprogramar_segundos),
           bloqueado_ate = null
     where id = p_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notificações no sistema
-- -----------------------------------------------------------------------------
create table public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.perfis(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  corpo text,
  link text,
  lida_em timestamptz,
  created_at timestamptz not null default now()
);
create index notificacoes_usuario_idx on public.notificacoes (user_id, created_at desc);
create index notificacoes_nao_lidas_idx on public.notificacoes (user_id) where lida_em is null;

-- -----------------------------------------------------------------------------
-- Envios externos (e-mail e WhatsApp) com histórico
-- -----------------------------------------------------------------------------
create table public.envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete cascade,
  user_id uuid references public.perfis(id) on delete set null,
  canal text not null check (canal in ('email', 'whatsapp')),
  destinatario text not null,
  assunto text,
  conteudo text,
  tipo text not null default 'notificacao',
  referencia_tipo text,
  referencia_id text,
  status text not null default 'pendente'
    check (status in ('pendente', 'enviado', 'falhou', 'nao_configurado', 'desativado')),
  tentativas int not null default 0,
  erro text,
  provedor_id text,
  solicitado_por uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now(),
  enviado_em timestamptz
);
create index envios_empresa_idx on public.envios (empresa_id, created_at desc);
create index envios_usuario_idx on public.envios (user_id, created_at desc);
create index envios_referencia_idx on public.envios (referencia_tipo, referencia_id);

-- Cria notificação para um usuário e, se desejado, programa o e-mail.
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
  return v_id;
end;
$$;

-- Notifica os clientes de uma empresa que tenham a permissão indicada.
create or replace function app.notificar_clientes(
  p_empresa_id uuid,
  p_permissao text,
  p_tipo text,
  p_titulo text,
  p_corpo text default null,
  p_link text default null,
  p_email boolean default true
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select m.user_id
      from public.empresa_membros m
      join public.perfis p on p.id = m.user_id and p.ativo
     where m.empresa_id = p_empresa_id
       and m.ativo
       and m.papel in ('cliente_titular', 'cliente_colaborador')
       and (p_permissao is null or p_permissao = any(m.permissoes))
       and m.user_id is distinct from auth.uid()
  loop
    perform app.notificar(r.user_id, p_empresa_id, p_tipo, p_titulo, p_corpo, p_link, p_email);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Notifica a equipe vinculada à empresa (e o contador responsável). Se não
-- houver equipe vinculada, notifica os administradores.
create or replace function app.notificar_equipe(
  p_empresa_id uuid,
  p_tipo text,
  p_titulo text,
  p_corpo text default null,
  p_link text default null,
  p_email boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select distinct u.user_id
      from (
        select m.user_id
          from public.empresa_membros m
         where m.empresa_id = p_empresa_id and m.ativo and m.papel = 'equipe'
        union
        select e.contador_responsavel_id
          from public.empresas e
         where e.id = p_empresa_id and e.contador_responsavel_id is not null
      ) u
      join public.perfis p on p.id = u.user_id and p.ativo
     where u.user_id is distinct from auth.uid()
  loop
    perform app.notificar(r.user_id, p_empresa_id, p_tipo, p_titulo, p_corpo, p_link, p_email);
    n := n + 1;
  end loop;

  if n = 0 then
    for r in
      select p.id as user_id from public.perfis p
       where p.tipo = 'admin' and p.ativo and p.id is distinct from auth.uid()
    loop
      perform app.notificar(r.user_id, p_empresa_id, p_tipo, p_titulo, p_corpo, p_link, p_email);
      n := n + 1;
    end loop;
  end if;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.notificacoes enable row level security;
alter table public.envios enable row level security;

-- Fila: leitura apenas para administradores (diagnóstico). Escrita só pelo servidor.
create policy jobs_leitura on public.jobs for select to authenticated
  using ((select app.is_admin()));

create policy notificacoes_leitura on public.notificacoes for select to authenticated
  using (user_id = (select auth.uid()) and (select app.usuario_valido()));
create policy notificacoes_marcar_lida on public.notificacoes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy envios_leitura on public.envios for select to authenticated
  using (
    (select app.is_admin())
    or user_id = (select auth.uid())
    or ((select app.is_equipe()) and empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]))
  );
