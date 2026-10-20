-- =============================================================================
-- NFS-e: partes da NT 009 que cada ambiente do Sistema Nacional já aceita
--
-- O governo implanta o leiaute da NT 009 v1.01 em etapas (produção restrita
-- antes, produção em seguida). O emissor começa com o padrão do ambiente e,
-- quando a DPS é recusada pelo esquema (E1235) ou pela obrigatoriedade do
-- grupo IBS/CBS (E0855), ajusta a combinação, envia de novo a mesma DPS e
-- guarda aqui a combinação aceita, para as próximas notas. Só o servidor lê e
-- grava.
-- =============================================================================

create table public.nfse_leiaute_ambiente (
  ambiente text primary key check (ambiente in ('homologacao', 'producao')),
  variante jsonb not null check (jsonb_typeof(variante) = 'object'),
  motivo text check (motivo is null or length(motivo) <= 2000),
  atualizado_em timestamptz not null default now()
);
comment on table public.nfse_leiaute_ambiente is
  'Partes do leiaute da NT 009 aceitas por ambiente do Sistema Nacional NFS-e (aprendidas nas recusas de esquema).';

alter table public.nfse_leiaute_ambiente enable row level security;
revoke all on public.nfse_leiaute_ambiente from anon, authenticated;
grant select, insert, update, delete on public.nfse_leiaute_ambiente to service_role;
