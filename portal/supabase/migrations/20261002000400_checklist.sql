-- =============================================================================
-- Migração 0400: checklist mensal configurável e pendências
-- =============================================================================
-- Regra central: enviar um arquivo NÃO conclui a obrigação. Um item só fica
-- "concluído" quando a quantidade mínima de documentos foi CONFERIDA (aprovada)
-- pelo escritório, ou quando a equipe conclui manualmente com justificativa.
-- =============================================================================

create table public.checklist_modelos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo_padrao text,                       -- identifica modelos criados pelo padrão do escritório
  categoria_codigo text not null references public.categorias_documento(codigo),
  titulo text not null,
  descricao text,
  obrigatorio boolean not null default true,
  quantidade_minima int not null default 1 check (quantidade_minima between 1 and 100),
  por_conta boolean not null default false,  -- gera um item por conta financeira ativa
  tipos_conta text[],
  conta_financeira_id uuid,                  -- item específico de uma conta
  dia_prazo int not null default 10 check (dia_prazo between 1 and 31),
  meses_apos int not null default 1 check (meses_apos between 0 and 3),  -- 1 = prazo no mês seguinte à competência
  periodicidade text not null default 'mensal' check (periodicidade in ('mensal', 'trimestral', 'anual')),
  meses int[],                               -- meses (1-12) em que o item é exigido (trimestral/anual)
  responsavel_cliente_id uuid references public.perfis(id) on delete set null,
  responsavel_equipe_id uuid references public.perfis(id) on delete set null,
  servico text,
  ativo boolean not null default true,
  ordem int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_modelos_padrao_unico unique (empresa_id, codigo_padrao)
);
create index checklist_modelos_empresa_idx on public.checklist_modelos (empresa_id) where ativo;
create trigger checklist_modelos_updated_at before update on public.checklist_modelos
  for each row execute function app.tg_updated_at();
create trigger auditoria_checklist_modelos after insert or update or delete on public.checklist_modelos
  for each row execute function app.tg_auditoria();

create table public.checklist_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  modelo_id uuid references public.checklist_modelos(id) on delete set null,
  chave_geracao text unique,                  -- garante geração idempotente
  conta_financeira_id uuid,
  categoria_codigo text not null references public.categorias_documento(codigo),
  titulo text not null,
  descricao text,
  obrigatorio boolean not null default true,
  quantidade_minima int not null default 1 check (quantidade_minima between 1 and 100),
  prazo date not null,
  responsavel_cliente_id uuid references public.perfis(id) on delete set null,
  responsavel_equipe_id uuid references public.perfis(id) on delete set null,
  status text not null default 'pendente' check (status in (
    'pendente', 'enviado', 'em_analise', 'correcao', 'concluido', 'nao_se_aplica_solicitado', 'nao_se_aplica'
  )),
  status_atualizado_em timestamptz not null default now(),
  conclusao_manual boolean not null default false,
  concluido_por uuid references public.perfis(id) on delete set null,
  concluido_em timestamptz,
  conclusao_observacao text,
  correcao_motivo text,
  correcao_solicitada_em timestamptz,
  nao_aplica_justificativa text,
  nao_aplica_solicitado_por uuid references public.perfis(id) on delete set null,
  nao_aplica_solicitado_em timestamptz,
  nao_aplica_revisado_por uuid references public.perfis(id) on delete set null,
  nao_aplica_revisado_em timestamptz,
  nao_aplica_resposta text,
  observacao_equipe text,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checklist_itens_empresa_comp_idx on public.checklist_itens (empresa_id, competencia);
create index checklist_itens_status_idx on public.checklist_itens (competencia, status);
create index checklist_itens_prazo_idx on public.checklist_itens (prazo) where status in ('pendente', 'correcao');
create trigger checklist_itens_updated_at before update on public.checklist_itens
  for each row execute function app.tg_updated_at();
create trigger auditoria_checklist_itens after insert or update or delete on public.checklist_itens
  for each row execute function app.tg_auditoria();

alter table public.documentos
  add constraint documentos_checklist_item_fk
  foreign key (checklist_item_id) references public.checklist_itens(id) on delete set null;

create table public.checklist_historico (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.checklist_itens(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  acao text not null,
  status_anterior text,
  status_novo text,
  motivo text,
  alterado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  alterado_em timestamptz not null default now()
);
create index checklist_historico_item_idx on public.checklist_historico (item_id, alterado_em);

-- -----------------------------------------------------------------------------
-- Funções
-- -----------------------------------------------------------------------------

-- Prazo = dia X do mês (competência + N meses), limitado ao último dia do mês.
create or replace function app.prazo_checklist(p_competencia date, p_dia int, p_meses_apos int)
returns date
language sql
immutable
set search_path = ''
as $$
  select least(
    (date_trunc('month', p_competencia) + make_interval(months => p_meses_apos))::date + (p_dia - 1),
    ((date_trunc('month', p_competencia) + make_interval(months => p_meses_apos + 1))::date - 1)
  );
$$;

-- Recalcula o status do item a partir dos documentos vinculados.
create or replace function app.recalcular_item_checklist(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
  v_total int;
  v_aprov int;
  v_corr int;
  v_anal int;
  v_minimo int;
  v_novo text;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    return;
  end if;
  if v_item.status in ('nao_se_aplica', 'nao_se_aplica_solicitado') then
    return;
  end if;

  if v_item.conclusao_manual then
    v_novo := 'concluido';
  else
    select count(*),
           count(*) filter (where d.status = 'aprovado'),
           count(*) filter (where d.status = 'correcao'),
           count(*) filter (where d.status = 'em_analise')
      into v_total, v_aprov, v_corr, v_anal
      from public.documentos d
     where d.checklist_item_id = p_item_id
       and d.excluido_em is null
       and d.upload_status = 'concluido'
       and d.direcao = 'cliente'
       -- Após uma solicitação de correção do item, só contam envios posteriores.
       and (v_item.correcao_solicitada_em is null or d.enviado_em > v_item.correcao_solicitada_em);

    v_minimo := case when v_item.correcao_solicitada_em is null then v_item.quantidade_minima else 1 end;

    if v_total = 0 then
      v_novo := case when v_item.correcao_solicitada_em is not null then 'correcao' else 'pendente' end;
    elsif v_corr > 0 then
      v_novo := 'correcao';
    elsif v_aprov >= v_minimo then
      v_novo := 'concluido';
    elsif v_anal > 0 then
      v_novo := 'em_analise';
    else
      v_novo := 'enviado';
    end if;
  end if;

  if v_novo is distinct from v_item.status then
    update public.checklist_itens
       set status = v_novo,
           status_atualizado_em = now(),
           concluido_em = case when v_novo = 'concluido' then coalesce(concluido_em, now()) else null end,
           concluido_por = case when v_novo = 'concluido' then concluido_por else null end
     where id = p_item_id;
    insert into public.checklist_historico (item_id, empresa_id, acao, status_anterior, status_novo)
    values (p_item_id, v_item.empresa_id, 'recalculo', v_item.status, v_novo);
  end if;
end;
$$;

-- Gera (de forma idempotente) os itens do checklist de uma competência.
create or replace function app.gerar_checklist(p_empresa_id uuid, p_competencia date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := app.competencia_de(p_competencia);
  m record;
  c record;
  v_criados int := 0;
  v_n int;
begin
  for m in
    select * from public.checklist_modelos
     where empresa_id = p_empresa_id
       and ativo
       and (periodicidade = 'mensal' or extract(month from v_comp)::int = any(coalesce(meses, array[]::int[])))
     order by ordem, titulo
  loop
    if m.por_conta then
      for c in
        select cf.id, cf.nome
          from public.contas_financeiras cf
         where cf.empresa_id = p_empresa_id
           and cf.ativa
           and (m.tipos_conta is null or cf.tipo = any(m.tipos_conta))
           and cf.saldo_inicial_data < (v_comp + interval '1 month')::date
      loop
        insert into public.checklist_itens (
          empresa_id, competencia, modelo_id, chave_geracao, conta_financeira_id, categoria_codigo, titulo, descricao,
          obrigatorio, quantidade_minima, prazo, responsavel_cliente_id, responsavel_equipe_id, criado_por
        ) values (
          p_empresa_id, v_comp, m.id, m.id::text || ':' || c.id::text || ':' || to_char(v_comp, 'YYYY-MM'), c.id,
          m.categoria_codigo, m.titulo || ' — ' || c.nome, m.descricao, m.obrigatorio, m.quantidade_minima,
          app.prazo_checklist(v_comp, m.dia_prazo, m.meses_apos), m.responsavel_cliente_id, m.responsavel_equipe_id, null
        )
        on conflict (chave_geracao) do nothing;
        get diagnostics v_n = row_count;
        v_criados := v_criados + v_n;
      end loop;
    else
      insert into public.checklist_itens (
        empresa_id, competencia, modelo_id, chave_geracao, conta_financeira_id, categoria_codigo, titulo, descricao,
        obrigatorio, quantidade_minima, prazo, responsavel_cliente_id, responsavel_equipe_id, criado_por
      ) values (
        p_empresa_id, v_comp, m.id, m.id::text || ':-:' || to_char(v_comp, 'YYYY-MM'), m.conta_financeira_id,
        m.categoria_codigo, m.titulo, m.descricao, m.obrigatorio, m.quantidade_minima,
        app.prazo_checklist(v_comp, m.dia_prazo, m.meses_apos), m.responsavel_cliente_id, m.responsavel_equipe_id, null
      )
      on conflict (chave_geracao) do nothing;
      get diagnostics v_n = row_count;
      v_criados := v_criados + v_n;
    end if;
  end loop;
  return v_criados;
end;
$$;

-- Modelos padrão conforme regime tributário e serviços contratados.
create or replace function app.criar_modelos_padrao(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp public.empresas;
  v_n int := 0;
  v_fiscal boolean;
  v_financeiro boolean;
begin
  select * into v_emp from public.empresas where id = p_empresa_id;
  if not found then
    raise exception 'Empresa não encontrada.';
  end if;
  v_financeiro := v_emp.servicos && array['contabil', 'financeiro'];
  v_fiscal := 'fiscal' = any(v_emp.servicos) and v_emp.regime_tributario <> 'pessoa_fisica';

  if v_financeiro then
    insert into public.checklist_modelos (empresa_id, codigo_padrao, categoria_codigo, titulo, descricao, obrigatorio, por_conta, tipos_conta, dia_prazo, meses_apos, servico, ordem)
    values
      (p_empresa_id, 'extrato_bancario', 'extrato_bancario', 'Extrato bancário do mês',
       'Envie o extrato completo do mês (do 1º ao último dia), de preferência no formato OFX. Se não conseguir, envie PDF ou planilha.',
       true, true, array['conta_corrente', 'poupanca', 'investimento'], 10, 1, 'contabil', 10),
      (p_empresa_id, 'extrato_cartao', 'extrato_cartao', 'Fatura do cartão de crédito',
       'Envie a fatura completa do cartão de crédito da empresa referente ao mês.',
       true, true, array['cartao_credito'], 10, 1, 'contabil', 20),
      (p_empresa_id, 'relatorio_maquininha', 'relatorio_maquininha', 'Relatório de vendas e recebimentos da maquininha',
       'Exporte o relatório do mês na plataforma da maquininha, mostrando venda bruta, taxas e valor líquido recebido.',
       true, true, array['adquirente'], 10, 1, 'contabil', 30),
      (p_empresa_id, 'comprovantes', 'comprovante', 'Comprovantes de pagamentos e recebimentos',
       'Envie os comprovantes de PIX, transferências e pagamentos realizados e recebidos no mês.',
       true, false, null, 10, 1, 'contabil', 40),
      (p_empresa_id, 'despesas', 'compras_vendas_despesas', 'Notas, recibos e documentos de despesas',
       'Recibos, cupons e documentos das compras e despesas do mês que não possuem XML.',
       false, false, null, 10, 1, 'contabil', 50)
    on conflict (empresa_id, codigo_padrao) do nothing;
    get diagnostics v_n = row_count;
  end if;

  if v_fiscal then
    insert into public.checklist_modelos (empresa_id, codigo_padrao, categoria_codigo, titulo, descricao, obrigatorio, dia_prazo, meses_apos, servico, ordem)
    values
      (p_empresa_id, 'nfe_saida', 'nfe_saida_xml', 'XMLs das notas fiscais emitidas (saída)',
       'Envie os XMLs de todas as NF-e/NFC-e emitidas no mês, inclusive as canceladas. Pode enviar um ZIP com todos os arquivos.',
       true, 5, 1, 'fiscal', 60),
      (p_empresa_id, 'nfe_entrada', 'nfe_entrada_xml', 'XMLs das notas fiscais recebidas (entrada)',
       'Envie os XMLs das notas fiscais de compras e serviços recebidas no mês. Pode enviar um ZIP.',
       true, 5, 1, 'fiscal', 70),
      (p_empresa_id, 'nfse', 'nfse', 'Notas fiscais de serviço emitidas e tomadas',
       'Envie as NFS-e emitidas e as recebidas de prestadores (XML ou PDF), se houver.',
       false, 5, 1, 'fiscal', 80),
      (p_empresa_id, 'eventos', 'eventos_fiscais', 'Eventos fiscais (cancelamentos e cartas de correção)',
       'Se houve cancelamento ou carta de correção no mês, envie o XML do evento.',
       false, 5, 1, 'fiscal', 90),
      (p_empresa_id, 'guias_pagas', 'guia_imposto', 'Comprovantes de pagamento das guias de impostos',
       'Envie os comprovantes de pagamento das guias de impostos vencidas no mês.',
       true, 25, 1, 'fiscal', 100)
    on conflict (empresa_id, codigo_padrao) do nothing;
    get diagnostics v_n = row_count;
  end if;

  if 'folha' = any(v_emp.servicos) then
    insert into public.checklist_modelos (empresa_id, codigo_padrao, categoria_codigo, titulo, descricao, obrigatorio, dia_prazo, meses_apos, servico, ordem)
    values
      (p_empresa_id, 'folha', 'folha_pagamento', 'Informações para a folha de pagamento',
       'Envie ponto, faltas, horas extras, comissões, admissões, demissões e férias do mês. Informe também se houve pró-labore.',
       true, 25, 0, 'folha', 110)
    on conflict (empresa_id, codigo_padrao) do nothing;
  end if;

  if v_emp.controla_estoque then
    insert into public.checklist_modelos (empresa_id, codigo_padrao, categoria_codigo, titulo, descricao, obrigatorio, dia_prazo, meses_apos, servico, ordem)
    values
      (p_empresa_id, 'estoque', 'outros', 'Posição do estoque no último dia do mês',
       'Envie o relatório de estoque (quantidades e valores de custo) do último dia do mês.',
       true, 5, 1, 'contabil', 120)
    on conflict (empresa_id, codigo_padrao) do nothing;
  end if;

  select count(*) into v_n from public.checklist_modelos where empresa_id = p_empresa_id;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function public.gerar_checklist_competencia(p_empresa_id uuid, p_competencia date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := app.competencia_de(p_competencia);
begin
  if not (app.pode(p_empresa_id, 'documentos.ver') or app.pode(p_empresa_id, 'checklist.gerenciar')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_comp > (app.competencia_de(app.hoje()) + interval '1 month')::date and not app.pode(p_empresa_id, 'checklist.gerenciar') then
    raise exception 'Competência futura ainda não disponível.';
  end if;
  return app.gerar_checklist(p_empresa_id, v_comp);
end;
$$;

create or replace function public.aplicar_checklist_padrao(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'checklist.gerenciar');
  return app.criar_modelos_padrao(p_empresa_id);
end;
$$;

create or replace function public.solicitar_nao_aplica(p_item_id uuid, p_justificativa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
  v_equipe boolean;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  v_equipe := app.pode(v_item.empresa_id, 'checklist.gerenciar');
  if not v_equipe then
    perform app.exigir(v_item.empresa_id, 'documentos.enviar');
  end if;
  if coalesce(trim(p_justificativa), '') = '' then
    raise exception 'Explique por que este item não se aplica neste mês.';
  end if;
  if v_item.status = 'concluido' then
    raise exception 'Item já concluído.';
  end if;

  update public.checklist_itens
     set status = case when v_equipe then 'nao_se_aplica' else 'nao_se_aplica_solicitado' end,
         status_atualizado_em = now(),
         nao_aplica_justificativa = trim(p_justificativa),
         nao_aplica_solicitado_por = auth.uid(),
         nao_aplica_solicitado_em = now(),
         nao_aplica_revisado_por = case when v_equipe then auth.uid() else null end,
         nao_aplica_revisado_em = case when v_equipe then now() else null end,
         nao_aplica_resposta = null
   where id = v_item.id;

  insert into public.checklist_historico (item_id, empresa_id, acao, status_anterior, status_novo, motivo)
  values (v_item.id, v_item.empresa_id, 'nao_se_aplica', v_item.status,
          case when v_equipe then 'nao_se_aplica' else 'nao_se_aplica_solicitado' end, trim(p_justificativa));

  if not v_equipe then
    perform app.notificar_equipe(
      v_item.empresa_id, 'nao_aplica_solicitado',
      'Revisar "não se aplica": ' || v_item.titulo,
      trim(p_justificativa),
      '/e/' || v_item.empresa_id::text || '/pendencias?competencia=' || to_char(v_item.competencia, 'YYYY-MM'),
      false
    );
  end if;
end;
$$;

create or replace function public.revisar_nao_aplica(p_item_id uuid, p_aprovar boolean, p_resposta text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  perform app.exigir(v_item.empresa_id, 'checklist.gerenciar');
  if v_item.status <> 'nao_se_aplica_solicitado' then
    raise exception 'Não há solicitação de "não se aplica" pendente para este item.';
  end if;
  if not p_aprovar and coalesce(trim(p_resposta), '') = '' then
    raise exception 'Explique ao cliente por que o item continua necessário.';
  end if;

  update public.checklist_itens
     set status = case when p_aprovar then 'nao_se_aplica' else 'pendente' end,
         status_atualizado_em = now(),
         nao_aplica_revisado_por = auth.uid(),
         nao_aplica_revisado_em = now(),
         nao_aplica_resposta = nullif(trim(coalesce(p_resposta, '')), '')
   where id = v_item.id;

  insert into public.checklist_historico (item_id, empresa_id, acao, status_anterior, status_novo, motivo)
  values (v_item.id, v_item.empresa_id, case when p_aprovar then 'nao_se_aplica_aprovado' else 'nao_se_aplica_recusado' end,
          v_item.status, case when p_aprovar then 'nao_se_aplica' else 'pendente' end, p_resposta);

  if not p_aprovar then
    perform app.recalcular_item_checklist(v_item.id);
  end if;

  if v_item.nao_aplica_solicitado_por is not null then
    perform app.notificar(
      v_item.nao_aplica_solicitado_por, v_item.empresa_id, 'nao_aplica_revisado',
      case when p_aprovar then 'Aceito como "não se aplica": ' else 'Item continua necessário: ' end || v_item.titulo,
      p_resposta,
      '/e/' || v_item.empresa_id::text || '/pendencias?competencia=' || to_char(v_item.competencia, 'YYYY-MM'),
      not p_aprovar
    );
  end if;
end;
$$;

create or replace function public.concluir_item_checklist(p_item_id uuid, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
  v_aprov int;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  perform app.exigir(v_item.empresa_id, 'checklist.gerenciar');
  select count(*) into v_aprov from public.documentos
   where checklist_item_id = v_item.id and excluido_em is null and status = 'aprovado';
  if v_aprov < v_item.quantidade_minima and coalesce(trim(p_observacao), '') = '' then
    raise exception 'O item tem % documento(s) conferido(s) de % exigido(s). Para concluir mesmo assim, registre uma justificativa.',
      v_aprov, v_item.quantidade_minima;
  end if;

  update public.checklist_itens
     set status = 'concluido',
         status_atualizado_em = now(),
         conclusao_manual = true,
         concluido_por = auth.uid(),
         concluido_em = now(),
         conclusao_observacao = nullif(trim(coalesce(p_observacao, '')), ''),
         correcao_motivo = null,
         correcao_solicitada_em = null
   where id = v_item.id;

  insert into public.checklist_historico (item_id, empresa_id, acao, status_anterior, status_novo, motivo)
  values (v_item.id, v_item.empresa_id, 'concluido_manual', v_item.status, 'concluido', p_observacao);
end;
$$;

create or replace function public.reabrir_item_checklist(p_item_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  perform app.exigir(v_item.empresa_id, 'checklist.gerenciar');
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da reabertura.';
  end if;
  update public.checklist_itens
     set status = 'pendente',
         conclusao_manual = false,
         concluido_por = null,
         concluido_em = null,
         conclusao_observacao = null,
         nao_aplica_revisado_em = case when status like 'nao_se_aplica%' then null else nao_aplica_revisado_em end
   where id = v_item.id;
  insert into public.checklist_historico (item_id, empresa_id, acao, status_anterior, status_novo, motivo)
  values (v_item.id, v_item.empresa_id, 'reaberto', v_item.status, 'pendente', trim(p_motivo));
  perform app.recalcular_item_checklist(v_item.id);
end;
$$;

create or replace function public.solicitar_correcao_item(p_item_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  perform app.exigir(v_item.empresa_id, 'checklist.gerenciar');
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Explique ao cliente o que precisa ser corrigido ou complementado.';
  end if;
  update public.checklist_itens
     set correcao_motivo = trim(p_motivo),
         correcao_solicitada_em = now(),
         conclusao_manual = false,
         status = 'correcao',
         status_atualizado_em = now()
   where id = v_item.id;
  insert into public.checklist_historico (item_id, empresa_id, acao, status_anterior, status_novo, motivo)
  values (v_item.id, v_item.empresa_id, 'correcao_solicitada', v_item.status, 'correcao', trim(p_motivo));
  perform app.notificar_clientes(
    v_item.empresa_id, 'documentos.enviar', 'item_correcao',
    'Pendência precisa de complemento: ' || v_item.titulo,
    trim(p_motivo),
    '/e/' || v_item.empresa_id::text || '/pendencias?competencia=' || to_char(v_item.competencia, 'YYYY-MM'),
    true
  );
end;
$$;

create or replace function public.adicionar_item_checklist(
  p_empresa_id uuid,
  p_competencia date,
  p_categoria text,
  p_titulo text,
  p_descricao text,
  p_prazo date,
  p_obrigatorio boolean default true,
  p_quantidade_minima int default 1,
  p_responsavel_cliente_id uuid default null,
  p_responsavel_equipe_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'checklist.gerenciar');
  if coalesce(trim(p_titulo), '') = '' then
    raise exception 'Informe o título do item.';
  end if;
  if p_prazo is null then
    raise exception 'Informe o prazo.';
  end if;
  insert into public.checklist_itens (
    empresa_id, competencia, categoria_codigo, titulo, descricao, obrigatorio, quantidade_minima, prazo,
    responsavel_cliente_id, responsavel_equipe_id
  ) values (
    p_empresa_id, app.competencia_de(p_competencia), p_categoria, trim(p_titulo), nullif(trim(coalesce(p_descricao, '')), ''),
    coalesce(p_obrigatorio, true), greatest(1, coalesce(p_quantidade_minima, 1)), p_prazo,
    p_responsavel_cliente_id, p_responsavel_equipe_id
  ) returning id into v_id;

  insert into public.checklist_historico (item_id, empresa_id, acao, status_novo)
  values (v_id, p_empresa_id, 'criado', 'pendente');

  perform app.notificar_clientes(
    p_empresa_id, 'documentos.enviar', 'item_solicitado',
    'Novo documento solicitado: ' || trim(p_titulo),
    coalesce(nullif(trim(coalesce(p_descricao, '')), ''), 'O escritório solicitou um novo documento.') || ' Prazo: ' || to_char(p_prazo, 'DD/MM/YYYY') || '.',
    '/e/' || p_empresa_id::text || '/pendencias?competencia=' || to_char(app.competencia_de(p_competencia), 'YYYY-MM'),
    true
  );
  return v_id;
end;
$$;

create or replace function public.atualizar_item_checklist(
  p_item_id uuid,
  p_titulo text,
  p_descricao text,
  p_prazo date,
  p_obrigatorio boolean,
  p_quantidade_minima int,
  p_responsavel_cliente_id uuid,
  p_responsavel_equipe_id uuid,
  p_observacao_equipe text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.checklist_itens;
begin
  select * into v_item from public.checklist_itens where id = p_item_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  perform app.exigir(v_item.empresa_id, 'checklist.gerenciar');
  update public.checklist_itens
     set titulo = coalesce(nullif(trim(coalesce(p_titulo, '')), ''), titulo),
         descricao = nullif(trim(coalesce(p_descricao, '')), ''),
         prazo = coalesce(p_prazo, prazo),
         obrigatorio = coalesce(p_obrigatorio, obrigatorio),
         quantidade_minima = greatest(1, coalesce(p_quantidade_minima, quantidade_minima)),
         responsavel_cliente_id = p_responsavel_cliente_id,
         responsavel_equipe_id = p_responsavel_equipe_id,
         observacao_equipe = nullif(trim(coalesce(p_observacao_equipe, '')), '')
   where id = v_item.id;
  perform app.recalcular_item_checklist(v_item.id);
end;
$$;

-- Resumo do checklist (usa RLS do usuário).
create or replace function public.resumo_checklist(p_empresa_id uuid, p_competencia date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with itens as (
    select * from public.checklist_itens
     where empresa_id = p_empresa_id and competencia = date_trunc('month', p_competencia)::date
  )
  select jsonb_build_object(
    'total', (select count(*) from itens),
    'obrigatorios', (select count(*) from itens where obrigatorio),
    'concluidos', (select count(*) from itens where status = 'concluido'),
    'nao_se_aplica', (select count(*) from itens where status = 'nao_se_aplica'),
    'nao_se_aplica_solicitado', (select count(*) from itens where status = 'nao_se_aplica_solicitado'),
    'enviados', (select count(*) from itens where status in ('enviado', 'em_analise')),
    'correcao', (select count(*) from itens where status = 'correcao'),
    'pendentes', (select count(*) from itens where status = 'pendente'),
    'atrasados', (select count(*) from itens where status in ('pendente', 'correcao') and prazo < app.hoje()),
    'percentual', (
      select case when count(*) filter (where obrigatorio) = 0 then null
        else round(100.0 * count(*) filter (where obrigatorio and status in ('concluido', 'nao_se_aplica'))
                   / count(*) filter (where obrigatorio))
      end from itens
    ),
    'proximo_prazo', (select min(prazo) from itens where status in ('pendente', 'correcao') and prazo >= app.hoje())
  );
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.checklist_modelos enable row level security;
alter table public.checklist_itens enable row level security;
alter table public.checklist_historico enable row level security;

create policy checklist_modelos_leitura on public.checklist_modelos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]));
create policy checklist_modelos_escrita on public.checklist_modelos for all to authenticated
  using (empresa_id = any ((select app.empresas_com('checklist.gerenciar'))::uuid[]))
  with check (empresa_id = any ((select app.empresas_com('checklist.gerenciar'))::uuid[]));

create policy checklist_itens_leitura on public.checklist_itens for select to authenticated
  using (empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[]));

create policy checklist_historico_leitura on public.checklist_historico for select to authenticated
  using (empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[]));
