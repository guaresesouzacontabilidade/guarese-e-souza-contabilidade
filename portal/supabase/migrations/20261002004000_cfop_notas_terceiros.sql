-- =============================================================================
-- Compras e devoluções nas notas emitidas por terceiros
--
-- Na nota do fornecedor (a empresa é a destinatária), o CFOP é o da venda
-- dele (5.102, 6.102, 5.405...); na devolução feita pelo cliente, o CFOP é o
-- de devolução de compra dele (5.202, 6.202, 5.411...). Antes, a previsão de
-- impostos, o comparativo de regimes e o auditor só reconheciam os CFOP das
-- notas de entrada emitidas pela própria empresa (1.102, 1.202...): compras
-- vindas do fornecedor não geravam crédito e devoluções feitas pelo cliente
-- não reduziam a receita. As funções são usadas só com notas de entrada.
-- =============================================================================

-- Compra: entrada própria (1.1xx, 1.401–1.403, 1.651–1.653) ou venda do
-- fornecedor (sem as transferências entre estabelecimentos, x.15x)
create or replace function app.cfop_compra(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_cfop ~ '^[123]1[0-9]{2}$' or p_cfop ~ '^[12]40[1-3]$' or p_cfop ~ '^[123]65[1-3]$'
    or (app.cfop_venda(p_cfop) and p_cfop !~ '^[567]15[0-9]$'),
    false);
$$;

-- Devolução de venda: entrada própria (1.201–1.204, 1.410–1.411, 1.660–1.662)
-- ou nota do cliente que devolveu (5.201, 5.202, 5.210, 5.410–5.413, 5.553,
-- 5.556, 5.660–5.662 e as interestaduais 6.xxx)
create or replace function app.cfop_devolucao_venda(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_cfop ~ '^[123]20[1-4]$' or p_cfop ~ '^[12]41[01]$' or p_cfop ~ '^[12]66[0-2]$'
    or p_cfop ~ '^[56]20[12]$' or p_cfop ~ '^[56]210$' or p_cfop ~ '^[56]41[0-3]$' or p_cfop ~ '^[56]55[36]$' or p_cfop ~ '^[56]66[0-2]$',
    false);
$$;
