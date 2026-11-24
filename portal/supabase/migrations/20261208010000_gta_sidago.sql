-- =============================================================================
-- GTA (Guia de Trânsito Animal) no SIDAGO da Agrodefesa (Goiás): pedidos e
-- robô em modo conferência
--
-- A GTA é emitida no SIDAGO (sistema da Agrodefesa), com o login e a senha do
-- produtor. O portal guarda os dados da guia (origem, destino, finalidade,
-- animais por sexo e idade, transporte e a nota fiscal — que o SIDAGO exige
-- para bovinos e bubalinos desde 31/03/2025) e o robô, em MODO CONFERÊNCIA,
-- entra no SIDAGO, encontra o formulário da GTA e mostra o que iria em cada
-- campo. Ele NÃO emite a GTA: nada é enviado além do login. Quem emite é uma
-- pessoa, no SIDAGO; o número da GTA emitida pode ser anotado no pedido.
--
--  * gta_sidago_acesso: login mascarado e situação do acesso de cada empresa.
--  * gta_sidago_segredo: login e senha cifrados no servidor (AES-256-GCM, chave
--    só no servidor); nenhum usuário lê esta tabela, nem o administrador.
--  * gta_pedidos: os dados da guia.
--  * gta_conferencias: o resultado de cada conferência no SIDAGO (estrutura
--    do formulário encontrado e o valor que iria em cada campo; sem senha e
--    sem página inteira).
-- Acesso: quem emite NF-e da empresa (nfe.emitir) ou configura (nfe.configurar).
-- =============================================================================

create table public.gta_sidago_acesso (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  login_mascarado text not null check (length(login_mascarado) between 3 and 80),
  situacao text not null default 'nao_testado' check (situacao in ('nao_testado', 'conectado', 'erro')),
  ultimo_teste_em timestamptz,
  ultima_mensagem text check (ultima_mensagem is null or length(ultima_mensagem) <= 500),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger gta_sidago_acesso_updated before update on public.gta_sidago_acesso for each row execute function app.tg_updated_at();
create trigger auditoria_gta_sidago_acesso after insert or update or delete on public.gta_sidago_acesso for each row execute function app.tg_auditoria();

create table public.gta_sidago_segredo (
  empresa_id uuid primary key references public.gta_sidago_acesso(empresa_id) on delete cascade,
  conteudo_cifrado text not null check (conteudo_cifrado ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(conteudo_cifrado) <= 4000),
  created_at timestamptz not null default now()
);

create table public.gta_pedidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  -- Origem: a inscrição estadual (propriedade) que emite a NF-e
  emitente_id uuid references public.nfe_emitentes(id) on delete set null,
  -- Nota fiscal dos animais (o SIDAGO exige o número para bovinos e bubalinos)
  nfe_emissao_id uuid references public.nfe_emissoes(id) on delete set null,
  nf_numero bigint check (nf_numero is null or nf_numero between 1 and 999999999),
  nf_serie int check (nf_serie is null or nf_serie between 0 and 999),
  nf_chave text check (nf_chave is null or nf_chave ~ '^[0-9]{44}$'),
  -- Destino
  destino_nome text not null check (length(trim(destino_nome)) between 2 and 120),
  destino_documento text check (destino_documento is null or destino_documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  destino_ie text check (destino_ie is null or destino_ie ~ '^[0-9]{2,14}$'),
  destino_municipio_ibge text references public.municipios(ibge),
  -- Código do estabelecimento de destino no SIDAGO ou o registro de inspeção (SIF/SIE/SIM)
  destino_codigo text check (destino_codigo is null or length(destino_codigo) <= 30),
  finalidade text not null check (finalidade in ('abate', 'engorda', 'recria', 'reproducao', 'cria', 'exposicao', 'leilao', 'outra')),
  especie text not null default 'bovina' check (especie in ('bovina', 'bubalina', 'equina', 'suina', 'ovina', 'caprina', 'aves', 'outra')),
  -- [{ "sexo": "macho"|"femea", "faixa": "0-12"|"13-24"|"25-36"|"36+", "quantidade": n }]
  animais jsonb not null check (jsonb_typeof(animais) = 'array' and jsonb_array_length(animais) between 1 and 20),
  total_animais int not null check (total_animais between 1 and 99999),
  transporte text not null default 'rodoviario' check (transporte in ('rodoviario', 'a_pe', 'ferroviario', 'fluvial', 'outro')),
  placa text check (placa is null or placa ~ '^[A-Z0-9]{7}$'),
  placa_uf text check (placa_uf is null or placa_uf ~ '^[A-Z]{2}$'),
  transportador_nome text check (transportador_nome is null or length(transportador_nome) <= 120),
  transportador_documento text check (transportador_documento is null or transportador_documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  data_saida date not null,
  observacoes text check (observacoes is null or length(observacoes) <= 500),
  -- rascunho → conferido (o robô achou e preencheu o formulário) | erro; emitida: a pessoa anotou a GTA emitida no SIDAGO
  status text not null default 'rascunho' check (status in ('rascunho', 'conferido', 'erro', 'emitida')),
  ultima_conferencia_em timestamptz,
  gta_numero text check (gta_numero is null or gta_numero ~ '^[0-9A-Z]{1,20}$'),
  gta_serie text check (gta_serie is null or gta_serie ~ '^[0-9A-Z]{1,5}$'),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gta_pedidos_emitida check ((status = 'emitida') = (gta_numero is not null))
);
create index gta_pedidos_empresa_idx on public.gta_pedidos (empresa_id, created_at desc);
create trigger gta_pedidos_updated before update on public.gta_pedidos for each row execute function app.tg_updated_at();
create trigger auditoria_gta_pedidos after insert or update or delete on public.gta_pedidos for each row execute function app.tg_auditoria();

create table public.gta_conferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.gta_pedidos(id) on delete cascade,
  ok boolean not null,
  mensagem text check (mensagem is null or length(mensagem) <= 500),
  mapeamento jsonb check (mapeamento is null or pg_column_size(mapeamento) <= 200000),
  feito_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index gta_conferencias_pedido_idx on public.gta_conferencias (pedido_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Acesso ao SIDAGO (quem configura a NF-e da empresa)
-- -----------------------------------------------------------------------------
create or replace function public.gta_sidago_salvar_acesso(p_empresa_id uuid, p_login_mascarado text, p_conteudo_cifrado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  if p_conteudo_cifrado is null or p_conteudo_cifrado !~ '^v[0-9]+:[A-Za-z0-9+/=]+$' then
    raise exception 'Acesso inválido.';
  end if;
  insert into public.gta_sidago_acesso as a (empresa_id, login_mascarado, situacao, ultimo_teste_em, ultima_mensagem, atualizado_por)
  values (p_empresa_id, left(trim(p_login_mascarado), 80), 'nao_testado', null, null, auth.uid())
  on conflict (empresa_id) do update set login_mascarado = excluded.login_mascarado, situacao = 'nao_testado',
    ultimo_teste_em = null, ultima_mensagem = null, atualizado_por = auth.uid();
  insert into public.gta_sidago_segredo (empresa_id, conteudo_cifrado) values (p_empresa_id, p_conteudo_cifrado)
  on conflict (empresa_id) do update set conteudo_cifrado = excluded.conteudo_cifrado, created_at = now();
end;
$$;

create or replace function public.gta_sidago_remover_acesso(p_empresa_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  delete from public.gta_sidago_acesso where empresa_id = p_empresa_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pedidos de GTA (quem emite NF-e da empresa)
-- -----------------------------------------------------------------------------
create or replace function app.gta_exigir(p_empresa_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.pode(p_empresa_id, 'nfe.emitir') or app.pode(p_empresa_id, 'nfe.configurar')) then
    raise exception 'Você não tem permissão para preparar a GTA desta empresa.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.gta_pedido_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_atual public.gta_pedidos;
  v_emit uuid := nullif(p_dados ->> 'emitente_id', '')::uuid;
  v_nota public.nfe_emissoes;
  v_animais jsonb := '[]'::jsonb;
  v_total int := 0;
  a jsonb;
  v_q int;
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'destino_documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_tdoc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'transportador_documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_placa text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_mun text := nullif(p_dados ->> 'destino_municipio_ibge', '');
begin
  perform app.gta_exigir(p_empresa_id);
  if p_id is not null then
    select * into v_atual from public.gta_pedidos where id = p_id and empresa_id = p_empresa_id for update;
    if v_atual.id is null then
      raise exception 'Pedido de GTA não encontrado.';
    end if;
    if v_atual.status = 'emitida' then
      raise exception 'Esta GTA já foi emitida no SIDAGO: o pedido não muda.';
    end if;
  end if;
  if v_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_emit and empresa_id = p_empresa_id) then
    raise exception 'A inscrição de origem não é desta empresa.';
  end if;
  if nullif(p_dados ->> 'nfe_emissao_id', '') is not null then
    select * into v_nota from public.nfe_emissoes where id = (p_dados ->> 'nfe_emissao_id')::uuid and empresa_id = p_empresa_id;
    if v_nota.id is null then
      raise exception 'Nota fiscal não encontrada.';
    end if;
  end if;
  if length(trim(coalesce(p_dados ->> 'destino_nome', ''))) < 2 then
    raise exception 'Informe o destino (nome do comprador ou do estabelecimento).';
  end if;
  if v_doc is not null and not (app.cpf_valido(v_doc) or app.cnpj_valido(v_doc)) then
    raise exception 'CPF ou CNPJ do destino inválido.';
  end if;
  if v_tdoc is not null and not (app.cpf_valido(v_tdoc) or app.cnpj_valido(v_tdoc)) then
    raise exception 'CPF ou CNPJ do transportador inválido.';
  end if;
  if v_mun is not null and not exists (select 1 from public.municipios where ibge = v_mun) then
    raise exception 'Município de destino não encontrado.';
  end if;
  if v_placa is not null and v_placa !~ '^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$' then
    raise exception 'Placa inválida (ex.: ABC1D23).';
  end if;
  if coalesce(p_dados ->> 'finalidade', '') not in ('abate', 'engorda', 'recria', 'reproducao', 'cria', 'exposicao', 'leilao', 'outra') then
    raise exception 'Escolha a finalidade.';
  end if;
  if nullif(p_dados ->> 'data_saida', '') is null then
    raise exception 'Informe a data de saída.';
  end if;
  -- Animais por sexo e idade (linhas repetidas são somadas)
  if jsonb_typeof(p_dados -> 'animais') <> 'array' then
    raise exception 'Informe os animais.';
  end if;
  for a in select * from jsonb_array_elements(p_dados -> 'animais') loop
    v_q := nullif(a ->> 'quantidade', '')::int;
    continue when v_q is null or v_q = 0;
    if a ->> 'sexo' not in ('macho', 'femea') or a ->> 'faixa' not in ('0-12', '13-24', '25-36', '36+') or v_q < 0 or v_q > 9999 then
      raise exception 'Confira os animais: sexo, idade e quantidade (1 a 9.999).';
    end if;
    if exists (select 1 from jsonb_array_elements(v_animais) x where x ->> 'sexo' = a ->> 'sexo' and x ->> 'faixa' = a ->> 'faixa') then
      select coalesce(jsonb_agg(case when x ->> 'sexo' = a ->> 'sexo' and x ->> 'faixa' = a ->> 'faixa'
                                     then jsonb_set(x, '{quantidade}', to_jsonb((x ->> 'quantidade')::int + v_q)) else x end), '[]'::jsonb)
        into v_animais from jsonb_array_elements(v_animais) x;
    else
      v_animais := v_animais || jsonb_build_array(jsonb_build_object('sexo', a ->> 'sexo', 'faixa', a ->> 'faixa', 'quantidade', v_q));
    end if;
    v_total := v_total + v_q;
  end loop;
  if v_total = 0 then
    raise exception 'Informe quantos animais vão na GTA.';
  end if;

  insert into public.gta_pedidos as g (
    id, empresa_id, emitente_id, nfe_emissao_id, nf_numero, nf_serie, nf_chave, destino_nome, destino_documento, destino_ie,
    destino_municipio_ibge, destino_codigo, finalidade, especie, animais, total_animais, transporte, placa, placa_uf,
    transportador_nome, transportador_documento, data_saida, observacoes, status
  ) values (
    coalesce(p_id, gen_random_uuid()), p_empresa_id, coalesce(v_emit, v_nota.emitente_id), v_nota.id,
    coalesce(v_nota.numero, nullif(p_dados ->> 'nf_numero', '')::bigint), coalesce(v_nota.serie, nullif(p_dados ->> 'nf_serie', '')::int),
    coalesce(v_nota.chave, nullif(regexp_replace(coalesce(p_dados ->> 'nf_chave', ''), '\D', '', 'g'), '')),
    left(trim(p_dados ->> 'destino_nome'), 120), v_doc, nullif(regexp_replace(coalesce(p_dados ->> 'destino_ie', ''), '\D', '', 'g'), ''),
    v_mun, nullif(left(trim(coalesce(p_dados ->> 'destino_codigo', '')), 30), ''), p_dados ->> 'finalidade',
    coalesce(nullif(p_dados ->> 'especie', ''), 'bovina'), v_animais, v_total, coalesce(nullif(p_dados ->> 'transporte', ''), 'rodoviario'),
    v_placa, nullif(upper(trim(coalesce(p_dados ->> 'placa_uf', ''))), ''), nullif(left(trim(coalesce(p_dados ->> 'transportador_nome', '')), 120), ''),
    v_tdoc, (p_dados ->> 'data_saida')::date, nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 500), ''), 'rascunho'
  )
  on conflict (id) do update set
    emitente_id = excluded.emitente_id, nfe_emissao_id = excluded.nfe_emissao_id, nf_numero = excluded.nf_numero, nf_serie = excluded.nf_serie,
    nf_chave = excluded.nf_chave, destino_nome = excluded.destino_nome, destino_documento = excluded.destino_documento, destino_ie = excluded.destino_ie,
    destino_municipio_ibge = excluded.destino_municipio_ibge, destino_codigo = excluded.destino_codigo, finalidade = excluded.finalidade,
    especie = excluded.especie, animais = excluded.animais, total_animais = excluded.total_animais, transporte = excluded.transporte,
    placa = excluded.placa, placa_uf = excluded.placa_uf, transportador_nome = excluded.transportador_nome,
    transportador_documento = excluded.transportador_documento, data_saida = excluded.data_saida, observacoes = excluded.observacoes,
    -- Dados mudaram: a conferência anterior não vale mais
    status = 'rascunho'
  returning g.id into v_id;
  return v_id;
end;
$$;

create or replace function public.gta_pedido_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.gta_pedidos;
begin
  select * into g from public.gta_pedidos where id = p_id;
  if g.id is null then
    raise exception 'Pedido de GTA não encontrado.';
  end if;
  perform app.gta_exigir(g.empresa_id);
  if g.status = 'emitida' then
    raise exception 'GTA emitida no SIDAGO não é apagada do portal.';
  end if;
  delete from public.gta_pedidos where id = g.id;
end;
$$;

-- Resultado da conferência no SIDAGO (o servidor chama depois de rodar o robô)
create or replace function public.gta_conferencia_registrar(p_pedido_id uuid, p_ok boolean, p_mensagem text, p_mapeamento jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.gta_pedidos;
  v_id uuid;
begin
  select * into g from public.gta_pedidos where id = p_pedido_id for update;
  if g.id is null then
    raise exception 'Pedido de GTA não encontrado.';
  end if;
  perform app.gta_exigir(g.empresa_id);
  insert into public.gta_conferencias (empresa_id, pedido_id, ok, mensagem, mapeamento)
  values (g.empresa_id, g.id, coalesce(p_ok, false), left(p_mensagem, 500), p_mapeamento)
  returning id into v_id;
  if g.status <> 'emitida' then
    update public.gta_pedidos set status = case when p_ok then 'conferido' else 'erro' end, ultima_conferencia_em = now() where id = g.id;
  end if;
  update public.gta_sidago_acesso
     set situacao = case when p_ok or coalesce(p_mapeamento ->> 'login', '') = 'ok' then 'conectado' else 'erro' end,
         ultimo_teste_em = now(), ultima_mensagem = left(p_mensagem, 500)
   where empresa_id = g.empresa_id;
  return v_id;
end;
$$;

-- A pessoa emitiu a GTA no SIDAGO e anota o número (para conferência e para a nota)
create or replace function public.gta_pedido_registrar_emissao(p_id uuid, p_numero text, p_serie text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.gta_pedidos;
  v_num text := upper(regexp_replace(coalesce(p_numero, ''), '[\s./-]', '', 'g'));
  v_serie text := nullif(upper(regexp_replace(coalesce(p_serie, ''), '[\s./-]', '', 'g')), '');
begin
  select * into g from public.gta_pedidos where id = p_id for update;
  if g.id is null then
    raise exception 'Pedido de GTA não encontrado.';
  end if;
  perform app.gta_exigir(g.empresa_id);
  if v_num !~ '^[0-9A-Z]{1,20}$' then
    raise exception 'Número da GTA inválido: use só números e letras, até 20.';
  end if;
  if v_serie is not null and v_serie !~ '^[0-9A-Z]{1,5}$' then
    raise exception 'Série da GTA inválida: até 5 números ou letras.';
  end if;
  update public.gta_pedidos set status = 'emitida', gta_numero = v_num, gta_serie = v_serie where id = g.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Acesso: leitura por quem emite ou configura a NF-e da empresa; o segredo não
-- tem política (só o servidor lê); escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.gta_sidago_acesso enable row level security;
alter table public.gta_sidago_segredo enable row level security;
alter table public.gta_pedidos enable row level security;
alter table public.gta_conferencias enable row level security;

create policy gta_sidago_acesso_leitura on public.gta_sidago_acesso for select to authenticated
  using (empresa_id = any ((select app.empresas_com('nfe.emitir'))::uuid[]) or empresa_id = any ((select app.empresas_com('nfe.configurar'))::uuid[]));
create policy gta_pedidos_leitura on public.gta_pedidos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('nfe.emitir'))::uuid[]) or empresa_id = any ((select app.empresas_com('nfe.configurar'))::uuid[]));
create policy gta_conferencias_leitura on public.gta_conferencias for select to authenticated
  using (empresa_id = any ((select app.empresas_com('nfe.emitir'))::uuid[]) or empresa_id = any ((select app.empresas_com('nfe.configurar'))::uuid[]));

grant select on public.gta_sidago_acesso, public.gta_pedidos, public.gta_conferencias to authenticated;
grant select, insert, update, delete on public.gta_sidago_acesso, public.gta_sidago_segredo, public.gta_pedidos, public.gta_conferencias to service_role;

revoke execute on function app.gta_exigir(uuid) from public, anon, authenticated;
revoke execute on function public.gta_sidago_salvar_acesso(uuid, text, text), public.gta_sidago_remover_acesso(uuid), public.gta_pedido_salvar(uuid, uuid, jsonb),
  public.gta_pedido_excluir(uuid), public.gta_conferencia_registrar(uuid, boolean, text, jsonb), public.gta_pedido_registrar_emissao(uuid, text, text)
  from public, anon;
grant execute on function public.gta_sidago_salvar_acesso(uuid, text, text), public.gta_sidago_remover_acesso(uuid), public.gta_pedido_salvar(uuid, uuid, jsonb),
  public.gta_pedido_excluir(uuid), public.gta_conferencia_registrar(uuid, boolean, text, jsonb), public.gta_pedido_registrar_emissao(uuid, text, text)
  to authenticated;
