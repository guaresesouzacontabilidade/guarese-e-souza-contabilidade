-- =============================================================================
-- Cálculos → Apuração do ICMS
--
--  * O portal calcula, mês a mês, o ICMS que cada empresa tem a pagar a partir
--    dos XML das notas (NF-e, NFC-e e CT-e) guardados no portal:
--      - regime normal (Lucro Presumido/Real): débitos das saídas, créditos das
--        entradas, saldo credor do mês anterior e lançamentos do escritório,
--        como no registro E110 da EFD ICMS/IPI;
--      - Simples Nacional e MEI: complementação de alíquota nas compras de
--        outros estados para revenda/industrialização (Tocantins: RICMS/TO,
--        art. 508-B; redução de base da Lei nº 1.303/2002, art. 1º-A);
--      - todos: diferencial de alíquotas (DIFAL) nas compras de outros estados
--        para uso e consumo ou ativo imobilizado, ICMS-ST retido nas vendas e
--        DIFAL das vendas a consumidor final de outro estado.
--    As contas são feitas no servidor do portal (src/lib/calculos/icms.ts); o
--    banco entrega os dados de quem tem permissão e guarda as escolhas e a
--    conferência do escritório.
--  * A nota do fornecedor não diz para que a compra serve (revenda, uso e
--    consumo ou ativo): o escritório define a destinação padrão da empresa e,
--    quando precisar, a de um fornecedor, de uma nota ou de um item.
--  * A conferência do mês congela o resultado (guias e saldo credor que passa
--    para o mês seguinte). Para mudar, o escritório reabre com motivo.
--  * Nada é enviado à SEFAZ: o portal não emite DARE nem transmite a EFD.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Destinação padrão das compras da empresa
-- -----------------------------------------------------------------------------
alter table public.calculo_parametros
  add column icms_destinacao_padrao text not null default 'revenda'
    check (icms_destinacao_padrao in ('revenda', 'uso_consumo'));

-- -----------------------------------------------------------------------------
-- 2. Destinação das entradas: por fornecedor, por nota ou por item
--    (prevalece o mais específico: item → nota → fornecedor → padrão)
-- -----------------------------------------------------------------------------
create table public.icms_destinacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento_fiscal_id uuid,
  numero_item int check (numero_item is null or numero_item > 0),
  fornecedor_documento text check (fornecedor_documento is null or fornecedor_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  destinacao text not null check (destinacao in ('revenda', 'uso_consumo', 'ativo', 'nao_se_aplica')),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, documento_fiscal_id) references public.documentos_fiscais (empresa_id, id) on delete cascade,
  constraint icms_destinacoes_alvo check (
    (documento_fiscal_id is not null and fornecedor_documento is null)
    or (documento_fiscal_id is null and fornecedor_documento is not null and numero_item is null))
);
create unique index icms_destinacoes_nota_uidx on public.icms_destinacoes (documento_fiscal_id, coalesce(numero_item, 0))
  where documento_fiscal_id is not null;
create unique index icms_destinacoes_fornecedor_uidx on public.icms_destinacoes (empresa_id, fornecedor_documento)
  where fornecedor_documento is not null;
create index icms_destinacoes_empresa_idx on public.icms_destinacoes (empresa_id);
create trigger icms_destinacoes_updated_at before update on public.icms_destinacoes
  for each row execute function app.tg_updated_at();
create trigger auditoria_icms_destinacoes after insert or update or delete on public.icms_destinacoes
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Lançamentos do escritório na apuração do mês
--    outro_debito, estorno_credito, outro_credito (ex.: parcela do CIAP),
--    estorno_debito e deducao seguem o E110; guia_extra é outro ICMS pago em
--    guia à parte (ex.: ICMS-ST na entrada sem retenção pelo fornecedor).
-- -----------------------------------------------------------------------------
create table public.icms_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  tipo text not null check (tipo in ('outro_debito', 'estorno_credito', 'outro_credito', 'estorno_debito', 'deducao', 'guia_extra')),
  descricao text not null check (length(trim(descricao)) between 3 and 120),
  valor numeric(15, 2) not null check (valor > 0 and valor < 1000000000),
  observacao text check (observacao is null or length(observacao) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index icms_lancamentos_empresa_idx on public.icms_lancamentos (empresa_id, competencia);
create trigger auditoria_icms_lancamentos after insert or update or delete on public.icms_lancamentos
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 4. Apuração do mês: saldo credor anterior informado e conferência
-- -----------------------------------------------------------------------------
create table public.icms_apuracoes (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  -- Saldo credor do mês anterior informado pelo escritório (primeiro mês no
  -- portal ou ajuste). Nulo: vem da conferência do mês anterior.
  saldo_credor_anterior numeric(15, 2) check (saldo_credor_anterior is null or saldo_credor_anterior >= 0),
  saldo_observacao text check (saldo_observacao is null or length(saldo_observacao) <= 300),
  conferida_em timestamptz,
  conferida_por uuid references public.perfis(id) on delete set null,
  a_recolher numeric(15, 2) check (a_recolher is null or a_recolher >= 0),
  saldo_credor_transportar numeric(15, 2) check (saldo_credor_transportar is null or saldo_credor_transportar >= 0),
  total_guias numeric(15, 2) check (total_guias is null or total_guias >= 0),
  resultado jsonb,
  reaberta_em timestamptz,
  reaberta_por uuid references public.perfis(id) on delete set null,
  motivo_reabertura text check (motivo_reabertura is null or length(motivo_reabertura) <= 300),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, competencia),
  constraint icms_apuracoes_conferencia check (
    (conferida_em is null and resultado is null and a_recolher is null and saldo_credor_transportar is null and total_guias is null)
    or (conferida_em is not null and resultado is not null and a_recolher is not null
        and saldo_credor_transportar is not null and total_guias is not null))
);
create trigger icms_apuracoes_updated_at before update on public.icms_apuracoes
  for each row execute function app.tg_updated_at();
create trigger auditoria_icms_apuracoes after insert or update or delete on public.icms_apuracoes
  for each row execute function app.tg_auditoria();

-- Mês ainda não conferido (lançamentos e destinações só mudam com o mês aberto)
create or replace function app.icms_mes_aberto(p_empresa_id uuid, p_competencia date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.icms_apuracoes a
     where a.empresa_id = p_empresa_id
       and a.competencia = date_trunc('month', p_competencia)::date
       and a.conferida_em is not null);
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS e privilégios: lê quem vê os cálculos; altera só a equipe
--    (calculos.gerenciar), pelas funções abaixo ou com o mês aberto.
-- -----------------------------------------------------------------------------
alter table public.icms_destinacoes enable row level security;
alter table public.icms_lancamentos enable row level security;
alter table public.icms_apuracoes enable row level security;

create policy icms_destinacoes_leitura on public.icms_destinacoes for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));
create policy icms_lancamentos_leitura on public.icms_lancamentos for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));
create policy icms_lancamentos_insercao on public.icms_lancamentos for insert to authenticated
  with check ((select app.pode(empresa_id, 'calculos.gerenciar')) and app.icms_mes_aberto(empresa_id, competencia));
create policy icms_lancamentos_exclusao on public.icms_lancamentos for delete to authenticated
  using ((select app.pode(empresa_id, 'calculos.gerenciar')) and app.icms_mes_aberto(empresa_id, competencia));
create policy icms_apuracoes_leitura on public.icms_apuracoes for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));

grant select on public.icms_destinacoes, public.icms_lancamentos, public.icms_apuracoes to authenticated;
grant insert (empresa_id, competencia, tipo, descricao, valor, observacao), delete on public.icms_lancamentos to authenticated;
grant execute on function app.icms_mes_aberto(uuid, date) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Funções de escrita (equipe)
-- -----------------------------------------------------------------------------

-- Destinação de uma nota, de um item ou de um fornecedor (nulo = volta ao padrão)
create or replace function public.icms_definir_destinacao(
  p_empresa_id uuid,
  p_documento_fiscal_id uuid,
  p_numero_item int,
  p_fornecedor text,
  p_destinacao text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date;
  v_forn text := nullif(regexp_replace(coalesce(p_fornecedor, ''), '\D', '', 'g'), '');
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if p_destinacao is not null and p_destinacao not in ('revenda', 'uso_consumo', 'ativo', 'nao_se_aplica') then
    raise exception 'Destinação inválida.' using errcode = '22023';
  end if;
  if (p_documento_fiscal_id is null) = (v_forn is null) then
    raise exception 'Informe a nota ou o fornecedor.' using errcode = '22023';
  end if;

  if p_documento_fiscal_id is not null then
    select df.competencia into v_comp
      from public.documentos_fiscais df
     where df.id = p_documento_fiscal_id and df.empresa_id = p_empresa_id and df.operacao = 'entrada';
    if v_comp is null then
      raise exception 'Nota de entrada não encontrada nesta empresa.' using errcode = '22023';
    end if;
    if not app.icms_mes_aberto(p_empresa_id, v_comp) then
      raise exception 'A apuração do ICMS de % já foi conferida: reabra o mês para mudar.', to_char(v_comp, 'MM/YYYY') using errcode = '22023';
    end if;
    if p_numero_item is not null and not exists (
      select 1 from public.documento_fiscal_itens i where i.documento_fiscal_id = p_documento_fiscal_id and i.numero_item = p_numero_item
    ) then
      raise exception 'Item não encontrado na nota.' using errcode = '22023';
    end if;
    if p_destinacao is null then
      delete from public.icms_destinacoes
       where documento_fiscal_id = p_documento_fiscal_id and coalesce(numero_item, 0) = coalesce(p_numero_item, 0);
    else
      insert into public.icms_destinacoes (empresa_id, documento_fiscal_id, numero_item, destinacao)
      values (p_empresa_id, p_documento_fiscal_id, p_numero_item, p_destinacao)
      on conflict (documento_fiscal_id, coalesce(numero_item, 0)) where documento_fiscal_id is not null
      do update set destinacao = excluded.destinacao, atualizado_por = auth.uid();
    end if;
  else
    if v_forn !~ '^([0-9]{11}|[0-9]{14})$' then
      raise exception 'CNPJ ou CPF do fornecedor inválido.' using errcode = '22023';
    end if;
    if p_destinacao is null then
      delete from public.icms_destinacoes where empresa_id = p_empresa_id and fornecedor_documento = v_forn;
    else
      insert into public.icms_destinacoes (empresa_id, fornecedor_documento, destinacao)
      values (p_empresa_id, v_forn, p_destinacao)
      on conflict (empresa_id, fornecedor_documento) where fornecedor_documento is not null
      do update set destinacao = excluded.destinacao, atualizado_por = auth.uid();
    end if;
  end if;
end;
$$;

-- Destinação padrão das compras da empresa (cria os parâmetros se ainda não existem)
create or replace function public.icms_definir_destinacao_padrao(p_empresa_id uuid, p_destinacao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if p_destinacao not in ('revenda', 'uso_consumo') then
    raise exception 'Destinação padrão inválida.' using errcode = '22023';
  end if;
  insert into public.calculo_parametros (empresa_id, icms_destinacao_padrao)
  values (p_empresa_id, p_destinacao)
  on conflict (empresa_id) do update set icms_destinacao_padrao = excluded.icms_destinacao_padrao, atualizado_por = auth.uid();
end;
$$;

-- Saldo credor do mês anterior informado pelo escritório (nulo = automático)
create or replace function public.icms_informar_saldo_anterior(p_empresa_id uuid, p_competencia date, p_valor numeric, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if p_valor is not null and (p_valor < 0 or p_valor >= 1000000000) then
    raise exception 'Informe um saldo de zero para cima.' using errcode = '22023';
  end if;
  if not app.icms_mes_aberto(p_empresa_id, v_comp) then
    raise exception 'A apuração do ICMS de % já foi conferida: reabra o mês para mudar.', to_char(v_comp, 'MM/YYYY') using errcode = '22023';
  end if;
  insert into public.icms_apuracoes (empresa_id, competencia, saldo_credor_anterior, saldo_observacao)
  values (p_empresa_id, v_comp, round(p_valor, 2), nullif(left(trim(coalesce(p_observacao, '')), 300), ''))
  on conflict (empresa_id, competencia) do update
    set saldo_credor_anterior = excluded.saldo_credor_anterior, saldo_observacao = excluded.saldo_observacao;
end;
$$;

-- Conferência do mês: guarda o resultado calculado pelo portal (valores e linhas)
create or replace function public.icms_conferir(p_empresa_id uuid, p_competencia date, p_resultado jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_recolher numeric := app.try_numeric(p_resultado ->> 'a_recolher');
  v_saldo numeric := app.try_numeric(p_resultado ->> 'saldo_credor_transportar');
  v_guias numeric := app.try_numeric(p_resultado ->> 'total_guias');
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if v_recolher is null or v_saldo is null or v_guias is null or v_recolher < 0 or v_saldo < 0 or v_guias < 0
     or jsonb_typeof(p_resultado -> 'linhas') is distinct from 'array' then
    raise exception 'Resultado da apuração inválido.' using errcode = '22023';
  end if;
  if not app.icms_mes_aberto(p_empresa_id, v_comp) then
    raise exception 'A apuração do ICMS de % já foi conferida.', to_char(v_comp, 'MM/YYYY') using errcode = '22023';
  end if;
  insert into public.icms_apuracoes (empresa_id, competencia, conferida_em, conferida_por, a_recolher, saldo_credor_transportar, total_guias, resultado)
  values (p_empresa_id, v_comp, now(), auth.uid(), round(v_recolher, 2), round(v_saldo, 2), round(v_guias, 2), p_resultado)
  on conflict (empresa_id, competencia) do update
    set conferida_em = now(), conferida_por = auth.uid(), a_recolher = excluded.a_recolher,
        saldo_credor_transportar = excluded.saldo_credor_transportar, total_guias = excluded.total_guias, resultado = excluded.resultado;
  perform app.registrar_auditoria('icms_apuracao_conferida', 'icms_apuracao', to_char(v_comp, 'YYYY-MM'), p_empresa_id,
    jsonb_build_object('competencia', v_comp, 'a_recolher', round(v_recolher, 2), 'saldo_credor_transportar', round(v_saldo, 2),
                       'total_guias', round(v_guias, 2)));
end;
$$;

-- Reabertura (com motivo). O mês seguinte conferido depende do saldo deste:
-- precisa ser reaberto antes.
create or replace function public.icms_reabrir(p_empresa_id uuid, p_competencia date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo da reabertura.' using errcode = '22023';
  end if;
  if app.icms_mes_aberto(p_empresa_id, v_comp) then
    raise exception 'A apuração deste mês não está conferida.' using errcode = '22023';
  end if;
  if not app.icms_mes_aberto(p_empresa_id, (v_comp + interval '1 month')::date) then
    raise exception 'O mês seguinte (%) já foi conferido com o saldo deste mês: reabra-o antes.',
      to_char(v_comp + interval '1 month', 'MM/YYYY') using errcode = '22023';
  end if;
  update public.icms_apuracoes
     set conferida_em = null, conferida_por = null, a_recolher = null, saldo_credor_transportar = null, total_guias = null,
         resultado = null, reaberta_em = now(), reaberta_por = auth.uid(), motivo_reabertura = left(trim(p_motivo), 300)
   where empresa_id = p_empresa_id and competencia = v_comp;
  perform app.registrar_auditoria('icms_apuracao_reaberta', 'icms_apuracao', to_char(v_comp, 'YYYY-MM'), p_empresa_id,
    jsonb_build_object('competencia', v_comp, 'motivo', left(trim(p_motivo), 300)));
end;
$$;

-- Releitura das notas do mês gravadas com leitura anterior (fila)
create or replace function public.icms_reler_notas(p_empresa_id uuid, p_competencia date, p_versao_leitura int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_total int;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  select count(*) into v_total
    from public.documentos_fiscais df
   where df.empresa_id = p_empresa_id and df.competencia = v_comp and df.modelo in ('55', '65')
     and df.leitura_versao < p_versao_leitura;
  if v_total > 0 then
    perform app.enfileirar('reler_notas_mes', jsonb_build_object('empresa_id', p_empresa_id, 'competencia', v_comp), p_empresa_id,
                           format('reler:%s:%s:%s', p_empresa_id, to_char(v_comp, 'YYYY-MM'), to_char(now(), 'YYYYMMDDHH24MI')), now(), 70);
  end if;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Dados da apuração do mês
--    Saídas somadas por CFOP; entradas (NF-e e CT-e) nota a nota com os itens,
--    para a destinação e as alíquotas interestaduais. Nome do fornecedor e
--    descrição dos itens só para quem vê os documentos ou gerencia os cálculos.
-- -----------------------------------------------------------------------------
create or replace function public.dados_apuracao_icms(p_empresa_id uuid, p_competencia date, p_versao_leitura int default 4)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_emp public.empresas;
  v_raiz text;
  v_detalhe boolean;
  v_gerenciar boolean;
  v_dados jsonb;
begin
  perform app.exigir(p_empresa_id, 'calculos.ver');
  select * into v_emp from public.empresas where id = p_empresa_id;
  v_raiz := left(regexp_replace(coalesce(v_emp.documento, ''), '\D', '', 'g'), 8);
  v_gerenciar := app.pode(p_empresa_id, 'calculos.gerenciar');
  v_detalhe := v_gerenciar or app.pode(p_empresa_id, 'documentos.ver');

  with notas as (
    select df.*
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
     where df.empresa_id = p_empresa_id
       and df.competencia = v_comp
       and df.relacionado_empresa
       and not df.cancelada_evento
       and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
       and d.excluido_em is null
       and coalesce(d.verificacao_status, '') <> 'bloqueado'
       and not (df.avisos::text ilike '%registro de cancelamento%')
  ),
  itens_saida as (
    select coalesce(i.cfop, '') as cfop, n.id as nota_id,
           coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor,
           coalesce(app.try_numeric(i.tributos ->> 'bc_icms'), 0) as base,
           coalesce(app.try_numeric(i.tributos ->> 'icms'), 0) as icms
      from notas n
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
     where n.operacao = 'saida' and n.modelo in ('55', '65')
  )
  select jsonb_build_object(
    'saidas', coalesce((
      select jsonb_agg(jsonb_build_object('cfop', s.cfop, 'notas', s.notas, 'valor', s.valor, 'base', s.base, 'icms', s.icms) order by s.cfop)
        from (select cfop, count(distinct nota_id) as notas, sum(valor) as valor, sum(base) as base, sum(icms) as icms
                from itens_saida group by cfop) s
    ), '[]'::jsonb),
    'saidas_totais', (
      select jsonb_build_object(
               'notas', count(*),
               'nfce', count(*) filter (where n.modelo = '65'),
               'icms_st', coalesce(sum(app.try_numeric(n.tributos ->> 'icms_st')), 0),
               'fcp', coalesce(sum(app.try_numeric(n.tributos ->> 'fcp')), 0),
               'difal_destino', coalesce(sum(app.try_numeric(n.tributos ->> 'difal_destino')), 0),
               'fcp_destino', coalesce(sum(app.try_numeric(n.tributos ->> 'fcp_destino')), 0),
               'vendas_outro_estado_consumidor', count(*) filter (where n.consumidor_final and n.id_destino = '2' and n.ind_ie_dest = '9'))
        from notas n
       where n.operacao = 'saida' and n.modelo in ('55', '65')
    ),
    'entradas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'modelo', n.modelo,
               'numero', n.numero,
               'serie', n.serie,
               'data', n.data_emissao,
               'emitente', case when v_detalhe then n.emitente_nome end,
               'emitente_documento', case when v_detalhe then n.emitente_documento end,
               'emitente_uf', n.emitente_uf,
               'propria', coalesce(left(n.emitente_documento, 8) = v_raiz and length(n.emitente_documento) = 14, false),
               'crt', n.crt_emitente,
               'valor_total', n.valor_total,
               'valor_produtos', n.valor_produtos,
               'frete', n.valor_frete,
               'outros', n.valor_outros,
               'seguro', app.try_numeric(n.tributos ->> 'seguro'),
               'icms', app.try_numeric(n.tributos ->> 'icms'),
               'leitura', n.leitura_versao,
               'destinacao', (select d.destinacao from public.icms_destinacoes d where d.documento_fiscal_id = n.id and d.numero_item is null),
               -- Regra do fornecedor (vale mesmo para quem não vê o CNPJ dele)
               'destinacao_fornecedor', (select d.destinacao from public.icms_destinacoes d
                                          where d.empresa_id = p_empresa_id and d.fornecedor_documento = n.emitente_documento),
               'itens', coalesce((
                 select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          'n', i.numero_item,
                          'cfop', i.cfop,
                          'ncm', i.ncm,
                          'cest', i.cest,
                          'descricao', case when v_detalhe then left(i.descricao, 80) end,
                          'valor', coalesce(i.valor_total, 0),
                          'desconto', i.valor_desconto,
                          'orig', i.tributos ->> 'orig',
                          'cst', i.tributos ->> 'cst_icms',
                          'csosn', i.tributos ->> 'csosn',
                          'bc', i.tributos ->> 'bc_icms',
                          'p_icms', i.tributos ->> 'p_icms',
                          'icms', i.tributos ->> 'icms',
                          'icms_st', i.tributos ->> 'icms_st',
                          'icms_st_retido', i.tributos ->> 'icms_st_retido',
                          'cred_sn', i.tributos ->> 'cred_icms_sn',
                          'ipi', i.tributos ->> 'ipi',
                          'frete', i.tributos ->> 'frete',
                          'seguro', i.tributos ->> 'seguro',
                          'outros', i.tributos ->> 'outros',
                          'destinacao', (select d.destinacao from public.icms_destinacoes d
                                          where d.documento_fiscal_id = n.id and d.numero_item = i.numero_item)
                        )) order by i.numero_item)
                   from public.documento_fiscal_itens i
                  where i.documento_fiscal_id = n.id
               ), '[]'::jsonb)
             ) order by n.data_emissao, n.numero)
        from notas n
       where n.operacao = 'entrada' and n.modelo in ('55', '57')
    ), '[]'::jsonb),
    'fornecedores', coalesce((
      select jsonb_object_agg(d.fornecedor_documento, d.destinacao)
        from public.icms_destinacoes d
       where d.empresa_id = p_empresa_id and d.fornecedor_documento is not null
         and d.fornecedor_documento in (select n.emitente_documento from notas n where n.operacao = 'entrada')
    ), '{}'::jsonb),
    'leitura_antiga', (select count(*) from notas n where n.modelo in ('55', '65') and n.leitura_versao < p_versao_leitura)
  )
  into v_dados
  from (select 1) x;

  return v_dados || jsonb_build_object(
    'competencia', v_comp,
    'empresa', jsonb_build_object(
      'nome', coalesce(nullif(trim(v_emp.nome_fantasia), ''), v_emp.razao_social),
      'uf', upper(v_emp.uf),
      'regime', app.regime_em(p_empresa_id, v_comp),
      'contribuinte_icms', v_emp.contribuinte_icms,
      'inscricao_estadual', nullif(trim(coalesce(v_emp.inscricao_estadual, '')), '') is not null
    ),
    'gerenciar', v_gerenciar,
    'detalhe', v_detalhe,
    'destinacao_padrao', coalesce((select p.icms_destinacao_padrao from public.calculo_parametros p where p.empresa_id = p_empresa_id), 'revenda'),
    'aliquota_interna', (
      select jsonb_build_object('uf', u.uf, 'aliquota', u.aliquota_interna, 'situacao', u.aliquota_situacao, 'fcp', u.fcp,
                                'base_legal', u.aliquota_base_legal, 'fonte_url', u.aliquota_fonte_url)
        from public.icms_uf u where u.uf = upper(v_emp.uf)
    ),
    'lancamentos', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'tipo', l.tipo, 'descricao', l.descricao, 'valor', l.valor, 'observacao', l.observacao)
                       order by l.created_at)
        from public.icms_lancamentos l
       where l.empresa_id = p_empresa_id and l.competencia = v_comp
    ), '[]'::jsonb),
    'apuracao', (
      select jsonb_build_object(
               'saldo_credor_anterior', a.saldo_credor_anterior,
               'saldo_observacao', a.saldo_observacao,
               'conferida_em', a.conferida_em,
               'conferida_por', (select p.nome from public.perfis p where p.id = a.conferida_por),
               'a_recolher', a.a_recolher,
               'saldo_credor_transportar', a.saldo_credor_transportar,
               'total_guias', a.total_guias,
               'resultado', a.resultado,
               'reaberta_em', a.reaberta_em,
               'motivo_reabertura', a.motivo_reabertura)
        from public.icms_apuracoes a
       where a.empresa_id = p_empresa_id and a.competencia = v_comp
    ),
    'anterior', (
      select jsonb_build_object('conferida', a.conferida_em is not null, 'saldo_credor_transportar', a.saldo_credor_transportar)
        from public.icms_apuracoes a
       where a.empresa_id = p_empresa_id and a.competencia = (v_comp - interval '1 month')::date
    ),
    -- Apuração declarada na EFD ICMS/IPI do mês (E110), para comparar (equipe)
    'sped', case when v_gerenciar then (
      select jsonb_build_object('arquivo_id', s.id, 'nome', s.nome_arquivo, 'apuracao', s.totais -> 'apuracao', 'conferido_em', s.conferido_em)
        from public.sped_arquivos s
       where s.empresa_id = p_empresa_id and s.tipo = 'efd_icms_ipi' and s.vigente and s.situacao = 'conferido'
         and s.periodo_inicio = v_comp and s.totais ? 'apuracao'
       order by s.created_at desc
       limit 1
    ) end,
    'releitura_pendente', exists (
      select 1 from public.jobs j
       where j.tipo = 'reler_notas_mes' and j.empresa_id = p_empresa_id and j.status in ('pendente', 'executando')
         and j.payload ->> 'competencia' = to_char(v_comp, 'YYYY-MM-DD')
    ),
    -- Vencimento calculado pelo módulo de obrigações (regra validada), quando houver
    'vencimentos', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', o.codigo, 'vencimento', t.prazo_legal))
        from public.tarefas t
        join public.obrigacoes o on o.id = t.obrigacao_id
       where t.empresa_id = p_empresa_id and t.competencia = v_comp and t.etapa = 'pagamento' and t.status <> 'dispensada'
         and o.codigo = 'ICMS'
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. ICMS da carteira: empresas que a equipe gerencia, com a situação do mês
-- -----------------------------------------------------------------------------
create or replace function public.icms_carteira(p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
begin
  if not app.usuario_valido() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id,
             'nome', coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social),
             'documento', e.documento,
             'uf', upper(e.uf),
             'regime', app.regime_em(e.id, v_comp),
             'contribuinte_icms', e.contribuinte_icms,
             'conferida_em', a.conferida_em,
             'a_recolher', a.a_recolher,
             'total_guias', a.total_guias,
             'saldo_credor_transportar', a.saldo_credor_transportar,
             'notas', (select count(*) from public.documentos_fiscais df
                        where df.empresa_id = e.id and df.competencia = v_comp and df.relacionado_empresa
                          and df.modelo in ('55', '65', '57') and not df.cancelada_evento)
           ) order by coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social))
      from public.empresas e
      left join public.icms_apuracoes a on a.empresa_id = e.id and a.competencia = v_comp
     where e.ativa and app.pode(e.id, 'calculos.gerenciar')
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.icms_definir_destinacao(uuid, uuid, int, text, text) to authenticated;
grant execute on function public.icms_definir_destinacao_padrao(uuid, text) to authenticated;
grant execute on function public.icms_informar_saldo_anterior(uuid, date, numeric, text) to authenticated;
grant execute on function public.icms_conferir(uuid, date, jsonb) to authenticated;
grant execute on function public.icms_reabrir(uuid, date, text) to authenticated;
grant execute on function public.icms_reler_notas(uuid, date, int) to authenticated;
grant execute on function public.dados_apuracao_icms(uuid, date, int) to authenticated;
grant execute on function public.icms_carteira(date) to authenticated;
revoke execute on function public.icms_definir_destinacao(uuid, uuid, int, text, text), public.icms_definir_destinacao_padrao(uuid, text),
  public.icms_informar_saldo_anterior(uuid, date, numeric, text), public.icms_conferir(uuid, date, jsonb), public.icms_reabrir(uuid, date, text),
  public.icms_reler_notas(uuid, date, int), public.dados_apuracao_icms(uuid, date, int), public.icms_carteira(date) from public, anon;
