-- =============================================================================
-- Gestão: modalidade "Notas e transporte" e ordens de carregamento
--
-- Além da loja completa (caixa, vendas e estoque), a gestão pode ser contratada
-- na modalidade "notas": para quem vende grãos (soja, milho) e só precisa
-- emitir notas e organizar os carregamentos. A ordem de carregamento autoriza
-- o caminhão a carregar no armazém/fazenda: comprador, produto, quantidade,
-- transportador, motorista e veículo. Depois da pesagem (bruto, tara, líquido,
-- umidade e impureza), a NF-e sai preenchida a partir da ordem e fica ligada a ela.
-- A ordem é um documento de controle: não substitui a NF-e nem o MDF-e/CT-e.
-- =============================================================================

alter table public.gestao_config
  add column modalidade text not null default 'loja' check (modalidade in ('loja', 'notas')),
  add column proximo_numero_ordem bigint not null default 1 check (proximo_numero_ordem >= 1);

create or replace function public.gestao_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_equipe boolean := app.e_equipe_da_empresa(p_empresa_id);
  v_atual public.gestao_config;
  v_ativa boolean;
  v_perfil text;
  v_modalidade text;
  v_desc numeric := nullif(p_dados ->> 'desconto_maximo_operador', '')::numeric;
  v_dinheiro uuid := nullif(p_dados ->> 'conta_dinheiro_id', '')::uuid;
  v_pix uuid := nullif(p_dados ->> 'conta_pix_id', '')::uuid;
  v_cartao uuid := nullif(p_dados ->> 'conta_cartao_id', '')::uuid;
  v_nfe_op uuid;
  v_nfe_emit uuid;
begin
  select * into v_atual from public.gestao_config where empresa_id = p_empresa_id;
  if v_equipe then
    v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_atual.ativa, false);
    v_perfil := coalesce(nullif(p_dados ->> 'perfil_fiscal', ''), v_atual.perfil_fiscal, 'comercio');
    v_modalidade := coalesce(nullif(p_dados ->> 'modalidade', ''), v_atual.modalidade, 'loja');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
    v_ativa := v_atual.ativa;
    v_perfil := v_atual.perfil_fiscal;
    v_modalidade := v_atual.modalidade;
  end if;
  if v_modalidade not in ('loja', 'notas') then
    raise exception 'Escolha a modalidade: loja completa ou notas e transporte.';
  end if;

  -- As contas do caixa, do banco e da maquininha só fazem sentido na loja completa
  if v_ativa and v_modalidade = 'loja' then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', 'Caixa da loja'));
    v_pix := coalesce(v_pix, v_atual.conta_pix_id, app.gestao_conta(p_empresa_id, 'conta_corrente', 'Banco (PIX e transferências)'));
    v_cartao := coalesce(v_cartao, v_atual.conta_cartao_id, app.gestao_conta(p_empresa_id, 'adquirente', 'Maquininha de cartão'));
  end if;
  -- NF-e na hora da venda: operação fiscal e inscrição que emite (da própria empresa)
  v_nfe_op := case when p_dados ? 'nfe_operacao_id' then nullif(p_dados ->> 'nfe_operacao_id', '')::uuid else v_atual.nfe_operacao_id end;
  v_nfe_emit := case when p_dados ? 'nfe_emitente_id' then nullif(p_dados ->> 'nfe_emitente_id', '')::uuid else v_atual.nfe_emitente_id end;
  if v_nfe_op is not null and not exists (select 1 from public.nfe_operacoes where id = v_nfe_op and empresa_id = p_empresa_id and ativa) then
    raise exception 'A operação da NF-e escolhida não é desta empresa ou está desativada.';
  end if;
  if v_nfe_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_nfe_emit and empresa_id = p_empresa_id and ativo) then
    raise exception 'A inscrição que emite a NF-e não é desta empresa ou está desativada.';
  end if;
  if (v_dinheiro is not null and v_dinheiro in (v_pix, v_cartao)) then
    raise exception 'A conta do dinheiro precisa ser diferente da conta do PIX e da maquininha.';
  end if;

  insert into public.gestao_config as g (
    empresa_id, ativa, perfil_fiscal, permitir_estoque_negativo, permitir_venda_prazo, desconto_maximo_operador,
    conta_dinheiro_id, conta_pix_id, conta_cartao_id, validade_orcamento_dias, mensagem_comprovante, ativada_por, ativada_em,
    nfe_operacao_id, nfe_emitente_id, nfe_marcada_padrao, modalidade
  ) values (
    p_empresa_id, v_ativa, v_perfil,
    coalesce((p_dados ->> 'permitir_estoque_negativo')::boolean, v_atual.permitir_estoque_negativo, false),
    coalesce((p_dados ->> 'permitir_venda_prazo')::boolean, v_atual.permitir_venda_prazo, true),
    case when p_dados ? 'desconto_maximo_operador' then v_desc else v_atual.desconto_maximo_operador end,
    v_dinheiro, v_pix, v_cartao,
    coalesce((p_dados ->> 'validade_orcamento_dias')::int, v_atual.validade_orcamento_dias, 15),
    case when p_dados ? 'mensagem_comprovante' then nullif(trim(p_dados ->> 'mensagem_comprovante'), '') else v_atual.mensagem_comprovante end,
    case when v_ativa then auth.uid() end, case when v_ativa then now() end,
    v_nfe_op, v_nfe_emit, coalesce((p_dados ->> 'nfe_marcada_padrao')::boolean, v_atual.nfe_marcada_padrao, false), v_modalidade
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    perfil_fiscal = excluded.perfil_fiscal,
    permitir_estoque_negativo = excluded.permitir_estoque_negativo,
    permitir_venda_prazo = excluded.permitir_venda_prazo,
    desconto_maximo_operador = excluded.desconto_maximo_operador,
    conta_dinheiro_id = excluded.conta_dinheiro_id,
    conta_pix_id = excluded.conta_pix_id,
    conta_cartao_id = excluded.conta_cartao_id,
    validade_orcamento_dias = excluded.validade_orcamento_dias,
    mensagem_comprovante = excluded.mensagem_comprovante,
    ativada_por = case when excluded.ativa and not g.ativa then auth.uid() else g.ativada_por end,
    ativada_em = case when excluded.ativa and not g.ativa then now() else g.ativada_em end,
    nfe_operacao_id = excluded.nfe_operacao_id,
    nfe_emitente_id = excluded.nfe_emitente_id,
    nfe_marcada_padrao = excluded.nfe_marcada_padrao,
    modalidade = excluded.modalidade,
    atualizado_por = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- Ordens de carregamento
-- -----------------------------------------------------------------------------
create table public.ordens_carregamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  status text not null default 'aberta' check (status in ('aberta', 'carregada', 'faturada', 'cancelada')),
  data_emissao date not null default app.hoje(),
  validade date,
  -- Quem vende e onde carrega (inscrição que emite a NF-e)
  emitente_id uuid references public.nfe_emitentes(id) on delete set null,
  local_carregamento text check (local_carregamento is null or length(local_carregamento) <= 300),
  -- Comprador e onde descarrega
  destinatario_id uuid references public.nfe_destinatarios(id) on delete set null,
  destinatario_nome text not null check (length(trim(destinatario_nome)) between 2 and 120),
  destinatario_documento text check (destinatario_documento is null or destinatario_documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  local_descarga text check (local_descarga is null or length(local_descarga) <= 300),
  -- Produto e quantidade prevista (na unidade do produto)
  produto_id uuid not null references public.nfe_produtos(id) on delete restrict,
  produto_descricao text not null,
  unidade text not null,
  quantidade numeric(18, 4) not null check (quantidade > 0),
  peso_previsto_kg numeric(15, 3) check (peso_previsto_kg is null or peso_previsto_kg > 0),
  preco_unitario numeric(15, 6) check (preco_unitario is null or preco_unitario >= 0),
  operacao_id uuid references public.nfe_operacoes(id) on delete set null,
  contrato text check (contrato is null or length(contrato) <= 60),
  -- Transporte
  frete_por_conta smallint not null default 0 check (frete_por_conta in (0, 1, 2, 3, 4, 9)),
  transportador_id uuid references public.nfe_transportadores(id) on delete set null,
  transportador_nome text check (transportador_nome is null or length(transportador_nome) <= 60),
  transportador_documento text,
  rntrc text check (rntrc is null or length(rntrc) <= 20),
  motorista_nome text check (motorista_nome is null or length(motorista_nome) <= 60),
  motorista_cpf text check (motorista_cpf is null or motorista_cpf ~ '^[0-9]{11}$'),
  placa text check (placa is null or placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  placa_uf char(2) check (placa_uf is null or placa_uf ~ '^[A-Z]{2}$'),
  placas_reboque text[] not null default '{}' check (cardinality(placas_reboque) <= 3),
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  -- Pesagem (balança) e classificação
  peso_bruto_kg numeric(15, 3) check (peso_bruto_kg is null or peso_bruto_kg > 0),
  tara_kg numeric(15, 3) check (tara_kg is null or tara_kg > 0),
  peso_liquido_kg numeric(15, 3) check (peso_liquido_kg is null or peso_liquido_kg > 0),
  umidade numeric(5, 2) check (umidade is null or umidade between 0 and 100),
  impureza numeric(5, 2) check (impureza is null or impureza between 0 and 100),
  ticket_balanca text check (ticket_balanca is null or length(ticket_balanca) <= 30),
  carregado_em timestamptz,
  -- Nota fiscal da ordem
  nfe_emissao_id uuid references public.nfe_emissoes(id) on delete set null,
  cancelada_em timestamptz,
  cancelada_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ordens_carregamento_numero_uk unique (empresa_id, numero),
  constraint ordens_carregamento_peso check (peso_liquido_kg is null or (peso_bruto_kg is not null and tara_kg is not null and peso_liquido_kg = peso_bruto_kg - tara_kg))
);
create index ordens_carregamento_empresa_idx on public.ordens_carregamento (empresa_id, data_emissao desc);
create trigger ordens_carregamento_updated_at before update on public.ordens_carregamento
  for each row execute function app.tg_updated_at();

alter table public.ordens_carregamento enable row level security;
create policy ordens_carregamento_leitura on public.ordens_carregamento for select to authenticated
  using (empresa_id = any ((select app.empresas_com('nfe.emitir'))::uuid[]));
grant select on public.ordens_carregamento to authenticated;
grant select, insert, update, delete on public.ordens_carregamento to service_role;

-- A nota ligada à ordem ainda vale (não foi cancelada, descartada nem recusada)?
create or replace function app.carregamento_nota_ativa(p_nfe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_nfe_id is not null and exists (
    select 1 from public.nfe_emissoes where id = p_nfe_id and situacao not in ('cancelada', 'descartada', 'rejeitada', 'denegada')
  );
$$;
revoke execute on function app.carregamento_nota_ativa(uuid) from public, anon;

-- Cria ou altera a ordem (enquanto não foi faturada nem cancelada)
create or replace function public.carregamento_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ordem public.ordens_carregamento;
  v_prod public.nfe_produtos;
  v_dest public.nfe_destinatarios;
  v_transp public.nfe_transportadores;
  v_numero bigint;
  v_id uuid;
  v_qtd numeric := nullif(p_dados ->> 'quantidade', '')::numeric;
  v_placa text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa', ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_reboques text[];
  v_cpf text := nullif(regexp_replace(coalesce(p_dados ->> 'motorista_cpf', ''), '\D', '', 'g'), '');
begin
  perform app.exigir_gestao(p_empresa_id, 'nfe.emitir');
  if p_id is not null then
    select * into v_ordem from public.ordens_carregamento where id = p_id and empresa_id = p_empresa_id for update;
    if v_ordem.id is null then
      raise exception 'Ordem de carregamento não encontrada.';
    end if;
    if v_ordem.status = 'cancelada' then
      raise exception 'Esta ordem foi cancelada e não pode mais ser alterada.';
    end if;
    if v_ordem.status = 'faturada' and app.carregamento_nota_ativa(v_ordem.nfe_emissao_id) then
      raise exception 'Esta ordem já tem NF-e e não pode mais ser alterada.';
    end if;
  end if;

  select * into v_prod from public.nfe_produtos where id = nullif(p_dados ->> 'produto_id', '')::uuid and empresa_id = p_empresa_id and ativo;
  if v_prod.id is null then
    raise exception 'Escolha o produto (soja, milho...) do cadastro da NF-e.';
  end if;
  if v_qtd is null or v_qtd <= 0 or v_qtd <> round(v_qtd, 4) then
    raise exception 'Informe a quantidade prevista (até 4 casas decimais).';
  end if;
  if nullif(p_dados ->> 'destinatario_id', '') is not null then
    select * into v_dest from public.nfe_destinatarios where id = (p_dados ->> 'destinatario_id')::uuid and empresa_id = p_empresa_id;
    if v_dest.id is null then
      raise exception 'Comprador não encontrado no cadastro da NF-e.';
    end if;
  elsif length(trim(coalesce(p_dados ->> 'destinatario_nome', ''))) < 2 then
    raise exception 'Escolha o comprador (ou informe o nome).';
  end if;
  if nullif(p_dados ->> 'transportador_id', '') is not null then
    select * into v_transp from public.nfe_transportadores where id = (p_dados ->> 'transportador_id')::uuid and empresa_id = p_empresa_id;
    if v_transp.id is null then
      raise exception 'Transportador não encontrado no cadastro da NF-e.';
    end if;
  end if;
  if nullif(p_dados ->> 'emitente_id', '') is not null
     and not exists (select 1 from public.nfe_emitentes where id = (p_dados ->> 'emitente_id')::uuid and empresa_id = p_empresa_id) then
    raise exception 'Inscrição que vende não encontrada.';
  end if;
  if nullif(p_dados ->> 'operacao_id', '') is not null
     and not exists (select 1 from public.nfe_operacoes where id = (p_dados ->> 'operacao_id')::uuid and empresa_id = p_empresa_id) then
    raise exception 'Operação da NF-e não encontrada.';
  end if;
  if v_placa is not null and v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    raise exception 'Placa inválida. Use o formato ABC1D23 ou ABC1234.';
  end if;
  if v_cpf is not null and length(v_cpf) <> 11 then
    raise exception 'O CPF do motorista tem 11 números.';
  end if;
  select coalesce(array_agg(p), '{}') into v_reboques
    from (select upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')) as p
            from jsonb_array_elements_text(coalesce(p_dados -> 'placas_reboque', '[]'::jsonb)) x) r
   where p <> '';
  if exists (select 1 from unnest(v_reboques) p where p !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$') then
    raise exception 'Placa de carreta inválida. Use o formato ABC1D23 ou ABC1234.';
  end if;
  if cardinality(v_reboques) > 3 then
    raise exception 'No máximo 3 carretas.';
  end if;

  if p_id is null then
    insert into public.gestao_config (empresa_id) values (p_empresa_id) on conflict (empresa_id) do nothing;
    update public.gestao_config set proximo_numero_ordem = proximo_numero_ordem + 1
     where empresa_id = p_empresa_id returning proximo_numero_ordem - 1 into v_numero;
  end if;

  if p_id is null then
    insert into public.ordens_carregamento (
      empresa_id, numero, data_emissao, validade, emitente_id, local_carregamento, destinatario_id, destinatario_nome, destinatario_documento,
      local_descarga, produto_id, produto_descricao, unidade, quantidade, peso_previsto_kg, preco_unitario, operacao_id, contrato,
      frete_por_conta, transportador_id, transportador_nome, transportador_documento, rntrc, motorista_nome, motorista_cpf, placa, placa_uf,
      placas_reboque, observacoes
    ) values (
      p_empresa_id, v_numero, coalesce(nullif(p_dados ->> 'data_emissao', '')::date, app.hoje()), nullif(p_dados ->> 'validade', '')::date,
      nullif(p_dados ->> 'emitente_id', '')::uuid, nullif(trim(p_dados ->> 'local_carregamento'), ''),
      v_dest.id, coalesce(v_dest.nome, trim(p_dados ->> 'destinatario_nome')), coalesce(v_dest.documento, nullif(regexp_replace(coalesce(p_dados ->> 'destinatario_documento', ''), '\D', '', 'g'), '')),
      nullif(trim(p_dados ->> 'local_descarga'), ''), v_prod.id, v_prod.descricao, v_prod.unidade, v_qtd,
      coalesce(nullif(p_dados ->> 'peso_previsto_kg', '')::numeric, case when v_prod.peso_kg is not null then round(v_qtd * v_prod.peso_kg, 3) end),
      nullif(p_dados ->> 'preco_unitario', '')::numeric, nullif(p_dados ->> 'operacao_id', '')::uuid, nullif(trim(p_dados ->> 'contrato'), ''),
      coalesce(nullif(p_dados ->> 'frete_por_conta', '')::smallint, 0), v_transp.id, coalesce(v_transp.nome, nullif(trim(p_dados ->> 'transportador_nome'), '')),
      v_transp.documento, coalesce(nullif(trim(p_dados ->> 'rntrc'), ''), v_transp.rntc), nullif(trim(p_dados ->> 'motorista_nome'), ''), v_cpf,
      coalesce(v_placa, v_transp.placa), coalesce(nullif(upper(p_dados ->> 'placa_uf'), ''), v_transp.placa_uf), v_reboques, nullif(trim(p_dados ->> 'observacoes'), '')
    ) returning id into v_id;
  else
    update public.ordens_carregamento set
      validade = nullif(p_dados ->> 'validade', '')::date,
      emitente_id = nullif(p_dados ->> 'emitente_id', '')::uuid,
      local_carregamento = nullif(trim(p_dados ->> 'local_carregamento'), ''),
      destinatario_id = v_dest.id,
      destinatario_nome = coalesce(v_dest.nome, trim(p_dados ->> 'destinatario_nome')),
      destinatario_documento = coalesce(v_dest.documento, nullif(regexp_replace(coalesce(p_dados ->> 'destinatario_documento', ''), '\D', '', 'g'), '')),
      local_descarga = nullif(trim(p_dados ->> 'local_descarga'), ''),
      produto_id = v_prod.id, produto_descricao = v_prod.descricao, unidade = v_prod.unidade, quantidade = v_qtd,
      peso_previsto_kg = coalesce(nullif(p_dados ->> 'peso_previsto_kg', '')::numeric, case when v_prod.peso_kg is not null then round(v_qtd * v_prod.peso_kg, 3) end),
      preco_unitario = nullif(p_dados ->> 'preco_unitario', '')::numeric,
      operacao_id = nullif(p_dados ->> 'operacao_id', '')::uuid,
      contrato = nullif(trim(p_dados ->> 'contrato'), ''),
      frete_por_conta = coalesce(nullif(p_dados ->> 'frete_por_conta', '')::smallint, 0),
      transportador_id = v_transp.id,
      transportador_nome = coalesce(v_transp.nome, nullif(trim(p_dados ->> 'transportador_nome'), '')),
      transportador_documento = v_transp.documento,
      rntrc = coalesce(nullif(trim(p_dados ->> 'rntrc'), ''), v_transp.rntc),
      motorista_nome = nullif(trim(p_dados ->> 'motorista_nome'), ''),
      motorista_cpf = v_cpf,
      placa = coalesce(v_placa, v_transp.placa),
      placa_uf = coalesce(nullif(upper(p_dados ->> 'placa_uf'), ''), v_transp.placa_uf),
      placas_reboque = v_reboques,
      observacoes = nullif(trim(p_dados ->> 'observacoes'), ''),
      -- A nota anterior não vale mais: a ordem volta a aguardar a NF-e
      status = case when status = 'faturada' then case when peso_liquido_kg is null then 'aberta' else 'carregada' end else status end,
      nfe_emissao_id = case when status = 'faturada' then null else nfe_emissao_id end
    where id = p_id
    returning id, numero into v_id, v_numero;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;

-- Pesagem na balança: o caminhão carregou
create or replace function public.carregamento_pesagem(p_id uuid, p_dados jsonb)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ordens_carregamento;
  v_bruto numeric := nullif(p_dados ->> 'peso_bruto_kg', '')::numeric;
  v_tara numeric := nullif(p_dados ->> 'tara_kg', '')::numeric;
begin
  select * into v from public.ordens_carregamento where id = p_id for update;
  if v.id is null then
    raise exception 'Ordem de carregamento não encontrada.';
  end if;
  perform app.exigir_gestao(v.empresa_id, 'nfe.emitir');
  if v.status = 'cancelada' then
    raise exception 'Esta ordem foi cancelada e a pesagem não pode mais mudar.';
  end if;
  if v.status = 'faturada' and app.carregamento_nota_ativa(v.nfe_emissao_id) then
    raise exception 'Esta ordem já tem NF-e e a pesagem não pode mais mudar.';
  end if;
  if v_bruto is null or v_tara is null or v_bruto <= 0 or v_tara <= 0 then
    raise exception 'Informe o peso bruto e a tara (em kg).';
  end if;
  if v_bruto <= v_tara then
    raise exception 'O peso bruto precisa ser maior que a tara.';
  end if;
  update public.ordens_carregamento set
    peso_bruto_kg = round(v_bruto, 3), tara_kg = round(v_tara, 3), peso_liquido_kg = round(v_bruto, 3) - round(v_tara, 3),
    umidade = nullif(p_dados ->> 'umidade', '')::numeric, impureza = nullif(p_dados ->> 'impureza', '')::numeric,
    ticket_balanca = nullif(trim(p_dados ->> 'ticket_balanca'), ''),
    carregado_em = coalesce(nullif(p_dados ->> 'carregado_em', '')::timestamptz, now()),
    status = 'carregada'
  where id = v.id;
  return round(v_bruto, 3) - round(v_tara, 3);
end;
$$;

create or replace function public.carregamento_cancelar(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ordens_carregamento;
begin
  select * into v from public.ordens_carregamento where id = p_id for update;
  if v.id is null then
    raise exception 'Ordem de carregamento não encontrada.';
  end if;
  perform app.exigir_gestao(v.empresa_id, 'nfe.emitir');
  if v.status = 'cancelada' then
    raise exception 'Esta ordem já está cancelada.';
  end if;
  if app.carregamento_nota_ativa(v.nfe_emissao_id) then
    raise exception 'A ordem tem NF-e emitida. Cancele a nota antes de cancelar a ordem.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.ordens_carregamento set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 500)
   where id = v.id;
end;
$$;

-- Liga a NF-e emitida à ordem
create or replace function public.carregamento_vincular_nfe(p_id uuid, p_nfe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ordens_carregamento;
begin
  select * into v from public.ordens_carregamento where id = p_id for update;
  if v.id is null then
    raise exception 'Ordem de carregamento não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.emitir');
  if v.status = 'cancelada' then
    raise exception 'Esta ordem está cancelada.';
  end if;
  if not exists (select 1 from public.nfe_emissoes where id = p_nfe_id and empresa_id = v.empresa_id) then
    raise exception 'Nota não encontrada.';
  end if;
  -- Uma nota por ordem: outra só depois que a anterior foi descartada, cancelada ou recusada
  if v.nfe_emissao_id is distinct from p_nfe_id and app.carregamento_nota_ativa(v.nfe_emissao_id) then
    raise exception 'Esta ordem já tem NF-e. Cancele ou descarte a nota anterior antes de emitir outra.';
  end if;
  update public.ordens_carregamento set nfe_emissao_id = p_nfe_id, status = 'faturada' where id = v.id;
end;
$$;

revoke execute on function public.carregamento_salvar(uuid, uuid, jsonb), public.carregamento_pesagem(uuid, jsonb),
  public.carregamento_cancelar(uuid, text), public.carregamento_vincular_nfe(uuid, uuid) from public, anon;
grant execute on function public.carregamento_salvar(uuid, uuid, jsonb), public.carregamento_pesagem(uuid, jsonb),
  public.carregamento_cancelar(uuid, text), public.carregamento_vincular_nfe(uuid, uuid) to authenticated;
