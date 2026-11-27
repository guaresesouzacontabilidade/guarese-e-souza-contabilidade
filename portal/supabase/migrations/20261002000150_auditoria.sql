-- =============================================================================
-- Migração 0150: histórico de auditoria (somente inserção)
-- =============================================================================

create table public.auditoria (
  id bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  user_id uuid,
  user_email text,
  empresa_id uuid,
  acao text not null,
  entidade text not null,
  entidade_id text,
  dados_antes jsonb,
  dados_depois jsonb,
  detalhes jsonb,
  ip text,
  user_agent text
);

create index auditoria_empresa_idx on public.auditoria (empresa_id, ocorrido_em desc);
create index auditoria_usuario_idx on public.auditoria (user_id, ocorrido_em desc);
create index auditoria_entidade_idx on public.auditoria (entidade, entidade_id);
create index auditoria_ocorrido_idx on public.auditoria (ocorrido_em desc);

-- Registro explícito de eventos (downloads, login, exportações etc.).
create or replace function app.registrar_auditoria(
  p_acao text,
  p_entidade text,
  p_entidade_id text default null,
  p_empresa_id uuid default null,
  p_detalhes jsonb default null,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.auditoria (user_id, user_email, empresa_id, acao, entidade, entidade_id, detalhes, ip, user_agent)
  values (
    auth.uid(),
    (select p.email from public.perfis p where p.id = auth.uid()),
    p_empresa_id,
    p_acao,
    p_entidade,
    p_entidade_id,
    p_detalhes,
    left(p_ip, 100),
    left(p_user_agent, 500)
  );
end;
$$;

-- Gatilho genérico: registra inserções, alterações (somente campos alterados) e exclusões.
create or replace function app.tg_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_antes jsonb;
  v_depois jsonb;
  v_empresa uuid;
  v_acao text;
  v_registro jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_acao := 'inserir';
    v_depois := v_new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_acao := 'alterar';
    select jsonb_object_agg(e.key, e.value)
      into v_depois
      from jsonb_each(v_new) e
     where (v_old -> e.key) is distinct from e.value
       and e.key not in ('updated_at', 'ultimo_acesso_em');
    if v_depois is null then
      return null;
    end if;
    select jsonb_object_agg(e.key, v_old -> e.key)
      into v_antes
      from jsonb_each(v_depois) e;
  else
    v_old := to_jsonb(old);
    v_acao := 'excluir';
    v_antes := v_old;
  end if;

  v_registro := coalesce(v_new, v_old);
  if tg_table_name = 'empresas' then
    v_empresa := app.try_uuid(v_registro ->> 'id');
  else
    v_empresa := app.try_uuid(v_registro ->> 'empresa_id');
  end if;

  insert into public.auditoria (user_id, user_email, empresa_id, acao, entidade, entidade_id, dados_antes, dados_depois)
  values (
    auth.uid(),
    (select p.email from public.perfis p where p.id = auth.uid()),
    v_empresa,
    v_acao,
    tg_table_name,
    coalesce(v_registro ->> 'id', v_registro ->> 'competencia'),
    v_antes,
    v_depois
  );
  return null;
end;
$$;

create trigger auditoria_escritorio
  after insert or update or delete on public.escritorio
  for each row execute function app.tg_auditoria();

create trigger auditoria_perfis
  after insert or update or delete on public.perfis
  for each row execute function app.tg_auditoria();
