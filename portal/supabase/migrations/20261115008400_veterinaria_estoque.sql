-- Clínica veterinária: o que é usado no atendimento sai do estoque.
--  * Medicamentos e materiais usados no atendimento (ex.: 2,5 mL de um frasco
--    de 50 mL), com baixa fracionada no estoque do pet shop e farmácia e, se a
--    clínica quiser, cobrança na conta do tutor.
--  * Vacina do catálogo ligada a um produto: cada aplicação na clínica tira
--    1 dose do estoque; cancelar a vacina devolve.
--  * O ato clínico nunca é barrado pelo estoque: sem saldo, o estoque fica
--    negativo e a loja mostra o aviso para conferir.

-- -----------------------------------------------------------------------------
-- 1. Novos movimentos de estoque
-- -----------------------------------------------------------------------------
alter table public.estoque_movimentos drop constraint estoque_movimentos_tipo_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_check check (tipo in (
  'entrada_compra', 'entrada_manual', 'saida_manual', 'inventario', 'venda', 'cancelamento_venda', 'consumo_hotel', 'estorno_consumo_hotel',
  'uso_clinica', 'estorno_uso_clinica'
));

-- -----------------------------------------------------------------------------
-- 2. Vacina do catálogo ligada ao produto do estoque (1 dose por aplicação)
-- -----------------------------------------------------------------------------
alter table public.vet_vacinas add column produto_id uuid references public.nfe_produtos(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. Usos de produto (atendimento ou vacina aplicada)
-- -----------------------------------------------------------------------------
create table public.vet_usos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paciente_id uuid not null,
  atendimento_id uuid,
  -- Uso automático da vacina aplicada (sai e volta junto com o registro da vacina)
  vacinacao_id uuid,
  produto_id uuid not null references public.nfe_produtos(id) on delete restrict,
  descricao text not null check (length(trim(descricao)) between 1 and 200),
  quantidade numeric(18, 4) not null check (quantidade > 0 and quantidade <= 100000),
  unidade text not null check (length(unidade) between 1 and 6),
  -- Custo médio do produto na hora do uso (custo do atendimento)
  custo_unitario numeric(18, 6),
  -- Cobrado na conta do tutor
  conta_item_id uuid references public.vet_conta_itens(id) on delete set null,
  observacao text check (observacao is null or length(observacao) <= 300),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  lancado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vet_usos_origem check (atendimento_id is not null or vacinacao_id is not null),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id),
  foreign key (empresa_id, vacinacao_id) references public.vet_vacinacoes (empresa_id, id)
);
create index vet_usos_atendimento_idx on public.vet_usos (atendimento_id) where atendimento_id is not null;
create index vet_usos_vacinacao_idx on public.vet_usos (vacinacao_id) where vacinacao_id is not null;
create index vet_usos_paciente_idx on public.vet_usos (empresa_id, paciente_id, created_at);
create trigger auditoria_vet_usos after insert or update or delete on public.vet_usos for each row execute function app.tg_auditoria();
alter table public.vet_usos enable row level security;
create policy vet_usos_leitura on public.vet_usos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
grant select on public.vet_usos to authenticated;
grant select, insert, update, delete on public.vet_usos to service_role;

-- -----------------------------------------------------------------------------
-- 4. Baixa e estorno (internos)
-- -----------------------------------------------------------------------------
create or replace function app.vet_uso_baixar(
  p_empresa_id uuid, p_paciente_id uuid, p_atendimento_id uuid, p_vacinacao_id uuid, p_produto_id uuid, p_quantidade numeric, p_observacao text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.nfe_produtos;
  v_animal text;
  v_numero bigint;
  v_id uuid;
begin
  select * into v_p from public.nfe_produtos where id = p_produto_id and empresa_id = p_empresa_id;
  if v_p.id is null then
    raise exception 'Produto não encontrado.';
  end if;
  select nome into v_animal from public.vet_pacientes where id = p_paciente_id;
  select numero into v_numero from public.vet_atendimentos where id = p_atendimento_id;
  -- O ato clínico não é barrado pelo estoque (sem saldo, fica negativo para conferir)
  perform app.estoque_movimentar(
    p_empresa_id, v_p.id, 'uso_clinica', -p_quantidade, null, null, null,
    left(concat_ws(' — ', case when v_numero is not null then 'Atendimento nº ' || v_numero end,
                   case when p_vacinacao_id is not null then 'Vacina aplicada' end, v_animal), 500),
    true
  );
  insert into public.vet_usos (empresa_id, paciente_id, atendimento_id, vacinacao_id, produto_id, descricao, quantidade, unidade, custo_unitario, observacao)
  values (p_empresa_id, p_paciente_id, p_atendimento_id, p_vacinacao_id, v_p.id, left(v_p.descricao, 200), p_quantidade, v_p.unidade,
          (select custo_medio from public.nfe_produtos where id = v_p.id), nullif(trim(p_observacao), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.vet_uso_estornar(p_uso_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.vet_usos;
begin
  select * into u from public.vet_usos where id = p_uso_id for update;
  if u.id is null or u.cancelado_em is not null then
    return;
  end if;
  update public.vet_usos set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300) where id = u.id;
  perform app.estoque_movimentar(u.empresa_id, u.produto_id, 'estorno_uso_clinica', u.quantidade, null, null, null,
    left('Uso cancelado: ' || trim(p_motivo), 500), true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Vacina aplicada na clínica tira 1 dose do produto ligado; cancelar devolve
-- -----------------------------------------------------------------------------
create or replace function app.tg_vet_vacinacao_estoque()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produto uuid;
  u record;
begin
  if tg_op = 'INSERT' then
    if new.origem = 'clinica' and new.vacina_id is not null then
      select produto_id into v_produto from public.vet_vacinas where id = new.vacina_id;
      if v_produto is not null then
        perform app.vet_uso_baixar(new.empresa_id, new.paciente_id, new.atendimento_id, new.id, v_produto, 1, null);
      end if;
    end if;
  elsif old.cancelada_em is null and new.cancelada_em is not null then
    for u in select id from public.vet_usos where vacinacao_id = new.id and cancelado_em is null loop
      perform app.vet_uso_estornar(u.id, coalesce('Vacina cancelada: ' || new.cancelada_motivo, 'Vacina cancelada'));
    end loop;
  end if;
  return null;
end;
$$;
create trigger vet_vacinacoes_estoque after insert or update of cancelada_em on public.vet_vacinacoes
  for each row execute function app.tg_vet_vacinacao_estoque();

-- -----------------------------------------------------------------------------
-- 6. Funções do portal
-- -----------------------------------------------------------------------------

-- Produto e quantidade usados no atendimento (recepção ou veterinário), com cobrança opcional na conta
create or replace function public.vet_uso_registrar(p_atendimento_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  v_p public.nfe_produtos;
  v_qtd numeric := app.vet_numero(p_dados, 'quantidade', 'quantidade');
  v_valor numeric := app.vet_numero(p_dados, 'valor', 'valor');
  v_cobrar boolean := coalesce((p_dados ->> 'cobrar')::boolean, false);
  v_id uuid;
  v_conta uuid;
  v_item uuid;
begin
  select * into at from public.vet_atendimentos where id = p_atendimento_id;
  if at.id is null then
    raise exception 'Atendimento não encontrado.';
  end if;
  perform app.exigir_vet(at.empresa_id, 'gestao.vender');
  if at.status = 'cancelado' then
    raise exception 'Este atendimento foi cancelado.';
  end if;
  select * into v_p from public.nfe_produtos
   where id = nullif(p_dados ->> 'produto_id', '')::uuid and empresa_id = at.empresa_id and ativo;
  if v_p.id is null then
    raise exception 'Escolha o produto.';
  end if;
  if v_qtd is null or v_qtd <= 0 or v_qtd > 100000 or v_qtd <> round(v_qtd, 4) then
    raise exception 'Informe a quantidade usada (até 4 casas depois da vírgula).';
  end if;

  v_id := app.vet_uso_baixar(at.empresa_id, at.paciente_id, at.id, null, v_p.id, v_qtd, app.vet_texto(p_dados, 'observacao', 300));

  if v_cobrar then
    v_valor := coalesce(v_valor, round(v_qtd * coalesce(v_p.valor_unitario, 0), 2));
    if v_valor <= 0 then
      raise exception 'O produto não tem preço de venda: informe o valor a cobrar.';
    end if;
    if v_valor <> round(v_valor, 2) then
      raise exception 'Valor inválido.';
    end if;
    v_conta := public.vet_conta_abrir(at.empresa_id, jsonb_build_object('atendimento_id', at.id));
    v_item := public.vet_conta_item_lancar(v_conta, jsonb_build_object(
      'descricao', left(v_p.descricao, 100) || ' — ' || app.gestao_qtd(v_qtd) || ' ' || lower(v_p.unidade),
      'quantidade', 1,
      'valor_unitario', v_valor
    ));
    update public.vet_usos set conta_item_id = v_item where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Lançado por engano: volta ao estoque e sai da conta (se a conta ainda estiver aberta)
create or replace function public.vet_uso_cancelar(p_uso_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.vet_usos;
begin
  select * into u from public.vet_usos where id = p_uso_id;
  if u.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  perform app.exigir_vet(u.empresa_id, 'gestao.vender');
  if u.cancelado_em is not null then
    raise exception 'Este lançamento já foi cancelado.';
  end if;
  if u.vacinacao_id is not null then
    raise exception 'Esta baixa é da vacina aplicada: cancele o registro da vacina.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  if u.conta_item_id is not null and exists (select 1 from public.vet_conta_itens where id = u.conta_item_id and cancelado_em is null) then
    perform public.vet_conta_item_cancelar(u.conta_item_id, p_motivo);
  end if;
  perform app.vet_uso_estornar(u.id, p_motivo);
end;
$$;

-- Liga (ou desliga) a vacina do catálogo a um produto do estoque
create or replace function public.vet_vacina_produto_definir(p_vacina_id uuid, p_produto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vet_vacinas;
begin
  select * into v from public.vet_vacinas where id = p_vacina_id;
  if v.id is null then
    raise exception 'Vacina não encontrada.';
  end if;
  perform app.exigir_vet(v.empresa_id, 'gestao.gerenciar');
  if p_produto_id is not null and not exists (select 1 from public.nfe_produtos where id = p_produto_id and empresa_id = v.empresa_id and ativo) then
    raise exception 'Produto não encontrado.';
  end if;
  update public.vet_vacinas set produto_id = p_produto_id where id = v.id;
end;
$$;

revoke execute on function app.vet_uso_baixar(uuid, uuid, uuid, uuid, uuid, numeric, text), app.vet_uso_estornar(uuid, text),
  app.tg_vet_vacinacao_estoque() from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array['public.vet_uso_registrar(uuid, jsonb)', 'public.vet_uso_cancelar(uuid, text)', 'public.vet_vacina_produto_definir(uuid, uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
