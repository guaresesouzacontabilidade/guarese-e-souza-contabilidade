-- =============================================================================
-- Dados da Receita Federal no cadastro da empresa
--
-- Retrato da consulta do CNPJ (dados abertos da Receita, via BrasilAPI) feita
-- pela equipe no cadastro: situação cadastral, abertura, natureza jurídica,
-- CNAEs, Simples/MEI, sócios. Só referência — os campos do cadastro continuam
-- sendo os que a equipe confere e salva.
-- =============================================================================

alter table public.empresas
  add column dados_receita jsonb check (dados_receita is null or (jsonb_typeof(dados_receita) = 'object' and pg_column_size(dados_receita) <= 200000)),
  add column dados_receita_em timestamptz;

grant select (dados_receita, dados_receita_em) on public.empresas to authenticated;
grant update (dados_receita, dados_receita_em) on public.empresas to authenticated;
