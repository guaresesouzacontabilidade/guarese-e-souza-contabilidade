-- Estoque: importação de produtos por planilha, vínculo do código do fornecedor
-- com o produto da loja (com fator de conversão, ex.: 1 caixa = 12 unidades),
-- produto criado a partir do item da nota e entrada automática da nota de
-- compra quando todos os itens já têm vínculo.

-- -----------------------------------------------------------------------------
-- 1. Vínculos: o item do fornecedor (CNPJ/CPF + código dele) é este produto
-- -----------------------------------------------------------------------------
create table public.estoque_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fornecedor_documento text not null check (fornecedor_documento ~ '^[0-9A-Z]{11,14}$'),
  codigo_fornecedor text not null check (length(trim(codigo_fornecedor)) between 1 and 60),
  produto_id uuid not null references public.nfe_produtos(id) on delete cascade,
  -- Quantas unidades da loja vêm em uma unidade do fornecedor
  fator numeric(18, 6) not null default 1 check (fator > 0),
  descricao_fornecedor text check (descricao_fornecedor is null or length(descricao_fornecedor) <= 500),
  unidade_fornecedor text check (unidade_fornecedor is null or length(unidade_fornecedor) <= 6),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estoque_vinculos_uk unique (empresa_id, fornecedor_documento, codigo_fornecedor)
);
create index estoque_vinculos_produto_idx on public.estoque_vinculos (produto_id);
create trigger estoque_vinculos_updated_at before update on public.estoque_vinculos for each row execute function app.tg_updated_at();
alter table public.estoque_vinculos enable row level security;
create policy estoque_vinculos_leitura on public.estoque_vinculos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
grant select on public.estoque_vinculos to authenticated;
-- Remover um vínculo (o próximo item do fornecedor volta a pedir conferência)
create policy estoque_vinculos_exclusao on public.estoque_vinculos for delete to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
grant delete on public.estoque_vinculos to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Entrada automática (por empresa, desligada por padrão)
-- -----------------------------------------------------------------------------
alter table public.gestao_config add column entrada_automatica boolean not null default false;

create or replace function public.gestao_entrada_automatica_definir(p_empresa_id uuid, p_ligada boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  update public.gestao_config set entrada_automatica = coalesce(p_ligada, false) where empresa_id = p_empresa_id;
end;
$$;

-- Guarda (ou troca) o vínculo de um item do fornecedor com o produto
create or replace function app.estoque_vincular(
  p_empresa_id uuid, p_fornecedor text, p_codigo text, p_produto_id uuid, p_fator numeric, p_descricao text, p_unidade text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_forn text := upper(regexp_replace(coalesce(p_fornecedor, ''), '[^0-9A-Za-z]', '', 'g'));
begin
  if v_forn !~ '^[0-9A-Z]{11,14}$' or nullif(trim(p_codigo), '') is null then
    return;
  end if;
  insert into public.estoque_vinculos (empresa_id, fornecedor_documento, codigo_fornecedor, produto_id, fator, descricao_fornecedor, unidade_fornecedor)
  values (p_empresa_id, v_forn, left(trim(p_codigo), 60), p_produto_id, coalesce(nullif(p_fator, 0), 1), left(p_descricao, 500), left(upper(trim(p_unidade)), 6))
  on conflict (empresa_id, fornecedor_documento, codigo_fornecedor) do update
    set produto_id = excluded.produto_id, fator = excluded.fator,
        descricao_fornecedor = excluded.descricao_fornecedor, unidade_fornecedor = excluded.unidade_fornecedor,
        atualizado_por = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Entrada pela nota: produto existente ou novo (criado do item) e vínculo lembrado
-- -----------------------------------------------------------------------------
create or replace function public.gestao_entrada_nota(p_empresa_id uuid, p_documento_fiscal_id uuid, p_itens jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos_fiscais;
  v_item public.documento_fiscal_itens;
  it jsonb;
  v_q numeric;
  v_custo numeric;
  v_fator numeric;
  v_produto uuid;
  v_n int := 0;
  v_atualizar_custo boolean;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  select * into v_doc from public.documentos_fiscais where id = p_documento_fiscal_id and empresa_id = p_empresa_id;
  if v_doc.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  if v_doc.operacao <> 'entrada' then
    raise exception 'Só notas de compra (entrada) dão entrada no estoque.';
  end if;
  if exists (select 1 from public.estoque_movimentos where documento_fiscal_id = v_doc.id) then
    raise exception 'Esta nota já deu entrada no estoque.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha o produto de pelo menos um item da nota.';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_item := null;
    if nullif(it ->> 'numero_item', '') is not null then
      select * into v_item from public.documento_fiscal_itens
       where documento_fiscal_id = v_doc.id and numero_item = (it ->> 'numero_item')::int;
    end if;
    v_q := nullif(it ->> 'quantidade', '')::numeric;
    v_custo := nullif(it ->> 'custo_unitario', '')::numeric;
    if (it ? 'novo' and jsonb_typeof(it -> 'novo') = 'object') or nullif(it ->> 'produto_id', '') is not null then
      if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) then
        raise exception 'Quantidade inválida em um dos itens (até 4 casas decimais).';
      end if;
      if v_custo is null or v_custo < 0 then
        raise exception 'Informe o custo unitário de cada item.';
      end if;
    end if;
    -- Produto novo criado com os dados do item (descrição, NCM, unidade) e o preço de venda informado
    if it ? 'novo' and jsonb_typeof(it -> 'novo') = 'object' then
      v_produto := public.gestao_produto_salvar(p_empresa_id, null, (it -> 'novo') || jsonb_build_object('preco_custo', round(v_custo, 4)));
    else
      v_produto := nullif(it ->> 'produto_id', '')::uuid;
    end if;
    if v_produto is null then
      continue;
    end if;
    perform app.estoque_movimentar(p_empresa_id, v_produto, 'entrada_compra', v_q, v_custo, null, v_doc.id,
      'Nota ' || coalesce(v_doc.numero, '') || ' — ' || coalesce(v_doc.emitente_nome, 'fornecedor'), true);
    v_atualizar_custo := coalesce((it ->> 'atualizar_preco_custo')::boolean, true);
    if v_atualizar_custo then
      update public.nfe_produtos set preco_custo = round(v_custo, 4) where id = v_produto and empresa_id = p_empresa_id;
    end if;
    -- Lembra o vínculo para a próxima nota deste fornecedor
    if coalesce((it ->> 'lembrar')::boolean, true) and v_item.id is not null and nullif(trim(v_item.codigo), '') is not null then
      v_fator := coalesce(nullif(it ->> 'fator', '')::numeric, 1);
      if v_fator <= 0 then
        raise exception 'O fator de conversão precisa ser maior que zero.';
      end if;
      perform app.estoque_vincular(p_empresa_id, v_doc.emitente_documento, v_item.codigo, v_produto, v_fator, v_item.descricao, v_item.unidade);
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Escolha o produto de pelo menos um item da nota.';
  end if;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Importação de produtos e estoque por planilha (tudo ou nada)
-- -----------------------------------------------------------------------------
create or replace function public.gestao_importar_produtos(p_empresa_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  v_linha text;
  v_codigo text;
  v_p public.nfe_produtos;
  v_dados jsonb;
  v_id uuid;
  v_q numeric;
  v_novos int := 0;
  v_atualizados int := 0;
  v_estoque int := 0;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'A planilha não tem produtos.';
  end if;
  if jsonb_array_length(p_linhas) > 5000 then
    raise exception 'Envie até 5.000 produtos por planilha.';
  end if;
  for it in select * from jsonb_array_elements(p_linhas) loop
    v_linha := coalesce(it ->> 'linha', '?');
    v_codigo := nullif(trim(it ->> 'codigo'), '');
    v_p := null;
    if v_codigo is not null then
      select * into v_p from public.nfe_produtos where empresa_id = p_empresa_id and codigo = v_codigo;
    end if;
    begin
      if v_p.id is not null then
        -- Atualiza só o que veio na planilha; o resto do cadastro fica como está
        v_dados := jsonb_build_object(
          'codigo', v_p.codigo, 'descricao', v_p.descricao, 'ncm', v_p.ncm, 'cest', v_p.cest, 'gtin', v_p.gtin, 'unidade', v_p.unidade,
          'peso_kg', v_p.peso_kg, 'valor_unitario', v_p.valor_unitario, 'origem', v_p.origem, 'ativo', v_p.ativo, 'grupo', v_p.grupo,
          'preco_custo', v_p.preco_custo, 'controla_estoque', v_p.controla_estoque, 'estoque_minimo', v_p.estoque_minimo,
          'espessura_cm', v_p.espessura_cm, 'largura_cm', v_p.largura_cm, 'comprimento_m', v_p.comprimento_m
        ) || jsonb_strip_nulls(jsonb_build_object(
          'descricao', nullif(trim(it ->> 'descricao'), ''), 'ncm', nullif(it ->> 'ncm', ''), 'unidade', nullif(trim(it ->> 'unidade'), ''),
          'valor_unitario', nullif(it ->> 'preco_venda', ''), 'preco_custo', nullif(it ->> 'preco_custo', ''),
          'estoque_minimo', nullif(it ->> 'estoque_minimo', ''), 'grupo', nullif(trim(it ->> 'grupo'), ''),
          'gtin', nullif(it ->> 'gtin', ''), 'cest', nullif(it ->> 'cest', '')
        ));
        v_id := public.gestao_produto_salvar(p_empresa_id, v_p.id, v_dados);
        v_atualizados := v_atualizados + 1;
      else
        if nullif(trim(it ->> 'descricao'), '') is null or nullif(it ->> 'ncm', '') is null or nullif(trim(it ->> 'unidade'), '') is null
           or nullif(it ->> 'preco_venda', '') is null then
          raise exception 'produto novo precisa de descrição, NCM, unidade e preço de venda';
        end if;
        v_id := public.gestao_produto_salvar(p_empresa_id, null, jsonb_strip_nulls(jsonb_build_object(
          'codigo', v_codigo, 'descricao', trim(it ->> 'descricao'), 'ncm', it ->> 'ncm', 'unidade', trim(it ->> 'unidade'),
          'valor_unitario', it ->> 'preco_venda', 'preco_custo', nullif(it ->> 'preco_custo', ''),
          'estoque_minimo', nullif(it ->> 'estoque_minimo', ''), 'grupo', nullif(trim(it ->> 'grupo'), ''),
          'gtin', nullif(it ->> 'gtin', ''), 'cest', nullif(it ->> 'cest', '')
        )));
        v_novos := v_novos + 1;
      end if;
      -- Quantidade em estoque: o saldo passa a ser o da planilha (com o histórico do ajuste)
      v_q := nullif(it ->> 'estoque', '')::numeric;
      if v_q is not null then
        if v_q < 0 or v_q <> round(v_q, 4) then
          raise exception 'estoque inválido (use até 4 casas decimais, sem número negativo)';
        end if;
        select * into v_p from public.nfe_produtos where id = v_id;
        if v_p.controla_estoque and v_q <> v_p.estoque_atual then
          perform app.estoque_movimentar(p_empresa_id, v_id, 'inventario', v_q - v_p.estoque_atual,
            case when v_q > v_p.estoque_atual then coalesce(nullif(it ->> 'preco_custo', '')::numeric, v_p.preco_custo) end,
            null, null, 'Importação da planilha de produtos', true);
          v_estoque := v_estoque + 1;
        end if;
      end if;
    exception
      when others then
        raise exception 'Linha %: %', v_linha, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados, 'estoque', v_estoque);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Entrada automática: chamada quando a nota de compra chega ao portal
-- -----------------------------------------------------------------------------
create or replace function public.estoque_entrada_automatica(p_documento_fiscal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos_fiscais;
  v_cfg public.gestao_config;
  v_forn text;
  v_item record;
  v_itens jsonb := '[]'::jsonb;
  v_faltam int := 0;
  v_q numeric;
  v_custo numeric;
  r jsonb;
  v_u uuid;
  v_n int := 0;
begin
  select * into v_doc from public.documentos_fiscais where id = p_documento_fiscal_id;
  if v_doc.id is null or v_doc.operacao <> 'entrada' or v_doc.modelo not in ('55', '65') or v_doc.cancelada_evento then
    return jsonb_build_object('situacao', 'ignorada');
  end if;
  select * into v_cfg from public.gestao_config where empresa_id = v_doc.empresa_id;
  if v_cfg.empresa_id is null or not v_cfg.ativa or not v_cfg.entrada_automatica or v_cfg.modalidade <> 'loja' then
    return jsonb_build_object('situacao', 'desligada');
  end if;
  if exists (select 1 from public.estoque_movimentos where documento_fiscal_id = v_doc.id) then
    return jsonb_build_object('situacao', 'ja_lancada');
  end if;
  v_forn := upper(regexp_replace(coalesce(v_doc.emitente_documento, ''), '[^0-9A-Za-z]', '', 'g'));

  -- Cada item precisa do vínculo com o fornecedor (ou do mesmo código de barras de um produto)
  for v_item in
    select i.numero_item, i.quantidade, i.valor_total, coalesce(i.valor_desconto, 0) as desconto,
           coalesce(
             (select jsonb_build_object('produto_id', vi.produto_id, 'fator', vi.fator)
                from public.estoque_vinculos vi join public.nfe_produtos p on p.id = vi.produto_id and p.ativo
               where vi.empresa_id = v_doc.empresa_id and vi.fornecedor_documento = v_forn and vi.codigo_fornecedor = trim(i.codigo)),
             (select jsonb_build_object('produto_id', min(p.id::text)::uuid, 'fator', 1)
                from public.nfe_produtos p
               where p.empresa_id = v_doc.empresa_id and p.ativo and i.gtin ~ '^[0-9]{8,14}$' and p.gtin = i.gtin
              having count(*) = 1)
           ) as alvo
      from public.documento_fiscal_itens i
     where i.documento_fiscal_id = v_doc.id
     order by i.numero_item
  loop
    if v_item.alvo is null or coalesce(v_item.quantidade, 0) <= 0 then
      v_faltam := v_faltam + 1;
    else
      v_itens := v_itens || jsonb_build_array(jsonb_build_object(
        'produto_id', v_item.alvo ->> 'produto_id', 'fator', (v_item.alvo ->> 'fator')::numeric,
        'quantidade', v_item.quantidade, 'valor', greatest(coalesce(v_item.valor_total, 0) - v_item.desconto, 0)));
    end if;
  end loop;

  if v_faltam = 0 and jsonb_array_length(v_itens) = 0 then
    return jsonb_build_object('situacao', 'ignorada');
  end if;
  if v_faltam > 0 then
    for v_u in
      select m.user_id from public.empresa_membros m
       where m.empresa_id = v_doc.empresa_id and m.ativo and 'gestao.gerenciar' = any(m.permissoes) and m.papel like 'cliente%'
    loop
      perform app.notificar(v_u, v_doc.empresa_id, 'estoque_entrada',
        'Nota de compra esperando conferência',
        'A nota ' || coalesce(v_doc.numero, '') || ' de ' || coalesce(v_doc.emitente_nome, 'fornecedor') || ' tem ' || v_faltam
          || ' item(ns) sem produto ligado. Confira para dar entrada no estoque.',
        '/e/' || v_doc.empresa_id || '/loja/produtos/entrada-nota?nota=' || v_doc.id, false);
    end loop;
    return jsonb_build_object('situacao', 'pendente', 'faltam', v_faltam);
  end if;

  for r in select * from jsonb_array_elements(v_itens) loop
    v_q := round((r ->> 'quantidade')::numeric * (r ->> 'fator')::numeric, 4);
    if v_q <= 0 then
      continue;
    end if;
    v_custo := round((r ->> 'valor')::numeric / v_q, 6);
    perform app.estoque_movimentar(v_doc.empresa_id, (r ->> 'produto_id')::uuid, 'entrada_compra', v_q, v_custo, null, v_doc.id,
      'Entrada automática — nota ' || coalesce(v_doc.numero, '') || ' de ' || coalesce(v_doc.emitente_nome, 'fornecedor'), true);
    update public.nfe_produtos set preco_custo = round(v_custo, 4) where id = (r ->> 'produto_id')::uuid;
    v_n := v_n + 1;
  end loop;

  for v_u in
    select m.user_id from public.empresa_membros m
     where m.empresa_id = v_doc.empresa_id and m.ativo and 'gestao.gerenciar' = any(m.permissoes) and m.papel like 'cliente%'
  loop
    perform app.notificar(v_u, v_doc.empresa_id, 'estoque_entrada',
      'Nota de compra lançada no estoque',
      'A nota ' || coalesce(v_doc.numero, '') || ' de ' || coalesce(v_doc.emitente_nome, 'fornecedor') || ' deu entrada sozinha: '
        || v_n || ' produto(s), com quantidade e custo.',
      '/e/' || v_doc.empresa_id || '/loja/produtos', false);
  end loop;
  return jsonb_build_object('situacao', 'lancada', 'itens', v_n);
end;
$$;

revoke all on function public.gestao_entrada_automatica_definir(uuid, boolean), public.gestao_importar_produtos(uuid, jsonb),
  public.estoque_entrada_automatica(uuid), app.estoque_vincular(uuid, text, text, uuid, numeric, text, text) from public, anon;
grant execute on function public.gestao_entrada_automatica_definir(uuid, boolean), public.gestao_importar_produtos(uuid, jsonb) to authenticated;
-- A entrada automática só é chamada pelo processamento das notas (servidor)
revoke all on function public.estoque_entrada_automatica(uuid) from authenticated;
grant execute on function public.estoque_entrada_automatica(uuid) to service_role;
