-- App da Lelé: sincronização entre aparelhos por "código de sincronização".
-- Não há login: quem tem o código (20 caracteres, ~100 bits) lê e grava os próprios dados.
-- O código nunca é guardado: o banco guarda só um hash dele (coluna vault).
-- A tabela não é acessível diretamente; tudo passa pelas funções lele_pull e lele_push.

create table if not exists public.lele_records (
  vault text not null check (char_length(vault) = 64),
  collection text not null check (collection in ('decks', 'notes', 'cards', 'media', 'logs', 'settings')),
  id text not null check (char_length(id) between 1 and 120),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  client_updated_at bigint not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (vault, collection, id),
  constraint lele_records_data_size check (pg_column_size(data) < 1500000)
);

comment on table public.lele_records is 'Dados do App da Lelé (flashcards), um registro por linha, separados por hash do código de sincronização.';

create index if not exists lele_records_vault_server_updated_idx
  on public.lele_records (vault, server_updated_at);

alter table public.lele_records enable row level security;
-- Sem políticas: ninguém lê ou grava a tabela direto pela API.
revoke all on public.lele_records from anon, authenticated;

-- Hash do código (valida o formato antes).
create or replace function public.lele_vault(p_code text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_code is null or p_code !~ '^[A-HJ-NP-Z2-9]{20}$' then
    raise exception 'código de sincronização inválido' using errcode = '22023';
  end if;
  return encode(sha256(convert_to('app-da-lele:' || p_code, 'UTF8')), 'hex');
end;
$$;

revoke all on function public.lele_vault(text) from public, anon, authenticated;

-- Envia alterações. Vale a mais recente (client_updated_at); gravações antigas são ignoradas.
create or replace function public.lele_push(p_code text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := public.lele_vault(p_code);
  n integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'lote inválido' using errcode = '22023';
  end if;
  if (select count(*) from public.lele_records r where r.vault = v) > 100000 then
    raise exception 'limite de registros atingido' using errcode = '54000';
  end if;
  insert into public.lele_records as r (vault, collection, id, data, deleted, client_updated_at)
  select v,
         e->>'c',
         e->>'i',
         case when coalesce((e->>'x')::boolean, false) then '{}'::jsonb else coalesce(e->'d', '{}'::jsonb) end,
         coalesce((e->>'x')::boolean, false),
         (e->>'u')::bigint
  from jsonb_array_elements(p_rows) as e
  on conflict (vault, collection, id) do update
    set data = excluded.data,
        deleted = excluded.deleted,
        client_updated_at = excluded.client_updated_at,
        server_updated_at = clock_timestamp()
    where r.client_updated_at <= excluded.client_updated_at;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Baixa o que mudou desde `p_since` (em ordem, no máximo 1000 por vez).
create or replace function public.lele_pull(p_code text, p_since timestamptz default null, p_limit integer default 500)
returns table (
  collection text,
  id text,
  data jsonb,
  deleted boolean,
  client_updated_at bigint,
  server_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.collection, r.id, r.data, r.deleted, r.client_updated_at, r.server_updated_at
  from public.lele_records r
  where r.vault = public.lele_vault(p_code)
    and r.server_updated_at > coalesce(p_since, '-infinity'::timestamptz)
  order by r.server_updated_at
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

revoke all on function public.lele_push(text, jsonb) from public;
revoke all on function public.lele_pull(text, timestamptz, integer) from public;
grant execute on function public.lele_push(text, jsonb) to anon, authenticated;
grant execute on function public.lele_pull(text, timestamptz, integer) to anon, authenticated;
