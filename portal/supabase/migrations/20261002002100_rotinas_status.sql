-- =============================================================================
-- Situação das rotinas automáticas (fila de tarefas e rotina diária): última
-- execução e resultado, para o administrador acompanhar em Configurações.
-- Gravada pelo servidor (service_role) a cada chamada agendada.
-- =============================================================================

create table public.rotinas_status (
  rotina text primary key check (rotina in ('fila', 'diaria')),
  ultima_execucao timestamptz not null default now(),
  ok boolean not null default true,
  resultado jsonb,
  erro text
);

alter table public.rotinas_status enable row level security;
create policy rotinas_status_leitura on public.rotinas_status for select to authenticated
  using ((select app.is_admin()));
grant select on public.rotinas_status to authenticated;
