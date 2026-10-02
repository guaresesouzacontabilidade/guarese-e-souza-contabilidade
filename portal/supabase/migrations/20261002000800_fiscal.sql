-- =============================================================================
-- Migração 0800: documentos fiscais (NF-e, NFC-e, CT-e, NFS-e) e eventos
-- =============================================================================
-- Os dados são extraídos dos XMLs enviados. O sistema NÃO consulta a SEFAZ:
-- "protocolo de autorização no arquivo" significa apenas que o XML contém um
-- protocolo; não é confirmação de regularidade perante o Fisco.
-- =============================================================================

alter table public.empresas
  add column sugerir_lancamentos_xml boolean not null default true;

create table public.documentos_fiscais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  documento_id uuid not null,
  modelo text not null,
  tipo_documento text not null,
  chave_acesso text check (chave_acesso is null or chave_acesso ~ '^[0-9]{44}$'),
  identificador text not null,
  numero text,
  serie text,
  data_emissao timestamptz,
  competencia date not null check (extract(day from competencia) = 1),
  emitente_documento text,
  emitente_nome text,
  emitente_uf text,
  emitente_ie text,
  destinatario_documento text,
  destinatario_nome text,
  destinatario_uf text,
  tp_nf text,
  operacao text not null check (operacao in ('entrada', 'saida', 'nao_relacionada')),
  natureza_operacao text,
  finalidade text,
  cfops text[] not null default array[]::text[],
  valor_total numeric(15,2),
  valor_produtos numeric(15,2),
  valor_servicos numeric(15,2),
  valor_desconto numeric(15,2),
  valor_frete numeric(15,2),
  valor_outros numeric(15,2),
  tributos jsonb not null default '{}'::jsonb,
  protocolo jsonb,
  situacao_arquivo text not null check (situacao_arquivo in (
    'protocolo_autorizacao_no_arquivo', 'protocolo_nao_autorizado_no_arquivo', 'sem_protocolo', 'nao_aplicavel'
  )),
  cancelada_evento boolean not null default false,
  duplicatas jsonb not null default '[]'::jsonb,
  pagamentos jsonb not null default '[]'::jsonb,
  avisos jsonb not null default '[]'::jsonb,
  relacionado_empresa boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documentos_fiscais_empresa_id_unico unique (empresa_id, id),
  constraint documentos_fiscais_identificador_unico unique (empresa_id, identificador),
  foreign key (empresa_id, documento_id) references public.documentos (empresa_id, id)
);
create index documentos_fiscais_empresa_comp_idx on public.documentos_fiscais (empresa_id, competencia);
create index documentos_fiscais_chave_idx on public.documentos_fiscais (chave_acesso);
create index documentos_fiscais_documento_idx on public.documentos_fiscais (documento_id);
create trigger documentos_fiscais_updated_at before update on public.documentos_fiscais
  for each row execute function app.tg_updated_at();

create table public.documento_fiscal_itens (
  id uuid primary key default gen_random_uuid(),
  documento_fiscal_id uuid not null,
  empresa_id uuid not null,
  numero_item int not null,
  codigo text,
  descricao text,
  ncm text,
  cfop text,
  unidade text,
  quantidade numeric(20,6),
  valor_unitario numeric(25,10),
  valor_total numeric(15,2),
  valor_desconto numeric(15,2),
  tributos jsonb not null default '{}'::jsonb,
  foreign key (empresa_id, documento_fiscal_id) references public.documentos_fiscais (empresa_id, id) on delete cascade,
  constraint documento_fiscal_itens_unico unique (documento_fiscal_id, numero_item)
);

create table public.documento_fiscal_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  documento_id uuid not null,
  chave_acesso text not null,
  modelo text,
  tipo_evento text not null,
  descricao_evento text,
  sequencia int,
  data_evento timestamptz,
  protocolo text,
  cstat text,
  justificativa text,
  correcao text,
  identificador text not null,
  created_at timestamptz not null default now(),
  constraint documento_fiscal_eventos_unico unique (empresa_id, identificador),
  foreign key (empresa_id, documento_id) references public.documentos (empresa_id, id)
);
create index documento_fiscal_eventos_chave_idx on public.documento_fiscal_eventos (empresa_id, chave_acesso);

alter table public.lancamentos add constraint lancamentos_documento_fiscal_fk
  foreign key (empresa_id, documento_fiscal_id) references public.documentos_fiscais (empresa_id, id);
-- Uma nota (ou parcela/duplicata dela) gera no máximo um lançamento ativo.
create unique index lancamentos_documento_fiscal_unico
  on public.lancamentos (documento_fiscal_id, coalesce(parcela_numero, 0))
  where documento_fiscal_id is not null and situacao <> 'cancelado';

-- -----------------------------------------------------------------------------
-- Registro do resultado da leitura de um XML (executado pelo processador)
-- -----------------------------------------------------------------------------
create or replace function public.registrar_xml_fiscal(p_documento_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_emp public.empresas;
  v_df_id uuid;
  v_existente record;
  v_evento_id uuid;
  v_contraparte uuid;
  v_categoria uuid;
  v_sug jsonb;
  v_parc jsonb;
  v_lanc uuid;
  v_n_lanc int := 0;
  v_tipo_lanc text;
  v_comp date;
  v_cancelados int := 0;
  v_confirmados int := 0;
  v_tot_parc int;
begin
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  select * into v_emp from public.empresas where id = v_doc.empresa_id;

  -- ------------------------------------------------------------------ eventos
  if p_dados ->> 'tipo' = 'evento' then
    insert into public.documento_fiscal_eventos (
      empresa_id, documento_id, chave_acesso, modelo, tipo_evento, descricao_evento, sequencia, data_evento,
      protocolo, cstat, justificativa, correcao, identificador
    ) values (
      v_doc.empresa_id, v_doc.id, p_dados ->> 'chave_acesso', p_dados ->> 'modelo', p_dados ->> 'tipo_evento',
      p_dados ->> 'descricao_evento', (p_dados ->> 'sequencia')::int, (p_dados ->> 'data_evento')::timestamptz,
      p_dados ->> 'protocolo', p_dados ->> 'cstat', p_dados ->> 'justificativa', p_dados ->> 'correcao',
      p_dados ->> 'identificador'
    )
    on conflict (empresa_id, identificador) do nothing
    returning id into v_evento_id;

    if v_evento_id is null then
      select e.id, e.documento_id into v_existente from public.documento_fiscal_eventos e
       where e.empresa_id = v_doc.empresa_id and e.identificador = p_dados ->> 'identificador';
      return jsonb_build_object('situacao', 'evento_duplicado', 'evento_id', v_existente.id, 'documento_original_id', v_existente.documento_id);
    end if;

    -- Cancelamento homologado no arquivo (cStat 135/136/155) marca a nota.
    if p_dados ->> 'tipo_evento' = '110111' and coalesce(p_dados ->> 'cstat', '') in ('135', '136', '155') then
      update public.documentos_fiscais
         set cancelada_evento = true
       where empresa_id = v_doc.empresa_id and chave_acesso = p_dados ->> 'chave_acesso';
      -- Sugestões ainda não confirmadas são canceladas; confirmadas exigem revisão humana.
      update public.lancamentos l
         set situacao = 'cancelado', motivo_cancelamento = 'Nota fiscal com evento de cancelamento no arquivo'
        from public.documentos_fiscais df
       where df.empresa_id = v_doc.empresa_id
         and df.chave_acesso = p_dados ->> 'chave_acesso'
         and l.documento_fiscal_id = df.id
         and l.status_revisao = 'sugerido'
         and l.situacao <> 'cancelado'
         and l.valor_baixado = 0;
      get diagnostics v_cancelados = row_count;
      select count(*) into v_confirmados
        from public.lancamentos l
        join public.documentos_fiscais df on df.id = l.documento_fiscal_id
       where df.empresa_id = v_doc.empresa_id
         and df.chave_acesso = p_dados ->> 'chave_acesso'
         and l.status_revisao = 'confirmado'
         and l.situacao <> 'cancelado';
      if v_confirmados > 0 then
        perform app.notificar_equipe(
          v_doc.empresa_id, 'nota_cancelada_com_lancamento',
          'Nota cancelada possui lançamento confirmado',
          'Foi recebido evento de cancelamento da chave ' || (p_dados ->> 'chave_acesso') || '. Revise os lançamentos vinculados.',
          '/e/' || v_doc.empresa_id::text || '/financeiro/lancamentos?busca=' || (p_dados ->> 'chave_acesso'),
          false
        );
      end if;
    end if;
    return jsonb_build_object('situacao', 'evento_registrado', 'evento_id', v_evento_id,
                              'sugestoes_canceladas', v_cancelados, 'lancamentos_confirmados_afetados', v_confirmados);
  end if;

  -- ------------------------------------------------------------------- notas
  v_comp := app.competencia_de(coalesce((p_dados ->> 'data_emissao')::timestamptz::date, v_doc.competencia));

  insert into public.documentos_fiscais (
    empresa_id, documento_id, modelo, tipo_documento, chave_acesso, identificador, numero, serie, data_emissao, competencia,
    emitente_documento, emitente_nome, emitente_uf, emitente_ie, destinatario_documento, destinatario_nome, destinatario_uf,
    tp_nf, operacao, natureza_operacao, finalidade, cfops,
    valor_total, valor_produtos, valor_servicos, valor_desconto, valor_frete, valor_outros,
    tributos, protocolo, situacao_arquivo, duplicatas, pagamentos, avisos, relacionado_empresa
  ) values (
    v_doc.empresa_id, v_doc.id, p_dados ->> 'modelo', p_dados ->> 'tipo_documento', p_dados ->> 'chave_acesso',
    p_dados ->> 'identificador', p_dados ->> 'numero', p_dados ->> 'serie', (p_dados ->> 'data_emissao')::timestamptz, v_comp,
    p_dados ->> 'emitente_documento', p_dados ->> 'emitente_nome', p_dados ->> 'emitente_uf', p_dados ->> 'emitente_ie',
    p_dados ->> 'destinatario_documento', p_dados ->> 'destinatario_nome', p_dados ->> 'destinatario_uf',
    p_dados ->> 'tp_nf', p_dados ->> 'operacao', p_dados ->> 'natureza_operacao', p_dados ->> 'finalidade',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_dados -> 'cfops', '[]'::jsonb))), array[]::text[]),
    (p_dados ->> 'valor_total')::numeric, (p_dados ->> 'valor_produtos')::numeric, (p_dados ->> 'valor_servicos')::numeric,
    (p_dados ->> 'valor_desconto')::numeric, (p_dados ->> 'valor_frete')::numeric, (p_dados ->> 'valor_outros')::numeric,
    coalesce(p_dados -> 'tributos', '{}'::jsonb), p_dados -> 'protocolo', p_dados ->> 'situacao_arquivo',
    coalesce(p_dados -> 'duplicatas', '[]'::jsonb), coalesce(p_dados -> 'pagamentos', '[]'::jsonb),
    coalesce(p_dados -> 'avisos', '[]'::jsonb), coalesce((p_dados ->> 'relacionado_empresa')::boolean, false)
  )
  on conflict (empresa_id, identificador) do nothing
  returning id into v_df_id;

  if v_df_id is null then
    select df.id, df.documento_id into v_existente from public.documentos_fiscais df
     where df.empresa_id = v_doc.empresa_id and df.identificador = p_dados ->> 'identificador';
    return jsonb_build_object('situacao', 'duplicado', 'documento_fiscal_id', v_existente.id, 'documento_original_id', v_existente.documento_id);
  end if;

  insert into public.documento_fiscal_itens (
    documento_fiscal_id, empresa_id, numero_item, codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario,
    valor_total, valor_desconto, tributos
  )
  select v_df_id, v_doc.empresa_id, (i ->> 'numero_item')::int, i ->> 'codigo', left(i ->> 'descricao', 500), i ->> 'ncm', i ->> 'cfop',
         i ->> 'unidade', (i ->> 'quantidade')::numeric, (i ->> 'valor_unitario')::numeric, (i ->> 'valor_total')::numeric,
         (i ->> 'valor_desconto')::numeric, coalesce(i -> 'tributos', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_dados -> 'itens', '[]'::jsonb)) as i
  on conflict (documento_fiscal_id, numero_item) do nothing;

  -- Cancelamento recebido antes da própria nota
  if p_dados ->> 'chave_acesso' is not null and exists (
    select 1 from public.documento_fiscal_eventos e
     where e.empresa_id = v_doc.empresa_id and e.chave_acesso = p_dados ->> 'chave_acesso'
       and e.tipo_evento = '110111' and coalesce(e.cstat, '') in ('135', '136', '155')
  ) then
    update public.documentos_fiscais set cancelada_evento = true where id = v_df_id;
    return jsonb_build_object('situacao', 'registrado', 'documento_fiscal_id', v_df_id, 'lancamentos_sugeridos', 0, 'cancelada', true);
  end if;

  -- Sugestão de lançamentos (sempre como "sugerido": não entra nos relatórios até confirmação)
  v_sug := p_dados -> 'sugestao';
  if v_emp.sugerir_lancamentos_xml and v_sug is not null and jsonb_typeof(v_sug) = 'object'
     and coalesce((p_dados ->> 'relacionado_empresa')::boolean, false) then
    v_tipo_lanc := v_sug ->> 'tipo';

    if coalesce(v_sug -> 'contraparte' ->> 'documento', '') ~ '^[0-9]{11}$|^[0-9]{14}$' then
      insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis)
      values (
        v_doc.empresa_id,
        coalesce(nullif(v_sug -> 'contraparte' ->> 'nome', ''), 'Sem nome'),
        v_sug -> 'contraparte' ->> 'documento',
        case when length(v_sug -> 'contraparte' ->> 'documento') = 14 then 'PJ' else 'PF' end,
        case when v_tipo_lanc = 'receber' then array['cliente'] else array['fornecedor'] end
      )
      on conflict (empresa_id, documento) where documento is not null do nothing;
      select id into v_contraparte from public.contrapartes
       where empresa_id = v_doc.empresa_id and documento = v_sug -> 'contraparte' ->> 'documento';
    end if;

    if v_sug ->> 'categoria_sistema' is not null then
      v_categoria := app.categoria_sistema(v_doc.empresa_id, v_sug ->> 'categoria_sistema');
    end if;

    v_tot_parc := jsonb_array_length(coalesce(v_sug -> 'parcelas', '[]'::jsonb));
    for v_parc in select * from jsonb_array_elements(coalesce(v_sug -> 'parcelas', '[]'::jsonb))
    loop
      if app.competencia_fechada(v_doc.empresa_id, (p_dados ->> 'data_emissao')::timestamptz::date) then
        exit;
      end if;
      insert into public.lancamentos (
        empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto,
        status_revisao, origem, origem_referencia, documento_fiscal_id, parcela_numero, parcela_total, numero_documento, criado_por
      ) values (
        v_doc.empresa_id, v_tipo_lanc, left(v_sug ->> 'descricao', 300), v_categoria, v_contraparte,
        (p_dados ->> 'data_emissao')::timestamptz::date,
        coalesce((v_parc ->> 'vencimento')::date, (p_dados ->> 'data_emissao')::timestamptz::date),
        (v_parc ->> 'valor')::numeric, 'sugerido',
        case when p_dados ->> 'modelo' like 'nfse%' then 'nfse' when p_dados ->> 'modelo' in ('57', '67') then 'cte' else 'nfe' end,
        coalesce(p_dados ->> 'chave_acesso', p_dados ->> 'identificador'), v_df_id,
        case when v_tot_parc > 1 then (v_parc ->> 'numero')::int else null end,
        case when v_tot_parc > 1 then v_tot_parc else null end,
        p_dados ->> 'numero', null
      )
      on conflict do nothing
      returning id into v_lanc;
      if v_lanc is not null then
        v_n_lanc := v_n_lanc + 1;
        insert into public.lancamento_documentos (lancamento_id, documento_id, empresa_id, tipo_vinculo, vinculado_por)
        values (v_lanc, v_doc.id, v_doc.empresa_id, 'nota_fiscal', null)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('situacao', 'registrado', 'documento_fiscal_id', v_df_id, 'lancamentos_sugeridos', v_n_lanc);
end;
$$;

-- Reprocessar um documento (ex.: após correção do cadastro da empresa).
create or replace function public.reprocessar_documento(p_documento_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
begin
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  perform app.exigir(v_doc.empresa_id, 'documentos.revisar');
  update public.documentos set processamento_status = 'pendente' where id = v_doc.id;
  return app.enfileirar('processar_documento',
    jsonb_build_object('documento_id', v_doc.id, 'reprocessar', true),
    v_doc.empresa_id, 'reprocessar:' || v_doc.id::text || ':' || extract(epoch from now())::bigint::text, now(), 30);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.documentos_fiscais enable row level security;
alter table public.documento_fiscal_itens enable row level security;
alter table public.documento_fiscal_eventos enable row level security;

create policy documentos_fiscais_leitura on public.documentos_fiscais for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[])
    or empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[])
  );
create policy documento_fiscal_itens_leitura on public.documento_fiscal_itens for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[])
    or empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[])
  );
create policy documento_fiscal_eventos_leitura on public.documento_fiscal_eventos for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[])
    or empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[])
  );
