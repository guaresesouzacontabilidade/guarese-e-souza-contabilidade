-- Permissão "Ver custos e margens" (gestao.custos), separada de "Gerenciar a loja".
--
-- Quem gerencia a loja sem essa permissão cadastra produtos, muda preços e
-- lança estoque, mas não vê o custo de compra, o custo médio, a margem nem o
-- valor do estoque. O controle vale no banco, não só na tela:
--  * as colunas de custo (produto, movimentos do estoque, itens das vendas e
--    histórico de preços) deixam de ser lidas diretamente por qualquer usuário;
--    quem tem a permissão lê o custo pelas funções gestao_produtos_custos e
--    gestao_produto_custos, que conferem a permissão;
--  * as funções que mostram ou lançam custo (tabela de preços, vendas por
--    produto, margens, entrada de mercadorias por nota) passam a exigir a
--    permissão;
--  * salvar o produto ou importar a planilha sem a permissão mantém o custo que
--    já está guardado (o custo enviado é ignorado).
-- No começo, só o escritório e o titular da empresa têm a permissão; o titular
-- marca nos colaboradores que podem ver. Ver custos implica gerenciar a loja.

-- -----------------------------------------------------------------------------
-- 1. Permissão
-- -----------------------------------------------------------------------------
create or replace function app.permissoes_validas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'empresa.ver',
    'empresa.editar',
    'usuarios.gerenciar',
    'documentos.ver',
    'documentos.enviar',
    'documentos.baixar',
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'financeiro.ver',
    'financeiro.editar',
    'financeiro.importar',
    'conciliacao.executar',
    'relatorios.ver',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'mensagens.usar',
    'calculos.ver',
    'calculos.gerenciar',
    'colaboradores.gerenciar',
    'certificado.gerenciar',
    'auditor.ver',
    'auditor.gerenciar',
    'maquininhas.ver',
    'maquininhas.gerenciar',
    'nfse.emitir',
    'nfse.configurar',
    'nfe.emitir',
    'nfe.configurar',
    'gestao.vender',
    'gestao.gerenciar',
    'gestao.custos',
    'cte.emitir',
    'cte.configurar',
    'escalas.ver',
    'escalas.gerenciar',
    'os.operar',
    'os.gerenciar'
  ]::text[];
$$;

create or replace function app.permissoes_padrao(p_papel text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'equipe' then array[
      'empresa.ver', 'empresa.editar', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar', 'documentos.revisar', 'documentos.publicar',
      'checklist.gerenciar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar', 'conciliacao.executar',
      'relatorios.ver', 'relatorios.publicar',
      'fechamento.gerenciar',
      'mensagens.usar',
      'calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver', 'auditor.gerenciar',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir', 'nfse.configurar',
      'nfe.emitir', 'nfe.configurar',
      'gestao.vender', 'gestao.gerenciar', 'gestao.custos',
      'cte.emitir', 'cte.configurar',
      'escalas.ver', 'escalas.gerenciar',
      'os.operar', 'os.gerenciar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir',
      'nfe.emitir',
      'gestao.vender', 'gestao.gerenciar', 'gestao.custos',
      'cte.emitir',
      'escalas.ver', 'escalas.gerenciar',
      'os.operar', 'os.gerenciar'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

-- Troca um trecho no corpo de uma função já existente (sem copiar a função
-- inteira); falha se o trecho não estiver lá, para a migração não passar calada.
create function pg_temp.trocar_no_corpo(p_funcao regprocedure, p_de text, p_para text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_funcao);
begin
  if position(p_de in v_def) = 0 then
    raise exception 'Trecho não encontrado em %: %', p_funcao, p_de;
  end if;
  execute replace(v_def, p_de, p_para);
end;
$$;

-- Ver custos e margens implica gerenciar a loja (que já implica vender).
select pg_temp.trocar_no_corpo('app.tg_validar_membro()',
$a$  -- Gerenciar a loja implica poder vender.$a$,
$a$  -- Ver custos e margens implica gerenciar a loja.
  if 'gestao.custos' = any(new.permissoes) and not ('gestao.gerenciar' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'gestao.gerenciar');
  end if;
  -- Gerenciar a loja implica poder vender.$a$);

-- Acessos existentes: só o escritório e o titular passam a ver custos e margens
-- (colaboradores, mesmo os que gerenciam a loja, só se o titular marcar).
update public.empresa_membros
   set permissoes = permissoes || array['gestao.custos']
 where papel in ('equipe', 'cliente_titular') and not ('gestao.custos' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['gestao.custos']
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and cardinality(permissoes) > 0
   and not ('gestao.custos' = any(permissoes));

-- -----------------------------------------------------------------------------
-- 2. Colunas de custo: ninguém lê diretamente
-- -----------------------------------------------------------------------------
-- Libera para leitura todas as colunas destas tabelas, menos as de custo.
-- Chame de novo numa migração que crie coluna nova nestas tabelas (senão a
-- coluna nova fica sem leitura; o teste 89 do banco aponta).
create or replace function app.liberar_colunas_sem_custo()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_colunas text;
begin
  for r in
    select * from (values
      ('nfe_produtos', array['preco_custo', 'custo_medio', 'margem_desejada']),
      ('estoque_movimentos', array['custo_unitario', 'custo_medio_apos']),
      ('venda_itens', array['custo_unitario']),
      ('produto_precos_historico', array['custo_referencia'])
    ) as t(tabela, ocultas)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_colunas
      from pg_attribute a
     where a.attrelid = ('public.' || r.tabela)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname <> all (r.ocultas);
    execute format('revoke select on public.%I from anon, authenticated', r.tabela);
    execute format('revoke select (%s) on public.%I from anon, authenticated',
      (select string_agg(quote_ident(c), ', ') from unnest(r.ocultas) c), r.tabela);
    execute format('grant select (%s) on public.%I to authenticated', v_colunas, r.tabela);
  end loop;
end;
$$;
revoke all on function app.liberar_colunas_sem_custo() from public, anon, authenticated;
select app.liberar_colunas_sem_custo();

-- Metas de margem por grupo: só quem vê custos e margens
drop policy gestao_grupos_margem_leitura on public.gestao_grupos_margem;
create policy gestao_grupos_margem_leitura on public.gestao_grupos_margem for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.custos'))::uuid[]));

-- -----------------------------------------------------------------------------
-- 3. Leitura dos custos (só com a permissão)
-- -----------------------------------------------------------------------------
-- Custos de todos os produtos da empresa: { "<produto>": { preco_custo, custo_medio, margem_desejada } }
-- (um objeto só, sem o limite de linhas da API).
create or replace function public.gestao_produtos_custos(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.custos');
  return coalesce((
    select jsonb_object_agg(p.id, jsonb_build_object('preco_custo', p.preco_custo, 'custo_medio', p.custo_medio, 'margem_desejada', p.margem_desejada))
      from public.nfe_produtos p
     where p.empresa_id = p_empresa_id
  ), '{}'::jsonb);
end;
$$;

-- Custos da ficha do produto: últimos movimentos do estoque e histórico de preços
-- { "movimentos": { "<id>": custo }, "historico": { "<id>": custo } }
create or replace function public.gestao_produto_custos(p_empresa_id uuid, p_produto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.custos');
  return jsonb_build_object(
    'movimentos', coalesce((
      select jsonb_object_agg(m.id, m.custo_unitario)
        from (select id, custo_unitario from public.estoque_movimentos
               where empresa_id = p_empresa_id and produto_id = p_produto_id
               order by created_at desc limit 500) m
    ), '{}'::jsonb),
    'historico', coalesce((
      select jsonb_object_agg(h.id, h.custo_referencia)
        from (select id, custo_referencia from public.produto_precos_historico
               where empresa_id = p_empresa_id and produto_id = p_produto_id
               order by id desc limit 500) h
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.gestao_produtos_custos(uuid), public.gestao_produto_custos(uuid, uuid) from public, anon;
grant execute on function public.gestao_produtos_custos(uuid), public.gestao_produto_custos(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Funções que mostram ou lançam custo passam a exigir a permissão
-- -----------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  foreach f in array array[
    'public.gestao_precos_situacao(uuid)',
    'public.gestao_vendas_por_produto(uuid, date, date)',
    'public.gestao_produto_margem(uuid, uuid, numeric)',
    'public.gestao_grupo_margem(uuid, text, numeric)',
    'public.gestao_margem_padrao(uuid, numeric)',
    'public.gestao_importar_nota(uuid, uuid, jsonb, numeric)',
    'public.gestao_entrada_nota(uuid, uuid, jsonb)'
  ]::regprocedure[] loop
    perform pg_temp.trocar_no_corpo(f,
      $a$app.exigir_gestao(p_empresa_id, 'gestao.gerenciar')$a$,
      $a$app.exigir_gestao(p_empresa_id, 'gestao.custos')$a$);
  end loop;
end;
$$;

-- Salvar o produto sem a permissão: o custo enviado é ignorado (fica o guardado)
select pg_temp.trocar_no_corpo('public.gestao_produto_salvar(uuid, uuid, jsonb)',
  $a$nullif(trim(p_dados ->> 'grupo'), ''), nullif(p_dados ->> 'preco_custo', '')::numeric,$a$,
  $a$nullif(trim(p_dados ->> 'grupo'), ''),
        case when app.pode(p_empresa_id, 'gestao.custos') then nullif(p_dados ->> 'preco_custo', '')::numeric end,$a$);
select pg_temp.trocar_no_corpo('public.gestao_produto_salvar(uuid, uuid, jsonb)',
  $a$preco_custo = nullif(p_dados ->> 'preco_custo', '')::numeric,$a$,
  $a$preco_custo = case when app.pode(p_empresa_id, 'gestao.custos') then nullif(p_dados ->> 'preco_custo', '')::numeric else preco_custo end,$a$);

-- Planilha de produtos sem a permissão: a coluna de custo é ignorada
select pg_temp.trocar_no_corpo('public.gestao_importar_produtos(uuid, jsonb)',
  $a$perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');$a$,
  $a$perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if not app.pode(p_empresa_id, 'gestao.custos') and jsonb_typeof(p_linhas) = 'array' then
    p_linhas := coalesce((select jsonb_agg(e - 'preco_custo') from jsonb_array_elements(p_linhas) e), '[]'::jsonb);
  end if;$a$);
