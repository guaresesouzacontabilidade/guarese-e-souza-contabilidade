-- Vendedores da loja e comissões.
--
-- * Cadastro de vendedores por empresa (nome, comissão em %, ativo e, se o
--   vendedor tiver login próprio, o acesso ligado). Vários vendedores podem
--   usar o mesmo login do balcão: o vendedor é escolhido no orçamento e na venda.
-- * vendas.loja_vendedor_id: no orçamento e na venda. Quando não vem escolhido,
--   vale o do orçamento (na conversão) e, depois, o vendedor ligado a quem está
--   logado. A empresa pode exigir o vendedor (gestao_config.vendedor_obrigatorio).
-- * venda_comissoes: o % do vendedor fica gravado na venda (mudar o % depois não
--   mexe nas vendas antigas). Base = produtos com desconto, sem o frete. Venda
--   cancelada não entra no relatório. Cada vendedor com login vê só as dele;
--   quem gerencia a loja vê todas.
-- * Trocar o vendedor de uma venda: só quem gerencia a loja, com motivo, e fica
--   no histórico (venda_vendedor_trocas). Não troca se a comissão já foi lançada.
-- * Lançar as comissões de um período no Contas a pagar: um título por
--   vendedor; cada venda só é lançada uma vez.

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

-- -----------------------------------------------------------------------------
-- 1. Cadastro de vendedores
-- -----------------------------------------------------------------------------
create table public.loja_vendedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  comissao_percentual numeric(5, 2) not null default 0 check (comissao_percentual between 0 and 100),
  ativo boolean not null default true,
  usuario_id uuid references public.perfis (id) on delete set null,
  criado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loja_vendedores_empresa_id_unico unique (empresa_id, id)
);
create unique index loja_vendedores_nome_uk on public.loja_vendedores (empresa_id, lower(trim(nome)));
create unique index loja_vendedores_usuario_uk on public.loja_vendedores (empresa_id, usuario_id) where usuario_id is not null;
create trigger loja_vendedores_updated_at before update on public.loja_vendedores for each row execute function app.tg_updated_at();
create trigger auditoria_loja_vendedores after insert or update or delete on public.loja_vendedores for each row execute function app.tg_auditoria();

-- O login ligado precisa ter acesso à empresa
create function app.tg_loja_vendedores_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.nome := trim(new.nome);
  if new.usuario_id is not null and (tg_op = 'INSERT' or new.usuario_id is distinct from old.usuario_id) then
    if not exists (
      select 1 from public.empresa_membros m where m.empresa_id = new.empresa_id and m.user_id = new.usuario_id and m.ativo
    ) then
      raise exception 'Esse acesso não pertence a esta empresa.';
    end if;
  end if;
  return new;
end;
$$;
create trigger loja_vendedores_regras before insert or update on public.loja_vendedores for each row execute function app.tg_loja_vendedores_regras();

alter table public.loja_vendedores enable row level security;
create policy loja_vendedores_leitura on public.loja_vendedores for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]) or usuario_id = (select auth.uid()));
create policy loja_vendedores_inserir on public.loja_vendedores for insert to authenticated
  with check (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
create policy loja_vendedores_alterar on public.loja_vendedores for update to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]))
  with check (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
create policy loja_vendedores_excluir on public.loja_vendedores for delete to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));
grant select, insert, update, delete on public.loja_vendedores to authenticated;

alter table public.gestao_config add column vendedor_obrigatorio boolean not null default false;

-- -----------------------------------------------------------------------------
-- 2. Vendedor no orçamento e na venda
-- -----------------------------------------------------------------------------
alter table public.vendas add column loja_vendedor_id uuid;
alter table public.vendas add constraint vendas_loja_vendedor_fk foreign key (empresa_id, loja_vendedor_id)
  references public.loja_vendedores (empresa_id, id);
create index vendas_loja_vendedor_idx on public.vendas (loja_vendedor_id, data) where loja_vendedor_id is not null;

-- Escolhe e confere o vendedor: o informado, o do orçamento (na conversão) ou o
-- ligado a quem está logado; recusa vendedor inativo ou de outra empresa e, se a
-- empresa exige, recusa orçamento ou venda sem vendedor (o pedido do site fica de fora).
create function app.tg_vendas_vendedor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vend public.loja_vendedores;
  v_obrig boolean;
begin
  if tg_op = 'INSERT' and new.loja_vendedor_id is null then
    if new.orcamento_id is not null then
      select o.loja_vendedor_id into new.loja_vendedor_id from public.vendas o where o.id = new.orcamento_id;
    end if;
    if new.loja_vendedor_id is null and auth.uid() is not null then
      select v.id into new.loja_vendedor_id from public.loja_vendedores v
       where v.empresa_id = new.empresa_id and v.usuario_id = auth.uid() and v.ativo;
    end if;
  end if;
  if new.loja_vendedor_id is not null and (tg_op = 'INSERT' or new.loja_vendedor_id is distinct from old.loja_vendedor_id) then
    select * into v_vend from public.loja_vendedores where id = new.loja_vendedor_id and empresa_id = new.empresa_id;
    if v_vend.id is null then
      raise exception 'Vendedor não encontrado nesta empresa.';
    end if;
    -- Na conversão do orçamento, um vendedor desativado depois continua valendo
    if not v_vend.ativo and not (tg_op = 'INSERT' and new.orcamento_id is not null
        and exists (select 1 from public.vendas o where o.id = new.orcamento_id and o.loja_vendedor_id = v_vend.id)) then
      raise exception 'O vendedor % está inativo.', v_vend.nome;
    end if;
  end if;
  if tg_op = 'INSERT' and new.loja_vendedor_id is null and auth.uid() is not null and coalesce(new.origem, '') <> 'site' then
    select c.vendedor_obrigatorio into v_obrig from public.gestao_config c where c.empresa_id = new.empresa_id;
    if coalesce(v_obrig, false) then
      raise exception 'Escolha o vendedor.';
    end if;
  end if;
  return new;
end;
$$;
create trigger vendas_vendedor before insert or update of loja_vendedor_id on public.vendas
  for each row execute function app.tg_vendas_vendedor();

-- O orçamento e a venda passam a receber o vendedor escolhido na tela
select pg_temp.trocar_no_corpo('public.gestao_orcamento_salvar(uuid, uuid, jsonb)',
$a$      subtotal, desconto, frete, total, observacao, entrega
    ) values ($a$,
$a$      subtotal, desconto, frete, total, observacao, entrega, loja_vendedor_id
    ) values ($a$);
select pg_temp.trocar_no_corpo('public.gestao_orcamento_salvar(uuid, uuid, jsonb)',
$a$      nullif(trim(p_dados ->> 'observacao'), ''), nullif(trim(p_dados ->> 'entrega'), '')
    ) returning id, numero into v_id, v_numero;$a$,
$a$      nullif(trim(p_dados ->> 'observacao'), ''), nullif(trim(p_dados ->> 'entrega'), ''),
      nullif(p_dados ->> 'loja_vendedor_id', '')::uuid
    ) returning id, numero into v_id, v_numero;$a$);
select pg_temp.trocar_no_corpo('public.gestao_orcamento_salvar(uuid, uuid, jsonb)',
$a$           observacao = nullif(trim(p_dados ->> 'observacao'), ''), entrega = nullif(trim(p_dados ->> 'entrega'), '')
     where id = p_id;$a$,
$a$           observacao = nullif(trim(p_dados ->> 'observacao'), ''), entrega = nullif(trim(p_dados ->> 'entrega'), ''),
           loja_vendedor_id = case when p_dados ? 'loja_vendedor_id' then nullif(p_dados ->> 'loja_vendedor_id', '')::uuid else loja_vendedor_id end
     where id = p_id;$a$);

select pg_temp.trocar_no_corpo('public.gestao_venda_finalizar(uuid, jsonb)',
$a$    subtotal, desconto, frete, total, troco, observacao, entrega
  ) values ($a$,
$a$    subtotal, desconto, frete, total, troco, observacao, entrega, loja_vendedor_id
  ) values ($a$);
select pg_temp.trocar_no_corpo('public.gestao_venda_finalizar(uuid, jsonb)',
$a$    nullif(trim(p_dados ->> 'observacao'), ''), nullif(trim(p_dados ->> 'entrega'), '')
  ) returning id into v_id;$a$,
$a$    nullif(trim(p_dados ->> 'observacao'), ''), nullif(trim(p_dados ->> 'entrega'), ''),
    nullif(p_dados ->> 'loja_vendedor_id', '')::uuid
  ) returning id into v_id;$a$);

-- Vendedores para escolher no caixa e no orçamento e para mostrar o nome na
-- venda (sem o % de comissão, que só quem gerencia vê)
create function public.loja_vendedores_lista(p_empresa_id uuid)
returns table (id uuid, nome text, ativo boolean, meu boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  return query
    select v.id, v.nome, v.ativo, coalesce(v.usuario_id = auth.uid(), false)
      from public.loja_vendedores v
     where v.empresa_id = p_empresa_id
     order by v.ativo desc, lower(v.nome);
end;
$$;
revoke all on function public.loja_vendedores_lista(uuid) from public, anon;
grant execute on function public.loja_vendedores_lista(uuid) to authenticated;

create function public.loja_vendedor_obrigatorio_definir(p_empresa_id uuid, p_obrigatorio boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  update public.gestao_config set vendedor_obrigatorio = coalesce(p_obrigatorio, false), atualizado_por = auth.uid()
   where empresa_id = p_empresa_id;
end;
$$;
revoke all on function public.loja_vendedor_obrigatorio_definir(uuid, boolean) from public, anon;
grant execute on function public.loja_vendedor_obrigatorio_definir(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Comissões
-- -----------------------------------------------------------------------------
alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha',
  'cartao', 'venda', 'hotel', 'veterinaria', 'fisioterapia', 'os', 'renegociacao', 'comissao'
));

create table public.venda_comissoes (
  venda_id uuid primary key,
  empresa_id uuid not null,
  loja_vendedor_id uuid not null,
  percentual numeric(5, 2) not null check (percentual between 0 and 100),
  base numeric(15, 2) not null check (base >= 0),
  valor numeric(15, 2) generated always as (round(base * percentual / 100, 2)) stored,
  lancamento_id uuid references public.lancamentos (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (empresa_id, venda_id) references public.vendas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, loja_vendedor_id) references public.loja_vendedores (empresa_id, id)
);
create index venda_comissoes_vendedor_idx on public.venda_comissoes (empresa_id, loja_vendedor_id);
create index venda_comissoes_lancamento_idx on public.venda_comissoes (lancamento_id) where lancamento_id is not null;
alter table public.venda_comissoes enable row level security;
create policy venda_comissoes_leitura on public.venda_comissoes for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[])
    or loja_vendedor_id in (select v.id from public.loja_vendedores v where v.usuario_id = (select auth.uid()))
  );
grant select on public.venda_comissoes to authenticated;

-- A comissão nasce com a venda (o % do vendedor naquele momento) e acompanha
-- a troca de vendedor; base = produtos com desconto, sem frete.
create function app.tg_vendas_comissao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pct numeric(5, 2);
begin
  if new.tipo <> 'venda' then
    return null;
  end if;
  if new.loja_vendedor_id is null then
    delete from public.venda_comissoes where venda_id = new.id and lancamento_id is null;
    return null;
  end if;
  if tg_op = 'INSERT' or new.loja_vendedor_id is distinct from old.loja_vendedor_id then
    select v.comissao_percentual into v_pct from public.loja_vendedores v where v.id = new.loja_vendedor_id;
    insert into public.venda_comissoes (venda_id, empresa_id, loja_vendedor_id, percentual, base)
    values (new.id, new.empresa_id, new.loja_vendedor_id, coalesce(v_pct, 0), greatest(new.subtotal - new.desconto, 0))
    on conflict (venda_id) do update
      set loja_vendedor_id = excluded.loja_vendedor_id, percentual = excluded.percentual, base = excluded.base;
  else
    update public.venda_comissoes set base = greatest(new.subtotal - new.desconto, 0) where venda_id = new.id;
  end if;
  return null;
end;
$$;
create trigger vendas_comissao after insert or update of loja_vendedor_id, subtotal, desconto on public.vendas
  for each row execute function app.tg_vendas_comissao();

-- Histórico das trocas de vendedor
create table public.venda_vendedor_trocas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  venda_id uuid not null,
  de_vendedor_id uuid,
  para_vendedor_id uuid not null,
  motivo text not null check (length(trim(motivo)) between 3 and 300),
  trocado_por uuid references public.perfis (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, venda_id) references public.vendas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, de_vendedor_id) references public.loja_vendedores (empresa_id, id),
  foreign key (empresa_id, para_vendedor_id) references public.loja_vendedores (empresa_id, id)
);
create index venda_vendedor_trocas_venda_idx on public.venda_vendedor_trocas (venda_id, created_at);
alter table public.venda_vendedor_trocas enable row level security;
create policy venda_vendedor_trocas_leitura on public.venda_vendedor_trocas for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
grant select on public.venda_vendedor_trocas to authenticated;

create function public.loja_venda_trocar_vendedor(p_venda_id uuid, p_vendedor_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if v.id is null then
    raise exception 'Venda não encontrada.';
  end if;
  perform app.exigir_gestao(v.empresa_id, 'gestao.gerenciar');
  if v.status = 'cancelada' then
    raise exception 'Não dá para trocar o vendedor de uma venda ou orçamento cancelado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo da troca de vendedor.';
  end if;
  if v.loja_vendedor_id is not distinct from p_vendedor_id then
    raise exception 'Esse já é o vendedor desta venda.';
  end if;
  if exists (select 1 from public.venda_comissoes c where c.venda_id = v.id and c.lancamento_id is not null) then
    raise exception 'A comissão desta venda já foi lançada no Contas a pagar. Exclua ou cancele aquele lançamento antes de trocar o vendedor.';
  end if;
  update public.vendas set loja_vendedor_id = p_vendedor_id where id = v.id;
  insert into public.venda_vendedor_trocas (empresa_id, venda_id, de_vendedor_id, para_vendedor_id, motivo)
  values (v.empresa_id, v.id, v.loja_vendedor_id, p_vendedor_id, left(trim(p_motivo), 300));
end;
$$;
revoke all on function public.loja_venda_trocar_vendedor(uuid, uuid, text) from public, anon;
grant execute on function public.loja_venda_trocar_vendedor(uuid, uuid, text) to authenticated;

-- Lança no Contas a pagar as comissões ainda não lançadas das vendas do período
-- (um título por vendedor). Cada venda só é lançada uma vez.
create function public.loja_comissoes_lancar(p_empresa_id uuid, p_inicio date, p_fim date, p_vencimento date, p_categoria_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_lanc uuid;
  v_qtd int := 0;
  v_total numeric(15, 2) := 0;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'Informe o período das vendas.';
  end if;
  if p_vencimento is null then
    raise exception 'Informe o vencimento do pagamento das comissões.';
  end if;
  if not exists (
    select 1 from public.categorias_financeiras c
     where c.id = p_categoria_id and c.empresa_id = p_empresa_id and c.natureza = 'despesa' and not c.sintetica and c.ativa
  ) then
    raise exception 'Escolha a conta de despesa das comissões.';
  end if;
  perform pg_advisory_xact_lock(hashtext('comissoes:' || p_empresa_id::text));

  for r in
    select c.loja_vendedor_id, lv.nome, sum(c.valor) as total, count(*) as qtd, array_agg(c.venda_id) as vendas
      from public.venda_comissoes c
      join public.vendas v on v.id = c.venda_id
      join public.loja_vendedores lv on lv.id = c.loja_vendedor_id
     where c.empresa_id = p_empresa_id and v.status = 'concluida' and v.data between p_inicio and p_fim
       and c.lancamento_id is null and c.valor > 0
     group by c.loja_vendedor_id, lv.nome
     order by lv.nome
  loop
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto, origem, status_revisao, observacoes
    ) values (
      p_empresa_id, 'pagar',
      left('Comissão de ' || r.nome || ' — vendas de ' || to_char(p_inicio, 'DD/MM/YYYY') || ' a ' || to_char(p_fim, 'DD/MM/YYYY'), 280),
      p_categoria_id, p_fim, p_vencimento, r.total, 'comissao', 'confirmado',
      r.qtd || ' venda(s) com comissão. Lançado pelo relatório de comissões da loja.'
    ) returning id into v_lanc;
    update public.venda_comissoes set lancamento_id = v_lanc where venda_id = any(r.vendas);
    v_qtd := v_qtd + 1;
    v_total := v_total + r.total;
  end loop;
  return jsonb_build_object('lancamentos', v_qtd, 'total', v_total);
end;
$$;
revoke all on function public.loja_comissoes_lancar(uuid, date, date, date, uuid) from public, anon;
grant execute on function public.loja_comissoes_lancar(uuid, date, date, date, uuid) to authenticated;
