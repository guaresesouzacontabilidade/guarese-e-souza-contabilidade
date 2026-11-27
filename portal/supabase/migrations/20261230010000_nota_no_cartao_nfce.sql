-- =============================================================================
-- Nota fiscal na venda: cupom fiscal (NFC-e) e NF-e
--
--  1. Operações: cada operação serve para Nota fiscal (NF-e), Cupom fiscal
--     (NFC-e) ou as duas. O cupom é só venda presencial a consumidor final
--     dentro do estado (CFOP 5.xxx), sem GTA e sem ICMS de frete retido.
--  2. Loja: a operação do cupom, o documento que o caixa já deixa escolhido e
--     a regra "exigir nota no cartão" (crédito e/ou débito), que só o
--     escritório liga ou desliga. A venda guarda o documento pedido; com a
--     regra ligada, o banco recusa venda no cartão sem nota.
--  3. NFC-e (modelo 65): série e numeração próprias em cada inscrição,
--     ligada pelo escritório (homologação ou produção) e enviada pela mesma
--     fila, assinatura e certificado da NF-e. QR Code versão 3 (NT 2025.001):
--     a emissão normal não usa CSC.
--  4. Quem vende no caixa emite a nota daquela venda (só dela, com a inscrição
--     e a operação escolhidas na loja), sem ganhar acesso às outras notas.
-- =============================================================================

create function pg_temp.trocar_no_corpo(p_funcao regprocedure, p_de text, p_para text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_funcao);
begin
  if position(p_de in v_def) = 0 then
    raise exception 'Trecho não encontrado em %: %', p_funcao, p_de;
  end if;
  execute replace(v_def, p_de, p_para);
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Operações: Nota fiscal e/ou Cupom fiscal
-- -----------------------------------------------------------------------------
alter table public.nfe_operacoes
  add column modelos text[] not null default array['nfe']::text[]
    check (cardinality(modelos) between 1 and 2 and modelos <@ array['nfe', 'nfce']::text[]);
alter table public.nfe_operacoes add constraint nfe_operacoes_nfce check (
  not ('nfce' = any (modelos))
  or (destino = 'interna' and consumidor_final and finalidade = 1 and cfop like '5%' and not exige_gta and not frete_icms_retido)
);

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
  v_modelos text[];
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

  -- Para qual documento a operação serve (sem a informação, fica como estava; nova: NF-e)
  if p_dados ? 'modelos' then
    if jsonb_typeof(p_dados -> 'modelos') <> 'array' then
      raise exception 'Marque se a operação serve para Nota fiscal (NF-e), Cupom fiscal (NFC-e) ou as duas.';
    end if;
    v_modelos := array(select distinct x from jsonb_array_elements_text(p_dados -> 'modelos') x order by 1);
  else
    v_modelos := coalesce((select modelos from public.nfe_operacoes where id = p_id), array['nfe']::text[]);
  end if;
  if cardinality(v_modelos) = 0 or not (v_modelos <@ array['nfe', 'nfce']::text[]) then
    raise exception 'Marque se a operação serve para Nota fiscal (NF-e), Cupom fiscal (NFC-e) ou as duas.';
  end if;
  if 'nfce' = any (v_modelos) and (
       p_dados ->> 'destino' is distinct from 'interna'
       or not coalesce((p_dados ->> 'consumidor_final')::boolean, false)
       or coalesce((p_dados ->> 'finalidade')::smallint, 1) <> 1
       or regexp_replace(coalesce(p_dados ->> 'cfop', ''), '\D', '', 'g') !~ '^5'
       or coalesce((p_dados ->> 'exige_gta')::boolean, false)
       or coalesce((p_dados ->> 'frete_icms_retido')::boolean, false)) then
    raise exception 'O cupom fiscal (NFC-e) é só para venda dentro do estado a consumidor final (CFOP 5.xxx, finalidade normal), sem GTA e sem ICMS de frete retido.';
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
    -- A operação escolhida na loja continua servindo para o documento de lá
    if not ('nfe' = any (v_modelos)) and exists (select 1 from public.gestao_config g where g.empresa_id = p_empresa_id and g.nfe_operacao_id = p_id) then
      raise exception 'Esta é a operação da NF-e nas configurações da loja. Troque lá antes de tirar a opção Nota fiscal.';
    end if;
    if not ('nfce' = any (v_modelos)) and exists (select 1 from public.gestao_config g where g.empresa_id = p_empresa_id and g.nfce_operacao_id = p_id) then
      raise exception 'Esta é a operação do cupom fiscal nas configurações da loja. Troque lá antes de tirar a opção Cupom fiscal.';
    end if;
  end if;
  insert into public.nfe_operacoes as o (id, empresa_id, nome, natureza, finalidade, destino, consumidor_final, cfop, icms_cst, icms_aliquota, icms_reducao, icms_diferimento, icms_credito_sn, icms_beneficio, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, excluir_icms_pis_cofins, ibscbs_cclass_trib, ibscbs_diferimento, difal_metodo, difal_codigo_receita, icms_por_operacao, icms_codigo_receita, frete_icms_retido, frete_aliquota, frete_reducao, frete_cfop, frete_codigo_receita, incide_funrural, contribuicoes, informacoes, ativa, exige_gta, modelos)
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
          coalesce((p_dados ->> 'ativa')::boolean, true),
          coalesce((p_dados ->> 'exige_gta')::boolean, false),
          v_modelos)
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
    ativa = excluded.ativa,
    exige_gta = excluded.exige_gta,
    modelos = excluded.modelos
  returning o.id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Série e numeração do cupom em cada inscrição; emissão do cupom ligada
--    pelo escritório
-- -----------------------------------------------------------------------------
alter table public.nfe_emitentes
  add column nfce_serie integer check (nfce_serie is null or nfce_serie between 0 and 969),
  add column nfce_proximo_numero_homologacao bigint not null default 1
    check (nfce_proximo_numero_homologacao between 1 and 999999999),
  add column nfce_proximo_numero_producao bigint not null default 1
    check (nfce_proximo_numero_producao between 1 and 999999999);
create unique index nfe_emitentes_nfce_serie_uk on public.nfe_emitentes (empresa_id, nfce_serie) where nfce_serie is not null;

create or replace function public.nfe_emitente_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_emp public.empresas;
  v_serie int := (p_dados ->> 'serie')::int;
  v_nfce int := nullif(p_dados ->> 'nfce_serie', '')::int;
  v_mun text := p_dados ->> 'municipio_ibge';
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  if v_emp.tipo_pessoa = 'PF' and (v_serie is null or v_serie not between 920 and 969) then
    raise exception 'Produtor rural pessoa física emite NF-e nas séries 920 a 969.';
  end if;
  if v_emp.tipo_pessoa = 'PJ' and (v_serie is null or v_serie not between 0 and 889) then
    raise exception 'Série da NF-e inválida (0 a 889).';
  end if;
  if v_nfce is not null and v_emp.tipo_pessoa = 'PF' and v_nfce not between 920 and 969 then
    raise exception 'Produtor rural pessoa física emite o cupom fiscal (NFC-e) nas séries 920 a 969.';
  end if;
  if v_nfce is not null and v_emp.tipo_pessoa = 'PJ' and v_nfce not between 0 and 889 then
    raise exception 'Série do cupom fiscal (NFC-e) inválida (0 a 889).';
  end if;
  if not exists (select 1 from public.municipios where ibge = v_mun) then
    raise exception 'Município não encontrado.';
  end if;
  if v_nfce is not null and exists (select 1 from public.nfe_emitentes where empresa_id = p_empresa_id and nfce_serie = v_nfce and id is distinct from p_id) then
    raise exception 'Outra inscrição desta empresa já usa a série % do cupom fiscal.', v_nfce;
  end if;
  if p_id is null then
    insert into public.nfe_emitentes (empresa_id, nome, inscricao_estadual, logradouro, numero, complemento, bairro, municipio_ibge, cep, telefone, serie,
                                      proximo_numero_homologacao, proximo_numero_producao, ativo,
                                      nfce_serie, nfce_proximo_numero_homologacao, nfce_proximo_numero_producao)
    values (p_empresa_id, trim(p_dados ->> 'nome'), regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'),
            trim(p_dados ->> 'logradouro'), trim(p_dados ->> 'numero'), nullif(trim(p_dados ->> 'complemento'), ''), trim(p_dados ->> 'bairro'),
            v_mun, regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'),
            nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''), v_serie,
            coalesce((p_dados ->> 'proximo_numero_homologacao')::bigint, 1), coalesce((p_dados ->> 'proximo_numero_producao')::bigint, 1),
            coalesce((p_dados ->> 'ativo')::boolean, true),
            v_nfce, coalesce(nullif(p_dados ->> 'nfce_proximo_numero_homologacao', '')::bigint, 1),
            coalesce(nullif(p_dados ->> 'nfce_proximo_numero_producao', '')::bigint, 1))
    returning id into v_id;
  else
    update public.nfe_emitentes
       set nome = trim(p_dados ->> 'nome'),
           inscricao_estadual = regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'),
           logradouro = trim(p_dados ->> 'logradouro'),
           numero = trim(p_dados ->> 'numero'),
           complemento = nullif(trim(p_dados ->> 'complemento'), ''),
           bairro = trim(p_dados ->> 'bairro'),
           municipio_ibge = v_mun,
           cep = regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'),
           telefone = nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
           serie = v_serie,
           -- A numeração só anda para a frente (números já usados não voltam)
           proximo_numero_homologacao = greatest(proximo_numero_homologacao, coalesce((p_dados ->> 'proximo_numero_homologacao')::bigint, 1)),
           proximo_numero_producao = greatest(proximo_numero_producao, coalesce((p_dados ->> 'proximo_numero_producao')::bigint, 1)),
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true),
           -- Série do cupom: sem a informação, fica como estava; trocar de série recomeça a numeração dela
           nfce_serie = case when p_dados ? 'nfce_serie' then v_nfce else nfce_serie end,
           nfce_proximo_numero_homologacao = case
             when p_dados ? 'nfce_serie' and v_nfce is distinct from nfce_serie then coalesce(nullif(p_dados ->> 'nfce_proximo_numero_homologacao', '')::bigint, 1)
             else greatest(nfce_proximo_numero_homologacao, coalesce(nullif(p_dados ->> 'nfce_proximo_numero_homologacao', '')::bigint, 1)) end,
           nfce_proximo_numero_producao = case
             when p_dados ? 'nfce_serie' and v_nfce is distinct from nfce_serie then coalesce(nullif(p_dados ->> 'nfce_proximo_numero_producao', '')::bigint, 1)
             else greatest(nfce_proximo_numero_producao, coalesce(nullif(p_dados ->> 'nfce_proximo_numero_producao', '')::bigint, 1)) end
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Inscrição não encontrada.';
    end if;
  end if;
  return v_id;
end;
$$;

alter table public.nfe_config
  add column nfce_ativa boolean not null default false,
  add column nfce_ambiente text not null default 'homologacao' check (nfce_ambiente in ('homologacao', 'producao'));
alter table public.nfe_config add constraint nfe_config_nfce_ativa_completa
  check (not nfce_ativa or (autorizacao_texto is not null and autorizado_em is not null));

-- Liga ou desliga o cupom fiscal (só o escritório): a empresa precisa estar
-- credenciada para a NFC-e na SEFAZ do estado; o portal usa o mesmo
-- certificado e a mesma autorização do cliente da NF-e.
create function public.nfce_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfe_config;
  v_ativa boolean;
  v_amb text;
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id for update;
  if v_cfg.empresa_id is null then
    raise exception 'Configure antes a emissão de NF-e desta empresa (regime, certificado e autorização do cliente).';
  end if;
  v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_cfg.nfce_ativa);
  v_amb := coalesce(nullif(p_dados ->> 'ambiente', ''), v_cfg.nfce_ambiente);
  if v_amb not in ('homologacao', 'producao') then
    raise exception 'Ambiente inválido.';
  end if;
  if v_ativa then
    if v_cfg.autorizacao_texto is null or v_cfg.autorizado_em is null then
      raise exception 'Registre antes que o cliente autorizou o portal a emitir notas com o certificado da empresa (Emissão de NF-e).';
    end if;
    if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
      raise exception 'A empresa não tem certificado digital válido.';
    end if;
    if not exists (select 1 from public.nfe_emitentes e where e.empresa_id = p_empresa_id and e.ativo and e.nfce_serie is not null) then
      raise exception 'Informe a série do cupom fiscal (NFC-e) em pelo menos uma inscrição que emite.';
    end if;
  end if;
  update public.nfe_config set nfce_ativa = v_ativa, nfce_ambiente = v_amb, atualizado_por = auth.uid() where empresa_id = p_empresa_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Notas emitidas: modelo (55 NF-e, 65 NFC-e) e link do QR Code do cupom
-- -----------------------------------------------------------------------------
alter table public.nfe_emissoes
  add column modelo smallint not null default 55 check (modelo in (55, 65)),
  add column qrcode text check (qrcode is null or length(qrcode) <= 1000);
alter table public.nfe_emissoes drop constraint nfe_emissoes_numero_uk;
alter table public.nfe_emissoes add constraint nfe_emissoes_numero_uk unique (empresa_id, ambiente, modelo, serie, numero);

-- -----------------------------------------------------------------------------
-- 4. Loja: operação do cupom, documento padrão e a regra do cartão
-- -----------------------------------------------------------------------------
alter table public.gestao_config
  add column nfce_operacao_id uuid references public.nfe_operacoes (id) on delete set null,
  add column documento_padrao text not null default 'nfe' check (documento_padrao in ('nfe', 'nfce')),
  add column nota_obrigatoria_formas text[] not null default '{}'::text[]
    check (nota_obrigatoria_formas <@ array['cartao_credito', 'cartao_debito']::text[]);
alter table public.vendas
  add column documento_fiscal text check (documento_fiscal is null or documento_fiscal in ('nfe', 'nfce'));

create or replace function public.gestao_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_equipe boolean := app.e_equipe_da_empresa(p_empresa_id);
  v_atual public.gestao_config;
  v_ativa boolean;
  v_perfil text;
  v_modalidade text;
  v_desc numeric := nullif(p_dados ->> 'desconto_maximo_operador', '')::numeric;
  v_dinheiro uuid := nullif(p_dados ->> 'conta_dinheiro_id', '')::uuid;
  v_pix uuid := nullif(p_dados ->> 'conta_pix_id', '')::uuid;
  v_cartao uuid := nullif(p_dados ->> 'conta_cartao_id', '')::uuid;
  v_nfe_op uuid;
  v_nfe_emit uuid;
  v_nfce_op uuid;
  v_doc text;
  v_formas text[];
begin
  select * into v_atual from public.gestao_config where empresa_id = p_empresa_id;
  if v_equipe then
    v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_atual.ativa, false);
    v_perfil := coalesce(nullif(p_dados ->> 'perfil_fiscal', ''), v_atual.perfil_fiscal, 'comercio');
    v_modalidade := coalesce(nullif(p_dados ->> 'modalidade', ''), v_atual.modalidade, 'loja');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
    v_ativa := v_atual.ativa;
    v_perfil := v_atual.perfil_fiscal;
    v_modalidade := v_atual.modalidade;
  end if;
  if v_modalidade not in ('loja', 'notas', 'hotel', 'veterinaria', 'fisioterapia') then
    raise exception 'Escolha a modalidade: loja completa, notas e transporte, hotel, clínica veterinária ou clínica de fisioterapia.';
  end if;

  -- Regra do escritório: exigir nota fiscal na venda no cartão (crédito e/ou débito)
  v_formas := coalesce(v_atual.nota_obrigatoria_formas, '{}'::text[]);
  if p_dados ? 'nota_obrigatoria_formas' then
    if jsonb_typeof(p_dados -> 'nota_obrigatoria_formas') <> 'array' then
      raise exception 'Formas de pagamento inválidas.';
    end if;
    if array(select distinct x from jsonb_array_elements_text(p_dados -> 'nota_obrigatoria_formas') x order by 1)
       is distinct from array(select x from unnest(v_formas) x order by 1) then
      if not v_equipe then
        raise exception 'Só o escritório liga ou desliga a regra de nota fiscal no cartão.' using errcode = '42501';
      end if;
      v_formas := array(select distinct x from jsonb_array_elements_text(p_dados -> 'nota_obrigatoria_formas') x order by 1);
      if not (v_formas <@ array['cartao_credito', 'cartao_debito']::text[]) then
        raise exception 'A regra vale só para cartão de crédito e cartão de débito.';
      end if;
    end if;
  end if;

  -- As contas do caixa, do banco e da maquininha: loja completa, hotel e clínicas (recepção e loja)
  if v_ativa and v_modalidade in ('loja', 'hotel', 'veterinaria', 'fisioterapia') then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', case v_modalidade
      when 'hotel' then 'Caixa da recepção' when 'veterinaria' then 'Caixa da clínica' when 'fisioterapia' then 'Caixa da clínica' else 'Caixa da loja' end));
    v_pix := coalesce(v_pix, v_atual.conta_pix_id, app.gestao_conta(p_empresa_id, 'conta_corrente', 'Banco (PIX e transferências)'));
    v_cartao := coalesce(v_cartao, v_atual.conta_cartao_id, app.gestao_conta(p_empresa_id, 'adquirente', 'Maquininha de cartão'));
  end if;
  -- Nota na hora da venda: operação de cada documento e inscrição que emite (da própria empresa)
  v_nfe_op := case when p_dados ? 'nfe_operacao_id' then nullif(p_dados ->> 'nfe_operacao_id', '')::uuid else v_atual.nfe_operacao_id end;
  v_nfe_emit := case when p_dados ? 'nfe_emitente_id' then nullif(p_dados ->> 'nfe_emitente_id', '')::uuid else v_atual.nfe_emitente_id end;
  v_nfce_op := case when p_dados ? 'nfce_operacao_id' then nullif(p_dados ->> 'nfce_operacao_id', '')::uuid else v_atual.nfce_operacao_id end;
  v_doc := coalesce(nullif(p_dados ->> 'documento_padrao', ''), v_atual.documento_padrao, 'nfe');
  if v_nfe_op is not null and v_nfe_op is distinct from v_atual.nfe_operacao_id
     and not exists (select 1 from public.nfe_operacoes where id = v_nfe_op and empresa_id = p_empresa_id and ativa and 'nfe' = any (modelos)) then
    raise exception 'A operação da NF-e escolhida não é desta empresa, está desativada ou não serve para Nota fiscal.';
  end if;
  if v_nfce_op is not null and v_nfce_op is distinct from v_atual.nfce_operacao_id
     and not exists (select 1 from public.nfe_operacoes where id = v_nfce_op and empresa_id = p_empresa_id and ativa and 'nfce' = any (modelos)) then
    raise exception 'A operação do cupom fiscal escolhida não é desta empresa, está desativada ou não serve para Cupom fiscal.';
  end if;
  if v_nfe_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_nfe_emit and empresa_id = p_empresa_id and ativo) then
    raise exception 'A inscrição que emite a NF-e não é desta empresa ou está desativada.';
  end if;
  if v_doc not in ('nfe', 'nfce') then
    raise exception 'Documento padrão inválido.';
  end if;
  if (v_dinheiro is not null and v_dinheiro in (v_pix, v_cartao)) then
    raise exception 'A conta do dinheiro precisa ser diferente da conta do PIX e da maquininha.';
  end if;

  insert into public.gestao_config as g (
    empresa_id, ativa, perfil_fiscal, permitir_estoque_negativo, permitir_venda_prazo, desconto_maximo_operador,
    conta_dinheiro_id, conta_pix_id, conta_cartao_id, validade_orcamento_dias, mensagem_comprovante, ativada_por, ativada_em,
    nfe_operacao_id, nfe_emitente_id, nfe_marcada_padrao, modalidade, nfce_operacao_id, documento_padrao, nota_obrigatoria_formas
  ) values (
    p_empresa_id, v_ativa, v_perfil,
    coalesce((p_dados ->> 'permitir_estoque_negativo')::boolean, v_atual.permitir_estoque_negativo, false),
    coalesce((p_dados ->> 'permitir_venda_prazo')::boolean, v_atual.permitir_venda_prazo, true),
    case when p_dados ? 'desconto_maximo_operador' then v_desc else v_atual.desconto_maximo_operador end,
    v_dinheiro, v_pix, v_cartao,
    coalesce((p_dados ->> 'validade_orcamento_dias')::int, v_atual.validade_orcamento_dias, 15),
    case when p_dados ? 'mensagem_comprovante' then nullif(trim(p_dados ->> 'mensagem_comprovante'), '') else v_atual.mensagem_comprovante end,
    case when v_ativa then auth.uid() end, case when v_ativa then now() end,
    v_nfe_op, v_nfe_emit, coalesce((p_dados ->> 'nfe_marcada_padrao')::boolean, v_atual.nfe_marcada_padrao, false), v_modalidade,
    v_nfce_op, v_doc, v_formas
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    perfil_fiscal = excluded.perfil_fiscal,
    permitir_estoque_negativo = excluded.permitir_estoque_negativo,
    permitir_venda_prazo = excluded.permitir_venda_prazo,
    desconto_maximo_operador = excluded.desconto_maximo_operador,
    conta_dinheiro_id = excluded.conta_dinheiro_id,
    conta_pix_id = excluded.conta_pix_id,
    conta_cartao_id = excluded.conta_cartao_id,
    validade_orcamento_dias = excluded.validade_orcamento_dias,
    mensagem_comprovante = excluded.mensagem_comprovante,
    ativada_por = case when excluded.ativa and not g.ativa then auth.uid() else g.ativada_por end,
    ativada_em = case when excluded.ativa and not g.ativa then now() else g.ativada_em end,
    nfe_operacao_id = excluded.nfe_operacao_id,
    nfe_emitente_id = excluded.nfe_emitente_id,
    nfe_marcada_padrao = excluded.nfe_marcada_padrao,
    modalidade = excluded.modalidade,
    nfce_operacao_id = excluded.nfce_operacao_id,
    documento_padrao = excluded.documento_padrao,
    nota_obrigatoria_formas = excluded.nota_obrigatoria_formas,
    atualizado_por = auth.uid();

  if v_ativa and v_modalidade = 'hotel' then
    perform app.hotel_cfg(p_empresa_id);
  end if;
  if v_ativa and v_modalidade = 'veterinaria' then
    perform app.vet_cfg(p_empresa_id);
  end if;
  if v_ativa and v_modalidade = 'fisioterapia' then
    perform app.fisio_cfg(p_empresa_id);
  end if;
end;
$$;

-- Documentos que a loja consegue emitir agora (NF-e e cupom), com o motivo
-- quando não dá, a inscrição e a operação de cada um e a regra do cartão.
create function app.gestao_docs(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfe_config;
  v_loja public.gestao_config;
  v_cert boolean;
  v_emi_nfe uuid;
  v_emi_nfce uuid;
  v_op_nfe uuid;
  v_op_nfce uuid;
  v_mot_nfe text;
  v_mot_nfce text;
begin
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id;
  select * into v_loja from public.gestao_config where empresa_id = p_empresa_id;
  v_cert := exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now());

  -- Inscrição: a escolhida na loja ou, se só houver uma, ela
  select e.id into v_emi_nfe from public.nfe_emitentes e where e.id = v_loja.nfe_emitente_id and e.empresa_id = p_empresa_id and e.ativo;
  if v_emi_nfe is null and (select count(*) from public.nfe_emitentes e where e.empresa_id = p_empresa_id and e.ativo) = 1 then
    select e.id into v_emi_nfe from public.nfe_emitentes e where e.empresa_id = p_empresa_id and e.ativo;
  end if;
  select e.id into v_emi_nfce from public.nfe_emitentes e where e.id = v_emi_nfe and e.nfce_serie is not null;
  if v_emi_nfce is null and v_loja.nfe_emitente_id is null
     and (select count(*) from public.nfe_emitentes e where e.empresa_id = p_empresa_id and e.ativo and e.nfce_serie is not null) = 1 then
    select e.id into v_emi_nfce from public.nfe_emitentes e where e.empresa_id = p_empresa_id and e.ativo and e.nfce_serie is not null;
  end if;
  -- Operação de cada documento: a escolhida na loja ou, se só houver uma que sirva, ela
  select o.id into v_op_nfe from public.nfe_operacoes o
   where o.id = v_loja.nfe_operacao_id and o.empresa_id = p_empresa_id and o.ativa and 'nfe' = any (o.modelos);
  if v_op_nfe is null and (select count(*) from public.nfe_operacoes o where o.empresa_id = p_empresa_id and o.ativa and 'nfe' = any (o.modelos)) = 1 then
    select o.id into v_op_nfe from public.nfe_operacoes o where o.empresa_id = p_empresa_id and o.ativa and 'nfe' = any (o.modelos);
  end if;
  select o.id into v_op_nfce from public.nfe_operacoes o
   where o.id = v_loja.nfce_operacao_id and o.empresa_id = p_empresa_id and o.ativa and 'nfce' = any (o.modelos);
  if v_op_nfce is null and (select count(*) from public.nfe_operacoes o where o.empresa_id = p_empresa_id and o.ativa and 'nfce' = any (o.modelos)) = 1 then
    select o.id into v_op_nfce from public.nfe_operacoes o where o.empresa_id = p_empresa_id and o.ativa and 'nfce' = any (o.modelos);
  end if;

  v_mot_nfe := case
    when v_cfg.empresa_id is null or not v_cfg.ativa then 'A emissão de NF-e desta empresa está desligada (falta o certificado digital ou a autorização do escritório).'
    when not v_cert then 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.'
    when v_emi_nfe is null then 'Escolha a inscrição que emite a nota nas configurações da loja.'
    when v_op_nfe is null then 'Escolha a operação da NF-e nas configurações da loja.'
  end;
  v_mot_nfce := case
    when v_cfg.empresa_id is null or not v_cfg.nfce_ativa then 'O cupom fiscal (NFC-e) desta empresa ainda não foi ligado pelo escritório.'
    when not v_cert then 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.'
    when v_emi_nfce is null then 'Falta a série do cupom fiscal na inscrição que emite (fale com o escritório).'
    when v_op_nfce is null then 'Escolha a operação do cupom fiscal nas configurações da loja.'
  end;
  return jsonb_build_object(
    'nfe', jsonb_build_object('disponivel', v_mot_nfe is null, 'motivo', v_mot_nfe, 'ambiente', v_cfg.ambiente,
                              'emitente_id', v_emi_nfe, 'operacao_id', v_op_nfe),
    'nfce', jsonb_build_object('disponivel', v_mot_nfce is null, 'motivo', v_mot_nfce, 'ambiente', v_cfg.nfce_ambiente,
                               'emitente_id', v_emi_nfce, 'operacao_id', v_op_nfce),
    'obrigatoria_formas', to_jsonb(coalesce(v_loja.nota_obrigatoria_formas, '{}'::text[])),
    'documento_padrao', coalesce(v_loja.documento_padrao, 'nfe'),
    'marcada_padrao', coalesce(v_loja.nfe_marcada_padrao, false)
  );
end;
$$;
revoke all on function app.gestao_docs(uuid) from public, anon, authenticated;

create function public.gestao_documentos_fiscais(p_empresa_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  return app.gestao_docs(p_empresa_id);
end;
$$;
revoke all on function public.gestao_documentos_fiscais(uuid) from public, anon;
grant execute on function public.gestao_documentos_fiscais(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Montagem da nota: NF-e (modelo 55) ou cupom fiscal (NFC-e, modelo 65)
-- -----------------------------------------------------------------------------
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
  -- GTA (Guia de Trânsito Animal) dos animais da nota
  v_exige_gta boolean := false;
  v_gtas jsonb := '[]'::jsonb;
  v_gta jsonb;
  g jsonb;
  v_gta_num text;
  v_gta_serie text;
  v_gta_uf text;
  -- Cupom fiscal (NFC-e): consumidor sem cadastro (só CPF/CNPJ e nome) e as formas de pagamento
  v_nfce boolean := coalesce(p_dados ->> 'modelo', '55') = '65';
  v_cons_doc text;
  v_cons_nome text;
  v_pags jsonb := '[]'::jsonb;
  v_pg jsonb;
  v_vp numeric;
  v_soma_pag numeric := 0;
  v_troco numeric := 0;
  v_destinatario jsonb;
begin
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id;
  select * into v_emp from public.empresas where id = p_empresa_id;
  select * into v_emi from public.nfe_emitentes where id = (p_dados ->> 'emitente_id')::uuid and empresa_id = p_empresa_id and ativo;
  if v_emi.id is null then
    raise exception 'Escolha a inscrição estadual (estabelecimento ou propriedade) que emite a nota.';
  end if;
  if v_nfce and v_emi.nfce_serie is null then
    raise exception 'A inscrição "%" não tem série de cupom fiscal (NFC-e). Fale com o escritório.', v_emi.nome;
  end if;
  select * into v_op from public.nfe_operacoes where id = (p_dados ->> 'operacao_id')::uuid and empresa_id = p_empresa_id and ativa;
  if v_op.id is null then
    raise exception 'Escolha uma das operações cadastradas pelo escritório.';
  end if;
  if not ((case when v_nfce then 'nfce' else 'nfe' end) = any (v_op.modelos)) then
    raise exception 'A operação "%" não serve para %. Fale com o escritório.', v_op.nome,
      case when v_nfce then 'cupom fiscal (NFC-e)' else 'nota fiscal (NF-e)' end;
  end if;
  select * into v_dest from public.nfe_destinatarios where id = (p_dados ->> 'destinatario_id')::uuid and empresa_id = p_empresa_id;
  if v_dest.id is null and not v_nfce then
    raise exception 'Escolha o cliente (comprador).';
  end if;
  if v_nfce then
    -- No cupom o consumidor é opcional: cadastrado (destinatário) ou só o CPF/CNPJ informado no caixa
    if v_dest.id is not null and v_dest.tipo = 'estrangeiro' then
      raise exception 'No cupom fiscal, identifique o consumidor por CPF ou CNPJ.';
    end if;
    if v_dest.id is null then
      v_cons_doc := nullif(regexp_replace(coalesce(p_dados #>> '{consumidor,documento}', ''), '\D', '', 'g'), '');
      v_cons_nome := nullif(left(trim(p_dados #>> '{consumidor,nome}'), 60), '');
      if v_cons_doc is not null and v_cons_doc !~ '^([0-9]{11}|[0-9]{14})$' then
        raise exception 'CPF ou CNPJ do consumidor inválido.';
      end if;
    end if;
  end if;
  if v_dest.id is not null and v_dest.tipo = 'cnpj' and v_dest.documento = v_emp.documento and v_op.finalidade = 1 then
    raise exception 'O comprador não pode ser a própria empresa.';
  end if;
  select uf, nome into v_uf_emi, v_mun_emi from public.municipios where ibge = v_emi.municipio_ibge;
  if v_dest.tipo = 'estrangeiro' then
    v_uf_dest := 'EX';
  elsif v_dest.id is not null then
    select uf, nome into v_uf_dest, v_mun_dest from public.municipios where ibge = v_dest.municipio_ibge;
  end if;
  -- O cupom é sempre venda presencial dentro do estado (o endereço do consumidor não muda isso)
  if not v_nfce then
    if v_op.destino = 'interna' and v_uf_dest <> v_uf_emi then
      raise exception 'A operação "%" é para dentro do estado, mas o cliente é de %.', v_op.nome, v_uf_dest;
    end if;
    if v_op.destino = 'interestadual' and (v_uf_dest = v_uf_emi or v_uf_dest = 'EX') then
      raise exception 'A operação "%" é para outro estado, mas o cliente é de %.', v_op.nome, v_uf_dest;
    end if;
    if v_op.destino = 'exterior' and v_uf_dest <> 'EX' then
      raise exception 'A operação "%" é para o exterior: escolha um cliente estrangeiro.', v_op.nome;
    end if;
  end if;
  v_simples := v_cfg.crt in (1, 4);
  v_exige_gta := v_op.exige_gta;
  if v_op.ibscbs_cclass_trib is not null then
    select * into v_cl from public.nfe_cclass_trib where cclass_trib = v_op.ibscbs_cclass_trib;
  end if;

  -- Itens: dados do produto + regras da operação (a da nota ou a própria do produto)
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Inclua ao menos um produto.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 990 then
    raise exception 'A nota aceita no máximo 990 itens.';
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
      if v_nfce and not ('nfce' = any (v_opi.modelos)) then
        raise exception 'A regra fiscal própria do produto % (operação "%") não serve para cupom fiscal. Emita NF-e ou fale com o escritório.', v_prod.descricao, v_opi.nome;
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
    -- A regra própria do produto também pode exigir a GTA (ex.: animal vivo numa nota mista)
    v_exige_gta := v_exige_gta or v_opi.exige_gta;
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

  if v_nfce then
    -- Cupom: venda no balcão, sem frete, sem seguro e sem GTA
    if coalesce(nullif(p_dados ->> 'frete', '')::numeric, 0) > 0 or coalesce(nullif(p_dados ->> 'seguro', '')::numeric, 0) > 0 or v_modalidade <> 9 then
      raise exception 'Cupom fiscal não leva frete nem seguro: use a NF-e.';
    end if;
    if v_exige_gta then
      raise exception 'Venda com GTA (animais) sai em NF-e, não em cupom fiscal.';
    end if;
    -- Formas de pagamento do cupom (o troco só existe no dinheiro)
    if jsonb_typeof(p_dados -> 'pagamentos') is distinct from 'array' or jsonb_array_length(p_dados -> 'pagamentos') not between 1 and 10 then
      raise exception 'Informe as formas de pagamento do cupom (de 1 a 10).';
    end if;
    for v_pg in select * from jsonb_array_elements(p_dados -> 'pagamentos') loop
      if coalesce(v_pg ->> 'forma', '') not in ('01', '02', '03', '04', '05', '10', '11', '12', '13', '15', '16', '17', '18', '19', '20', '99') then
        raise exception 'Forma de pagamento inválida no cupom.';
      end if;
      v_vp := nullif(v_pg ->> 'valor', '')::numeric;
      if v_vp is null or v_vp <= 0 or v_vp <> round(v_vp, 2) then
        raise exception 'Valor de pagamento inválido no cupom.';
      end if;
      v_soma_pag := v_soma_pag + v_vp;
      v_pags := v_pags || jsonb_build_array(jsonb_build_object('forma', v_pg ->> 'forma', 'valor', to_char(v_vp, 'FM99999999990.00'),
        'descricao', case when v_pg ->> 'forma' = '99' then coalesce(nullif(trim(v_pg ->> 'descricao'), ''), 'Outros') end));
    end loop;
    v_troco := v_soma_pag - round(v_total, 2);
    if v_troco < 0 then
      raise exception 'Os pagamentos (R$ %) não cobrem o total do cupom (R$ %).', to_char(v_soma_pag, 'FM999G999G990D00'), to_char(round(v_total, 2), 'FM999G999G990D00');
    end if;
    if v_troco > 0 and not exists (select 1 from jsonb_array_elements(v_pags) x where x ->> 'forma' = '01') then
      raise exception 'O valor pago passa do total do cupom: troco só existe com dinheiro.';
    end if;
  end if;

  -- GTA: número (e série) de cada guia, do estado de quem emite se não vier outro.
  -- Obrigatória quando a operação (da nota ou a própria de um produto) exige.
  if p_dados ? 'gtas' and jsonb_typeof(p_dados -> 'gtas') not in ('array', 'null') then
    raise exception 'Informe as GTAs em lista.';
  end if;
  for g in select * from jsonb_array_elements(case when jsonb_typeof(p_dados -> 'gtas') = 'array' then p_dados -> 'gtas' else '[]'::jsonb end) loop
    if jsonb_typeof(g) <> 'object' then
      raise exception 'GTA inválida.';
    end if;
    v_gta_num := upper(regexp_replace(coalesce(g ->> 'numero', ''), '[\s./-]', '', 'g'));
    continue when v_gta_num = '';
    v_gta_serie := nullif(upper(regexp_replace(coalesce(g ->> 'serie', ''), '[\s./-]', '', 'g')), '');
    v_gta_uf := coalesce(nullif(upper(trim(g ->> 'uf')), ''), v_uf_emi);
    if v_gta_num !~ '^[0-9A-Z]{1,20}$' then
      raise exception 'Número da GTA inválido (%): use só números e letras, até 20.', left(g ->> 'numero', 30);
    end if;
    if v_gta_serie is not null and v_gta_serie !~ '^[0-9A-Z]{1,5}$' then
      raise exception 'Série da GTA % inválida: até 5 números ou letras.', v_gta_num;
    end if;
    if v_gta_uf !~ '^[A-Z]{2}$' or not exists (select 1 from public.municipios where uf = v_gta_uf) then
      raise exception 'Estado da GTA % inválido.', v_gta_num;
    end if;
    v_gta := jsonb_build_object('numero', v_gta_num, 'serie', v_gta_serie, 'uf', v_gta_uf);
    if v_gtas @> jsonb_build_array(v_gta) then
      raise exception 'A GTA % foi informada duas vezes.', v_gta_num;
    end if;
    v_gtas := v_gtas || jsonb_build_array(v_gta);
  end loop;
  if jsonb_array_length(v_gtas) > 10 then
    raise exception 'Informe no máximo 10 GTAs por nota.';
  end if;
  if v_exige_gta and jsonb_array_length(v_gtas) = 0 then
    raise exception 'Informe o número da GTA (Guia de Trânsito Animal) dos animais desta nota.';
  end if;

  -- DIFAL: venda a não contribuinte de outro estado (alíquota interna e FCP da tabela "ICMS por estado")
  if not v_nfce and v_op.difal_metodo is not null and v_dest.indicador_ie = 9 and v_op.destino = 'interestadual' then
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
  v_parcelas := case when not v_nfce and coalesce((p_dados #>> '{pagamento,a_prazo}')::boolean, false) then coalesce(p_dados #> '{pagamento,parcelas}', '[]'::jsonb) else '[]'::jsonb end;
  v_info := nullif(concat_ws(' ', nullif(trim(v_op.informacoes), ''), nullif(array_to_string(v_infos, ' '), ''), nullif(trim(v_cfg.informacoes_padrao), ''),
                             nullif(trim(p_dados ->> 'informacoes'), '')), '');
  select * into v_esc from public.escritorio where id = 1;

  -- Destinatário: completo na NF-e; no cupom, só a identificação do consumidor (quando houver)
  if not v_nfce then
    v_destinatario := jsonb_build_object(
      'tipo', v_dest.tipo, 'documento', v_dest.documento, 'nome', v_dest.nome,
      'endereco', jsonb_build_object('logradouro', v_dest.logradouro, 'numero', v_dest.numero, 'complemento', v_dest.complemento, 'bairro', v_dest.bairro,
                                     'codigoMunicipio', coalesce(v_dest.municipio_ibge, '9999999'), 'municipio', coalesce(v_mun_dest, v_dest.cidade_exterior, 'EXTERIOR'),
                                     'uf', v_uf_dest, 'cep', v_dest.cep, 'telefone', v_dest.telefone, 'codigoPais', v_dest.codigo_pais, 'pais', v_dest.pais),
      'indicadorIe', v_dest.indicador_ie, 'inscricaoEstadual', v_dest.inscricao_estadual, 'email', v_dest.email);
  elsif v_dest.id is not null then
    v_destinatario := jsonb_build_object('tipo', v_dest.tipo, 'documento', v_dest.documento, 'nome', v_dest.nome, 'email', v_dest.email);
  elsif v_cons_doc is not null then
    v_destinatario := jsonb_build_object('tipo', case when length(v_cons_doc) = 11 then 'cpf' else 'cnpj' end, 'documento', v_cons_doc, 'nome', v_cons_nome);
  end if;

  return jsonb_build_object(
    'modelo', case when v_nfce then 65 else 55 end,
    'natureza', v_op.natureza,
    'finalidade', v_op.finalidade,
    'consumidorFinal', v_op.consumidor_final,
    'presenca', case when v_nfce then 1 else v_cfg.presenca end,
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
    'destinatario', case when v_nfce then null else v_destinatario end,
    'consumidor', case when v_nfce then v_destinatario end,
    'itens', v_itens,
    'frete', case when v_nfce then null else nullif(p_dados ->> 'frete', '') end,
    'seguro', case when v_nfce then null else nullif(p_dados ->> 'seguro', '') end,
    'outras', nullif(p_dados ->> 'outras', ''),
    'desconto', nullif(p_dados ->> 'desconto', ''),
    'transporte', case when v_nfce then jsonb_build_object('modalidade', 9) else jsonb_build_object(
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
        'codigoMunicipio', v_emi.municipio_ibge) end) end,
    'pagamento', case when v_nfce then jsonb_build_object('forma', v_pags -> 0 ->> 'forma', 'aPrazo', false, 'parcelas', '[]'::jsonb) else jsonb_build_object(
      'forma', coalesce(nullif(p_dados #>> '{pagamento,forma}', ''), '90'),
      'descricao', nullif(trim(p_dados #>> '{pagamento,descricao}'), ''),
      'aPrazo', coalesce((p_dados #>> '{pagamento,a_prazo}')::boolean, false),
      'parcelas', v_parcelas) end,
    'pagamentos', case when v_nfce then v_pags end,
    'troco', case when v_nfce then to_char(v_troco, 'FM99999999990.00') end,
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
    'gtas', v_gtas,
    '_resumo', jsonb_build_object('valor_total', round(v_total, 2),
                                  'destinatario_nome', coalesce(v_dest.nome, v_cons_nome, 'Consumidor final'),
                                  'destinatario_documento', coalesce(v_dest.documento, v_cons_doc),
                                  'destinatario_uf', case when v_nfce then null when v_uf_dest = 'EX' then null else v_uf_dest end)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Emissão: o mesmo caminho para a NF-e e o cupom (número reservado na série
--    do documento, fila "emitir_nfe")
-- -----------------------------------------------------------------------------
create function app.nfe_emitir_interno(p_empresa_id uuid, p_dados jsonb, p_id uuid, p_modelo smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfe_config;
  v_emi public.nfe_emitentes;
  v_ant public.nfe_emissoes;
  v_dados jsonb;
  v_resumo jsonb;
  v_numero bigint;
  v_serie int;
  v_cnf text;
  v_id uuid;
  v_ambiente text;
  v_nfce boolean := p_modelo = 65;
begin
  if p_modelo not in (55, 65) then
    raise exception 'Modelo de nota inválido.';
  end if;
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id;
  if v_nfce and (v_cfg.empresa_id is null or not v_cfg.nfce_ativa) then
    raise exception 'O cupom fiscal (NFC-e) desta empresa ainda não foi ligado pelo escritório.';
  end if;
  if not v_nfce and (v_cfg.empresa_id is null or not v_cfg.ativa) then
    raise exception 'A emissão de NF-e desta empresa ainda não foi ligada pelo escritório.';
  end if;
  v_ambiente := case when v_nfce then v_cfg.nfce_ambiente else v_cfg.ambiente end;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  v_dados := app.nfe_montar_dados(p_empresa_id, (p_dados - 'modelo') || jsonb_build_object('modelo', p_modelo::text));
  v_resumo := v_dados -> '_resumo';
  v_dados := v_dados - '_resumo';

  if p_id is not null then
    -- Nota rejeitada, corrigida: mesmo número (a SEFAZ não registrou a rejeitada)
    select * into v_ant from public.nfe_emissoes where id = p_id and empresa_id = p_empresa_id for update;
    if v_ant.id is null then
      raise exception 'Nota não encontrada.';
    end if;
    if v_ant.situacao <> 'rejeitada' then
      raise exception 'Só uma nota rejeitada pode ser corrigida e enviada de novo.';
    end if;
    if v_ant.modelo <> p_modelo then
      raise exception 'Na correção, o tipo da nota (NF-e ou cupom) não pode mudar.';
    end if;
    if v_ant.emitente_id <> (p_dados ->> 'emitente_id')::uuid then
      raise exception 'Na correção, a inscrição que emite não pode mudar (o número é dela).';
    end if;
    update public.nfe_emissoes
       set operacao_id = (p_dados ->> 'operacao_id')::uuid, destinatario_id = nullif(p_dados ->> 'destinatario_id', '')::uuid,
           situacao = 'na_fila', pedido = p_dados - 'confirmar_repetida', dados = v_dados, natureza = v_dados ->> 'natureza',
           destinatario_nome = v_resumo ->> 'destinatario_nome', destinatario_documento = v_resumo ->> 'destinatario_documento',
           destinatario_uf = v_resumo ->> 'destinatario_uf', valor_total = (v_resumo ->> 'valor_total')::numeric,
           emitida_em = null, chave = null, recibo = null, totais = null, xml_assinado = null, mensagens = null, tentativas = 0, qrcode = null
     where id = p_id;
    perform app.enfileirar('emitir_nfe', jsonb_build_object('emissao_id', p_id), p_empresa_id,
                           'nfe:' || p_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
    return jsonb_build_object('id', p_id, 'numero', v_ant.numero, 'serie', v_ant.serie, 'ambiente', v_ant.ambiente, 'modelo', v_ant.modelo);
  end if;

  -- Proteção contra NF-e repetida por engano (mesmo cliente e valor em 10 minutos). No cupom
  -- não vale: dois cafés iguais seguidos são normais, e a venda já impede o cupom em dobro.
  if not v_nfce and not coalesce((p_dados ->> 'confirmar_repetida')::boolean, false) and exists (
    select 1 from public.nfe_emissoes e
     where e.empresa_id = p_empresa_id and e.modelo = 55 and e.valor_total = (v_resumo ->> 'valor_total')::numeric
       and e.destinatario_documento is not distinct from (v_resumo ->> 'destinatario_documento')
       and e.situacao not in ('rejeitada', 'cancelada', 'descartada') and e.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'Uma nota igual (mesmo cliente e valor) foi emitida há poucos minutos. Confira a lista antes de emitir de novo.'
      using errcode = 'P0002';
  end if;
  if (select count(*) from public.nfe_emissoes e
       where e.empresa_id = p_empresa_id and e.modelo = p_modelo and e.created_at > now() - interval '1 hour') >= (case when v_nfce then 600 else 60 end) then
    raise exception 'Limite de % por hora atingido. Aguarde um pouco ou fale com o escritório.',
      case when v_nfce then '600 cupons' else '60 notas' end;
  end if;

  -- Número (reservado agora) na série do documento na inscrição que emite
  select * into v_emi from public.nfe_emitentes where id = (p_dados ->> 'emitente_id')::uuid for update;
  if v_nfce then
    v_serie := v_emi.nfce_serie;
    if v_ambiente = 'producao' then
      v_numero := v_emi.nfce_proximo_numero_producao;
      update public.nfe_emitentes set nfce_proximo_numero_producao = v_numero + 1 where id = v_emi.id;
    else
      v_numero := v_emi.nfce_proximo_numero_homologacao;
      update public.nfe_emitentes set nfce_proximo_numero_homologacao = v_numero + 1 where id = v_emi.id;
    end if;
  else
    v_serie := v_emi.serie;
    if v_ambiente = 'producao' then
      v_numero := v_emi.proximo_numero_producao;
      update public.nfe_emitentes set proximo_numero_producao = v_numero + 1 where id = v_emi.id;
    else
      v_numero := v_emi.proximo_numero_homologacao;
      update public.nfe_emitentes set proximo_numero_homologacao = v_numero + 1 where id = v_emi.id;
    end if;
  end if;
  -- Código numérico (cNF) sorteado, diferente do número
  loop
    v_cnf := lpad((10000000 + floor(random() * 90000000))::bigint::text, 8, '0');
    exit when v_cnf <> lpad(v_numero::text, 8, '0') and v_cnf !~ '^(\d)\1{7}$';
  end loop;

  insert into public.nfe_emissoes (
    empresa_id, emitente_id, operacao_id, destinatario_id, ambiente, serie, numero, codigo_numerico, pedido, dados,
    natureza, destinatario_nome, destinatario_documento, destinatario_uf, valor_total, modelo
  ) values (
    p_empresa_id, v_emi.id, (p_dados ->> 'operacao_id')::uuid, nullif(p_dados ->> 'destinatario_id', '')::uuid, v_ambiente, v_serie, v_numero, v_cnf,
    p_dados - 'confirmar_repetida', v_dados,
    v_dados ->> 'natureza', v_resumo ->> 'destinatario_nome', v_resumo ->> 'destinatario_documento', v_resumo ->> 'destinatario_uf',
    (v_resumo ->> 'valor_total')::numeric, p_modelo
  ) returning id into v_id;

  perform app.enfileirar('emitir_nfe', jsonb_build_object('emissao_id', v_id), p_empresa_id, 'nfe:' || v_id::text, now(), 5);
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'serie', v_serie, 'ambiente', v_ambiente, 'modelo', p_modelo);
end;
$$;
revoke all on function app.nfe_emitir_interno(uuid, jsonb, uuid, smallint) from public, anon, authenticated;

create or replace function public.nfe_emitir(p_empresa_id uuid, p_dados jsonb, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'nfe.emitir');
  return app.nfe_emitir_interno(p_empresa_id, p_dados, p_id, coalesce(nullif(p_dados ->> 'modelo', '')::smallint, 55::smallint));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Nota da venda (caixa): quem vende emite a nota daquela venda, com a
--    inscrição e a operação da loja; o pedido sai da própria venda.
-- -----------------------------------------------------------------------------
create function public.gestao_venda_emitir_nota(p_venda_id uuid, p_documento text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
  v_ant public.nfe_emissoes;
  v_doc jsonb;
  v_modelo smallint;
  v_corrigir uuid;
  v_dest uuid;
  v_itens jsonb;
  v_desc numeric;
  v_qtd_pag int;
  v_principal public.venda_pagamentos;
  v_parcelas jsonb := '[]'::jsonb;
  v_pags jsonb;
  v_info text;
  v_r jsonb;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if v.id is null or v.tipo <> 'venda' then
    raise exception 'Venda não encontrada.';
  end if;
  perform app.exigir_gestao(v.empresa_id, 'gestao.vender');
  if v.status <> 'concluida' then
    raise exception 'Venda cancelada não recebe nota.';
  end if;
  if p_documento is null or p_documento not in ('nfe', 'nfce') then
    raise exception 'Escolha cupom fiscal (NFC-e) ou NF-e.';
  end if;
  v_modelo := case p_documento when 'nfce' then 65 else 55 end;

  -- Uma nota por venda: só sai outra se a anterior foi cancelada, descartada ou recusada
  if v.nfe_emissao_id is not null then
    select * into v_ant from public.nfe_emissoes where id = v.nfe_emissao_id;
    if v_ant.situacao in ('na_fila', 'enviando', 'aguardando') then
      raise exception 'A nota desta venda já está a caminho da SEFAZ.';
    end if;
    if v_ant.situacao = 'falha' then
      -- Sem resposta da SEFAZ: a mesma nota vai de novo (o envio consulta antes, para não emitir duas vezes)
      if v_ant.modelo <> v_modelo then
        raise exception 'A nota desta venda ficou sem resposta da SEFAZ. Tente de novo a mesma nota antes de escolher outra.';
      end if;
      update public.nfe_emissoes set situacao = 'na_fila' where id = v_ant.id;
      perform app.enfileirar('emitir_nfe', jsonb_build_object('emissao_id', v_ant.id), v.empresa_id,
                             'nfe:' || v_ant.id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
      return jsonb_build_object('id', v_ant.id, 'numero', v_ant.numero, 'serie', v_ant.serie, 'ambiente', v_ant.ambiente, 'modelo', v_ant.modelo, 'reenviada', true);
    end if;
    if v_ant.situacao in ('autorizada', 'cancelando', 'denegada') then
      raise exception 'Esta venda já tem nota (nº %).', v_ant.numero;
    end if;
    if v_ant.situacao = 'rejeitada' then
      if v_ant.modelo <> v_modelo then
        raise exception 'A nota recusada desta venda é de outro tipo. Peça ao escritório para descartá-la antes de emitir outra.';
      end if;
      -- Recusada: vai de novo com o mesmo número, já com os dados de agora
      v_corrigir := v_ant.id;
    end if;
  end if;

  v_doc := app.gestao_docs(v.empresa_id) -> p_documento;
  if not coalesce((v_doc ->> 'disponivel')::boolean, false) then
    raise exception '%', v_doc ->> 'motivo';
  end if;

  -- Cliente: na NF-e precisa estar cadastrado (CPF/CNPJ e endereço); no cupom é opcional
  if v.cliente_documento is not null then
    select d.id into v_dest from public.nfe_destinatarios d
     where d.empresa_id = v.empresa_id and d.documento = v.cliente_documento
     order by d.created_at desc limit 1;
  end if;
  if v_modelo = 55 and v_dest is null then
    raise exception 'Para a NF-e, o cliente precisa estar cadastrado com CPF/CNPJ e endereço. Complete o cadastro e emita pela venda.';
  end if;

  select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'quantidade', i.quantidade::text, 'valor_unitario', i.preco_unitario::text) order by i.ordem),
         coalesce(sum(i.desconto), 0)
    into v_itens, v_desc
    from public.venda_itens i where i.venda_id = v.id;
  v_desc := v_desc + v.desconto;

  -- Pagamento: no cupom, todas as formas (dinheiro com o valor recebido, para o troco);
  -- na NF-e, a de maior valor (as demais vão nas informações) e as duplicatas da venda a prazo
  select count(*) into v_qtd_pag from public.venda_pagamentos p where p.venda_id = v.id;
  select * into v_principal from public.venda_pagamentos p where p.venda_id = v.id order by p.valor desc, p.id limit 1;
  select jsonb_agg(jsonb_build_object(
           'forma', case p.forma when 'dinheiro' then '01' when 'pix' then '17' when 'cartao_debito' then '04'
                                 when 'cartao_credito' then '03' when 'a_prazo' then '05' else '99' end,
           'valor', to_char(case when p.forma = 'dinheiro' then coalesce(p.valor_recebido, p.valor) else p.valor end, 'FM99999999990.00'),
           'descricao', case when p.forma = 'outro' then 'Outros' end) order by p.valor desc, p.id)
    into v_pags
    from public.venda_pagamentos p where p.venda_id = v.id;
  if v_modelo = 55 and v_principal.forma = 'a_prazo' and v_qtd_pag = 1 then
    select coalesce(jsonb_agg(jsonb_build_object('vencimento', l.data_vencimento, 'valor', to_char(l.valor_previsto, 'FM99999999990.00'))
                              order by l.data_vencimento, l.parcela_numero), '[]'::jsonb)
      into v_parcelas
      from public.lancamentos l where l.id = any (v_principal.lancamentos);
  end if;
  v_info := 'Venda nº ' || v.numero || '.';
  if v_modelo = 55 and v_qtd_pag > 1 then
    v_info := v_info || ' Pagamento: ' || (
      select string_agg(case p.forma when 'dinheiro' then 'Dinheiro' when 'pix' then 'PIX' when 'cartao_debito' then 'Cartão de débito'
                                     when 'cartao_credito' then 'Cartão de crédito' when 'a_prazo' then 'A prazo' else 'Outro' end
                        || ' R$ ' || to_char(p.valor, 'FM999G999G990D00'), ' + ' order by p.valor desc, p.id)
        from public.venda_pagamentos p where p.venda_id = v.id) || '.';
  end if;

  v_r := app.nfe_emitir_interno(v.empresa_id, jsonb_build_object(
    'emitente_id', v_doc ->> 'emitente_id',
    'operacao_id', v_doc ->> 'operacao_id',
    'destinatario_id', v_dest,
    'consumidor', case when v_modelo = 65 and v_dest is null and v.cliente_documento is not null
                       then jsonb_build_object('documento', v.cliente_documento, 'nome', v.cliente_nome) end,
    'itens', v_itens,
    'frete', case when v.frete > 0 then to_char(v.frete, 'FM99999999990.00') end,
    'desconto', case when v_desc > 0 then to_char(v_desc, 'FM99999999990.00') end,
    'transporte', jsonb_build_object('modalidade', case when v.frete > 0 then 0 else 9 end),
    'pagamento', jsonb_build_object(
      'forma', case v_principal.forma when 'dinheiro' then '01' when 'pix' then '17' when 'cartao_debito' then '04'
                                      when 'cartao_credito' then '03' when 'a_prazo' then '05' else '99' end,
      'descricao', case when v_principal.forma = 'outro' then 'Outros' end,
      'a_prazo', v_principal.forma = 'a_prazo',
      'parcelas', v_parcelas),
    'pagamentos', v_pags,
    'informacoes', v_info,
    'venda_id', v.id
  ), v_corrigir, v_modelo);

  update public.vendas set nfe_emissao_id = (v_r ->> 'id')::uuid, documento_fiscal = p_documento where id = v.id;
  return v_r;
end;
$$;
revoke all on function public.gestao_venda_emitir_nota(uuid, text) from public, anon;
grant execute on function public.gestao_venda_emitir_nota(uuid, text) to authenticated;

-- Situação da nota da venda para quem vende (a tela da venda e o cupom impresso),
-- sem abrir a lista de notas da empresa.
create function public.gestao_venda_nota(p_venda_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.vendas;
  e public.nfe_emissoes;
begin
  select * into v from public.vendas where id = p_venda_id;
  if v.id is null then
    raise exception 'Venda não encontrada.';
  end if;
  perform app.exigir_gestao(v.empresa_id, 'gestao.vender');
  if v.nfe_emissao_id is null then
    return jsonb_build_object('documento', v.documento_fiscal, 'situacao', null);
  end if;
  select * into e from public.nfe_emissoes where id = v.nfe_emissao_id;
  return jsonb_build_object(
    'documento', coalesce(v.documento_fiscal, case e.modelo when 65 then 'nfce' else 'nfe' end),
    'id', e.id, 'modelo', e.modelo, 'situacao', e.situacao, 'numero', e.numero, 'serie', e.serie, 'ambiente', e.ambiente,
    'chave', e.chave, 'protocolo', e.protocolo, 'emitida_em', e.emitida_em, 'autorizada_em', e.autorizada_em,
    'qrcode', e.qrcode, 'valor_total', e.valor_total, 'totais', e.totais, 'mensagens', e.mensagens,
    'destinatario_nome', e.destinatario_nome, 'destinatario_documento', e.destinatario_documento,
    'emitente', jsonb_build_object('uf', e.dados #>> '{emitente,endereco,uf}', 'nome', e.dados #>> '{emitente,nome}',
                                   'fantasia', e.dados #>> '{emitente,fantasia}', 'documento', e.dados #>> '{emitente,documento}',
                                   'inscricao_estadual', e.dados #>> '{emitente,inscricaoEstadual}', 'endereco', e.dados #> '{emitente,endereco}'),
    'pagamentos', e.dados -> 'pagamentos', 'troco', e.dados ->> 'troco', 'itens', e.dados -> 'itens'
  );
end;
$$;
revoke all on function public.gestao_venda_nota(uuid) from public, anon;
grant execute on function public.gestao_venda_nota(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Venda: guarda o documento pedido e cumpre a regra do cartão
-- -----------------------------------------------------------------------------
select pg_temp.trocar_no_corpo('public.gestao_venda_finalizar(uuid, jsonb)',
$a$  i int;
begin$a$,
$a$  i int;
  v_doc text := nullif(p_dados ->> 'documento_fiscal', '');
  v_docs jsonb;
begin$a$);
select pg_temp.trocar_no_corpo('public.gestao_venda_finalizar(uuid, jsonb)',
$a$  if nullif(p_dados ->> 'orcamento_id', '') is not null then$a$,
$a$  if v_doc is not null and v_doc not in ('nfe', 'nfce') then
    raise exception 'Escolha cupom fiscal (NFC-e) ou NF-e.';
  end if;
  if v_doc is null and exists (select 1 from jsonb_array_elements(p_dados -> 'pagamentos') x where x ->> 'forma' = any (v_cfg.nota_obrigatoria_formas)) then
    raise exception 'Nesta loja, a venda no cartão sai com nota fiscal: escolha cupom fiscal (NFC-e) ou NF-e.';
  end if;
  if v_doc is not null then
    v_docs := app.gestao_docs(p_empresa_id) -> v_doc;
    if not coalesce((v_docs ->> 'disponivel')::boolean, false) then
      raise exception '%', v_docs ->> 'motivo';
    end if;
    if v_doc = 'nfce' and v_frete > 0 then
      raise exception 'Venda com frete não sai em cupom fiscal: escolha NF-e.';
    end if;
    if v_doc = 'nfe' and (v_cli.id is null or v_cli.documento is null) then
      raise exception 'Para a NF-e, escolha o cliente com CPF ou CNPJ no cadastro.';
    end if;
  end if;
  if nullif(p_dados ->> 'orcamento_id', '') is not null then$a$);
select pg_temp.trocar_no_corpo('public.gestao_venda_finalizar(uuid, jsonb)',
$a$    subtotal, desconto, frete, total, troco, observacao, entrega, loja_vendedor_id
  ) values ($a$,
$a$    subtotal, desconto, frete, total, troco, observacao, entrega, loja_vendedor_id, documento_fiscal
  ) values ($a$);
select pg_temp.trocar_no_corpo('public.gestao_venda_finalizar(uuid, jsonb)',
$a$    nullif(p_dados ->> 'loja_vendedor_id', '')::uuid
  ) returning id into v_id;$a$,
$a$    nullif(p_dados ->> 'loja_vendedor_id', '')::uuid, v_doc
  ) returning id into v_id;$a$);

-- -----------------------------------------------------------------------------
-- 9. Cupom não tem carta de correção; avisos dizem se é NF-e ou NFC-e
-- -----------------------------------------------------------------------------
select pg_temp.trocar_no_corpo('public.nfe_carta_correcao(uuid, text)',
$a$    raise exception 'A carta de correção é para nota autorizada (e não cancelada).';
  end if;$a$,
$a$    raise exception 'A carta de correção é para nota autorizada (e não cancelada).';
  end if;
  if v.modelo = 65 then
    raise exception 'Cupom fiscal (NFC-e) não tem carta de correção: cancele e emita de novo.';
  end if;$a$);
select pg_temp.trocar_no_corpo('public.nfe_avisar(uuid)',
$a$v_titulo := 'NF-e$a$,
$a$v_titulo := (case when v.modelo = 65 then 'NFC-e' else 'NF-e' end) || '$a$);

revoke all on function public.nfce_configurar(uuid, jsonb) from public, anon;
grant execute on function public.nfce_configurar(uuid, jsonb) to authenticated;
