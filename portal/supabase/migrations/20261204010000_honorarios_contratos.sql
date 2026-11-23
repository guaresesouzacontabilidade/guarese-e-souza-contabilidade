-- =============================================================================
-- Contratos de prestação de serviços contábeis (gerados pela ficha do cliente)
--
--  * O escritório monta o contrato a partir da ficha de honorários (serviços
--    marcados, valores, extras, vencimento, reajuste), com as cláusulas
--    mínimas da Resolução CFC nº 1.590/2020; aditivo quando a ficha muda e
--    distrato no encerramento (arts. 6º a 10).
--  * O PDF enviado ao cliente é guardado com o seu resumo (SHA-256) e, com o
--    certificado do escritório cadastrado, sai assinado digitalmente.
--  * O sócio titular da empresa assina no portal: confirma nome e CPF e, com o
--    e-mail do portal ligado, o código de 6 números enviado ao e-mail dele. O
--    aceite registra data e hora, IP, navegador e o resumo do arquivo lido.
--  * Só o administrador e quem ele autorizar (financeiro do escritório)
--    montam e enviam; o cliente vê só os contratos da própria empresa já
--    enviados. O aceite é gravado só pelo servidor.
-- =============================================================================

create table public.honorarios_contratos (
  id uuid primary key default gen_random_uuid(),
  ano int not null check (ano between 2000 and 2100),
  numero int not null check (numero between 1 and 999999),
  tipo text not null check (tipo in ('contrato', 'aditivo', 'distrato')),
  contrato_origem_id uuid references public.honorarios_contratos(id) on delete restrict,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  ficha_id uuid references public.honorarios_fichas(id) on delete set null,
  titulo text not null check (length(trim(titulo)) between 3 and 200),
  -- Fotografia dos dados usados (partes, serviços, valores) e o texto das cláusulas
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and pg_column_size(dados) < 60000),
  clausulas jsonb not null check (jsonb_typeof(clausulas) = 'array' and pg_column_size(clausulas) < 200000),
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'enviado', 'assinado', 'cancelado')),
  -- PDF enviado para assinatura (assinado pelo escritório quando há certificado)
  arquivo_path text,
  arquivo_hash text check (arquivo_hash is null or arquivo_hash ~ '^[0-9a-f]{64}$'),
  arquivo_assinado boolean not null default false,
  enviado_em timestamptz,
  enviado_por uuid references public.perfis(id) on delete set null,
  -- Aceite do cliente
  aceite_em timestamptz,
  aceite_user_id uuid references public.perfis(id) on delete set null,
  aceite_nome text,
  aceite_cpf text check (aceite_cpf is null or aceite_cpf ~ '^[0-9]{11}$'),
  aceite_email text,
  aceite_ip text,
  aceite_user_agent text,
  aceite_metodo text check (aceite_metodo is null or aceite_metodo in ('codigo_email', 'sessao')),
  -- Via final (contrato + registro das assinaturas), publicada nos documentos da empresa
  final_path text,
  final_hash text check (final_hash is null or final_hash ~ '^[0-9a-f]{64}$'),
  documento_id uuid references public.documentos(id) on delete set null,
  cancelado_em timestamptz,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ano, numero),
  constraint honorarios_contratos_origem check ((tipo = 'contrato') = (contrato_origem_id is null)),
  constraint honorarios_contratos_enviado check (situacao = 'rascunho' or situacao = 'cancelado' or (arquivo_path is not null and arquivo_hash is not null and enviado_em is not null)),
  constraint honorarios_contratos_assinado check ((situacao = 'assinado') = (aceite_em is not null))
);
create index honorarios_contratos_empresa_idx on public.honorarios_contratos (empresa_id, created_at desc);
create trigger honorarios_contratos_updated_at before update on public.honorarios_contratos
  for each row execute function app.tg_updated_at();
create trigger auditoria_honorarios_contratos after insert or update or delete on public.honorarios_contratos
  for each row execute function app.tg_auditoria();
alter table public.honorarios_contratos enable row level security;
revoke insert, update, delete on public.honorarios_contratos from anon, authenticated;
grant select on public.honorarios_contratos to authenticated;

-- Sócio titular (quem assina pela empresa)
create or replace function app.e_titular(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.empresa_membros m
     where m.empresa_id = p_empresa_id and m.user_id = auth.uid() and m.ativo and m.papel = 'cliente_titular'
  ) and app.usuario_valido();
$$;

create policy honorarios_contratos_leitura on public.honorarios_contratos for select to authenticated using (
  (select app.pode_honorarios())
  or (not (select app.is_equipe()) and situacao in ('enviado', 'assinado')
      and (app.e_titular(empresa_id) or app.pode(empresa_id, 'financeiro.ver')))
);

-- Códigos de confirmação do aceite (só o servidor lê e grava)
create table public.honorarios_contrato_codigos (
  contrato_id uuid not null references public.honorarios_contratos(id) on delete cascade,
  user_id uuid not null references public.perfis(id) on delete cascade,
  codigo_hash text not null,
  expira_em timestamptz not null,
  tentativas int not null default 0,
  criado_em timestamptz not null default now(),
  primary key (contrato_id, user_id)
);
alter table public.honorarios_contrato_codigos enable row level security;
revoke all on public.honorarios_contrato_codigos from anon, authenticated;

-- Contrato (ou aditivo/distrato) em rascunho: criar ou trocar o texto
create or replace function public.honorarios_contrato_salvar(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_situacao text;
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'contrato');
  v_origem uuid := nullif(p_dados ->> 'contrato_origem_id', '')::uuid;
  v_empresa uuid := (p_dados ->> 'empresa_id')::uuid;
begin
  perform app.exigir_honorarios();
  if p_id is not null then
    select situacao into v_situacao from public.honorarios_contratos where id = p_id for update;
    if v_situacao is distinct from 'rascunho' then
      raise exception 'Só o rascunho muda. Para mudar um contrato enviado, gere um aditivo.' using errcode = 'P0001';
    end if;
    update public.honorarios_contratos
       set titulo = trim(p_dados ->> 'titulo'), dados = p_dados -> 'conteudo', clausulas = p_dados -> 'clausulas',
           arquivo_path = null, arquivo_hash = null, arquivo_assinado = false
     where id = p_id;
    return p_id;
  end if;
  if v_tipo <> 'contrato' then
    if not exists (select 1 from public.honorarios_contratos c where c.id = v_origem and c.empresa_id = v_empresa and c.tipo = 'contrato' and c.situacao = 'assinado') then
      raise exception 'Aditivo e distrato partem de um contrato assinado da mesma empresa.' using errcode = 'P0001';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('honorarios_contratos:' || v_ano, 0));
  insert into public.honorarios_contratos (ano, numero, tipo, contrato_origem_id, empresa_id, ficha_id, titulo, dados, clausulas)
  values (
    v_ano, (select coalesce(max(numero), 0) + 1 from public.honorarios_contratos where ano = v_ano),
    v_tipo, v_origem, v_empresa, (select f.id from public.honorarios_fichas f where f.empresa_id = v_empresa),
    trim(p_dados ->> 'titulo'), p_dados -> 'conteudo', p_dados -> 'clausulas'
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Guarda o PDF gerado (rascunho) com o resumo SHA-256
create or replace function public.honorarios_contrato_registrar_arquivo(p_id uuid, p_path text, p_hash text, p_assinado boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  update public.honorarios_contratos set arquivo_path = p_path, arquivo_hash = p_hash, arquivo_assinado = coalesce(p_assinado, false)
   where id = p_id and situacao = 'rascunho';
  if not found then
    raise exception 'Contrato não encontrado ou já enviado.' using errcode = 'P0001';
  end if;
end;
$$;

-- Envia ao cliente: avisa no portal (e por e-mail) os sócios titulares
create or replace function public.honorarios_contrato_enviar(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_contratos;
  v_user uuid;
  v_qtd int := 0;
begin
  perform app.exigir_honorarios();
  select * into v_c from public.honorarios_contratos where id = p_id for update;
  if v_c.situacao is distinct from 'rascunho' then
    raise exception 'Só o rascunho é enviado.' using errcode = 'P0001';
  end if;
  if v_c.arquivo_path is null then
    raise exception 'Gere o PDF antes de enviar.' using errcode = 'P0001';
  end if;
  update public.honorarios_contratos set situacao = 'enviado', enviado_em = now(), enviado_por = auth.uid() where id = p_id;
  for v_user in
    select m.user_id from public.empresa_membros m where m.empresa_id = v_c.empresa_id and m.ativo and m.papel = 'cliente_titular'
  loop
    perform app.notificar(v_user, v_c.empresa_id, 'contrato', v_c.titulo || ' para assinar',
      'O escritório enviou o documento para você ler e assinar no portal.', '/e/' || v_c.empresa_id || '/contratos/' || v_c.id, true);
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

create or replace function public.honorarios_contrato_cancelar(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo.' using errcode = 'P0001';
  end if;
  update public.honorarios_contratos set situacao = 'cancelado', cancelado_em = now(), motivo_cancelamento = trim(p_motivo)
   where id = p_id and situacao in ('rascunho', 'enviado');
  if not found then
    raise exception 'Contrato assinado não é cancelado: faça um distrato.' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Aceite (só o servidor chama, depois de conferir a sessão do usuário)
-- -----------------------------------------------------------------------------
create or replace function public.honorarios_contrato_registrar_codigo(p_contrato_id uuid, p_user_id uuid, p_codigo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ultimo timestamptz;
begin
  if not exists (
    select 1 from public.honorarios_contratos c join public.empresa_membros m on m.empresa_id = c.empresa_id
     where c.id = p_contrato_id and c.situacao = 'enviado' and m.user_id = p_user_id and m.ativo and m.papel = 'cliente_titular'
  ) then
    raise exception 'Só o sócio titular assina, e só contrato enviado.' using errcode = '42501';
  end if;
  select criado_em into v_ultimo from public.honorarios_contrato_codigos where contrato_id = p_contrato_id and user_id = p_user_id;
  if v_ultimo is not null and v_ultimo > now() - interval '60 seconds' then
    raise exception 'Aguarde um minuto para pedir outro código.' using errcode = 'P0001';
  end if;
  insert into public.honorarios_contrato_codigos (contrato_id, user_id, codigo_hash, expira_em)
  values (p_contrato_id, p_user_id, extensions.crypt(p_codigo, extensions.gen_salt('bf')), now() + interval '15 minutes')
  on conflict (contrato_id, user_id) do update
    set codigo_hash = excluded.codigo_hash, expira_em = excluded.expira_em, tentativas = 0, criado_em = now();
end;
$$;

create or replace function public.honorarios_contrato_aceitar(
  p_contrato_id uuid, p_user_id uuid, p_codigo text, p_nome text, p_cpf text, p_ip text, p_user_agent text, p_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_contratos;
  v_cod public.honorarios_contrato_codigos;
  v_email text;
begin
  select * into v_c from public.honorarios_contratos where id = p_contrato_id for update;
  if v_c.id is null or v_c.situacao <> 'enviado' then
    raise exception 'Este documento não está aguardando assinatura.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.empresa_membros m where m.empresa_id = v_c.empresa_id and m.user_id = p_user_id and m.ativo and m.papel = 'cliente_titular') then
    raise exception 'Só o sócio titular da empresa assina.' using errcode = '42501';
  end if;
  if p_hash is distinct from v_c.arquivo_hash then
    raise exception 'O arquivo mudou desde que você abriu. Abra de novo antes de assinar.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_nome, ''))) < 5 or coalesce(p_cpf, '') !~ '^[0-9]{11}$' then
    raise exception 'Informe o nome completo e o CPF de quem assina.' using errcode = 'P0001';
  end if;
  if p_codigo is not null then
    select * into v_cod from public.honorarios_contrato_codigos where contrato_id = p_contrato_id and user_id = p_user_id for update;
    if v_cod.contrato_id is null or v_cod.expira_em < now() then
      raise exception 'Código vencido. Peça um novo código.' using errcode = 'P0001';
    end if;
    if v_cod.tentativas >= 5 then
      raise exception 'Muitas tentativas. Peça um novo código.' using errcode = 'P0001';
    end if;
    if extensions.crypt(p_codigo, v_cod.codigo_hash) <> v_cod.codigo_hash then
      update public.honorarios_contrato_codigos set tentativas = tentativas + 1 where contrato_id = p_contrato_id and user_id = p_user_id;
      raise exception 'Código incorreto.' using errcode = 'P0001';
    end if;
    delete from public.honorarios_contrato_codigos where contrato_id = p_contrato_id and user_id = p_user_id;
  end if;
  select email into v_email from public.perfis where id = p_user_id;
  update public.honorarios_contratos set
    situacao = 'assinado', aceite_em = now(), aceite_user_id = p_user_id, aceite_nome = trim(p_nome), aceite_cpf = p_cpf,
    aceite_email = v_email, aceite_ip = left(p_ip, 60), aceite_user_agent = left(p_user_agent, 300),
    aceite_metodo = case when p_codigo is null then 'sessao' else 'codigo_email' end
  where id = p_contrato_id;
  -- Avisa o financeiro do escritório
  perform app.notificar(p.id, v_c.empresa_id, 'contrato_assinado', v_c.titulo || ' assinado',
    format('%s assinou o nº %s/%s.', trim(p_nome), lpad(v_c.numero::text, 4, '0'), v_c.ano), '/escritorio/honorarios/contratos/' || v_c.id, false)
    from public.perfis p
   where p.ativo and (p.tipo = 'admin' or (p.tipo = 'equipe' and exists (select 1 from public.honorarios_acessos a where a.user_id = p.id)));
end;
$$;

-- Via final (contrato + registro das assinaturas) e o documento publicado
create or replace function public.honorarios_contrato_registrar_final(p_id uuid, p_path text, p_hash text, p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.honorarios_contratos set final_path = coalesce(p_path, final_path), final_hash = coalesce(p_hash, final_hash), documento_id = coalesce(p_documento_id, documento_id)
   where id = p_id and situacao = 'assinado';
end;
$$;

-- Documento "Contratos" nos documentos do escritório para a empresa
insert into public.categorias_documento (codigo, nome, descricao, grupo, extensoes, escritorio, ordem)
values ('esc_contrato', 'Contratos', 'Contrato de prestação de serviços, aditivos e distrato com o escritório.', 'escritorio', array['pdf'], true, 215)
on conflict (codigo) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

revoke execute on function public.honorarios_contrato_salvar(uuid, jsonb), public.honorarios_contrato_registrar_arquivo(uuid, text, text, boolean),
  public.honorarios_contrato_enviar(uuid), public.honorarios_contrato_cancelar(uuid, text) from public, anon;
grant execute on function public.honorarios_contrato_salvar(uuid, jsonb), public.honorarios_contrato_registrar_arquivo(uuid, text, text, boolean),
  public.honorarios_contrato_enviar(uuid), public.honorarios_contrato_cancelar(uuid, text) to authenticated;
-- Aceite e via final: só o servidor (chave de serviço), depois de conferir a sessão
revoke execute on function public.honorarios_contrato_registrar_codigo(uuid, uuid, text),
  public.honorarios_contrato_aceitar(uuid, uuid, text, text, text, text, text, text),
  public.honorarios_contrato_registrar_final(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.honorarios_contrato_registrar_codigo(uuid, uuid, text),
  public.honorarios_contrato_aceitar(uuid, uuid, text, text, text, text, text, text),
  public.honorarios_contrato_registrar_final(uuid, text, text, uuid) to service_role;
