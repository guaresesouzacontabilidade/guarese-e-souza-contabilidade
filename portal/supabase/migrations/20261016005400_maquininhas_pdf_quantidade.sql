-- =============================================================================
-- Maquininhas: relatório em PDF da Cielo e linhas com várias vendas
--
--  * O auditor passa a ler a "Lista de Vendas" da Cielo em PDF (uma linha por
--    dia e forma de pagamento, com a quantidade de vendas, o bruto, a taxa e o
--    líquido). O leitor (src/lib/maquininhas/pdf.ts) monta um cabeçalho fixo;
--    o formato já vem cadastrado para todo o escritório, então o relatório é
--    importado e conferido sozinho, sem conferir colunas.
--  * Relatórios resumidos trazem várias vendas numa linha: a coluna
--    "quantidade" guarda quantas, e a tarifa fixa do contrato (R$ por venda)
--    passa a contar uma vez por venda (tarifa × quantidade). A tolerância de
--    arredondamento também é por venda (2 centavos cada).
-- =============================================================================

alter table public.maquininha_vendas
  add column quantidade int not null default 1 check (quantidade between 1 and 100000);

create or replace function public.maquininha_gravar_vendas(p_importacao_id uuid, p_vendas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.maquininha_importacoes;
  v_novas int := 0;
  v_total int := 0;
begin
  select * into v from public.maquininha_importacoes where id = p_importacao_id;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  if v.adquirente_chave is null then
    raise exception 'Adquirente do relatório não definida.';
  end if;
  with dados as (
    select distinct on (x.chave_unica) x.*
      from jsonb_to_recordset(coalesce(p_vendas, '[]'::jsonb)) as x(
             data_venda date, bandeira text, modalidade text, parcelas int, valor_bruto numeric, valor_taxa numeric,
             valor_liquido numeric, nsu text, autorizacao text, terminal text, data_prevista date, situacao text, linha int,
             chave_unica text, quantidade int)
     where x.chave_unica is not null
     order by x.chave_unica, x.linha
  ), gravadas as (
    insert into public.maquininha_vendas as mv (empresa_id, importacao_id, adquirente_chave, data_venda, bandeira, modalidade, parcelas,
                                               valor_bruto, valor_taxa, valor_liquido, nsu, autorizacao, terminal, data_prevista,
                                               situacao, linha, chave_unica, quantidade)
    select v.empresa_id, v.id, v.adquirente_chave, d.data_venda, d.bandeira, d.modalidade, coalesce(d.parcelas, 1),
           d.valor_bruto, d.valor_taxa, d.valor_liquido, d.nsu, d.autorizacao, d.terminal, d.data_prevista,
           coalesce(d.situacao, 'aprovada'), d.linha, left(v.adquirente_chave || '|' || d.chave_unica, 500),
           least(greatest(coalesce(d.quantidade, 1), 1), 100000)
      from dados d
    on conflict (empresa_id, chave_unica) do update
       set importacao_id = excluded.importacao_id, bandeira = excluded.bandeira, modalidade = excluded.modalidade,
           parcelas = excluded.parcelas, valor_bruto = excluded.valor_bruto, valor_taxa = excluded.valor_taxa,
           valor_liquido = excluded.valor_liquido, nsu = excluded.nsu, autorizacao = excluded.autorizacao,
           terminal = excluded.terminal, data_prevista = excluded.data_prevista, situacao = excluded.situacao,
           linha = excluded.linha, quantidade = excluded.quantidade, conferencia = 'pendente'
    returning (mv.xmax = 0) as nova
  )
  select count(*) filter (where nova), count(*) into v_novas, v_total from gravadas;
  return jsonb_build_object('novas', v_novas, 'atualizadas', v_total - v_novas);
end;
$$;

-- Diferença de até 2 centavos por venda é arredondamento.
create or replace function app.maquininha_auditar(p_empresa_id uuid, p_inicio date, p_fim date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with escolha as (
    select v.id as venda_id, c.id as contrato_id, t.id as taxa_id, t.taxa_percentual, t.tarifa_fixa,
           case when t.id is null then null else round(v.valor_bruto * t.taxa_percentual / 100 + t.tarifa_fixa * v.quantidade, 2) end as esperado,
           v.valor_taxa, v.situacao, v.quantidade
      from public.maquininha_vendas v
      left join lateral (
        select c.* from public.maquininha_contratos c
         where c.empresa_id = v.empresa_id and c.ativo and c.adquirente_chave = v.adquirente_chave
           and c.vigencia_inicio <= v.data_venda and (c.vigencia_fim is null or c.vigencia_fim >= v.data_venda)
         order by c.vigencia_inicio desc, c.created_at desc
         limit 1
      ) c on true
      left join lateral (
        select t.* from public.maquininha_taxas t
         where t.contrato_id = c.id and t.modalidade = v.modalidade
           and v.parcelas between t.parcelas_de and t.parcelas_ate
           and (t.bandeira is null or t.bandeira = v.bandeira)
         order by (t.bandeira is not null) desc, (t.parcelas_ate - t.parcelas_de), t.taxa_percentual
         limit 1
      ) t on true
     where v.empresa_id = p_empresa_id and v.data_venda between p_inicio and p_fim
  )
  update public.maquininha_vendas v
     set contrato_id = e.contrato_id,
         taxa_id = e.taxa_id,
         taxa_contratada = e.taxa_percentual,
         tarifa_contratada = e.tarifa_fixa,
         valor_esperado = e.esperado,
         diferenca = case when e.esperado is null then null else e.valor_taxa - e.esperado end,
         conferencia = case
           when e.situacao <> 'aprovada' then 'cancelada'
           when e.contrato_id is null then 'sem_contrato'
           when e.taxa_id is null then 'sem_taxa'
           when abs(e.valor_taxa - e.esperado) <= 0.02 * e.quantidade then 'ok'
           when e.valor_taxa > e.esperado then 'acima'
           else 'abaixo'
         end
    from escolha e
   where v.id = e.venda_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Formato da "Lista de Vendas" da Cielo em PDF (cabeçalho montado pelo portal), para todo o escritório
insert into public.maquininha_layouts (empresa_id, assinatura, adquirente_codigo, adquirente_nome, tipo, mapeamento)
values (null, 'data da venda|forma de pagamento|quantidade de vendas|valor bruto|valor taxa tarifa|valor liquido|origem pdf lista de vendas cielo',
        'cielo', 'Cielo', 'cartao', '{"linhaCabecalho": 0, "data": 0, "modalidade": 1, "bandeira": null, "quantidade": 2, "bruto": 3, "taxa": 4, "liquido": 5, "taxa_percentual": null, "parcelas": null, "nsu": null, "autorizacao": null, "terminal": null, "previsao": null, "situacao": null}'::jsonb)
on conflict (empresa_id, assinatura) do nothing;

-- Resumos contam vendas (a soma das quantidades), não linhas do relatório.
create or replace function public.maquininha_resumo(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'maquininhas.ver');
  return jsonb_build_object(
    'totais', (
      select jsonb_build_object(
               'vendas', coalesce(sum(quantidade) filter (where situacao = 'aprovada'), 0),
               'bruto', coalesce(sum(valor_bruto) filter (where situacao = 'aprovada'), 0),
               'taxas', coalesce(sum(valor_taxa) filter (where situacao = 'aprovada'), 0),
               'acima', coalesce(sum(diferenca) filter (where conferencia = 'acima'), 0),
               'vendas_acima', coalesce(sum(quantidade) filter (where conferencia = 'acima'), 0),
               'abaixo', coalesce(sum(-diferenca) filter (where conferencia = 'abaixo'), 0),
               'sem_taxa', coalesce(sum(quantidade) filter (where conferencia in ('sem_taxa', 'sem_contrato')), 0),
               'canceladas', coalesce(sum(quantidade) filter (where situacao <> 'aprovada'), 0))
        from public.maquininha_vendas
       where empresa_id = p_empresa_id and data_venda between p_inicio and p_fim
    ),
    'grupos', coalesce((
      select jsonb_agg(g order by g ->> 'adquirente', g ->> 'bandeira', g ->> 'modalidade', (g ->> 'parcelas')::int)
        from (
          select jsonb_build_object(
                   'adquirente_chave', v.adquirente_chave,
                   'adquirente', coalesce(max(c.adquirente_nome), max(i.adquirente_nome), v.adquirente_chave),
                   'bandeira', coalesce(v.bandeira, '—'),
                   'modalidade', v.modalidade,
                   'parcelas', v.parcelas,
                   'vendas', sum(v.quantidade),
                   'bruto', sum(v.valor_bruto),
                   'taxas', sum(v.valor_taxa),
                   'esperado', sum(v.valor_esperado),
                   'taxa_contratada', max(v.taxa_contratada),
                   'tarifa_contratada', max(v.tarifa_contratada),
                   'acima', coalesce(sum(v.diferenca) filter (where v.conferencia = 'acima'), 0),
                   'vendas_acima', coalesce(sum(v.quantidade) filter (where v.conferencia = 'acima'), 0),
                   'sem_taxa', coalesce(sum(v.quantidade) filter (where v.conferencia in ('sem_taxa', 'sem_contrato')), 0),
                   'sem_contrato', bool_or(v.conferencia = 'sem_contrato')
                 ) as g
            from public.maquininha_vendas v
            left join public.maquininha_contratos c on c.id = v.contrato_id
            left join public.maquininha_importacoes i on i.id = v.importacao_id
           where v.empresa_id = p_empresa_id and v.data_venda between p_inicio and p_fim and v.situacao = 'aprovada'
           group by v.adquirente_chave, v.bandeira, v.modalidade, v.parcelas
        ) x
    ), '[]'::jsonb),
    'maiores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'data', v.data_venda, 'bandeira', v.bandeira, 'modalidade', v.modalidade, 'parcelas', v.parcelas,
               'bruto', v.valor_bruto, 'taxa', v.valor_taxa, 'esperado', v.valor_esperado, 'diferenca', v.diferenca,
               'taxa_contratada', v.taxa_contratada, 'nsu', v.nsu, 'autorizacao', v.autorizacao, 'adquirente_chave', v.adquirente_chave,
               'quantidade', v.quantidade)
             order by v.diferenca desc, v.data_venda)
        from (
          select * from public.maquininha_vendas
           where empresa_id = p_empresa_id and data_venda between p_inicio and p_fim and conferencia = 'acima'
           order by diferenca desc, data_venda
           limit 100
        ) v
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.maquininha_carteira(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(app.tipo_usuario(), '') not in ('admin', 'equipe') then
    raise exception 'Somente a equipe do escritório.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'acima')::numeric desc, x ->> 'empresa')
      from (
        select jsonb_build_object(
                 'empresa_id', e.id,
                 'empresa', coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social),
                 'documento', e.documento,
                 'contratos', (select count(*) from public.maquininha_contratos c where c.empresa_id = e.id and c.ativo),
                 'vendas', coalesce(sum(v.quantidade) filter (where v.situacao = 'aprovada'), 0),
                 'bruto', coalesce(sum(v.valor_bruto) filter (where v.situacao = 'aprovada'), 0),
                 'taxas', coalesce(sum(v.valor_taxa) filter (where v.situacao = 'aprovada'), 0),
                 'acima', coalesce(sum(v.diferenca) filter (where v.conferencia = 'acima'), 0),
                 'sem_taxa', coalesce(sum(v.quantidade) filter (where v.conferencia in ('sem_taxa', 'sem_contrato')), 0),
                 'aguardando', (select count(*) from public.maquininha_importacoes i where i.empresa_id = e.id and i.situacao = 'aguardando_mapeamento'),
                 'ultimo_relatorio', (select max(i.created_at) from public.maquininha_importacoes i where i.empresa_id = e.id)
               ) as x
          from public.empresas e
          left join public.maquininha_vendas v on v.empresa_id = e.id and v.data_venda between p_inicio and p_fim
         where e.id = any (app.empresas_com('maquininhas.ver'))
           and (exists (select 1 from public.maquininha_contratos c where c.empresa_id = e.id)
                or exists (select 1 from public.maquininha_importacoes i where i.empresa_id = e.id))
         group by e.id
      ) s
  ), '[]'::jsonb);
end;
$$;
