-- Importação de contas a pagar/receber a partir do relatório em PDF.
--
-- * Tipo de documento "Relatórios de contas a pagar e a receber" (PDF, Excel ou
--   CSV), para o cliente enviar o relatório do sistema antigo e importar.
-- * importar_lancamentos aceita, por linha, a conta sugerida pelo histórico da
--   própria empresa ("categoria_sugerida_id"): o lançamento já vem com a conta
--   preenchida, mas continua "sugerido" (só entra nos relatórios depois que
--   alguém confirma). A conta escrita na planilha continua confirmando direto.

insert into public.categorias_documento (codigo, nome, descricao, grupo, extensoes, escritorio, ordem) values
  ('relatorio_contas', 'Relatórios de contas a pagar e a receber',
   'Relatório do sistema da empresa com as contas a pagar ou a receber (PDF, Excel ou CSV). O portal importa as contas no Financeiro com as datas e os valores.',
   'financeiro', array['pdf','xlsx','xls','csv'], false, 115)
on conflict (codigo) do nothing;

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
  v_sugerida boolean;
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
    -- Conta sugerida pelo histórico da empresa: preenchida, mas fica para revisar
    v_sugerida := false;
    if v_cat is null and v_linha ->> 'categoria_sugerida_id' is not null then
      select id into v_cat from public.categorias_financeiras
       where id = app.try_uuid(v_linha ->> 'categoria_sugerida_id') and empresa_id = p_empresa_id and not sintetica and ativa;
      v_sugerida := v_cat is not null;
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
      v_comp, v_venc, v_valor, case when v_cat is null or v_sugerida then 'sugerido' else 'confirmado' end, 'importacao', v_id, v_chave,
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
    if (v_linha ->> 'data_pagamento') is not null and v_conta is not null and v_cat is not null and not v_sugerida
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

