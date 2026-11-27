-- =============================================================================
-- Loja: conversão de unidade entre compra e venda, no cadastro do produto.
--
--  * "Compro em uma unidade e vendo em outra": unidade de compra (ex.: PC) e
--    quanto cada uma rende na unidade de venda (ex.: 1 PC = 3 M). Estoque,
--    preço, venda e NF-e continuam na unidade de venda.
--  * Nota de compra na unidade de compra: a quantidade vira unidade de venda
--    (10 PC = 30 M) e o custo é dividido (custo por metro). O vínculo já
--    gravado com o fornecedor continua valendo primeiro.
--  * Unidades escritas de jeitos diferentes nas notas contam como a mesma
--    (PC, PÇ, PEÇA, UN, UND → unidade; MT, MTS, METRO → metro...).
--  * Nota numa unidade que não é nem a de compra nem a de venda: a entrada
--    automática não chuta; fica para alguém conferir.
--  * Só quem gerencia a loja muda a conversão (a função de salvar confere).
-- =============================================================================

alter table public.nfe_produtos
  add column unidade_compra text check (unidade_compra is null or unidade_compra ~ '^[A-Z0-9]{1,6}$'),
  add column fator_compra numeric(18, 6) check (fator_compra is null or (fator_compra > 0 and fator_compra < 1000000)),
  add constraint nfe_produtos_conversao_completa check ((unidade_compra is null) = (fator_compra is null));

comment on column public.nfe_produtos.unidade_compra is 'Unidade em que a loja compra (ex.: PC), quando diferente da unidade de venda.';
comment on column public.nfe_produtos.fator_compra is 'Quanto 1 unidade de compra rende na unidade de venda (ex.: 1 PC = 3 M → 3).';
-- A tabela tem as colunas de custo fechadas (só as liberadas são lidas): libera as novas
grant select (unidade_compra, fator_compra) on public.nfe_produtos to authenticated;

-- Mesma unidade escrita de jeitos diferentes (nas notas dos fornecedores)
create or replace function app.unidade_classe(p_unidade text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when u = '' then null
    when u in ('UN', 'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'UNI', 'U', 'PC', 'PCS', 'PCA', 'PECA', 'PECAS') then 'UN'
    when u in ('M', 'MT', 'MTS', 'ML', 'MTL', 'METRO', 'METROS') then 'M'
    when u in ('M2', 'MQ', 'MTQ', 'MT2') then 'M2'
    when u in ('M3', 'MT3', 'MCU') then 'M3'
    when u in ('CX', 'CXA', 'CXS', 'CAIXA', 'CAIXAS') then 'CX'
    when u in ('PCT', 'PCTE', 'PCTS', 'PACOTE', 'PACOTES') then 'PCT'
    when u in ('KG', 'KGS', 'QUILO', 'QUILOS', 'KILO', 'KILOS') then 'KG'
    when u in ('L', 'LT', 'LTS', 'LITRO', 'LITROS') then 'L'
    when u in ('DZ', 'DUZ', 'DUZIA', 'DUZIAS') then 'DZ'
    else u
  end
  from (select regexp_replace(translate(upper(trim(coalesce(p_unidade, ''))), 'ÇÁÀÃÂÉÊÍÓÔÕÚ²³', 'CAAAAEEIOOOU23'), '[^A-Z0-9]', '', 'g') as u) n;
$$;

-- Quantas unidades de venda vêm em 1 unidade da nota; null = não dá para saber (conferir)
create or replace function app.fator_da_nota(p_produto_id uuid, p_unidade_nota text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p.unidade_compra is null or p.unidade_compra = p.unidade then 1
    when app.unidade_classe(p_unidade_nota) = app.unidade_classe(p.unidade_compra) then p.fator_compra
    when app.unidade_classe(p_unidade_nota) = app.unidade_classe(p.unidade) then 1
  end
  from public.nfe_produtos p
  where p.id = p_produto_id;
$$;

revoke all on function app.unidade_classe(text), app.fator_da_nota(uuid, text) from public, anon, authenticated;

create or replace function public.gestao_produto_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_codigo text := nullif(trim(p_dados ->> 'codigo'), '');
  -- Conversão de compra: só muda quando vier no pedido (a planilha e outras telas mantêm a atual)
  v_conv boolean := p_dados ? 'unidade_compra' or p_dados ? 'fator_compra';
  v_uc text := nullif(upper(trim(coalesce(p_dados ->> 'unidade_compra', ''))), '');
  v_fc numeric;
  v_un text := upper(trim(coalesce(p_dados ->> 'unidade', '')));
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if v_conv then
    begin
      v_fc := nullif(replace(trim(coalesce(p_dados ->> 'fator_compra', '')), ',', '.'), '')::numeric;
    exception when invalid_text_representation then
      raise exception 'O rendimento precisa ser um número (ex.: 3 ou 2,5).';
    end;
    if v_uc is null and v_fc is not null then
      raise exception 'Escolha a unidade de compra.';
    elsif v_uc is not null then
      if length(v_uc) > 6 then
        raise exception 'A unidade de compra tem até 6 letras.';
      elsif v_uc = v_un then
        raise exception 'A unidade de compra precisa ser diferente da unidade de venda.';
      elsif v_fc is null or v_fc <= 0 then
        raise exception 'Informe quanto cada % rende em %, maior que zero.', v_uc, v_un;
      elsif v_fc <> round(v_fc, 6) or v_fc >= 1000000 then
        raise exception 'O rendimento aceita até 6 casas decimais (e menos de 1 milhão).';
      end if;
    else
      v_fc := null;
    end if;
  end if;
  if v_codigo is null then
    select coalesce(max(codigo::bigint), 0) + 1 into v_codigo
      from public.nfe_produtos where empresa_id = p_empresa_id and codigo ~ '^[0-9]{1,15}$';
  end if;
  if nullif(p_dados ->> 'valor_unitario', '') is null then
    raise exception 'Informe o preço de venda.';
  end if;
  begin
    if p_id is null then
      insert into public.nfe_produtos (
        empresa_id, codigo, descricao, ncm, cest, gtin, unidade, peso_kg, valor_unitario, origem, ativo,
        grupo, preco_custo, controla_estoque, estoque_minimo, espessura_cm, largura_cm, comprimento_m,
        unidade_compra, fator_compra
      ) values (
        p_empresa_id, v_codigo, trim(p_dados ->> 'descricao'), regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
        nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
        upper(trim(p_dados ->> 'unidade')), nullif(p_dados ->> 'peso_kg', '')::numeric, (p_dados ->> 'valor_unitario')::numeric,
        coalesce((p_dados ->> 'origem')::smallint, 0), coalesce((p_dados ->> 'ativo')::boolean, true),
        nullif(trim(p_dados ->> 'grupo'), ''),
        case when app.pode(p_empresa_id, 'gestao.custos') then nullif(p_dados ->> 'preco_custo', '')::numeric end,
        coalesce((p_dados ->> 'controla_estoque')::boolean, true), nullif(p_dados ->> 'estoque_minimo', '')::numeric,
        nullif(p_dados ->> 'espessura_cm', '')::numeric, nullif(p_dados ->> 'largura_cm', '')::numeric, nullif(p_dados ->> 'comprimento_m', '')::numeric,
        case when v_conv then v_uc end, case when v_conv then v_fc end
      ) returning id into v_id;
    else
      update public.nfe_produtos
         set codigo = v_codigo,
             descricao = trim(p_dados ->> 'descricao'),
             ncm = regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
             cest = nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''),
             gtin = nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
             unidade = upper(trim(p_dados ->> 'unidade')),
             peso_kg = nullif(p_dados ->> 'peso_kg', '')::numeric,
             valor_unitario = (p_dados ->> 'valor_unitario')::numeric,
             origem = coalesce((p_dados ->> 'origem')::smallint, 0),
             ativo = coalesce((p_dados ->> 'ativo')::boolean, true),
             grupo = nullif(trim(p_dados ->> 'grupo'), ''),
             preco_custo = case when app.pode(p_empresa_id, 'gestao.custos') then nullif(p_dados ->> 'preco_custo', '')::numeric else preco_custo end,
             controla_estoque = coalesce((p_dados ->> 'controla_estoque')::boolean, true),
             estoque_minimo = nullif(p_dados ->> 'estoque_minimo', '')::numeric,
             espessura_cm = nullif(p_dados ->> 'espessura_cm', '')::numeric,
             largura_cm = nullif(p_dados ->> 'largura_cm', '')::numeric,
             comprimento_m = nullif(p_dados ->> 'comprimento_m', '')::numeric,
             -- Sem conversão no pedido: mantém a atual (some se a venda passou a ser na unidade de compra)
             unidade_compra = case when v_conv then v_uc when unidade_compra = v_un then null else unidade_compra end,
             fator_compra = case when v_conv then v_fc when unidade_compra = v_un then null else fator_compra end
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Produto não encontrado.';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'Já existe um produto com o código %.', v_codigo;
    when check_violation or not_null_violation then
      raise exception 'Confira os dados do produto: descrição (2 a 120 letras), NCM com 8 números, unidade (até 6 letras) e preços sem valores negativos.';
  end;
  return v_id;
end;
$$;

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
  if app.nota_ja_no_estoque(v_doc.empresa_id, v_doc.id, v_doc.chave_acesso) then
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
             -- Mesmo código de barras de um produto só: a conversão de compra do cadastro vale
             -- (unidade da nota que não é nem a de compra nem a de venda: fica para conferir)
             (select jsonb_build_object('produto_id', p.id, 'fator', app.fator_da_nota(p.id, i.unidade))
                from public.nfe_produtos p
               where p.empresa_id = v_doc.empresa_id and p.ativo and i.gtin ~ '^[0-9]{8,14}$' and p.gtin = i.gtin
                 and not exists (select 1 from public.nfe_produtos p2
                                  where p2.empresa_id = p.empresa_id and p2.ativo and p2.gtin = p.gtin and p2.id <> p.id))
           ) as alvo
      from public.documento_fiscal_itens i
     where i.documento_fiscal_id = v_doc.id
     order by i.numero_item
  loop
    if v_item.alvo is null or v_item.alvo ->> 'fator' is null or coalesce(v_item.quantidade, 0) <= 0 then
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

create or replace function public.gestao_importar_nota(p_empresa_id uuid, p_documento_fiscal_id uuid, p_pdf jsonb, p_margem numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos_fiscais;
  v_pdf boolean := p_documento_fiscal_id is null;
  v_pdf_id uuid;
  v_chave text;
  v_numero text;
  v_forn text;
  v_forn_nome text;
  v_empresa_doc text;
  v_itens jsonb := '[]'::jsonb;
  v_plano jsonb := '[]'::jsonb;
  v_motivos text[] := '{}';
  v_novos jsonb := '{}'::jsonb;
  v_res jsonb := '[]'::jsonb;
  it jsonb;
  pl jsonb;
  v_k int := 0;
  v_rot text;
  v_codigo text;
  v_desc text;
  v_comp text;
  v_gtin text;
  v_ncm text;
  v_un text;
  v_q numeric;
  v_valor numeric;
  v_qloja numeric;
  v_custo numeric;
  v_alvo uuid;
  v_fator numeric;
  v_modo text;
  v_ref int;
  v_produto uuid;
  v_p public.nfe_produtos;
  v_obs text;
  v_n int := 0;
  v_n_novos int := 0;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.custos');
  if (p_documento_fiscal_id is null) = (p_pdf is null) then
    raise exception 'Informe a nota.';
  end if;
  if p_margem is not null and (p_margem < 0 or p_margem > 1000) then
    raise exception 'A margem de lucro vai de 0%% a 1.000%%.';
  end if;
  select upper(regexp_replace(coalesce(documento, ''), '[^0-9A-Za-z]', '', 'g')) into v_empresa_doc from public.empresas where id = p_empresa_id;

  if v_pdf then
    v_chave := p_pdf ->> 'chave';
    if coalesce(v_chave, '') !~ '^[0-9]{44}$' then
      raise exception 'Chave de acesso inválida.';
    end if;
    -- A nota já está no portal pelo XML (dados completos)? Usa o XML.
    select * into v_doc from public.documentos_fiscais d
     where d.empresa_id = p_empresa_id and d.chave_acesso = v_chave and d.modelo = '55'
       and exists (select 1 from public.documento_fiscal_itens i where i.documento_fiscal_id = d.id)
     order by d.created_at limit 1;
    v_pdf := v_doc.id is null;
  else
    select * into v_doc from public.documentos_fiscais where id = p_documento_fiscal_id and empresa_id = p_empresa_id;
    if v_doc.id is null then
      raise exception 'Nota não encontrada.';
    end if;
  end if;

  if not v_pdf then
    if v_doc.operacao <> 'entrada' or v_doc.modelo not in ('55', '65') then
      raise exception 'Só notas de compra (entrada) dão entrada no estoque.';
    end if;
    if v_doc.cancelada_evento then
      raise exception 'Esta nota foi cancelada pelo fornecedor e não pode entrar no estoque.';
    end if;
    v_chave := v_doc.chave_acesso;
    v_numero := v_doc.numero;
    v_forn := upper(regexp_replace(coalesce(v_doc.emitente_documento, ''), '[^0-9A-Za-z]', '', 'g'));
    v_forn_nome := coalesce(nullif(trim(v_doc.emitente_nome), ''), 'fornecedor');
    select coalesce(jsonb_agg(jsonb_build_object(
             'numero_item', i.numero_item, 'codigo', i.codigo, 'descricao', i.descricao, 'ncm', i.ncm, 'cest', i.cest,
             'gtin', i.gtin, 'unidade', i.unidade, 'quantidade', i.quantidade, 'valor_total', i.valor_total,
             'valor_desconto', i.valor_desconto) order by i.numero_item), '[]'::jsonb)
      into v_itens
      from public.documento_fiscal_itens i where i.documento_fiscal_id = v_doc.id;
  else
    v_numero := left(nullif(trim(p_pdf ->> 'numero'), ''), 20);
    v_forn := upper(regexp_replace(coalesce(p_pdf ->> 'emitente_documento', ''), '[^0-9A-Za-z]', '', 'g'));
    if v_forn !~ '^[0-9A-Z]{11,14}$' then
      raise exception 'CNPJ/CPF do fornecedor inválido.';
    end if;
    if v_forn = v_empresa_doc then
      raise exception 'Esta nota foi emitida pela própria empresa. Para dar entrada, envie o XML da nota.';
    end if;
    v_forn_nome := coalesce(left(nullif(trim(p_pdf ->> 'emitente_nome'), ''), 200), 'Fornecedor ' || v_forn);
    v_itens := p_pdf -> 'itens';
    if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 or jsonb_array_length(v_itens) > 990 then
      raise exception 'A nota precisa ter de 1 a 990 itens.';
    end if;
  end if;

  if app.nota_ja_no_estoque(p_empresa_id, v_doc.id, v_chave) then
    return jsonb_build_object('situacao', 'ja_lancada', 'documento_fiscal_id', v_doc.id, 'numero', v_numero, 'fornecedor', v_forn_nome);
  end if;
  if jsonb_array_length(v_itens) = 0 then
    raise exception 'A nota não tem itens.';
  end if;

  -- ---------------------------------------------------------------- plano
  for it in select * from jsonb_array_elements(v_itens) loop
    v_k := v_k + 1;
    v_rot := 'Item ' || coalesce(it ->> 'numero_item', v_k::text);
    v_codigo := left(nullif(trim(it ->> 'codigo'), ''), 60);
    v_desc := left(trim(regexp_replace(coalesce(it ->> 'descricao', ''), '\s+', ' ', 'g')), 120);
    v_comp := app.descricao_comparavel(v_desc);
    v_gtin := nullif(regexp_replace(coalesce(it ->> 'gtin', ''), '\D', '', 'g'), '');
    v_ncm := regexp_replace(coalesce(it ->> 'ncm', ''), '\D', '', 'g');
    v_un := upper(trim(coalesce(it ->> 'unidade', '')));
    if coalesce(it ->> 'quantidade', '') !~ '^[0-9]+(\.[0-9]+)?$' or coalesce(it ->> 'valor_total', '') !~ '^[0-9]+(\.[0-9]+)?$'
       or coalesce(nullif(it ->> 'valor_desconto', ''), '0') !~ '^[0-9]+(\.[0-9]+)?$' then
      v_motivos := v_motivos || (v_rot || ': quantidade ou valor ilegível.');
      continue;
    end if;
    v_q := (it ->> 'quantidade')::numeric;
    v_valor := greatest((it ->> 'valor_total')::numeric - coalesce(nullif(it ->> 'valor_desconto', '')::numeric, 0), 0);
    v_alvo := null;
    v_fator := 1;
    v_modo := null;
    v_ref := null;

    -- 1. Item já ligado a um produto (código do fornecedor)
    if v_codigo is not null then
      select vi.produto_id, vi.fator into v_alvo, v_fator
        from public.estoque_vinculos vi join public.nfe_produtos p on p.id = vi.produto_id and p.ativo
       where vi.empresa_id = p_empresa_id and vi.fornecedor_documento = v_forn and vi.codigo_fornecedor = v_codigo;
      if v_alvo is not null then
        v_modo := 'vinculo';
      else
        v_fator := 1;
      end if;
    end if;
    -- 2. Mesmo código de barras de um produto só
    if v_alvo is null and v_gtin ~ '^[0-9]{8,14}$' then
      select min(p.id::text)::uuid into v_alvo from public.nfe_produtos p
       where p.empresa_id = p_empresa_id and p.ativo and p.gtin = v_gtin having count(*) = 1;
      if v_alvo is not null then v_modo := 'gtin'; end if;
    end if;
    -- 3. Mesma descrição de um produto só
    if v_alvo is null and length(v_comp) >= 2 then
      select min(p.id::text)::uuid into v_alvo from public.nfe_produtos p
       where p.empresa_id = p_empresa_id and p.ativo and app.descricao_comparavel(p.descricao) = v_comp having count(*) = 1;
      if v_alvo is not null then v_modo := 'descricao'; end if;
    end if;
    -- 4. Mesmo item repetido nesta nota: usa o produto novo criado para o primeiro
    if v_alvo is null then
      select (e ->> 'ref')::int into v_ref from jsonb_array_elements(v_plano) e
       where e ->> 'modo' = 'novo'
         and ((v_codigo is not null and e ->> 'codigo' = v_codigo) or (v_codigo is null and e ->> 'comp' = v_comp))
       limit 1;
    end if;
    -- 5. Produto novo com os dados do item
    if v_alvo is null and v_ref is null then
      if v_ncm !~ '^[0-9]{8}$' then
        v_motivos := v_motivos || (v_rot || ' (' || coalesce(nullif(v_desc, ''), 'sem descrição') || '): sem NCM para cadastrar o produto novo.');
      end if;
      if length(v_desc) < 2 then
        v_motivos := v_motivos || (v_rot || ': sem descrição para cadastrar o produto novo.');
      end if;
      if v_un = '' or length(v_un) > 6 then
        v_motivos := v_motivos || (v_rot || ' (' || coalesce(nullif(v_desc, ''), 'sem descrição') || '): sem unidade para cadastrar o produto novo.');
      end if;
      if p_margem is null then
        v_motivos := v_motivos || ('Informe a margem de lucro para cadastrar os produtos novos.'::text);
      end if;
      v_ref := v_k;
    end if;
    if v_alvo is null then
      v_modo := 'novo';
    end if;
    -- Produto achado pelo código de barras ou pela descrição: vale a conversão de compra do cadastro
    if v_modo in ('gtin', 'descricao') then
      v_fator := app.fator_da_nota(v_alvo, v_un);
      if v_fator is null then
        select * into v_p from public.nfe_produtos where id = v_alvo;
        v_motivos := v_motivos || (v_rot || ' (' || coalesce(nullif(v_desc, ''), 'sem descrição') || '): a nota vem em ' || coalesce(nullif(v_un, ''), 'unidade não informada')
          || ', e o produto é comprado em ' || v_p.unidade_compra || ' e vendido em ' || v_p.unidade || '. Confira na entrada por nota.');
        continue;
      end if;
    end if;
    v_qloja := round(v_q * v_fator, 4);
    if v_qloja <= 0 then
      v_motivos := v_motivos || (v_rot || ': quantidade zerada.');
      continue;
    end if;
    v_custo := round(v_valor / v_qloja, 6);
    v_plano := v_plano || jsonb_build_array(jsonb_build_object(
      'k', v_k, 'modo', v_modo, 'produto_id', v_alvo, 'ref', v_ref, 'fator', v_fator, 'codigo', v_codigo, 'comp', v_comp,
      'descricao', v_desc, 'ncm', v_ncm, 'unidade', v_un, 'gtin', v_gtin, 'cest', nullif(regexp_replace(coalesce(it ->> 'cest', ''), '\D', '', 'g'), ''),
      'quantidade', v_qloja, 'custo', v_custo));
  end loop;

  if cardinality(v_motivos) > 0 then
    return jsonb_build_object('situacao', 'conferir', 'documento_fiscal_id', v_doc.id, 'numero', v_numero, 'fornecedor', v_forn_nome,
      'motivos', to_jsonb((select array_agg(distinct m) from unnest(v_motivos) m)));
  end if;

  -- ---------------------------------------------------------------- lançamento
  if p_margem is not null then
    update public.gestao_config set margem_entrada = p_margem where empresa_id = p_empresa_id;
  end if;
  if v_pdf then
    begin
      insert into public.estoque_notas_pdf (empresa_id, chave, numero, serie, emitente_documento, emitente_nome, data_emissao, valor_total, itens)
      values (p_empresa_id, v_chave, v_numero, left(nullif(trim(p_pdf ->> 'serie'), ''), 5), v_forn, v_forn_nome,
              case when coalesce(p_pdf ->> 'data_emissao', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_pdf ->> 'data_emissao')::date end,
              case when coalesce(p_pdf ->> 'valor_total', '') ~ '^[0-9]+(\.[0-9]+)?$' then round((p_pdf ->> 'valor_total')::numeric, 2) end,
              v_itens)
      returning id into v_pdf_id;
    exception
      when unique_violation then
        return jsonb_build_object('situacao', 'ja_lancada', 'numero', v_numero, 'fornecedor', v_forn_nome);
    end;
  end if;
  v_obs := 'Nota ' || coalesce(v_numero, '') || ' — ' || v_forn_nome || case when v_pdf then ' (lida do PDF)' else '' end;

  for pl in select * from jsonb_array_elements(v_plano) loop
    if pl ->> 'modo' = 'novo' then
      v_produto := (v_novos ->> (pl ->> 'ref'))::uuid;
      if v_produto is null then
        v_produto := public.gestao_produto_salvar(p_empresa_id, null, jsonb_strip_nulls(jsonb_build_object(
          'descricao', pl ->> 'descricao', 'ncm', pl ->> 'ncm', 'unidade', pl ->> 'unidade',
          'gtin', case when pl ->> 'gtin' ~ '^([0-9]{8}|[0-9]{12,14})$' then pl ->> 'gtin' end,
          'cest', case when pl ->> 'cest' ~ '^[0-9]{7}$' then pl ->> 'cest' end,
          'valor_unitario', round((pl ->> 'custo')::numeric * (1 + p_margem / 100), 2),
          'preco_custo', round((pl ->> 'custo')::numeric, 4), 'controla_estoque', true)));
        v_novos := v_novos || jsonb_build_object(pl ->> 'ref', v_produto);
        v_n_novos := v_n_novos + 1;
      end if;
    else
      v_produto := (pl ->> 'produto_id')::uuid;
    end if;
    perform app.estoque_movimentar(p_empresa_id, v_produto, 'entrada_compra', (pl ->> 'quantidade')::numeric, (pl ->> 'custo')::numeric,
      null, case when v_pdf then null else v_doc.id end, v_obs, true);
    update public.nfe_produtos set preco_custo = round((pl ->> 'custo')::numeric, 4) where id = v_produto and empresa_id = p_empresa_id;
    -- Lembra o vínculo: a próxima nota deste fornecedor entra sozinha
    if pl ->> 'codigo' is not null then
      perform app.estoque_vincular(p_empresa_id, v_forn, pl ->> 'codigo', v_produto, (pl ->> 'fator')::numeric, pl ->> 'descricao', pl ->> 'unidade');
    end if;
    select * into v_p from public.nfe_produtos where id = v_produto;
    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'produto_id', v_produto, 'produto', v_p.descricao, 'item', pl ->> 'descricao', 'modo', pl ->> 'modo',
      'quantidade', (pl ->> 'quantidade')::numeric, 'unidade', v_p.unidade, 'custo', (pl ->> 'custo')::numeric,
      'preco_venda', v_p.valor_unitario, 'controla_estoque', v_p.controla_estoque));
    v_n := v_n + 1;
  end loop;

  perform app.registrar_auditoria('estoque_importar_nota', 'estoque', coalesce(v_doc.id, v_pdf_id)::text, p_empresa_id,
    jsonb_build_object('chave', v_chave, 'origem', case when v_pdf then 'pdf' else 'xml' end, 'itens', v_n, 'produtos_novos', v_n_novos));
  return jsonb_build_object('situacao', 'lancada', 'origem', case when v_pdf then 'pdf' else 'xml' end,
    'documento_fiscal_id', case when v_pdf then null else v_doc.id end, 'nota_pdf_id', v_pdf_id,
    'numero', v_numero, 'fornecedor', v_forn_nome, 'itens', v_n, 'produtos_novos', v_n_novos, 'produtos', v_res);
end;
$$;

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
  if not app.pode(p_empresa_id, 'gestao.custos') and jsonb_typeof(p_linhas) = 'array' then
    p_linhas := coalesce((select jsonb_agg(e - 'preco_custo') from jsonb_array_elements(p_linhas) e), '[]'::jsonb);
  end if;
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
          'gtin', nullif(it ->> 'gtin', ''), 'cest', nullif(it ->> 'cest', ''),
          'unidade_compra', nullif(trim(it ->> 'unidade_compra'), ''), 'fator_compra', nullif(it ->> 'fator_compra', '')
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
          'gtin', nullif(it ->> 'gtin', ''), 'cest', nullif(it ->> 'cest', ''),
          'unidade_compra', nullif(trim(it ->> 'unidade_compra'), ''), 'fator_compra', nullif(it ->> 'fator_compra', '')
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
