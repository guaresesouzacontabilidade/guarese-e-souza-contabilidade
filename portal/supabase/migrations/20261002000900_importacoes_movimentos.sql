-- =============================================================================
-- Migração 0900: importações (OFX/planilhas) e movimentações bancárias
-- =============================================================================
-- Idempotência:
--   * Cada importação tem uma chave de idempotência (reenvios devolvem a mesma).
--   * Cada movimentação tem uma chave de deduplicação por conta:
--     data + valor + descrição normalizada + ordem da ocorrência no arquivo.
--     Reimportar o mesmo extrato (ou um extrato com período sobreposto) não
--     duplica movimentações.
-- =============================================================================

create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  tipo text not null check (tipo in ('extrato_ofx', 'extrato_planilha', 'lancamentos_planilha')),
  conta_financeira_id uuid,
  documento_id uuid,
  arquivo_nome text,
  arquivo_sha256 text,
  status text not null default 'concluida' check (status in ('concluida', 'desfeita')),
  chave_idempotencia text not null unique,
  mapeamento jsonb,
  opcoes jsonb,
  periodo_inicio date,
  periodo_fim date,
  saldo_final_extrato numeric(15,2),
  data_saldo_final date,
  total_linhas int not null default 0,
  total_novas int not null default 0,
  total_duplicadas int not null default 0,
  total_invalidas int not null default 0,
  total_periodo_fechado int not null default 0,
  soma_creditos numeric(15,2) not null default 0,
  soma_debitos numeric(15,2) not null default 0,
  erros jsonb not null default '[]'::jsonb,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  desfeita_em timestamptz,
  desfeita_por uuid references public.perfis(id) on delete set null,
  motivo_desfazer text,
  constraint importacoes_empresa_id_unico unique (empresa_id, id),
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, documento_id) references public.documentos (empresa_id, id)
);
create index importacoes_empresa_idx on public.importacoes (empresa_id, created_at desc);
create trigger auditoria_importacoes after insert or update or delete on public.importacoes
  for each row execute function app.tg_auditoria();

alter table public.lancamentos
  add column chave_importacao text,
  add constraint lancamentos_importacao_fk foreign key (empresa_id, importacao_id) references public.importacoes (empresa_id, id);
create unique index lancamentos_chave_importacao_unica on public.lancamentos (empresa_id, chave_importacao) where chave_importacao is not null;

create table public.movimentos_bancarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  conta_financeira_id uuid not null,
  importacao_id uuid,
  data date not null,
  valor numeric(15,2) not null check (valor <> 0),          -- positivo = crédito; negativo = débito
  descricao text not null,
  documento_contraparte text,                               -- CPF/CNPJ identificado na descrição
  tipo_transacao text,
  numero_documento text,
  fitid text,
  chave_dedupe text not null,
  status_conciliacao text not null default 'pendente' check (status_conciliacao in ('pendente', 'conciliado', 'ignorado')),
  ignorado_motivo text,
  ignorado_por uuid references public.perfis(id) on delete set null,
  ignorado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint movimentos_empresa_id_unico unique (empresa_id, id),
  constraint movimentos_dedupe_unico unique (conta_financeira_id, chave_dedupe),
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, importacao_id) references public.importacoes (empresa_id, id)
);
create index movimentos_conta_data_idx on public.movimentos_bancarios (conta_financeira_id, data);
create index movimentos_empresa_status_idx on public.movimentos_bancarios (empresa_id, status_conciliacao, data);
create index movimentos_importacao_idx on public.movimentos_bancarios (importacao_id);

create table public.extrato_saldos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_financeira_id uuid not null,
  data date not null,
  saldo numeric(15,2) not null,
  fonte text not null default 'manual' check (fonte in ('ofx', 'planilha', 'manual')),
  importacao_id uuid,
  informado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint extrato_saldos_unico unique (conta_financeira_id, data, fonte),
  foreign key (empresa_id, conta_financeira_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, importacao_id) references public.importacoes (empresa_id, id) on delete cascade
);

-- Bloqueio por competência fechada
create or replace function app.tg_movimentos_regras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.exigir_competencia_aberta(old.empresa_id, old.data);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  perform app.exigir_competencia_aberta(new.empresa_id, new.data);
  if tg_op = 'UPDATE' and (new.data <> old.data or new.valor <> old.valor or new.conta_financeira_id <> old.conta_financeira_id) then
    raise exception 'Movimentações importadas não podem ter data, valor ou conta alterados. Desfaça a importação se necessário.';
  end if;
  return new;
end;
$$;
create trigger movimentos_regras before insert or update or delete on public.movimentos_bancarios
  for each row execute function app.tg_movimentos_regras();

-- Chave de deduplicação de uma movimentação.
create or replace function app.chave_movimento(p_data date, p_valor numeric, p_descricao text, p_ocorrencia int)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(
    p_data::text || '|' || to_char(p_valor, 'FM999999999990.00') || '|' ||
    regexp_replace(upper(trim(app.normalizar(coalesce(p_descricao, '')))), '\s+', ' ', 'g') || '|' ||
    coalesce(p_ocorrencia, 1)::text
  );
$$;

-- -----------------------------------------------------------------------------
-- RPC: importar extrato (OFX ou planilha já mapeada e conferida na prévia)
-- -----------------------------------------------------------------------------
create or replace function public.importar_extrato(
  p_empresa_id uuid,
  p_conta_id uuid,
  p_tipo text,
  p_chave_idempotencia text,
  p_arquivo_nome text,
  p_arquivo_sha256 text,
  p_documento_id uuid,
  p_mapeamento jsonb,
  p_linhas jsonb,
  p_saldo_final numeric default null,
  p_data_saldo_final date default null,
  p_total_invalidas int default 0,
  p_erros jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp public.importacoes;
  v_id uuid;
  v_linha jsonb;
  v_data date;
  v_valor numeric(15,2);
  v_desc text;
  v_novas int := 0;
  v_dup int := 0;
  v_fechado int := 0;
  v_total int := 0;
  v_cred numeric(15,2) := 0;
  v_deb numeric(15,2) := 0;
  v_n int;
  v_min date;
  v_max date;
begin
  perform app.exigir(p_empresa_id, 'financeiro.importar');
  if p_tipo not in ('extrato_ofx', 'extrato_planilha') then
    raise exception 'Tipo de importação inválido.';
  end if;
  if coalesce(p_chave_idempotencia, '') = '' then
    raise exception 'Chave de idempotência obrigatória.';
  end if;

  -- Reenvio da mesma operação: devolve o resultado anterior.
  select * into v_imp from public.importacoes where chave_idempotencia = p_chave_idempotencia;
  if found then
    if v_imp.empresa_id <> p_empresa_id then
      raise exception 'Chave de importação inválida.';
    end if;
    return jsonb_build_object('importacao_id', v_imp.id, 'reenvio', true, 'novas', v_imp.total_novas,
      'duplicadas', v_imp.total_duplicadas, 'periodo_fechado', v_imp.total_periodo_fechado, 'invalidas', v_imp.total_invalidas);
  end if;

  if not exists (select 1 from public.contas_financeiras where id = p_conta_id and empresa_id = p_empresa_id and ativa) then
    raise exception 'Conta financeira inválida ou inativa.';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Linhas inválidas.';
  end if;
  if jsonb_array_length(p_linhas) > 20000 then
    raise exception 'Arquivo com mais de 20.000 linhas. Divida o extrato em períodos menores.';
  end if;

  insert into public.importacoes (empresa_id, tipo, conta_financeira_id, documento_id, arquivo_nome, arquivo_sha256,
                                  chave_idempotencia, mapeamento, total_invalidas, erros, saldo_final_extrato, data_saldo_final)
  values (p_empresa_id, p_tipo, p_conta_id, p_documento_id, left(p_arquivo_nome, 255), p_arquivo_sha256,
          p_chave_idempotencia, p_mapeamento, coalesce(p_total_invalidas, 0), coalesce(p_erros, '[]'::jsonb), p_saldo_final, p_data_saldo_final)
  returning id into v_id;

  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    v_total := v_total + 1;
    v_data := (v_linha ->> 'data')::date;
    v_valor := round((v_linha ->> 'valor')::numeric, 2);
    v_desc := left(coalesce(nullif(trim(v_linha ->> 'descricao'), ''), 'Sem descrição'), 500);
    if v_data is null or v_valor is null or v_valor = 0 then
      raise exception 'Linha % inválida: data e valor (diferente de zero) são obrigatórios.', v_total;
    end if;
    if app.competencia_fechada(p_empresa_id, v_data) then
      v_fechado := v_fechado + 1;
      continue;
    end if;
    insert into public.movimentos_bancarios (
      empresa_id, conta_financeira_id, importacao_id, data, valor, descricao, documento_contraparte,
      tipo_transacao, numero_documento, fitid, chave_dedupe
    ) values (
      p_empresa_id, p_conta_id, v_id, v_data, v_valor, v_desc,
      nullif(regexp_replace(coalesce(v_linha ->> 'documento', ''), '[^0-9]', '', 'g'), ''),
      left(v_linha ->> 'tipo', 50), left(v_linha ->> 'numero', 100), left(v_linha ->> 'fitid', 255),
      app.chave_movimento(v_data, v_valor, v_desc, coalesce((v_linha ->> 'ocorrencia')::int, 1))
    )
    on conflict (conta_financeira_id, chave_dedupe) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_novas := v_novas + 1;
      if v_valor > 0 then v_cred := v_cred + v_valor; else v_deb := v_deb + v_valor; end if;
      v_min := least(coalesce(v_min, v_data), v_data);
      v_max := greatest(coalesce(v_max, v_data), v_data);
    else
      v_dup := v_dup + 1;
    end if;
  end loop;

  if p_saldo_final is not null and p_data_saldo_final is not null then
    insert into public.extrato_saldos (empresa_id, conta_financeira_id, data, saldo, fonte, importacao_id)
    values (p_empresa_id, p_conta_id, p_data_saldo_final, p_saldo_final,
            case when p_tipo = 'extrato_ofx' then 'ofx' else 'planilha' end, v_id)
    on conflict (conta_financeira_id, data, fonte) do update set saldo = excluded.saldo, importacao_id = excluded.importacao_id;
  end if;

  update public.importacoes
     set total_linhas = v_total, total_novas = v_novas, total_duplicadas = v_dup, total_periodo_fechado = v_fechado,
         soma_creditos = v_cred, soma_debitos = v_deb, periodo_inicio = v_min, periodo_fim = v_max
   where id = v_id;

  if v_novas > 0 then
    perform app.enfileirar('sugerir_conciliacao', jsonb_build_object('empresa_id', p_empresa_id, 'conta_id', p_conta_id),
                           p_empresa_id, 'sugerir_conciliacao:' || v_id::text, now(), 40);
  end if;

  return jsonb_build_object('importacao_id', v_id, 'reenvio', false, 'novas', v_novas, 'duplicadas', v_dup,
                            'periodo_fechado', v_fechado, 'invalidas', coalesce(p_total_invalidas, 0));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: importar lançamentos de planilha (contas a pagar/receber)
-- -----------------------------------------------------------------------------
create or replace function public.importar_lancamentos(
  p_empresa_id uuid,
  p_chave_idempotencia text,
  p_arquivo_nome text,
  p_arquivo_sha256 text,
  p_documento_id uuid,
  p_mapeamento jsonb,
  p_linhas jsonb,
  p_total_invalidas int default 0,
  p_erros jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp public.importacoes;
  v_id uuid;
  v_linha jsonb;
  v_total int := 0;
  v_novas int := 0;
  v_dup int := 0;
  v_fechado int := 0;
  v_cat uuid;
  v_contra uuid;
  v_conta uuid;
  v_lanc uuid;
  v_chave text;
  v_tipo text;
  v_comp date;
  v_venc date;
  v_valor numeric(15,2);
  v_doc text;
begin
  perform app.exigir(p_empresa_id, 'financeiro.importar');
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  select * into v_imp from public.importacoes where chave_idempotencia = p_chave_idempotencia;
  if found then
    if v_imp.empresa_id <> p_empresa_id then
      raise exception 'Chave de importação inválida.';
    end if;
    return jsonb_build_object('importacao_id', v_imp.id, 'reenvio', true, 'novas', v_imp.total_novas,
      'duplicadas', v_imp.total_duplicadas, 'periodo_fechado', v_imp.total_periodo_fechado, 'invalidas', v_imp.total_invalidas);
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 10000 then
    raise exception 'Linhas inválidas (máximo de 10.000 por importação).';
  end if;

  insert into public.importacoes (empresa_id, tipo, documento_id, arquivo_nome, arquivo_sha256, chave_idempotencia,
                                  mapeamento, total_invalidas, erros)
  values (p_empresa_id, 'lancamentos_planilha', p_documento_id, left(p_arquivo_nome, 255), p_arquivo_sha256,
          p_chave_idempotencia, p_mapeamento, coalesce(p_total_invalidas, 0), coalesce(p_erros, '[]'::jsonb))
  returning id into v_id;

  for v_linha in select * from jsonb_array_elements(p_linhas)
  loop
    v_total := v_total + 1;
    v_tipo := v_linha ->> 'tipo';
    v_comp := (v_linha ->> 'data_competencia')::date;
    v_venc := coalesce((v_linha ->> 'data_vencimento')::date, v_comp);
    v_valor := round((v_linha ->> 'valor')::numeric, 2);
    if v_tipo not in ('receber', 'pagar') or v_comp is null or v_valor is null or v_valor <= 0 then
      raise exception 'Linha % inválida.', v_total;
    end if;
    if app.competencia_fechada(p_empresa_id, v_comp) then
      v_fechado := v_fechado + 1;
      continue;
    end if;

    v_cat := null;
    if v_linha ->> 'categoria_codigo' is not null then
      select id into v_cat from public.categorias_financeiras
       where empresa_id = p_empresa_id and (codigo = v_linha ->> 'categoria_codigo' or app.normalizar(nome) = app.normalizar(v_linha ->> 'categoria_codigo'))
         and not sintetica and ativa
       limit 1;
    end if;

    v_contra := null;
    v_doc := nullif(regexp_replace(coalesce(v_linha ->> 'contraparte_documento', ''), '[^0-9]', '', 'g'), '');
    if v_doc is not null and v_doc ~ '^[0-9]{11}$|^[0-9]{14}$' then
      insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis)
      values (p_empresa_id, coalesce(nullif(trim(v_linha ->> 'contraparte_nome'), ''), v_doc), v_doc,
              case when length(v_doc) = 14 then 'PJ' else 'PF' end,
              case when v_tipo = 'receber' then array['cliente'] else array['fornecedor'] end)
      on conflict (empresa_id, documento) where documento is not null do nothing;
      select id into v_contra from public.contrapartes where empresa_id = p_empresa_id and documento = v_doc;
    elsif nullif(trim(v_linha ->> 'contraparte_nome'), '') is not null then
      select id into v_contra from public.contrapartes
       where empresa_id = p_empresa_id and app.normalizar(nome) = app.normalizar(v_linha ->> 'contraparte_nome')
       limit 1;
      if v_contra is null then
        insert into public.contrapartes (empresa_id, nome, papeis)
        values (p_empresa_id, trim(v_linha ->> 'contraparte_nome'),
                case when v_tipo = 'receber' then array['cliente'] else array['fornecedor'] end)
        returning id into v_contra;
      end if;
    end if;

    v_conta := null;
    if v_linha ->> 'conta_id' is not null then
      select id into v_conta from public.contas_financeiras where id = app.try_uuid(v_linha ->> 'conta_id') and empresa_id = p_empresa_id;
    end if;

    v_chave := md5(v_tipo || '|' || v_comp::text || '|' || v_venc::text || '|' || to_char(v_valor, 'FM999999999990.00') || '|' ||
                   app.normalizar(coalesce(v_linha ->> 'descricao', '')) || '|' || coalesce(v_linha ->> 'ocorrencia', '1'));

    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, conta_financeira_id, data_competencia, data_vencimento,
      valor_previsto, status_revisao, origem, importacao_id, chave_importacao, numero_documento, observacoes
    ) values (
      p_empresa_id, v_tipo, left(coalesce(nullif(trim(v_linha ->> 'descricao'), ''), 'Importado'), 300), v_cat, v_contra, v_conta,
      v_comp, v_venc, v_valor, case when v_cat is null then 'sugerido' else 'confirmado' end, 'importacao', v_id, v_chave,
      left(v_linha ->> 'numero_documento', 100), left(v_linha ->> 'observacoes', 1000)
    )
    on conflict (empresa_id, chave_importacao) where chave_importacao is not null do nothing
    returning id into v_lanc;

    if v_lanc is null then
      v_dup := v_dup + 1;
      continue;
    end if;
    v_novas := v_novas + 1;

    -- Pagamento já realizado informado na planilha
    if (v_linha ->> 'data_pagamento') is not null and v_conta is not null and v_cat is not null
       and not app.competencia_fechada(p_empresa_id, (v_linha ->> 'data_pagamento')::date) then
      insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, origem)
      values (p_empresa_id, v_lanc, v_tipo, (v_linha ->> 'data_pagamento')::date, v_conta,
              least(v_valor, coalesce(round((v_linha ->> 'valor_pago')::numeric, 2), v_valor)), 'importacao');
    end if;
  end loop;

  update public.importacoes
     set total_linhas = v_total, total_novas = v_novas, total_duplicadas = v_dup, total_periodo_fechado = v_fechado
   where id = v_id;

  return jsonb_build_object('importacao_id', v_id, 'reenvio', false, 'novas', v_novas, 'duplicadas', v_dup,
                            'periodo_fechado', v_fechado, 'invalidas', coalesce(p_total_invalidas, 0));
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: desfazer importação (respeita conciliações e competências fechadas)
-- -----------------------------------------------------------------------------
create or replace function public.desfazer_importacao(p_importacao_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imp public.importacoes;
  v_conc int;
  v_fech int;
  v_baixas int;
  v_n int := 0;
begin
  select * into v_imp from public.importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'Importação não encontrada.';
  end if;
  perform app.exigir(v_imp.empresa_id, 'financeiro.importar');
  if v_imp.status = 'desfeita' then
    raise exception 'Esta importação já foi desfeita.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo.';
  end if;

  if v_imp.tipo in ('extrato_ofx', 'extrato_planilha') then
    select count(*) into v_conc from public.movimentos_bancarios
     where importacao_id = v_imp.id and status_conciliacao = 'conciliado';
    if v_conc > 0 then
      raise exception 'Há % movimentação(ões) conciliada(s) desta importação. Desfaça as conciliações antes.', v_conc;
    end if;
    select count(*) into v_fech from public.movimentos_bancarios m
     where m.importacao_id = v_imp.id and app.competencia_fechada(m.empresa_id, m.data);
    if v_fech > 0 then
      raise exception 'Há % movimentação(ões) em competência fechada. Reabra a competência para desfazer.', v_fech;
    end if;
    -- Remove sugestões pendentes que envolvem estas movimentações
    delete from public.conciliacoes c
     where c.status in ('sugerida', 'rejeitada')
       and exists (select 1 from public.conciliacao_itens i
                    join public.movimentos_bancarios m on m.id = i.movimento_id
                   where i.conciliacao_id = c.id and m.importacao_id = v_imp.id);
    delete from public.movimentos_bancarios where importacao_id = v_imp.id;
    get diagnostics v_n = row_count;
    delete from public.extrato_saldos where importacao_id = v_imp.id;
  else
    select count(*) into v_baixas from public.baixas b
      join public.lancamentos l on l.id = b.lancamento_id
     where l.importacao_id = v_imp.id and b.origem <> 'importacao';
    if v_baixas > 0 then
      raise exception 'Há % pagamento(s)/recebimento(s) registrados depois da importação. Estorne-os antes.', v_baixas;
    end if;
    select count(*) into v_fech from public.lancamentos l
     where l.importacao_id = v_imp.id and app.competencia_fechada(l.empresa_id, l.data_competencia);
    if v_fech > 0 then
      raise exception 'Há % lançamento(s) em competência fechada. Reabra a competência para desfazer.', v_fech;
    end if;
    delete from public.baixas b using public.lancamentos l
     where b.lancamento_id = l.id and l.importacao_id = v_imp.id;
    delete from public.lancamentos where importacao_id = v_imp.id;
    get diagnostics v_n = row_count;
  end if;

  update public.importacoes
     set status = 'desfeita', desfeita_em = now(), desfeita_por = auth.uid(), motivo_desfazer = trim(p_motivo)
   where id = v_imp.id;
  return jsonb_build_object('removidos', v_n);
end;
$$;

create or replace function public.ignorar_movimento(p_movimento_id uuid, p_ignorar boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov public.movimentos_bancarios;
begin
  select * into v_mov from public.movimentos_bancarios where id = p_movimento_id for update;
  if not found then
    raise exception 'Movimentação não encontrada.';
  end if;
  perform app.exigir(v_mov.empresa_id, 'conciliacao.executar');
  if p_ignorar then
    if v_mov.status_conciliacao = 'conciliado' then
      raise exception 'Movimentação conciliada. Desfaça a conciliação antes.';
    end if;
    if coalesce(trim(p_motivo), '') = '' then
      raise exception 'Informe por que esta movimentação será ignorada.';
    end if;
    update public.movimentos_bancarios
       set status_conciliacao = 'ignorado', ignorado_motivo = trim(p_motivo), ignorado_por = auth.uid(), ignorado_em = now()
     where id = v_mov.id;
  else
    update public.movimentos_bancarios
       set status_conciliacao = 'pendente', ignorado_motivo = null, ignorado_por = null, ignorado_em = null
     where id = v_mov.id and status_conciliacao = 'ignorado';
  end if;
  perform app.registrar_auditoria(case when p_ignorar then 'ignorar_movimento' else 'reativar_movimento' end,
                                  'movimentos_bancarios', v_mov.id::text, v_mov.empresa_id, jsonb_build_object('motivo', p_motivo));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.importacoes enable row level security;
alter table public.movimentos_bancarios enable row level security;
alter table public.extrato_saldos enable row level security;

create policy importacoes_leitura on public.importacoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy movimentos_leitura on public.movimentos_bancarios for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy extrato_saldos_leitura on public.extrato_saldos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
create policy extrato_saldos_escrita on public.extrato_saldos for insert to authenticated
  with check (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]) and fonte = 'manual');
create policy extrato_saldos_exclusao on public.extrato_saldos for delete to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[]) and fonte = 'manual');
