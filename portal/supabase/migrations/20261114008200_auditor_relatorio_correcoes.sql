-- =============================================================================
-- Auditor fiscal: relatório de correções para o cliente
--
--  * auditor_achados.criterios: os grupos de itens (mês, operação, CFOP, NCM,
--    CST/CSOSN...) que levaram a cada achado, gravados pela análise.
--  * auditor_relatorio_itens: para os achados escolhidos, todos os produtos
--    desses grupos (código, descrição, NCM e códigos fiscais usados), com as
--    notas em que aparecem — a base do relatório que a equipe gera.
-- =============================================================================

alter table public.auditor_achados
  add column criterios jsonb not null default '[]'::jsonb
    check (jsonb_typeof(criterios) = 'array' and pg_column_size(criterios) <= 200000);

create or replace function public.auditor_registrar_resultado(p_execucao_id uuid, p_achados jsonb, p_resumo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec public.auditor_execucoes;
  a jsonb;
  v_atual public.auditor_achados;
  v_novos int := 0;
  v_atualizados int := 0;
  v_removidos int := 0;
  v_valor_novos numeric := 0;
  v_chaves text[];
  v_nome text;
begin
  select * into v_exec from public.auditor_execucoes where id = p_execucao_id for update;
  if not found then
    raise exception 'Execução não encontrada.';
  end if;
  if jsonb_typeof(coalesce(p_achados, '[]'::jsonb)) <> 'array' then
    raise exception 'Achados inválidos.';
  end if;
  select coalesce(array_agg(x ->> 'chave'), array[]::text[]) into v_chaves from jsonb_array_elements(coalesce(p_achados, '[]'::jsonb)) x;

  for a in select * from jsonb_array_elements(coalesce(p_achados, '[]'::jsonb))
  loop
    select * into v_atual from public.auditor_achados where empresa_id = v_exec.empresa_id and chave = a ->> 'chave';
    if not found then
      insert into public.auditor_achados (
        empresa_id, execucao_id, regra, chave, competencia, tipo, confianca, titulo, resumo,
        valor_base, valor_estimado, memoria, referencias, criterios, fontes
      ) values (
        v_exec.empresa_id, v_exec.id, a ->> 'regra', a ->> 'chave', (a ->> 'competencia')::date, a ->> 'tipo', a ->> 'confianca',
        left(a ->> 'titulo', 200), left(a ->> 'resumo', 3000),
        (a ->> 'valor_base')::numeric, (a ->> 'valor_estimado')::numeric,
        coalesce(a -> 'memoria', '[]'::jsonb), coalesce(a -> 'referencias', '[]'::jsonb),
        coalesce(a -> 'criterios', '[]'::jsonb), coalesce(a -> 'fontes', '[]'::jsonb)
      );
      v_novos := v_novos + 1;
      if a ->> 'tipo' = 'oportunidade' then
        v_valor_novos := v_valor_novos + coalesce((a ->> 'valor_estimado')::numeric, 0);
      end if;
    else
      update public.auditor_achados
         set execucao_id = v_exec.id,
             tipo = a ->> 'tipo',
             confianca = a ->> 'confianca',
             titulo = left(a ->> 'titulo', 200),
             resumo = left(a ->> 'resumo', 3000),
             valor_base = (a ->> 'valor_base')::numeric,
             valor_estimado = (a ->> 'valor_estimado')::numeric,
             memoria = coalesce(a -> 'memoria', '[]'::jsonb),
             referencias = coalesce(a -> 'referencias', '[]'::jsonb),
             criterios = coalesce(a -> 'criterios', '[]'::jsonb),
             fontes = coalesce(a -> 'fontes', '[]'::jsonb),
             atualizado_em = now(),
             valores_alterados_em = case
               when v_atual.situacao <> 'novo'
                and (v_atual.valor_estimado is distinct from (a ->> 'valor_estimado')::numeric
                     or v_atual.valor_base is distinct from (a ->> 'valor_base')::numeric)
               then now() else v_atual.valores_alterados_em end
       where id = v_atual.id;
      v_atualizados := v_atualizados + 1;
    end if;
  end loop;

  -- Achados ainda não revisados que deixaram de aparecer (ex.: nota excluída) saem da lista.
  delete from public.auditor_achados
   where empresa_id = v_exec.empresa_id and situacao = 'novo' and not (chave = any(v_chaves));
  get diagnostics v_removidos = row_count;

  update public.auditor_execucoes
     set situacao = 'concluida',
         concluida_em = now(),
         periodo_inicio = (p_resumo ->> 'periodo_inicio')::date,
         periodo_fim = (p_resumo ->> 'periodo_fim')::date,
         notas_analisadas = (p_resumo ->> 'notas')::int,
         itens_analisados = (p_resumo ->> 'itens')::int,
         notas_relidas = coalesce((p_resumo ->> 'notas_relidas')::int, notas_relidas),
         achados_novos = v_novos,
         achados_atualizados = v_atualizados,
         resumo = p_resumo,
         erro = null
   where id = v_exec.id;

  if v_novos > 0 then
    select coalesce(nullif(nome_fantasia, ''), razao_social) into v_nome from public.empresas where id = v_exec.empresa_id;
    perform app.notificar_equipe(
      v_exec.empresa_id, 'auditor_fiscal',
      'Auditor fiscal: ' || v_novos || case when v_novos = 1 then ' achado novo' else ' achados novos' end || ' — ' || coalesce(v_nome, ''),
      case when v_valor_novos > 0
           then 'Possível economia de ' || app.moeda_br(v_valor_novos) || ' para revisar.'
           else 'Há pontos para revisar nas notas da empresa.' end,
      '/e/' || v_exec.empresa_id::text || '/auditor-fiscal',
      false
    );
  end if;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados, 'removidos', v_removidos);
end;
$$;

-- -----------------------------------------------------------------------------
-- Produtos e notas dos achados escolhidos (só a equipe)
-- -----------------------------------------------------------------------------
create or replace function public.auditor_relatorio_itens(p_empresa_id uuid, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini date;
  v_fim date;
  v_resultado jsonb;
begin
  perform app.exigir(p_empresa_id, 'auditor.gerenciar');
  if coalesce(cardinality(p_ids), 0) = 0 or cardinality(p_ids) > 200 then
    raise exception 'Escolha de 1 a 200 achados.';
  end if;
  select min((c ->> 'competencia')::date), max((c ->> 'competencia')::date)
    into v_ini, v_fim
    from public.auditor_achados x, jsonb_array_elements(x.criterios) c
   where x.empresa_id = p_empresa_id and x.id = any(p_ids);
  if v_ini is null then
    return '[]'::jsonb;
  end if;

  with crit as (
    select x.id as achado_id, c
      from public.auditor_achados x, jsonb_array_elements(x.criterios) c
     where x.empresa_id = p_empresa_id and x.id = any(p_ids)
  ),
  notas as (
    select n.* from app.auditor_notas_validas(p_empresa_id, v_ini, v_fim) n where n.modelo in ('55', '65')
  ),
  itens as (
    -- Mesmos campos do agrupamento da análise (auditor_itens_agrupados)
    select distinct on (crit.achado_id, i.id)
           crit.achado_id, crit.c ->> 'motivo' as motivo,
           n.id as nota_id, n.documento_id, n.numero, n.modelo, n.data_emissao, n.operacao,
           nullif(trim(coalesce(i.codigo, '')), '') as codigo, left(i.descricao, 200) as descricao,
           nullif(trim(coalesce(i.ncm, '')), '') as ncm, i.cfop,
           i.tributos ->> 'csosn' as csosn, i.tributos ->> 'cst_icms' as cst_icms,
           i.tributos ->> 'cst_pis' as cst_pis, i.tributos ->> 'cst_cofins' as cst_cofins,
           coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor
      from crit
      join notas n on n.competencia = (crit.c ->> 'competencia')::date
                  and n.operacao = crit.c ->> 'operacao'
                  and n.modelo = crit.c ->> 'modelo'
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
     where i.cfop is not distinct from crit.c ->> 'cfop'
       and nullif(trim(coalesce(i.ncm, '')), '') is not distinct from crit.c ->> 'ncm'
       and i.gtin is not distinct from crit.c ->> 'gtin'
       and i.cest is not distinct from crit.c ->> 'cest'
       and i.ex_tipi is not distinct from crit.c ->> 'ex'
       and i.tributos ->> 'csosn' is not distinct from crit.c ->> 'csosn'
       and i.tributos ->> 'cst_icms' is not distinct from crit.c ->> 'cst_icms'
       and i.tributos ->> 'cst_pis' is not distinct from crit.c ->> 'cst_pis'
       and i.tributos ->> 'cst_cofins' is not distinct from crit.c ->> 'cst_cofins'
  ),
  produtos as (
    select achado_id, codigo, descricao, ncm, cfop, csosn, cst_icms, cst_pis, cst_cofins, operacao,
           min(motivo) as motivo,
           count(*)::int as itens,
           count(distinct nota_id)::int as notas,
           sum(valor) as valor,
           (array_agg(jsonb_build_object('numero', numero, 'modelo', modelo, 'data', data_emissao, 'documento_id', documento_id, 'valor', valor)
                      order by data_emissao, numero))[1:40] as lista
      from itens
     group by achado_id, codigo, descricao, ncm, cfop, csosn, cst_icms, cst_pis, cst_cofins, operacao
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', a.achado_id, 'produtos', a.produtos)), '[]'::jsonb)
    into v_resultado
    from (
      select achado_id,
             jsonb_agg(jsonb_build_object(
               'codigo', codigo, 'descricao', descricao, 'ncm', ncm, 'cfop', cfop, 'csosn', csosn, 'cst_icms', cst_icms,
               'cst_pis', cst_pis, 'cst_cofins', cst_cofins, 'operacao', operacao, 'motivo', motivo,
               'itens', itens, 'notas', notas, 'valor', valor, 'lista', to_jsonb(lista)) order by valor desc) as produtos
        from produtos
       group by achado_id
    ) a;
  return v_resultado;
end;
$$;

revoke execute on function public.auditor_relatorio_itens(uuid, uuid[]) from public, anon;
grant execute on function public.auditor_relatorio_itens(uuid, uuid[]) to authenticated;
