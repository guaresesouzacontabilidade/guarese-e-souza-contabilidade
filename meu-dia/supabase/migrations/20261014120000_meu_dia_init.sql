-- Meu Dia: armazenamento sincronizado por usuário.
-- Cada linha é um registro (compromisso, lançamento, conta, carteira ou ajustes) de UM usuário.
-- As regras de segurança (RLS) garantem que cada pessoa só lê e altera os próprios dados.

create table if not exists public.meudia_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null check (collection in ('events', 'transactions', 'wallets', 'bills', 'settings')),
  id text not null check (char_length(id) between 1 and 64),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 32768),
  deleted boolean not null default false,
  client_updated_at bigint not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, collection, id)
);

comment on table public.meudia_records is 'Dados do app Meu Dia, um registro por linha, isolados por usuário via RLS.';

create index if not exists meudia_records_user_server_updated_idx
  on public.meudia_records (user_id, server_updated_at);

-- Última alteração vence: ignora gravações mais antigas que a versão salva
-- e marca o horário do servidor usado como cursor da sincronização.
create or replace function public.meudia_records_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id não pode ser alterado';
    end if;
    if new.client_updated_at < old.client_updated_at then
      return old;
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists meudia_records_before_write on public.meudia_records;
create trigger meudia_records_before_write
  before insert or update on public.meudia_records
  for each row execute function public.meudia_records_before_write();

alter table public.meudia_records enable row level security;

drop policy if exists "meudia: ler os próprios dados" on public.meudia_records;
create policy "meudia: ler os próprios dados" on public.meudia_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "meudia: criar os próprios dados" on public.meudia_records;
create policy "meudia: criar os próprios dados" on public.meudia_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "meudia: alterar os próprios dados" on public.meudia_records;
create policy "meudia: alterar os próprios dados" on public.meudia_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "meudia: apagar os próprios dados" on public.meudia_records;
create policy "meudia: apagar os próprios dados" on public.meudia_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.meudia_records from anon;
grant select, insert, update, delete on public.meudia_records to authenticated;

-- Excluir a própria conta (dados + login). Só age sobre quem está autenticado.
create or replace function public.meudia_delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'não autenticado';
  end if;
  delete from public.meudia_records where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.meudia_delete_account() from public, anon;
grant execute on function public.meudia_delete_account() to authenticated;
