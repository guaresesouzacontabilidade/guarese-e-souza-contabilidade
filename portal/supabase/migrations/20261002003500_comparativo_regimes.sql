-- =============================================================================
-- Comparativo de regimes (planejamento tributário)
--
--  * Os dados da previsão passam a aceitar até 24 meses anteriores: o
--    comparativo calcula o DAS de cada um dos últimos 12 meses, e cada DAS
--    depende da receita dos 12 meses anteriores a ele (RBT12).
--  * Sem tabela nova: o comparativo é calculado na hora, só para a equipe.
-- =============================================================================

drop function public.dados_previsao_impostos(uuid, date);

create function public.dados_previsao_impostos(p_empresa_id uuid, p_competencia date, p_meses int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  -- 12 meses anteriores (previsão) ou 24 (comparativo de regimes: RBT12 de cada um dos 12 meses)
  v_inicio date := (date_trunc('month', p_competencia) - make_interval(months => least(greatest(coalesce(p_meses, 12), 12), 24)))::date;
  v_emp public.empresas;
  v_meses jsonb;
  v_checklist jsonb;
begin
  perform app.exigir(p_empresa_id, 'calculos.ver');
  select * into v_emp from public.empresas where id = p_empresa_id;

  with notas as (
    select df.*
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
     where df.empresa_id = p_empresa_id
       and df.competencia between v_inicio and v_comp
       and df.relacionado_empresa
       and not df.cancelada_evento
       and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
       and d.excluido_em is null
       and coalesce(d.verificacao_status, '') <> 'bloqueado'
       and not (df.avisos::text ilike '%registro de cancelamento%')
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
    select n.competencia,
           coalesce(n.valor_servicos, n.valor_total, 0) as valor,
           n.tributos ? 'iss_retido' as retido,
           app.try_numeric(n.tributos ->> 'iss') as iss
      from notas n
     where n.operacao = 'saida' and n.modelo in ('nfse_nacional', 'nfse_abrasf', '57')
  ),
  meses as (
    select g::date as competencia from generate_series(v_inicio, v_comp, interval '1 month') g
  )
  select jsonb_agg(jsonb_build_object(
           'competencia', m.competencia,
           'vendas', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'vendas_st', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda_st(i.cfop)),
           'icms_vendas', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'servicos_nfe', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_servico(i.cfop)),
           'devolucoes', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'icms_devolucoes', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'compras', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop)),
           'icms_compras', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop)),
           'servicos', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia),
           'servicos_retido', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'iss_destacado', (select coalesce(sum(iss), 0) from servicos s where s.competencia = m.competencia and not s.retido),
           'servicos_sem_iss', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and not s.retido and s.iss is null),
           'iss_retido', (select coalesce(sum(iss), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'icms_debito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'icms')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'saida' and n.modelo in ('55', '65')),
           'icms_credito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'icms')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'entrada' and n.modelo in ('55', '57')),
           'ipi_debito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'ipi')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'saida' and n.modelo = '55'),
           'ipi_credito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'ipi')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'entrada' and n.modelo = '55'),
           'notas_saida', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'saida'),
           'notas_entrada', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'entrada'),
           'informado', (select jsonb_build_object('receita_mercadorias', cm.receita_mercadorias, 'receita_servicos', cm.receita_servicos,
                                                   'folha_fator_r', cm.folha_fator_r, 'observacao', cm.observacao)
                           from public.calculo_meses cm where cm.empresa_id = p_empresa_id and cm.competencia = m.competencia)
         ) order by m.competencia)
    into v_meses
    from meses m;

  select jsonb_build_object(
           'itens', count(*),
           'obrigatorios', count(*) filter (where c.obrigatorio),
           'faltantes', coalesce(jsonb_agg(jsonb_build_object('titulo', c.titulo, 'status', c.status, 'prazo', c.prazo) order by c.prazo, c.titulo)
                                   filter (where c.obrigatorio and c.status in ('pendente', 'correcao')), '[]'::jsonb)
         )
    into v_checklist
    from public.checklist_itens c
   where c.empresa_id = p_empresa_id and c.competencia = v_comp;

  return jsonb_build_object(
    'competencia', v_comp,
    'empresa', jsonb_build_object(
      'nome', coalesce(nullif(trim(v_emp.nome_fantasia), ''), v_emp.razao_social),
      'regime', app.regime_em(p_empresa_id, v_comp),
      'lucro_real_apuracao', app.lucro_real_apuracao_em(p_empresa_id, v_comp),
      'contribuinte_icms', v_emp.contribuinte_icms,
      'contribuinte_iss', v_emp.contribuinte_iss,
      'tem_empregados', v_emp.tem_empregados,
      'tem_pro_labore', v_emp.tem_pro_labore,
      'uf', v_emp.uf
    ),
    'parametros', (select to_jsonb(p) - 'atualizado_por' - 'created_at' from public.calculo_parametros p where p.empresa_id = p_empresa_id),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'checklist', v_checklist,
    -- Folha: só valores e datas (sem nomes)
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object('admissao', c.admissao, 'desligamento', c.desligamento, 'salario', c.salario,
                                          'adicionais', c.adicionais, 'dependentes_ir', c.dependentes_ir))
        from public.colaboradores c
       where c.empresa_id = p_empresa_id
         and c.admissao <= (v_comp + interval '1 month' - interval '1 day')::date
         and (c.desligamento is null or c.desligamento >= v_inicio)
    ), '[]'::jsonb),
    'ajustes', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'descricao', a.descricao, 'valor', a.valor, 'observacao', a.observacao) order by a.created_at)
        from public.calculo_ajustes a
       where a.empresa_id = p_empresa_id and a.competencia = v_comp
    ), '[]'::jsonb),
    -- Vencimentos calculados pelo módulo de obrigações (regras validadas) e
    -- o valor da guia, quando o escritório já a publicou.
    'vencimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', o.codigo,
               'vencimento', t.prazo_legal,
               'valor_guia', case when gd.publicado_em is not null and gd.excluido_em is null then t.valor end,
               'concluida', t.status = 'concluida'))
        from public.tarefas t
        join public.obrigacoes o on o.id = t.obrigacao_id
        left join public.documentos gd on gd.id = t.guia_documento_id
       where t.empresa_id = p_empresa_id and t.competencia = v_comp and t.etapa = 'pagamento' and t.status <> 'dispensada'
    ), '[]'::jsonb),
    'guias_publicadas', (
      select count(*) from public.documentos d
       where d.empresa_id = p_empresa_id and d.competencia = v_comp and d.categoria_codigo = 'esc_guia'
         and d.publicado_em is not null and d.excluido_em is null
    )
  );
end;
$$;

revoke execute on function public.dados_previsao_impostos(uuid, date, int) from public, anon;
grant execute on function public.dados_previsao_impostos(uuid, date, int) to authenticated;
