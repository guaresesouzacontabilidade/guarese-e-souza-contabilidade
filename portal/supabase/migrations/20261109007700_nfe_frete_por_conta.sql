-- NF-e: o ICMS do frete retido pelo vendedor (grupo retTransp) só entra na nota
-- quando o vendedor contrata o frete (modalidade 0, CIF). Com o frete por conta
-- do comprador (FOB) ou de terceiros, quem contrata o transporte é que responde
-- pelo imposto: a nota sai sem o ICMS do frete, a não ser que quem emite marque
-- que o vendedor vai recolher mesmo assim. Transporte próprio e "sem frete" não
-- têm serviço de transporte contratado. A função é a mesma de antes, só com
-- essa regra.

create or replace function app.nfe_montar_dados(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfe_config;
  v_emp public.empresas;
  v_emi public.nfe_emitentes;
  v_op public.nfe_operacoes;
  v_dest public.nfe_destinatarios;
  v_tr public.nfe_transportadores;
  v_cl public.nfe_cclass_trib;
  v_esc public.escritorio;
  v_uf_emi text;
  v_mun_emi text;
  v_uf_dest text;
  v_mun_dest text;
  v_itens jsonb := '[]'::jsonb;
  it jsonb;
  v_prod public.nfe_produtos;
  v_q numeric;
  v_v numeric;
  v_total numeric := 0;
  v_difal jsonb;
  v_icms_uf public.icms_uf;
  v_frete_serv numeric := nullif(p_dados #>> '{transporte,frete_servico}', '')::numeric;
  v_modalidade int := coalesce((p_dados #>> '{transporte,modalidade}')::int, 9);
  v_reter_frete boolean := false;
  v_simples boolean;
  v_refs jsonb;
  v_parcelas jsonb;
  v_info text;
  v_placa text;
begin
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id;
  select * into v_emp from public.empresas where id = p_empresa_id;
  select * into v_emi from public.nfe_emitentes where id = (p_dados ->> 'emitente_id')::uuid and empresa_id = p_empresa_id and ativo;
  if v_emi.id is null then
    raise exception 'Escolha a inscrição estadual (estabelecimento ou propriedade) que emite a nota.';
  end if;
  select * into v_op from public.nfe_operacoes where id = (p_dados ->> 'operacao_id')::uuid and empresa_id = p_empresa_id and ativa;
  if v_op.id is null then
    raise exception 'Escolha uma das operações cadastradas pelo escritório.';
  end if;
  select * into v_dest from public.nfe_destinatarios where id = (p_dados ->> 'destinatario_id')::uuid and empresa_id = p_empresa_id;
  if v_dest.id is null then
    raise exception 'Escolha o cliente (comprador).';
  end if;
  if v_dest.tipo = 'cnpj' and v_dest.documento = v_emp.documento and v_op.finalidade = 1 then
    raise exception 'O comprador não pode ser a própria empresa.';
  end if;
  select uf, nome into v_uf_emi, v_mun_emi from public.municipios where ibge = v_emi.municipio_ibge;
  if v_dest.tipo = 'estrangeiro' then
    v_uf_dest := 'EX';
  else
    select uf, nome into v_uf_dest, v_mun_dest from public.municipios where ibge = v_dest.municipio_ibge;
  end if;
  if v_op.destino = 'interna' and v_uf_dest <> v_uf_emi then
    raise exception 'A operação "%" é para dentro do estado, mas o cliente é de %.', v_op.nome, v_uf_dest;
  end if;
  if v_op.destino = 'interestadual' and (v_uf_dest = v_uf_emi or v_uf_dest = 'EX') then
    raise exception 'A operação "%" é para outro estado, mas o cliente é de %.', v_op.nome, v_uf_dest;
  end if;
  if v_op.destino = 'exterior' and v_uf_dest <> 'EX' then
    raise exception 'A operação "%" é para o exterior: escolha um cliente estrangeiro.', v_op.nome;
  end if;
  v_simples := v_cfg.crt in (1, 4);
  if v_op.ibscbs_cclass_trib is not null then
    select * into v_cl from public.nfe_cclass_trib where cclass_trib = v_op.ibscbs_cclass_trib;
  end if;

  -- Itens: dados do produto + regras da operação
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Inclua ao menos um produto.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 990 then
    raise exception 'A NF-e aceita no máximo 990 itens.';
  end if;
  for it in select * from jsonb_array_elements(p_dados -> 'itens') loop
    select * into v_prod from public.nfe_produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id and ativo;
    if v_prod.id is null then
      raise exception 'Escolha um dos produtos cadastrados.';
    end if;
    v_q := nullif(it ->> 'quantidade', '')::numeric;
    v_v := nullif(it ->> 'valor_unitario', '')::numeric;
    if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) or v_q >= 100000000000 then
      raise exception 'Quantidade inválida no produto % (até 4 casas decimais).', v_prod.descricao;
    end if;
    if v_v is null or v_v <= 0 or v_v <> round(v_v, 10) or v_v >= 100000000000 then
      raise exception 'Preço inválido no produto %.', v_prod.descricao;
    end if;
    v_total := v_total + round(v_q * v_v, 2);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'codigo', v_prod.codigo,
      'descricao', coalesce(nullif(trim(it ->> 'descricao'), ''), v_prod.descricao),
      'ncm', v_prod.ncm,
      'cest', v_prod.cest,
      'gtin', v_prod.gtin,
      'cfop', v_op.cfop,
      'unidade', v_prod.unidade,
      'quantidade', trim(trailing '.' from trim(trailing '0' from to_char(v_q, 'FM99999999990.0000'))),
      'valorUnitario', trim(trailing '.' from trim(trailing '0' from to_char(v_v, 'FM99999999990.0000000000'))),
      'pesoKgUnidade', v_prod.peso_kg::text,
      'origem', v_prod.origem::text,
      'icms', jsonb_build_object(
        'cst', v_op.icms_cst, 'aliquota', v_op.icms_aliquota, 'reducaoBase', v_op.icms_reducao, 'diferimento', v_op.icms_diferimento,
        'creditoSimples', v_op.icms_credito_sn, 'beneficio', v_op.icms_beneficio),
      'pis', jsonb_build_object('cst', v_op.pis_cst, 'aliquota', v_op.pis_aliquota),
      'cofins', jsonb_build_object('cst', v_op.cofins_cst, 'aliquota', v_op.cofins_aliquota),
      'ibscbs', case when v_cl.cclass_trib is not null then jsonb_build_object(
        'cst', v_cl.cst, 'classificacao', v_cl.cclass_trib, 'reducaoIbs', v_cl.p_red_ibs, 'reducaoCbs', v_cl.p_red_cbs,
        'diferimento', v_op.ibscbs_diferimento) end,
      'excluirIcmsPisCofins', v_op.excluir_icms_pis_cofins,
      'informacoes', nullif(trim(it ->> 'informacoes'), '')
    ));
  end loop;
  if (v_simples and v_op.icms_cst not in ('101', '102', '103', '300', '400', '900')) or (not v_simples and v_op.icms_cst in ('101', '102', '103', '300', '400', '900')) then
    raise exception 'O ICMS da operação "%" não combina com o regime da empresa na configuração. Fale com o escritório.', v_op.nome;
  end if;
  if v_cfg.crt = 3 and v_cl.cclass_trib is null then
    raise exception 'A operação "%" está sem a classificação do IBS/CBS (obrigatória no regime normal). Fale com o escritório.', v_op.nome;
  end if;
  v_total := v_total + coalesce(nullif(p_dados ->> 'frete', '')::numeric, 0) + coalesce(nullif(p_dados ->> 'seguro', '')::numeric, 0)
             + coalesce(nullif(p_dados ->> 'outras', '')::numeric, 0) - coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0);
  if v_total < 0 then
    raise exception 'O desconto é maior que o valor da nota.';
  end if;

  -- DIFAL: venda a não contribuinte de outro estado (alíquota interna e FCP da tabela "ICMS por estado")
  if v_op.difal_metodo is not null and v_dest.indicador_ie = 9 and v_op.destino = 'interestadual' then
    select * into v_icms_uf from public.icms_uf where uf = v_uf_dest;
    if v_icms_uf.aliquota_interna is null then
      raise exception 'A alíquota interna do ICMS de % não está cadastrada (ICMS por estado). Fale com o escritório.', v_uf_dest;
    end if;
    v_difal := jsonb_build_object('metodo', v_op.difal_metodo, 'aliquotaInterna', v_icms_uf.aliquota_interna, 'fcp', coalesce(v_icms_uf.fcp, 0));
  end if;

  -- ICMS do frete retido pelo vendedor só quando ele contrata o frete (CIF). Frete por conta
  -- do comprador ou de terceiros: só se quem emite marcar que vai recolher mesmo assim.
  -- Transporte próprio ou sem frete: não há serviço de transporte contratado.
  v_reter_frete := v_op.frete_icms_retido and (v_modalidade = 0
    or (v_modalidade in (1, 2, 4) and coalesce((p_dados #>> '{transporte,reter_icms_frete}')::boolean, false)));
  if v_reter_frete and (v_frete_serv is null or v_frete_serv <= 0) then
    raise exception 'A operação "%" retém o ICMS do frete: informe o valor do frete contratado.', v_op.nome;
  end if;
  if (p_dados #>> '{transporte,transportador_id}') is not null then
    select * into v_tr from public.nfe_transportadores where id = (p_dados #>> '{transporte,transportador_id}')::uuid and empresa_id = p_empresa_id;
    if v_tr.id is null then
      raise exception 'Transportador não encontrado.';
    end if;
  end if;
  v_placa := nullif(upper(regexp_replace(coalesce(p_dados #>> '{transporte,placa}', v_tr.placa, ''), '[^0-9A-Za-z]', '', 'g')), '');

  v_refs := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(p_dados -> 'referencias', '[]'::jsonb)) x where x ~ '^[0-9]{44}$'), '[]'::jsonb);
  if v_op.finalidade = 4 and jsonb_array_length(v_refs) = 0 then
    raise exception 'Informe a chave de acesso da nota que está sendo devolvida.';
  end if;
  v_parcelas := case when coalesce((p_dados #>> '{pagamento,a_prazo}')::boolean, false) then coalesce(p_dados #> '{pagamento,parcelas}', '[]'::jsonb) else '[]'::jsonb end;
  v_info := nullif(concat_ws(' ', nullif(trim(v_op.informacoes), ''), nullif(trim(v_cfg.informacoes_padrao), ''), nullif(trim(p_dados ->> 'informacoes'), '')), '');
  select * into v_esc from public.escritorio where id = 1;

  return jsonb_build_object(
    'natureza', v_op.natureza,
    'finalidade', v_op.finalidade,
    'consumidorFinal', v_op.consumidor_final,
    'presenca', v_cfg.presenca,
    'referencias', v_refs,
    'emitente', jsonb_build_object(
      'tipo', case when v_emp.tipo_pessoa = 'PF' then 'cpf' else 'cnpj' end,
      'documento', v_emp.documento,
      'nome', v_emp.razao_social,
      'fantasia', v_emp.nome_fantasia,
      'endereco', jsonb_build_object('logradouro', v_emi.logradouro, 'numero', v_emi.numero, 'complemento', v_emi.complemento, 'bairro', v_emi.bairro,
                                     'codigoMunicipio', v_emi.municipio_ibge, 'municipio', v_mun_emi, 'uf', v_uf_emi, 'cep', v_emi.cep, 'telefone', v_emi.telefone),
      'inscricaoEstadual', v_emi.inscricao_estadual,
      'crt', v_cfg.crt),
    'destinatario', jsonb_build_object(
      'tipo', v_dest.tipo, 'documento', v_dest.documento, 'nome', v_dest.nome,
      'endereco', jsonb_build_object('logradouro', v_dest.logradouro, 'numero', v_dest.numero, 'complemento', v_dest.complemento, 'bairro', v_dest.bairro,
                                     'codigoMunicipio', coalesce(v_dest.municipio_ibge, '9999999'), 'municipio', coalesce(v_mun_dest, v_dest.cidade_exterior, 'EXTERIOR'),
                                     'uf', v_uf_dest, 'cep', v_dest.cep, 'telefone', v_dest.telefone, 'codigoPais', v_dest.codigo_pais, 'pais', v_dest.pais),
      'indicadorIe', v_dest.indicador_ie, 'inscricaoEstadual', v_dest.inscricao_estadual, 'email', v_dest.email),
    'itens', v_itens,
    'frete', nullif(p_dados ->> 'frete', ''),
    'seguro', nullif(p_dados ->> 'seguro', ''),
    'outras', nullif(p_dados ->> 'outras', ''),
    'desconto', nullif(p_dados ->> 'desconto', ''),
    'transporte', jsonb_build_object(
      'modalidade', v_modalidade,
      'transportador', case when v_tr.id is not null then jsonb_build_object(
        'tipo', v_tr.tipo, 'documento', v_tr.documento, 'nome', v_tr.nome, 'inscricaoEstadual', v_tr.inscricao_estadual,
        'endereco', v_tr.endereco, 'municipio', v_tr.municipio, 'uf', v_tr.uf) end,
      'veiculo', case when v_placa is not null then jsonb_build_object(
        'placa', v_placa, 'uf', coalesce(nullif(upper(p_dados #>> '{transporte,placa_uf}'), ''), v_tr.placa_uf),
        'rntc', coalesce(nullif(p_dados #>> '{transporte,rntc}', ''), v_tr.rntc)) end,
      'volumes', jsonb_build_object('quantidade', nullif(p_dados #>> '{transporte,volumes_quantidade}', '')::numeric,
                                    'especie', nullif(trim(p_dados #>> '{transporte,especie}'), ''), 'marca', nullif(trim(p_dados #>> '{transporte,marca}'), '')),
      'icmsFrete', case when v_reter_frete then jsonb_build_object(
        'valorServico', v_frete_serv::text, 'reducaoBase', v_op.frete_reducao, 'aliquota', v_op.frete_aliquota, 'cfop', v_op.frete_cfop,
        'codigoMunicipio', v_emi.municipio_ibge) end),
    'pagamento', jsonb_build_object(
      'forma', coalesce(nullif(p_dados #>> '{pagamento,forma}', ''), '90'),
      'descricao', nullif(trim(p_dados #>> '{pagamento,descricao}'), ''),
      'aPrazo', coalesce((p_dados #>> '{pagamento,a_prazo}')::boolean, false),
      'parcelas', v_parcelas),
    'difal', v_difal,
    'funrural', case when v_op.incide_funrural and v_cfg.funrural_percentual > 0 then
      jsonb_build_object('percentual', v_cfg.funrural_percentual, 'modo', v_cfg.funrural_modo) end,
    'contribuicoes', v_op.contribuicoes,
    'icmsPorOperacao', v_op.icms_por_operacao,
    'codigosReceita', jsonb_build_object('icms_operacao', v_op.icms_codigo_receita, 'icms_frete', v_op.frete_codigo_receita,
                                         'difal', v_op.difal_codigo_receita, 'fcp_difal', v_op.difal_codigo_receita),
    'informacoesComplementares', v_info,
    'responsavelTecnico', case when v_esc.cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$' and v_esc.email is not null and regexp_replace(coalesce(v_esc.telefone, ''), '\D', '', 'g') ~ '^[0-9]{6,14}$'
      then jsonb_build_object('cnpj', v_esc.cnpj, 'contato', v_esc.razao_social, 'email', v_esc.email, 'telefone', regexp_replace(v_esc.telefone, '\D', '', 'g')) end,
    'autorizadosXml', case when v_cfg.autorizar_escritorio_xml and v_esc.cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$' then jsonb_build_array(v_esc.cnpj) else '[]'::jsonb end,
    'pedidoCompra', nullif(trim(p_dados ->> 'pedido_compra'), ''),
    '_resumo', jsonb_build_object('valor_total', round(v_total, 2), 'destinatario_nome', v_dest.nome, 'destinatario_documento', v_dest.documento,
                                  'destinatario_uf', case when v_uf_dest = 'EX' then null else v_uf_dest end)
  );
end;
$$;

revoke execute on function app.nfe_montar_dados(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.nfe_montar_dados(uuid, jsonb) to service_role;
