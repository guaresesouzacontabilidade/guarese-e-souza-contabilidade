-- App da Lelé: ligação com o Notion.
-- Guarda o token do Notion de cada pessoa, ligado ao hash do código de sincronização (vault).
-- As tabelas ficam fechadas para a API pública: só a função lele-notion (service role) lê e grava.

create table if not exists public.lele_notion (
  vault text primary key check (char_length(vault) = 64),
  access_token text not null,
  refresh_token text,
  workspace_name text,
  workspace_icon text,
  bot_id text,
  updated_at timestamptz not null default now()
);

comment on table public.lele_notion is 'App da Lelé: tokens do Notion por código de sincronização (acesso só pela função lele-notion).';

create table if not exists public.lele_notion_states (
  state text primary key check (char_length(state) between 16 and 128),
  vault text not null check (char_length(vault) = 64),
  return_url text not null,
  expires_at timestamptz not null
);

comment on table public.lele_notion_states is 'App da Lelé: pedidos de conexão com o Notion em andamento (expiram em 15 min).';

alter table public.lele_notion enable row level security;
alter table public.lele_notion_states enable row level security;
revoke all on public.lele_notion from anon, authenticated;
revoke all on public.lele_notion_states from anon, authenticated;
grant select, insert, update, delete on public.lele_notion to service_role;
grant select, insert, update, delete on public.lele_notion_states to service_role;
