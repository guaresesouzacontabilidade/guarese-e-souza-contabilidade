-- =============================================================================
-- Tomadores salvos da NFS-e: quem emite as notas da empresa guarda o CPF ou
-- CNPJ do tomador (com nome, contato e, para CNPJ, o endereço da Receita) para
-- escolher nas próximas notas, sem digitar de novo.
-- Leitura: quem emite ou configura a emissão da empresa (cada empresa só vê os
-- seus). Escrita: só pelas funções abaixo, com a permissão de emitir.
-- =============================================================================

create table public.nfse_tomadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cnpj', 'cpf')),
  documento text not null check (documento ~ '^([0-9]{11}|[0-9A-Z]{14})$'),
  nome text not null check (length(trim(nome)) between 2 and 300),
  email text check (email is null or (length(email) <= 80 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  telefone text check (telefone is null or telefone ~ '^[0-9]{6,20}$'),
  -- {logradouro, numero, complemento, bairro, codigo_municipio, municipio, uf, cep} (só CNPJ)
  endereco jsonb check (endereco is null or (jsonb_typeof(endereco) = 'object' and pg_column_size(endereco) <= 4000)),
  ultimo_uso_em timestamptz,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfse_tomadores_documento_uk unique (empresa_id, documento),
  constraint nfse_tomadores_tipo_documento check (
    (tipo = 'cpf' and documento ~ '^[0-9]{11}$' and endereco is null)
    or (tipo = 'cnpj' and documento ~ '^[0-9A-Z]{14}$' and endereco is not null)
  )
);
create index nfse_tomadores_empresa_idx on public.nfse_tomadores (empresa_id, nome);
create trigger nfse_tomadores_updated_at before update on public.nfse_tomadores
  for each row execute function app.tg_updated_at();
create trigger auditoria_nfse_tomadores after insert or update or delete on public.nfse_tomadores
  for each row execute function app.tg_auditoria();

alter table public.nfse_tomadores enable row level security;
create policy nfse_tomadores_leitura on public.nfse_tomadores for select to authenticated
  using ((select app.pode(empresa_id, 'nfse.emitir')) or (select app.pode(empresa_id, 'nfse.configurar')));
grant select on public.nfse_tomadores to authenticated;
grant select, insert, update, delete on public.nfse_tomadores to service_role;

-- Salva (ou atualiza, pelo mesmo CPF/CNPJ) um tomador da empresa. p_dados:
-- {tipo, documento, nome, email, telefone, endereco, usado}. "usado" marca o
-- uso numa nota agora (para ordenar a lista pelos mais usados recentemente).
create or replace function public.nfse_tomador_salvar(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text := p_dados ->> 'tipo';
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_nome text := trim(coalesce(p_dados ->> 'nome', ''));
  v_email text := nullif(lower(trim(coalesce(p_dados ->> 'email', ''))), '');
  v_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '[^0-9]', '', 'g'), '');
  v_end jsonb;
  v_usado boolean := coalesce((p_dados ->> 'usado')::boolean, false);
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'nfse.emitir');
  if v_tipo is null or v_tipo not in ('cpf', 'cnpj') then
    raise exception 'Escolha se o tomador tem CPF ou CNPJ.';
  end if;
  if v_tipo = 'cpf' and (v_doc is null or not app.cpf_valido(v_doc)) then
    raise exception 'CPF do tomador inválido.';
  end if;
  if v_tipo = 'cnpj' and (v_doc is null or not app.cnpj_valido(v_doc)) then
    raise exception 'CNPJ do tomador inválido.';
  end if;
  if v_tipo = 'cnpj' and v_doc = (select e.documento from public.empresas e where e.id = p_empresa_id) then
    raise exception 'O tomador não pode ser a própria empresa.';
  end if;
  if length(v_nome) < 2 or length(v_nome) > 300 then
    raise exception 'Informe o nome do tomador.';
  end if;
  if v_email is not null and (length(v_email) > 80 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'E-mail do tomador inválido.';
  end if;
  if v_tel is not null and v_tel !~ '^[0-9]{6,20}$' then
    raise exception 'Telefone do tomador inválido.';
  end if;
  if v_tipo = 'cnpj' then
    if jsonb_typeof(p_dados -> 'endereco') is distinct from 'object'
       or coalesce(p_dados -> 'endereco' ->> 'codigo_municipio', '') !~ '^[0-9]{7}$' then
      raise exception 'Busque o CNPJ na Receita para trazer o endereço do tomador.';
    end if;
    -- Só os campos do endereço, sem nada a mais
    v_end := jsonb_build_object(
      'logradouro', nullif(trim(p_dados -> 'endereco' ->> 'logradouro'), ''),
      'numero', nullif(trim(p_dados -> 'endereco' ->> 'numero'), ''),
      'complemento', nullif(trim(p_dados -> 'endereco' ->> 'complemento'), ''),
      'bairro', nullif(trim(p_dados -> 'endereco' ->> 'bairro'), ''),
      'codigo_municipio', p_dados -> 'endereco' ->> 'codigo_municipio',
      'municipio', nullif(trim(p_dados -> 'endereco' ->> 'municipio'), ''),
      'uf', nullif(upper(trim(p_dados -> 'endereco' ->> 'uf')), ''),
      'cep', nullif(regexp_replace(coalesce(p_dados -> 'endereco' ->> 'cep', ''), '[^0-9]', '', 'g'), '')
    );
  end if;
  if (select count(*) from public.nfse_tomadores t where t.empresa_id = p_empresa_id) >= 2000
     and not exists (select 1 from public.nfse_tomadores t where t.empresa_id = p_empresa_id and t.documento = v_doc) then
    raise exception 'Limite de 2.000 tomadores salvos nesta empresa. Exclua os que não usa mais.';
  end if;

  insert into public.nfse_tomadores as t (empresa_id, tipo, documento, nome, email, telefone, endereco, ultimo_uso_em)
  values (p_empresa_id, v_tipo, v_doc, v_nome, v_email, v_tel, v_end, case when v_usado then now() end)
  on conflict (empresa_id, documento) do update
    set tipo = excluded.tipo,
        nome = excluded.nome,
        email = excluded.email,
        telefone = excluded.telefone,
        endereco = excluded.endereco,
        ultimo_uso_em = coalesce(excluded.ultimo_uso_em, t.ultimo_uso_em)
  returning t.id into v_id;
  return v_id;
end;
$$;

create or replace function public.nfse_tomador_excluir(p_empresa_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'nfse.emitir');
  delete from public.nfse_tomadores t where t.id = p_id and t.empresa_id = p_empresa_id;
  if not found then
    raise exception 'Tomador não encontrado.';
  end if;
end;
$$;

revoke execute on function public.nfse_tomador_salvar(uuid, jsonb), public.nfse_tomador_excluir(uuid, uuid) from public, anon;
grant execute on function public.nfse_tomador_salvar(uuid, jsonb), public.nfse_tomador_excluir(uuid, uuid) to authenticated, service_role;
