-- =============================================================================
-- Migração 0700: gestão financeira
-- =============================================================================
-- Regras de negócio garantidas no banco:
--   * Toda referência entre registros é validada dentro da MESMA empresa
--     (chaves estrangeiras compostas empresa_id + id).
--   * Receitas e despesas só existem como LANÇAMENTOS confirmados. Documentos e
--     movimentações bancárias nunca geram resultado sozinhos.
--   * Transferências entre contas da empresa (inclusive pagamento de fatura de
--     cartão) ficam em tabela própria e nunca entram no resultado.
--   * Aportes, empréstimos recebidos, amortizações de principal, retiradas e
--     despesas pessoais dos sócios têm tipos de categoria próprios, fora da DRE.
--   * Baixas separam principal, juros, multa, desconto e taxas.
--   * Competências fechadas bloqueiam alterações.
-- =============================================================================

alter table public.documentos add constraint documentos_empresa_id_unico unique (empresa_id, id);

-- -----------------------------------------------------------------------------
-- Contas financeiras (bancos, caixa, cartões, adquirentes)
-- -----------------------------------------------------------------------------
create table public.contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('conta_corrente', 'poupanca', 'investimento', 'caixa', 'cartao_credito', 'adquirente', 'outra')),
  nome text not null check (length(trim(nome)) > 0),
  banco_codigo text,
  banco_nome text,
  agencia text,
  numero text,
  saldo_inicial numeric(15,2) not null default 0,
  saldo_inicial_data date not null,            -- saldo ao FINAL deste dia
  cartao_dia_fechamento int check (cartao_dia_fechamento between 1 and 31),
  cartao_dia_vencimento int check (cartao_dia_vencimento between 1 and 31),
  cartao_conta_pagamento_id uuid,
  limite numeric(15,2),
  compoe_saldo_disponivel boolean not null default true,
  ativa boolean not null default true,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contas_financeiras_empresa_id_unico unique (empresa_id, id),
  constraint contas_financeiras_pagamento_fk foreign key (empresa_id, cartao_conta_pagamento_id)
    references public.contas_financeiras (empresa_id, id)
);
create index contas_financeiras_empresa_idx on public.contas_financeiras (empresa_id) where ativa;
create trigger contas_financeiras_updated_at before update on public.contas_financeiras
  for each row execute function app.tg_updated_at();
create trigger auditoria_contas_financeiras after insert or update or delete on public.contas_financeiras
  for each row execute function app.tg_auditoria();

alter table public.checklist_modelos add constraint checklist_modelos_conta_fk
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id) on delete cascade;
alter table public.checklist_itens add constraint checklist_itens_conta_fk
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id);

-- Cartões e adquirentes não compõem o saldo disponível por padrão.
create or replace function app.tg_contas_financeiras_padrao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.tipo in ('cartao_credito', 'adquirente') then
    new.compoe_saldo_disponivel := false;
  end if;
  if new.tipo = 'cartao_credito' and new.cartao_conta_pagamento_id = new.id then
    raise exception 'A conta de pagamento da fatura deve ser outra conta.';
  end if;
  if tg_op = 'UPDATE' and (new.saldo_inicial is distinct from old.saldo_inicial or new.saldo_inicial_data is distinct from old.saldo_inicial_data) then
    perform app.exigir_competencia_aberta(new.empresa_id, old.saldo_inicial_data);
    perform app.exigir_competencia_aberta(new.empresa_id, new.saldo_inicial_data);
  end if;
  return new;
end;
$$;
create trigger contas_financeiras_padrao before insert or update on public.contas_financeiras
  for each row execute function app.tg_contas_financeiras_padrao();

-- -----------------------------------------------------------------------------
-- Plano de contas gerencial
-- -----------------------------------------------------------------------------
create or replace function app.natureza_tipo_categoria(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_tipo in ('receita_operacional', 'receita_financeira', 'outras_receitas', 'aporte_socio', 'emprestimo_captacao') then 'receita'
    else 'despesa'
  end;
$$;

create table public.categorias_financeiras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  tipo text not null check (tipo in (
    'receita_operacional', 'deducao_receita', 'custo_mercadoria', 'custo_servico', 'despesa_operacional',
    'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro',
    'investimento', 'aporte_socio', 'retirada_socio', 'despesa_pessoal_socio',
    'emprestimo_captacao', 'emprestimo_amortizacao'
  )),
  natureza text generated always as (app.natureza_tipo_categoria(tipo)) stored,
  pai_id uuid,
  sintetica boolean not null default false,       -- agrupadora: não recebe lançamentos
  codigo_sistema text,                            -- categorias usadas automaticamente (juros, taxas...)
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categorias_financeiras_empresa_id_unico unique (empresa_id, id),
  constraint categorias_financeiras_codigo_unico unique (empresa_id, codigo),
  constraint categorias_financeiras_sistema_unico unique (empresa_id, codigo_sistema),
  constraint categorias_financeiras_pai_fk foreign key (empresa_id, pai_id)
    references public.categorias_financeiras (empresa_id, id)
);
create index categorias_financeiras_empresa_idx on public.categorias_financeiras (empresa_id) where ativa;
create trigger categorias_financeiras_updated_at before update on public.categorias_financeiras
  for each row execute function app.tg_updated_at();
create trigger auditoria_categorias_financeiras after insert or update or delete on public.categorias_financeiras
  for each row execute function app.tg_auditoria();

create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text,
  nome text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint centros_custo_empresa_id_unico unique (empresa_id, id),
  constraint centros_custo_nome_unico unique (empresa_id, nome)
);

create table public.projetos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text,
  nome text not null,
  inicio date,
  fim date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  constraint projetos_empresa_id_unico unique (empresa_id, id),
  constraint projetos_nome_unico unique (empresa_id, nome)
);

-- Clientes, fornecedores, sócios e demais contrapartes
create table public.contrapartes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) > 0),
  documento text,                                -- CPF/CNPJ somente dígitos
  tipo_pessoa text check (tipo_pessoa in ('PF', 'PJ')),
  papeis text[] not null default array['fornecedor']::text[]
    check (papeis <@ array['cliente', 'fornecedor', 'socio', 'funcionario', 'banco', 'governo', 'outro']::text[]),
  email text,
  telefone text,
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contrapartes_empresa_id_unico unique (empresa_id, id),
  constraint contrapartes_documento_digitos check (documento is null or documento ~ '^[0-9]{11}$|^[0-9]{14}$')
);
create unique index contrapartes_documento_unico on public.contrapartes (empresa_id, documento) where documento is not null;
create index contrapartes_nome_idx on public.contrapartes using gin (app.normalizar(nome) extensions.gin_trgm_ops);
create trigger contrapartes_updated_at before update on public.contrapartes
  for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- Recorrências
-- -----------------------------------------------------------------------------
create table public.recorrencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('receber', 'pagar')),
  descricao text not null,
  categoria_id uuid not null,
  contraparte_id uuid,
  centro_custo_id uuid,
  projeto_id uuid,
  conta_financeira_id uuid,
  valor numeric(15,2) not null check (valor > 0),
  frequencia text not null default 'mensal' check (frequencia in ('semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual')),
  dia_vencimento int check (dia_vencimento between 1 and 31),
  data_inicio date not null,
  data_fim date,
  meses_a_frente int not null default 3 check (meses_a_frente between 1 and 24),
  ativa boolean not null default true,
  ultima_data_gerada date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recorrencias_empresa_id_unico unique (empresa_id, id),
  foreign key (empresa_id, categoria_id) references public.categorias_financeiras (empresa_id, id),
  foreign key (empresa_id, contraparte_id) references public.contrapartes (empresa_id, id),
  foreign key (empresa_id, centro_custo_id) references public.centros_custo (empresa_id, id),
  foreign key (empresa_id, projeto_id) references public.projetos (empresa_id, id),
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id)
);
create trigger recorrencias_updated_at before update on public.recorrencias
  for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- Lançamentos (contas a pagar e a receber)
-- -----------------------------------------------------------------------------
create table public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  tipo text not null check (tipo in ('receber', 'pagar')),
  descricao text not null check (length(trim(descricao)) > 0),
  categoria_id uuid,
  contraparte_id uuid,
  centro_custo_id uuid,
  projeto_id uuid,
  conta_financeira_id uuid,                     -- conta prevista
  data_competencia date not null,
  data_vencimento date not null,
  valor_previsto numeric(15,2) not null check (valor_previsto > 0),
  -- Campos derivados das baixas (mantidos por gatilho)
  valor_baixado numeric(15,2) not null default 0,
  valor_realizado numeric(15,2) not null default 0,
  data_ultimo_pagamento date,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'parcial', 'quitado', 'cancelado')),
  -- Revisão: registros sugeridos (ex.: a partir de XML) não entram nos relatórios
  status_revisao text not null default 'confirmado' check (status_revisao in ('sugerido', 'confirmado')),
  origem text not null default 'manual' check (origem in (
    'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha', 'cartao'
  )),
  origem_referencia text,
  documento_fiscal_id uuid,
  importacao_id uuid,
  recorrencia_id uuid,
  parcelamento_id uuid,
  parcela_numero int,
  parcela_total int,
  numero_documento text,
  observacoes text,
  cancelado_em timestamptz,
  cancelado_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text,
  confirmado_por uuid references public.perfis(id) on delete set null,
  confirmado_em timestamptz,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lancamentos_empresa_id_unico unique (empresa_id, id),
  constraint lancamentos_categoria_obrigatoria check (status_revisao = 'sugerido' or situacao = 'cancelado' or categoria_id is not null),
  constraint lancamentos_parcela check (parcela_numero is null or (parcela_numero >= 1 and parcela_total >= parcela_numero)),
  foreign key (empresa_id, categoria_id) references public.categorias_financeiras (empresa_id, id),
  foreign key (empresa_id, contraparte_id) references public.contrapartes (empresa_id, id),
  foreign key (empresa_id, centro_custo_id) references public.centros_custo (empresa_id, id),
  foreign key (empresa_id, projeto_id) references public.projetos (empresa_id, id),
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, recorrencia_id) references public.recorrencias (empresa_id, id) on delete set null (recorrencia_id)
);
create index lancamentos_empresa_venc_idx on public.lancamentos (empresa_id, data_vencimento) where situacao in ('aberto', 'parcial');
create index lancamentos_empresa_comp_idx on public.lancamentos (empresa_id, data_competencia);
create index lancamentos_categoria_idx on public.lancamentos (categoria_id);
create index lancamentos_contraparte_idx on public.lancamentos (contraparte_id);
create index lancamentos_parcelamento_idx on public.lancamentos (parcelamento_id);
create index lancamentos_importacao_idx on public.lancamentos (importacao_id);
create index lancamentos_descricao_idx on public.lancamentos using gin (app.normalizar(descricao) extensions.gin_trgm_ops);
create unique index lancamentos_recorrencia_unica on public.lancamentos (recorrencia_id, data_vencimento) where recorrencia_id is not null;
create trigger lancamentos_updated_at before update on public.lancamentos
  for each row execute function app.tg_updated_at();
create trigger auditoria_lancamentos after insert or update or delete on public.lancamentos
  for each row execute function app.tg_auditoria();

-- Documentos vinculados aos lançamentos (nota, comprovante, boleto, contrato...)
create table public.lancamento_documentos (
  lancamento_id uuid not null,
  documento_id uuid not null,
  empresa_id uuid not null,
  tipo_vinculo text not null default 'comprovante' check (tipo_vinculo in ('nota_fiscal', 'comprovante', 'boleto', 'contrato', 'outro')),
  vinculado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  vinculado_em timestamptz not null default now(),
  primary key (lancamento_id, documento_id),
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, documento_id) references public.documentos (empresa_id, id) on delete cascade
);
create index lancamento_documentos_documento_idx on public.lancamento_documentos (documento_id);

-- -----------------------------------------------------------------------------
-- Baixas: pagamentos e recebimentos (inclusive parciais)
-- -----------------------------------------------------------------------------
create table public.baixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  lancamento_id uuid not null,
  tipo text not null check (tipo in ('receber', 'pagar')),   -- copiado do lançamento
  data_pagamento date not null,
  conta_financeira_id uuid not null,
  valor_principal numeric(15,2) not null check (valor_principal > 0),
  juros numeric(15,2) not null default 0 check (juros >= 0),
  multa numeric(15,2) not null default 0 check (multa >= 0),
  desconto numeric(15,2) not null default 0 check (desconto >= 0),
  taxas numeric(15,2) not null default 0 check (taxas >= 0),
  -- Valor que efetivamente entrou (receber) ou saiu (pagar) da conta.
  valor_total numeric(15,2) generated always as (
    valor_principal + juros + multa - desconto + case when tipo = 'pagar' then taxas else -taxas end
  ) stored,
  forma_pagamento text check (forma_pagamento in ('pix', 'boleto', 'transferencia', 'cartao_credito', 'cartao_debito', 'dinheiro', 'cheque', 'debito_automatico', 'outro')),
  observacao text,
  origem text not null default 'manual' check (origem in ('manual', 'conciliacao', 'importacao', 'maquininha', 'cartao')),
  conciliacao_id uuid,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint baixas_empresa_id_unico unique (empresa_id, id),
  constraint baixas_valor_total_positivo check (
    valor_principal + juros + multa - desconto + case when tipo = 'pagar' then taxas else -taxas end > 0
  ),
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id)
);
create index baixas_lancamento_idx on public.baixas (lancamento_id);
create index baixas_conta_data_idx on public.baixas (conta_financeira_id, data_pagamento);
create index baixas_empresa_data_idx on public.baixas (empresa_id, data_pagamento);
create index baixas_conciliacao_idx on public.baixas (conciliacao_id);
create trigger auditoria_baixas after insert or update or delete on public.baixas
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- Transferências entre contas da mesma empresa (não são receita nem despesa)
-- -----------------------------------------------------------------------------
create table public.transferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  conta_origem_id uuid not null,
  conta_destino_id uuid not null,
  data date not null,
  valor numeric(15,2) not null check (valor > 0),
  tipo text not null default 'transferencia' check (tipo in ('transferencia', 'pagamento_fatura_cartao', 'aplicacao', 'resgate', 'repasse_adquirente')),
  descricao text,
  origem text not null default 'manual' check (origem in ('manual', 'conciliacao', 'importacao')),
  conciliacao_id uuid,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint transferencias_empresa_id_unico unique (empresa_id, id),
  constraint transferencias_contas_distintas check (conta_origem_id <> conta_destino_id),
  foreign key (empresa_id, conta_origem_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, conta_destino_id) references public.contas_financeiras (empresa_id, id)
);
create index transferencias_empresa_data_idx on public.transferencias (empresa_id, data);
create index transferencias_origem_idx on public.transferencias (conta_origem_id, data);
create index transferencias_destino_idx on public.transferencias (conta_destino_id, data);
create trigger auditoria_transferencias after insert or update or delete on public.transferencias
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- Estoque (para cálculo do CMV quando disponível)
-- -----------------------------------------------------------------------------
create table public.estoques (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  valor_estoque_final numeric(15,2) not null check (valor_estoque_final >= 0),
  fonte text,
  observacao text,
  documento_id uuid,
  informado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint estoques_unico unique (empresa_id, competencia),
  foreign key (empresa_id, documento_id) references public.documentos (empresa_id, id)
);
create trigger auditoria_estoques after insert or update or delete on public.estoques
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- Gatilhos de integridade e bloqueio por competência fechada
-- -----------------------------------------------------------------------------
create or replace function app.tg_lancamentos_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.categorias_financeiras;
  v_old jsonb;
  v_new jsonb;
  v_livres text[] := array['valor_baixado', 'valor_realizado', 'data_ultimo_pagamento', 'situacao', 'updated_at', 'observacoes'];
begin
  if tg_op = 'DELETE' then
    perform app.exigir_competencia_aberta(old.empresa_id, old.data_competencia);
    if exists (select 1 from public.baixas where lancamento_id = old.id) then
      raise exception 'Este lançamento possui pagamentos/recebimentos. Estorne as baixas antes de excluir.';
    end if;
    return old;
  end if;

  new.descricao := trim(new.descricao);

  if new.categoria_id is not null then
    select * into v_cat from public.categorias_financeiras where id = new.categoria_id;
    if v_cat.sintetica then
      raise exception 'A categoria "%" é apenas agrupadora. Escolha uma subcategoria.', v_cat.nome;
    end if;
    if (new.tipo = 'receber' and v_cat.natureza <> 'receita') or (new.tipo = 'pagar' and v_cat.natureza <> 'despesa') then
      raise exception 'A categoria "%" não é compatível com conta a %.', v_cat.nome, case when new.tipo = 'receber' then 'receber' else 'pagar' end;
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform app.exigir_competencia_aberta(new.empresa_id, new.data_competencia);
    if auth.uid() is not null then
      new.criado_por := auth.uid();
    end if;
    new.valor_baixado := 0;
    new.valor_realizado := 0;
    new.data_ultimo_pagamento := null;
    if new.situacao <> 'cancelado' then
      new.situacao := 'aberto';
    end if;
    if new.status_revisao = 'confirmado' then
      new.confirmado_por := coalesce(new.confirmado_por, auth.uid());
      new.confirmado_em := coalesce(new.confirmado_em, now());
    end if;
    return new;
  end if;

  -- UPDATE
  if new.tipo <> old.tipo and old.valor_baixado > 0 then
    raise exception 'Não é possível mudar o tipo de um lançamento com baixas.';
  end if;
  v_old := to_jsonb(old) - v_livres;
  v_new := to_jsonb(new) - v_livres;
  if v_old <> v_new or (new.situacao = 'cancelado') <> (old.situacao = 'cancelado') then
    perform app.exigir_competencia_aberta(old.empresa_id, old.data_competencia);
    perform app.exigir_competencia_aberta(new.empresa_id, new.data_competencia);
  end if;
  if new.valor_previsto < old.valor_baixado then
    raise exception 'O valor previsto não pode ser menor que o total já baixado (%).', old.valor_baixado;
  end if;
  if new.situacao = 'cancelado' and old.situacao <> 'cancelado' then
    if old.valor_baixado > 0 then
      raise exception 'Estorne as baixas antes de cancelar o lançamento.';
    end if;
    new.cancelado_em := now();
    new.cancelado_por := auth.uid();
  elsif old.situacao = 'cancelado' and new.situacao <> 'cancelado' then
    new.cancelado_em := null;
    new.cancelado_por := null;
    new.motivo_cancelamento := null;
    new.situacao := 'aberto';
  end if;
  if new.status_revisao = 'confirmado' and old.status_revisao = 'sugerido' then
    new.confirmado_por := auth.uid();
    new.confirmado_em := now();
  end if;
  if new.status_revisao = 'sugerido' and old.status_revisao = 'confirmado' and old.valor_baixado > 0 then
    raise exception 'Lançamento com baixas não pode voltar a ser sugestão.';
  end if;
  -- Situação derivada (exceto cancelamento)
  if new.situacao <> 'cancelado' then
    new.situacao := case
      when new.valor_baixado <= 0 then 'aberto'
      when new.valor_baixado < new.valor_previsto then 'parcial'
      else 'quitado'
    end;
  end if;
  return new;
end;
$$;
create trigger lancamentos_regras before insert or update or delete on public.lancamentos
  for each row execute function app.tg_lancamentos_regras();

create or replace function app.tg_baixas_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lanc public.lancamentos;
  v_baixado numeric(15,2);
begin
  if tg_op = 'DELETE' then
    perform app.exigir_competencia_aberta(old.empresa_id, old.data_pagamento);
    return old;
  end if;

  select * into v_lanc from public.lancamentos where id = new.lancamento_id for update;
  if v_lanc.situacao = 'cancelado' then
    raise exception 'Lançamento cancelado não pode receber baixa.';
  end if;
  if v_lanc.status_revisao <> 'confirmado' then
    raise exception 'Confirme o lançamento sugerido antes de registrar o pagamento/recebimento.';
  end if;
  new.tipo := v_lanc.tipo;

  if tg_op = 'UPDATE' then
    perform app.exigir_competencia_aberta(old.empresa_id, old.data_pagamento);
    if new.lancamento_id <> old.lancamento_id then
      raise exception 'Não é possível mover uma baixa para outro lançamento.';
    end if;
  end if;
  perform app.exigir_competencia_aberta(new.empresa_id, new.data_pagamento);

  select coalesce(sum(valor_principal), 0) into v_baixado
    from public.baixas
   where lancamento_id = new.lancamento_id
     and (tg_op = 'INSERT' or id <> new.id);
  if v_baixado + new.valor_principal > v_lanc.valor_previsto then
    raise exception 'O valor (R$ %) ultrapassa o saldo em aberto do lançamento (R$ %).',
      to_char(new.valor_principal, 'FM999G999G999G990D00'), to_char(v_lanc.valor_previsto - v_baixado, 'FM999G999G999G990D00');
  end if;
  return new;
end;
$$;
create trigger baixas_regras before insert or update or delete on public.baixas
  for each row execute function app.tg_baixas_regras();

-- Atualiza os campos derivados do lançamento após mudanças nas baixas.
create or replace function app.atualizar_saldos_lancamento(p_lancamento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lancamentos l
     set valor_baixado = coalesce(b.principal, 0),
         valor_realizado = coalesce(b.total, 0),
         data_ultimo_pagamento = b.ultima
    from (
      select sum(valor_principal) as principal, sum(valor_total) as total, max(data_pagamento) as ultima
        from public.baixas where lancamento_id = p_lancamento_id
    ) b
   where l.id = p_lancamento_id;
end;
$$;

create or replace function app.tg_baixas_pos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.atualizar_saldos_lancamento(old.lancamento_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.atualizar_saldos_lancamento(new.lancamento_id);
  end if;
  return null;
end;
$$;
create trigger baixas_pos after insert or update or delete on public.baixas
  for each row execute function app.tg_baixas_pos();

create or replace function app.tg_transferencias_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destino text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.exigir_competencia_aberta(old.empresa_id, old.data);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  perform app.exigir_competencia_aberta(new.empresa_id, new.data);
  select tipo into v_destino from public.contas_financeiras where id = new.conta_destino_id;
  if v_destino = 'cartao_credito' and new.tipo = 'transferencia' then
    new.tipo := 'pagamento_fatura_cartao';
  end if;
  return new;
end;
$$;
create trigger transferencias_regras before insert or update or delete on public.transferencias
  for each row execute function app.tg_transferencias_regras();

create or replace function app.tg_estoques_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.exigir_competencia_aberta(old.empresa_id, old.competencia);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  perform app.exigir_competencia_aberta(new.empresa_id, new.competencia);
  return new;
end;
$$;
create trigger estoques_regras before insert or update or delete on public.estoques
  for each row execute function app.tg_estoques_regras();

-- -----------------------------------------------------------------------------
-- Plano de contas padrão
-- -----------------------------------------------------------------------------
create or replace function app.criar_plano_contas_padrao(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, sintetica, codigo_sistema)
  values
    (p_empresa_id, '1', 'Receitas operacionais', 'receita_operacional', true, null),
    (p_empresa_id, '1.01', 'Vendas de mercadorias e produtos', 'receita_operacional', false, 'VENDAS'),
    (p_empresa_id, '1.02', 'Prestação de serviços', 'receita_operacional', false, 'SERVICOS'),
    (p_empresa_id, '1.03', 'Outras receitas operacionais', 'receita_operacional', false, null),
    (p_empresa_id, '2', 'Deduções da receita', 'deducao_receita', true, null),
    (p_empresa_id, '2.01', 'Impostos sobre vendas e serviços (Simples, ISS, ICMS, PIS, COFINS)', 'deducao_receita', false, 'IMPOSTOS_VENDAS'),
    (p_empresa_id, '2.02', 'Devoluções e cancelamentos de vendas', 'deducao_receita', false, null),
    (p_empresa_id, '2.03', 'Descontos concedidos', 'deducao_receita', false, 'DESCONTOS_CONCEDIDOS'),
    (p_empresa_id, '3', 'Custos', 'custo_mercadoria', true, null),
    (p_empresa_id, '3.01', 'Compras de mercadorias para revenda', 'custo_mercadoria', false, 'COMPRAS_MERCADORIAS'),
    (p_empresa_id, '3.02', 'Matéria-prima e insumos', 'custo_mercadoria', false, null),
    (p_empresa_id, '3.03', 'Fretes sobre compras', 'custo_mercadoria', false, null),
    (p_empresa_id, '3.04', 'Custos diretos dos serviços prestados', 'custo_servico', false, null),
    (p_empresa_id, '4', 'Despesas operacionais', 'despesa_operacional', true, null),
    (p_empresa_id, '4.01', 'Salários e encargos', 'despesa_operacional', false, null),
    (p_empresa_id, '4.02', 'Pró-labore', 'despesa_operacional', false, null),
    (p_empresa_id, '4.03', 'Benefícios (vale-transporte, alimentação, saúde)', 'despesa_operacional', false, null),
    (p_empresa_id, '4.04', 'Aluguel e condomínio', 'despesa_operacional', false, null),
    (p_empresa_id, '4.05', 'Energia, água, telefone e internet', 'despesa_operacional', false, null),
    (p_empresa_id, '4.06', 'Honorários contábeis e serviços profissionais', 'despesa_operacional', false, null),
    (p_empresa_id, '4.07', 'Marketing e publicidade', 'despesa_operacional', false, null),
    (p_empresa_id, '4.08', 'Material de escritório, limpeza e consumo', 'despesa_operacional', false, null),
    (p_empresa_id, '4.09', 'Manutenção e conservação', 'despesa_operacional', false, null),
    (p_empresa_id, '4.10', 'Combustível, viagens e deslocamentos', 'despesa_operacional', false, null),
    (p_empresa_id, '4.11', 'Sistemas, softwares e assinaturas', 'despesa_operacional', false, null),
    (p_empresa_id, '4.12', 'Impostos, taxas e contribuições (IPTU, alvarás, sindicais)', 'despesa_operacional', false, null),
    (p_empresa_id, '4.99', 'Outras despesas operacionais', 'despesa_operacional', false, null),
    (p_empresa_id, '5', 'Resultado financeiro', 'receita_financeira', true, null),
    (p_empresa_id, '5.01', 'Rendimentos de aplicações financeiras', 'receita_financeira', false, 'RENDIMENTOS'),
    (p_empresa_id, '5.02', 'Juros e multas recebidos', 'receita_financeira', false, 'JUROS_RECEBIDOS'),
    (p_empresa_id, '5.03', 'Descontos obtidos', 'receita_financeira', false, 'DESCONTOS_OBTIDOS'),
    (p_empresa_id, '5.04', 'Tarifas bancárias', 'despesa_financeira', false, 'TARIFAS_BANCARIAS'),
    (p_empresa_id, '5.05', 'Juros e multas pagos', 'despesa_financeira', false, 'JUROS_PAGOS'),
    (p_empresa_id, '5.06', 'Juros de empréstimos e financiamentos', 'despesa_financeira', false, 'JUROS_EMPRESTIMOS'),
    (p_empresa_id, '5.07', 'Taxas de cartão, maquininhas e plataformas', 'despesa_financeira', false, 'TAXAS_CARTAO'),
    (p_empresa_id, '5.08', 'IOF', 'despesa_financeira', false, null),
    (p_empresa_id, '6', 'Outras receitas e despesas', 'outras_receitas', true, null),
    (p_empresa_id, '6.01', 'Outras receitas não operacionais', 'outras_receitas', false, null),
    (p_empresa_id, '6.02', 'Venda de bens do ativo imobilizado', 'outras_receitas', false, null),
    (p_empresa_id, '6.03', 'Outras despesas não operacionais', 'outras_despesas', false, null),
    (p_empresa_id, '7', 'Impostos sobre o lucro', 'impostos_lucro', true, null),
    (p_empresa_id, '7.01', 'IRPJ e CSLL', 'impostos_lucro', false, 'IRPJ_CSLL'),
    (p_empresa_id, '8', 'Movimentações fora do resultado', 'aporte_socio', true, null),
    (p_empresa_id, '8.01', 'Aporte de capital dos sócios', 'aporte_socio', false, 'APORTE'),
    (p_empresa_id, '8.02', 'Empréstimos e financiamentos recebidos', 'emprestimo_captacao', false, 'EMPRESTIMO_CAPTACAO'),
    (p_empresa_id, '8.03', 'Amortização de empréstimos e financiamentos (principal)', 'emprestimo_amortizacao', false, 'EMPRESTIMO_AMORTIZACAO'),
    (p_empresa_id, '8.04', 'Distribuição de lucros e retiradas dos sócios', 'retirada_socio', false, 'RETIRADA'),
    (p_empresa_id, '8.05', 'Despesas pessoais dos sócios pagas pela empresa', 'despesa_pessoal_socio', false, 'DESPESA_PESSOAL'),
    (p_empresa_id, '8.06', 'Investimentos em imobilizado (máquinas, veículos, reformas)', 'investimento', false, 'INVESTIMENTO')
  on conflict (empresa_id, codigo) do nothing;
  get diagnostics v_n = row_count;

  -- Vincula as subcategorias ao grupo (código antes do ponto).
  update public.categorias_financeiras c
     set pai_id = g.id
    from public.categorias_financeiras g
   where c.empresa_id = p_empresa_id
     and g.empresa_id = p_empresa_id
     and c.pai_id is null
     and position('.' in c.codigo) > 0
     and g.codigo = split_part(c.codigo, '.', 1);
  return v_n;
end;
$$;

create or replace function app.categoria_sistema(p_empresa_id uuid, p_codigo text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.categorias_financeiras where empresa_id = p_empresa_id and codigo_sistema = p_codigo;
$$;

-- -----------------------------------------------------------------------------
-- RPCs financeiros
-- -----------------------------------------------------------------------------

-- Configuração inicial de uma empresa (plano de contas + checklist padrão).
create or replace function public.configurar_empresa_padrao(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat int;
  v_mod int;
begin
  if not (app.pode(p_empresa_id, 'checklist.gerenciar') or app.is_admin()) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  v_cat := app.criar_plano_contas_padrao(p_empresa_id);
  v_mod := app.criar_modelos_padrao(p_empresa_id);
  return jsonb_build_object('categorias_criadas', v_cat, 'modelos', v_mod);
end;
$$;

-- Saldo de uma conta ao final do dia informado (visão do sistema).
create or replace function public.saldo_conta(p_conta_id uuid, p_data date)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select c.saldo_inicial
       + coalesce((select sum(case when b.tipo = 'receber' then b.valor_total else -b.valor_total end)
                     from public.baixas b
                    where b.conta_financeira_id = c.id
                      and b.data_pagamento > c.saldo_inicial_data
                      and b.data_pagamento <= p_data), 0)
       + coalesce((select sum(t.valor) from public.transferencias t
                    where t.conta_destino_id = c.id and t.data > c.saldo_inicial_data and t.data <= p_data), 0)
       - coalesce((select sum(t.valor) from public.transferencias t
                    where t.conta_origem_id = c.id and t.data > c.saldo_inicial_data and t.data <= p_data), 0)
    from public.contas_financeiras c
   where c.id = p_conta_id
     and p_data >= c.saldo_inicial_data;
$$;

-- Cria parcelas com divisão exata em centavos (a diferença fica na última).
create or replace function public.criar_parcelamento(
  p_empresa_id uuid,
  p_tipo text,
  p_descricao text,
  p_categoria_id uuid,
  p_valor_total numeric,
  p_parcelas int,
  p_primeiro_vencimento date,
  p_data_competencia date,
  p_competencia_por_parcela boolean default false,
  p_contraparte_id uuid default null,
  p_centro_custo_id uuid default null,
  p_projeto_id uuid default null,
  p_conta_financeira_id uuid default null,
  p_numero_documento text default null,
  p_observacoes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grupo uuid := gen_random_uuid();
  v_base numeric(15,2);
  v_valor numeric(15,2);
  v_venc date;
  i int;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_parcelas is null or p_parcelas < 2 or p_parcelas > 360 then
    raise exception 'Informe entre 2 e 360 parcelas.';
  end if;
  if p_valor_total is null or p_valor_total <= 0 then
    raise exception 'Valor total inválido.';
  end if;
  v_base := trunc(p_valor_total / p_parcelas, 2);
  if v_base <= 0 then
    raise exception 'Valor por parcela menor que R$ 0,01.';
  end if;
  for i in 1..p_parcelas loop
    v_valor := case when i = p_parcelas then p_valor_total - v_base * (p_parcelas - 1) else v_base end;
    v_venc := (p_primeiro_vencimento + make_interval(months => i - 1))::date;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id,
      data_competencia, data_vencimento, valor_previsto, origem, parcelamento_id, parcela_numero, parcela_total,
      numero_documento, observacoes
    ) values (
      p_empresa_id, p_tipo, trim(p_descricao) || ' (' || i || '/' || p_parcelas || ')', p_categoria_id, p_contraparte_id,
      p_centro_custo_id, p_projeto_id, p_conta_financeira_id,
      case when p_competencia_por_parcela then v_venc else p_data_competencia end,
      v_venc, v_valor, 'parcelamento', v_grupo, i, p_parcelas, p_numero_documento, p_observacoes
    );
  end loop;
  return v_grupo;
end;
$$;

-- Venda em maquininha/plataforma: separa venda bruta, taxa e valor líquido recebido.
create or replace function public.registrar_venda_maquininha(
  p_empresa_id uuid,
  p_descricao text,
  p_data_venda date,
  p_data_recebimento date,
  p_valor_bruto numeric,
  p_taxa numeric,
  p_conta_recebimento_id uuid,
  p_categoria_receita_id uuid,
  p_contraparte_id uuid default null,
  p_centro_custo_id uuid default null,
  p_recebido boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_valor_bruto is null or p_valor_bruto <= 0 then
    raise exception 'Informe o valor bruto da venda.';
  end if;
  if p_taxa is null or p_taxa < 0 or p_taxa >= p_valor_bruto then
    raise exception 'A taxa deve ser maior ou igual a zero e menor que o valor bruto.';
  end if;
  insert into public.lancamentos (
    empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, conta_financeira_id,
    data_competencia, data_vencimento, valor_previsto, origem
  ) values (
    p_empresa_id, 'receber', trim(p_descricao), p_categoria_receita_id, p_contraparte_id, p_centro_custo_id,
    p_conta_recebimento_id, p_data_venda, coalesce(p_data_recebimento, p_data_venda), p_valor_bruto, 'maquininha'
  ) returning id into v_id;
  if p_recebido then
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, taxas, forma_pagamento, origem)
    values (p_empresa_id, v_id, 'receber', coalesce(p_data_recebimento, p_data_venda), p_conta_recebimento_id,
            p_valor_bruto, p_taxa, 'cartao_credito', 'maquininha');
  end if;
  return v_id;
end;
$$;

-- Compra no cartão de crédito: a despesa é reconhecida na compra; a fatura,
-- quando paga, é uma transferência da conta bancária para o cartão (não duplica).
create or replace function public.registrar_compra_cartao(
  p_empresa_id uuid,
  p_conta_cartao_id uuid,
  p_descricao text,
  p_data_compra date,
  p_valor numeric,
  p_categoria_id uuid,
  p_contraparte_id uuid default null,
  p_centro_custo_id uuid default null,
  p_projeto_id uuid default null,
  p_parcelas int default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  select tipo into v_tipo from public.contas_financeiras where id = p_conta_cartao_id and empresa_id = p_empresa_id;
  if v_tipo is distinct from 'cartao_credito' then
    raise exception 'Selecione uma conta do tipo cartão de crédito.';
  end if;
  insert into public.lancamentos (
    empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id,
    data_competencia, data_vencimento, valor_previsto, origem, observacoes
  ) values (
    p_empresa_id, 'pagar',
    trim(p_descricao) || case when coalesce(p_parcelas, 1) > 1 then ' (parcelado em ' || p_parcelas || 'x no cartão)' else '' end,
    p_categoria_id, p_contraparte_id, p_centro_custo_id, p_projeto_id, p_conta_cartao_id,
    p_data_compra, p_data_compra, p_valor, 'cartao', null
  ) returning id into v_id;
  insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem)
  values (p_empresa_id, v_id, 'pagar', p_data_compra, p_conta_cartao_id, p_valor, 'cartao_credito', 'cartao');
  return v_id;
end;
$$;

-- Parcela de empréstimo: separa amortização do principal (fora do resultado) e juros (despesa financeira).
create or replace function public.registrar_parcela_emprestimo(
  p_empresa_id uuid,
  p_descricao text,
  p_data_vencimento date,
  p_valor_principal numeric,
  p_valor_juros numeric,
  p_conta_id uuid,
  p_contraparte_id uuid default null,
  p_pago_em date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amort uuid;
  v_juros uuid;
  v_cat_amort uuid := app.categoria_sistema(p_empresa_id, 'EMPRESTIMO_AMORTIZACAO');
  v_cat_juros uuid := app.categoria_sistema(p_empresa_id, 'JUROS_EMPRESTIMOS');
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if v_cat_amort is null or v_cat_juros is null then
    raise exception 'Plano de contas sem as categorias de empréstimo. Aplique o plano padrão.';
  end if;
  if coalesce(p_valor_principal, 0) <= 0 then
    raise exception 'Informe o valor de amortização do principal.';
  end if;
  insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, contraparte_id, conta_financeira_id,
                                  data_competencia, data_vencimento, valor_previsto, origem)
  values (p_empresa_id, 'pagar', trim(p_descricao) || ' — amortização do principal', v_cat_amort, p_contraparte_id, p_conta_id,
          p_data_vencimento, p_data_vencimento, p_valor_principal, 'manual')
  returning id into v_amort;
  if coalesce(p_valor_juros, 0) > 0 then
    insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, contraparte_id, conta_financeira_id,
                                    data_competencia, data_vencimento, valor_previsto, origem)
    values (p_empresa_id, 'pagar', trim(p_descricao) || ' — juros', v_cat_juros, p_contraparte_id, p_conta_id,
            p_data_vencimento, p_data_vencimento, p_valor_juros, 'manual')
    returning id into v_juros;
  end if;
  if p_pago_em is not null then
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento)
    values (p_empresa_id, v_amort, 'pagar', p_pago_em, p_conta_id, p_valor_principal, 'debito_automatico');
    if v_juros is not null then
      insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento)
      values (p_empresa_id, v_juros, 'pagar', p_pago_em, p_conta_id, p_valor_juros, 'debito_automatico');
    end if;
  end if;
  return jsonb_build_object('amortizacao_id', v_amort, 'juros_id', v_juros);
end;
$$;

-- Gera lançamentos das recorrências até a data limite (idempotente).
create or replace function app.gerar_recorrencias(p_empresa_id uuid default null, p_ate date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.recorrencias;
  v_data date;
  v_limite date;
  v_passo interval;
  v_n int := 0;
  v_k int;
  v_inseridos int;
  v_dia int;
begin
  for r in
    select * from public.recorrencias
     where ativa and (p_empresa_id is null or empresa_id = p_empresa_id)
  loop
    v_limite := coalesce(p_ate, (app.hoje() + make_interval(months => r.meses_a_frente))::date);
    if r.data_fim is not null and r.data_fim < v_limite then
      v_limite := r.data_fim;
    end if;
    v_passo := case r.frequencia
      when 'semanal' then interval '7 days'
      when 'quinzenal' then interval '14 days'
      when 'mensal' then interval '1 month'
      when 'bimestral' then interval '2 months'
      when 'trimestral' then interval '3 months'
      when 'semestral' then interval '6 months'
      else interval '1 year' end;
    v_k := 0;
    loop
      v_data := (r.data_inicio + v_passo * v_k)::date;
      if r.frequencia not in ('semanal', 'quinzenal') and r.dia_vencimento is not null then
        v_dia := least(r.dia_vencimento, extract(day from (date_trunc('month', v_data) + interval '1 month - 1 day'))::int);
        v_data := (date_trunc('month', v_data) + make_interval(days => v_dia - 1))::date;
      end if;
      exit when v_data > v_limite or v_k > 1000;
      if v_data >= r.data_inicio and not app.competencia_fechada(r.empresa_id, v_data) then
        insert into public.lancamentos (
          empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id,
          data_competencia, data_vencimento, valor_previsto, origem, recorrencia_id, criado_por
        ) values (
          r.empresa_id, r.tipo, r.descricao, r.categoria_id, r.contraparte_id, r.centro_custo_id, r.projeto_id,
          r.conta_financeira_id, v_data, v_data, r.valor, 'recorrencia', r.id, null
        )
        on conflict (recorrencia_id, data_vencimento) where recorrencia_id is not null do nothing;
        get diagnostics v_inseridos = row_count;
        v_n := v_n + v_inseridos;
      end if;
      v_k := v_k + 1;
    end loop;
    update public.recorrencias set ultima_data_gerada = v_limite where id = r.id;
  end loop;
  return v_n;
end;
$$;

create or replace function public.gerar_recorrencias_empresa(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  return app.gerar_recorrencias(p_empresa_id, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.contas_financeiras enable row level security;
alter table public.categorias_financeiras enable row level security;
alter table public.centros_custo enable row level security;
alter table public.projetos enable row level security;
alter table public.contrapartes enable row level security;
alter table public.recorrencias enable row level security;
alter table public.lancamentos enable row level security;
alter table public.lancamento_documentos enable row level security;
alter table public.baixas enable row level security;
alter table public.transferencias enable row level security;
alter table public.estoques enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'contas_financeiras', 'categorias_financeiras', 'centros_custo', 'projetos', 'contrapartes',
    'recorrencias', 'lancamentos', 'lancamento_documentos', 'baixas', 'transferencias', 'estoques'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (empresa_id = any ((select app.empresas_com(''financeiro.ver''))::uuid[]))',
      t || '_leitura', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[]))',
      t || '_insercao', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[])) with check (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[]))',
      t || '_alteracao', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[]))',
      t || '_exclusao', t);
  end loop;
end;
$$;

-- Vincular documentos exige também poder ver os documentos.
drop policy lancamento_documentos_insercao on public.lancamento_documentos;
create policy lancamento_documentos_insercao on public.lancamento_documentos for insert to authenticated
  with check (
    empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[])
    and empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[])
  );
