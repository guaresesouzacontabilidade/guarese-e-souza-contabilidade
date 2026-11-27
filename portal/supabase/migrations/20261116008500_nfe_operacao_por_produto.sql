-- NF-e: regra fiscal própria do produto. Numa mesma nota, cada item pode sair
-- com a sua operação: a mercadoria que já veio com o ICMS retido pelo fornecedor
-- (substituição tributária, como a ração) sai com CFOP 5.405 e CSOSN 500, e o
-- resto da venda com a operação da nota (ex.: 5.102 e CSOSN 102/103).
--  * nfe_produtos.operacao_id: a operação própria do produto (vazio = a da nota);
--  * vale só na venda comum (finalidade 1) e para o mesmo destino da operação da
--    nota (dentro do estado, outro estado ou exterior); na devolução, no
--    complemento e no ajuste vale a operação escolhida na nota;
--  * CSOSN 500 (Simples) e CST 60 (regime normal): ICMS cobrado anteriormente
--    por substituição tributária, sem destaque de ICMS na nota.
-- Os dados da nota da empresa ficam do mesmo jeito: só muda a regra de cada item.

alter table public.nfe_operacoes drop constraint nfe_operacoes_icms_cst_check;
alter table public.nfe_operacoes add constraint nfe_operacoes_icms_cst_check
  check (icms_cst in ('00', '20', '40', '41', '50', '51', '60', '90', '101', '102', '103', '300', '400', '500', '900'));

alter table public.nfe_produtos add column operacao_id uuid references public.nfe_operacoes(id) on delete set null;
create index nfe_produtos_operacao_idx on public.nfe_produtos (operacao_id) where operacao_id is not null;

-- A operação própria precisa ser da mesma empresa, ligada e de venda
create or replace function app.nfe_operacao_do_produto(p_empresa_id uuid, p_operacao_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_operacao_id is null then
    return null;
  end if;
  if not exists (select 1 from public.nfe_operacoes where id = p_operacao_id and empresa_id = p_empresa_id and ativa and finalidade = 1) then
    raise exception 'Escolha uma operação de venda ligada desta empresa para a regra própria do produto.';
  end if;
  return p_operacao_id;
end;
$$;

create or replace function public.nfe_produto_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_operacao uuid;
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  v_operacao := app.nfe_operacao_do_produto(p_empresa_id, nullif(p_dados ->> 'operacao_id', '')::uuid);
  if p_id is null then
    insert into public.nfe_produtos (empresa_id, codigo, descricao, ncm, cest, gtin, unidade, peso_kg, valor_unitario, origem, ativo, operacao_id)
    values (p_empresa_id, trim(p_dados ->> 'codigo'), trim(p_dados ->> 'descricao'), regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
            nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
            upper(trim(p_dados ->> 'unidade')), nullif(p_dados ->> 'peso_kg', '')::numeric, nullif(p_dados ->> 'valor_unitario', '')::numeric,
            coalesce((p_dados ->> 'origem')::smallint, 0), coalesce((p_dados ->> 'ativo')::boolean, true), v_operacao)
    returning id into v_id;
  else
    update public.nfe_produtos
       set codigo = trim(p_dados ->> 'codigo'),
           descricao = trim(p_dados ->> 'descricao'),
           ncm = regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
           cest = nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''),
           gtin = nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
           unidade = upper(trim(p_dados ->> 'unidade')),
           peso_kg = nullif(p_dados ->> 'peso_kg', '')::numeric,
           valor_unitario = nullif(p_dados ->> 'valor_unitario', '')::numeric,
           origem = coalesce((p_dados ->> 'origem')::smallint, 0),
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true),
           operacao_id = case when p_dados ? 'operacao_id' then v_operacao else operacao_id end
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Produto não encontrado.';
    end if;
  end if;
  return v_id;
end;
$$;

-- Vários produtos de uma vez (ex.: todas as rações com ST); vazio = voltam à operação da nota
create or replace function public.nfe_produtos_definir_operacao(p_empresa_id uuid, p_operacao_id uuid, p_produtos uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operacao uuid;
  v_n integer;
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  if coalesce(cardinality(p_produtos), 0) = 0 then
    raise exception 'Marque ao menos um produto.';
  end if;
  if cardinality(p_produtos) > 5000 then
    raise exception 'Marque no máximo 5.000 produtos por vez.';
  end if;
  v_operacao := app.nfe_operacao_do_produto(p_empresa_id, p_operacao_id);
  update public.nfe_produtos set operacao_id = v_operacao
   where empresa_id = p_empresa_id and id = any (p_produtos) and operacao_id is distinct from v_operacao;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.nfe_operacao_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_crt smallint;
  v_cst text := p_dados ->> 'icms_cst';
  v_cclass text := nullif(p_dados ->> 'ibscbs_cclass_trib', '');
  v_contrib jsonb := app.nfe_contribuicoes_validas(p_dados -> 'contribuicoes');
  v_produtos int;
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  select crt into v_crt from public.nfe_config where empresa_id = p_empresa_id;
  if coalesce(v_crt, 3) in (1, 4) and v_cst not in ('101', '102', '103', '300', '400', '500', '900') then
    raise exception 'Empresa do Simples Nacional usa CSOSN (101, 102, 103, 300, 400, 500 ou 900) no ICMS.';
  end if;
  if coalesce(v_crt, 3) in (2, 3) and v_cst not in ('00', '20', '40', '41', '50', '51', '60', '90') then
    raise exception 'Empresa do regime normal usa CST (00, 20, 40, 41, 50, 51, 60 ou 90) no ICMS.';
  end if;
  if coalesce(v_crt, 3) = 3 and v_cclass is null then
    raise exception 'Escolha a classificação do IBS/CBS (obrigatória no regime normal desde 03/08/2026).';
  end if;
  if v_cclass is not null and not exists (select 1 from public.nfe_cclass_trib where cclass_trib = v_cclass) then
    raise exception 'Classificação do IBS/CBS não encontrada na tabela oficial.';
  end if;
  if p_id is not null and not exists (select 1 from public.nfe_operacoes where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Operação não encontrada.';
  end if;
  -- Regra própria de produtos: continua de venda e ligada (senão a nota desses produtos sairia errada)
  if p_id is not null then
    select count(*) into v_produtos from public.nfe_produtos where operacao_id = p_id and empresa_id = p_empresa_id;
    if v_produtos > 0 and coalesce((p_dados ->> 'finalidade')::smallint, 1) <> 1 then
      raise exception 'Esta operação é a regra fiscal própria de % produto(s): ela precisa continuar como venda (NF-e normal).', v_produtos;
    end if;
    if v_produtos > 0 and not coalesce((p_dados ->> 'ativa')::boolean, true) then
      raise exception 'Esta operação é a regra fiscal própria de % produto(s). Tire a regra desses produtos (Produtos) antes de desativar.', v_produtos;
    end if;
  end if;
  insert into public.nfe_operacoes as o (id, empresa_id, nome, natureza, finalidade, destino, consumidor_final, cfop, icms_cst, icms_aliquota, icms_reducao, icms_diferimento, icms_credito_sn, icms_beneficio, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, excluir_icms_pis_cofins, ibscbs_cclass_trib, ibscbs_diferimento, difal_metodo, difal_codigo_receita, icms_por_operacao, icms_codigo_receita, frete_icms_retido, frete_aliquota, frete_reducao, frete_cfop, frete_codigo_receita, incide_funrural, contribuicoes, informacoes, ativa)
  values (coalesce(p_id, gen_random_uuid()), p_empresa_id,
          trim(p_dados ->> 'nome'),
          trim(p_dados ->> 'natureza'),
          coalesce((p_dados ->> 'finalidade')::smallint, 1),
          p_dados ->> 'destino',
          coalesce((p_dados ->> 'consumidor_final')::boolean, false),
          regexp_replace(coalesce(p_dados ->> 'cfop', ''), '\D', '', 'g'),
          v_cst,
          nullif(p_dados ->> 'icms_aliquota', '')::numeric,
          nullif(p_dados ->> 'icms_reducao', '')::numeric,
          nullif(p_dados ->> 'icms_diferimento', '')::numeric,
          nullif(p_dados ->> 'icms_credito_sn', '')::numeric,
          nullif(upper(trim(p_dados ->> 'icms_beneficio')), ''),
          p_dados ->> 'pis_cst',
          nullif(p_dados ->> 'pis_aliquota', '')::numeric,
          p_dados ->> 'cofins_cst',
          nullif(p_dados ->> 'cofins_aliquota', '')::numeric,
          coalesce((p_dados ->> 'excluir_icms_pis_cofins')::boolean, true),
          v_cclass,
          nullif(p_dados ->> 'ibscbs_diferimento', '')::numeric,
          nullif(p_dados ->> 'difal_metodo', ''),
          nullif(trim(p_dados ->> 'difal_codigo_receita'), ''),
          coalesce((p_dados ->> 'icms_por_operacao')::boolean, false),
          nullif(trim(p_dados ->> 'icms_codigo_receita'), ''),
          coalesce((p_dados ->> 'frete_icms_retido')::boolean, false),
          nullif(p_dados ->> 'frete_aliquota', '')::numeric,
          nullif(p_dados ->> 'frete_reducao', '')::numeric,
          nullif(regexp_replace(coalesce(p_dados ->> 'frete_cfop', ''), '\D', '', 'g'), ''),
          nullif(trim(p_dados ->> 'frete_codigo_receita'), ''),
          coalesce((p_dados ->> 'incide_funrural')::boolean, false),
          v_contrib,
          nullif(trim(p_dados ->> 'informacoes'), ''),
          coalesce((p_dados ->> 'ativa')::boolean, true))
  on conflict (id) do update set
    nome = excluded.nome,
    natureza = excluded.natureza,
    finalidade = excluded.finalidade,
    destino = excluded.destino,
    consumidor_final = excluded.consumidor_final,
    cfop = excluded.cfop,
    icms_cst = excluded.icms_cst,
    icms_aliquota = excluded.icms_aliquota,
    icms_reducao = excluded.icms_reducao,
    icms_diferimento = excluded.icms_diferimento,
    icms_credito_sn = excluded.icms_credito_sn,
    icms_beneficio = excluded.icms_beneficio,
    pis_cst = excluded.pis_cst,
    pis_aliquota = excluded.pis_aliquota,
    cofins_cst = excluded.cofins_cst,
    cofins_aliquota = excluded.cofins_aliquota,
    excluir_icms_pis_cofins = excluded.excluir_icms_pis_cofins,
    ibscbs_cclass_trib = excluded.ibscbs_cclass_trib,
    ibscbs_diferimento = excluded.ibscbs_diferimento,
    difal_metodo = excluded.difal_metodo,
    difal_codigo_receita = excluded.difal_codigo_receita,
    icms_por_operacao = excluded.icms_por_operacao,
    icms_codigo_receita = excluded.icms_codigo_receita,
    frete_icms_retido = excluded.frete_icms_retido,
    frete_aliquota = excluded.frete_aliquota,
    frete_reducao = excluded.frete_reducao,
    frete_cfop = excluded.frete_cfop,
    frete_codigo_receita = excluded.frete_codigo_receita,
    incide_funrural = excluded.incide_funrural,
    contribuicoes = excluded.contribuicoes,
    informacoes = excluded.informacoes,
    ativa = excluded.ativa
  returning o.id into v_id;
  return v_id;
end;
$$;

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
  -- Regra fiscal de cada item: a própria do produto (ex.: mercadoria com ST) ou a da nota
  v_opi public.nfe_operacoes;
  v_cli public.nfe_cclass_trib;
  v_sn constant text[] := array['101', '102', '103', '300', '400', '500', '900'];
  v_infos text[] := '{}';
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

  -- Itens: dados do produto + regras da operação (a da nota ou a própria do produto)
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
    -- Regra fiscal própria do produto (ex.: mercadoria com ST: CFOP 5.405 e CSOSN 500) na
    -- venda comum; na devolução, no complemento e no ajuste vale a operação da nota.
    v_opi := v_op;
    v_cli := v_cl;
    if v_prod.operacao_id is not null and v_prod.operacao_id <> v_op.id and v_op.finalidade = 1 then
      select * into v_opi from public.nfe_operacoes where id = v_prod.operacao_id and empresa_id = p_empresa_id;
      if v_opi.id is null or not v_opi.ativa or v_opi.finalidade <> 1 then
        raise exception 'A regra fiscal própria do produto % foi desativada ou não é de venda. Fale com o escritório.', v_prod.descricao;
      end if;
      if v_opi.destino <> v_op.destino then
        raise exception 'O produto % tem regra fiscal própria (operação "%") só para venda %. Emita este produto em outra nota ou fale com o escritório.',
          v_prod.descricao, v_opi.nome, case v_opi.destino when 'interna' then 'dentro do estado' when 'interestadual' then 'para outro estado' else 'para o exterior' end;
      end if;
      if v_simples <> (v_opi.icms_cst = any (v_sn)) then
        raise exception 'O ICMS da operação "%" (regra própria do produto %) não combina com o regime da empresa na configuração. Fale com o escritório.', v_opi.nome, v_prod.descricao;
      end if;
      select * into v_cli from public.nfe_cclass_trib where cclass_trib = v_opi.ibscbs_cclass_trib;
      if v_cfg.crt = 3 and v_cli.cclass_trib is null then
        raise exception 'A operação "%" (regra própria do produto %) está sem a classificação do IBS/CBS (obrigatória no regime normal). Fale com o escritório.', v_opi.nome, v_prod.descricao;
      end if;
      if nullif(trim(v_opi.informacoes), '') is not null and trim(v_opi.informacoes) <> coalesce(trim(v_op.informacoes), '') and not (trim(v_opi.informacoes) = any (v_infos)) then
        v_infos := v_infos || trim(v_opi.informacoes);
      end if;
    end if;
    v_total := v_total + round(v_q * v_v, 2);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'codigo', v_prod.codigo,
      'descricao', coalesce(nullif(trim(it ->> 'descricao'), ''), v_prod.descricao),
      'ncm', v_prod.ncm,
      'cest', v_prod.cest,
      'gtin', v_prod.gtin,
      'cfop', v_opi.cfop,
      'unidade', v_prod.unidade,
      'quantidade', trim(trailing '.' from trim(trailing '0' from to_char(v_q, 'FM99999999990.0000'))),
      'valorUnitario', trim(trailing '.' from trim(trailing '0' from to_char(v_v, 'FM99999999990.0000000000'))),
      'pesoKgUnidade', v_prod.peso_kg::text,
      'origem', v_prod.origem::text,
      'icms', jsonb_build_object(
        'cst', v_opi.icms_cst, 'aliquota', v_opi.icms_aliquota, 'reducaoBase', v_opi.icms_reducao, 'diferimento', v_opi.icms_diferimento,
        'creditoSimples', v_opi.icms_credito_sn, 'beneficio', v_opi.icms_beneficio),
      'pis', jsonb_build_object('cst', v_opi.pis_cst, 'aliquota', v_opi.pis_aliquota),
      'cofins', jsonb_build_object('cst', v_opi.cofins_cst, 'aliquota', v_opi.cofins_aliquota),
      'ibscbs', case when v_cli.cclass_trib is not null then jsonb_build_object(
        'cst', v_cli.cst, 'classificacao', v_cli.cclass_trib, 'reducaoIbs', v_cli.p_red_ibs, 'reducaoCbs', v_cli.p_red_cbs,
        'diferimento', v_opi.ibscbs_diferimento) end,
      'excluirIcmsPisCofins', v_opi.excluir_icms_pis_cofins,
      'operacao', case when v_opi.id <> v_op.id then v_opi.nome end,
      'informacoes', nullif(trim(it ->> 'informacoes'), '')
    ));
  end loop;
  if v_simples <> (v_op.icms_cst = any (v_sn)) then
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
  v_info := nullif(concat_ws(' ', nullif(trim(v_op.informacoes), ''), nullif(array_to_string(v_infos, ' '), ''), nullif(trim(v_cfg.informacoes_padrao), ''),
                             nullif(trim(p_dados ->> 'informacoes'), '')), '');
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

revoke execute on function app.nfe_operacao_do_produto(uuid, uuid), app.nfe_montar_dados(uuid, jsonb) from public, anon, authenticated;
grant execute on function app.nfe_montar_dados(uuid, jsonb) to service_role;
revoke execute on function public.nfe_produto_salvar(uuid, uuid, jsonb), public.nfe_operacao_salvar(uuid, uuid, jsonb),
  public.nfe_produtos_definir_operacao(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.nfe_produto_salvar(uuid, uuid, jsonb), public.nfe_operacao_salvar(uuid, uuid, jsonb),
  public.nfe_produtos_definir_operacao(uuid, uuid, uuid[]) to authenticated;
