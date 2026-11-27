-- =============================================================================
-- Hotel: serviços extras lançados para EMPRESAS (marmitas para uma obra,
-- lavanderia de uma equipe, aluguel de carro...), sem precisar de hóspede.
--  - Cada lançamento é um recibo numerado (nº sequencial por hotel) com os
--    serviços (quantidade × preço do cadastro) e a empresa que pediu.
--  - Pago na hora (dinheiro, Pix, cartão, transferência): entra no Financeiro
--    já recebido e, com o caixa da pessoa aberto, na conferência do caixa.
--  - A prazo: entra no Financeiro como conta a receber da empresa, com vencimento.
--  - O gerente cancela com o motivo (o recibo fica marcado como cancelado e o
--    lançamento do Financeiro é cancelado junto).
-- =============================================================================

alter table public.hotel_config
  add column proximo_numero_recibo_extra bigint not null default 1 check (proximo_numero_recibo_extra >= 1);

create table public.hotel_extras_recibos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  data date not null default app.hoje(),
  contraparte_id uuid not null,
  -- Quem pediu pela empresa (funcionário, obra, setor) — sai no recibo
  solicitante text check (solicitante is null or length(solicitante) <= 120),
  observacao text check (observacao is null or length(observacao) <= 300),
  total numeric(12, 2) not null check (total >= 0),
  pagamento text not null check (pagamento in ('na_hora', 'a_prazo')),
  forma text check (forma is null or forma in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'outro')),
  vencimento date,
  sessao_id uuid,
  lancamento_id uuid,
  cancelado_em timestamptz,
  cancelado_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  lancado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint hotel_extras_recibos_empresa_id_unico unique (empresa_id, id),
  constraint hotel_extras_recibos_numero_uk unique (empresa_id, numero),
  constraint hotel_extras_recibos_na_hora check ((pagamento = 'na_hora') = (forma is not null)),
  constraint hotel_extras_recibos_a_prazo check ((pagamento = 'a_prazo') = (vencimento is not null)),
  foreign key (empresa_id, contraparte_id) references public.contrapartes (empresa_id, id),
  foreign key (empresa_id, sessao_id) references public.caixa_sessoes (empresa_id, id),
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id)
);
create index hotel_extras_recibos_data_idx on public.hotel_extras_recibos (empresa_id, data desc);
create index hotel_extras_recibos_contraparte_idx on public.hotel_extras_recibos (contraparte_id);
create index hotel_extras_recibos_sessao_idx on public.hotel_extras_recibos (sessao_id) where sessao_id is not null;
create trigger auditoria_hotel_extras_recibos after insert or update or delete on public.hotel_extras_recibos for each row execute function app.tg_auditoria();

create table public.hotel_extras_recibo_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  recibo_id uuid not null,
  extra_id uuid references public.hotel_extras(id) on delete set null,
  descricao text not null check (length(trim(descricao)) between 1 and 160),
  natureza text not null check (natureza in ('alimentacao', 'lavanderia', 'locacao', 'outro')),
  unidade text not null check (unidade in ('refeicao', 'marmita', 'unidade', 'peca', 'kg', 'uso', 'dia', 'hora')),
  quantidade numeric(12, 3) not null check (quantidade > 0),
  valor_unitario numeric(12, 2) not null check (valor_unitario >= 0),
  total numeric(12, 2) not null check (total >= 0),
  foreign key (empresa_id, recibo_id) references public.hotel_extras_recibos (empresa_id, id) on delete cascade
);
create index hotel_extras_recibo_itens_recibo_idx on public.hotel_extras_recibo_itens (recibo_id);
create index hotel_extras_recibo_itens_extra_idx on public.hotel_extras_recibo_itens (extra_id) where extra_id is not null;

alter table public.hotel_extras_recibos enable row level security;
alter table public.hotel_extras_recibo_itens enable row level security;
create policy hotel_extras_recibos_leitura on public.hotel_extras_recibos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
create policy hotel_extras_recibo_itens_leitura on public.hotel_extras_recibo_itens for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
grant select on public.hotel_extras_recibos, public.hotel_extras_recibo_itens to authenticated;
grant select, insert, update, delete on public.hotel_extras_recibos, public.hotel_extras_recibo_itens to service_role;

-- -----------------------------------------------------------------------------
-- Lança os serviços para a empresa e gera o recibo (recepção)
-- -----------------------------------------------------------------------------
create or replace function public.hotel_extras_recibo_lancar(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.hotel_config;
  v_gestao public.gestao_config;
  c public.contrapartes;
  e public.hotel_extras;
  v_item jsonb;
  v_qtd numeric;
  v_preco numeric;
  v_gerente boolean;
  v_data date;
  v_hoje date := app.hoje();
  v_pagamento text := coalesce(p_dados ->> 'pagamento', '');
  v_forma text := nullif(p_dados ->> 'forma', '');
  v_venc date;
  v_total numeric := 0;
  v_numero bigint;
  v_id uuid;
  v_sessao uuid;
  v_cat uuid;
  v_conta uuid;
  v_lanc uuid;
  v_desc text;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  v_gerente := app.pode(p_empresa_id, 'gestao.gerenciar');

  select * into c from public.contrapartes
   where id = nullif(p_dados ->> 'contraparte_id', '')::uuid and empresa_id = p_empresa_id and ativo;
  if c.id is null then
    raise exception 'Escolha a empresa que pediu os serviços.';
  end if;
  begin
    v_data := coalesce(nullif(p_dados ->> 'data', '')::date, v_hoje);
  exception when others then
    raise exception 'Data inválida.';
  end;
  if v_data > v_hoje or v_data < v_hoje - 90 then
    raise exception 'A data do serviço precisa ser de hoje ou dos últimos 90 dias.';
  end if;
  if length(coalesce(p_dados ->> 'solicitante', '')) > 120 then
    raise exception 'O nome de quem pediu pode ter até 120 letras.';
  end if;
  if length(coalesce(p_dados ->> 'observacao', '')) > 300 then
    raise exception 'A observação pode ter até 300 letras.';
  end if;
  if jsonb_typeof(p_dados -> 'itens') is distinct from 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Escolha ao menos um serviço.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 30 then
    raise exception 'Lance até 30 serviços de cada vez.';
  end if;

  if v_pagamento = 'na_hora' then
    if v_forma is null or v_forma not in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'outro') then
      raise exception 'Escolha como a empresa pagou.';
    end if;
  elsif v_pagamento = 'a_prazo' then
    v_forma := null;
    begin
      v_venc := nullif(p_dados ->> 'vencimento', '')::date;
    exception when others then
      v_venc := null;
    end;
    if v_venc is null or v_venc < v_hoje then
      raise exception 'Informe o vencimento (hoje ou depois).';
    end if;
  else
    raise exception 'Escolha se a empresa pagou na hora ou vai pagar depois.';
  end if;

  -- Número do recibo (sequencial por hotel)
  perform app.hotel_cfg(p_empresa_id);
  select * into v_cfg from public.hotel_config where empresa_id = p_empresa_id for update;
  v_numero := v_cfg.proximo_numero_recibo_extra;
  update public.hotel_config set proximo_numero_recibo_extra = proximo_numero_recibo_extra + 1 where empresa_id = p_empresa_id;

  insert into public.hotel_extras_recibos (empresa_id, numero, data, contraparte_id, solicitante, observacao, total, pagamento, forma, vencimento)
  values (p_empresa_id, v_numero, v_data, c.id, nullif(trim(coalesce(p_dados ->> 'solicitante', '')), ''),
          nullif(trim(coalesce(p_dados ->> 'observacao', '')), ''), 0, v_pagamento, v_forma, v_venc)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_dados -> 'itens') loop
    select * into e from public.hotel_extras
     where id = nullif(v_item ->> 'extra_id', '')::uuid and empresa_id = p_empresa_id;
    if not found or not e.ativo then
      raise exception 'Serviço extra não encontrado ou fora de uso.';
    end if;
    begin
      v_qtd := (v_item ->> 'quantidade')::numeric;
      v_preco := coalesce(nullif(v_item ->> 'valor_unitario', '')::numeric, e.preco);
    exception when others then
      raise exception 'Quantidade ou preço inválido em %.', e.nome;
    end;
    if v_qtd is null or v_qtd <= 0 or v_qtd > 9999 or v_qtd <> round(v_qtd, 3) then
      raise exception 'Quantidade inválida em %.', e.nome;
    end if;
    if v_preco < 0 or v_preco > 999999 or v_preco <> round(v_preco, 2) then
      raise exception 'Preço inválido em %.', e.nome;
    end if;
    if v_preco <> e.preco and not v_gerente then
      raise exception 'Só o gerente lança % com preço diferente do cadastro.', e.nome;
    end if;
    insert into public.hotel_extras_recibo_itens (empresa_id, recibo_id, extra_id, descricao, natureza, unidade, quantidade, valor_unitario, total)
    values (p_empresa_id, v_id, e.id, left(e.nome, 160), e.natureza, e.unidade, v_qtd, v_preco, round(v_qtd * v_preco, 2));
    v_total := v_total + round(v_qtd * v_preco, 2);
  end loop;
  if v_total <= 0 then
    raise exception 'O total do recibo está zerado. Confira as quantidades e os preços.';
  end if;

  -- Financeiro: receita de serviços em nome da empresa
  select * into v_gestao from public.gestao_config where empresa_id = p_empresa_id;
  v_cat := app.categoria_sistema(p_empresa_id, 'SERVICOS');
  if v_cat is null then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_cat := app.categoria_sistema(p_empresa_id, 'SERVICOS');
  end if;
  v_desc := left('Serviços extras — recibo nº ' || v_numero || ' — ' || c.nome, 300);

  if v_pagamento = 'a_prazo' then
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto,
      origem, origem_referencia, numero_documento
    ) values (
      p_empresa_id, 'receber', v_desc || ' (a prazo)', v_cat, c.id, v_data, v_venc, v_total, 'hotel', v_id::text, 'REC ' || v_numero
    ) returning id into v_lanc;
  else
    v_conta := case v_forma
      when 'pix' then v_gestao.conta_pix_id
      when 'transferencia' then v_gestao.conta_pix_id
      when 'cartao_debito' then v_gestao.conta_cartao_id
      when 'cartao_credito' then v_gestao.conta_cartao_id
      else v_gestao.conta_dinheiro_id
    end;
    if v_conta is null then
      raise exception 'Configure a conta que recebe este pagamento nas configurações do hotel.';
    end if;
    -- Recebido com o caixa da pessoa aberto: entra na conferência do caixa
    select id into v_sessao from public.caixa_sessoes
     where empresa_id = p_empresa_id and operador_id = auth.uid() and status = 'aberto' limit 1;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, conta_financeira_id, data_competencia, data_vencimento, valor_previsto,
      origem, origem_referencia, numero_documento
    ) values (
      p_empresa_id, 'receber', v_desc, v_cat, c.id, v_conta, v_data, v_hoje, v_total, 'hotel', v_id::text, 'REC ' || v_numero
    ) returning id into v_lanc;
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem, observacao)
    values (p_empresa_id, v_lanc, 'receber', v_hoje, v_conta, v_total, v_forma, 'hotel', v_desc);
  end if;

  update public.hotel_extras_recibos set total = v_total, sessao_id = v_sessao, lancamento_id = v_lanc where id = v_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'total', v_total);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cancela o recibo (gerente): o Financeiro é cancelado junto
-- -----------------------------------------------------------------------------
create or replace function public.hotel_extras_recibo_cancelar(p_recibo_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rc public.hotel_extras_recibos;
  v_sessao text;
begin
  select * into rc from public.hotel_extras_recibos where id = p_recibo_id for update;
  if rc.id is null then
    raise exception 'Recibo não encontrado.';
  end if;
  perform app.exigir_hotel(rc.empresa_id, 'gestao.gerenciar');
  if rc.cancelado_em is not null then
    raise exception 'Este recibo já foi cancelado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  if rc.sessao_id is not null and rc.forma = 'dinheiro' then
    select status into v_sessao from public.caixa_sessoes where id = rc.sessao_id;
    if v_sessao <> 'aberto' then
      raise exception 'O caixa deste recebimento já foi fechado. Faça a devolução pelo Financeiro.';
    end if;
  end if;
  if rc.lancamento_id is not null then
    if exists (select 1 from public.baixas b where b.lancamento_id = rc.lancamento_id and b.origem <> 'hotel') then
      raise exception 'Este recibo já foi recebido ou conciliado no Financeiro. Desfaça o recebimento lá antes de cancelar.';
    end if;
    delete from public.baixas where lancamento_id = rc.lancamento_id and origem = 'hotel';
    update public.lancamentos
       set situacao = 'cancelado', motivo_cancelamento = left('Recibo nº ' || rc.numero || ' de serviços extras cancelado: ' || trim(p_motivo), 500)
     where id = rc.lancamento_id and situacao <> 'cancelado';
  end if;
  update public.hotel_extras_recibos
     set cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 300)
   where id = rc.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Recibos do período com a situação do Financeiro (a recepção não lê o
-- Financeiro: aqui ela vê só se o recibo está pago, a receber ou vencido)
-- -----------------------------------------------------------------------------
create or replace function public.hotel_extras_recibos_listar(p_empresa_id uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then
    raise exception 'Período inválido.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'numero', r.numero, 'data', r.data, 'total', r.total, 'pagamento', r.pagamento, 'forma', r.forma,
      'vencimento', r.vencimento, 'solicitante', r.solicitante, 'observacao', r.observacao,
      'cancelado_em', r.cancelado_em, 'motivo_cancelamento', r.motivo_cancelamento,
      'empresa', c.nome, 'documento', c.documento,
      'lancado_por', p.nome,
      'situacao', case
        when r.cancelado_em is not null then 'cancelado'
        when l.situacao = 'quitado' then 'pago'
        when l.situacao = 'parcial' then 'parcial'
        when r.vencimento < app.hoje() then 'vencido'
        else 'a_receber' end,
      'pago_em', l.data_ultimo_pagamento,
      'itens', (select jsonb_agg(jsonb_build_object('descricao', i.descricao, 'unidade', i.unidade, 'quantidade', i.quantidade,
                                                    'valor_unitario', i.valor_unitario, 'total', i.total) order by i.total desc)
                  from public.hotel_extras_recibo_itens i where i.recibo_id = r.id)
    ) order by r.numero desc)
      from public.hotel_extras_recibos r
      join public.contrapartes c on c.id = r.contraparte_id
      left join public.lancamentos l on l.id = r.lancamento_id
      left join public.perfis p on p.id = r.lancado_por
     where r.empresa_id = p_empresa_id and r.data between p_de and p_ate
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.hotel_extras_recibo_lancar(uuid, jsonb), public.hotel_extras_recibo_cancelar(uuid, text),
  public.hotel_extras_recibos_listar(uuid, date, date) from public, anon;
grant execute on function public.hotel_extras_recibo_lancar(uuid, jsonb), public.hotel_extras_recibo_cancelar(uuid, text),
  public.hotel_extras_recibos_listar(uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Caixa do dia: o recebido na hora pelos recibos de serviços extras entra
-- nos recebimentos do hotel (e o dinheiro, na gaveta esperada)
-- -----------------------------------------------------------------------------
create or replace function app.caixa_resumo(p_sessao_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.caixa_sessoes where id = p_sessao_id
  ), v as (
    select * from public.vendas where sessao_id = p_sessao_id and tipo = 'venda'
  ), pg as (
    select p.forma, sum(p.valor) as valor, count(distinct p.venda_id) as vendas
      from public.venda_pagamentos p join v on v.id = p.venda_id and v.status = 'concluida'
     group by p.forma
  ), h as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from (
        select forma, valor from public.hotel_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
        union all
        select forma, total from public.hotel_extras_recibos where sessao_id = p_sessao_id and cancelado_em is null
      ) t
     group by forma
  ), cl as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from public.vet_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
     group by forma
  ), m as (
    select coalesce(sum(valor) filter (where tipo = 'sangria'), 0) as sangrias,
           coalesce(sum(valor) filter (where tipo = 'suprimento'), 0) as suprimentos,
           count(*) filter (where tipo = 'sangria') as qtd_sangrias,
           count(*) filter (where tipo = 'suprimento') as qtd_suprimentos
      from public.caixa_movimentos where sessao_id = p_sessao_id
  )
  select jsonb_build_object(
    'abertura', s.valor_abertura,
    'vendas_quantidade', (select count(*) from v where status = 'concluida'),
    'vendas_total', (select coalesce(sum(total), 0) from v where status = 'concluida'),
    'descontos', (select coalesce(sum(desconto), 0) from v where status = 'concluida'),
    'troco', (select coalesce(sum(troco), 0) from v where status = 'concluida'),
    'canceladas_quantidade', (select count(*) from v where status = 'cancelada'),
    'canceladas_total', (select coalesce(sum(total), 0) from v where status = 'cancelada'),
    'por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'vendas', vendas)) from pg), '{}'::jsonb),
    'hotel_quantidade', (select coalesce(sum(quantidade), 0) from h),
    'hotel_total', (select coalesce(sum(valor), 0) from h),
    'hotel_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from h), '{}'::jsonb),
    'clinica_quantidade', (select coalesce(sum(quantidade), 0) from cl),
    'clinica_total', (select coalesce(sum(valor), 0) from cl),
    'clinica_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from cl), '{}'::jsonb),
    'sangrias', m.sangrias,
    'suprimentos', m.suprimentos,
    'qtd_sangrias', m.qtd_sangrias,
    'qtd_suprimentos', m.qtd_suprimentos,
    'dinheiro_esperado', s.valor_abertura + coalesce((select valor from pg where forma = 'dinheiro'), 0)
      + coalesce((select valor from h where forma = 'dinheiro'), 0) + coalesce((select valor from cl where forma = 'dinheiro'), 0)
      + m.suprimentos - m.sangrias
  )
  from s, m;
$$;
