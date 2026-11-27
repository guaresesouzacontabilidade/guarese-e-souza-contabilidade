-- DRE gerencial personalizado por empresa e ajustes no resultado.
--
-- * Modelo do DRE (dre_modelo_linhas): sem linhas, vale o padrão do sistema.
--   "Personalizar" copia o padrão; o gestor renomeia, muda a ordem, cria
--   linhas (contas que ele escolhe) e subtotais (soma de tudo o que está
--   acima), mostra ou recolhe as contas de cada linha e esconde subtotais.
--   As linhas do padrão continuam recebendo automaticamente as contas pelo
--   tipo; uma conta (ou um grupo inteiro) pode ser levada para outra linha.
--   O resultado líquido fica sempre por último. "Voltar ao padrão" apaga o
--   modelo. Nenhum valor some: só muda a forma de apresentar.
-- * Ajustes no resultado (dre_ajustes): valor só de competência (depreciação,
--   provisão), sem mexer no caixa, com motivo obrigatório, em mês aberto e
--   registrado no histórico. Não se edita: exclui e lança de novo.
-- O cálculo continua por competência e os indicadores usam a estrutura padrão.

-- -----------------------------------------------------------------------------
-- Modelo do DRE
-- -----------------------------------------------------------------------------
create table public.dre_modelo_linhas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem int not null,
  tipo text not null check (tipo in ('grupo', 'total')),
  rotulo text not null check (length(trim(rotulo)) between 2 and 80),
  chave_padrao text check (chave_padrao is null or chave_padrao ~ '^[a-z_]{2,40}$'),
  -- Tipos de conta que entram automaticamente (só as linhas copiadas do padrão)
  tipos text[] not null default '{}' check (tipos <@ array[
    'receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
    'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro'
  ]::text[]),
  mostrar_contas boolean not null default true,   -- linha: mostra as contas abaixo dela
  oculta boolean not null default false,          -- subtotal: não aparece no relatório
  destaque boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dre_modelo_linhas_empresa_id_unico unique (empresa_id, id),
  constraint dre_modelo_linhas_chave_unica unique (empresa_id, chave_padrao),
  constraint dre_modelo_linhas_total_sem_tipos check (tipo = 'grupo' or tipos = '{}'),
  constraint dre_modelo_linhas_resultado_visivel check (chave_padrao is distinct from 'resultado_liquido' or not oculta)
);
create index dre_modelo_linhas_empresa_idx on public.dre_modelo_linhas (empresa_id, ordem);
create trigger dre_modelo_linhas_updated_at before update on public.dre_modelo_linhas
  for each row execute function app.tg_updated_at();
create trigger auditoria_dre_modelo_linhas after insert or update or delete on public.dre_modelo_linhas
  for each row execute function app.tg_auditoria();

create or replace function app.tg_dre_modelo_linhas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.rotulo := trim(new.rotulo);
  if tg_op = 'UPDATE' and new.chave_padrao = 'resultado_liquido' and new.ordem <> old.ordem
     and exists (select 1 from public.dre_modelo_linhas where empresa_id = new.empresa_id and id <> new.id and ordem > new.ordem) then
    raise exception 'O resultado líquido fica sempre na última linha.';
  end if;
  return new;
end;
$$;
create trigger dre_modelo_linhas_regras before insert or update on public.dre_modelo_linhas
  for each row execute function app.tg_dre_modelo_linhas();

-- Conta (ou grupo) levada para uma linha do modelo
alter table public.categorias_financeiras
  add column dre_linha_id uuid,
  add constraint categorias_financeiras_dre_linha_fk foreign key (empresa_id, dre_linha_id)
    references public.dre_modelo_linhas (empresa_id, id) on delete set null (dre_linha_id);

-- -----------------------------------------------------------------------------
-- Ajustes no resultado
-- -----------------------------------------------------------------------------
create table public.dre_ajustes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  categoria_id uuid not null,
  competencia date not null,
  valor numeric(15,2) not null check (valor <> 0 and abs(valor) < 1000000000000),
  motivo text not null check (length(trim(motivo)) between 5 and 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint dre_ajustes_empresa_id_unico unique (empresa_id, id),
  foreign key (empresa_id, categoria_id) references public.categorias_financeiras (empresa_id, id)
);
create index dre_ajustes_empresa_idx on public.dre_ajustes (empresa_id, competencia);
create index dre_ajustes_categoria_idx on public.dre_ajustes (categoria_id);
create trigger auditoria_dre_ajustes after insert or update or delete on public.dre_ajustes
  for each row execute function app.tg_auditoria();

create or replace function app.tg_dre_ajustes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.categorias_financeiras;
begin
  if tg_op = 'DELETE' then
    perform app.exigir_competencia_aberta(old.empresa_id, old.competencia);
    return old;
  end if;
  if tg_op = 'UPDATE' then
    -- Só a troca de conta feita pela exclusão de conta (o resto não se altera)
    if coalesce(current_setting('app.contexto', true), '') = 'mover_ajustes'
       and (to_jsonb(new) - 'categoria_id') = (to_jsonb(old) - 'categoria_id') then
      return new;
    end if;
    raise exception 'Ajuste não se altera: exclua e lance de novo.';
  end if;
  new.competencia := date_trunc('month', new.competencia)::date;
  new.motivo := trim(new.motivo);
  if auth.uid() is not null then
    new.criado_por := auth.uid();
  end if;
  select * into v_cat from public.categorias_financeiras where id = new.categoria_id and empresa_id = new.empresa_id;
  if not found then
    raise exception 'Conta não encontrada.';
  end if;
  if v_cat.sintetica then
    raise exception 'A conta "%" é um grupo. Escolha uma conta dentro dele.', v_cat.nome;
  end if;
  if v_cat.tipo not in ('receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
                        'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro') then
    raise exception 'A conta "%" fica fora do resultado. Escolha uma conta de receita, custo ou despesa.', v_cat.nome;
  end if;
  perform app.exigir_competencia_aberta(new.empresa_id, new.competencia);
  return new;
end;
$$;
create trigger dre_ajustes_regras before insert or update or delete on public.dre_ajustes
  for each row execute function app.tg_dre_ajustes();

-- -----------------------------------------------------------------------------
-- Estrutura do plano de contas: linha do DRE precisa ser uma linha de contas
-- (não subtotal) da mesma empresa; contas fora do resultado não vão para o DRE.
-- -----------------------------------------------------------------------------
create or replace function app.tg_categorias_estrutura()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pai public.categorias_financeiras;
begin
  new.nome := trim(new.nome);
  new.codigo := trim(new.codigo);
  if new.pai_id is not null
     and (tg_op = 'INSERT' or new.pai_id is distinct from old.pai_id or new.sintetica is distinct from old.sintetica) then
    if new.pai_id = new.id then
      raise exception 'Uma conta não pode ser grupo dela mesma.';
    end if;
    select * into v_pai from public.categorias_financeiras where id = new.pai_id and empresa_id = new.empresa_id;
    if not found or not v_pai.sintetica then
      raise exception 'Escolha um grupo do plano de contas.';
    end if;
    if new.sintetica then
      raise exception 'Um grupo não pode ficar dentro de outro grupo.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.sintetica <> old.sintetica then
    if new.sintetica and (exists (select 1 from public.lancamentos where categoria_id = old.id)
                          or exists (select 1 from public.recorrencias where categoria_id = old.id)
                          or exists (select 1 from public.dre_ajustes where categoria_id = old.id)) then
      raise exception 'A conta "%" tem lançamentos e não pode virar grupo.', old.nome;
    end if;
    if not new.sintetica and exists (select 1 from public.categorias_financeiras where pai_id = old.id) then
      raise exception 'O grupo "%" tem contas dentro e não pode virar conta.', old.nome;
    end if;
  end if;
  if new.dre_linha_id is not null
     and (tg_op = 'INSERT' or new.dre_linha_id is distinct from old.dre_linha_id or new.tipo is distinct from old.tipo) then
    if not exists (select 1 from public.dre_modelo_linhas where id = new.dre_linha_id and empresa_id = new.empresa_id and tipo = 'grupo') then
      raise exception 'Escolha uma linha de contas do DRE (não um subtotal).';
    end if;
    if not new.sintetica and new.tipo not in ('receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
                                              'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro') then
      raise exception 'A conta "%" fica fora do resultado e não aparece no DRE.', new.nome;
    end if;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs do modelo
-- -----------------------------------------------------------------------------
-- Copia a estrutura padrão (igual a ESTRUTURA_DRE em src/lib/relatorios/dre.ts).
create or replace function public.personalizar_dre(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not (p_empresa_id = any (app.empresas_com('financeiro.editar'))) then
    raise exception 'Você não tem permissão para editar o financeiro desta empresa.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('dre_modelo:' || p_empresa_id::text));
  select count(*) into v_n from public.dre_modelo_linhas where empresa_id = p_empresa_id;
  if v_n > 0 then
    return v_n;
  end if;
  insert into public.dre_modelo_linhas (empresa_id, ordem, tipo, rotulo, chave_padrao, tipos, destaque)
  values
    (p_empresa_id, 1, 'grupo', 'Receita bruta (vendas e serviços)', 'receita_bruta', array['receita_operacional'], false),
    (p_empresa_id, 2, 'grupo', '(−) Impostos sobre vendas, devoluções e descontos', 'deducoes', array['deducao_receita'], false),
    (p_empresa_id, 3, 'total', 'Receita líquida', 'receita_liquida', '{}', false),
    (p_empresa_id, 4, 'grupo', '(−) Custos das mercadorias e dos serviços', 'custos', array['custo_mercadoria', 'custo_servico'], false),
    (p_empresa_id, 5, 'total', 'Lucro bruto', 'lucro_bruto', '{}', false),
    (p_empresa_id, 6, 'grupo', '(−) Despesas operacionais', 'despesas_operacionais', array['despesa_operacional'], false),
    (p_empresa_id, 7, 'total', 'Resultado operacional', 'resultado_operacional', '{}', false),
    (p_empresa_id, 8, 'grupo', '(+) Receitas financeiras', 'receitas_financeiras', array['receita_financeira'], false),
    (p_empresa_id, 9, 'grupo', '(−) Despesas financeiras (juros, tarifas, taxas)', 'despesas_financeiras', array['despesa_financeira'], false),
    (p_empresa_id, 10, 'grupo', '(+) Outras receitas', 'outras_receitas', array['outras_receitas'], false),
    (p_empresa_id, 11, 'grupo', '(−) Outras despesas', 'outras_despesas', array['outras_despesas'], false),
    (p_empresa_id, 12, 'total', 'Resultado antes do IRPJ/CSLL', 'resultado_antes_impostos', '{}', false),
    (p_empresa_id, 13, 'grupo', '(−) IRPJ e CSLL', 'impostos_lucro', array['impostos_lucro'], false),
    (p_empresa_id, 14, 'total', 'Resultado líquido (lucro ou prejuízo)', 'resultado_liquido', '{}', true);
  return 14;
end;
$$;

-- Apaga o modelo: o DRE volta à estrutura padrão (as contas voltam às linhas do tipo).
create or replace function public.restaurar_dre_padrao(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not (p_empresa_id = any (app.empresas_com('financeiro.editar'))) then
    raise exception 'Você não tem permissão para editar o financeiro desta empresa.' using errcode = '42501';
  end if;
  update public.categorias_financeiras set dre_linha_id = null where empresa_id = p_empresa_id and dre_linha_id is not null;
  delete from public.dre_modelo_linhas where empresa_id = p_empresa_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Nova linha (de contas ou subtotal) logo abaixo de outra (ou antes do resultado líquido).
create or replace function public.inserir_linha_dre(p_empresa_id uuid, p_tipo text, p_rotulo text, p_depois_de uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ordem int;
  v_id uuid;
begin
  if not (p_empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[])) then
    raise exception 'Você não tem permissão para editar o financeiro desta empresa.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dre_modelo_linhas where empresa_id = p_empresa_id) then
    raise exception 'Personalize o DRE antes de criar linhas.';
  end if;
  if p_depois_de is not null then
    select ordem into v_ordem from public.dre_modelo_linhas
     where id = p_depois_de and empresa_id = p_empresa_id and chave_padrao is distinct from 'resultado_liquido';
    if not found then
      raise exception 'Escolha uma linha acima do resultado líquido.';
    end if;
  else
    select ordem - 1 into v_ordem from public.dre_modelo_linhas where empresa_id = p_empresa_id and chave_padrao = 'resultado_liquido';
    v_ordem := coalesce(v_ordem, (select max(ordem) from public.dre_modelo_linhas where empresa_id = p_empresa_id));
  end if;
  -- Abre espaço de baixo para cima (o resultado líquido continua por último)
  update public.dre_modelo_linhas set ordem = ordem + 1 where empresa_id = p_empresa_id and ordem > v_ordem;
  insert into public.dre_modelo_linhas (empresa_id, ordem, tipo, rotulo)
  values (p_empresa_id, v_ordem + 1, p_tipo, p_rotulo)
  returning id into v_id;
  return v_id;
end;
$$;

-- Sobe ou desce uma linha (troca com a vizinha). O resultado líquido não se move.
create or replace function public.mover_linha_dre(p_linha_id uuid, p_direcao int)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.dre_modelo_linhas;
  w public.dre_modelo_linhas;
begin
  select * into v from public.dre_modelo_linhas where id = p_linha_id;
  if not found then
    raise exception 'Linha não encontrada.' using errcode = 'P0002';
  end if;
  if not (v.empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[])) then
    raise exception 'Você não tem permissão para editar o financeiro desta empresa.' using errcode = '42501';
  end if;
  if v.chave_padrao = 'resultado_liquido' then
    raise exception 'O resultado líquido fica sempre na última linha.';
  end if;
  if p_direcao < 0 then
    select * into w from public.dre_modelo_linhas where empresa_id = v.empresa_id and ordem < v.ordem order by ordem desc limit 1;
  else
    select * into w from public.dre_modelo_linhas where empresa_id = v.empresa_id and ordem > v.ordem order by ordem limit 1;
  end if;
  if not found or w.chave_padrao = 'resultado_liquido' then
    return;
  end if;
  -- Troca as posições (passando por uma posição livre para não repetir a ordem)
  update public.dre_modelo_linhas set ordem = -1 where id = v.id;
  update public.dre_modelo_linhas set ordem = v.ordem where id = w.id;
  update public.dre_modelo_linhas set ordem = w.ordem where id = v.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Excluir conta: também move os ajustes; uso conta os ajustes.
-- -----------------------------------------------------------------------------
create or replace function public.categoria_financeira_uso(p_categoria_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v public.categorias_financeiras;
begin
  select * into v from public.categorias_financeiras where id = p_categoria_id;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'lancamentos', (select count(*) from public.lancamentos where categoria_id = v.id),
    'recorrencias', (select count(*) from public.recorrencias where categoria_id = v.id),
    'ajustes', (select count(*) from public.dre_ajustes where categoria_id = v.id),
    'meses_fechados', coalesce((
      select jsonb_agg(m order by m) from (
        select distinct to_char(l.data_competencia, 'YYYY-MM') as m
          from public.lancamentos l
         where l.categoria_id = v.id and app.competencia_fechada(l.empresa_id, l.data_competencia)
        union
        select distinct to_char(a.competencia, 'YYYY-MM')
          from public.dre_ajustes a
         where a.categoria_id = v.id and app.competencia_fechada(a.empresa_id, a.competencia)
      ) x), '[]'::jsonb),
    'contas_no_grupo', (select count(*) from public.categorias_financeiras where pai_id = v.id),
    'sistema', v.codigo_sistema is not null,
    'grupo', v.sintetica
  );
end;
$$;

create or replace function public.excluir_categoria_financeira(p_categoria_id uuid, p_destino_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.categorias_financeiras;
  d public.categorias_financeiras;
  v_lanc int;
  v_rec int;
  v_aj int;
  v_filhos int;
  v_mes text;
begin
  select * into v from public.categorias_financeiras where id = p_categoria_id;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'P0002';
  end if;
  if not (v.empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[])) then
    raise exception 'Você não tem permissão para editar o plano de contas desta empresa.' using errcode = '42501';
  end if;
  if v.codigo_sistema is not null then
    raise exception 'A conta "%" é usada automaticamente pelo sistema. Você pode renomeá-la ou desativá-la, mas não excluí-la.', v.nome;
  end if;
  if p_destino_id = p_categoria_id then
    raise exception 'Escolha outra conta para receber os lançamentos.';
  end if;

  if v.sintetica then
    if p_destino_id is not null then
      select * into d from public.categorias_financeiras where id = p_destino_id and empresa_id = v.empresa_id;
      if not found or not d.sintetica then
        raise exception 'Escolha um grupo para receber as contas.';
      end if;
    end if;
    update public.categorias_financeiras set pai_id = p_destino_id where pai_id = v.id and empresa_id = v.empresa_id;
    get diagnostics v_filhos = row_count;
    delete from public.categorias_financeiras where id = v.id;
    return jsonb_build_object('contas_movidas', v_filhos, 'lancamentos_movidos', 0, 'recorrencias_movidas', 0, 'ajustes_movidos', 0);
  end if;

  select count(*) into v_lanc from public.lancamentos where categoria_id = v.id;
  select count(*) into v_rec from public.recorrencias where categoria_id = v.id;
  select count(*) into v_aj from public.dre_ajustes where categoria_id = v.id;
  if v_lanc + v_rec + v_aj > 0 then
    if p_destino_id is null then
      raise exception 'A conta "%" tem % lançamento(s). Escolha a conta que vai recebê-los.', v.nome, v_lanc + v_rec + v_aj;
    end if;
    select * into d from public.categorias_financeiras where id = p_destino_id and empresa_id = v.empresa_id;
    if not found or d.sintetica then
      raise exception 'Escolha uma conta (não um grupo) para receber os lançamentos.';
    end if;
    if not d.ativa then
      raise exception 'A conta "%" está desativada. Escolha uma conta ativa.', d.nome;
    end if;
    if d.natureza <> v.natureza then
      raise exception 'Escolha uma conta de %, como a conta que será excluída.', v.natureza;
    end if;
    if v_aj > 0 and d.tipo not in ('receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
                                   'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro') then
      raise exception 'A conta tem ajustes no resultado. Escolha uma conta que aparece no DRE.';
    end if;
    select to_char(min(m), 'MM/YYYY') into v_mes from (
      select l.data_competencia as m from public.lancamentos l
       where l.categoria_id = v.id and app.competencia_fechada(l.empresa_id, l.data_competencia)
      union all
      select a.competencia from public.dre_ajustes a
       where a.categoria_id = v.id and app.competencia_fechada(a.empresa_id, a.competencia)
    ) x;
    if v_mes is not null then
      raise exception 'A conta "%" tem lançamentos em meses já fechados pelo escritório (a partir de %). Ela não pode ser excluída; desative-a para não aparecer nos próximos lançamentos.', v.nome, v_mes;
    end if;
    update public.lancamentos set categoria_id = d.id where categoria_id = v.id and empresa_id = v.empresa_id;
    update public.recorrencias set categoria_id = d.id where categoria_id = v.id and empresa_id = v.empresa_id;
    if v_aj > 0 then
      -- Ajuste não se altera pela tela; aqui a troca de conta é feita pelo sistema
      perform set_config('app.contexto', 'mover_ajustes', true);
      update public.dre_ajustes set categoria_id = d.id where categoria_id = v.id and empresa_id = v.empresa_id;
      perform set_config('app.contexto', '', true);
    end if;
  end if;
  delete from public.categorias_financeiras where id = v.id;
  return jsonb_build_object('contas_movidas', 0, 'lancamentos_movidos', v_lanc, 'recorrencias_movidas', v_rec, 'ajustes_movidos', v_aj);
end;
$$;

-- -----------------------------------------------------------------------------
-- Relatórios: ajustes entram no DRE (sem filtro de centro de custo/projeto)
-- -----------------------------------------------------------------------------
create or replace function public.relatorio_dre_linhas(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_centro_custo_id uuid default null,
  p_projeto_id uuid default null
)
returns table (
  mes date,
  origem text,
  categoria_id uuid,
  categoria_codigo text,
  categoria_nome text,
  tipo text,
  valor numeric,
  quantidade bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Lançamentos por competência
  select date_trunc('month', l.data_competencia)::date as mes,
         'lancamento' as origem,
         c.id, c.codigo, c.nome, c.tipo,
         sum(l.valor_previsto) as valor,
         count(*) as quantidade
    from public.lancamentos l
    join public.categorias_financeiras c on c.id = l.categoria_id
   where l.empresa_id = p_empresa_id
     and l.status_revisao = 'confirmado'
     and l.situacao <> 'cancelado'
     and l.data_competencia between p_inicio and p_fim
     and c.tipo in ('receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
                    'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro')
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
     and (p_projeto_id is null or l.projeto_id = p_projeto_id)
   group by 1, 2, 3, 4, 5, 6
  union all
  -- Ajustes das baixas (juros, multas, descontos e taxas) pela data do pagamento
  select date_trunc('month', a.data_pagamento)::date,
         'ajuste_baixa',
         c.id, c.codigo, c.nome, c.tipo,
         sum(a.valor), count(*)
    from (
      select b.empresa_id, b.data_pagamento, l.centro_custo_id, l.projeto_id,
             case
               when x.componente = 'juros' and b.tipo = 'receber' then 'JUROS_RECEBIDOS'
               when x.componente = 'juros' and b.tipo = 'pagar' then 'JUROS_PAGOS'
               when x.componente = 'desconto' and b.tipo = 'receber' then 'DESCONTOS_CONCEDIDOS'
               when x.componente = 'desconto' and b.tipo = 'pagar' then 'DESCONTOS_OBTIDOS'
               when x.componente = 'taxas' and b.tipo = 'receber' then 'TAXAS_CARTAO'
               else 'TARIFAS_BANCARIAS'
             end as codigo_sistema,
             x.valor
        from public.baixas b
        join public.lancamentos l on l.id = b.lancamento_id
        cross join lateral (values ('juros', b.juros + b.multa), ('desconto', b.desconto), ('taxas', b.taxas)) as x(componente, valor)
       where b.empresa_id = p_empresa_id
         and b.data_pagamento between p_inicio and p_fim
         and x.valor > 0
         and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
         and (p_projeto_id is null or l.projeto_id = p_projeto_id)
    ) a
    join public.categorias_financeiras c on c.empresa_id = a.empresa_id and c.codigo_sistema = a.codigo_sistema
   group by 1, 2, 3, 4, 5, 6
  union all
  -- Ajustes no resultado (só competência)
  select aj.competencia, 'ajuste_resultado', c.id, c.codigo, c.nome, c.tipo, sum(aj.valor), count(*)
    from public.dre_ajustes aj
    join public.categorias_financeiras c on c.id = aj.categoria_id
   where aj.empresa_id = p_empresa_id
     and aj.competencia between date_trunc('month', p_inicio)::date and p_fim
     and p_centro_custo_id is null and p_projeto_id is null
   group by 1, 2, 3, 4, 5, 6;
$$;

drop function public.relatorio_dre_composicao(uuid, date, date, text[], uuid, uuid);
create function public.relatorio_dre_composicao(
  p_empresa_id uuid,
  p_inicio date,
  p_fim date,
  p_tipos text[],
  p_categoria_id uuid default null,
  p_centro_custo_id uuid default null,
  p_categorias uuid[] default null
)
returns table (
  origem text,
  lancamento_id uuid,
  baixa_id uuid,
  data date,
  descricao text,
  categoria_nome text,
  tipo_categoria text,
  contraparte text,
  valor numeric,
  ajuste_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'lancamento', l.id, null::uuid, l.data_competencia, l.descricao, c.nome, c.tipo, cp.nome, l.valor_previsto, null::uuid
    from public.lancamentos l
    join public.categorias_financeiras c on c.id = l.categoria_id
    left join public.contrapartes cp on cp.id = l.contraparte_id
   where l.empresa_id = p_empresa_id
     and l.status_revisao = 'confirmado' and l.situacao <> 'cancelado'
     and l.data_competencia between p_inicio and p_fim
     and c.tipo = any(p_tipos)
     and (p_categoria_id is null or c.id = p_categoria_id)
     and (p_categorias is null or c.id = any(p_categorias))
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
  union all
  select 'ajuste_baixa', l.id, b.id, b.data_pagamento,
         l.descricao || ' — ' || x.rotulo, c.nome, c.tipo, cp.nome, x.valor, null::uuid
    from public.baixas b
    join public.lancamentos l on l.id = b.lancamento_id
    left join public.contrapartes cp on cp.id = l.contraparte_id
    cross join lateral (values
      ('juros/multa', b.juros + b.multa, case when b.tipo = 'receber' then 'JUROS_RECEBIDOS' else 'JUROS_PAGOS' end),
      ('desconto', b.desconto, case when b.tipo = 'receber' then 'DESCONTOS_CONCEDIDOS' else 'DESCONTOS_OBTIDOS' end),
      ('taxas', b.taxas, case when b.tipo = 'receber' then 'TAXAS_CARTAO' else 'TARIFAS_BANCARIAS' end)
    ) as x(rotulo, valor, codigo_sistema)
    join public.categorias_financeiras c on c.empresa_id = b.empresa_id and c.codigo_sistema = x.codigo_sistema
   where b.empresa_id = p_empresa_id
     and b.data_pagamento between p_inicio and p_fim
     and x.valor > 0
     and c.tipo = any(p_tipos)
     and (p_categoria_id is null or c.id = p_categoria_id)
     and (p_categorias is null or c.id = any(p_categorias))
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
  union all
  select 'ajuste_resultado', null::uuid, null::uuid, aj.competencia, 'Ajuste: ' || aj.motivo, c.nome, c.tipo, null::text, aj.valor, aj.id
    from public.dre_ajustes aj
    join public.categorias_financeiras c on c.id = aj.categoria_id
   where aj.empresa_id = p_empresa_id
     and aj.competencia between date_trunc('month', p_inicio)::date and p_fim
     and p_centro_custo_id is null
     and c.tipo = any(p_tipos)
     and (p_categoria_id is null or c.id = p_categoria_id)
     and (p_categorias is null or c.id = any(p_categorias))
   order by 4, 5;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.dre_modelo_linhas enable row level security;
alter table public.dre_ajustes enable row level security;

create policy dre_modelo_linhas_leitura on public.dre_modelo_linhas for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy dre_modelo_linhas_insercao on public.dre_modelo_linhas for insert to authenticated
  with check (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]));
create policy dre_modelo_linhas_alteracao on public.dre_modelo_linhas for update to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]))
  with check (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]));
-- Linhas do padrão só saem com "voltar ao padrão"
create policy dre_modelo_linhas_exclusao on public.dre_modelo_linhas for delete to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]) and chave_padrao is null);

create policy dre_ajustes_leitura on public.dre_ajustes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy dre_ajustes_insercao on public.dre_ajustes for insert to authenticated
  with check (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]));
create policy dre_ajustes_exclusao on public.dre_ajustes for delete to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]));
-- Troca de conta feita só pela exclusão de conta (função acima)
create policy dre_ajustes_troca_conta on public.dre_ajustes for update to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]) and current_setting('app.contexto', true) = 'mover_ajustes')
  with check (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]));

revoke all on public.dre_modelo_linhas, public.dre_ajustes from anon, authenticated;
grant select on public.dre_modelo_linhas, public.dre_ajustes to authenticated;
grant insert (empresa_id, ordem, tipo, rotulo, mostrar_contas, oculta, destaque),
      update (rotulo, ordem, mostrar_contas, oculta, destaque),
      delete
  on public.dre_modelo_linhas to authenticated;
grant insert (empresa_id, categoria_id, competencia, valor, motivo), delete on public.dre_ajustes to authenticated;
grant update (categoria_id) on public.dre_ajustes to authenticated;
grant insert (dre_linha_id), update (dre_linha_id) on public.categorias_financeiras to authenticated;

revoke all on function public.personalizar_dre(uuid) from public, anon;
revoke all on function public.restaurar_dre_padrao(uuid) from public, anon;
revoke all on function public.inserir_linha_dre(uuid, text, text, uuid) from public, anon;
revoke all on function public.mover_linha_dre(uuid, int) from public, anon;
revoke all on function public.relatorio_dre_composicao(uuid, date, date, text[], uuid, uuid, uuid[]) from public, anon;
grant execute on function public.personalizar_dre(uuid) to authenticated;
grant execute on function public.restaurar_dre_padrao(uuid) to authenticated;
grant execute on function public.inserir_linha_dre(uuid, text, text, uuid) to authenticated;
grant execute on function public.mover_linha_dre(uuid, int) to authenticated;
grant execute on function public.relatorio_dre_composicao(uuid, date, date, text[], uuid, uuid, uuid[]) to authenticated;
