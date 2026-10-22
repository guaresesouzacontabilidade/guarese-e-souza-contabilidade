-- =============================================================================
-- Emissão de CT-e (modelo 57, versão 4.00) pelo portal — transporte rodoviário de carga
--
-- A transportadora presta o frete e emite o CT-e com o certificado A1 da
-- própria empresa, no autorizador do estado dela (MT tem autorizador próprio;
-- TO e outros usam a SVRS). O escritório liga a emissão, escolhe o ambiente,
-- a série e o RNTRC e cadastra as operações do frete (CFOP e regras do ICMS e
-- do IBS/CBS). Quem emite escolhe o tomador, o remetente e o destinatário
-- (cadastro compartilhado com a NF-e), as NF-e da carga, o peso e o valor do
-- frete; o banco monta os dados com as regras da operação, reserva o número e
-- põe na fila. Sem certificado e autorização do cliente, a emissão fica
-- desligada: nada é enviado à SEFAZ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões: cte.emitir (equipe e titular) e cte.configurar (só equipe)
-- -----------------------------------------------------------------------------
create or replace function app.permissoes_validas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'empresa.ver',
    'empresa.editar',
    'usuarios.gerenciar',
    'documentos.ver',
    'documentos.enviar',
    'documentos.baixar',
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'financeiro.ver',
    'financeiro.editar',
    'financeiro.importar',
    'conciliacao.executar',
    'relatorios.ver',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'mensagens.usar',
    'calculos.ver',
    'calculos.gerenciar',
    'colaboradores.gerenciar',
    'certificado.gerenciar',
    'auditor.ver',
    'auditor.gerenciar',
    'maquininhas.ver',
    'maquininhas.gerenciar',
    'nfse.emitir',
    'nfse.configurar',
    'nfe.emitir',
    'nfe.configurar',
    'gestao.vender',
    'gestao.gerenciar',
    'cte.emitir',
    'cte.configurar'
  ]::text[];
$$;

create or replace function app.permissoes_exclusivas_equipe()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'calculos.gerenciar',
    'auditor.gerenciar',
    'nfse.configurar',
    'nfe.configurar',
    'cte.configurar'
  ]::text[];
$$;

create or replace function app.permissoes_padrao(p_papel text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'equipe' then array[
      'empresa.ver', 'empresa.editar', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar', 'documentos.revisar', 'documentos.publicar',
      'checklist.gerenciar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar', 'conciliacao.executar',
      'relatorios.ver', 'relatorios.publicar',
      'fechamento.gerenciar',
      'mensagens.usar',
      'calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver', 'auditor.gerenciar',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir', 'nfse.configurar',
      'nfe.emitir', 'nfe.configurar',
      'gestao.vender', 'gestao.gerenciar',
      'cte.emitir', 'cte.configurar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir',
      'nfe.emitir',
      'gestao.vender', 'gestao.gerenciar',
      'cte.emitir'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

create or replace function app.tg_validar_membro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from public.perfis where id = new.user_id;
  if v_tipo is null then
    raise exception 'Usuário inexistente.';
  end if;
  if new.papel = 'equipe' and v_tipo not in ('admin', 'equipe') then
    raise exception 'Somente usuários da equipe do escritório podem ter o papel "equipe".';
  end if;
  if new.papel <> 'equipe' and v_tipo <> 'cliente' then
    raise exception 'Usuários da equipe não podem ser vinculados como clientes.';
  end if;
  if new.papel <> 'equipe' and new.permissoes && app.permissoes_exclusivas_equipe() then
    raise exception 'Permissões exclusivas da equipe não podem ser concedidas a clientes.';
  end if;
  -- Quem pode ver qualquer coisa precisa ao menos ver a empresa.
  if cardinality(new.permissoes) > 0 and not ('empresa.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'empresa.ver');
  end if;
  -- Baixar documentos implica ver documentos.
  if 'documentos.baixar' = any(new.permissoes) and not ('documentos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'documentos.ver');
  end if;
  if 'financeiro.editar' = any(new.permissoes) and not ('financeiro.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'financeiro.ver');
  end if;
  -- Configurar os cálculos ou cadastrar colaboradores implica ver os cálculos.
  if (new.permissoes && array['calculos.gerenciar', 'colaboradores.gerenciar']) and not ('calculos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'calculos.ver');
  end if;
  -- Conduzir o auditor implica ver os achados.
  if 'auditor.gerenciar' = any(new.permissoes) and not ('auditor.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'auditor.ver');
  end if;
  -- Cadastrar contratos e importar relatórios implica ver a conferência das maquininhas.
  if 'maquininhas.gerenciar' = any(new.permissoes) and not ('maquininhas.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'maquininhas.ver');
  end if;
  -- Configurar a emissão implica poder emitir.
  if 'nfse.configurar' = any(new.permissoes) and not ('nfse.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'nfse.emitir');
  end if;
  if 'nfe.configurar' = any(new.permissoes) and not ('nfe.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'nfe.emitir');
  end if;
  if 'cte.configurar' = any(new.permissoes) and not ('cte.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'cte.emitir');
  end if;
  -- Gerenciar a loja implica poder vender.
  if 'gestao.gerenciar' = any(new.permissoes) and not ('gestao.vender' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'gestao.vender');
  end if;
  return new;
end;
$$;

update public.empresa_membros
   set permissoes = permissoes || array['cte.emitir', 'cte.configurar']
 where papel = 'equipe' and not (permissoes && array['cte.emitir', 'cte.configurar']);
update public.empresa_membros
   set permissoes = permissoes || array['cte.emitir']
 where papel = 'cliente_titular' and not ('cte.emitir' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['cte.emitir', 'cte.configurar']
 where status = 'pendente' and papel = 'equipe' and cardinality(permissoes) > 0 and not (permissoes && array['cte.emitir', 'cte.configurar']);
update public.convites
   set permissoes = permissoes || array['cte.emitir']
 where status = 'pendente' and papel = 'cliente_titular' and cardinality(permissoes) > 0 and not ('cte.emitir' = any(permissoes));

-- -----------------------------------------------------------------------------
-- 2. Cadastros compartilhados com a NF-e: o estabelecimento que emite (com a
--    inscrição estadual e o endereço) e os clientes (tomador, remetente e
--    destinatário do frete) também são lidos por quem emite CT-e
-- -----------------------------------------------------------------------------
create or replace function app.pode_documento_fiscal(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.pode(p_empresa_id, 'nfe.emitir') or app.pode(p_empresa_id, 'nfe.configurar')
      or app.pode(p_empresa_id, 'cte.emitir') or app.pode(p_empresa_id, 'cte.configurar');
$$;
revoke execute on function app.pode_documento_fiscal(uuid) from public, anon;
grant execute on function app.pode_documento_fiscal(uuid) to authenticated;

drop policy nfe_emitentes_leitura on public.nfe_emitentes;
create policy nfe_emitentes_leitura on public.nfe_emitentes for select to authenticated using ((select app.pode_documento_fiscal(empresa_id)));
drop policy nfe_destinatarios_leitura on public.nfe_destinatarios;
create policy nfe_destinatarios_leitura on public.nfe_destinatarios for select to authenticated using ((select app.pode_documento_fiscal(empresa_id)));

-- Quem emite CT-e também cadastra o cliente do frete (mesmo cadastro da NF-e)
create or replace function public.nfe_destinatario_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tipo text := p_dados ->> 'tipo';
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_ind smallint := (p_dados ->> 'indicador_ie')::smallint;
  v_ie text := nullif(regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'), '');
begin
  if not (app.pode(p_empresa_id, 'nfe.emitir') or app.pode(p_empresa_id, 'cte.emitir')) then
    perform app.exigir(p_empresa_id, 'nfe.emitir');
  end if;
  if v_tipo = 'cpf' and (v_doc is null or not app.cpf_valido(v_doc)) then
    raise exception 'CPF do cliente inválido.';
  end if;
  if v_tipo = 'cnpj' and (v_doc is null or not app.cnpj_valido(v_doc)) then
    raise exception 'CNPJ do cliente inválido.';
  end if;
  if v_tipo = 'estrangeiro' then
    v_doc := nullif(trim(coalesce(p_dados ->> 'documento', '')), '');
    v_ind := 9;
  end if;
  if v_ind = 1 and v_ie is null then
    raise exception 'Informe a inscrição estadual do cliente (contribuinte do ICMS).';
  end if;
  if v_ind <> 1 then
    v_ie := null;
  end if;
  if p_id is not null and not exists (select 1 from public.nfe_destinatarios where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  insert into public.nfe_destinatarios as d (id, empresa_id, tipo, documento, nome, indicador_ie, inscricao_estadual, logradouro, numero, complemento, bairro, municipio_ibge, codigo_pais, pais, cidade_exterior, cep, telefone, email)
  values (coalesce(p_id, gen_random_uuid()), p_empresa_id,
          v_tipo,
          v_doc,
          trim(p_dados ->> 'nome'),
          v_ind,
          v_ie,
          trim(p_dados ->> 'logradouro'),
          coalesce(nullif(trim(p_dados ->> 'numero'), ''), 'SN'),
          nullif(trim(p_dados ->> 'complemento'), ''),
          coalesce(nullif(trim(p_dados ->> 'bairro'), ''), 'Centro'),
          case when v_tipo = 'estrangeiro' then null else nullif(p_dados ->> 'municipio_ibge', '') end,
          case when v_tipo = 'estrangeiro' then nullif(p_dados ->> 'codigo_pais', '') end,
          case when v_tipo = 'estrangeiro' then nullif(trim(p_dados ->> 'pais'), '') end,
          case when v_tipo = 'estrangeiro' then nullif(trim(p_dados ->> 'cidade_exterior'), '') end,
          nullif(regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'), ''),
          nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
          nullif(lower(trim(p_dados ->> 'email')), ''))
  on conflict (id) do update set
    tipo = excluded.tipo,
    documento = excluded.documento,
    nome = excluded.nome,
    indicador_ie = excluded.indicador_ie,
    inscricao_estadual = excluded.inscricao_estadual,
    logradouro = excluded.logradouro,
    numero = excluded.numero,
    complemento = excluded.complemento,
    bairro = excluded.bairro,
    municipio_ibge = excluded.municipio_ibge,
    codigo_pais = excluded.codigo_pais,
    pais = excluded.pais,
    cidade_exterior = excluded.cidade_exterior,
    cep = excluded.cep,
    telefone = excluded.telefone,
    email = excluded.email
  returning d.id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Configuração e operações do frete
-- -----------------------------------------------------------------------------
create table public.cte_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativa boolean not null default false,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  -- 1 Simples Nacional; 2 Simples com excesso de sublimite; 3 regime normal; 4 MEI
  crt smallint not null default 3 check (crt in (1, 2, 3, 4)),
  -- Estabelecimento que emite (inscrição estadual e endereço do cadastro da NF-e)
  emitente_id uuid references public.nfe_emitentes(id) on delete restrict,
  serie int not null default 1 check (serie between 0 and 889),
  proximo_numero_homologacao bigint not null default 1 check (proximo_numero_homologacao between 1 and 999999999),
  proximo_numero_producao bigint not null default 1 check (proximo_numero_producao between 1 and 999999999),
  -- Registro na ANTT (8 números) ou ISENTO
  rntrc text check (rntrc is null or rntrc ~ '^([0-9]{8}|ISENTO)$'),
  autorizar_escritorio_xml boolean not null default true,
  informacoes_padrao text check (informacoes_padrao is null or length(informacoes_padrao) <= 2000),
  -- Autorização do cliente para o portal emitir CT-e com o certificado da empresa
  autorizacao_texto text check (autorizacao_texto is null or length(autorizacao_texto) between 10 and 2000),
  autorizado_por uuid references public.perfis(id) on delete set null,
  autorizado_em timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cte_config_ativa_completa check (not ativa or (autorizacao_texto is not null and autorizado_em is not null and emitente_id is not null and rntrc is not null))
);
create trigger cte_config_updated_at before update on public.cte_config for each row execute function app.tg_updated_at();
create trigger auditoria_cte_config after insert or update or delete on public.cte_config for each row execute function app.tg_auditoria();

-- Regras fiscais do frete, cadastradas pelo escritório
create table public.cte_operacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  natureza text not null check (length(trim(natureza)) between 2 and 60),
  -- Prestação dentro do estado (CFOP 5.35x/5.360) ou para outro estado (6.35x/6.360)
  destino text not null check (destino in ('interna', 'interestadual')),
  cfop text not null check (cfop ~ '^[56](35[1-9]|360)$'),
  -- ICMS: 00 normal; 20 com redução da base; 40 isenta; 41 não tributada; 51 diferida; 60 cobrado por substituição;
  -- 90 outros (com crédito presumido, quando houver); sn Simples Nacional
  icms_cst text not null check (icms_cst in ('00', '20', '40', '41', '51', '60', '90', 'sn')),
  icms_aliquota numeric(5, 2) check (icms_aliquota is null or icms_aliquota between 0 and 100),
  icms_reducao numeric(5, 2) check (icms_reducao is null or icms_reducao between 0 and 100),
  -- Crédito presumido/outorgado (percentual sobre o ICMS), informado no grupo do CST 60 ou 90
  icms_credito_presumido numeric(5, 2) check (icms_credito_presumido is null or icms_credito_presumido between 0 and 100),
  icms_beneficio text check (icms_beneficio is null or icms_beneficio ~ '^([!-ÿ]{8}|[!-ÿ]{10}|SEM CBENEF)$'),
  -- IBS/CBS (classificação oficial)
  ibscbs_cclass_trib text references public.nfe_cclass_trib(cclass_trib),
  ibscbs_diferimento numeric(5, 2) check (ibscbs_diferimento is null or ibscbs_diferimento between 0 and 100),
  -- Base do IBS/CBS sem o ICMS do frete
  excluir_icms_base_ibscbs boolean not null default true,
  informacoes text check (informacoes is null or length(informacoes) <= 2000),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cte_operacoes_cfop_destino check ((destino = 'interna' and cfop like '5%') or (destino = 'interestadual' and cfop like '6%')),
  constraint cte_operacoes_icms check (
    (icms_cst not in ('00', '20', '60', '90') or icms_aliquota is not null)
    and (icms_cst <> '20' or coalesce(icms_reducao, 0) > 0)
    and (icms_cst = '20' or icms_reducao is null)
    and (icms_cst in ('60', '90') or icms_credito_presumido is null)
  )
);
create index cte_operacoes_empresa_idx on public.cte_operacoes (empresa_id, nome);
create trigger cte_operacoes_updated_at before update on public.cte_operacoes for each row execute function app.tg_updated_at();
create trigger auditoria_cte_operacoes after insert or update or delete on public.cte_operacoes for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 4. CT-e emitidos e eventos
-- -----------------------------------------------------------------------------
create table public.cte_emissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  operacao_id uuid references public.cte_operacoes(id) on delete set null,
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  serie int not null check (serie between 0 and 889),
  numero bigint not null check (numero between 1 and 999999999),
  codigo_numerico text not null check (codigo_numerico ~ '^[0-9]{8}$'),
  -- na_fila → enviando → autorizada | rejeitada | denegada | falha (sem resposta: tenta de novo)
  -- autorizada → cancelando → cancelada; rejeitada → (corrigida) na_fila | descartada
  situacao text not null default 'na_fila'
    check (situacao in ('na_fila', 'enviando', 'aguardando', 'autorizada', 'rejeitada', 'denegada', 'falha', 'cancelando', 'cancelada', 'descartada')),
  pedido jsonb not null check (jsonb_typeof(pedido) = 'object' and pg_column_size(pedido) <= 300000),
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and pg_column_size(dados) <= 500000),
  natureza text not null,
  tomador_nome text not null,
  tomador_documento text,
  uf_inicio char(2) not null check (uf_inicio ~ '^[A-Z]{2}$'),
  uf_fim char(2) not null check (uf_fim ~ '^[A-Z]{2}$'),
  municipio_inicio text not null,
  municipio_fim text not null,
  valor_total numeric(15, 2) not null check (valor_total > 0),
  valor_carga numeric(15, 2),
  peso_kg numeric(15, 4),
  nfe_chaves text[] not null default '{}' check (cardinality(nfe_chaves) <= 2000),
  -- Ordem de carregamento de origem (quando o CT-e saiu dela), só como referência para a tela
  origem jsonb check (origem is null or jsonb_typeof(origem) = 'object'),
  -- Preenchidos no envio
  emitida_em timestamptz,
  chave text check (chave is null or chave ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'),
  totais jsonb check (totais is null or jsonb_typeof(totais) = 'object'),
  xml_assinado text check (xml_assinado is null or length(xml_assinado) <= 1000000),
  -- Retorno da SEFAZ
  protocolo text check (protocolo is null or protocolo ~ '^[0-9]{15}$'),
  autorizada_em timestamptz,
  xml_autorizado text check (xml_autorizado is null or length(xml_autorizado) <= 1100000),
  documento_id uuid references public.documentos(id) on delete set null,
  mensagens jsonb check (mensagens is null or (jsonb_typeof(mensagens) = 'array' and pg_column_size(mensagens) <= 20000)),
  tentativas int not null default 0,
  ultimo_envio_em timestamptz,
  cancelada_em timestamptz,
  descartada_em timestamptz,
  pedido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cte_emissoes_numero_uk unique (empresa_id, ambiente, serie, numero),
  constraint cte_emissoes_autorizada check (situacao not in ('autorizada', 'cancelando', 'cancelada') or (chave is not null and protocolo is not null and xml_autorizado is not null))
);
create unique index cte_emissoes_chave_uk on public.cte_emissoes (chave) where chave is not null and situacao not in ('rejeitada', 'descartada');
create index cte_emissoes_empresa_idx on public.cte_emissoes (empresa_id, created_at desc);
create index cte_emissoes_pendentes_idx on public.cte_emissoes (situacao) where situacao in ('na_fila', 'enviando', 'aguardando', 'falha', 'cancelando');
create index cte_emissoes_nfe_idx on public.cte_emissoes using gin (nfe_chaves);
create trigger cte_emissoes_updated_at before update on public.cte_emissoes for each row execute function app.tg_updated_at();

create table public.cte_eventos (
  id uuid primary key default gen_random_uuid(),
  emissao_id uuid not null references public.cte_emissoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento', 'carta_correcao')),
  sequencia smallint not null check (sequencia between 1 and 20),
  -- Justificativa do cancelamento ou resumo da carta de correção
  texto text not null check (length(trim(texto)) between 15 and 1000),
  -- Carta de correção: [{grupo, campo, valor}] (o CT-e corrige campo a campo)
  correcoes jsonb check (correcoes is null or (jsonb_typeof(correcoes) = 'array' and jsonb_array_length(correcoes) between 1 and 20)),
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'enviando', 'registrado', 'rejeitado', 'falha')),
  protocolo text check (protocolo is null or protocolo ~ '^[0-9]{15}$'),
  registrado_em timestamptz,
  xml text check (xml is null or length(xml) <= 200000),
  mensagens jsonb check (mensagens is null or (jsonb_typeof(mensagens) = 'array' and pg_column_size(mensagens) <= 20000)),
  tentativas int not null default 0,
  pedido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cte_eventos_seq_uk unique (emissao_id, tipo, sequencia),
  constraint cte_eventos_correcoes check ((tipo = 'carta_correcao') = (correcoes is not null))
);
create index cte_eventos_emissao_idx on public.cte_eventos (emissao_id, created_at);
create trigger cte_eventos_updated_at before update on public.cte_eventos for each row execute function app.tg_updated_at();

-- Acesso: leitura por quem emite ou configura; escrita só pelas funções
do $$
declare
  t text;
begin
  foreach t in array array['cte_config', 'cte_operacoes', 'cte_emissoes', 'cte_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.pode(empresa_id, ''cte.emitir'')) or (select app.pode(empresa_id, ''cte.configurar'')))',
      t || '_leitura', t
    );
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Funções do escritório
-- -----------------------------------------------------------------------------
create or replace function public.cte_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual public.cte_config;
  v_ambiente text := coalesce(nullif(p_dados ->> 'ambiente', ''), 'homologacao');
  v_ativa boolean := coalesce((p_dados ->> 'ativa')::boolean, false);
  v_aut text := nullif(trim(p_dados ->> 'autorizacao_texto'), '');
  v_emit uuid := nullif(p_dados ->> 'emitente_id', '')::uuid;
  v_rntrc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'rntrc', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_serie int := coalesce(nullif(p_dados ->> 'serie', '')::int, 1);
begin
  perform app.exigir(p_empresa_id, 'cte.configurar');
  if exists (select 1 from public.empresas where id = p_empresa_id and demonstracao) and v_ativa and v_ambiente = 'producao' then
    raise exception 'Empresa de demonstração não emite CT-e em produção.';
  end if;
  if v_ambiente not in ('homologacao', 'producao') then
    raise exception 'Escolha o ambiente: teste (homologação) ou produção.';
  end if;
  if v_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_emit and empresa_id = p_empresa_id and ativo) then
    raise exception 'O estabelecimento escolhido não é desta empresa ou está desativado.';
  end if;
  if v_rntrc is not null then
    v_rntrc := case when v_rntrc = 'ISENTO' then v_rntrc else lpad(v_rntrc, 8, '0') end;
    if v_rntrc !~ '^([0-9]{8}|ISENTO)$' then
      raise exception 'RNTRC inválido: são 8 números (registro na ANTT).';
    end if;
  end if;
  if v_serie not between 0 and 889 then
    raise exception 'Série do CT-e inválida (0 a 889).';
  end if;
  select * into v_atual from public.cte_config where empresa_id = p_empresa_id;
  if v_ativa then
    if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
      raise exception 'Cadastre o certificado digital A1 da empresa (válido) antes de ligar a emissão.';
    end if;
    if v_emit is null then
      raise exception 'Escolha o estabelecimento (inscrição estadual) que emite o CT-e.';
    end if;
    if v_rntrc is null then
      raise exception 'Informe o RNTRC da transportadora (registro na ANTT).';
    end if;
    if not exists (select 1 from public.cte_operacoes o where o.empresa_id = p_empresa_id and o.ativa) then
      raise exception 'Cadastre ao menos uma operação do frete (CFOP e impostos) antes de ligar a emissão.';
    end if;
    if coalesce(v_aut, v_atual.autorizacao_texto) is null then
      raise exception 'Registre como o cliente autorizou o portal a emitir CT-e com o certificado da empresa.';
    end if;
  end if;
  -- A série muda a numeração: não deixa trocar depois de emitir nela
  if v_atual.empresa_id is not null and v_atual.serie <> v_serie
     and exists (select 1 from public.cte_emissoes e where e.empresa_id = p_empresa_id and e.serie = v_atual.serie) then
    raise exception 'Já há CT-e emitido na série %. Para mudar de série, fale com o suporte do portal.', v_atual.serie;
  end if;
  insert into public.cte_config as c (
    empresa_id, ativa, ambiente, crt, emitente_id, serie, rntrc, autorizar_escritorio_xml, informacoes_padrao,
    autorizacao_texto, autorizado_por, autorizado_em, atualizado_por
  ) values (
    p_empresa_id, v_ativa, v_ambiente, coalesce((p_dados ->> 'crt')::smallint, 3), v_emit, v_serie, v_rntrc,
    coalesce((p_dados ->> 'autorizar_escritorio_xml')::boolean, true),
    nullif(trim(p_dados ->> 'informacoes_padrao'), ''),
    coalesce(v_aut, v_atual.autorizacao_texto),
    case when v_aut is not null then auth.uid() else v_atual.autorizado_por end,
    case when v_aut is not null then now() else v_atual.autorizado_em end,
    auth.uid()
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    ambiente = excluded.ambiente,
    crt = excluded.crt,
    emitente_id = excluded.emitente_id,
    serie = excluded.serie,
    rntrc = excluded.rntrc,
    autorizar_escritorio_xml = excluded.autorizar_escritorio_xml,
    informacoes_padrao = excluded.informacoes_padrao,
    autorizacao_texto = excluded.autorizacao_texto,
    autorizado_por = excluded.autorizado_por,
    autorizado_em = excluded.autorizado_em,
    atualizado_por = auth.uid();
end;
$$;

create or replace function public.cte_operacao_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cst text := nullif(p_dados ->> 'icms_cst', '');
  v_class text := nullif(p_dados ->> 'ibscbs_cclass_trib', '');
  v_crt smallint;
begin
  perform app.exigir(p_empresa_id, 'cte.configurar');
  if p_id is not null and not exists (select 1 from public.cte_operacoes where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Operação não encontrada.';
  end if;
  select crt into v_crt from public.cte_config where empresa_id = p_empresa_id;
  if coalesce(v_crt, 3) in (1, 4) and v_cst <> 'sn' then
    raise exception 'Empresa do Simples Nacional: use o ICMS "Simples Nacional" na operação.';
  end if;
  if coalesce(v_crt, 3) not in (1, 4) and v_cst = 'sn' then
    raise exception 'Empresa fora do Simples Nacional: escolha o CST do ICMS da operação.';
  end if;
  -- O ambiente de teste da SEFAZ já exige o grupo do IBS/CBS no CT-e (NT 2026.002, regra 001), em qualquer regime
  if v_class is null then
    raise exception 'A operação precisa da classificação do IBS/CBS (cClassTrib).';
  end if;
  if v_class is not null and not exists (select 1 from public.nfe_cclass_trib where cclass_trib = v_class) then
    raise exception 'Classificação do IBS/CBS inexistente na tabela oficial.';
  end if;
  insert into public.cte_operacoes as o (
    id, empresa_id, nome, natureza, destino, cfop, icms_cst, icms_aliquota, icms_reducao, icms_credito_presumido, icms_beneficio,
    ibscbs_cclass_trib, ibscbs_diferimento, excluir_icms_base_ibscbs, informacoes, ativa
  ) values (
    coalesce(p_id, gen_random_uuid()), p_empresa_id, trim(p_dados ->> 'nome'), upper(trim(p_dados ->> 'natureza')),
    p_dados ->> 'destino', regexp_replace(coalesce(p_dados ->> 'cfop', ''), '\D', '', 'g'), v_cst,
    nullif(p_dados ->> 'icms_aliquota', '')::numeric, nullif(p_dados ->> 'icms_reducao', '')::numeric,
    nullif(p_dados ->> 'icms_credito_presumido', '')::numeric, nullif(upper(trim(p_dados ->> 'icms_beneficio')), ''),
    v_class, nullif(p_dados ->> 'ibscbs_diferimento', '')::numeric,
    coalesce((p_dados ->> 'excluir_icms_base_ibscbs')::boolean, true),
    nullif(trim(p_dados ->> 'informacoes'), ''), coalesce((p_dados ->> 'ativa')::boolean, true)
  )
  on conflict (id) do update set
    nome = excluded.nome,
    natureza = excluded.natureza,
    destino = excluded.destino,
    cfop = excluded.cfop,
    icms_cst = excluded.icms_cst,
    icms_aliquota = excluded.icms_aliquota,
    icms_reducao = excluded.icms_reducao,
    icms_credito_presumido = excluded.icms_credito_presumido,
    icms_beneficio = excluded.icms_beneficio,
    ibscbs_cclass_trib = excluded.ibscbs_cclass_trib,
    ibscbs_diferimento = excluded.ibscbs_diferimento,
    excluir_icms_base_ibscbs = excluded.excluir_icms_base_ibscbs,
    informacoes = excluded.informacoes,
    ativa = excluded.ativa
  returning o.id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Emitir: monta o CT-e com as regras da operação, reserva o número e põe na fila
-- -----------------------------------------------------------------------------

-- Participante do frete (cliente do cadastro) no formato do CT-e
create or replace function app.cte_participante(p_empresa_id uuid, p_id uuid, p_papel text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.nfe_destinatarios;
  v_mun text;
  v_uf text;
begin
  select * into v from public.nfe_destinatarios where id = p_id and empresa_id = p_empresa_id;
  if v.id is null then
    raise exception 'Escolha o %.', p_papel;
  end if;
  if v.tipo = 'estrangeiro' then
    raise exception 'O % é estrangeiro: o CT-e para o exterior ainda não é emitido pelo portal.', p_papel;
  end if;
  select nome, uf into v_mun, v_uf from public.municipios where ibge = v.municipio_ibge;
  if v_uf is null then
    raise exception 'Falta o município no endereço do % (%).', p_papel, v.nome;
  end if;
  return jsonb_build_object(
    'tipo', v.tipo, 'documento', v.documento, 'nome', v.nome, 'indicadorIe', v.indicador_ie, 'inscricaoEstadual', v.inscricao_estadual,
    'telefone', v.telefone, 'email', v.email,
    'endereco', jsonb_build_object('logradouro', v.logradouro, 'numero', v.numero, 'complemento', v.complemento, 'bairro', v.bairro,
                                   'codigoMunicipio', v.municipio_ibge, 'municipio', v_mun, 'uf', v_uf, 'cep', v.cep));
end;
$$;

create or replace function app.cte_montar_dados(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.cte_config;
  v_emp public.empresas;
  v_emi public.nfe_emitentes;
  v_op public.cte_operacoes;
  v_cl public.nfe_cclass_trib;
  v_esc public.escritorio;
  v_uf_emi text;
  v_mun_emi text;
  v_rem jsonb;
  v_dest jsonb;
  v_toma jsonb;
  v_papel smallint;
  v_ini_ibge text;
  v_ini_nome text;
  v_ini_uf text;
  v_fim_ibge text;
  v_fim_nome text;
  v_fim_uf text;
  v_prest numeric := nullif(p_dados ->> 'valor_prestacao', '')::numeric;
  v_rec numeric := nullif(p_dados ->> 'valor_receber', '')::numeric;
  v_peso numeric := nullif(p_dados #>> '{carga,peso_kg}', '')::numeric;
  v_vcarga numeric := nullif(p_dados #>> '{carga,valor}', '')::numeric;
  v_produto text := nullif(trim(p_dados #>> '{carga,produto}'), '');
  v_comps jsonb := '[]'::jsonb;
  c jsonb;
  v_soma numeric := 0;
  v_chaves text[];
  v_obs text;
  v_ind smallint;
begin
  select * into v_cfg from public.cte_config where empresa_id = p_empresa_id;
  select * into v_emp from public.empresas where id = p_empresa_id;
  if v_cfg.empresa_id is null or v_cfg.emitente_id is null or v_cfg.rntrc is null then
    raise exception 'A emissão de CT-e desta empresa ainda não foi configurada pelo escritório (estabelecimento e RNTRC).';
  end if;
  select * into v_emi from public.nfe_emitentes where id = v_cfg.emitente_id and ativo;
  if v_emi.id is null then
    raise exception 'O estabelecimento que emite o CT-e está desativado. Fale com o escritório.';
  end if;
  select uf, nome into v_uf_emi, v_mun_emi from public.municipios where ibge = v_emi.municipio_ibge;
  select * into v_op from public.cte_operacoes where id = nullif(p_dados ->> 'operacao_id', '')::uuid and empresa_id = p_empresa_id and ativa;
  if v_op.id is null then
    raise exception 'Escolha uma das operações do frete cadastradas pelo escritório.';
  end if;
  if (v_cfg.crt in (1, 4)) <> (v_op.icms_cst = 'sn') then
    raise exception 'O ICMS da operação "%" não combina com o regime da empresa na configuração. Fale com o escritório.', v_op.nome;
  end if;
  if v_op.ibscbs_cclass_trib is not null then
    select * into v_cl from public.nfe_cclass_trib where cclass_trib = v_op.ibscbs_cclass_trib;
  end if;
  if v_cl.cclass_trib is null then
    raise exception 'A operação "%" está sem a classificação do IBS/CBS. Fale com o escritório.', v_op.nome;
  end if;

  -- Remetente e destinatário da carga; tomador (quem paga o frete)
  v_rem := app.cte_participante(p_empresa_id, nullif(p_dados ->> 'remetente_id', '')::uuid, 'remetente');
  v_dest := app.cte_participante(p_empresa_id, nullif(p_dados ->> 'destinatario_id', '')::uuid, 'destinatário');
  case coalesce(p_dados ->> 'tomador', '')
    when 'remetente' then v_papel := 0; v_toma := v_rem;
    when 'destinatario' then v_papel := 3; v_toma := v_dest;
    when 'outro' then v_papel := 4; v_toma := app.cte_participante(p_empresa_id, nullif(p_dados ->> 'tomador_id', '')::uuid, 'tomador do serviço');
    else raise exception 'Escolha quem paga o frete (tomador): o remetente, o destinatário ou outro.';
  end case;
  v_ind := (v_toma ->> 'indicadorIe')::smallint;

  -- Início e fim da prestação (padrão: municípios do remetente e do destinatário)
  select m.ibge, m.nome, m.uf into v_ini_ibge, v_ini_nome, v_ini_uf from public.municipios m
   where m.ibge = coalesce(nullif(p_dados ->> 'municipio_inicio', ''), v_rem #>> '{endereco,codigoMunicipio}');
  select m.ibge, m.nome, m.uf into v_fim_ibge, v_fim_nome, v_fim_uf from public.municipios m
   where m.ibge = coalesce(nullif(p_dados ->> 'municipio_fim', ''), v_dest #>> '{endereco,codigoMunicipio}');
  if v_ini_ibge is null or v_fim_ibge is null then
    raise exception 'Informe os municípios de início e de fim da prestação.';
  end if;
  if v_ini_uf <> v_uf_emi then
    raise exception 'A prestação começa em % (fora de %): esse caso usa o CFOP 5932/6932 e ainda não é emitido pelo portal. Fale com o escritório.', v_ini_uf, v_uf_emi;
  end if;
  if v_op.destino = 'interna' and v_ini_uf <> v_fim_uf then
    raise exception 'A operação "%" é para dentro do estado, mas o frete vai de % para %.', v_op.nome, v_ini_uf, v_fim_uf;
  end if;
  if v_op.destino = 'interestadual' and v_ini_uf = v_fim_uf then
    raise exception 'A operação "%" é para outro estado, mas o frete começa e termina em %.', v_op.nome, v_ini_uf;
  end if;
  if v_op.destino = 'interestadual' and v_ind = 9 then
    raise exception 'Frete para outro estado com tomador não contribuinte do ICMS (partilha do ICMS) ainda não é emitido pelo portal.';
  end if;

  -- Valores
  if v_prest is null or v_prest <= 0 or v_prest <> round(v_prest, 2) or v_prest >= 10000000000000 then
    raise exception 'Informe o valor do frete (valor total da prestação).';
  end if;
  v_rec := coalesce(v_rec, v_prest);
  if v_rec < 0 or v_rec > v_prest or v_rec <> round(v_rec, 2) then
    raise exception 'O valor a receber não pode ser maior que o valor do frete.';
  end if;
  if jsonb_typeof(coalesce(p_dados -> 'componentes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_dados -> 'componentes', '[]'::jsonb)) > 30 then
    raise exception 'Componentes do frete inválidos (no máximo 30).';
  end if;
  for c in select * from jsonb_array_elements(coalesce(p_dados -> 'componentes', '[]'::jsonb)) loop
    if length(trim(coalesce(c ->> 'nome', ''))) not between 1 and 15 or nullif(c ->> 'valor', '')::numeric is null
       or (c ->> 'valor')::numeric < 0 or (c ->> 'valor')::numeric <> round((c ->> 'valor')::numeric, 2) then
      raise exception 'Cada componente do frete precisa de nome (até 15 letras) e valor.';
    end if;
    v_soma := v_soma + (c ->> 'valor')::numeric;
    v_comps := v_comps || jsonb_build_array(jsonb_build_object('nome', upper(trim(c ->> 'nome')), 'valor', (c ->> 'valor')::numeric));
  end loop;
  if jsonb_array_length(v_comps) > 0 and v_soma <> v_prest then
    raise exception 'A soma dos componentes (%) precisa ser igual ao valor do frete (%).', v_soma, v_prest;
  end if;

  -- Carga e NF-e transportadas
  if v_produto is null or length(v_produto) > 60 then
    raise exception 'Informe o produto predominante da carga (até 60 letras).';
  end if;
  if v_peso is null or v_peso <= 0 or v_peso <> round(v_peso, 4) or v_peso >= 100000000000 then
    raise exception 'Informe o peso da carga em kg.';
  end if;
  if v_vcarga is not null and (v_vcarga < 0 or v_vcarga <> round(v_vcarga, 2)) then
    raise exception 'Valor da carga inválido.';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_chaves
    from (select regexp_replace(x, '\D', '', 'g') as x from jsonb_array_elements_text(coalesce(p_dados -> 'nfes', '[]'::jsonb)) x) s
   where x <> '';
  if cardinality(v_chaves) = 0 then
    raise exception 'Informe a chave de acesso de ao menos uma NF-e da carga.';
  end if;
  if exists (select 1 from unnest(v_chaves) k where k !~ '^[0-9]{44}$' or substr(k, 21, 2) <> '55') then
    raise exception 'Chave de NF-e inválida: são 44 números de uma nota modelo 55.';
  end if;

  select * into v_esc from public.escritorio where id = 1;
  v_obs := nullif(concat_ws(' ', nullif(trim(v_op.informacoes), ''), nullif(trim(v_cfg.informacoes_padrao), ''), nullif(trim(p_dados ->> 'observacoes'), '')), '');

  return jsonb_build_object(
    'natureza', v_op.natureza,
    'cfop', v_op.cfop,
    'emitente', jsonb_build_object(
      'documento', v_emp.documento, 'nome', v_emp.razao_social, 'fantasia', v_emp.nome_fantasia,
      'inscricaoEstadual', v_emi.inscricao_estadual, 'crt', v_cfg.crt,
      'endereco', jsonb_build_object('logradouro', v_emi.logradouro, 'numero', v_emi.numero, 'complemento', v_emi.complemento, 'bairro', v_emi.bairro,
                                     'codigoMunicipio', v_emi.municipio_ibge, 'municipio', v_mun_emi, 'uf', v_uf_emi, 'cep', v_emi.cep, 'telefone', v_emi.telefone)),
    'rntrc', v_cfg.rntrc,
    'tomador', jsonb_build_object('papel', v_papel, 'indicadorIe', v_ind, 'participante', case when v_papel = 4 then v_toma end),
    'remetente', v_rem,
    'destinatario', v_dest,
    'inicio', jsonb_build_object('codigoMunicipio', v_ini_ibge, 'municipio', v_ini_nome, 'uf', v_ini_uf),
    'fim', jsonb_build_object('codigoMunicipio', v_fim_ibge, 'municipio', v_fim_nome, 'uf', v_fim_uf),
    'valorPrestacao', round(v_prest, 2)::text,
    'valorReceber', round(v_rec, 2)::text,
    'componentes', v_comps,
    'icms', jsonb_build_object('cst', v_op.icms_cst, 'aliquota', v_op.icms_aliquota, 'reducaoBase', v_op.icms_reducao,
                               'creditoPresumido', v_op.icms_credito_presumido, 'beneficio', v_op.icms_beneficio),
    'ibscbs', case when v_cl.cclass_trib is not null then jsonb_build_object(
      'cst', v_cl.cst, 'classificacao', v_cl.cclass_trib, 'reducaoIbs', v_cl.p_red_ibs, 'reducaoCbs', v_cl.p_red_cbs,
      'diferimento', v_op.ibscbs_diferimento, 'excluirIcms', v_op.excluir_icms_base_ibscbs) end,
    'carga', jsonb_build_object('valor', case when v_vcarga is not null then round(v_vcarga, 2)::text end, 'produto', v_produto,
                                'outras', nullif(trim(p_dados #>> '{carga,outras}'), ''),
                                'pesoKg', trim(trailing '.' from trim(trailing '0' from to_char(v_peso, 'FM99999999990.0000')))),
    'nfes', to_jsonb(v_chaves),
    'observacoes', v_obs,
    'responsavelTecnico', case when v_esc.cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$' and v_esc.email is not null and regexp_replace(coalesce(v_esc.telefone, ''), '\D', '', 'g') ~ '^[0-9]{6,14}$'
      then jsonb_build_object('cnpj', v_esc.cnpj, 'contato', v_esc.razao_social, 'email', v_esc.email, 'telefone', regexp_replace(v_esc.telefone, '\D', '', 'g')) end,
    'autorizadosXml', case when v_cfg.autorizar_escritorio_xml and v_esc.cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$' then jsonb_build_array(v_esc.cnpj) else '[]'::jsonb end,
    '_resumo', jsonb_build_object(
      'valor_total', round(v_prest, 2), 'tomador_nome', v_toma ->> 'nome', 'tomador_documento', v_toma ->> 'documento',
      'uf_inicio', v_ini_uf, 'uf_fim', v_fim_uf, 'municipio_inicio', v_ini_nome, 'municipio_fim', v_fim_nome,
      'valor_carga', round(v_vcarga, 2), 'peso_kg', v_peso, 'nfe_chaves', to_jsonb(v_chaves))
  );
end;
$$;

create or replace function public.cte_emitir(p_empresa_id uuid, p_dados jsonb, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.cte_config;
  v_ant public.cte_emissoes;
  v_dados jsonb;
  v_resumo jsonb;
  v_numero bigint;
  v_ccte text;
  v_id uuid;
  v_chaves text[];
  v_origem jsonb := case when jsonb_typeof(p_dados -> 'origem') = 'object' then p_dados -> 'origem' end;
begin
  perform app.exigir(p_empresa_id, 'cte.emitir');
  select * into v_cfg from public.cte_config where empresa_id = p_empresa_id for update;
  if v_cfg.empresa_id is null or not v_cfg.ativa then
    raise exception 'A emissão de CT-e desta empresa ainda não foi ligada pelo escritório.';
  end if;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  v_dados := app.cte_montar_dados(p_empresa_id, p_dados);
  v_resumo := v_dados -> '_resumo';
  v_dados := v_dados - '_resumo';
  select array_agg(x) into v_chaves from jsonb_array_elements_text(v_resumo -> 'nfe_chaves') x;

  if p_id is not null then
    -- CT-e rejeitado, corrigido: mesmo número (a SEFAZ não registrou o rejeitado)
    select * into v_ant from public.cte_emissoes where id = p_id and empresa_id = p_empresa_id for update;
    if v_ant.id is null then
      raise exception 'CT-e não encontrado.';
    end if;
    if v_ant.situacao <> 'rejeitada' then
      raise exception 'Só um CT-e rejeitado pode ser corrigido e enviado de novo.';
    end if;
    update public.cte_emissoes
       set operacao_id = (p_dados ->> 'operacao_id')::uuid, situacao = 'na_fila', pedido = p_dados - 'confirmar_repetida', dados = v_dados,
           natureza = v_dados ->> 'natureza', tomador_nome = v_resumo ->> 'tomador_nome', tomador_documento = v_resumo ->> 'tomador_documento',
           uf_inicio = v_resumo ->> 'uf_inicio', uf_fim = v_resumo ->> 'uf_fim', municipio_inicio = v_resumo ->> 'municipio_inicio',
           municipio_fim = v_resumo ->> 'municipio_fim', valor_total = (v_resumo ->> 'valor_total')::numeric,
           valor_carga = (v_resumo ->> 'valor_carga')::numeric, peso_kg = (v_resumo ->> 'peso_kg')::numeric, nfe_chaves = v_chaves,
           emitida_em = null, chave = null, totais = null, xml_assinado = null, mensagens = null, tentativas = 0
     where id = p_id;
    perform app.enfileirar('emitir_cte', jsonb_build_object('emissao_id', p_id), p_empresa_id,
                           'cte:' || p_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
    return jsonb_build_object('id', p_id, 'numero', v_ant.numero, 'serie', v_ant.serie, 'ambiente', v_ant.ambiente);
  end if;

  -- Proteção contra pedido repetido: as mesmas NF-e já têm CT-e válido
  if not coalesce((p_dados ->> 'confirmar_repetida')::boolean, false) and exists (
    select 1 from public.cte_emissoes e
     where e.empresa_id = p_empresa_id and e.nfe_chaves && v_chaves and e.situacao not in ('rejeitada', 'cancelada', 'descartada')
  ) then
    raise exception 'Já existe CT-e para uma destas NF-e. Confira a lista antes de emitir de novo (complemento e substituição não são feitos por aqui).'
      using errcode = 'P0002';
  end if;
  if (select count(*) from public.cte_emissoes e where e.empresa_id = p_empresa_id and e.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Limite de 60 CT-e por hora atingido. Aguarde um pouco ou fale com o escritório.';
  end if;

  -- Número (reservado agora) na série da empresa
  if v_cfg.ambiente = 'producao' then
    v_numero := v_cfg.proximo_numero_producao;
    update public.cte_config set proximo_numero_producao = v_numero + 1 where empresa_id = p_empresa_id;
  else
    v_numero := v_cfg.proximo_numero_homologacao;
    update public.cte_config set proximo_numero_homologacao = v_numero + 1 where empresa_id = p_empresa_id;
  end if;
  -- Código numérico (cCT) sorteado, diferente do número
  loop
    v_ccte := lpad((10000000 + floor(random() * 90000000))::bigint::text, 8, '0');
    exit when v_ccte <> lpad(v_numero::text, 8, '0') and v_ccte !~ '^(\d)\1{7}$';
  end loop;

  insert into public.cte_emissoes (
    empresa_id, operacao_id, ambiente, serie, numero, codigo_numerico, pedido, dados, natureza, tomador_nome, tomador_documento,
    uf_inicio, uf_fim, municipio_inicio, municipio_fim, valor_total, valor_carga, peso_kg, nfe_chaves, origem
  ) values (
    p_empresa_id, (p_dados ->> 'operacao_id')::uuid, v_cfg.ambiente, v_cfg.serie, v_numero, v_ccte, p_dados - 'confirmar_repetida', v_dados,
    v_dados ->> 'natureza', v_resumo ->> 'tomador_nome', v_resumo ->> 'tomador_documento',
    v_resumo ->> 'uf_inicio', v_resumo ->> 'uf_fim', v_resumo ->> 'municipio_inicio', v_resumo ->> 'municipio_fim',
    (v_resumo ->> 'valor_total')::numeric, (v_resumo ->> 'valor_carga')::numeric, (v_resumo ->> 'peso_kg')::numeric, v_chaves, v_origem
  ) returning id into v_id;

  perform app.enfileirar('emitir_cte', jsonb_build_object('emissao_id', v_id), p_empresa_id, 'cte:' || v_id::text, now(), 5);
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'serie', v_cfg.serie, 'ambiente', v_cfg.ambiente);
end;
$$;

-- Prévia: os dados que o CT-e terá (regras da operação), para conferir os valores antes de emitir
create or replace function public.cte_previa(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'cte.emitir');
  return app.cte_montar_dados(p_empresa_id, p_dados);
end;
$$;

create or replace function public.cte_tentar_de_novo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cte_emissoes;
begin
  select * into v from public.cte_emissoes where id = p_id;
  if v.id is null then
    raise exception 'CT-e não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'cte.emitir');
  if v.situacao not in ('falha', 'aguardando') then
    raise exception 'Só um CT-e que ficou sem resposta pode ser enviado de novo.';
  end if;
  update public.cte_emissoes set situacao = 'na_fila' where id = p_id;
  perform app.enfileirar('emitir_cte', jsonb_build_object('emissao_id', p_id), v.empresa_id,
                         'cte:' || p_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
end;
$$;

-- CT-e rejeitado que não será corrigido: o número fica sem uso (inutilizar na SEFAZ)
create or replace function public.cte_descartar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cte_emissoes;
begin
  select * into v from public.cte_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'CT-e não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'cte.emitir');
  if v.situacao <> 'rejeitada' then
    raise exception 'Só um CT-e rejeitado pode ser descartado.';
  end if;
  update public.cte_emissoes set situacao = 'descartada', descartada_em = now() where id = p_id;
end;
$$;

create or replace function public.cte_cancelar(p_id uuid, p_justificativa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cte_emissoes;
  v_ev uuid;
begin
  select * into v from public.cte_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'CT-e não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'cte.emitir');
  if v.situacao <> 'autorizada' then
    raise exception 'Só um CT-e autorizado pode ser cancelado.';
  end if;
  if length(trim(coalesce(p_justificativa, ''))) not between 15 and 255 then
    raise exception 'Explique o motivo do cancelamento (de 15 a 255 caracteres).';
  end if;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = v.empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  delete from public.cte_eventos where emissao_id = p_id and tipo = 'cancelamento' and situacao in ('rejeitado', 'falha');
  insert into public.cte_eventos (emissao_id, empresa_id, tipo, sequencia, texto) values (p_id, v.empresa_id, 'cancelamento', 1, trim(p_justificativa))
  returning id into v_ev;
  update public.cte_emissoes set situacao = 'cancelando', mensagens = null where id = p_id;
  perform app.enfileirar('evento_cte', jsonb_build_object('evento_id', v_ev), v.empresa_id, 'cte-evento:' || v_ev::text, now(), 5);
end;
$$;

-- Carta de correção do CT-e: campo a campo (grupo do leiaute, campo e o valor certo)
create or replace function public.cte_carta_correcao(p_id uuid, p_correcoes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cte_emissoes;
  v_seq smallint;
  v_ev uuid;
  c jsonb;
  v_lista jsonb := '[]'::jsonb;
  v_resumo text := '';
begin
  select * into v from public.cte_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'CT-e não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'cte.emitir');
  if v.situacao <> 'autorizada' then
    raise exception 'A carta de correção é para CT-e autorizado (e não cancelado).';
  end if;
  if jsonb_typeof(p_correcoes) <> 'array' or jsonb_array_length(p_correcoes) not between 1 and 20 then
    raise exception 'Informe de 1 a 20 correções.';
  end if;
  for c in select * from jsonb_array_elements(p_correcoes) loop
    if coalesce(c ->> 'grupo', '') !~ '^[A-Za-z]{1,20}$' or coalesce(c ->> 'campo', '') !~ '^[A-Za-z]{1,20}$'
       or length(trim(coalesce(c ->> 'valor', ''))) not between 1 and 500 then
      raise exception 'Correção inválida: escolha o campo e informe o valor certo (até 500 letras).';
    end if;
    -- Valores, alíquotas, datas, tomador, remetente e destinatário não se corrigem por carta (Convênio SINIEF 06/89, art. 58-B)
    if (c ->> 'grupo') in ('vPrest', 'Comp', 'imp', 'ICMS', 'ICMS00', 'ICMS20', 'ICMS45', 'ICMS60', 'ICMS90', 'ICMSSN', 'IBSCBS', 'gIBSCBS',
                           'ide', 'toma3', 'toma4', 'rem', 'dest', 'emit', 'enderEmit', 'enderReme', 'enderDest') then
      raise exception 'O campo %/% não pode ser corrigido por carta de correção.', c ->> 'grupo', c ->> 'campo';
    end if;
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('grupo', c ->> 'grupo', 'campo', c ->> 'campo', 'valor', trim(c ->> 'valor')));
    v_resumo := v_resumo || (c ->> 'grupo') || '/' || (c ->> 'campo') || ': ' || trim(c ->> 'valor') || '; ';
  end loop;
  if exists (select 1 from public.cte_eventos where emissao_id = p_id and tipo = 'carta_correcao' and situacao in ('na_fila', 'enviando')) then
    raise exception 'Já há uma carta de correção sendo enviada para este CT-e. Aguarde o retorno.';
  end if;
  delete from public.cte_eventos where emissao_id = p_id and tipo = 'carta_correcao' and situacao in ('rejeitado', 'falha');
  select coalesce(max(sequencia), 0) + 1 into v_seq from public.cte_eventos where emissao_id = p_id and tipo = 'carta_correcao';
  if v_seq > 20 then
    raise exception 'O CT-e já tem 20 cartas de correção (o máximo).';
  end if;
  insert into public.cte_eventos (emissao_id, empresa_id, tipo, sequencia, texto, correcoes)
  values (p_id, v.empresa_id, 'carta_correcao', v_seq, left(rtrim('Correção de ' || v_resumo, '; ') || '.', 1000), v_lista)
  returning id into v_ev;
  perform app.enfileirar('evento_cte', jsonb_build_object('evento_id', v_ev), v.empresa_id, 'cte-evento:' || v_ev::text, now(), 5);
end;
$$;

create or replace function public.cte_avisar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.cte_emissoes;
  v_link text;
  v_titulo text;
  v_corpo text;
begin
  select * into v from public.cte_emissoes where id = p_id;
  if v.id is null then
    return;
  end if;
  v_link := '/e/' || v.empresa_id::text || '/cte/' || v.id::text;
  if v.situacao = 'rejeitada' then
    v_titulo := 'CT-e não emitido';
    v_corpo := 'A SEFAZ recusou o CT-e de ' || to_char(v.valor_total, 'FM999G999G990D00') || '. Veja o motivo, corrija e envie de novo.';
  elsif v.situacao = 'denegada' then
    v_titulo := 'CT-e denegado';
    v_corpo := 'A SEFAZ denegou o uso do CT-e ' || v.numero || ' (irregularidade cadastral). Fale com o escritório.';
  elsif v.situacao = 'falha' then
    v_titulo := 'CT-e sem resposta da SEFAZ';
    v_corpo := 'A SEFAZ não respondeu. O portal tenta de novo; se continuar, fale com o escritório.';
  elsif v.situacao = 'cancelada' then
    v_titulo := 'CT-e cancelado';
    v_corpo := 'O cancelamento do CT-e ' || v.numero || ' foi registrado na SEFAZ.';
  elsif v.situacao = 'autorizada' and exists (select 1 from public.cte_eventos where emissao_id = p_id and tipo = 'cancelamento' and situacao = 'rejeitado') then
    v_titulo := 'Cancelamento do CT-e não aceito';
    v_corpo := 'A SEFAZ não aceitou o cancelamento do CT-e ' || v.numero || '. Veja o motivo.';
  else
    return;
  end if;
  perform app.notificar_clientes(v.empresa_id, 'cte.emitir', 'cte', v_titulo, v_corpo, v_link, false);
  perform app.notificar_equipe(v.empresa_id, 'cte', v_titulo, v_corpo, v_link, false);
end;
$$;

revoke execute on function public.cte_configurar(uuid, jsonb), public.cte_operacao_salvar(uuid, uuid, jsonb), public.cte_emitir(uuid, jsonb, uuid),
  public.cte_previa(uuid, jsonb), public.cte_tentar_de_novo(uuid), public.cte_descartar(uuid), public.cte_cancelar(uuid, text),
  public.cte_carta_correcao(uuid, jsonb), public.cte_avisar(uuid), app.cte_montar_dados(uuid, jsonb), app.cte_participante(uuid, uuid, text) from public, anon;
grant execute on function public.cte_configurar(uuid, jsonb), public.cte_operacao_salvar(uuid, uuid, jsonb), public.cte_emitir(uuid, jsonb, uuid),
  public.cte_previa(uuid, jsonb), public.cte_tentar_de_novo(uuid), public.cte_descartar(uuid), public.cte_cancelar(uuid, text),
  public.cte_carta_correcao(uuid, jsonb) to authenticated;
revoke execute on function public.cte_avisar(uuid), app.cte_montar_dados(uuid, jsonb), app.cte_participante(uuid, uuid, text) from authenticated;
grant execute on function public.cte_avisar(uuid), app.cte_montar_dados(uuid, jsonb), app.cte_participante(uuid, uuid, text) to service_role;
