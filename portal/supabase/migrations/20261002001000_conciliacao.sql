-- =============================================================================
-- Migração 1000: conciliação bancária
-- =============================================================================
-- * Sugestões automáticas ficam com status "sugerida" até confirmação humana.
-- * Uma movimentação (ou baixa) só pode estar em UMA conciliação confirmada.
-- * Confirmar uma conciliação com lançamentos em aberto cria as baixas
--   (pagamentos/recebimentos) na data e conta da movimentação — o lançamento
--   (e não a movimentação) é a fonte da receita/despesa: não há duplicidade.
-- * Desfazer remove somente o que a conciliação criou e fica no histórico.
-- =============================================================================

create table public.conciliacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  conta_financeira_id uuid,
  status text not null default 'sugerida' check (status in ('sugerida', 'confirmada', 'rejeitada', 'desfeita')),
  origem text not null default 'manual' check (origem in ('automatica', 'manual')),
  tipo text not null default 'lancamento' check (tipo in ('lancamento', 'baixa', 'transferencia', 'classificacao')),
  pontuacao int check (pontuacao between 0 and 100),
  criterios jsonb not null default '{}'::jsonb,
  diferenca numeric(15,2) not null default 0,
  tratamento_diferenca text check (tratamento_diferenca in ('juros', 'multa', 'desconto', 'taxa', 'parcial')),
  observacao text,
  lancamentos_criados uuid[] not null default array[]::uuid[],
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  confirmada_por uuid references public.perfis(id) on delete set null,
  confirmada_em timestamptz,
  rejeitada_por uuid references public.perfis(id) on delete set null,
  rejeitada_em timestamptz,
  motivo_rejeicao text,
  desfeita_por uuid references public.perfis(id) on delete set null,
  desfeita_em timestamptz,
  motivo_desfazer text,
  constraint conciliacoes_empresa_id_unico unique (empresa_id, id),
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id)
);
create index conciliacoes_empresa_status_idx on public.conciliacoes (empresa_id, status, created_at desc);
create trigger auditoria_conciliacoes after insert or update or delete on public.conciliacoes
  for each row execute function app.tg_auditoria();

create table public.conciliacao_itens (
  id uuid primary key default gen_random_uuid(),
  conciliacao_id uuid not null,
  empresa_id uuid not null,
  movimento_id uuid,
  lancamento_id uuid,
  baixa_id uuid,
  transferencia_id uuid,
  valor numeric(15,2) not null,     -- contribuição com sinal: + entrada, − saída
  ativo boolean not null default false,
  constraint conciliacao_itens_um_alvo check (num_nonnulls(movimento_id, lancamento_id, baixa_id, transferencia_id) >= 1),
  foreign key (empresa_id, conciliacao_id) references public.conciliacoes (empresa_id, id) on delete cascade,
  foreign key (empresa_id, movimento_id) references public.movimentos_bancarios (empresa_id, id) on delete cascade,
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, baixa_id) references public.baixas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, transferencia_id) references public.transferencias (empresa_id, id) on delete cascade
);
create index conciliacao_itens_conc_idx on public.conciliacao_itens (conciliacao_id);
create index conciliacao_itens_mov_idx on public.conciliacao_itens (movimento_id);
create index conciliacao_itens_lanc_idx on public.conciliacao_itens (lancamento_id);
create unique index conciliacao_itens_mov_ativo on public.conciliacao_itens (movimento_id) where ativo and movimento_id is not null;
create unique index conciliacao_itens_baixa_ativa on public.conciliacao_itens (baixa_id) where ativo and baixa_id is not null;

alter table public.baixas add constraint baixas_conciliacao_fk
  foreign key (empresa_id, conciliacao_id) references public.conciliacoes (empresa_id, id) on delete set null (conciliacao_id);
alter table public.transferencias add constraint transferencias_conciliacao_fk
  foreign key (empresa_id, conciliacao_id) references public.conciliacoes (empresa_id, id) on delete set null (conciliacao_id);

-- Pares rejeitados não voltam a ser sugeridos.
create table public.conciliacao_rejeicoes (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  movimento_id uuid not null,
  alvo_id uuid not null,
  rejeitada_por uuid references public.perfis(id) on delete set null default auth.uid(),
  rejeitada_em timestamptz not null default now(),
  primary key (movimento_id, alvo_id)
);

-- -----------------------------------------------------------------------------
-- Execução de uma conciliação (cria baixas/transferências conforme o caso)
-- -----------------------------------------------------------------------------
create or replace function app.executar_conciliacao(p_conciliacao_id uuid, p_tratamento text, p_conta_contrapartida uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conc public.conciliacoes;
  v_movs public.movimentos_bancarios[];
  v_mov public.movimentos_bancarios;
  v_lancs public.lancamentos[];
  v_lanc public.lancamentos;
  v_conta uuid;
  v_n_mov int;
  v_n_lanc int;
  v_n_baixa int;
  v_n_transf int;
  v_soma_mov numeric(15,2) := 0;
  v_soma_alvos numeric(15,2) := 0;
  v_caixa numeric(15,2);
  v_aberto numeric(15,2);
  v_dif numeric(15,2);
  v_sinal int;
  v_tipo text;
  v_restante numeric(15,2);
  v_principal numeric(15,2);
  v_aj_juros numeric(15,2);
  v_aj_multa numeric(15,2);
  v_aj_desc numeric(15,2);
  v_aj_taxa numeric(15,2);
  v_baixa_id uuid;
  v_transf_id uuid;
  i int;
  r record;
begin
  select * into v_conc from public.conciliacoes where id = p_conciliacao_id for update;

  select array_agg(m order by m.data, m.id) into v_movs
    from public.movimentos_bancarios m
    join public.conciliacao_itens ci on ci.movimento_id = m.id
   where ci.conciliacao_id = v_conc.id;
  v_n_mov := coalesce(cardinality(v_movs), 0);
  if v_n_mov = 0 then
    raise exception 'Selecione ao menos uma movimentação bancária.';
  end if;

  for i in 1..v_n_mov loop
    v_mov := v_movs[i];
    if v_mov.status_conciliacao <> 'pendente' then
      raise exception 'A movimentação de % (R$ %) já está conciliada ou ignorada.', to_char(v_mov.data, 'DD/MM/YYYY'), v_mov.valor;
    end if;
    v_soma_mov := v_soma_mov + v_mov.valor;
  end loop;

  select count(*) filter (where lancamento_id is not null),
         count(*) filter (where baixa_id is not null),
         count(*) filter (where transferencia_id is not null)
    into v_n_lanc, v_n_baixa, v_n_transf
    from public.conciliacao_itens where conciliacao_id = v_conc.id;

  -- ---------------------------------------------------- transferência entre contas
  if v_conc.tipo = 'transferencia' then
    if v_n_lanc + v_n_baixa > 0 then
      raise exception 'Transferências não podem ser conciliadas junto com lançamentos.';
    end if;
    if v_n_mov = 2 then
      if v_movs[1].conta_financeira_id = v_movs[2].conta_financeira_id then
        raise exception 'Uma transferência envolve duas contas diferentes.';
      end if;
      if v_movs[1].valor + v_movs[2].valor <> 0 then
        raise exception 'Os valores da saída e da entrada não conferem (diferença de R$ %).', abs(v_movs[1].valor + v_movs[2].valor);
      end if;
      insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor, descricao, origem, conciliacao_id)
      select v_conc.empresa_id,
             (case when v_movs[1].valor < 0 then v_movs[1] else v_movs[2] end).conta_financeira_id,
             (case when v_movs[1].valor > 0 then v_movs[1] else v_movs[2] end).conta_financeira_id,
             (case when v_movs[1].valor < 0 then v_movs[1] else v_movs[2] end).data,
             abs(v_movs[1].valor),
             coalesce(v_conc.observacao, 'Transferência entre contas'),
             'conciliacao', v_conc.id
      returning id into v_transf_id;
    elsif v_n_mov = 1 and v_n_transf = 0 then
      if p_conta_contrapartida is null then
        raise exception 'Informe a outra conta da transferência.';
      end if;
      v_mov := v_movs[1];
      insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor, descricao, origem, conciliacao_id)
      values (v_conc.empresa_id,
              case when v_mov.valor < 0 then v_mov.conta_financeira_id else p_conta_contrapartida end,
              case when v_mov.valor < 0 then p_conta_contrapartida else v_mov.conta_financeira_id end,
              v_mov.data, abs(v_mov.valor), coalesce(v_conc.observacao, 'Transferência entre contas'), 'conciliacao', v_conc.id)
      returning id into v_transf_id;
    elsif v_n_mov = 1 and v_n_transf = 1 then
      -- Transferência já registrada manualmente: confere o lado desta conta
      select t.* into r from public.transferencias t
        join public.conciliacao_itens ci on ci.transferencia_id = t.id
       where ci.conciliacao_id = v_conc.id;
      v_mov := v_movs[1];
      if not ((v_mov.valor < 0 and r.conta_origem_id = v_mov.conta_financeira_id) or
              (v_mov.valor > 0 and r.conta_destino_id = v_mov.conta_financeira_id)) or abs(v_mov.valor) <> r.valor then
        raise exception 'A transferência selecionada não corresponde a esta movimentação.';
      end if;
    else
      raise exception 'Combinação inválida para transferência.';
    end if;
    if v_transf_id is not null then
      insert into public.conciliacao_itens (conciliacao_id, empresa_id, transferencia_id, valor)
      values (v_conc.id, v_conc.empresa_id, v_transf_id, v_soma_mov);
    end if;
    update public.conciliacoes set diferenca = 0 where id = v_conc.id;
    return jsonb_build_object('transferencia_id', v_transf_id);
  end if;

  -- ---------------------------------------------------- lançamentos e baixas
  v_conta := v_movs[1].conta_financeira_id;
  for i in 1..v_n_mov loop
    if v_movs[i].conta_financeira_id <> v_conta then
      raise exception 'Todas as movimentações devem ser da mesma conta.';
    end if;
    if sign(v_movs[i].valor) <> sign(v_movs[1].valor) then
      raise exception 'Não misture entradas e saídas na mesma conciliação.';
    end if;
  end loop;
  v_sinal := sign(v_soma_mov)::int;
  v_tipo := case when v_sinal > 0 then 'receber' else 'pagar' end;
  v_caixa := abs(v_soma_mov);

  -- Baixas já existentes
  for r in
    select b.* from public.baixas b join public.conciliacao_itens ci on ci.baixa_id = b.id
     where ci.conciliacao_id = v_conc.id
  loop
    if r.tipo <> v_tipo then
      raise exception 'A baixa selecionada tem sentido diferente da movimentação.';
    end if;
    if r.conta_financeira_id <> v_conta then
      raise exception 'A baixa selecionada foi registrada em outra conta.';
    end if;
    v_soma_alvos := v_soma_alvos + r.valor_total;
  end loop;
  -- Transferências já existentes (lado desta conta)
  for r in
    select t.* from public.transferencias t join public.conciliacao_itens ci on ci.transferencia_id = t.id
     where ci.conciliacao_id = v_conc.id
  loop
    if (v_sinal < 0 and r.conta_origem_id <> v_conta) or (v_sinal > 0 and r.conta_destino_id <> v_conta) then
      raise exception 'A transferência selecionada não corresponde a esta conta.';
    end if;
    v_soma_alvos := v_soma_alvos + r.valor;
  end loop;

  select array_agg(l order by l.data_vencimento, l.created_at) into v_lancs
    from public.lancamentos l
    join public.conciliacao_itens ci on ci.lancamento_id = l.id
   where ci.conciliacao_id = v_conc.id;
  v_n_lanc := coalesce(cardinality(v_lancs), 0);

  if v_n_lanc = 0 then
    v_dif := v_caixa - v_soma_alvos;
    if v_dif <> 0 then
      raise exception 'Os valores não conferem (diferença de R$ %). Inclua lançamentos ou ajuste a seleção.', v_dif;
    end if;
    update public.conciliacoes set diferenca = 0 where id = v_conc.id;
    return jsonb_build_object('baixas_criadas', 0);
  end if;

  if v_n_mov > 1 and v_n_lanc > 1 then
    raise exception 'Concilie uma movimentação com vários lançamentos, ou várias movimentações com um lançamento.';
  end if;

  v_aberto := 0;
  for i in 1..v_n_lanc loop
    v_lanc := v_lancs[i];
    if v_lanc.tipo <> v_tipo then
      raise exception 'O lançamento "%" tem sentido diferente da movimentação.', v_lanc.descricao;
    end if;
    if v_lanc.situacao in ('quitado', 'cancelado') then
      raise exception 'O lançamento "%" já está quitado ou cancelado.', v_lanc.descricao;
    end if;
    if v_lanc.status_revisao <> 'confirmado' then
      raise exception 'Confirme o lançamento sugerido "%" antes de conciliar.', v_lanc.descricao;
    end if;
    v_aberto := v_aberto + (v_lanc.valor_previsto - v_lanc.valor_baixado);
  end loop;

  v_restante := v_caixa - v_soma_alvos;      -- dinheiro a distribuir entre os lançamentos
  if v_restante <= 0 then
    raise exception 'O valor da movimentação já está coberto pelas baixas selecionadas.';
  end if;
  v_dif := v_restante - v_aberto;            -- > 0: pagou/recebeu a mais; < 0: a menos

  if v_dif > 0 and coalesce(p_tratamento, '') not in ('juros', 'multa', 'taxa') then
    raise exception 'A movimentação é R$ % maior que o saldo em aberto. Informe se a diferença é juros, multa ou taxa.', v_dif;
  end if;
  if v_dif > 0 and p_tratamento = 'taxa' and v_tipo = 'receber' then
    raise exception 'Valor recebido a maior não pode ser tratado como taxa. Use juros ou multa.';
  end if;
  if v_dif < 0 and coalesce(p_tratamento, '') not in ('desconto', 'taxa', 'parcial') then
    raise exception 'A movimentação é R$ % menor que o saldo em aberto. Informe se é pagamento parcial, desconto ou taxa.', abs(v_dif);
  end if;
  if v_dif < 0 and p_tratamento = 'taxa' and v_tipo = 'pagar' then
    raise exception 'Valor pago a menor não pode ser tratado como taxa. Use desconto ou pagamento parcial.';
  end if;

  if v_n_mov = 1 then
    -- Uma movimentação → um ou vários lançamentos
    v_mov := v_movs[1];
    for i in 1..v_n_lanc loop
      v_lanc := v_lancs[i];
      v_principal := v_lanc.valor_previsto - v_lanc.valor_baixado;
      v_aj_juros := 0; v_aj_multa := 0; v_aj_desc := 0; v_aj_taxa := 0;
      if v_dif < 0 and p_tratamento = 'parcial' then
        v_principal := least(v_principal, v_restante);
      elsif i = v_n_lanc and v_dif <> 0 then
        if v_dif > 0 then
          if p_tratamento = 'juros' then v_aj_juros := v_dif;
          elsif p_tratamento = 'multa' then v_aj_multa := v_dif;
          else v_aj_taxa := v_dif; end if;
        else
          if p_tratamento = 'desconto' then v_aj_desc := -v_dif; else v_aj_taxa := -v_dif; end if;
          if v_aj_desc + v_aj_taxa >= v_principal then
            raise exception 'A diferença (R$ %) é maior que o último lançamento. Ajuste a seleção.', -v_dif;
          end if;
        end if;
      end if;
      exit when v_principal <= 0;
      insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal,
                                 juros, multa, desconto, taxas, origem, conciliacao_id)
      values (v_conc.empresa_id, v_lanc.id, v_tipo, v_mov.data, v_conta, v_principal,
              v_aj_juros, v_aj_multa, v_aj_desc, v_aj_taxa, 'conciliacao', v_conc.id)
      returning id into v_baixa_id;
      v_restante := v_restante - v_principal;
      insert into public.conciliacao_itens (conciliacao_id, empresa_id, baixa_id, valor)
      values (v_conc.id, v_conc.empresa_id, v_baixa_id, v_sinal * (v_principal + v_aj_juros + v_aj_multa - v_aj_desc
               + case when v_tipo = 'pagar' then v_aj_taxa else -v_aj_taxa end));
    end loop;
  else
    -- Várias movimentações → um lançamento (pagamentos parciais em datas diferentes)
    v_lanc := v_lancs[1];
    v_aberto := v_lanc.valor_previsto - v_lanc.valor_baixado;
    for i in 1..v_n_mov loop
      v_mov := v_movs[i];
      v_aj_juros := 0; v_aj_multa := 0; v_aj_desc := 0; v_aj_taxa := 0;
      v_principal := least(abs(v_mov.valor), v_aberto);
      if i = v_n_mov and v_dif > 0 then
        v_principal := v_aberto;
        if p_tratamento = 'juros' then v_aj_juros := abs(v_mov.valor) - v_principal;
        elsif p_tratamento = 'multa' then v_aj_multa := abs(v_mov.valor) - v_principal;
        else v_aj_taxa := abs(v_mov.valor) - v_principal; end if;
      elsif i = v_n_mov and v_dif < 0 and p_tratamento in ('desconto', 'taxa') then
        v_principal := v_aberto;
        if p_tratamento = 'desconto' then v_aj_desc := v_aberto - abs(v_mov.valor); else v_aj_taxa := v_aberto - abs(v_mov.valor); end if;
      end if;
      if v_principal <= 0 then
        raise exception 'A movimentação de % excede o saldo do lançamento.', to_char(v_mov.data, 'DD/MM/YYYY');
      end if;
      insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal,
                                 juros, multa, desconto, taxas, origem, conciliacao_id)
      values (v_conc.empresa_id, v_lanc.id, v_tipo, v_mov.data, v_conta, v_principal,
              v_aj_juros, v_aj_multa, v_aj_desc, v_aj_taxa, 'conciliacao', v_conc.id)
      returning id into v_baixa_id;
      v_aberto := v_aberto - v_principal;
      insert into public.conciliacao_itens (conciliacao_id, empresa_id, baixa_id, valor)
      values (v_conc.id, v_conc.empresa_id, v_baixa_id, v_mov.valor);
    end loop;
  end if;

  update public.conciliacoes
     set diferenca = v_dif, tratamento_diferenca = case when v_dif <> 0 then p_tratamento else null end
   where id = v_conc.id;
  return jsonb_build_object('diferenca', v_dif);
end;
$$;

-- Finaliza: ativa itens, marca movimentações, remove sugestões conflitantes.
create or replace function app.finalizar_conciliacao(p_conciliacao_id uuid, p_observacao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conc public.conciliacoes;
begin
  select * into v_conc from public.conciliacoes where id = p_conciliacao_id;
  update public.conciliacao_itens set ativo = true
   where conciliacao_id = v_conc.id and (movimento_id is not null or baixa_id is not null or transferencia_id is not null);
  update public.movimentos_bancarios m set status_conciliacao = 'conciliado'
    from public.conciliacao_itens ci
   where ci.conciliacao_id = v_conc.id and ci.movimento_id = m.id;
  update public.conciliacoes
     set status = 'confirmada', confirmada_por = auth.uid(), confirmada_em = now(),
         observacao = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), observacao)
   where id = v_conc.id;
  -- Outras sugestões que usavam as mesmas movimentações ou lançamentos agora quitados
  delete from public.conciliacoes c
   where c.empresa_id = v_conc.empresa_id
     and c.status = 'sugerida'
     and c.id <> v_conc.id
     and exists (
       select 1 from public.conciliacao_itens a
        where a.conciliacao_id = c.id
          and (
            a.movimento_id in (select movimento_id from public.conciliacao_itens where conciliacao_id = v_conc.id and movimento_id is not null)
            or a.baixa_id in (select baixa_id from public.conciliacao_itens where conciliacao_id = v_conc.id and baixa_id is not null)
            or a.lancamento_id in (select l.id from public.lancamentos l
                                    join public.conciliacao_itens x on x.lancamento_id = l.id
                                   where x.conciliacao_id = v_conc.id and l.situacao = 'quitado')
          )
     );
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Registra sugestões calculadas pelo motor de correspondência (status "sugerida").
create or replace function public.registrar_sugestoes_conciliacao(p_empresa_id uuid, p_sugestoes jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s jsonb;
  item jsonb;
  v_id uuid;
  v_n int := 0;
  v_ok boolean;
begin
  if auth.uid() is not null then
    perform app.exigir(p_empresa_id, 'conciliacao.executar');
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_sugestoes, '[]'::jsonb))
  loop
    v_ok := true;
    -- Todos os itens precisam pertencer à empresa e estar disponíveis
    for item in select * from jsonb_array_elements(s -> 'itens')
    loop
      if item ? 'movimento_id' and not exists (
        select 1 from public.movimentos_bancarios where id = (item ->> 'movimento_id')::uuid
           and empresa_id = p_empresa_id and status_conciliacao = 'pendente') then
        v_ok := false;
      end if;
      if item ? 'lancamento_id' and not exists (
        select 1 from public.lancamentos where id = (item ->> 'lancamento_id')::uuid
           and empresa_id = p_empresa_id and situacao in ('aberto', 'parcial') and status_revisao = 'confirmado') then
        v_ok := false;
      end if;
      if item ? 'baixa_id' and (not exists (
        select 1 from public.baixas where id = (item ->> 'baixa_id')::uuid and empresa_id = p_empresa_id)
        or exists (select 1 from public.conciliacao_itens where baixa_id = (item ->> 'baixa_id')::uuid and ativo)) then
        v_ok := false;
      end if;
    end loop;
    -- Pares já rejeitados não voltam
    if exists (
      select 1 from jsonb_array_elements(s -> 'itens') a, jsonb_array_elements(s -> 'itens') b
       where a ? 'movimento_id' and (b ? 'lancamento_id' or b ? 'baixa_id' or (b ? 'movimento_id' and b <> a))
         and exists (select 1 from public.conciliacao_rejeicoes r
                      where r.movimento_id = (a ->> 'movimento_id')::uuid
                        and r.alvo_id = coalesce(b ->> 'lancamento_id', b ->> 'baixa_id', b ->> 'movimento_id')::uuid)
    ) then
      v_ok := false;
    end if;
    -- Já existe sugestão aberta para a mesma movimentação e mesmo alvo
    if exists (
      select 1 from public.conciliacoes c
       where c.empresa_id = p_empresa_id and c.status = 'sugerida'
         and (select array_agg(coalesce(ci.movimento_id, ci.lancamento_id, ci.baixa_id, ci.transferencia_id) order by 1)
                from public.conciliacao_itens ci where ci.conciliacao_id = c.id)
           = (select array_agg(coalesce(x ->> 'movimento_id', x ->> 'lancamento_id', x ->> 'baixa_id', x ->> 'transferencia_id')::uuid order by 1)
                from jsonb_array_elements(s -> 'itens') x)
    ) then
      v_ok := false;
    end if;

    if v_ok then
      insert into public.conciliacoes (empresa_id, conta_financeira_id, status, origem, tipo, pontuacao, criterios, observacao, criado_por)
      values (p_empresa_id, (s ->> 'conta_id')::uuid, 'sugerida', 'automatica', coalesce(s ->> 'tipo', 'lancamento'),
              least(100, greatest(0, coalesce((s ->> 'pontuacao')::int, 0))), coalesce(s -> 'criterios', '{}'::jsonb),
              left(s ->> 'observacao', 500), auth.uid())
      returning id into v_id;
      insert into public.conciliacao_itens (conciliacao_id, empresa_id, movimento_id, lancamento_id, baixa_id, transferencia_id, valor)
      select v_id, p_empresa_id, (x ->> 'movimento_id')::uuid, (x ->> 'lancamento_id')::uuid, (x ->> 'baixa_id')::uuid,
             (x ->> 'transferencia_id')::uuid, coalesce((x ->> 'valor')::numeric, 0)
        from jsonb_array_elements(s -> 'itens') x;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

create or replace function public.confirmar_conciliacao(
  p_conciliacao_id uuid,
  p_tratamento text default null,
  p_observacao text default null,
  p_conta_contrapartida uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conc public.conciliacoes;
  v_res jsonb;
begin
  select * into v_conc from public.conciliacoes where id = p_conciliacao_id for update;
  if not found then
    raise exception 'Conciliação não encontrada.';
  end if;
  perform app.exigir(v_conc.empresa_id, 'conciliacao.executar');
  if v_conc.status <> 'sugerida' then
    raise exception 'Somente sugestões pendentes podem ser confirmadas.';
  end if;
  v_res := app.executar_conciliacao(v_conc.id, p_tratamento, p_conta_contrapartida);
  perform app.finalizar_conciliacao(v_conc.id, p_observacao);
  return v_res;
end;
$$;

create or replace function public.rejeitar_sugestao_conciliacao(p_conciliacao_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conc public.conciliacoes;
begin
  select * into v_conc from public.conciliacoes where id = p_conciliacao_id for update;
  if not found then
    raise exception 'Sugestão não encontrada.';
  end if;
  perform app.exigir(v_conc.empresa_id, 'conciliacao.executar');
  if v_conc.status <> 'sugerida' then
    raise exception 'Somente sugestões pendentes podem ser rejeitadas.';
  end if;
  insert into public.conciliacao_rejeicoes (empresa_id, movimento_id, alvo_id)
  select v_conc.empresa_id, m.movimento_id, coalesce(a.lancamento_id, a.baixa_id, a.movimento_id, a.transferencia_id)
    from public.conciliacao_itens m
    join public.conciliacao_itens a on a.conciliacao_id = m.conciliacao_id and a.id <> m.id
   where m.conciliacao_id = v_conc.id and m.movimento_id is not null
  on conflict do nothing;
  update public.conciliacoes
     set status = 'rejeitada', rejeitada_por = auth.uid(), rejeitada_em = now(), motivo_rejeicao = p_motivo
   where id = v_conc.id;
end;
$$;

-- Conciliação manual: N movimentações com M lançamentos/baixas/transferências.
create or replace function public.conciliar_manual(
  p_empresa_id uuid,
  p_movimentos uuid[],
  p_lancamentos uuid[] default array[]::uuid[],
  p_baixas uuid[] default array[]::uuid[],
  p_transferencias uuid[] default array[]::uuid[],
  p_tratamento text default null,
  p_observacao text default null,
  p_tipo text default 'lancamento',
  p_conta_contrapartida uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_conta uuid;
  v_res jsonb;
begin
  perform app.exigir(p_empresa_id, 'conciliacao.executar');
  if coalesce(cardinality(p_movimentos), 0) = 0 then
    raise exception 'Selecione ao menos uma movimentação.';
  end if;
  if p_tipo not in ('lancamento', 'transferencia') then
    raise exception 'Tipo inválido.';
  end if;
  select conta_financeira_id into v_conta from public.movimentos_bancarios
   where id = p_movimentos[1] and empresa_id = p_empresa_id;
  if v_conta is null then
    raise exception 'Movimentação inválida.';
  end if;

  insert into public.conciliacoes (empresa_id, conta_financeira_id, status, origem, tipo, observacao)
  values (p_empresa_id, v_conta, 'sugerida', 'manual',
          case when p_tipo = 'transferencia' then 'transferencia'
               when coalesce(cardinality(p_lancamentos), 0) = 0 then 'baixa' else 'lancamento' end,
          p_observacao)
  returning id into v_id;

  insert into public.conciliacao_itens (conciliacao_id, empresa_id, movimento_id, valor)
  select v_id, p_empresa_id, m.id, m.valor
    from public.movimentos_bancarios m
   where m.id = any(p_movimentos) and m.empresa_id = p_empresa_id;
  if (select count(*) from public.conciliacao_itens where conciliacao_id = v_id) <> cardinality(p_movimentos) then
    raise exception 'Movimentação inválida para esta empresa.';
  end if;
  insert into public.conciliacao_itens (conciliacao_id, empresa_id, lancamento_id, valor)
  select v_id, p_empresa_id, l.id, case when l.tipo = 'receber' then 1 else -1 end * (l.valor_previsto - l.valor_baixado)
    from public.lancamentos l
   where l.id = any(coalesce(p_lancamentos, array[]::uuid[])) and l.empresa_id = p_empresa_id;
  insert into public.conciliacao_itens (conciliacao_id, empresa_id, baixa_id, valor)
  select v_id, p_empresa_id, b.id, case when b.tipo = 'receber' then b.valor_total else -b.valor_total end
    from public.baixas b
   where b.id = any(coalesce(p_baixas, array[]::uuid[])) and b.empresa_id = p_empresa_id;
  insert into public.conciliacao_itens (conciliacao_id, empresa_id, transferencia_id, valor)
  select v_id, p_empresa_id, t.id, t.valor
    from public.transferencias t
   where t.id = any(coalesce(p_transferencias, array[]::uuid[])) and t.empresa_id = p_empresa_id;
  if (select count(*) from public.conciliacao_itens where conciliacao_id = v_id)
     <> cardinality(p_movimentos) + coalesce(cardinality(p_lancamentos), 0) + coalesce(cardinality(p_baixas), 0)
        + coalesce(cardinality(p_transferencias), 0) then
    raise exception 'Há itens selecionados que não pertencem a esta empresa.';
  end if;

  v_res := app.executar_conciliacao(v_id, p_tratamento, p_conta_contrapartida);
  perform app.finalizar_conciliacao(v_id, p_observacao);
  return v_res || jsonb_build_object('conciliacao_id', v_id);
end;
$$;

-- Classifica uma movimentação sem lançamento: cria o lançamento já pago e concilia.
create or replace function public.classificar_movimento(
  p_movimento_id uuid,
  p_categoria_id uuid,
  p_descricao text default null,
  p_contraparte_id uuid default null,
  p_centro_custo_id uuid default null,
  p_projeto_id uuid default null,
  p_data_competencia date default null,
  p_documento_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov public.movimentos_bancarios;
  v_conc uuid;
  v_lanc uuid;
  v_baixa uuid;
  v_tipo text;
begin
  select * into v_mov from public.movimentos_bancarios where id = p_movimento_id for update;
  if not found then
    raise exception 'Movimentação não encontrada.';
  end if;
  perform app.exigir(v_mov.empresa_id, 'conciliacao.executar');
  perform app.exigir(v_mov.empresa_id, 'financeiro.editar');
  if v_mov.status_conciliacao <> 'pendente' then
    raise exception 'Esta movimentação já foi conciliada ou ignorada.';
  end if;
  v_tipo := case when v_mov.valor > 0 then 'receber' else 'pagar' end;

  insert into public.lancamentos (
    empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id,
    data_competencia, data_vencimento, valor_previsto, origem, origem_referencia
  ) values (
    v_mov.empresa_id, v_tipo, coalesce(nullif(trim(coalesce(p_descricao, '')), ''), v_mov.descricao), p_categoria_id,
    p_contraparte_id, p_centro_custo_id, p_projeto_id, v_mov.conta_financeira_id,
    coalesce(p_data_competencia, v_mov.data), v_mov.data, abs(v_mov.valor), 'conciliacao', v_mov.id::text
  ) returning id into v_lanc;

  insert into public.conciliacoes (empresa_id, conta_financeira_id, status, origem, tipo, lancamentos_criados)
  values (v_mov.empresa_id, v_mov.conta_financeira_id, 'sugerida', 'manual', 'classificacao', array[v_lanc])
  returning id into v_conc;

  insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, origem, conciliacao_id)
  values (v_mov.empresa_id, v_lanc, v_tipo, v_mov.data, v_mov.conta_financeira_id, abs(v_mov.valor), 'conciliacao', v_conc)
  returning id into v_baixa;

  insert into public.conciliacao_itens (conciliacao_id, empresa_id, movimento_id, valor)
  values (v_conc, v_mov.empresa_id, v_mov.id, v_mov.valor);
  insert into public.conciliacao_itens (conciliacao_id, empresa_id, baixa_id, valor)
  values (v_conc, v_mov.empresa_id, v_baixa, v_mov.valor);

  if coalesce(cardinality(p_documento_ids), 0) > 0 then
    insert into public.lancamento_documentos (lancamento_id, documento_id, empresa_id, tipo_vinculo)
    select v_lanc, d.id, v_mov.empresa_id, 'comprovante'
      from public.documentos d where d.id = any(p_documento_ids) and d.empresa_id = v_mov.empresa_id
    on conflict do nothing;
  end if;

  perform app.finalizar_conciliacao(v_conc, null);
  return jsonb_build_object('conciliacao_id', v_conc, 'lancamento_id', v_lanc, 'baixa_id', v_baixa);
end;
$$;

create or replace function public.desfazer_conciliacao(p_conciliacao_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conc public.conciliacoes;
begin
  select * into v_conc from public.conciliacoes where id = p_conciliacao_id for update;
  if not found then
    raise exception 'Conciliação não encontrada.';
  end if;
  perform app.exigir(v_conc.empresa_id, 'conciliacao.executar');
  if v_conc.status <> 'confirmada' then
    raise exception 'Somente conciliações confirmadas podem ser desfeitas.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo para desfazer a conciliação.';
  end if;

  -- Os gatilhos impedem a operação se alguma data estiver em competência fechada.
  update public.conciliacao_itens set ativo = false where conciliacao_id = v_conc.id;
  update public.movimentos_bancarios m set status_conciliacao = 'pendente'
    from public.conciliacao_itens ci
   where ci.conciliacao_id = v_conc.id and ci.movimento_id = m.id;
  delete from public.conciliacao_itens ci
   using public.baixas b
   where ci.conciliacao_id = v_conc.id and ci.baixa_id = b.id and b.conciliacao_id = v_conc.id;
  delete from public.baixas where conciliacao_id = v_conc.id;
  delete from public.conciliacao_itens ci
   using public.transferencias t
   where ci.conciliacao_id = v_conc.id and ci.transferencia_id = t.id and t.conciliacao_id = v_conc.id;
  delete from public.transferencias where conciliacao_id = v_conc.id;
  if cardinality(v_conc.lancamentos_criados) > 0 then
    delete from public.lancamentos where id = any(v_conc.lancamentos_criados) and empresa_id = v_conc.empresa_id;
  end if;

  update public.conciliacoes
     set status = 'desfeita', desfeita_por = auth.uid(), desfeita_em = now(), motivo_desfazer = trim(p_motivo)
   where id = v_conc.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Consultas de apoio
-- -----------------------------------------------------------------------------

-- Conferência de saldos: sistema x extrato
create or replace function public.conferencia_saldos(p_empresa_id uuid, p_inicio date, p_fim date)
returns table (
  conta_id uuid,
  conta_nome text,
  conta_tipo text,
  saldo_inicial_sistema numeric,
  entradas_sistema numeric,
  saidas_sistema numeric,
  saldo_final_sistema numeric,
  movimentos_importados numeric,
  movimentos_total int,
  movimentos_pendentes int,
  saldo_extrato_data date,
  saldo_extrato numeric,
  diferenca numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with contas as (
    select * from public.contas_financeiras where empresa_id = p_empresa_id and ativa
  ),
  fluxo as (
    select c.id,
           coalesce((select sum(b.valor_total) from public.baixas b
                      where b.conta_financeira_id = c.id and b.tipo = 'receber' and b.data_pagamento between p_inicio and p_fim
                        and b.data_pagamento > c.saldo_inicial_data), 0)
         + coalesce((select sum(t.valor) from public.transferencias t
                      where t.conta_destino_id = c.id and t.data between p_inicio and p_fim and t.data > c.saldo_inicial_data), 0) as entradas,
           coalesce((select sum(b.valor_total) from public.baixas b
                      where b.conta_financeira_id = c.id and b.tipo = 'pagar' and b.data_pagamento between p_inicio and p_fim
                        and b.data_pagamento > c.saldo_inicial_data), 0)
         + coalesce((select sum(t.valor) from public.transferencias t
                      where t.conta_origem_id = c.id and t.data between p_inicio and p_fim and t.data > c.saldo_inicial_data), 0) as saidas
      from contas c
  ),
  extrato as (
    select distinct on (s.conta_financeira_id) s.conta_financeira_id, s.data, s.saldo
      from public.extrato_saldos s
     where s.empresa_id = p_empresa_id and s.data <= p_fim and s.data >= p_inicio
     order by s.conta_financeira_id, s.data desc, case s.fonte when 'ofx' then 1 when 'planilha' then 2 else 3 end
  )
  select c.id, c.nome, c.tipo,
         public.saldo_conta(c.id, greatest(p_inicio - 1, c.saldo_inicial_data)) as saldo_inicial_sistema,
         f.entradas, f.saidas,
         public.saldo_conta(c.id, greatest(p_fim, c.saldo_inicial_data)) as saldo_final_sistema,
         coalesce((select sum(m.valor) from public.movimentos_bancarios m
                    where m.conta_financeira_id = c.id and m.data between p_inicio and p_fim and m.status_conciliacao <> 'ignorado'), 0),
         coalesce((select count(*) from public.movimentos_bancarios m
                    where m.conta_financeira_id = c.id and m.data between p_inicio and p_fim), 0)::int,
         coalesce((select count(*) from public.movimentos_bancarios m
                    where m.conta_financeira_id = c.id and m.data between p_inicio and p_fim and m.status_conciliacao = 'pendente'), 0)::int,
         e.data, e.saldo,
         case when e.saldo is null then null else e.saldo - public.saldo_conta(c.id, greatest(e.data, c.saldo_inicial_data)) end
    from contas c
    join fluxo f on f.id = c.id
    left join extrato e on e.conta_financeira_id = c.id
   order by c.nome;
$$;

-- Movimentações conciliadas sem comprovante vinculado ao lançamento
create or replace function public.movimentos_sem_comprovante(p_empresa_id uuid, p_inicio date, p_fim date)
returns setof public.movimentos_bancarios
language sql
stable
security invoker
set search_path = ''
as $$
  select m.*
    from public.movimentos_bancarios m
   where m.empresa_id = p_empresa_id
     and m.data between p_inicio and p_fim
     and m.status_conciliacao <> 'ignorado'
     and not exists (
       select 1
         from public.conciliacao_itens ci
         join public.conciliacao_itens cb on cb.conciliacao_id = ci.conciliacao_id and cb.baixa_id is not null
         join public.baixas b on b.id = cb.baixa_id
         join public.lancamento_documentos ld on ld.lancamento_id = b.lancamento_id
        where ci.movimento_id = m.id and ci.ativo
     )
     and not exists (
       select 1 from public.conciliacao_itens ci
        where ci.movimento_id = m.id and ci.ativo
          and exists (select 1 from public.conciliacao_itens t where t.conciliacao_id = ci.conciliacao_id and t.transferencia_id is not null)
     )
   order by m.data, m.valor;
$$;

-- Documentos financeiros/fiscais sem lançamento vinculado
create or replace function public.documentos_sem_vinculo(p_empresa_id uuid, p_inicio date, p_fim date)
returns setof public.documentos
language sql
stable
security invoker
set search_path = ''
as $$
  select d.*
    from public.documentos d
   where d.empresa_id = p_empresa_id
     and d.direcao = 'cliente'
     and d.excluido_em is null
     and d.upload_status = 'concluido'
     and d.competencia between date_trunc('month', p_inicio)::date and date_trunc('month', p_fim)::date
     and d.categoria_codigo in ('comprovante', 'boleto', 'nfe_saida_xml', 'nfe_entrada_xml', 'nfse', 'notas_pdf', 'compras_vendas_despesas', 'guia_imposto')
     and not exists (select 1 from public.lancamento_documentos ld where ld.documento_id = d.id)
     and coalesce(d.extensao, '') <> 'zip'
   order by d.competencia, d.enviado_em;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.conciliacoes enable row level security;
alter table public.conciliacao_itens enable row level security;
alter table public.conciliacao_rejeicoes enable row level security;

create policy conciliacoes_leitura on public.conciliacoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy conciliacao_itens_leitura on public.conciliacao_itens for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy conciliacao_rejeicoes_leitura on public.conciliacao_rejeicoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('conciliacao.executar'))::uuid[]));
