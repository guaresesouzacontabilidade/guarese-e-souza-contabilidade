-- =============================================================================
-- Maquininhas: "Lista de Vendas" da Cielo em CSV e releitura com outro formato
--
--  * O CSV da Cielo tem muitas linhas de título e rodapé; o leitor passou a
--    reconhecer o ";" mesmo assim (src/lib/extratos/planilha.ts). O formato
--    (o mesmo cabeçalho do PDF, uma linha por dia e forma de pagamento) já vem
--    cadastrado para o escritório todo, então o relatório entra sozinho.
--  * Ao ler de novo um relatório cujo cabeçalho mudou (leitor corrigido), as
--    colunas conferidas para o cabeçalho antigo não servem mais: vale o
--    formato do cabeçalho novo (ou a conferência das colunas de novo).
-- =============================================================================

create or replace function public.maquininha_registrar_relatorio(
  p_documento_id uuid, p_versao int, p_nome text, p_assinatura text, p_cabecalho jsonb, p_amostra jsonb, p_linhas int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_layout public.maquininha_layouts;
  v_id uuid;
  v_situacao text;
begin
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  -- Formato já aprendido: primeiro o da empresa, depois o do escritório
  select * into v_layout from public.maquininha_layouts l
   where l.assinatura = p_assinatura and (l.empresa_id = v_doc.empresa_id or l.empresa_id is null)
   order by l.empresa_id nulls last
   limit 1;
  v_situacao := case when v_layout.id is null then 'aguardando_mapeamento' else 'na_fila' end;

  insert into public.maquininha_importacoes (empresa_id, documento_id, versao, nome_arquivo, situacao, adquirente_codigo, adquirente_nome, tipo,
                                             adquirente_chave, assinatura, cabecalho, amostra, mapeamento, linhas, criado_por)
  values (v_doc.empresa_id, v_doc.id, p_versao, left(p_nome, 300), v_situacao, v_layout.adquirente_codigo, v_layout.adquirente_nome, v_layout.tipo,
          case when v_layout.id is null then null
               else coalesce(v_layout.adquirente_codigo, 'outra:' || lower(coalesce(app.maquininha_normalizar(v_layout.adquirente_nome), ''))) end,
          left(p_assinatura, 2000), p_cabecalho, p_amostra, v_layout.mapeamento, p_linhas, v_doc.enviado_por)
  on conflict (documento_id, versao) do update
     set nome_arquivo = excluded.nome_arquivo, assinatura = excluded.assinatura, cabecalho = excluded.cabecalho, amostra = excluded.amostra,
         linhas = excluded.linhas,
         situacao = case when public.maquininha_importacoes.situacao = 'importada' then 'importada' else excluded.situacao end,
         adquirente_codigo = coalesce(public.maquininha_importacoes.adquirente_codigo, excluded.adquirente_codigo),
         adquirente_nome = coalesce(public.maquininha_importacoes.adquirente_nome, excluded.adquirente_nome),
         tipo = coalesce(public.maquininha_importacoes.tipo, excluded.tipo),
         adquirente_chave = coalesce(public.maquininha_importacoes.adquirente_chave, excluded.adquirente_chave),
         -- Cabeçalho diferente do lido antes: as colunas conferidas não valem mais
         mapeamento = case when public.maquininha_importacoes.assinatura is distinct from excluded.assinatura then excluded.mapeamento
                           else coalesce(public.maquininha_importacoes.mapeamento, excluded.mapeamento) end,
         erro = null
  returning id, situacao into v_id, v_situacao;

  if v_situacao = 'na_fila' then
    perform app.enfileirar('importar_maquininha', jsonb_build_object('importacao_id', v_id), v_doc.empresa_id,
                           'maquininha:' || v_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 70);
  elsif v_situacao = 'aguardando_mapeamento' then
    perform app.notificar_equipe(v_doc.empresa_id, 'maquininha_relatorio', 'Relatório de maquininha para conferir',
      'Chegou um relatório de vendas em um formato novo. Confira as colunas uma vez e o portal aprende para as próximas.',
      '/e/' || v_doc.empresa_id::text || '/maquininhas/importacoes/' || v_id::text, false);
  end if;
  return jsonb_build_object('importacao_id', v_id, 'situacao', v_situacao);
end;
$$;

-- Formato da "Lista de Vendas" da Cielo em CSV, para todo o escritório
insert into public.maquininha_layouts (empresa_id, assinatura, adquirente_codigo, adquirente_nome, tipo, mapeamento)
values (null, 'data da venda|forma de pagamento|quantidade de vendas|valor bruto|valor taxa tarifa|valor liquido',
        'cielo', 'Cielo', 'cartao', '{"linhaCabecalho": 0, "data": 0, "modalidade": 1, "bandeira": null, "quantidade": 2, "bruto": 3, "taxa": 4, "liquido": 5, "taxa_percentual": null, "parcelas": null, "nsu": null, "autorizacao": null, "terminal": null, "previsao": null, "situacao": null}'::jsonb)
on conflict (empresa_id, assinatura) do nothing;
