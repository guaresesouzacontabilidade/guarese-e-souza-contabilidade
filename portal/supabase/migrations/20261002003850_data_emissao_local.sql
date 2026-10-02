-- =============================================================================
-- Data de emissão no horário local
--
-- A competência das notas era calculada pela data em UTC: uma nota emitida às
-- 22h do dia 30/09 (horário de Brasília) caía em outubro. Agora vale a data
-- escrita no próprio XML (horário de quem emitiu). Datas sem hora passam a ser
-- guardadas ao meio-dia de Brasília (antes: meia-noite UTC, que aparecia como o
-- dia anterior).
-- =============================================================================

-- Data (AAAA-MM-DD) do jeito que está escrita no XML.
create or replace function app.data_do_texto(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p ~ '^\d{4}-\d{2}-\d{2}' then
    return left(p, 10)::date;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- Instante da emissão: sem fuso no texto, considera o horário de Brasília;
-- sem hora, meio-dia (para a data não mudar ao exibir).
create or replace function app.instante_do_texto(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p ~ '^\d{4}-\d{2}-\d{2}$' then
    return (p || 'T12:00:00-03:00')::timestamptz;
  elsif p ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then
    return (p || '-03:00')::timestamptz;
  elsif p ~ '^\d{4}-\d{2}-\d{2}' then
    return p::timestamptz;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

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
    if p_dados ->> 'tipo_evento' in ('110111', '110112') and coalesce(p_dados ->> 'cstat', '') in ('135', '136', '155') then
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
  v_comp := app.competencia_de(coalesce(app.data_do_texto(p_dados ->> 'data_emissao'), v_doc.competencia));

  insert into public.documentos_fiscais (
    empresa_id, documento_id, modelo, tipo_documento, chave_acesso, identificador, numero, serie, data_emissao, competencia,
    emitente_documento, emitente_nome, emitente_uf, emitente_ie, destinatario_documento, destinatario_nome, destinatario_uf,
    tp_nf, operacao, natureza_operacao, finalidade, cfops,
    valor_total, valor_produtos, valor_servicos, valor_desconto, valor_frete, valor_outros,
    tributos, protocolo, situacao_arquivo, duplicatas, pagamentos, avisos, relacionado_empresa
  ) values (
    v_doc.empresa_id, v_doc.id, p_dados ->> 'modelo', p_dados ->> 'tipo_documento', p_dados ->> 'chave_acesso',
    p_dados ->> 'identificador', p_dados ->> 'numero', p_dados ->> 'serie', app.instante_do_texto(p_dados ->> 'data_emissao'), v_comp,
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
       and e.tipo_evento in ('110111', '110112') and coalesce(e.cstat, '') in ('135', '136', '155')
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
      if app.competencia_fechada(v_doc.empresa_id, app.data_do_texto(p_dados ->> 'data_emissao')) then
        exit;
      end if;
      insert into public.lancamentos (
        empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto,
        status_revisao, origem, origem_referencia, documento_fiscal_id, parcela_numero, parcela_total, numero_documento, criado_por
      ) values (
        v_doc.empresa_id, v_tipo_lanc, left(v_sug ->> 'descricao', 300), v_categoria, v_contraparte,
        app.data_do_texto(p_dados ->> 'data_emissao'),
        coalesce((v_parc ->> 'vencimento')::date, app.data_do_texto(p_dados ->> 'data_emissao')),
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


-- Notas já gravadas: competência pela data de Brasília. Horário exatamente à
-- meia-noite UTC indica data sem hora no arquivo (fica como está).
update public.documentos_fiscais
   set competencia = date_trunc('month', data_emissao at time zone 'America/Araguaina')::date
 where data_emissao is not null
   and (data_emissao at time zone 'UTC')::time <> time '00:00'
   and competencia <> date_trunc('month', data_emissao at time zone 'America/Araguaina')::date;

revoke execute on function app.data_do_texto(text), app.instante_do_texto(text) from public, anon, authenticated;
