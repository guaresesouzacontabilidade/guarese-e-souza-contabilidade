-- =============================================================================
-- Gestão: modalidade "Hotel" (hotelaria)
--
-- O escritório liga a gestão na modalidade "hotel" para hotéis e pousadas. O
-- hotel se administra pelo portal:
--  * Categorias de quarto (diária de tabela, pessoas incluídas, adicional por
--    pessoa) e tarifas por período (alta temporada, feriados).
--  * Quartos com a situação da governança (limpo, sujo, em limpeza,
--    manutenção). Quarto sujo ou em manutenção não recebe check-in.
--  * Hóspedes com os dados da ficha de registro (FNRH): só o hotel vê.
--  * Reservas por quarto, sem sobreposição de datas, com origem (balcão,
--    telefone, WhatsApp, Booking...), acompanhantes e tarifa acordada.
--  * Check-in, troca de quarto, conta do hóspede (diárias, consumo do
--    restaurante/bar/frigobar com baixa no estoque, serviços, descontos e
--    taxa de serviço), pagamentos e check-out (a conta precisa fechar).
--  * Cada pagamento vira lançamento no Financeiro (Prestação de serviços): à
--    vista já entra recebido na conta configurada; faturado para empresa fica
--    em aberto com o vencimento. Pagamento feito com o caixa aberto entra na
--    conferência do caixa.
--  * A venda avulsa de alimentos e bebidas (quem não é hóspede) continua no
--    caixa da loja (mesmos produtos e estoque).
-- Tudo pelas funções abaixo, que conferem a permissão (gestao.vender para a
-- recepção, gestao.gerenciar para o gerente) e a modalidade ligada. As tabelas
-- são só lidas diretamente, e só por quem usa a gestão da própria empresa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Modalidade, origens no Financeiro e movimentos de estoque
-- -----------------------------------------------------------------------------
alter table public.gestao_config drop constraint gestao_config_modalidade_check;
alter table public.gestao_config add constraint gestao_config_modalidade_check check (modalidade in ('loja', 'notas', 'hotel'));

alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha', 'cartao', 'venda', 'hotel'
));
alter table public.baixas drop constraint baixas_origem_check;
alter table public.baixas add constraint baixas_origem_check check (origem in ('manual', 'conciliacao', 'importacao', 'maquininha', 'cartao', 'venda', 'hotel'));

alter table public.estoque_movimentos drop constraint estoque_movimentos_tipo_check;
alter table public.estoque_movimentos add constraint estoque_movimentos_tipo_check check (tipo in (
  'entrada_compra', 'entrada_manual', 'saida_manual', 'inventario', 'venda', 'cancelamento_venda', 'consumo_hotel', 'estorno_consumo_hotel'
));

-- -----------------------------------------------------------------------------
-- 2. Configuração do hotel
-- -----------------------------------------------------------------------------
create table public.hotel_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  hora_checkin time not null default '14:00',
  hora_checkout time not null default '12:00',
  -- Taxa de serviço sobre o consumo (restaurante, bar, frigobar), em %; vazio = não cobra
  taxa_servico numeric(5, 2) check (taxa_servico is null or taxa_servico between 0 and 20),
  cafe_incluso boolean not null default true,
  -- Política de cancelamento e regras da casa (aparece na confirmação da reserva)
  politica text check (politica is null or length(politica) <= 2000),
  proximo_numero_reserva bigint not null default 1 check (proximo_numero_reserva >= 1),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger hotel_config_updated_at before update on public.hotel_config for each row execute function app.tg_updated_at();
create trigger auditoria_hotel_config after insert or update or delete on public.hotel_config for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Categorias, quartos e tarifas
-- -----------------------------------------------------------------------------
create table public.hotel_categorias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 60),
  descricao text check (descricao is null or length(descricao) <= 500),
  capacidade int not null default 2 check (capacidade between 1 and 20),
  pessoas_incluidas int not null default 2 check (pessoas_incluidas between 1 and 20),
  diaria numeric(12, 2) not null check (diaria > 0),
  adicional_pessoa numeric(12, 2) not null default 0 check (adicional_pessoa >= 0),
  ativa boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_categorias_empresa_id_unico unique (empresa_id, id),
  constraint hotel_categorias_incluidas check (pessoas_incluidas <= capacidade)
);
create unique index hotel_categorias_nome_uk on public.hotel_categorias (empresa_id, lower(nome));
create trigger hotel_categorias_updated_at before update on public.hotel_categorias for each row execute function app.tg_updated_at();
create trigger auditoria_hotel_categorias after insert or update or delete on public.hotel_categorias for each row execute function app.tg_auditoria();

create table public.hotel_quartos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  categoria_id uuid not null,
  numero text not null check (numero ~ '^[0-9A-Za-z][0-9A-Za-z -]{0,9}$'),
  andar text check (andar is null or length(andar) <= 20),
  camas text check (camas is null or length(camas) <= 120),
  observacao text check (observacao is null or length(observacao) <= 500),
  -- Governança: limpo, sujo, em limpeza ou em manutenção (bloqueado para venda)
  limpeza text not null default 'limpo' check (limpeza in ('limpo', 'sujo', 'em_limpeza', 'manutencao')),
  motivo_manutencao text check (motivo_manutencao is null or length(motivo_manutencao) <= 300),
  limpeza_atualizada_em timestamptz,
  limpeza_por uuid references public.perfis(id) on delete set null,
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_quartos_empresa_id_unico unique (empresa_id, id),
  constraint hotel_quartos_manutencao check (limpeza <> 'manutencao' or motivo_manutencao is not null),
  foreign key (empresa_id, categoria_id) references public.hotel_categorias (empresa_id, id)
);
create unique index hotel_quartos_numero_uk on public.hotel_quartos (empresa_id, upper(numero));
create trigger hotel_quartos_updated_at before update on public.hotel_quartos for each row execute function app.tg_updated_at();
create trigger auditoria_hotel_quartos after insert or update or delete on public.hotel_quartos for each row execute function app.tg_auditoria();

create table public.hotel_tarifas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  categoria_id uuid not null,
  nome text not null check (length(trim(nome)) between 2 and 60),
  inicio date not null,
  fim date not null,
  diaria numeric(12, 2) not null check (diaria > 0),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint hotel_tarifas_periodo check (fim >= inicio and fim - inicio <= 366),
  foreign key (empresa_id, categoria_id) references public.hotel_categorias (empresa_id, id) on delete cascade
);
create index hotel_tarifas_categoria_idx on public.hotel_tarifas (categoria_id, inicio, fim);
create trigger auditoria_hotel_tarifas after insert or update or delete on public.hotel_tarifas for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 4. Hóspedes (dados da ficha de registro — FNRH)
-- -----------------------------------------------------------------------------
create table public.hotel_hospedes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  -- Outro documento (estrangeiro, menor sem CPF): tipo e número
  documento_tipo text check (documento_tipo is null or documento_tipo in ('rg', 'passaporte', 'cnh', 'rne', 'certidao', 'outro')),
  documento text check (documento is null or length(trim(documento)) between 3 and 30),
  nascimento date,
  genero text check (genero is null or genero in ('feminino', 'masculino', 'outro', 'nao_informado')),
  nacionalidade text check (nacionalidade is null or length(nacionalidade) <= 60),
  profissao text check (profissao is null or length(profissao) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9]{8,14}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  endereco text check (endereco is null or length(endereco) <= 200),
  cidade text check (cidade is null or length(cidade) <= 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  pais text check (pais is null or length(pais) <= 60),
  -- Preferências, restrições alimentares, observações da recepção
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_hospedes_empresa_id_unico unique (empresa_id, id),
  constraint hotel_hospedes_documento check ((documento is null) = (documento_tipo is null))
);
create unique index hotel_hospedes_cpf_uk on public.hotel_hospedes (empresa_id, cpf) where cpf is not null;
create index hotel_hospedes_nome_idx on public.hotel_hospedes using gin (app.normalizar(nome) extensions.gin_trgm_ops);
create trigger hotel_hospedes_updated_at before update on public.hotel_hospedes for each row execute function app.tg_updated_at();
create trigger auditoria_hotel_hospedes after insert or update or delete on public.hotel_hospedes for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 5. Reservas e hospedagens
-- -----------------------------------------------------------------------------
create table public.hotel_reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  -- pre_reserva (aguardando confirmação) | confirmada | hospedado | encerrada | cancelada | no_show
  status text not null default 'confirmada' check (status in ('pre_reserva', 'confirmada', 'hospedado', 'encerrada', 'cancelada', 'no_show')),
  hospede_id uuid not null,
  quarto_id uuid not null,
  categoria_id uuid not null,
  entrada date not null,
  -- Dia da saída (a última noite é a véspera). No check-out, vira a data real.
  saida date not null,
  saida_prevista date,
  adultos int not null default 1 check (adultos between 1 and 20),
  criancas int not null default 0 check (criancas between 0 and 20),
  origem text not null default 'balcao' check (origem in (
    'balcao', 'telefone', 'whatsapp', 'site', 'booking', 'expedia', 'airbnb', 'decolar', 'agencia', 'empresa', 'outro'
  )),
  -- Tarifa negociada por noite (vazia = tabela da categoria e tarifas do período)
  diaria_acordada numeric(12, 2) check (diaria_acordada is null or diaria_acordada > 0),
  valor_previsto numeric(12, 2) not null default 0 check (valor_previsto >= 0),
  -- Empresa que paga a conta (faturado), do cadastro de clientes do Financeiro
  empresa_faturar_id uuid,
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  -- Dados da estadia para a ficha de registro (FNRH)
  motivo_viagem text check (motivo_viagem is null or motivo_viagem in ('lazer', 'negocios', 'congresso', 'parentes', 'estudos', 'religiao', 'saude', 'compras', 'outro')),
  meio_transporte text check (meio_transporte is null or meio_transporte in ('aviao', 'automovel', 'onibus', 'moto', 'navio', 'trem', 'outro')),
  placa_veiculo text check (placa_veiculo is null or placa_veiculo ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  procedencia text check (procedencia is null or length(procedencia) <= 120),
  destino text check (destino is null or length(destino) <= 120),
  checkin_em timestamptz,
  checkin_por uuid references public.perfis(id) on delete set null,
  checkout_em timestamptz,
  checkout_por uuid references public.perfis(id) on delete set null,
  cancelada_em timestamptz,
  cancelada_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_reservas_empresa_id_unico unique (empresa_id, id),
  constraint hotel_reservas_numero_uk unique (empresa_id, numero),
  constraint hotel_reservas_periodo check (saida > entrada and saida - entrada <= 365),
  constraint hotel_reservas_checkin check (status not in ('hospedado', 'encerrada') or checkin_em is not null),
  constraint hotel_reservas_checkout check ((status = 'encerrada') = (checkout_em is not null)),
  foreign key (empresa_id, hospede_id) references public.hotel_hospedes (empresa_id, id),
  foreign key (empresa_id, quarto_id) references public.hotel_quartos (empresa_id, id),
  foreign key (empresa_id, categoria_id) references public.hotel_categorias (empresa_id, id),
  foreign key (empresa_id, empresa_faturar_id) references public.contrapartes (empresa_id, id)
);
create index hotel_reservas_periodo_idx on public.hotel_reservas (empresa_id, entrada, saida);
create index hotel_reservas_quarto_idx on public.hotel_reservas (quarto_id, entrada);
create index hotel_reservas_status_idx on public.hotel_reservas (empresa_id, status);
create index hotel_reservas_hospede_idx on public.hotel_reservas (hospede_id);
-- Um hóspede (reserva) por quarto ocupado
create unique index hotel_reservas_um_hospedado on public.hotel_reservas (quarto_id) where status = 'hospedado';
create trigger hotel_reservas_updated_at before update on public.hotel_reservas for each row execute function app.tg_updated_at();
create trigger auditoria_hotel_reservas after insert or update or delete on public.hotel_reservas for each row execute function app.tg_auditoria();

-- Acompanhantes (cada um tem a própria ficha)
create table public.hotel_reserva_hospedes (
  reserva_id uuid not null,
  hospede_id uuid not null,
  empresa_id uuid not null,
  primary key (reserva_id, hospede_id),
  foreign key (empresa_id, reserva_id) references public.hotel_reservas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, hospede_id) references public.hotel_hospedes (empresa_id, id)
);
create index hotel_reserva_hospedes_hospede_idx on public.hotel_reserva_hospedes (hospede_id);

-- -----------------------------------------------------------------------------
-- 6. Conta do hóspede e pagamentos
-- -----------------------------------------------------------------------------
create table public.hotel_conta_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  reserva_id uuid not null,
  tipo text not null check (tipo in ('diaria', 'consumo', 'servico', 'taxa_servico', 'desconto')),
  data date not null default app.hoje(),
  descricao text not null check (length(trim(descricao)) between 1 and 160),
  setor text check (setor is null or setor in ('restaurante', 'bar', 'frigobar', 'lavanderia', 'recepcao', 'outro')),
  produto_id uuid references public.nfe_produtos(id) on delete restrict,
  quantidade numeric(12, 4) not null default 1 check (quantidade > 0),
  valor_unitario numeric(12, 2) not null check (valor_unitario >= 0),
  total numeric(12, 2) not null,
  cancelado_em timestamptz,
  cancelado_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  lancado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint hotel_conta_itens_sinal check ((tipo = 'desconto' and total < 0) or (tipo <> 'desconto' and total >= 0)),
  constraint hotel_conta_itens_produto check ((tipo = 'consumo') = (produto_id is not null)),
  foreign key (empresa_id, reserva_id) references public.hotel_reservas (empresa_id, id) on delete cascade
);
create index hotel_conta_itens_reserva_idx on public.hotel_conta_itens (reserva_id, data);
create index hotel_conta_itens_data_idx on public.hotel_conta_itens (empresa_id, data);
create trigger auditoria_hotel_conta_itens after insert or update or delete on public.hotel_conta_itens for each row execute function app.tg_auditoria();

create table public.hotel_pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  reserva_id uuid not null,
  data date not null default app.hoje(),
  forma text not null check (forma in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'faturado', 'outro')),
  valor numeric(12, 2) not null check (valor > 0),
  -- Sinal ou depósito antes do check-in
  adiantamento boolean not null default false,
  -- Faturado: empresa que paga e vencimento da fatura
  contraparte_id uuid,
  vencimento date,
  sessao_id uuid,
  lancamento_id uuid,
  observacao text check (observacao is null or length(observacao) <= 300),
  cancelado_em timestamptz,
  cancelado_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  recebido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint hotel_pagamentos_faturado check ((forma = 'faturado') = (contraparte_id is not null and vencimento is not null)),
  foreign key (empresa_id, reserva_id) references public.hotel_reservas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, contraparte_id) references public.contrapartes (empresa_id, id),
  foreign key (empresa_id, sessao_id) references public.caixa_sessoes (empresa_id, id),
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id)
);
create index hotel_pagamentos_reserva_idx on public.hotel_pagamentos (reserva_id);
create index hotel_pagamentos_sessao_idx on public.hotel_pagamentos (sessao_id) where sessao_id is not null;
create index hotel_pagamentos_data_idx on public.hotel_pagamentos (empresa_id, data);
create trigger auditoria_hotel_pagamentos after insert or update or delete on public.hotel_pagamentos for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 7. Regras comuns
-- -----------------------------------------------------------------------------
create or replace function app.exigir_hotel(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, p_permissao);
  if coalesce((select modalidade from public.gestao_config where empresa_id = p_empresa_id), '') <> 'hotel' then
    raise exception 'A gestão do hotel não está ligada para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

-- Configuração do hotel (cria a padrão na primeira vez)
create or replace function app.hotel_cfg(p_empresa_id uuid)
returns public.hotel_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.hotel_config;
begin
  select * into v from public.hotel_config where empresa_id = p_empresa_id;
  if v.empresa_id is null then
    insert into public.hotel_config (empresa_id) values (p_empresa_id) on conflict (empresa_id) do nothing;
    select * into v from public.hotel_config where empresa_id = p_empresa_id;
  end if;
  return v;
end;
$$;

create or replace function app.hotel_moeda(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'R$ ' || translate(to_char(p, 'FM999,999,990.00'), ',.', '.,');
$$;

-- Diária de tabela de uma noite: a tarifa do período mais curto que cobre a data, ou a da categoria
create or replace function app.hotel_diaria_noite(p_categoria_id uuid, p_data date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.diaria from public.hotel_tarifas t
      where t.categoria_id = p_categoria_id and p_data between t.inicio and t.fim
      order by t.fim - t.inicio, t.created_at desc limit 1),
    (select c.diaria from public.hotel_categorias c where c.id = p_categoria_id)
  );
$$;

-- Noites da reserva até p_fim (dia da saída; no mínimo uma noite) e o valor de cada uma
create or replace function app.hotel_noites(p_reserva_id uuid, p_fim date)
returns table (data date, valor numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select d::date,
         round(coalesce(r.diaria_acordada,
           app.hotel_diaria_noite(r.categoria_id, d::date) + greatest(r.adultos - c.pessoas_incluidas, 0) * c.adicional_pessoa), 2)
    from public.hotel_reservas r
    join public.hotel_categorias c on c.id = r.categoria_id
   cross join lateral generate_series(r.entrada::timestamp, (greatest(p_fim, r.entrada + 1) - 1)::timestamp, interval '1 day') d
   where r.id = p_reserva_id
   order by 1;
$$;

-- Reserva ativa do mesmo quarto que cruza o período (para a mensagem de conflito)
create or replace function app.hotel_conflito(p_quarto_id uuid, p_entrada date, p_saida date, p_ignorar uuid)
returns public.hotel_reservas
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.hotel_reservas r
   where r.quarto_id = p_quarto_id
     and r.id is distinct from p_ignorar
     and r.status in ('pre_reserva', 'confirmada', 'hospedado')
     and r.entrada < p_saida and p_entrada < r.saida
   order by r.entrada
   limit 1;
$$;

create or replace function app.hotel_exigir_livre(p_quarto_id uuid, p_entrada date, p_saida date, p_ignorar uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.hotel_reservas;
  v_numero text;
  v_nome text;
begin
  v := app.hotel_conflito(p_quarto_id, p_entrada, p_saida, p_ignorar);
  if v.id is not null then
    select numero into v_numero from public.hotel_quartos where id = p_quarto_id;
    select nome into v_nome from public.hotel_hospedes where id = v.hospede_id;
    raise exception 'O quarto % já está reservado de % a % (reserva nº %, %). Escolha outro quarto ou outras datas.',
      v_numero, to_char(v.entrada, 'DD/MM/YYYY'), to_char(v.saida, 'DD/MM/YYYY'), v.numero, v_nome;
  end if;
end;
$$;

-- Resumo da conta: diárias (lançadas no check-out; antes disso, calculadas), consumo, pagamentos e saldo
create or replace function app.hotel_resumo(p_reserva_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  v_cfg public.hotel_config;
  v_hoje date := app.hoje();
  v_fim date;
  v_diarias numeric;
  v_noites int;
  v_prev numeric;
  v_noites_prev int;
  v_consumo numeric;
  v_servicos numeric;
  v_descontos numeric;
  v_taxa numeric;
  v_pago numeric;
  v_adiant numeric;
  v_total numeric;
  v_total_prev numeric;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id;
  if r.id is null then
    return null;
  end if;
  select * into v_cfg from public.hotel_config where empresa_id = r.empresa_id;
  select coalesce(sum(valor), 0), count(*) into v_prev, v_noites_prev from app.hotel_noites(r.id, r.saida);
  if r.status = 'encerrada' then
    select coalesce(sum(total), 0), count(*) into v_diarias, v_noites
      from public.hotel_conta_itens where reserva_id = r.id and tipo = 'diaria' and cancelado_em is null;
  elsif r.status = 'hospedado' then
    -- Se sair hoje: as noites até hoje (no mínimo uma)
    v_fim := greatest(v_hoje, r.entrada + 1);
    select coalesce(sum(valor), 0), count(*) into v_diarias, v_noites from app.hotel_noites(r.id, v_fim);
  elsif r.status in ('cancelada', 'no_show') then
    v_diarias := 0;
    v_noites := 0;
  else
    v_diarias := v_prev;
    v_noites := v_noites_prev;
  end if;
  select coalesce(sum(total) filter (where tipo = 'consumo'), 0),
         coalesce(sum(total) filter (where tipo = 'servico'), 0),
         coalesce(sum(total) filter (where tipo = 'desconto'), 0),
         coalesce(sum(total) filter (where tipo = 'taxa_servico'), 0)
    into v_consumo, v_servicos, v_descontos, v_taxa
    from public.hotel_conta_itens where reserva_id = r.id and cancelado_em is null;
  if r.status <> 'encerrada' then
    v_taxa := case when coalesce(v_cfg.taxa_servico, 0) > 0 then round(v_consumo * v_cfg.taxa_servico / 100, 2) else 0 end;
  end if;
  select coalesce(sum(valor), 0), coalesce(sum(valor) filter (where adiantamento), 0) into v_pago, v_adiant
    from public.hotel_pagamentos where reserva_id = r.id and cancelado_em is null;
  v_total := v_diarias + v_consumo + v_servicos + v_taxa + v_descontos;
  v_total_prev := case when r.status in ('cancelada', 'no_show', 'encerrada') then v_total
                       else v_prev + v_consumo + v_servicos + v_taxa + v_descontos end;
  return jsonb_build_object(
    'status', r.status,
    'noites', v_noites,
    'diarias', v_diarias,
    'noites_previstas', v_noites_prev,
    'diarias_previstas', v_prev,
    'consumo', v_consumo,
    'servicos', v_servicos,
    'descontos', v_descontos,
    'taxa_servico', v_taxa,
    'taxa_servico_percentual', v_cfg.taxa_servico,
    'total', v_total,
    'total_previsto', v_total_prev,
    'pago', v_pago,
    'adiantamentos', v_adiant,
    'saldo', v_total - v_pago,
    'saldo_previsto', v_total_prev - v_pago
  );
end;
$$;

create or replace function public.hotel_conta_resumo(p_reserva_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.hotel_reservas where id = p_reserva_id;
  if v_empresa is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(v_empresa, 'gestao.vender');
  return app.hotel_resumo(p_reserva_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Ligar a modalidade (gestao_configurar aceita "hotel")
-- -----------------------------------------------------------------------------
create or replace function public.gestao_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_equipe boolean := app.e_equipe_da_empresa(p_empresa_id);
  v_atual public.gestao_config;
  v_ativa boolean;
  v_perfil text;
  v_modalidade text;
  v_desc numeric := nullif(p_dados ->> 'desconto_maximo_operador', '')::numeric;
  v_dinheiro uuid := nullif(p_dados ->> 'conta_dinheiro_id', '')::uuid;
  v_pix uuid := nullif(p_dados ->> 'conta_pix_id', '')::uuid;
  v_cartao uuid := nullif(p_dados ->> 'conta_cartao_id', '')::uuid;
  v_nfe_op uuid;
  v_nfe_emit uuid;
begin
  select * into v_atual from public.gestao_config where empresa_id = p_empresa_id;
  if v_equipe then
    v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_atual.ativa, false);
    v_perfil := coalesce(nullif(p_dados ->> 'perfil_fiscal', ''), v_atual.perfil_fiscal, 'comercio');
    v_modalidade := coalesce(nullif(p_dados ->> 'modalidade', ''), v_atual.modalidade, 'loja');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
    v_ativa := v_atual.ativa;
    v_perfil := v_atual.perfil_fiscal;
    v_modalidade := v_atual.modalidade;
  end if;
  if v_modalidade not in ('loja', 'notas', 'hotel') then
    raise exception 'Escolha a modalidade: loja completa, notas e transporte ou hotel.';
  end if;

  -- As contas do caixa, do banco e da maquininha: loja completa e hotel (recepção e restaurante)
  if v_ativa and v_modalidade in ('loja', 'hotel') then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', case v_modalidade when 'hotel' then 'Caixa da recepção' else 'Caixa da loja' end));
    v_pix := coalesce(v_pix, v_atual.conta_pix_id, app.gestao_conta(p_empresa_id, 'conta_corrente', 'Banco (PIX e transferências)'));
    v_cartao := coalesce(v_cartao, v_atual.conta_cartao_id, app.gestao_conta(p_empresa_id, 'adquirente', 'Maquininha de cartão'));
  end if;
  -- NF-e na hora da venda: operação fiscal e inscrição que emite (da própria empresa)
  v_nfe_op := case when p_dados ? 'nfe_operacao_id' then nullif(p_dados ->> 'nfe_operacao_id', '')::uuid else v_atual.nfe_operacao_id end;
  v_nfe_emit := case when p_dados ? 'nfe_emitente_id' then nullif(p_dados ->> 'nfe_emitente_id', '')::uuid else v_atual.nfe_emitente_id end;
  if v_nfe_op is not null and not exists (select 1 from public.nfe_operacoes where id = v_nfe_op and empresa_id = p_empresa_id and ativa) then
    raise exception 'A operação da NF-e escolhida não é desta empresa ou está desativada.';
  end if;
  if v_nfe_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_nfe_emit and empresa_id = p_empresa_id and ativo) then
    raise exception 'A inscrição que emite a NF-e não é desta empresa ou está desativada.';
  end if;
  if (v_dinheiro is not null and v_dinheiro in (v_pix, v_cartao)) then
    raise exception 'A conta do dinheiro precisa ser diferente da conta do PIX e da maquininha.';
  end if;

  insert into public.gestao_config as g (
    empresa_id, ativa, perfil_fiscal, permitir_estoque_negativo, permitir_venda_prazo, desconto_maximo_operador,
    conta_dinheiro_id, conta_pix_id, conta_cartao_id, validade_orcamento_dias, mensagem_comprovante, ativada_por, ativada_em,
    nfe_operacao_id, nfe_emitente_id, nfe_marcada_padrao, modalidade
  ) values (
    p_empresa_id, v_ativa, v_perfil,
    coalesce((p_dados ->> 'permitir_estoque_negativo')::boolean, v_atual.permitir_estoque_negativo, false),
    coalesce((p_dados ->> 'permitir_venda_prazo')::boolean, v_atual.permitir_venda_prazo, true),
    case when p_dados ? 'desconto_maximo_operador' then v_desc else v_atual.desconto_maximo_operador end,
    v_dinheiro, v_pix, v_cartao,
    coalesce((p_dados ->> 'validade_orcamento_dias')::int, v_atual.validade_orcamento_dias, 15),
    case when p_dados ? 'mensagem_comprovante' then nullif(trim(p_dados ->> 'mensagem_comprovante'), '') else v_atual.mensagem_comprovante end,
    case when v_ativa then auth.uid() end, case when v_ativa then now() end,
    v_nfe_op, v_nfe_emit, coalesce((p_dados ->> 'nfe_marcada_padrao')::boolean, v_atual.nfe_marcada_padrao, false), v_modalidade
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    perfil_fiscal = excluded.perfil_fiscal,
    permitir_estoque_negativo = excluded.permitir_estoque_negativo,
    permitir_venda_prazo = excluded.permitir_venda_prazo,
    desconto_maximo_operador = excluded.desconto_maximo_operador,
    conta_dinheiro_id = excluded.conta_dinheiro_id,
    conta_pix_id = excluded.conta_pix_id,
    conta_cartao_id = excluded.conta_cartao_id,
    validade_orcamento_dias = excluded.validade_orcamento_dias,
    mensagem_comprovante = excluded.mensagem_comprovante,
    ativada_por = case when excluded.ativa and not g.ativa then auth.uid() else g.ativada_por end,
    ativada_em = case when excluded.ativa and not g.ativa then now() else g.ativada_em end,
    nfe_operacao_id = excluded.nfe_operacao_id,
    nfe_emitente_id = excluded.nfe_emitente_id,
    nfe_marcada_padrao = excluded.nfe_marcada_padrao,
    modalidade = excluded.modalidade,
    atualizado_por = auth.uid();

  if v_ativa and v_modalidade = 'hotel' then
    perform app.hotel_cfg(p_empresa_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Cadastros do gerente: configuração, categorias, quartos e tarifas
-- -----------------------------------------------------------------------------
create or replace function public.hotel_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taxa numeric := nullif(p_dados ->> 'taxa_servico', '')::numeric;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  perform app.hotel_cfg(p_empresa_id);
  if v_taxa is not null and (v_taxa < 0 or v_taxa > 20) then
    raise exception 'A taxa de serviço vai de 0 a 20%%.';
  end if;
  begin
    update public.hotel_config
       set hora_checkin = coalesce(nullif(p_dados ->> 'hora_checkin', '')::time, hora_checkin),
           hora_checkout = coalesce(nullif(p_dados ->> 'hora_checkout', '')::time, hora_checkout),
           taxa_servico = case when p_dados ? 'taxa_servico' then nullif(v_taxa, 0) else taxa_servico end,
           cafe_incluso = coalesce((p_dados ->> 'cafe_incluso')::boolean, cafe_incluso),
           politica = case when p_dados ? 'politica' then nullif(trim(p_dados ->> 'politica'), '') else politica end,
           atualizado_por = auth.uid()
     where empresa_id = p_empresa_id;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Horário inválido (use HH:MM).';
    when check_violation then
      raise exception 'A política pode ter até 2.000 letras.';
  end;
end;
$$;

create or replace function public.hotel_categoria_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  begin
    if p_id is null then
      insert into public.hotel_categorias (empresa_id, nome, descricao, capacidade, pessoas_incluidas, diaria, adicional_pessoa, ativa, ordem)
      values (
        p_empresa_id, trim(p_dados ->> 'nome'), nullif(trim(p_dados ->> 'descricao'), ''),
        coalesce(nullif(p_dados ->> 'capacidade', '')::int, 2), coalesce(nullif(p_dados ->> 'pessoas_incluidas', '')::int, 2),
        (p_dados ->> 'diaria')::numeric, coalesce(nullif(p_dados ->> 'adicional_pessoa', '')::numeric, 0),
        coalesce((p_dados ->> 'ativa')::boolean, true), coalesce(nullif(p_dados ->> 'ordem', '')::int, 0)
      ) returning id into v_id;
    else
      update public.hotel_categorias
         set nome = trim(p_dados ->> 'nome'),
             descricao = nullif(trim(p_dados ->> 'descricao'), ''),
             capacidade = coalesce(nullif(p_dados ->> 'capacidade', '')::int, capacidade),
             pessoas_incluidas = coalesce(nullif(p_dados ->> 'pessoas_incluidas', '')::int, pessoas_incluidas),
             diaria = (p_dados ->> 'diaria')::numeric,
             adicional_pessoa = coalesce(nullif(p_dados ->> 'adicional_pessoa', '')::numeric, 0),
             ativa = coalesce((p_dados ->> 'ativa')::boolean, ativa),
             ordem = coalesce(nullif(p_dados ->> 'ordem', '')::int, ordem)
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Categoria não encontrada.';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'Já existe uma categoria com este nome.';
    when check_violation or not_null_violation or invalid_text_representation then
      raise exception 'Confira a categoria: nome (2 a 60 letras), diária maior que zero, capacidade de 1 a 20 e pessoas incluídas até a capacidade.';
  end;
  return v_id;
end;
$$;

create or replace function public.hotel_quarto_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cat uuid := nullif(p_dados ->> 'categoria_id', '')::uuid;
  v_ativo boolean := coalesce((p_dados ->> 'ativo')::boolean, true);
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  if not exists (select 1 from public.hotel_categorias where id = v_cat and empresa_id = p_empresa_id) then
    raise exception 'Escolha a categoria do quarto.';
  end if;
  if p_id is not null and not v_ativo and exists (
    select 1 from public.hotel_reservas where quarto_id = p_id and status in ('pre_reserva', 'confirmada', 'hospedado') and saida > app.hoje()
  ) then
    raise exception 'Este quarto tem reservas ou hóspede. Troque o quarto delas antes de desativá-lo.';
  end if;
  begin
    if p_id is null then
      insert into public.hotel_quartos (empresa_id, categoria_id, numero, andar, camas, observacao, ativo, ordem)
      values (
        p_empresa_id, v_cat, upper(trim(p_dados ->> 'numero')), nullif(trim(p_dados ->> 'andar'), ''), nullif(trim(p_dados ->> 'camas'), ''),
        nullif(trim(p_dados ->> 'observacao'), ''), v_ativo, coalesce(nullif(p_dados ->> 'ordem', '')::int, 0)
      ) returning id into v_id;
    else
      update public.hotel_quartos
         set categoria_id = v_cat,
             numero = upper(trim(p_dados ->> 'numero')),
             andar = nullif(trim(p_dados ->> 'andar'), ''),
             camas = nullif(trim(p_dados ->> 'camas'), ''),
             observacao = nullif(trim(p_dados ->> 'observacao'), ''),
             ativo = v_ativo,
             ordem = coalesce(nullif(p_dados ->> 'ordem', '')::int, ordem)
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Quarto não encontrado.';
      end if;
      -- Reservas futuras acompanham a nova categoria do quarto
      update public.hotel_reservas set categoria_id = v_cat
       where quarto_id = v_id and status in ('pre_reserva', 'confirmada') and categoria_id <> v_cat;
      update public.hotel_reservas r
         set valor_previsto = (select coalesce(sum(n.valor), 0) from app.hotel_noites(r.id, r.saida) n)
       where r.quarto_id = v_id and r.status in ('pre_reserva', 'confirmada');
    end if;
  exception
    when unique_violation then
      raise exception 'Já existe o quarto %.', upper(trim(p_dados ->> 'numero'));
    when check_violation or not_null_violation then
      raise exception 'Confira o quarto: número com até 10 letras ou números (ex.: 101, 2A).';
  end;
  return v_id;
end;
$$;

create or replace function public.hotel_tarifa_salvar(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  if not exists (select 1 from public.hotel_categorias where id = nullif(p_dados ->> 'categoria_id', '')::uuid and empresa_id = p_empresa_id) then
    raise exception 'Escolha a categoria.';
  end if;
  begin
    insert into public.hotel_tarifas (empresa_id, categoria_id, nome, inicio, fim, diaria)
    values (p_empresa_id, (p_dados ->> 'categoria_id')::uuid, trim(p_dados ->> 'nome'), (p_dados ->> 'inicio')::date, (p_dados ->> 'fim')::date, (p_dados ->> 'diaria')::numeric)
    returning id into v_id;
  exception
    when check_violation or not_null_violation or invalid_datetime_format or invalid_text_representation then
      raise exception 'Confira a tarifa: nome, período (o fim não pode ser antes do início; até um ano) e diária maior que zero.';
  end;
  return v_id;
end;
$$;

create or replace function public.hotel_tarifa_excluir(p_tarifa_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.hotel_tarifas where id = p_tarifa_id;
  if v_empresa is null then
    raise exception 'Tarifa não encontrada.';
  end if;
  perform app.exigir_hotel(v_empresa, 'gestao.gerenciar');
  delete from public.hotel_tarifas where id = p_tarifa_id;
end;
$$;

-- Governança: a recepção e a camareira mudam a situação do quarto
create or replace function public.hotel_quarto_limpeza(p_quarto_id uuid, p_limpeza text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.hotel_quartos;
begin
  select * into q from public.hotel_quartos where id = p_quarto_id for update;
  if q.id is null then
    raise exception 'Quarto não encontrado.';
  end if;
  perform app.exigir_hotel(q.empresa_id, 'gestao.vender');
  if p_limpeza not in ('limpo', 'sujo', 'em_limpeza', 'manutencao') then
    raise exception 'Situação inválida.';
  end if;
  if p_limpeza = 'manutencao' then
    if length(trim(coalesce(p_motivo, ''))) < 3 then
      raise exception 'Explique o que está em manutenção.';
    end if;
    if exists (select 1 from public.hotel_reservas where quarto_id = q.id and status = 'hospedado') then
      raise exception 'O quarto % está ocupado. Troque o hóspede de quarto antes de colocá-lo em manutenção.', q.numero;
    end if;
  end if;
  update public.hotel_quartos
     set limpeza = p_limpeza,
         motivo_manutencao = case when p_limpeza = 'manutencao' then left(trim(p_motivo), 300) end,
         limpeza_atualizada_em = now(), limpeza_por = auth.uid()
   where id = q.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Hóspedes
-- -----------------------------------------------------------------------------
create or replace function public.hotel_hospede_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_cpf text := nullif(regexp_replace(coalesce(p_dados ->> 'cpf', ''), '\D', '', 'g'), '');
  v_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), '');
  v_cep text := nullif(regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'), '');
  v_doc_tipo text := nullif(p_dados ->> 'documento_tipo', '');
  v_doc text := nullif(trim(p_dados ->> 'documento'), '');
  v_nasc date := nullif(p_dados ->> 'nascimento', '')::date;
  v_outro uuid;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  if v_cpf is not null and not app.cpf_valido(v_cpf) then
    raise exception 'CPF inválido. Confira os números.';
  end if;
  if v_doc is null then
    v_doc_tipo := null;
  elsif v_doc_tipo is null then
    v_doc_tipo := 'outro';
  end if;
  if v_nasc is not null and (v_nasc > app.hoje() or v_nasc < date '1900-01-01') then
    raise exception 'Data de nascimento inválida.';
  end if;
  if v_cpf is not null then
    select id into v_outro from public.hotel_hospedes where empresa_id = p_empresa_id and cpf = v_cpf and id is distinct from p_id;
    if v_outro is not null then
      if p_id is not null then
        raise exception 'Já existe outro hóspede com este CPF.';
      end if;
      v_id := v_outro; -- cadastro já existente: atualiza os dados
    end if;
  end if;
  begin
    if v_id is null then
      insert into public.hotel_hospedes (
        empresa_id, nome, cpf, documento_tipo, documento, nascimento, genero, nacionalidade, profissao, telefone, email,
        cep, endereco, cidade, uf, pais, observacoes
      ) values (
        p_empresa_id, trim(p_dados ->> 'nome'), v_cpf, v_doc_tipo, v_doc, v_nasc, nullif(p_dados ->> 'genero', ''),
        coalesce(nullif(trim(p_dados ->> 'nacionalidade'), ''), 'Brasileira'), nullif(trim(p_dados ->> 'profissao'), ''), v_tel,
        nullif(lower(trim(p_dados ->> 'email')), ''), v_cep, nullif(trim(p_dados ->> 'endereco'), ''), nullif(trim(p_dados ->> 'cidade'), ''),
        nullif(upper(trim(p_dados ->> 'uf')), ''), coalesce(nullif(trim(p_dados ->> 'pais'), ''), 'Brasil'), nullif(trim(p_dados ->> 'observacoes'), '')
      ) returning id into v_id;
    else
      update public.hotel_hospedes
         set nome = trim(p_dados ->> 'nome'),
             cpf = v_cpf,
             documento_tipo = v_doc_tipo,
             documento = v_doc,
             nascimento = v_nasc,
             genero = nullif(p_dados ->> 'genero', ''),
             nacionalidade = coalesce(nullif(trim(p_dados ->> 'nacionalidade'), ''), nacionalidade),
             profissao = nullif(trim(p_dados ->> 'profissao'), ''),
             telefone = v_tel,
             email = nullif(lower(trim(p_dados ->> 'email')), ''),
             cep = v_cep,
             endereco = nullif(trim(p_dados ->> 'endereco'), ''),
             cidade = nullif(trim(p_dados ->> 'cidade'), ''),
             uf = nullif(upper(trim(p_dados ->> 'uf')), ''),
             pais = coalesce(nullif(trim(p_dados ->> 'pais'), ''), pais),
             observacoes = nullif(trim(p_dados ->> 'observacoes'), '')
       where id = v_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Hóspede não encontrado.';
      end if;
    end if;
  exception
    when check_violation or not_null_violation then
      raise exception 'Confira o cadastro: nome (2 a 120 letras), telefone com DDD (só números), e-mail válido, CEP com 8 números e UF com 2 letras.';
  end;
  return v_id;
end;
$$;

-- Exclui o cadastro (LGPD) quando o hóspede não tem hospedagem registrada
create or replace function public.hotel_hospede_excluir(p_hospede_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.hotel_hospedes where id = p_hospede_id;
  if v_empresa is null then
    raise exception 'Hóspede não encontrado.';
  end if;
  perform app.exigir_hotel(v_empresa, 'gestao.gerenciar');
  if exists (select 1 from public.hotel_reservas where hospede_id = p_hospede_id)
     or exists (select 1 from public.hotel_reserva_hospedes where hospede_id = p_hospede_id) then
    raise exception 'Este hóspede tem reservas ou hospedagens registradas: o cadastro fica guardado junto com elas.';
  end if;
  delete from public.hotel_hospedes where id = p_hospede_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Reservas
-- -----------------------------------------------------------------------------
create or replace function public.hotel_reserva_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual public.hotel_reservas;
  q public.hotel_quartos;
  c public.hotel_categorias;
  v_cfg public.hotel_config;
  v_hosp uuid := nullif(p_dados ->> 'hospede_id', '')::uuid;
  v_entrada date := nullif(p_dados ->> 'entrada', '')::date;
  v_saida date := nullif(p_dados ->> 'saida', '')::date;
  v_adultos int := coalesce(nullif(p_dados ->> 'adultos', '')::int, 1);
  v_criancas int := coalesce(nullif(p_dados ->> 'criancas', '')::int, 0);
  v_status text := coalesce(nullif(p_dados ->> 'status', ''), 'confirmada');
  v_acordada numeric := nullif(p_dados ->> 'diaria_acordada', '')::numeric;
  v_faturar uuid := nullif(p_dados ->> 'empresa_faturar_id', '')::uuid;
  v_hoje date := app.hoje();
  v_id uuid;
  v_numero bigint;
  v_valor numeric;
  v_acomp uuid;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  if p_id is not null then
    select * into v_atual from public.hotel_reservas where id = p_id and empresa_id = p_empresa_id for update;
    if v_atual.id is null then
      raise exception 'Reserva não encontrada.';
    end if;
    if v_atual.status not in ('pre_reserva', 'confirmada', 'hospedado') then
      raise exception 'Esta reserva já foi encerrada ou cancelada e não pode mais ser alterada.';
    end if;
  end if;
  if not exists (select 1 from public.hotel_hospedes where id = v_hosp and empresa_id = p_empresa_id) then
    raise exception 'Escolha o hóspede (ou cadastre um novo).';
  end if;
  select * into q from public.hotel_quartos
   where id = nullif(p_dados ->> 'quarto_id', '')::uuid and empresa_id = p_empresa_id for update;
  if q.id is null or not q.ativo then
    raise exception 'Escolha o quarto.';
  end if;
  select * into c from public.hotel_categorias where id = q.categoria_id;
  if v_entrada is null or v_saida is null then
    raise exception 'Informe as datas de entrada e de saída.';
  end if;
  if v_saida <= v_entrada then
    raise exception 'A saída precisa ser depois da entrada (pelo menos uma noite).';
  end if;
  if v_saida - v_entrada > 365 then
    raise exception 'A reserva pode ter no máximo 365 noites.';
  end if;
  if v_adultos < 1 or v_criancas < 0 then
    raise exception 'Informe quantos adultos e crianças.';
  end if;
  if v_adultos + v_criancas > c.capacidade then
    raise exception 'O quarto % (%) comporta até % pessoa(s).', q.numero, c.nome, c.capacidade;
  end if;
  if v_acordada is not null and (v_acordada <= 0 or v_acordada <> round(v_acordada, 2)) then
    raise exception 'Diária acordada inválida.';
  end if;
  if v_faturar is not null and not exists (select 1 from public.contrapartes where id = v_faturar and empresa_id = p_empresa_id) then
    raise exception 'Empresa para faturar não encontrada.';
  end if;

  if v_atual.status = 'hospedado' then
    -- Hóspede na casa: só a saída, as pessoas, a tarifa e as observações mudam (troca de quarto tem função própria)
    if v_entrada <> v_atual.entrada then
      raise exception 'A entrada de quem já fez check-in não muda.';
    end if;
    if q.id <> v_atual.quarto_id then
      raise exception 'Para mudar o hóspede de quarto, use "Trocar quarto".';
    end if;
    if v_saida < v_hoje then
      raise exception 'A saída não pode ser antes de hoje.';
    end if;
    v_status := 'hospedado';
  else
    if v_status not in ('pre_reserva', 'confirmada') then
      raise exception 'Situação da reserva inválida.';
    end if;
    if (p_id is null or v_entrada <> v_atual.entrada) and v_entrada < v_hoje - 1 then
      raise exception 'A entrada não pode ser no passado.';
    end if;
  end if;
  perform app.hotel_exigir_livre(q.id, v_entrada, v_saida, p_id);

  begin
    if p_id is null then
      v_cfg := app.hotel_cfg(p_empresa_id);
      select * into v_cfg from public.hotel_config where empresa_id = p_empresa_id for update;
      v_numero := v_cfg.proximo_numero_reserva;
      update public.hotel_config set proximo_numero_reserva = proximo_numero_reserva + 1 where empresa_id = p_empresa_id;
      insert into public.hotel_reservas (
        empresa_id, numero, status, hospede_id, quarto_id, categoria_id, entrada, saida, saida_prevista, adultos, criancas, origem,
        diaria_acordada, empresa_faturar_id, observacoes, motivo_viagem, meio_transporte, placa_veiculo, procedencia, destino
      ) values (
        p_empresa_id, v_numero, v_status, v_hosp, q.id, q.categoria_id, v_entrada, v_saida, v_saida, v_adultos, v_criancas,
        coalesce(nullif(p_dados ->> 'origem', ''), 'balcao'), v_acordada, v_faturar, nullif(trim(p_dados ->> 'observacoes'), ''),
        nullif(p_dados ->> 'motivo_viagem', ''), nullif(p_dados ->> 'meio_transporte', ''),
        nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa_veiculo', ''), '[^A-Za-z0-9]', '', 'g')), ''),
        nullif(trim(p_dados ->> 'procedencia'), ''), nullif(trim(p_dados ->> 'destino'), '')
      ) returning id into v_id;
    else
      update public.hotel_reservas
         set status = v_status, hospede_id = v_hosp, quarto_id = q.id, categoria_id = q.categoria_id, entrada = v_entrada, saida = v_saida,
             saida_prevista = v_saida, adultos = v_adultos, criancas = v_criancas,
             origem = coalesce(nullif(p_dados ->> 'origem', ''), origem), diaria_acordada = v_acordada, empresa_faturar_id = v_faturar,
             observacoes = nullif(trim(p_dados ->> 'observacoes'), ''),
             motivo_viagem = coalesce(nullif(p_dados ->> 'motivo_viagem', ''), motivo_viagem),
             meio_transporte = coalesce(nullif(p_dados ->> 'meio_transporte', ''), meio_transporte),
             placa_veiculo = coalesce(nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa_veiculo', ''), '[^A-Za-z0-9]', '', 'g')), ''), placa_veiculo),
             procedencia = coalesce(nullif(trim(p_dados ->> 'procedencia'), ''), procedencia),
             destino = coalesce(nullif(trim(p_dados ->> 'destino'), ''), destino)
       where id = p_id
      returning id, numero into v_id, v_numero;
    end if;
  exception
    when check_violation then
      raise exception 'Confira a reserva: origem, motivo da viagem, meio de transporte e placa do veículo (ex.: ABC1D23).';
  end;

  -- Acompanhantes (quando a lista vem no pedido)
  if p_dados ? 'acompanhantes' then
    delete from public.hotel_reserva_hospedes where reserva_id = v_id;
    for v_acomp in select distinct (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_dados -> 'acompanhantes', '[]'::jsonb)) x loop
      if v_acomp = v_hosp then
        continue;
      end if;
      if not exists (select 1 from public.hotel_hospedes where id = v_acomp and empresa_id = p_empresa_id) then
        raise exception 'Acompanhante não encontrado.';
      end if;
      insert into public.hotel_reserva_hospedes (reserva_id, hospede_id, empresa_id) values (v_id, v_acomp, p_empresa_id);
    end loop;
    if (select count(*) from public.hotel_reserva_hospedes where reserva_id = v_id) + 1 > v_adultos + v_criancas then
      raise exception 'Há mais acompanhantes do que pessoas na reserva.';
    end if;
  end if;

  select coalesce(sum(valor), 0) into v_valor from app.hotel_noites(v_id, v_saida);
  update public.hotel_reservas set valor_previsto = v_valor where id = v_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'valor_previsto', v_valor);
end;
$$;

create or replace function public.hotel_reserva_cancelar(p_reserva_id uuid, p_motivo text, p_no_show boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status not in ('pre_reserva', 'confirmada') then
    raise exception 'Só reservas que ainda não fizeram check-in podem ser canceladas.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo.';
  end if;
  if coalesce(p_no_show, false) and r.entrada > app.hoje() then
    raise exception 'O no-show (não comparecimento) só pode ser marcado a partir do dia da entrada.';
  end if;
  update public.hotel_reservas
     set status = case when coalesce(p_no_show, false) then 'no_show' else 'cancelada' end,
         cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 500)
   where id = r.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Check-in, troca de quarto e check-out
-- -----------------------------------------------------------------------------
create or replace function public.hotel_checkin(p_reserva_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  q public.hotel_quartos;
  h public.hotel_hospedes;
  v_hoje date := app.hoje();
  v_ocupante bigint;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status not in ('pre_reserva', 'confirmada') then
    raise exception 'Esta reserva não está aguardando check-in.';
  end if;
  if r.entrada > v_hoje then
    raise exception 'A entrada desta reserva é %. Para fazer o check-in hoje, altere a data de entrada.', to_char(r.entrada, 'DD/MM/YYYY');
  end if;
  if r.saida <= v_hoje then
    raise exception 'A saída desta reserva já passou. Altere as datas antes do check-in.';
  end if;
  select * into q from public.hotel_quartos where id = r.quarto_id for update;
  if q.limpeza = 'manutencao' then
    raise exception 'O quarto % está em manutenção (%). Troque o quarto da reserva.', q.numero, q.motivo_manutencao;
  end if;
  if q.limpeza <> 'limpo' then
    raise exception 'O quarto % ainda não foi liberado pela governança (situação: %). Marque como limpo ou troque o quarto.',
      q.numero, case q.limpeza when 'sujo' then 'sujo' else 'em limpeza' end;
  end if;
  select numero into v_ocupante from public.hotel_reservas where quarto_id = q.id and status = 'hospedado';
  if v_ocupante is not null then
    raise exception 'O quarto % ainda está ocupado (reserva nº %). Faça o check-out dela ou troque o quarto.', q.numero, v_ocupante;
  end if;
  select * into h from public.hotel_hospedes where id = r.hospede_id;
  if h.cpf is null and h.documento is null then
    raise exception 'Complete o cadastro de % com o CPF ou outro documento antes do check-in (ficha de registro).', h.nome;
  end if;
  begin
    update public.hotel_reservas
       set status = 'hospedado', checkin_em = now(), checkin_por = auth.uid(),
           motivo_viagem = coalesce(nullif(p_dados ->> 'motivo_viagem', ''), motivo_viagem),
           meio_transporte = coalesce(nullif(p_dados ->> 'meio_transporte', ''), meio_transporte),
           placa_veiculo = coalesce(nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa_veiculo', ''), '[^A-Za-z0-9]', '', 'g')), ''), placa_veiculo),
           procedencia = coalesce(nullif(trim(p_dados ->> 'procedencia'), ''), procedencia),
           destino = coalesce(nullif(trim(p_dados ->> 'destino'), ''), destino)
     where id = r.id;
  exception
    when check_violation then
      raise exception 'Confira o motivo da viagem, o meio de transporte e a placa do veículo (ex.: ABC1D23).';
  end;
end;
$$;

create or replace function public.hotel_trocar_quarto(p_reserva_id uuid, p_quarto_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  q public.hotel_quartos;
  c public.hotel_categorias;
  v_inicio date;
  v_valor numeric;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status not in ('pre_reserva', 'confirmada', 'hospedado') then
    raise exception 'Esta reserva já foi encerrada ou cancelada.';
  end if;
  if p_quarto_id = r.quarto_id then
    raise exception 'Escolha um quarto diferente do atual.';
  end if;
  select * into q from public.hotel_quartos where id = p_quarto_id and empresa_id = r.empresa_id for update;
  if q.id is null or not q.ativo then
    raise exception 'Quarto não encontrado.';
  end if;
  select * into c from public.hotel_categorias where id = q.categoria_id;
  if r.adultos + r.criancas > c.capacidade then
    raise exception 'O quarto % (%) comporta até % pessoa(s).', q.numero, c.nome, c.capacidade;
  end if;
  v_inicio := case when r.status = 'hospedado' then greatest(r.entrada, app.hoje()) else r.entrada end;
  perform app.hotel_exigir_livre(q.id, v_inicio, r.saida, r.id);
  if r.status = 'hospedado' then
    -- Troca no meio da estadia: a diária combinada continua a mesma (sem tarifa acordada, fica a de hoje)
    if r.diaria_acordada is null then
      update public.hotel_reservas
         set diaria_acordada = (select n.valor from app.hotel_noites(r.id, greatest(app.hoje() + 1, r.entrada + 1)) n order by n.data desc limit 1)
       where id = r.id;
    end if;
    if q.limpeza <> 'limpo' then
      raise exception 'O quarto % não está liberado pela governança.', q.numero;
    end if;
    if exists (select 1 from public.hotel_reservas where quarto_id = q.id and status = 'hospedado') then
      raise exception 'O quarto % está ocupado.', q.numero;
    end if;
    update public.hotel_quartos set limpeza = 'sujo', limpeza_atualizada_em = now(), limpeza_por = auth.uid() where id = r.quarto_id;
  end if;
  update public.hotel_reservas
     set quarto_id = q.id, categoria_id = q.categoria_id,
         observacoes = left(concat_ws(E'\n', observacoes, 'Troca de quarto em ' || to_char(app.hoje(), 'DD/MM/YYYY') || nullif(': ' || trim(coalesce(p_motivo, '')), ': ')), 1000)
   where id = r.id;
  select coalesce(sum(valor), 0) into v_valor from app.hotel_noites(r.id, r.saida);
  update public.hotel_reservas set valor_previsto = v_valor where id = r.id;
end;
$$;

-- Consumo do restaurante, bar e frigobar na conta do quarto (baixa no estoque)
create or replace function public.hotel_consumo_lancar(p_reserva_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  v_cfg public.gestao_config;
  v_gerente boolean;
  v_setor text := coalesce(nullif(p_dados ->> 'setor', ''), 'restaurante');
  it jsonb;
  p public.nfe_produtos;
  v_q numeric;
  v_preco numeric;
  v_total numeric := 0;
  v_n int := 0;
  v_quarto text;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status <> 'hospedado' then
    raise exception 'O consumo só é lançado na conta de quem está hospedado.';
  end if;
  if v_setor not in ('restaurante', 'bar', 'frigobar', 'lavanderia', 'recepcao', 'outro') then
    raise exception 'Setor do consumo inválido.';
  end if;
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Escolha pelo menos um produto.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 100 then
    raise exception 'No máximo 100 itens por lançamento.';
  end if;
  v_gerente := app.pode(r.empresa_id, 'gestao.gerenciar');
  select * into v_cfg from public.gestao_config where empresa_id = r.empresa_id;
  select numero into v_quarto from public.hotel_quartos where id = r.quarto_id;
  for it in select * from jsonb_array_elements(p_dados -> 'itens') loop
    select * into p from public.nfe_produtos where id = nullif(it ->> 'produto_id', '')::uuid and empresa_id = r.empresa_id and ativo;
    if p.id is null then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    v_q := nullif(it ->> 'quantidade', '')::numeric;
    if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) or v_q > 10000 then
      raise exception 'Quantidade inválida em "%".', p.descricao;
    end if;
    v_preco := p.valor_unitario;
    if nullif(it ->> 'preco_unitario', '') is not null and (it ->> 'preco_unitario')::numeric <> coalesce(p.valor_unitario, -1) then
      if not v_gerente then
        raise exception 'Só o gerente muda o preço de "%".', p.descricao;
      end if;
      v_preco := (it ->> 'preco_unitario')::numeric;
    end if;
    if v_preco is null or v_preco < 0 then
      raise exception 'O produto "%" está sem preço de venda.', p.descricao;
    end if;
    insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, descricao, setor, produto_id, quantidade, valor_unitario, total)
    values (r.empresa_id, r.id, 'consumo', left(p.descricao, 160), v_setor, p.id, v_q, round(v_preco, 2), round(v_q * round(v_preco, 2), 2));
    perform app.estoque_movimentar(r.empresa_id, p.id, 'consumo_hotel', -v_q, null, null, null,
      'Consumo — quarto ' || v_quarto || ' (reserva nº ' || r.numero || ')', coalesce(v_cfg.permitir_estoque_negativo, false));
    v_total := v_total + round(v_q * round(v_preco, 2), 2);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('itens', v_n, 'total', v_total);
end;
$$;

-- Serviços (lavanderia, late check-out, passeio...) e descontos (gerente) na conta
create or replace function public.hotel_servico_lancar(p_reserva_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'servico');
  v_valor numeric := nullif(p_dados ->> 'valor', '')::numeric;
  v_desc text := nullif(trim(p_dados ->> 'descricao'), '');
  v_resumo jsonb;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, case when v_tipo = 'desconto' then 'gestao.gerenciar' else 'gestao.vender' end);
  if r.status <> 'hospedado' then
    raise exception 'Serviços e descontos são lançados na conta de quem está hospedado.';
  end if;
  if v_tipo not in ('servico', 'desconto') then
    raise exception 'Escolha serviço ou desconto.';
  end if;
  if v_desc is null or length(v_desc) > 160 then
    raise exception 'Descreva o lançamento (até 160 letras).';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Informe o valor.';
  end if;
  if v_tipo = 'desconto' then
    v_resumo := app.hotel_resumo(r.id);
    if v_valor > (v_resumo ->> 'total_previsto')::numeric then
      raise exception 'O desconto não pode passar do total da conta.';
    end if;
  end if;
  insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, descricao, setor, quantidade, valor_unitario, total)
  values (r.empresa_id, r.id, v_tipo, v_desc, nullif(p_dados ->> 'setor', ''), 1, v_valor, case when v_tipo = 'desconto' then -v_valor else v_valor end);
end;
$$;

-- Cancela um lançamento da conta (gerente); o consumo volta ao estoque
create or replace function public.hotel_item_cancelar(p_item_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.hotel_conta_itens;
  r public.hotel_reservas;
begin
  select * into i from public.hotel_conta_itens where id = p_item_id for update;
  if i.id is null then
    raise exception 'Lançamento não encontrado.';
  end if;
  select * into r from public.hotel_reservas where id = i.reserva_id for update;
  perform app.exigir_hotel(i.empresa_id, 'gestao.gerenciar');
  if r.status <> 'hospedado' then
    raise exception 'A conta desta reserva já foi fechada.';
  end if;
  if i.cancelado_em is not null then
    raise exception 'Este lançamento já foi cancelado.';
  end if;
  if i.tipo in ('diaria', 'taxa_servico') then
    raise exception 'Diárias e taxa de serviço são calculadas no check-out.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  if i.tipo = 'consumo' then
    perform app.estoque_movimentar(i.empresa_id, i.produto_id, 'estorno_consumo_hotel', i.quantidade, null, null, null,
      'Consumo cancelado — reserva nº ' || r.numero, true);
  end if;
  update public.hotel_conta_itens
     set cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 300)
   where id = i.id;
end;
$$;

-- Pagamento (ou sinal) da conta: vira lançamento no Financeiro
create or replace function public.hotel_pagamento_registrar(p_reserva_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  v_cfg public.gestao_config;
  v_forma text := p_dados ->> 'forma';
  v_valor numeric := nullif(p_dados ->> 'valor', '')::numeric;
  v_venc date := nullif(p_dados ->> 'vencimento', '')::date;
  v_contra uuid := nullif(p_dados ->> 'contraparte_id', '')::uuid;
  v_hoje date := app.hoje();
  v_sessao uuid;
  v_cat uuid;
  v_conta uuid;
  v_lanc uuid;
  v_id uuid;
  v_desc text;
  v_quarto text;
  v_nome text;
  v_adiant boolean;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status not in ('pre_reserva', 'confirmada', 'hospedado') then
    raise exception 'A conta desta reserva já foi fechada.';
  end if;
  if v_forma not in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'faturado', 'outro') then
    raise exception 'Escolha a forma de pagamento.';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Informe o valor recebido.';
  end if;
  v_adiant := r.status <> 'hospedado';
  select * into v_cfg from public.gestao_config where empresa_id = r.empresa_id;
  select numero into v_quarto from public.hotel_quartos where id = r.quarto_id;
  select nome into v_nome from public.hotel_hospedes where id = r.hospede_id;
  v_cat := app.categoria_sistema(r.empresa_id, 'SERVICOS');
  if v_cat is null then
    perform app.criar_plano_contas_padrao(r.empresa_id);
    v_cat := app.categoria_sistema(r.empresa_id, 'SERVICOS');
  end if;
  v_desc := 'Hospedagem — reserva nº ' || r.numero || ' — quarto ' || v_quarto || ' — ' || v_nome || case when v_adiant then ' (sinal)' else '' end;
  -- Recebido com o caixa da pessoa aberto: entra na conferência do caixa
  select id into v_sessao from public.caixa_sessoes
   where empresa_id = r.empresa_id and operador_id = auth.uid() and status = 'aberto' limit 1;

  if v_forma = 'faturado' then
    v_contra := coalesce(v_contra, r.empresa_faturar_id);
    if v_contra is null or not exists (select 1 from public.contrapartes where id = v_contra and empresa_id = r.empresa_id) then
      raise exception 'Escolha a empresa que vai pagar a fatura.';
    end if;
    if v_venc is null or v_venc < v_hoje then
      raise exception 'Informe o vencimento da fatura (hoje ou depois).';
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto,
      origem, origem_referencia, numero_documento
    ) values (
      r.empresa_id, 'receber', v_desc || ' (faturado)', v_cat, v_contra, v_hoje, v_venc, v_valor, 'hotel', r.id::text, 'RES ' || r.numero
    ) returning id into v_lanc;
    v_sessao := null;
  else
    v_contra := null;
    v_venc := null;
    v_conta := case v_forma
      when 'pix' then v_cfg.conta_pix_id
      when 'transferencia' then v_cfg.conta_pix_id
      when 'cartao_debito' then v_cfg.conta_cartao_id
      when 'cartao_credito' then v_cfg.conta_cartao_id
      else v_cfg.conta_dinheiro_id
    end;
    if v_conta is null then
      raise exception 'Configure a conta que recebe este pagamento nas configurações do hotel.';
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, conta_financeira_id, data_competencia, data_vencimento, valor_previsto,
      origem, origem_referencia, numero_documento
    ) values (
      r.empresa_id, 'receber', v_desc, v_cat, v_conta, v_hoje, v_hoje, v_valor, 'hotel', r.id::text, 'RES ' || r.numero
    ) returning id into v_lanc;
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem, observacao)
    values (r.empresa_id, v_lanc, 'receber', v_hoje, v_conta, v_valor, case v_forma when 'outro' then 'outro' else v_forma end, 'hotel', v_desc);
  end if;

  insert into public.hotel_pagamentos (empresa_id, reserva_id, data, forma, valor, adiantamento, contraparte_id, vencimento, sessao_id, lancamento_id, observacao)
  values (r.empresa_id, r.id, v_hoje, v_forma, v_valor, v_adiant, v_contra, v_venc, v_sessao, v_lanc, nullif(left(trim(p_dados ->> 'observacao'), 300), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Estorna um pagamento (gerente), enquanto a conta está aberta
create or replace function public.hotel_pagamento_estornar(p_pagamento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pg public.hotel_pagamentos;
  r public.hotel_reservas;
  v_sessao text;
begin
  select * into pg from public.hotel_pagamentos where id = p_pagamento_id for update;
  if pg.id is null then
    raise exception 'Pagamento não encontrado.';
  end if;
  select * into r from public.hotel_reservas where id = pg.reserva_id for update;
  perform app.exigir_hotel(pg.empresa_id, 'gestao.gerenciar');
  if pg.cancelado_em is not null then
    raise exception 'Este pagamento já foi estornado.';
  end if;
  if r.status = 'encerrada' then
    raise exception 'A conta desta reserva já foi fechada. Faça a devolução pelo Financeiro.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do estorno.';
  end if;
  if pg.sessao_id is not null then
    select status into v_sessao from public.caixa_sessoes where id = pg.sessao_id;
    if v_sessao <> 'aberto' and pg.forma = 'dinheiro' then
      raise exception 'O caixa deste pagamento já foi fechado. Faça a devolução pelo Financeiro.';
    end if;
  end if;
  if pg.lancamento_id is not null then
    if exists (select 1 from public.baixas b where b.lancamento_id = pg.lancamento_id and b.origem <> 'hotel') then
      raise exception 'Este recebimento já foi conciliado no Financeiro. Desfaça a conciliação antes de estornar.';
    end if;
    delete from public.baixas where lancamento_id = pg.lancamento_id and origem = 'hotel';
    update public.lancamentos
       set situacao = 'cancelado', motivo_cancelamento = left('Pagamento da reserva nº ' || r.numero || ' estornado: ' || trim(p_motivo), 500)
     where id = pg.lancamento_id and situacao <> 'cancelado';
  end if;
  update public.hotel_pagamentos
     set cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 300)
   where id = pg.id;
end;
$$;

-- Check-out: lança as diárias até hoje e a taxa de serviço, confere se a conta fechou e libera o quarto para a limpeza
create or replace function public.hotel_checkout(p_reserva_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  v_cfg public.hotel_config;
  v_hoje date := app.hoje();
  v_fim date;
  n record;
  v_numero text;
  v_consumo numeric;
  v_resumo jsonb;
  v_saldo numeric;
  v_conflito public.hotel_reservas;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status <> 'hospedado' then
    raise exception 'Esta reserva não está hospedada.';
  end if;
  v_cfg := app.hotel_cfg(r.empresa_id);
  v_fim := greatest(v_hoje, r.entrada + 1);
  if v_fim > r.saida then
    -- Ficou além do previsto: as noites a mais precisam estar livres no quarto
    v_conflito := app.hotel_conflito(r.quarto_id, r.saida, v_fim, r.id);
    if v_conflito.id is not null then
      raise exception 'O quarto tem a reserva nº % a partir de %. Troque o quarto dela antes de fechar esta conta.',
        v_conflito.numero, to_char(v_conflito.entrada, 'DD/MM/YYYY');
    end if;
  end if;
  select numero into v_numero from public.hotel_quartos where id = r.quarto_id;
  update public.hotel_reservas set saida = v_fim where id = r.id;
  for n in select * from app.hotel_noites(r.id, v_fim) loop
    insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, data, descricao, quantidade, valor_unitario, total)
    values (r.empresa_id, r.id, 'diaria', n.data, 'Diária de ' || to_char(n.data, 'DD/MM') || ' — quarto ' || v_numero, 1, n.valor, n.valor);
  end loop;
  select coalesce(sum(total), 0) into v_consumo from public.hotel_conta_itens where reserva_id = r.id and tipo = 'consumo' and cancelado_em is null;
  if coalesce(v_cfg.taxa_servico, 0) > 0 and v_consumo > 0 then
    insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, descricao, quantidade, valor_unitario, total)
    values (r.empresa_id, r.id, 'taxa_servico', 'Taxa de serviço (' || app.gestao_qtd(v_cfg.taxa_servico) || '% do consumo)', 1,
            round(v_consumo * v_cfg.taxa_servico / 100, 2), round(v_consumo * v_cfg.taxa_servico / 100, 2));
  end if;
  update public.hotel_reservas
     set status = 'encerrada', checkout_em = now(), checkout_por = auth.uid()
   where id = r.id;
  v_resumo := app.hotel_resumo(r.id);
  v_saldo := (v_resumo ->> 'saldo')::numeric;
  if v_saldo > 0 then
    raise exception 'Falta receber % para fechar a conta. Registre o pagamento (ou fature para a empresa) e faça o check-out de novo.', app.hotel_moeda(v_saldo);
  end if;
  if v_saldo < 0 then
    raise exception 'Os pagamentos passam do total da conta em %. Estorne o pagamento a mais (ou lance o que faltou) antes do check-out.', app.hotel_moeda(-v_saldo);
  end if;
  update public.hotel_quartos set limpeza = 'sujo', limpeza_atualizada_em = now(), limpeza_por = auth.uid() where id = r.quarto_id;
  return v_resumo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Caixa: os recebimentos do hotel feitos com o caixa aberto entram na conferência
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
      from public.hotel_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
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
    'sangrias', m.sangrias,
    'suprimentos', m.suprimentos,
    'qtd_sangrias', m.qtd_sangrias,
    'qtd_suprimentos', m.qtd_suprimentos,
    'dinheiro_esperado', s.valor_abertura + coalesce((select valor from pg where forma = 'dinheiro'), 0)
      + coalesce((select valor from h where forma = 'dinheiro'), 0) + m.suprimentos - m.sangrias
  )
  from s, m;
$$;

-- -----------------------------------------------------------------------------
-- 14. Acesso: leitura por quem usa a gestão da própria empresa; escrita só pelas funções
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['hotel_config', 'hotel_categorias', 'hotel_quartos', 'hotel_tarifas', 'hotel_hospedes', 'hotel_reservas',
                           'hotel_reserva_hospedes', 'hotel_conta_itens', 'hotel_pagamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (empresa_id = any ((select app.empresas_com(''gestao.vender''))::uuid[]))',
      t || '_leitura', t
    );
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

revoke execute on function app.exigir_hotel(uuid, text), app.hotel_cfg(uuid), app.hotel_moeda(numeric), app.hotel_diaria_noite(uuid, date),
  app.hotel_noites(uuid, date), app.hotel_conflito(uuid, date, date, uuid), app.hotel_exigir_livre(uuid, date, date, uuid), app.hotel_resumo(uuid)
  from public, anon, authenticated;
revoke execute on function public.hotel_conta_resumo(uuid), public.hotel_configurar(uuid, jsonb), public.hotel_categoria_salvar(uuid, uuid, jsonb),
  public.hotel_quarto_salvar(uuid, uuid, jsonb), public.hotel_tarifa_salvar(uuid, jsonb), public.hotel_tarifa_excluir(uuid),
  public.hotel_quarto_limpeza(uuid, text, text), public.hotel_hospede_salvar(uuid, uuid, jsonb), public.hotel_hospede_excluir(uuid),
  public.hotel_reserva_salvar(uuid, uuid, jsonb), public.hotel_reserva_cancelar(uuid, text, boolean), public.hotel_checkin(uuid, jsonb),
  public.hotel_trocar_quarto(uuid, uuid, text), public.hotel_consumo_lancar(uuid, jsonb), public.hotel_servico_lancar(uuid, jsonb),
  public.hotel_item_cancelar(uuid, text), public.hotel_pagamento_registrar(uuid, jsonb), public.hotel_pagamento_estornar(uuid, text),
  public.hotel_checkout(uuid)
  from public, anon;
grant execute on function public.hotel_conta_resumo(uuid), public.hotel_configurar(uuid, jsonb), public.hotel_categoria_salvar(uuid, uuid, jsonb),
  public.hotel_quarto_salvar(uuid, uuid, jsonb), public.hotel_tarifa_salvar(uuid, jsonb), public.hotel_tarifa_excluir(uuid),
  public.hotel_quarto_limpeza(uuid, text, text), public.hotel_hospede_salvar(uuid, uuid, jsonb), public.hotel_hospede_excluir(uuid),
  public.hotel_reserva_salvar(uuid, uuid, jsonb), public.hotel_reserva_cancelar(uuid, text, boolean), public.hotel_checkin(uuid, jsonb),
  public.hotel_trocar_quarto(uuid, uuid, text), public.hotel_consumo_lancar(uuid, jsonb), public.hotel_servico_lancar(uuid, jsonb),
  public.hotel_item_cancelar(uuid, text), public.hotel_pagamento_registrar(uuid, jsonb), public.hotel_pagamento_estornar(uuid, text),
  public.hotel_checkout(uuid)
  to authenticated;
