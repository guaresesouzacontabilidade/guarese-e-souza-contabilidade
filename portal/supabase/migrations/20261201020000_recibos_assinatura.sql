-- =============================================================================
-- Recibos de honorários assinados com o certificado digital do escritório
--
-- O administrador cadastra uma vez o certificado A1 do escritório (e-CNPJ do
-- escritório ou e-CPF do contador). Cada recibo emitido sai assinado no
-- servidor, no padrão da ICP-Brasil para PDF (PAdES, política AD-RB), e o
-- arquivo assinado fica guardado para os downloads seguintes.
--
--  * A chave privada fica cifrada (AES-256-GCM, chave só no servidor) numa
--    tabela sem acesso para usuários: só o servidor do portal lê, para assinar.
--  * A senha do arquivo não é guardada.
--  * Só administradores cadastram ou removem; a equipe vê apenas quem assina
--    e a validade (sem a chave).
-- =============================================================================

create table public.escritorio_certificado (
  id smallint primary key default 1 check (id = 1),
  titular text not null check (length(titular) between 1 and 300),
  documento text not null check (documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  emissor text check (emissor is null or length(emissor) <= 300),
  numero_serie text check (numero_serie is null or numero_serie ~ '^[0-9A-F]{1,80}$'),
  impressao_digital text not null check (impressao_digital ~ '^[0-9A-F]{64}$'),
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  cadastrado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  cadastrado_em timestamptz not null default now(),
  constraint escritorio_certificado_validade check (valido_de < valido_ate)
);
create trigger auditoria_escritorio_certificado after insert or update or delete on public.escritorio_certificado
  for each row execute function app.tg_auditoria();

alter table public.escritorio_certificado enable row level security;
create policy escritorio_certificado_leitura on public.escritorio_certificado for select to authenticated using ((select app.is_equipe()));
revoke insert, update, delete on public.escritorio_certificado from anon, authenticated;
grant select on public.escritorio_certificado to authenticated;

-- Chave privada e certificados (PEM) cifrados. Sem políticas e sem permissão
-- para usuários (e sem trilha de auditoria da linha, para o conteúdo não ir ao log).
create table public.escritorio_certificado_segredo (
  id smallint primary key default 1 references public.escritorio_certificado(id) on delete cascade,
  conteudo_cifrado text not null check (conteudo_cifrado ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(conteudo_cifrado) <= 200000),
  created_at timestamptz not null default now()
);
alter table public.escritorio_certificado_segredo enable row level security;
revoke all on public.escritorio_certificado_segredo from anon, authenticated;
grant select on public.escritorio_certificado_segredo to service_role;

-- Cadastro (ou troca) do certificado: só administrador, e só do próprio
-- escritório (CNPJ do escritório) ou do contador (CPF do contador).
create or replace function public.escritorio_certificado_definir(
  p_titular text,
  p_documento text,
  p_emissor text,
  p_numero_serie text,
  p_impressao_digital text,
  p_valido_de timestamptz,
  p_valido_ate timestamptz,
  p_conteudo_cifrado text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnpj text;
  v_cpf text;
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório cadastra o certificado.' using errcode = '42501';
  end if;
  select regexp_replace(coalesce(cnpj, ''), '[^0-9A-Z]', '', 'g') into v_cnpj from public.escritorio where id = 1;
  select regexp_replace(coalesce(cpf, ''), '\D', '', 'g') into v_cpf from public.escritorio_contador where id = 1;
  -- e-CNPJ: mesma raiz (8 primeiros caracteres) do CNPJ do escritório; e-CPF: o CPF do contador
  if not ((length(p_documento) = 14 and left(p_documento, 8) = left(v_cnpj, 8)) or (length(p_documento) = 11 and p_documento = v_cpf)) then
    raise exception 'Este certificado não é do escritório (CNPJ) nem do contador (CPF cadastrado em Configurações).' using errcode = 'P0001';
  end if;
  if p_valido_ate <= now() then
    raise exception 'Este certificado já venceu.' using errcode = 'P0001';
  end if;

  insert into public.escritorio_certificado (id, titular, documento, emissor, numero_serie, impressao_digital, valido_de, valido_ate, cadastrado_por, cadastrado_em)
  values (1, p_titular, p_documento, p_emissor, p_numero_serie, p_impressao_digital, p_valido_de, p_valido_ate, auth.uid(), now())
  on conflict (id) do update set
    titular = excluded.titular, documento = excluded.documento, emissor = excluded.emissor, numero_serie = excluded.numero_serie,
    impressao_digital = excluded.impressao_digital, valido_de = excluded.valido_de, valido_ate = excluded.valido_ate,
    cadastrado_por = excluded.cadastrado_por, cadastrado_em = excluded.cadastrado_em;
  insert into public.escritorio_certificado_segredo (id, conteudo_cifrado) values (1, p_conteudo_cifrado)
  on conflict (id) do update set conteudo_cifrado = excluded.conteudo_cifrado, created_at = now();
end;
$$;

create or replace function public.escritorio_certificado_remover()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório remove o certificado.' using errcode = '42501';
  end if;
  delete from public.escritorio_certificado where id = 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Recibo assinado: arquivo guardado e quem assinou
-- -----------------------------------------------------------------------------
alter table public.recibos_honorarios
  add column arquivo_path text check (arquivo_path is null or arquivo_path ~ '^[0-9]{4}/[0-9a-f-]{36}(-[0-9]+)?\.pdf$'),
  add column assinado_em timestamptz,
  add column assinatura_titular text check (assinatura_titular is null or length(assinatura_titular) <= 300),
  add column assinatura_documento text check (assinatura_documento is null or assinatura_documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  add constraint recibos_assinatura check ((arquivo_path is null) = (assinado_em is null));

create or replace function public.recibo_registrar_assinatura(p_recibo_id uuid, p_path text, p_titular text, p_documento text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_equipe() then
    raise exception 'Só a equipe do escritório altera recibos.' using errcode = '42501';
  end if;
  update public.recibos_honorarios
     set arquivo_path = p_path, assinado_em = now(), assinatura_titular = p_titular, assinatura_documento = p_documento
   where id = p_recibo_id and situacao = 'emitido';
  if not found then
    raise exception 'Recibo não encontrado ou cancelado.' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.escritorio_certificado_definir(text, text, text, text, text, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.escritorio_certificado_remover() from public, anon;
revoke execute on function public.recibo_registrar_assinatura(uuid, text, text, text) from public, anon;
grant execute on function public.escritorio_certificado_definir(text, text, text, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.escritorio_certificado_remover() to authenticated;
grant execute on function public.recibo_registrar_assinatura(uuid, text, text, text) to authenticated;

-- PDFs assinados: armazenamento privado, sem acesso direto de usuários
-- (o servidor confere a equipe e entrega o arquivo).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recibos', 'recibos', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;
