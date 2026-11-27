-- =============================================================================
-- Busca do portal: sem acento, sem diferença de maiúscula e com as palavras em
-- qualquer ordem.
--
--  1. app.busca_normalizar: "João da Silva-ME" -> "joao da silva me" (minúsculo,
--     sem acento; pontuação vira espaço). O portal normaliza o que a pessoa
--     digitou do mesmo jeito e procura cada palavra no texto de busca.
--  2. Campo de busca de cada tabela pesquisada ("busca"), calculado na hora a
--     partir dos campos que a tela pesquisa (nome, CPF/CNPJ, telefone, número,
--     descrição...). É uma função da própria linha: quem não vê a linha (RLS)
--     não acha nada por ela — a busca não abre acesso novo. CPF, CNPJ,
--     telefone, códigos e números de documento entram sem pontuação (acha
--     "123.456.789-00" e "12345678900"; o CNPJ com letras continua igual).
--  3. Produtos: como algumas colunas do produto são fechadas (custo), o texto de
--     busca fica numa coluna gerada, liberada para leitura, com índice.
-- =============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function app.busca_normalizar(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_texto, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;
revoke all on function app.busca_normalizar(text) from public, anon;
grant execute on function app.busca_normalizar(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Campos de busca (funções da linha, usadas como coluna "busca" nas consultas)
-- -----------------------------------------------------------------------------
create function public.busca(t public.empresas) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.razao_social, '') || ' ' || coalesce(t.nome_fantasia, '') || ' ' || regexp_replace(coalesce(t.documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.email, '')) $$;

create function public.busca(t public.contrapartes) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || regexp_replace(coalesce(t.documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.telefone, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.email, '') || ' ' || coalesce(t.contato, '')) $$;

create function public.busca(t public.documentos) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.titulo, '') || ' ' || coalesce(t.nome_original, '')) $$;

create function public.busca(t public.documentos_fiscais) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.numero, '') || ' ' || coalesce(t.emitente_nome, '') || ' ' || regexp_replace(coalesce(t.emitente_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' '
                                 || coalesce(t.destinatario_nome, '') || ' ' || regexp_replace(coalesce(t.destinatario_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.chave_acesso, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create function public.busca(t public.vendas) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.numero::text, '') || ' ' || coalesce(t.cliente_nome, '') || ' ' || regexp_replace(coalesce(t.cliente_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.cliente_telefone, ''), '[^0-9A-Za-z]', '', 'g')) $$;

-- Lançamentos: descrição, nº do documento e o nome do cliente/fornecedor (quem não vê o cadastro não acha por ele)
create function public.busca(t public.lancamentos) returns text language sql stable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.descricao, '') || ' ' || regexp_replace(coalesce(t.numero_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' '
                                 || coalesce((select c.nome || ' ' || regexp_replace(coalesce(c.documento, ''), '[^0-9A-Za-z]', '', 'g') from public.contrapartes c where c.id = t.contraparte_id), '')) $$;

create function public.busca(t public.movimentos_bancarios) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.descricao, '') || ' ' || regexp_replace(coalesce(t.numero_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.documento_contraparte, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create function public.busca(t public.honorarios_cobrancas) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.numero::text, '') || ' ' || coalesce(t.pagador_nome, '') || ' ' || regexp_replace(coalesce(t.pagador_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.descricao, '')) $$;

create function public.busca(t public.recibos_honorarios) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.numero::text, '') || ' ' || coalesce(t.pagador_nome, '') || ' ' || regexp_replace(coalesce(t.pagador_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.descricao, '')) $$;

create function public.busca(t public.perfis) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || coalesce(t.email, '') || ' ' || regexp_replace(coalesce(t.telefone, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create function public.busca(t public.vet_tutores) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || regexp_replace(coalesce(t.cpf, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.telefone, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.telefone2, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.email, '')) $$;

create function public.busca(t public.vet_pacientes) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || regexp_replace(coalesce(t.microchip, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create function public.busca(t public.hotel_hospedes) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || regexp_replace(coalesce(t.cpf, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.cnpj, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.documento, ''), '[^0-9A-Za-z]', '', 'g') || ' '
                                 || regexp_replace(coalesce(t.telefone, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.email, '')) $$;

create function public.busca(t public.fisio_pacientes) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || coalesce(t.nome_social, '') || ' ' || regexp_replace(coalesce(t.cpf, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.telefone, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.email, '')) $$;

create function public.busca(t public.ordens_carregamento) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.numero::text, '') || ' ' || coalesce(t.destinatario_nome, '') || ' ' || regexp_replace(coalesce(t.destinatario_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' '
                                 || regexp_replace(coalesce(t.placa, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.motorista_nome, '') || ' ' || coalesce(t.transportador_nome, '') || ' ' || coalesce(t.produto_descricao, '')) $$;

create function public.busca(t public.os_ordens) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.numero::text, '') || ' ' || coalesce(t.cliente_nome, '') || ' ' || regexp_replace(coalesce(t.cliente_telefone, ''), '[^0-9A-Za-z]', '', 'g') || ' '
                                 || regexp_replace(coalesce(t.cliente_documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.descricao, '')) $$;

create function public.busca(t public.nfe_destinatarios) returns text language sql immutable set search_path = ''
as $$ select app.busca_normalizar(coalesce(t.nome, '') || ' ' || regexp_replace(coalesce(t.documento, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(t.telefone, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(t.email, '')) $$;

do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'busca' loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Produtos: coluna gerada (o custo é coluna fechada; a busca não inclui custo)
-- -----------------------------------------------------------------------------
alter table public.nfe_produtos
  add column busca text generated always as (
    app.busca_normalizar(coalesce(descricao, '') || ' ' || regexp_replace(coalesce(codigo, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || regexp_replace(coalesce(gtin, ''), '[^0-9A-Za-z]', '', 'g') || ' ' || coalesce(grupo, ''))
  ) stored;
grant select (busca) on public.nfe_produtos to authenticated;
create index nfe_produtos_busca_trgm on public.nfe_produtos using gin (busca extensions.gin_trgm_ops);
