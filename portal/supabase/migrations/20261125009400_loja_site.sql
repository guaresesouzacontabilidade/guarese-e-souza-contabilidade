-- =============================================================================
-- Site da loja: vitrine na internet ligada à gestão da loja
--
--  * O site é um projeto à parte (no domínio da própria loja) e não tem banco:
--    lê o catálogo e manda os pedidos pelas rotas /api/vitrine do portal, que
--    só respondem a quem apresenta a chave do site. A chave é gerada no portal
--    e guardada aqui só como hash (SHA-256).
--  * Os produtos do site são os mesmos da loja (nfe_produtos): preço e estoque
--    vêm do cadastro. O site acrescenta nome de vitrine, descrição, variações
--    (cor, tom, tamanho), fotos, categoria e destaque.
--  * O pedido do site vira um ORÇAMENTO com origem "site" (numeração da loja).
--    No caixa, "Vender" transforma o pedido em venda: baixa o estoque, entra no
--    Financeiro e pode sair a NF-e. Quem vende na loja recebe o aviso.
--  * Fotos num armazenamento público (loja-site), na pasta da empresa; só quem
--    gerencia a loja envia, troca ou apaga.
--  * As funções da vitrine só podem ser chamadas pelo servidor do portal
--    (service_role), depois de conferir a origem e o limite de pedidos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Endereço curto (slug) a partir de um nome: "Prata 925" → "prata-925"
-- -----------------------------------------------------------------------------
create or replace function app.loja_slug(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from left(trim(both '-' from regexp_replace(
    translate(lower(coalesce(p_texto, '')), 'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaaeeeeiiiiooooouuuucnyy'),
    '[^a-z0-9]+', '-', 'g')), 60));
$$;

-- -----------------------------------------------------------------------------
-- 2. Configuração do site (uma por empresa)
-- -----------------------------------------------------------------------------
create table public.loja_sites (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  nome text not null check (length(trim(nome)) between 2 and 80),
  -- Endereço do site na internet (ex.: https://shopluanaaraujo.com.br), usado nos links e avisos
  endereco_site text check (endereco_site is null or endereco_site ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^55[1-9][0-9]{9,10}$'),
  instagram text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  endereco_loja text check (endereco_loja is null or length(endereco_loja) <= 200),
  cidade text check (cidade is null or length(cidade) <= 80),
  horario text check (horario is null or length(horario) <= 200),
  -- Faixa de aviso no topo do site
  aviso text check (aviso is null or length(aviso) <= 160),
  sobre text check (sobre is null or length(sobre) <= 3000),
  politica_trocas text check (politica_trocas is null or length(politica_trocas) <= 6000),
  -- [{ "id": "palmas", "nome": "Entrega em Palmas", "valor": 25, "detalhe": "...", "endereco": true }]
  -- valor null = frete combinado pelo WhatsApp
  entregas jsonb not null default '[]'::jsonb check (jsonb_typeof(entregas) = 'array' and jsonb_array_length(entregas) <= 12),
  pagamentos text[] not null default array['pix', 'cartao_credito', 'cartao_debito', 'dinheiro']
    check (cardinality(pagamentos) between 1 and 4 and pagamentos <@ array['pix', 'cartao_credito', 'cartao_debito', 'dinheiro']),
  pedido_minimo numeric(15, 2) check (pedido_minimo is null or pedido_minimo >= 0),
  -- Chave do site: só o hash; o início ajuda a reconhecer qual chave está em uso
  chave_hash text check (chave_hash is null or chave_hash ~ '^[0-9a-f]{64}$'),
  chave_inicio text check (chave_inicio is null or length(chave_inicio) between 4 and 16),
  chave_gerada_em timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger loja_sites_updated_at before update on public.loja_sites for each row execute function app.tg_updated_at();
create trigger auditoria_loja_sites after insert or update or delete on public.loja_sites for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Categorias do site (dois níveis: Maquiagens → Bases)
-- -----------------------------------------------------------------------------
create table public.loja_site_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pai_id uuid,
  nome text not null check (length(trim(nome)) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,68}[a-z0-9]$|^[a-z0-9]$'),
  ordem int not null default 0 check (ordem between 0 and 100000),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loja_site_categorias_empresa_uk unique (empresa_id, id),
  constraint loja_site_categorias_slug_uk unique (empresa_id, slug),
  constraint loja_site_categorias_pai_fk foreign key (empresa_id, pai_id)
    references public.loja_site_categorias (empresa_id, id) on delete set null (pai_id),
  constraint loja_site_categorias_pai_diferente check (pai_id is null or pai_id <> id)
);
create index loja_site_categorias_pai_idx on public.loja_site_categorias (empresa_id, pai_id, ordem);
create trigger loja_site_categorias_updated_at before update on public.loja_site_categorias for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- 4. O produto no site
-- -----------------------------------------------------------------------------
alter table public.nfe_produtos add constraint nfe_produtos_empresa_id_uk unique (empresa_id, id);

create table public.loja_site_produtos (
  produto_id uuid primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  visivel boolean not null default true,
  categoria_id uuid,
  -- Nome na vitrine (o cadastro da nota tem até 120 letras, muitas vezes em maiúsculas)
  nome text check (nome is null or length(trim(nome)) between 2 and 160),
  descricao text check (descricao is null or length(descricao) <= 8000),
  -- Variações que o cliente escolhe (cor, tom, tamanho); o estoque é do produto
  rotulo_variacao text not null default 'Opção' check (length(trim(rotulo_variacao)) between 1 and 30),
  variacoes text[] not null default '{}' check (cardinality(variacoes) <= 100),
  -- Caminhos no armazenamento (sem a terminação de tamanho), na ordem de exibição
  fotos text[] not null default '{}' check (cardinality(fotos) <= 8),
  destaque boolean not null default false,
  -- Preço "de" (riscado) para promoção; o preço cobrado é sempre o do cadastro
  preco_de numeric(15, 2) check (preco_de is null or preco_de > 0),
  -- Data usada para "Novidades" (na importação, segue a ordem da loja de origem)
  publicado_em timestamptz not null default now(),
  -- Produto de origem quando veio de outra plataforma (ex.: "facilzap:3421215")
  origem_externa text check (origem_externa is null or length(origem_externa) between 3 and 80),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loja_site_produtos_produto_fk foreign key (empresa_id, produto_id)
    references public.nfe_produtos (empresa_id, id) on delete cascade,
  constraint loja_site_produtos_categoria_fk foreign key (empresa_id, categoria_id)
    references public.loja_site_categorias (empresa_id, id) on delete set null (categoria_id),
  constraint loja_site_produtos_origem_uk unique (empresa_id, origem_externa)
);
create index loja_site_produtos_vitrine_idx on public.loja_site_produtos (empresa_id, visivel, publicado_em desc);
create index loja_site_produtos_categoria_idx on public.loja_site_produtos (empresa_id, categoria_id);
create trigger loja_site_produtos_updated_at before update on public.loja_site_produtos for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Pedidos do site: orçamento com origem "site"; a venda que sai dele também
-- -----------------------------------------------------------------------------
alter table public.vendas add column origem text not null default 'portal' check (origem in ('portal', 'site'));
create index vendas_site_idx on public.vendas (empresa_id, created_at desc) where origem = 'site';
alter table public.venda_itens add column variacao text check (variacao is null or length(variacao) between 1 and 60);

-- A venda feita a partir de um pedido do site continua marcada como "site"
create or replace function app.tg_venda_origem_do_orcamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.orcamento_id is not null then
    select coalesce(o.origem, new.origem) into new.origem from public.vendas o where o.id = new.orcamento_id;
  end if;
  return new;
end;
$$;
create trigger vendas_origem_do_orcamento before insert on public.vendas
  for each row when (new.orcamento_id is not null) execute function app.tg_venda_origem_do_orcamento();

-- -----------------------------------------------------------------------------
-- 6. Funções de quem gerencia a loja
-- -----------------------------------------------------------------------------
create or replace function app.exigir_site(p_empresa_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if (select modalidade from public.gestao_config where empresa_id = p_empresa_id) = 'notas' then
    raise exception 'O site da loja não faz parte da modalidade "Notas e transporte".';
  end if;
end;
$$;

create or replace function public.loja_site_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_entregas jsonb := '[]'::jsonb;
  v_ids text[] := '{}';
  v_id text;
  v_valor numeric;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, false);
  v_whats text := nullif(regexp_replace(coalesce(p_dados ->> 'whatsapp', ''), '\D', '', 'g'), '');
  v_pag text[];
begin
  perform app.exigir_site(p_empresa_id);
  -- WhatsApp com DDD: o 55 do Brasil entra sozinho
  if v_whats ~ '^[1-9][0-9]{9,10}$' then
    v_whats := '55' || v_whats;
  end if;
  if jsonb_typeof(coalesce(p_dados -> 'entregas', '[]'::jsonb)) <> 'array' then
    raise exception 'Formas de entrega inválidas.';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_dados -> 'entregas', '[]'::jsonb)) loop
    v_id := app.loja_slug(e ->> 'nome');
    if length(trim(coalesce(e ->> 'nome', ''))) not between 2 and 60 then
      raise exception 'Dê um nome a cada forma de entrega (2 a 60 letras).';
    end if;
    if v_id = '' then
      v_id := 'entrega';
    end if;
    while v_id = any(v_ids) loop
      v_id := v_id || '-2';
    end loop;
    v_ids := v_ids || v_id;
    v_valor := nullif(e ->> 'valor', '')::numeric;
    if v_valor is not null and (v_valor < 0 or v_valor <> round(v_valor, 2) or v_valor > 100000) then
      raise exception 'Valor de entrega inválido em "%".', trim(e ->> 'nome');
    end if;
    if length(coalesce(e ->> 'detalhe', '')) > 160 then
      raise exception 'O detalhe da entrega "%" passa de 160 letras.', trim(e ->> 'nome');
    end if;
    v_entregas := v_entregas || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', left(v_id, 40), 'nome', trim(e ->> 'nome'), 'valor', v_valor,
      'detalhe', nullif(trim(coalesce(e ->> 'detalhe', '')), ''),
      'endereco', coalesce((e ->> 'endereco')::boolean, false)
    )));
  end loop;
  if jsonb_array_length(v_entregas) > 12 then
    raise exception 'No máximo 12 formas de entrega.';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_pag
    from jsonb_array_elements_text(coalesce(p_dados -> 'pagamentos', '[]'::jsonb)) x
   where x in ('pix', 'cartao_credito', 'cartao_debito', 'dinheiro');
  if cardinality(v_pag) = 0 then
    raise exception 'Marque pelo menos uma forma de pagamento.';
  end if;
  if v_ativo and (v_whats is null or jsonb_array_length(v_entregas) = 0) then
    raise exception 'Para ligar o site, informe o WhatsApp da loja e pelo menos uma forma de entrega.';
  end if;
  begin
    insert into public.loja_sites (
      empresa_id, ativo, slug, nome, endereco_site, whatsapp, instagram, email, endereco_loja, cidade, horario,
      aviso, sobre, politica_trocas, entregas, pagamentos, pedido_minimo, atualizado_por
    ) values (
      p_empresa_id, v_ativo, lower(trim(p_dados ->> 'slug')), trim(p_dados ->> 'nome'),
      nullif(rtrim(lower(trim(coalesce(p_dados ->> 'endereco_site', ''))), '/'), ''), v_whats,
      nullif(ltrim(trim(coalesce(p_dados ->> 'instagram', '')), '@'), ''), nullif(lower(trim(coalesce(p_dados ->> 'email', ''))), ''),
      nullif(trim(coalesce(p_dados ->> 'endereco_loja', '')), ''), nullif(trim(coalesce(p_dados ->> 'cidade', '')), ''),
      nullif(trim(coalesce(p_dados ->> 'horario', '')), ''), nullif(trim(coalesce(p_dados ->> 'aviso', '')), ''),
      nullif(trim(coalesce(p_dados ->> 'sobre', '')), ''), nullif(trim(coalesce(p_dados ->> 'politica_trocas', '')), ''),
      v_entregas, v_pag, nullif(p_dados ->> 'pedido_minimo', '')::numeric, auth.uid()
    )
    on conflict (empresa_id) do update set
      ativo = excluded.ativo, slug = excluded.slug, nome = excluded.nome, endereco_site = excluded.endereco_site,
      whatsapp = excluded.whatsapp, instagram = excluded.instagram, email = excluded.email,
      endereco_loja = excluded.endereco_loja, cidade = excluded.cidade, horario = excluded.horario,
      aviso = excluded.aviso, sobre = excluded.sobre, politica_trocas = excluded.politica_trocas,
      entregas = excluded.entregas, pagamentos = excluded.pagamentos, pedido_minimo = excluded.pedido_minimo,
      atualizado_por = auth.uid();
  exception
    when unique_violation then
      raise exception 'O endereço curto "%" já é usado por outra loja. Escolha outro.', lower(trim(p_dados ->> 'slug'));
    when check_violation or not_null_violation then
      raise exception 'Confira os dados do site: nome (2 a 80 letras), endereço curto (3 a 40 letras minúsculas, números e traço), endereço do site começando com https://, WhatsApp com DDD, Instagram sem espaços e textos dentro do tamanho.';
  end;
end;
$$;

-- Nova chave do site (o portal gera a chave e guarda só o hash). Hash nulo desliga o acesso.
create or replace function public.loja_site_definir_chave(p_empresa_id uuid, p_hash text, p_inicio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_site(p_empresa_id);
  if p_hash is not null and p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Chave inválida.';
  end if;
  update public.loja_sites
     set chave_hash = p_hash, chave_inicio = case when p_hash is null then null else p_inicio end,
         chave_gerada_em = case when p_hash is null then null else now() end, atualizado_por = auth.uid()
   where empresa_id = p_empresa_id;
  if not found then
    raise exception 'Salve os dados do site antes de gerar a chave.';
  end if;
end;
$$;

-- Categoria: cria ou acha pelo nome (dentro do mesmo pai); endereço curto único na loja
create or replace function app.loja_site_categoria(p_empresa_id uuid, p_id uuid, p_pai_id uuid, p_nome text, p_ordem int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text;
  v_base text;
  v_n int := 1;
  v_avo uuid;
begin
  if length(trim(coalesce(p_nome, ''))) not between 1 and 60 then
    raise exception 'O nome da categoria deve ter de 1 a 60 letras.';
  end if;
  if p_pai_id is not null then
    select pai_id into v_avo from public.loja_site_categorias where id = p_pai_id and empresa_id = p_empresa_id;
    if not found then
      raise exception 'Categoria principal não encontrada.';
    end if;
    if v_avo is not null then
      raise exception 'As categorias têm só dois níveis: escolha uma categoria principal.';
    end if;
    if p_id is not null and (p_pai_id = p_id or exists (select 1 from public.loja_site_categorias where pai_id = p_id)) then
      raise exception 'Uma categoria que tem subcategorias não pode ficar dentro de outra.';
    end if;
  end if;
  v_base := coalesce(nullif(app.loja_slug(p_nome), ''), 'categoria');
  v_slug := v_base;
  while exists (select 1 from public.loja_site_categorias where empresa_id = p_empresa_id and slug = v_slug and id is distinct from p_id) loop
    v_n := v_n + 1;
    v_slug := left(v_base, 64) || '-' || v_n;
  end loop;
  if p_id is null then
    insert into public.loja_site_categorias (empresa_id, pai_id, nome, slug, ordem)
    values (p_empresa_id, p_pai_id, trim(p_nome), v_slug, coalesce(p_ordem, 0))
    returning id into v_id;
  else
    update public.loja_site_categorias
       set pai_id = p_pai_id, nome = trim(p_nome), slug = v_slug, ordem = coalesce(p_ordem, ordem)
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Categoria não encontrada.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.loja_site_categoria_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir_site(p_empresa_id);
  v_id := app.loja_site_categoria(p_empresa_id, p_id, nullif(p_dados ->> 'pai_id', '')::uuid, p_dados ->> 'nome',
    nullif(p_dados ->> 'ordem', '')::int);
  if p_dados ? 'ativa' then
    update public.loja_site_categorias set ativa = (p_dados ->> 'ativa')::boolean where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Excluir categoria: as subcategorias sobem para o primeiro nível e os produtos ficam sem categoria
create or replace function public.loja_site_categoria_excluir(p_empresa_id uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_site(p_empresa_id);
  delete from public.loja_site_categorias where id = p_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'Categoria não encontrada.';
  end if;
end;
$$;

-- Variações: sem repetidas, sem vazias, até 60 letras cada
create or replace function app.loja_variacoes(p jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text[] := '{}';
  x text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return v;
  end if;
  for x in select trim(regexp_replace(t, '\s+', ' ', 'g')) from jsonb_array_elements_text(p) t loop
    if x <> '' and not x = any(v) then
      if length(x) > 60 then
        raise exception 'A variação "%" passa de 60 letras.', left(x, 30) || '…';
      end if;
      v := v || x;
    end if;
  end loop;
  if cardinality(v) > 100 then
    raise exception 'No máximo 100 variações por produto.';
  end if;
  return v;
end;
$$;

-- Dados do produto no site (as fotos têm função própria)
create or replace function public.loja_site_produto_salvar(p_empresa_id uuid, p_produto_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat uuid := nullif(p_dados ->> 'categoria_id', '')::uuid;
begin
  perform app.exigir_site(p_empresa_id);
  if not exists (select 1 from public.nfe_produtos where id = p_produto_id and empresa_id = p_empresa_id) then
    raise exception 'Produto não encontrado.';
  end if;
  if v_cat is not null and not exists (select 1 from public.loja_site_categorias where id = v_cat and empresa_id = p_empresa_id) then
    raise exception 'Categoria não encontrada.';
  end if;
  begin
    insert into public.loja_site_produtos (
      produto_id, empresa_id, visivel, categoria_id, nome, descricao, rotulo_variacao, variacoes, destaque, preco_de, atualizado_por
    ) values (
      p_produto_id, p_empresa_id, coalesce((p_dados ->> 'visivel')::boolean, true), v_cat,
      nullif(trim(coalesce(p_dados ->> 'nome', '')), ''), nullif(trim(coalesce(p_dados ->> 'descricao', '')), ''),
      coalesce(nullif(trim(coalesce(p_dados ->> 'rotulo_variacao', '')), ''), 'Opção'), app.loja_variacoes(p_dados -> 'variacoes'),
      coalesce((p_dados ->> 'destaque')::boolean, false), nullif(p_dados ->> 'preco_de', '')::numeric, auth.uid()
    )
    on conflict (produto_id) do update set
      visivel = excluded.visivel, categoria_id = excluded.categoria_id, nome = excluded.nome, descricao = excluded.descricao,
      rotulo_variacao = excluded.rotulo_variacao, variacoes = excluded.variacoes, destaque = excluded.destaque,
      preco_de = excluded.preco_de, atualizado_por = auth.uid();
  exception
    when check_violation then
      raise exception 'Confira os dados do produto no site: nome (2 a 160 letras), descrição (até 8.000 letras), nome da variação (até 30 letras) e preço "de" maior que zero.';
  end;
end;
$$;

-- Mostrar ou esconder vários produtos de uma vez
create or replace function public.loja_site_visibilidade(p_empresa_id uuid, p_produtos uuid[], p_visivel boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform app.exigir_site(p_empresa_id);
  if cardinality(p_produtos) > 5000 then
    raise exception 'No máximo 5.000 produtos de uma vez.';
  end if;
  insert into public.loja_site_produtos (produto_id, empresa_id, visivel, atualizado_por)
  select p.id, p.empresa_id, p_visivel, auth.uid()
    from public.nfe_produtos p
   where p.empresa_id = p_empresa_id and p.id = any(p_produtos)
  on conflict (produto_id) do update set visivel = excluded.visivel, atualizado_por = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Fotos do produto: grava a nova lista e devolve as que saíram (para apagar do armazenamento)
create or replace function public.loja_site_produto_fotos(p_empresa_id uuid, p_produto_id uuid, p_fotos text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text[];
  v_prefixo text := p_empresa_id::text || '/p/' || p_produto_id::text || '/';
  f text;
begin
  perform app.exigir_site(p_empresa_id);
  if not exists (select 1 from public.nfe_produtos where id = p_produto_id and empresa_id = p_empresa_id) then
    raise exception 'Produto não encontrado.';
  end if;
  p_fotos := coalesce(p_fotos, '{}');
  if cardinality(p_fotos) > 8 then
    raise exception 'No máximo 8 fotos por produto.';
  end if;
  foreach f in array p_fotos loop
    if left(f, length(v_prefixo)) <> v_prefixo or substr(f, length(v_prefixo) + 1) !~ '^[a-z0-9-]{8,64}$' then
      raise exception 'Foto inválida.';
    end if;
  end loop;
  select fotos into v_antes from public.loja_site_produtos where produto_id = p_produto_id;
  insert into public.loja_site_produtos (produto_id, empresa_id, fotos, atualizado_por)
  values (p_produto_id, p_empresa_id, p_fotos, auth.uid())
  on conflict (produto_id) do update set fotos = excluded.fotos, atualizado_por = auth.uid();
  return coalesce((select array_agg(x) from unnest(coalesce(v_antes, '{}')) x where not x = any(p_fotos)), '{}');
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Importação de outra plataforma (lotes de até 50 produtos)
--    Cada item: externo, codigo, descricao (cadastro), nome, ncm, preco, estoque,
--    categoria, subcategoria, texto (descrição), variacoes, rotulo_variacao,
--    peso_kg, posicao (ordem na loja de origem, 0 = mais novo; vira a data de
--    "Novidades", uma hora a menos por posição, para manter a ordem entre lotes)
--    Produto já importado (mesmo "externo") é atualizado: preço, estoque e textos.
-- -----------------------------------------------------------------------------
create or replace function public.loja_site_importar(p_empresa_id uuid, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  v_externo text;
  v_codigo text;
  v_prod public.nfe_produtos;
  v_id uuid;
  v_cat uuid;
  v_sub uuid;
  v_q numeric;
  v_novo boolean;
  v_saida jsonb := '[]'::jsonb;
  v_dados jsonb;
begin
  perform app.exigir_site(p_empresa_id);
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Nada para importar.';
  end if;
  if jsonb_array_length(p_itens) > 50 then
    raise exception 'Importe até 50 produtos por vez.';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_externo := nullif(trim(it ->> 'externo'), '');
    v_codigo := nullif(trim(it ->> 'codigo'), '');
    if v_externo is null then
      raise exception 'Produto sem identificação de origem.';
    end if;
    begin
      v_prod := null;
      select p.* into v_prod
        from public.loja_site_produtos sp join public.nfe_produtos p on p.id = sp.produto_id
       where sp.empresa_id = p_empresa_id and sp.origem_externa = v_externo;
      if v_prod.id is null and v_codigo is not null then
        select * into v_prod from public.nfe_produtos where empresa_id = p_empresa_id and codigo = v_codigo;
      end if;
      v_novo := v_prod.id is null;
      if v_novo then
        v_id := public.gestao_produto_salvar(p_empresa_id, null, jsonb_strip_nulls(jsonb_build_object(
          'codigo', v_codigo, 'descricao', left(trim(it ->> 'descricao'), 120), 'ncm', it ->> 'ncm', 'unidade', 'UN',
          'valor_unitario', it ->> 'preco', 'peso_kg', nullif(it ->> 'peso_kg', ''), 'controla_estoque', true
        )));
      else
        -- Atualiza o preço (e o peso, se veio); o resto do cadastro da nota fica como está
        v_dados := jsonb_build_object(
          'codigo', v_prod.codigo, 'descricao', v_prod.descricao, 'ncm', v_prod.ncm, 'cest', v_prod.cest, 'gtin', v_prod.gtin,
          'unidade', v_prod.unidade, 'peso_kg', coalesce(nullif(it ->> 'peso_kg', '')::numeric, v_prod.peso_kg),
          'valor_unitario', coalesce(nullif(it ->> 'preco', '')::numeric, v_prod.valor_unitario), 'origem', v_prod.origem,
          'ativo', true, 'grupo', v_prod.grupo, 'preco_custo', v_prod.preco_custo, 'controla_estoque', v_prod.controla_estoque,
          'estoque_minimo', v_prod.estoque_minimo, 'espessura_cm', v_prod.espessura_cm, 'largura_cm', v_prod.largura_cm,
          'comprimento_m', v_prod.comprimento_m
        );
        v_id := public.gestao_produto_salvar(p_empresa_id, v_prod.id, v_dados);
      end if;
      -- Estoque: o saldo passa a ser o da origem (com o histórico do ajuste)
      v_q := nullif(it ->> 'estoque', '')::numeric;
      if v_q is not null then
        if v_q < 0 or v_q <> trunc(v_q) then
          raise exception 'estoque inválido';
        end if;
        select * into v_prod from public.nfe_produtos where id = v_id;
        if v_prod.controla_estoque and v_q <> v_prod.estoque_atual then
          perform app.estoque_movimentar(p_empresa_id, v_id, 'inventario', v_q - v_prod.estoque_atual, null,
            null, null, 'Importação do site (' || split_part(v_externo, ':', 1) || ')', true);
        end if;
      end if;
      -- Categoria e subcategoria (acha pelo nome ou cria)
      v_cat := null;
      v_sub := null;
      if nullif(trim(it ->> 'categoria'), '') is not null then
        select id into v_cat from public.loja_site_categorias
         where empresa_id = p_empresa_id and pai_id is null and lower(nome) = lower(trim(it ->> 'categoria'));
        if v_cat is null then
          v_cat := app.loja_site_categoria(p_empresa_id, null, null, left(trim(it ->> 'categoria'), 60), null);
        end if;
        if nullif(trim(it ->> 'subcategoria'), '') is not null and lower(trim(it ->> 'subcategoria')) <> lower(trim(it ->> 'categoria')) then
          select id into v_sub from public.loja_site_categorias
           where empresa_id = p_empresa_id and pai_id = v_cat and lower(nome) = lower(trim(it ->> 'subcategoria'));
          if v_sub is null then
            v_sub := app.loja_site_categoria(p_empresa_id, null, v_cat, left(trim(it ->> 'subcategoria'), 60), null);
          end if;
        end if;
      end if;
      insert into public.loja_site_produtos (
        produto_id, empresa_id, visivel, categoria_id, nome, descricao, rotulo_variacao, variacoes, publicado_em, origem_externa, atualizado_por
      ) values (
        v_id, p_empresa_id, true, coalesce(v_sub, v_cat), nullif(left(trim(coalesce(it ->> 'nome', '')), 160), ''),
        nullif(left(trim(coalesce(it ->> 'texto', '')), 8000), ''),
        coalesce(nullif(left(trim(coalesce(it ->> 'rotulo_variacao', '')), 30), ''), 'Opção'), app.loja_variacoes(it -> 'variacoes'),
        now() - make_interval(hours => least(coalesce(nullif(it ->> 'posicao', '')::int, 0), 100000)), v_externo, auth.uid()
      )
      on conflict (produto_id) do update set
        categoria_id = coalesce(excluded.categoria_id, public.loja_site_produtos.categoria_id),
        nome = coalesce(excluded.nome, public.loja_site_produtos.nome),
        descricao = coalesce(excluded.descricao, public.loja_site_produtos.descricao),
        rotulo_variacao = excluded.rotulo_variacao, variacoes = excluded.variacoes,
        origem_externa = excluded.origem_externa, atualizado_por = auth.uid();
      v_saida := v_saida || jsonb_build_array(jsonb_build_object(
        'externo', v_externo, 'produto_id', v_id, 'novo', v_novo,
        'fotos', (select cardinality(fotos) from public.loja_site_produtos where produto_id = v_id)
      ));
    exception
      when others then
        raise exception '%: %', coalesce(nullif(left(trim(it ->> 'nome'), 60), ''), v_externo), sqlerrm;
    end;
  end loop;
  return v_saida;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Vitrine (só o servidor do portal chama, com a chave do site)
-- -----------------------------------------------------------------------------
create or replace function app.loja_site_pela_chave(p_slug text, p_chave_hash text)
returns public.loja_sites
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.loja_sites s
   where s.slug = lower(p_slug) and s.chave_hash is not null and s.chave_hash = p_chave_hash;
$$;

-- Dados da loja que o site mostra (nada interno: sem custo, sem estoque exato acima de 99).
-- Razão social e CNPJ entram porque a loja virtual precisa mostrá-los (Decreto 7.962/2013).
create or replace function app.loja_site_dados_publicos(s public.loja_sites)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'nome', s.nome, 'slug', s.slug, 'endereco_site', s.endereco_site, 'whatsapp', s.whatsapp, 'instagram', s.instagram,
    'email', s.email, 'endereco_loja', s.endereco_loja, 'cidade', s.cidade, 'horario', s.horario, 'aviso', s.aviso,
    'sobre', s.sobre, 'politica_trocas', s.politica_trocas, 'entregas', s.entregas, 'pagamentos', to_jsonb(s.pagamentos),
    'pedido_minimo', s.pedido_minimo, 'razao_social', e.razao_social, 'cnpj', case when e.tipo_pessoa = 'PJ' then e.documento end
  )
  from public.empresas e
  where e.id = s.empresa_id;
$$;

create or replace function public.loja_site_vitrine(p_slug text, p_chave_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.loja_sites;
begin
  s := app.loja_site_pela_chave(p_slug, p_chave_hash);
  if s.empresa_id is null then
    return null;
  end if;
  if not s.ativo or not app.gestao_ativa(s.empresa_id) then
    return jsonb_build_object('aberta', false, 'loja', app.loja_site_dados_publicos(s));
  end if;
  return jsonb_build_object(
    'aberta', true,
    'loja', app.loja_site_dados_publicos(s),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'pai_id', c.pai_id, 'nome', c.nome, 'slug', c.slug, 'ordem', c.ordem)
                       order by c.ordem, c.nome)
        from public.loja_site_categorias c
       where c.empresa_id = s.empresa_id and c.ativa
         and (c.pai_id is null or exists (select 1 from public.loja_site_categorias pai where pai.id = c.pai_id and pai.ativa))
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', coalesce(sp.nome, p.descricao), 'preco', round(p.valor_unitario, 2),
               'preco_de', case when sp.preco_de > round(p.valor_unitario, 2) then sp.preco_de end,
               'categoria_id', sp.categoria_id, 'fotos', to_jsonb(sp.fotos[1:2]), 'destaque', sp.destaque,
               'disponivel', (not p.controla_estoque or p.estoque_atual >= 1),
               'ultimas', (p.controla_estoque and p.estoque_atual >= 1 and p.estoque_atual <= 3),
               'opcoes', cardinality(sp.variacoes), 'publicado_em', sp.publicado_em
             ) order by sp.publicado_em desc, p.id)
        from public.loja_site_produtos sp
        join public.nfe_produtos p on p.id = sp.produto_id and p.ativo and p.valor_unitario is not null
       where sp.empresa_id = s.empresa_id and sp.visivel
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.loja_site_vitrine_produto(p_slug text, p_chave_hash text, p_produto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.loja_sites;
  v jsonb;
begin
  s := app.loja_site_pela_chave(p_slug, p_chave_hash);
  if s.empresa_id is null or not s.ativo or not app.gestao_ativa(s.empresa_id) then
    return null;
  end if;
  select jsonb_build_object(
           'id', p.id, 'nome', coalesce(sp.nome, p.descricao), 'preco', round(p.valor_unitario, 2),
           'preco_de', case when sp.preco_de > round(p.valor_unitario, 2) then sp.preco_de end,
           'categoria_id', sp.categoria_id, 'fotos', to_jsonb(sp.fotos), 'destaque', sp.destaque,
           'descricao', sp.descricao, 'rotulo_variacao', sp.rotulo_variacao, 'variacoes', to_jsonb(sp.variacoes),
           'disponivel', (not p.controla_estoque or p.estoque_atual >= 1),
           'ultimas', (p.controla_estoque and p.estoque_atual >= 1 and p.estoque_atual <= 3),
           'maximo', case when p.controla_estoque then least(greatest(floor(p.estoque_atual), 0), 99)::int else 99 end,
           'codigo', p.codigo, 'publicado_em', sp.publicado_em
         )
    into v
    from public.loja_site_produtos sp
    join public.nfe_produtos p on p.id = sp.produto_id and p.ativo and p.valor_unitario is not null
   where sp.produto_id = p_produto_id and sp.empresa_id = s.empresa_id and sp.visivel;
  return v;
end;
$$;

-- Pedido feito no site: vira orçamento (origem "site") e avisa quem vende na loja.
-- Preço, frete e estoque vêm do portal; o que o navegador mandou só serve para conferir.
create or replace function public.loja_site_pedido(p_slug text, p_chave_hash text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.loja_sites;
  v_cfg public.gestao_config;
  it jsonb;
  v_p record;
  v_q numeric;
  v_var text;
  v_preco numeric;
  v_total_item numeric;
  v_subtotal numeric := 0;
  v_frete numeric;
  v_entrega jsonb;
  v_nome text := nullif(trim(regexp_replace(coalesce(p_dados ->> 'nome', ''), '\s+', ' ', 'g')), '');
  v_tel text := regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g');
  v_endereco text := nullif(trim(regexp_replace(coalesce(p_dados ->> 'endereco', ''), '\s+', ' ', 'g')), '');
  v_pag text := p_dados ->> 'pagamento';
  v_troco numeric := nullif(p_dados ->> 'troco_para', '')::numeric;
  v_obs text := nullif(trim(coalesce(p_dados ->> 'observacao', '')), '');
  v_qtd jsonb := '{}'::jsonb;
  v_soma numeric;
  v_linhas jsonb := '[]'::jsonb;
  v_id uuid;
  v_numero bigint;
  v_ordem int := 0;
  v_entrega_txt text;
  v_obs_txt text;
  v_rotulos jsonb := '{"pix": "PIX", "cartao_credito": "Cartão de crédito", "cartao_debito": "Cartão de débito", "dinheiro": "Dinheiro"}';
begin
  s := app.loja_site_pela_chave(p_slug, p_chave_hash);
  if s.empresa_id is null then
    raise exception 'Loja não encontrada.' using errcode = '42501';
  end if;
  if not s.ativo or not app.gestao_ativa(s.empresa_id) then
    raise exception 'A loja não está recebendo pedidos pelo site agora. Fale pelo WhatsApp.';
  end if;

  -- Cliente
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe o seu nome.';
  end if;
  if v_tel ~ '^55[1-9][0-9]{9,10}$' then
    v_tel := substr(v_tel, 3);
  end if;
  if v_tel !~ '^[1-9][0-9]{9,10}$' then
    raise exception 'Informe o seu WhatsApp com DDD (ex.: 63 99999-9999).';
  end if;
  -- Proteção contra pedidos em série (o portal também limita por endereço de internet)
  if (select count(*) from public.vendas where empresa_id = s.empresa_id and origem = 'site'
        and cliente_telefone = v_tel and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Você já enviou vários pedidos agora há pouco. Fale com a loja pelo WhatsApp.';
  end if;
  if (select count(*) from public.vendas where empresa_id = s.empresa_id and origem = 'site'
        and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Muitos pedidos ao mesmo tempo. Tente de novo em alguns minutos ou fale pelo WhatsApp.';
  end if;

  -- Entrega e pagamento
  select e into v_entrega from jsonb_array_elements(s.entregas) e where e ->> 'id' = p_dados ->> 'entrega';
  if v_entrega is null then
    raise exception 'Escolha a forma de entrega.';
  end if;
  if coalesce((v_entrega ->> 'endereco')::boolean, false) and (v_endereco is null or length(v_endereco) < 8) then
    raise exception 'Informe o endereço de entrega (rua, número e bairro).';
  end if;
  if v_endereco is not null and length(v_endereco) > 200 then
    raise exception 'O endereço passa de 200 letras.';
  end if;
  v_frete := coalesce((v_entrega ->> 'valor')::numeric, 0);
  if v_pag is null or not v_pag = any(s.pagamentos) then
    raise exception 'Escolha a forma de pagamento.';
  end if;
  if v_troco is not null and (v_pag <> 'dinheiro' or v_troco <= 0 or v_troco > 100000) then
    v_troco := null;
  end if;
  if v_obs is not null and length(v_obs) > 500 then
    raise exception 'A observação passa de 500 letras.';
  end if;

  -- Itens: preço e estoque do portal
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'A sacola está vazia.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 60 then
    raise exception 'No máximo 60 itens por pedido.';
  end if;
  for it in select * from jsonb_array_elements(p_dados -> 'itens') loop
    if coalesce(it ->> 'produto_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Produto inválido na sacola.';
    end if;
    select p.id, p.codigo, p.descricao, p.unidade, p.valor_unitario, p.custo_medio, p.controla_estoque, p.estoque_atual,
           coalesce(sp.nome, p.descricao) as nome, sp.variacoes, sp.rotulo_variacao
      into v_p
      from public.nfe_produtos p
      join public.loja_site_produtos sp on sp.produto_id = p.id and sp.visivel
     where p.id = (it ->> 'produto_id')::uuid and p.empresa_id = s.empresa_id and p.ativo;
    if v_p.id is null then
      raise exception 'Um dos produtos da sacola saiu do site. Atualize a página e confira a sacola.';
    end if;
    if v_p.valor_unitario is null then
      raise exception 'O produto "%" está sem preço. Fale com a loja pelo WhatsApp.', v_p.nome;
    end if;
    v_q := nullif(it ->> 'quantidade', '')::numeric;
    if v_q is null or v_q < 1 or v_q > 99 or v_q <> trunc(v_q) then
      raise exception 'Quantidade inválida em "%".', v_p.nome;
    end if;
    v_var := nullif(trim(coalesce(it ->> 'variacao', '')), '');
    if cardinality(v_p.variacoes) > 0 then
      if v_var is null or not v_var = any(v_p.variacoes) then
        if lower(v_p.rotulo_variacao) in ('opção', 'opcao') then
          raise exception 'Escolha uma opção para "%".', v_p.nome;
        end if;
        raise exception 'Escolha uma opção (%) para "%".', lower(v_p.rotulo_variacao), v_p.nome;
      end if;
    else
      v_var := null;
    end if;
    v_soma := coalesce((v_qtd ->> v_p.id::text)::numeric, 0) + v_q;
    v_qtd := v_qtd || jsonb_build_object(v_p.id::text, v_soma);
    if v_p.controla_estoque and v_soma > v_p.estoque_atual then
      if v_p.estoque_atual < 1 then
        raise exception '"%" acabou de esgotar. Tire da sacola para continuar.', v_p.nome;
      end if;
      raise exception 'Temos só % de "%" no momento.', floor(v_p.estoque_atual)::int, v_p.nome;
    end if;
    v_preco := round(v_p.valor_unitario, 2);
    v_total_item := round(v_q * v_preco, 2);
    v_subtotal := v_subtotal + v_total_item;
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'produto_id', v_p.id, 'codigo', v_p.codigo, 'descricao', v_p.descricao, 'nome', v_p.nome, 'unidade', v_p.unidade,
      'quantidade', v_q, 'preco', v_preco, 'total', v_total_item, 'variacao', v_var, 'rotulo_variacao', v_p.rotulo_variacao,
      'custo', v_p.custo_medio, 'preco_tabela', v_p.valor_unitario
    ));
  end loop;
  if s.pedido_minimo is not null and v_subtotal < s.pedido_minimo then
    raise exception 'O pedido mínimo do site é de R$ %.', to_char(s.pedido_minimo, 'FM999G999G990D00');
  end if;
  -- O total que a pessoa viu na tela tem de bater (se o preço mudou, ela confere antes de enviar)
  if nullif(p_dados ->> 'total_visto', '') is not null and (p_dados ->> 'total_visto')::numeric <> v_subtotal + v_frete then
    raise exception 'Os preços mudaram desde que você abriu a sacola. Confira o novo total e envie de novo.' using errcode = 'P0002';
  end if;

  v_entrega_txt := left(concat_ws(' — ', v_entrega ->> 'nome', v_endereco), 300);
  v_obs_txt := left(concat_ws(E'\n',
    'Pedido feito pelo site.',
    'Pagamento: ' || (v_rotulos ->> v_pag) || case when v_troco is not null then ' (troco para R$ ' || to_char(v_troco, 'FM999G999G990D00') || ')' else '' end,
    case when v_entrega ->> 'valor' is null then 'Frete: a combinar pelo WhatsApp.' end,
    case when v_obs is not null then 'Observação do cliente: ' || v_obs end
  ), 1000);

  -- Grava como orçamento da loja
  select * into v_cfg from public.gestao_config where empresa_id = s.empresa_id for update;
  v_numero := v_cfg.proximo_numero_orcamento;
  update public.gestao_config set proximo_numero_orcamento = proximo_numero_orcamento + 1 where empresa_id = s.empresa_id;
  insert into public.vendas (
    empresa_id, tipo, numero, status, origem, data, validade, cliente_nome, cliente_telefone,
    subtotal, desconto, frete, total, observacao, entrega, vendedor_id
  ) values (
    s.empresa_id, 'orcamento', v_numero, 'aberto', 'site', app.hoje(), app.hoje() + v_cfg.validade_orcamento_dias, v_nome, v_tel,
    v_subtotal, 0, v_frete, v_subtotal + v_frete, v_obs_txt, v_entrega_txt, null
  ) returning id into v_id;
  for it in select * from jsonb_array_elements(v_linhas) loop
    v_ordem := v_ordem + 1;
    insert into public.venda_itens (
      empresa_id, venda_id, ordem, produto_id, codigo, descricao, unidade, quantidade, preco_tabela, preco_unitario,
      desconto, total, custo_unitario, variacao
    ) values (
      s.empresa_id, v_id, v_ordem, (it ->> 'produto_id')::uuid, it ->> 'codigo', it ->> 'descricao', it ->> 'unidade',
      (it ->> 'quantidade')::numeric, (it ->> 'preco_tabela')::numeric, (it ->> 'preco')::numeric, 0, (it ->> 'total')::numeric,
      nullif(it ->> 'custo', '')::numeric, it ->> 'variacao'
    );
  end loop;

  perform app.notificar_clientes(s.empresa_id, 'gestao.vender', 'pedido_site',
    format('Pedido nº %s pelo site', v_numero),
    format('%s · R$ %s · %s', v_nome, to_char(v_subtotal + v_frete, 'FM999G999G990D00'), v_entrega ->> 'nome'),
    format('/e/%s/loja/vendas/%s', s.empresa_id, v_id), false);

  return jsonb_build_object(
    'numero', v_numero, 'subtotal', v_subtotal, 'frete', v_frete, 'frete_a_combinar', v_entrega ->> 'valor' is null,
    'total', v_subtotal + v_frete, 'entrega', v_entrega ->> 'nome', 'endereco', v_endereco,
    'pagamento', v_rotulos ->> v_pag, 'troco_para', v_troco, 'whatsapp', s.whatsapp, 'nome', v_nome,
    'itens', (select jsonb_agg(jsonb_build_object('nome', x ->> 'nome', 'quantidade', (x ->> 'quantidade')::numeric,
                'preco', (x ->> 'preco')::numeric, 'total', (x ->> 'total')::numeric, 'variacao', x ->> 'variacao',
                'rotulo_variacao', x ->> 'rotulo_variacao')) from jsonb_array_elements(v_linhas) x)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Fotos: armazenamento público (as fotos aparecem no site), escrita só por quem gerencia a loja
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loja-site', 'loja-site', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy loja_site_fotos_leitura on storage.objects for select to authenticated
  using (bucket_id = 'loja-site' and app.pode(app.empresa_do_objeto(name), 'gestao.vender'));
create policy loja_site_fotos_insercao on storage.objects for insert to authenticated
  with check (bucket_id = 'loja-site' and app.pode(app.empresa_do_objeto(name), 'gestao.gerenciar') and app.gestao_ativa(app.empresa_do_objeto(name)));
create policy loja_site_fotos_alteracao on storage.objects for update to authenticated
  using (bucket_id = 'loja-site' and app.pode(app.empresa_do_objeto(name), 'gestao.gerenciar'))
  with check (bucket_id = 'loja-site' and app.pode(app.empresa_do_objeto(name), 'gestao.gerenciar'));
create policy loja_site_fotos_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'loja-site' and app.pode(app.empresa_do_objeto(name), 'gestao.gerenciar'));

-- -----------------------------------------------------------------------------
-- 10. Acesso: leitura por quem usa a loja (a chave nunca); escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.loja_sites enable row level security;
alter table public.loja_site_categorias enable row level security;
alter table public.loja_site_produtos enable row level security;

create policy loja_sites_leitura on public.loja_sites for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
create policy loja_site_categorias_leitura on public.loja_site_categorias for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
create policy loja_site_produtos_leitura on public.loja_site_produtos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));

revoke all on public.loja_sites, public.loja_site_categorias, public.loja_site_produtos from anon, authenticated;
-- O hash da chave não é lido pelo navegador: só as demais colunas
grant select (empresa_id, ativo, slug, nome, endereco_site, whatsapp, instagram, email, endereco_loja, cidade, horario, aviso,
  sobre, politica_trocas, entregas, pagamentos, pedido_minimo, chave_inicio, chave_gerada_em, atualizado_por, created_at, updated_at)
  on public.loja_sites to authenticated;
grant select on public.loja_site_categorias, public.loja_site_produtos to authenticated;
grant select, insert, update, delete on public.loja_sites, public.loja_site_categorias, public.loja_site_produtos to service_role;

revoke execute on function
  public.loja_site_configurar(uuid, jsonb), public.loja_site_definir_chave(uuid, text, text),
  public.loja_site_categoria_salvar(uuid, uuid, jsonb), public.loja_site_categoria_excluir(uuid, uuid),
  public.loja_site_produto_salvar(uuid, uuid, jsonb), public.loja_site_visibilidade(uuid, uuid[], boolean),
  public.loja_site_produto_fotos(uuid, uuid, text[]), public.loja_site_importar(uuid, jsonb),
  public.loja_site_vitrine(text, text), public.loja_site_vitrine_produto(text, text, uuid), public.loja_site_pedido(text, text, jsonb),
  app.loja_slug(text), app.exigir_site(uuid), app.loja_site_categoria(uuid, uuid, uuid, text, int), app.loja_variacoes(jsonb),
  app.loja_site_pela_chave(text, text), app.loja_site_dados_publicos(public.loja_sites), app.tg_venda_origem_do_orcamento()
  from public, anon, authenticated;
grant execute on function
  public.loja_site_configurar(uuid, jsonb), public.loja_site_definir_chave(uuid, text, text),
  public.loja_site_categoria_salvar(uuid, uuid, jsonb), public.loja_site_categoria_excluir(uuid, uuid),
  public.loja_site_produto_salvar(uuid, uuid, jsonb), public.loja_site_visibilidade(uuid, uuid[], boolean),
  public.loja_site_produto_fotos(uuid, uuid, text[]), public.loja_site_importar(uuid, jsonb)
  to authenticated;
grant execute on function
  public.loja_site_vitrine(text, text), public.loja_site_vitrine_produto(text, text, uuid), public.loja_site_pedido(text, text, jsonb)
  to service_role;
