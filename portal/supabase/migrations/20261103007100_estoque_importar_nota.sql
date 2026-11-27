-- Entrada de mercadorias importando a nota de compra (XML ou PDF): o portal lê
-- a nota e lança TODOS os itens no estoque de uma vez. Cada item vai para o
-- produto já ligado ao código do fornecedor, ou ao mesmo código de barras, ou
-- à mesma descrição; o que não existe vira produto novo (preço de venda = custo
-- + margem informada). A nota lida do PDF fica registrada pela chave de acesso,
-- para não entrar duas vezes (nem quando o XML dela chegar depois).

-- -----------------------------------------------------------------------------
-- 1. Margem de lucro dos produtos novos (lembrada por empresa)
-- -----------------------------------------------------------------------------
alter table public.gestao_config
  add column margem_entrada numeric(7, 2) check (margem_entrada is null or margem_entrada between 0 and 1000);

-- -----------------------------------------------------------------------------
-- 2. Notas lançadas pelo PDF (DANFE)
-- -----------------------------------------------------------------------------
create table public.estoque_notas_pdf (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null check (chave ~ '^[0-9]{44}$'),
  numero text check (numero is null or length(numero) <= 20),
  serie text check (serie is null or length(serie) <= 5),
  emitente_documento text not null check (emitente_documento ~ '^[0-9A-Z]{11,14}$'),
  emitente_nome text check (emitente_nome is null or length(emitente_nome) <= 200),
  data_emissao date,
  valor_total numeric(15, 2),
  -- Itens como foram lidos do PDF
  itens jsonb not null default '[]'::jsonb,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint estoque_notas_pdf_uk unique (empresa_id, chave)
);
alter table public.estoque_notas_pdf enable row level security;
create policy estoque_notas_pdf_leitura on public.estoque_notas_pdf for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
grant select on public.estoque_notas_pdf to authenticated;

-- A nota (pelo registro do XML ou pela chave) já deu entrada no estoque?
create or replace function app.nota_ja_no_estoque(p_empresa_id uuid, p_documento_fiscal_id uuid, p_chave text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_documento_fiscal_id is not null and exists (select 1 from public.estoque_movimentos m where m.documento_fiscal_id = p_documento_fiscal_id))
      or (p_chave is not null and exists (select 1 from public.estoque_notas_pdf n where n.empresa_id = p_empresa_id and n.chave = p_chave))
      or (p_chave is not null and exists (
            select 1 from public.documentos_fiscais d join public.estoque_movimentos m on m.documento_fiscal_id = d.id
             where d.empresa_id = p_empresa_id and d.chave_acesso = p_chave));
$$;

-- Texto para comparar descrições (sem acento, minúsculo, espaços simples)
create or replace function app.descricao_comparavel(p text)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(regexp_replace(app.normalizar(p), '\s+', ' ', 'g'));
$$;

-- -----------------------------------------------------------------------------
-- 3. Importar a nota: lança tudo ou nada
-- -----------------------------------------------------------------------------
-- p_documento_fiscal_id: nota registrada pelo XML; p_pdf: nota lida do DANFE
-- ({chave, numero, serie, emitente_documento, emitente_nome, data_emissao,
-- valor_total, itens: [{numero_item, codigo, descricao, ncm, unidade,
-- quantidade, valor_total, valor_desconto}]}). Responde {situacao: 'lancada' |
-- 'ja_lancada' | 'conferir', ...}. Em 'conferir' nada é gravado.
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
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
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

-- -----------------------------------------------------------------------------
-- 4. A nota lançada pelo PDF não entra de novo quando o XML dela chegar
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
  if app.nota_ja_no_estoque(p_empresa_id, v_doc.id, v_doc.chave_acesso) then
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

-- As funções de apoio só rodam dentro das funções acima (não respondem sobre outras empresas)
revoke all on function public.gestao_importar_nota(uuid, uuid, jsonb, numeric), app.nota_ja_no_estoque(uuid, uuid, text),
  app.descricao_comparavel(text) from public, anon, authenticated;
grant execute on function public.gestao_importar_nota(uuid, uuid, jsonb, numeric) to authenticated;
revoke all on function public.estoque_entrada_automatica(uuid) from public, anon, authenticated;
grant execute on function public.estoque_entrada_automatica(uuid) to service_role;
