-- =============================================================================
-- Portal Guarese's ON — Migração 0100: base, utilitários, escritório e perfis
-- =============================================================================
-- Convenções:
--   * Tabelas e colunas em português (snake_case).
--   * Valores monetários sempre em numeric(15,2) — nunca float.
--   * Competência = primeiro dia do mês (date), sempre validada.
--   * Funções auxiliares internas ficam no schema "app" (não exposto pela API).
--   * Funções chamadas pela aplicação (RPC) ficam em "public", com checagem de
--     permissão interna, e são concedidas somente ao papel "authenticated".
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------

-- Data de "hoje" no fuso do escritório (Porto Nacional/TO: America/Araguaina).
create or replace function app.hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Araguaina')::date;
$$;

-- Primeiro dia do mês da data informada.
create or replace function app.competencia_de(p_data date)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', p_data)::date;
$$;

-- Converte texto em uuid sem lançar erro (retorna null quando inválido).
create or replace function app.try_uuid(p_texto text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_texto::uuid;
exception when others then
  return null;
end;
$$;

-- Mantém somente dígitos.
create or replace function app.somente_digitos(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g'), '');
$$;

-- Valida CNPJ (14 dígitos, dígitos verificadores).
create or replace function app.cnpj_valido(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int := 0;
  resto int;
  dv1 int;
  dv2 int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then
    return false;
  end if;
  for i in 1..12 loop
    soma := soma + substr(d, i, 1)::int * pesos1[i];
  end loop;
  resto := soma % 11;
  dv1 := case when resto < 2 then 0 else 11 - resto end;
  soma := 0;
  for i in 1..13 loop
    soma := soma + substr(d, i, 1)::int * pesos2[i];
  end loop;
  resto := soma % 11;
  dv2 := case when resto < 2 then 0 else 11 - resto end;
  return dv1 = substr(d, 13, 1)::int and dv2 = substr(d, 14, 1)::int;
end;
$$;

-- Valida CPF (11 dígitos, dígitos verificadores).
create or replace function app.cpf_valido(p_cpf text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  soma int;
  resto int;
  dv1 int;
  dv2 int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then
    return false;
  end if;
  soma := 0;
  for i in 1..9 loop
    soma := soma + substr(d, i, 1)::int * (11 - i);
  end loop;
  resto := (soma * 10) % 11;
  dv1 := case when resto = 10 then 0 else resto end;
  soma := 0;
  for i in 1..10 loop
    soma := soma + substr(d, i, 1)::int * (12 - i);
  end loop;
  resto := (soma * 10) % 11;
  dv2 := case when resto = 10 then 0 else resto end;
  return dv1 = substr(d, 10, 1)::int and dv2 = substr(d, 11, 1)::int;
end;
$$;

-- Normaliza texto para busca (minúsculas, sem acentos).
create or replace function app.normalizar(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_texto, '')));
$$;

-- Gatilho genérico para updated_at.
create or replace function app.tg_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Escritório (registro único com dados e configurações)
-- -----------------------------------------------------------------------------
create table public.escritorio (
  id smallint primary key default 1 check (id = 1),
  nome_fantasia text not null,
  razao_social text not null,
  cnpj text not null check (app.cnpj_valido(cnpj)),
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf char(2),
  cep text,
  email text,
  telefone text,
  whatsapp text,                -- vazio até o administrador informar
  site text,
  instagram text,
  nome_sistema text not null default 'Portal Guarese''s ON',
  descricao_sistema text not null default 'Documentos, contabilidade e gestão financeira em um só lugar.',
  mensagem_login text not null default 'Bem-vindo ao seu Portal Guarese''s ON. Envie seus documentos, acompanhe suas pendências e entenda a saúde financeira da sua empresa.',
  logo_path text,               -- caminho no bucket público "marca"
  logo_atualizado_em timestamptz,
  exigir_2fa_equipe boolean not null default false,
  exigir_2fa_clientes boolean not null default false,
  -- Lembretes: dias relativos ao prazo (negativo = antes; 0 = no dia; positivo = após)
  lembretes_dias int[] not null default array[-5, -2, 0, 2, 5],
  lembretes_email_ativo boolean not null default true,
  lembretes_whatsapp_ativo boolean not null default false,
  whatsapp_phone_number_id text,      -- WhatsApp Cloud API (o token fica em variável de ambiente)
  whatsapp_template_lembrete text,
  whatsapp_template_idioma text not null default 'pt_BR',
  retencao_padrao_anos int not null default 6 check (retencao_padrao_anos between 1 and 50),
  upload_tamanho_maximo_mb int not null default 50 check (upload_tamanho_maximo_mb between 1 and 500),
  zip_max_arquivos int not null default 2000 check (zip_max_arquivos between 1 and 20000),
  zip_max_tamanho_mb int not null default 300 check (zip_max_tamanho_mb between 1 and 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create trigger escritorio_updated_at before update on public.escritorio
  for each row execute function app.tg_updated_at();

insert into public.escritorio (
  id, nome_fantasia, razao_social, cnpj, logradouro, numero, bairro, cidade, uf, cep, email
) values (
  1,
  'GUARESE''S ON CONTABILIDADE',
  'GUARESE''S ON SOLUCOES EMPRESARIAIS LTDA',
  '62935399000150',
  'Praça do Centenário',
  '713',
  'Centro',
  'Porto Nacional',
  'TO',
  '77500000',
  'guaresesouzacontabilidade@gmail.com'
);

-- -----------------------------------------------------------------------------
-- Perfis de usuários (senhas ficam exclusivamente no Supabase Auth)
-- -----------------------------------------------------------------------------
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  telefone text,
  tipo text not null default 'cliente' check (tipo in ('admin', 'equipe', 'cliente')),
  cargo text,
  ativo boolean not null default true,
  preferencias jsonb not null default '{}'::jsonb,
  ultimo_acesso_em timestamptz,
  aceite_termos_versao text,
  aceite_termos_em timestamptz,
  anonimizado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index perfis_email_idx on public.perfis (lower(email));
create trigger perfis_updated_at before update on public.perfis
  for each row execute function app.tg_updated_at();

-- Cria o perfil automaticamente quando um usuário é criado no Auth.
-- O tipo vem de raw_app_meta_data (somente o servidor consegue definir),
-- nunca de raw_user_meta_data (controlado pelo próprio usuário).
create or replace function app.tg_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text := coalesce(new.raw_app_meta_data ->> 'tipo', 'cliente');
begin
  if v_tipo not in ('admin', 'equipe', 'cliente') then
    v_tipo := 'cliente';
  end if;
  insert into public.perfis (id, nome, email, tipo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.email, ''),
    v_tipo
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function app.tg_novo_usuario();

-- Mantém o e-mail do perfil sincronizado com o Auth.
create or replace function app.tg_usuario_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.perfis set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger ao_alterar_email_usuario
  after update of email on auth.users
  for each row execute function app.tg_usuario_email();
