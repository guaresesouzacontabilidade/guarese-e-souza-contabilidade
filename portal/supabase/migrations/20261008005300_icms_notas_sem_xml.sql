-- =============================================================================
-- Apuração do ICMS: NF-e recebidas só em resumo
--
-- As NF-e de entrada que a SEFAZ entregou só em resumo (o XML completo ainda
-- não chegou: ciência fora do prazo, confirmação pedida...) não têm itens nem
-- ICMS e ficam fora do cálculo. A função passa a listá-las ("sem_xml") para a
-- tela avisar quantas são, o valor e de onde vêm, em vez de ficarem de fora
-- sem aviso.
-- =============================================================================

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
    'leitura_antiga', (select count(*) from notas n where n.modelo in ('55', '65') and n.leitura_versao < p_versao_leitura),
    -- NF-e recebidas do mês que só têm o resumo da SEFAZ (sem o XML completo):
    -- não entram no cálculo; a tela avisa e lista
    'sem_xml', coalesce((
      select jsonb_agg(jsonb_build_object(
               'chave', r.chave,
               'emitente', case when v_detalhe then r.emitente_nome end,
               'emitente_documento', case when v_detalhe then r.emitente_documento end,
               'data', r.data_emissao,
               'valor', r.valor,
               'ciencia', r.ciencia_em is not null,
               'confirmacao_pedida', r.confirmacao_pedida_em is not null,
               'confirmada', r.confirmacao_em is not null
             ) order by r.data_emissao)
        from public.nfe_resumos r
       where r.empresa_id = p_empresa_id
         and r.situacao = 'autorizada'
         and r.documento_id is null
         and date_trunc('month', r.data_emissao at time zone 'America/Araguaina')::date = v_comp
         and not exists (select 1 from public.documentos_fiscais df where df.empresa_id = p_empresa_id and df.chave_acesso = r.chave)
    ), '[]'::jsonb)
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
