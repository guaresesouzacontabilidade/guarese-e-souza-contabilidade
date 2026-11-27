-- =============================================================================
-- Auditor fiscal: notas de serviço (NFS-e)
--
--  * A chegada de NFS-e também agenda a análise da empresa, e a reanálise do
--    dia 2 inclui as empresas que só têm notas de serviço.
--  * NFS-e lidas antes da leitura 3 (sem o regime do prestador, a alíquota e a
--    retenção do ISS e as retenções federais) são relidas antes da análise.
--  * auditor_servicos: notas de serviço do período para as regras do auditor
--    (src/lib/auditor-fiscal/servicos.ts). Uso exclusivo do processador.
-- =============================================================================

create or replace function app.tg_documentos_fiscais_auditor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.relacionado_empresa and (new.modelo in ('55', '65') or new.modelo like 'nfse%') then
    perform app.agendar_auditor_fiscal(new.empresa_id, now());
  end if;
  return new;
end;
$$;

create or replace function public.rotina_auditor_fiscal()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := app.hoje();
  v_n int := 0;
  r record;
begin
  if extract(day from v_hoje) <> 2 then
    return jsonb_build_object('agendadas', 0, 'motivo', 'a reanálise mensal roda no dia 2');
  end if;
  for r in
    select e.id
      from public.empresas e
     where e.ativa
       and exists (select 1 from public.documentos_fiscais df
                    where df.empresa_id = e.id and df.relacionado_empresa and (df.modelo in ('55', '65') or df.modelo like 'nfse%')
                      and df.competencia >= (date_trunc('month', v_hoje) - interval '60 months')::date)
  loop
    perform app.enfileirar('auditor_fiscal', jsonb_build_object('empresa_id', r.id, 'origem', 'mensal'), r.id,
                           'auditor:mensal:' || r.id::text || ':' || to_char(v_hoje, 'YYYY-MM'), now(), 130);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('agendadas', v_n);
end;
$$;

create or replace function public.auditor_dados(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp public.empresas;
  -- 12 meses antes do início: receita bruta acumulada (RBT12) do primeiro mês analisado
  v_ini_receitas date := (p_inicio - interval '12 months')::date;
  v_meses jsonb;
begin
  select * into v_emp from public.empresas where id = p_empresa_id;
  if not found then
    raise exception 'Empresa não encontrada.';
  end if;

  -- Mesma regra de public.dados_previsao_impostos (receitas por mês)
  with notas as (
    select * from app.auditor_notas_validas(p_empresa_id, v_ini_receitas, p_fim)
  ),
  itens as (
    select n.competencia, n.operacao, i.cfop,
           coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor,
           coalesce(app.try_numeric(i.tributos ->> 'icms'), 0) as icms
      from notas n
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
     where n.modelo in ('55', '65')
  ),
  servicos as (
    select n.competencia, coalesce(n.valor_servicos, n.valor_total, 0) as valor, n.tributos ? 'iss_retido' as retido
      from notas n
     where n.operacao = 'saida' and n.modelo in ('nfse_nacional', 'nfse_abrasf', '57')
  ),
  meses as (
    select g::date as competencia from generate_series(v_ini_receitas, p_fim, interval '1 month') g
  )
  select jsonb_agg(jsonb_build_object(
           'competencia', m.competencia,
           'regime', app.regime_em(p_empresa_id, m.competencia),
           'vendas', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'vendas_st', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda_st(i.cfop)),
           'icms_vendas', 0, 'icms_devolucoes', 0, 'icms_compras', 0, 'compras', 0,
           'servicos_nfe', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_servico(i.cfop)),
           'devolucoes', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'servicos', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia),
           'servicos_retido', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'iss_destacado', 0, 'servicos_sem_iss', 0, 'iss_retido', 0, 'icms_debito', 0, 'icms_credito', 0, 'ipi_debito', 0, 'ipi_credito', 0,
           'notas_saida', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'saida'),
           'notas_entrada', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'entrada'),
           'informado', (select jsonb_build_object('receita_mercadorias', cm.receita_mercadorias, 'receita_servicos', cm.receita_servicos,
                                                   'folha_fator_r', cm.folha_fator_r, 'observacao', cm.observacao)
                           from public.calculo_meses cm where cm.empresa_id = p_empresa_id and cm.competencia = m.competencia)
         ) order by m.competencia)
    into v_meses
    from meses m;

  return jsonb_build_object(
    'empresa', jsonb_build_object(
      'id', v_emp.id,
      'nome', coalesce(nullif(trim(v_emp.nome_fantasia), ''), v_emp.razao_social),
      'documento', v_emp.documento,
      'uf', v_emp.uf,
      'regime', v_emp.regime_tributario
    ),
    'parametros', (select to_jsonb(p) - 'atualizado_por' - 'created_at' from public.calculo_parametros p where p.empresa_id = p_empresa_id),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'catalogo', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ncm', c.ncm_prefixo, 'ex', c.ex_tipi, 'excecao', c.excecao, 'grupo', c.grupo, 'descricao', c.descricao,
               'condicao', c.condicao, 'somente_varejo', c.somente_varejo, 'confianca', c.confianca,
               'fonte', jsonb_build_object('titulo', c.fonte_titulo, 'url', c.fonte_url),
               'inicio', c.vigencia_inicio, 'fim', c.vigencia_fim))
        from public.auditor_ncm_monofasico c where c.ativo
    ), '[]'::jsonb),
    'leitura_antiga', (
      select count(*) from app.auditor_notas_validas(p_empresa_id, p_inicio, p_fim) n
       where (n.leitura_versao < 2 and n.modelo in ('55', '65')) or (n.leitura_versao < 3 and n.modelo like 'nfse%')
    ),
    'notas', (
      select count(*) from app.auditor_notas_validas(p_empresa_id, p_inicio, p_fim) n
       where (n.modelo in ('55', '65') or n.modelo like 'nfse%') and n.operacao in ('entrada', 'saida')
    ),
    'notas_servico', (
      select count(*) from app.auditor_notas_validas(p_empresa_id, p_inicio, p_fim) n
       where n.modelo like 'nfse%' and n.operacao in ('entrada', 'saida')
    ),
    -- Folha (só valores e datas, sem nomes): Fator R dos serviços no Simples
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object('admissao', c.admissao, 'desligamento', c.desligamento, 'salario', c.salario,
                                          'adicionais', c.adicionais, 'dependentes_ir', c.dependentes_ir))
        from public.colaboradores c
       where c.empresa_id = p_empresa_id
         and c.admissao <= p_fim + interval '1 month'
         and (c.desligamento is null or c.desligamento >= v_ini_receitas)
    ), '[]'::jsonb),
    -- Notas de venda sem o grupo IBS/CBS em nenhum item, por mês (todas e as emitidas a partir de 03/08/2026)
    'sem_ibscbs', coalesce((
      select jsonb_agg(jsonb_build_object('competencia', x.competencia, 'total', x.total, 'apos_normal', x.apos_normal) order by x.competencia)
        from (
          select n.competencia, count(*) as total,
                 count(*) filter (where n.data_emissao >= timestamptz '2026-08-03 00:00:00-03') as apos_normal
            from app.auditor_notas_validas(p_empresa_id, greatest(p_inicio, date '2026-08-01'), p_fim) n
           where n.operacao = 'saida' and n.modelo in ('55', '65')
             and not exists (select 1 from public.documento_fiscal_itens i where i.documento_fiscal_id = n.id and i.tributos ? 'cst_ibscbs')
           group by n.competencia
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.auditor_servicos(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'documento_id', n.documento_id, 'numero', n.numero, 'modelo', n.modelo,
           'data', n.data_emissao, 'competencia', n.competencia, 'operacao', n.operacao,
           'valor', coalesce(n.valor_servicos, n.valor_total, 0), 'liquido', n.valor_total,
           'tributos', n.tributos,
           'contraparte_documento', case when n.operacao = 'saida' then n.destinatario_documento else n.emitente_documento end,
           'contraparte', case when n.operacao = 'saida' then n.destinatario_nome else n.emitente_nome end
         ) order by n.competencia, n.data_emissao), '[]'::jsonb)
    from app.auditor_notas_validas(p_empresa_id, p_inicio, p_fim) n
   where n.modelo like 'nfse%' and n.operacao in ('entrada', 'saida');
$$;

revoke execute on function public.auditor_servicos(uuid, date, date) from public, anon, authenticated;
grant execute on function public.auditor_servicos(uuid, date, date) to service_role;
