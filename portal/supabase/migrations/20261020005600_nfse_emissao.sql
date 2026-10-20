-- =============================================================================
-- Emissão de NFS-e pelo portal (Emissor Nacional — Sefin Nacional, API)
--
--  * O cliente pede a nota (tomador, serviço, valor) e o portal emite na hora:
--    monta a DPS, assina com o certificado A1 da empresa e envia à Sefin
--    Nacional. A nota autorizada fica guardada (XML) e, em produção, entra
--    nos documentos fiscais da empresa como as demais.
--  * O escritório configura a emissão de cada empresa (município, série,
--    serviços com os códigos de tributação, tributos aproximados, ambiente de
--    teste ou de produção) e liga a emissão com a autorização do cliente.
--  * Sem certificado, sem configuração ou com a emissão desligada, o pedido
--    não é aceito: a emissão aparece como desconectada. Nada é simulado.
--  * Numeração da DPS: série 00001–49999 (faixa de "aplicativo próprio"),
--    número sequencial por empresa e ambiente, reservado no pedido (nunca
--    reaproveitado).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões: nfse.emitir (equipe e titular) e nfse.configurar (só equipe)
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
    'nfse.configurar'
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
    'nfse.configurar'
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
      'nfse.emitir', 'nfse.configurar'
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
      'nfse.emitir'
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
  return new;
end;
$$;

update public.empresa_membros
   set permissoes = permissoes || array['nfse.emitir', 'nfse.configurar']
 where papel = 'equipe' and not (permissoes && array['nfse.emitir', 'nfse.configurar']);
update public.empresa_membros
   set permissoes = permissoes || array['nfse.emitir']
 where papel = 'cliente_titular' and not ('nfse.emitir' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['nfse.emitir', 'nfse.configurar']
 where status = 'pendente' and papel = 'equipe' and cardinality(permissoes) > 0
   and not (permissoes && array['nfse.emitir', 'nfse.configurar']);
update public.convites
   set permissoes = permissoes || array['nfse.emitir']
 where status = 'pendente' and papel = 'cliente_titular' and cardinality(permissoes) > 0
   and not ('nfse.emitir' = any(permissoes));

-- -----------------------------------------------------------------------------
-- 2. Configuração da emissão (uma por empresa)
-- -----------------------------------------------------------------------------
create table public.nfse_emissao_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativa boolean not null default false,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  -- Município emissor (cLocEmi), código IBGE de 7 dígitos
  codigo_municipio text check (codigo_municipio is null or codigo_municipio ~ '^[0-9]{7}$'),
  -- Informada só quando a empresa tem cadastro complementar no município (CNC NFS-e)
  inscricao_municipal text check (inscricao_municipal is null or length(inscricao_municipal) between 1 and 15),
  -- Simples Nacional ME/EPP: 1 = tributos pelo SN; 2 = federais pelo SN e ISS fora; 3 = federais e ISS fora
  regime_apuracao_sn smallint not null default 1 check (regime_apuracao_sn in (1, 2, 3)),
  -- Regime especial de tributação do ISS (0 = nenhum)
  regime_especial smallint not null default 0 check (regime_especial in (0, 1, 2, 3, 4, 5, 6, 9)),
  serie int not null default 1 check (serie between 1 and 49999),
  proximo_numero_homologacao bigint not null default 1 check (proximo_numero_homologacao between 1 and 999999999999999),
  proximo_numero_producao bigint not null default 1 check (proximo_numero_producao between 1 and 999999999999999),
  -- Tributos aproximados (Lei 12.741/2012): Simples ME/EPP usa a alíquota do SN; não optante, federais e municipais
  percentual_tributos_sn numeric(5, 2) check (percentual_tributos_sn is null or percentual_tributos_sn between 0 and 99.99),
  percentual_tributos_federais numeric(5, 2) check (percentual_tributos_federais is null or percentual_tributos_federais between 0 and 100),
  percentual_tributos_municipais numeric(5, 2) check (percentual_tributos_municipais is null or percentual_tributos_municipais between 0 and 100),
  -- ISS retido pelo tomador: só quando o escritório liberar, com a alíquota a informar na nota
  iss_retencao_permitida boolean not null default false,
  aliquota_iss_retencao numeric(4, 2) check (aliquota_iss_retencao is null or aliquota_iss_retencao between 0.01 and 5),
  enviar_email_tomador boolean not null default true,
  -- Autorização do cliente para o portal emitir notas com o certificado da empresa
  autorizacao_texto text check (autorizacao_texto is null or length(autorizacao_texto) between 10 and 2000),
  autorizado_por uuid references public.perfis(id) on delete set null,
  autorizado_em timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfse_config_ativa_completa check (
    not ativa or (codigo_municipio is not null and autorizacao_texto is not null and autorizado_em is not null)
  ),
  constraint nfse_config_retencao check (not iss_retencao_permitida or aliquota_iss_retencao is not null)
);
create trigger nfse_emissao_config_updated_at before update on public.nfse_emissao_config
  for each row execute function app.tg_updated_at();
create trigger auditoria_nfse_emissao_config after insert or update or delete on public.nfse_emissao_config
  for each row execute function app.tg_auditoria();

-- Serviços que a empresa presta, com os códigos (cadastrados pelo escritório)
create table public.nfse_servicos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  -- Código de tributação nacional (item, subitem e desdobro da LC 116/2003): 6 dígitos
  codigo_tributacao_nacional text not null check (codigo_tributacao_nacional ~ '^[0-9]{6}$'),
  codigo_tributacao_municipal text check (codigo_tributacao_municipal is null or (codigo_tributacao_municipal ~ '^[0-9]{3}$' and codigo_tributacao_municipal <> '000')),
  codigo_nbs text check (codigo_nbs is null or codigo_nbs ~ '^[0-9]{9}$'),
  descricao_padrao text check (descricao_padrao is null or length(descricao_padrao) <= 1000),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index nfse_servicos_empresa_idx on public.nfse_servicos (empresa_id, nome);
create trigger nfse_servicos_updated_at before update on public.nfse_servicos
  for each row execute function app.tg_updated_at();
create trigger auditoria_nfse_servicos after insert or update or delete on public.nfse_servicos
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Notas pedidas e emitidas
-- -----------------------------------------------------------------------------
create table public.nfse_emissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  servico_id uuid references public.nfse_servicos(id) on delete set null,
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  serie int not null check (serie between 1 and 49999),
  numero_dps bigint not null check (numero_dps between 1 and 999999999999999),
  id_dps text not null check (id_dps ~ '^DPS[0-9]{42}$'),
  -- na_fila → enviando → autorizada | rejeitada | falha (conexão: tenta de novo); autorizada → cancelando → cancelada
  situacao text not null default 'na_fila'
    check (situacao in ('na_fila', 'enviando', 'autorizada', 'rejeitada', 'falha', 'cancelando', 'cancelada')),
  -- Dados da nota (como foram pedidos)
  competencia date not null,
  codigo_municipio_emissor text not null check (codigo_municipio_emissor ~ '^[0-9]{7}$'),
  local_prestacao text not null check (local_prestacao ~ '^[0-9]{7}$'),
  codigo_tributacao_nacional text not null check (codigo_tributacao_nacional ~ '^[0-9]{6}$'),
  codigo_tributacao_municipal text check (codigo_tributacao_municipal is null or codigo_tributacao_municipal ~ '^[0-9]{3}$'),
  codigo_nbs text check (codigo_nbs is null or codigo_nbs ~ '^[0-9]{9}$'),
  descricao text not null check (length(trim(descricao)) between 3 and 1000),
  valor numeric(15, 2) not null check (valor > 0 and valor < 1000000000000),
  iss_retido boolean not null default false,
  aliquota_iss numeric(4, 2) check (aliquota_iss is null or aliquota_iss between 0.01 and 5),
  tomador_tipo text not null check (tomador_tipo in ('cnpj', 'cpf', 'nao_identificado')),
  tomador_documento text check (tomador_documento is null or tomador_documento ~ '^([0-9]{11}|[0-9A-Z]{14})$'),
  tomador_nome text check (tomador_nome is null or length(trim(tomador_nome)) between 2 and 300),
  tomador_email text check (tomador_email is null or (length(tomador_email) <= 80 and tomador_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  tomador_telefone text check (tomador_telefone is null or tomador_telefone ~ '^[0-9]{6,20}$'),
  -- {logradouro, numero, complemento, bairro, codigo_municipio, municipio, uf, cep}
  tomador_endereco jsonb check (tomador_endereco is null or (jsonb_typeof(tomador_endereco) = 'object' and pg_column_size(tomador_endereco) <= 4000)),
  informacoes_complementares text check (informacoes_complementares is null or length(informacoes_complementares) <= 2000),
  -- Retorno da Sefin Nacional
  chave_acesso text unique check (chave_acesso is null or chave_acesso ~ '^[0-9]{50}$'),
  numero_nfse text check (numero_nfse is null or numero_nfse ~ '^[0-9]{1,13}$'),
  autorizada_em timestamptz,
  xml_nfse text check (xml_nfse is null or length(xml_nfse) <= 500000),
  documento_id uuid references public.documentos(id) on delete set null,
  mensagens jsonb check (mensagens is null or (jsonb_typeof(mensagens) = 'array' and pg_column_size(mensagens) <= 20000)),
  tentativas int not null default 0,
  ultimo_envio_em timestamptz,
  email_tomador_enviado_em timestamptz,
  -- Cancelamento (evento 101101): 1 = erro na emissão; 2 = serviço não prestado; 9 = outros
  cancelamento_motivo smallint check (cancelamento_motivo is null or cancelamento_motivo in (1, 2, 9)),
  cancelamento_justificativa text check (cancelamento_justificativa is null or length(cancelamento_justificativa) between 15 and 255),
  cancelamento_pedido_em timestamptz,
  cancelamento_pedido_por uuid references public.perfis(id) on delete set null,
  cancelada_em timestamptz,
  cancelamento_xml text check (cancelamento_xml is null or length(cancelamento_xml) <= 200000),
  pedido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfse_emissoes_numero_uk unique (empresa_id, ambiente, serie, numero_dps),
  constraint nfse_emissoes_tomador check (
    (tomador_tipo = 'nao_identificado' and tomador_documento is null)
    or (tomador_tipo = 'cpf' and tomador_documento ~ '^[0-9]{11}$' and tomador_nome is not null)
    or (tomador_tipo = 'cnpj' and tomador_documento ~ '^[0-9A-Z]{14}$' and tomador_nome is not null and tomador_endereco is not null)
  ),
  constraint nfse_emissoes_retencao check (not iss_retido or (aliquota_iss is not null and tomador_tipo <> 'nao_identificado')),
  constraint nfse_emissoes_autorizada check (situacao not in ('autorizada', 'cancelando', 'cancelada') or (chave_acesso is not null and xml_nfse is not null))
);
create index nfse_emissoes_empresa_idx on public.nfse_emissoes (empresa_id, created_at desc);
create index nfse_emissoes_competencia_idx on public.nfse_emissoes (empresa_id, competencia);
create index nfse_emissoes_pendentes_idx on public.nfse_emissoes (situacao) where situacao in ('na_fila', 'enviando', 'falha', 'cancelando');
create trigger nfse_emissoes_updated_at before update on public.nfse_emissoes
  for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Acesso: leitura por quem emite ou configura; escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.nfse_emissao_config enable row level security;
alter table public.nfse_servicos enable row level security;
alter table public.nfse_emissoes enable row level security;

create policy nfse_config_leitura on public.nfse_emissao_config for select to authenticated
  using ((select app.pode(empresa_id, 'nfse.emitir')) or (select app.pode(empresa_id, 'nfse.configurar')));
create policy nfse_servicos_leitura on public.nfse_servicos for select to authenticated
  using ((select app.pode(empresa_id, 'nfse.emitir')) or (select app.pode(empresa_id, 'nfse.configurar')));
create policy nfse_emissoes_leitura on public.nfse_emissoes for select to authenticated
  using ((select app.pode(empresa_id, 'nfse.emitir')) or (select app.pode(empresa_id, 'nfse.configurar')));

grant select on public.nfse_emissao_config, public.nfse_servicos, public.nfse_emissoes to authenticated;
grant select, insert, update, delete on public.nfse_emissao_config, public.nfse_servicos, public.nfse_emissoes to service_role;

-- -----------------------------------------------------------------------------
-- 5. Funções do escritório: configuração, serviços e autorização
-- -----------------------------------------------------------------------------
create or replace function public.nfse_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual public.nfse_emissao_config;
  v_ambiente text := coalesce(p_dados ->> 'ambiente', 'homologacao');
  v_ativa boolean := coalesce((p_dados ->> 'ativa')::boolean, false);
  v_aut text := nullif(trim(p_dados ->> 'autorizacao_texto'), '');
begin
  perform app.exigir(p_empresa_id, 'nfse.configurar');
  if exists (select 1 from public.empresas where id = p_empresa_id and demonstracao) and v_ativa and v_ambiente = 'producao' then
    raise exception 'Empresa de demonstração não emite notas em produção.';
  end if;
  select * into v_atual from public.nfse_emissao_config where empresa_id = p_empresa_id;
  if v_ativa then
    if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
      raise exception 'Cadastre o certificado digital A1 da empresa (válido) antes de ligar a emissão.';
    end if;
    if not exists (select 1 from public.nfse_servicos s where s.empresa_id = p_empresa_id and s.ativo) then
      raise exception 'Cadastre ao menos um serviço com o código de tributação antes de ligar a emissão.';
    end if;
    if coalesce(v_aut, v_atual.autorizacao_texto) is null then
      raise exception 'Registre como o cliente autorizou o portal a emitir notas com o certificado da empresa.';
    end if;
  end if;

  insert into public.nfse_emissao_config as c (
    empresa_id, ativa, ambiente, codigo_municipio, inscricao_municipal, regime_apuracao_sn, regime_especial, serie,
    proximo_numero_homologacao, proximo_numero_producao,
    percentual_tributos_sn, percentual_tributos_federais, percentual_tributos_municipais,
    iss_retencao_permitida, aliquota_iss_retencao, enviar_email_tomador,
    autorizacao_texto, autorizado_por, autorizado_em, atualizado_por
  ) values (
    p_empresa_id, v_ativa, v_ambiente,
    nullif(p_dados ->> 'codigo_municipio', ''), nullif(trim(p_dados ->> 'inscricao_municipal'), ''),
    coalesce((p_dados ->> 'regime_apuracao_sn')::smallint, 1), coalesce((p_dados ->> 'regime_especial')::smallint, 0),
    coalesce((p_dados ->> 'serie')::int, 1),
    coalesce((p_dados ->> 'proximo_numero_homologacao')::bigint, 1), coalesce((p_dados ->> 'proximo_numero_producao')::bigint, 1),
    (p_dados ->> 'percentual_tributos_sn')::numeric, (p_dados ->> 'percentual_tributos_federais')::numeric,
    (p_dados ->> 'percentual_tributos_municipais')::numeric,
    coalesce((p_dados ->> 'iss_retencao_permitida')::boolean, false), (p_dados ->> 'aliquota_iss_retencao')::numeric,
    coalesce((p_dados ->> 'enviar_email_tomador')::boolean, true),
    -- Autorização nova ou a já registrada (a regra de "ligada só com autorização" vale para a linha proposta)
    coalesce(v_aut, v_atual.autorizacao_texto),
    case when v_aut is not null then auth.uid() else v_atual.autorizado_por end,
    case when v_aut is not null then now() else v_atual.autorizado_em end,
    auth.uid()
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    ambiente = excluded.ambiente,
    codigo_municipio = excluded.codigo_municipio,
    inscricao_municipal = excluded.inscricao_municipal,
    regime_apuracao_sn = excluded.regime_apuracao_sn,
    regime_especial = excluded.regime_especial,
    serie = excluded.serie,
    -- A numeração só anda para a frente (números já usados não voltam)
    proximo_numero_homologacao = greatest(c.proximo_numero_homologacao, excluded.proximo_numero_homologacao),
    proximo_numero_producao = greatest(c.proximo_numero_producao, excluded.proximo_numero_producao),
    percentual_tributos_sn = excluded.percentual_tributos_sn,
    percentual_tributos_federais = excluded.percentual_tributos_federais,
    percentual_tributos_municipais = excluded.percentual_tributos_municipais,
    iss_retencao_permitida = excluded.iss_retencao_permitida,
    aliquota_iss_retencao = excluded.aliquota_iss_retencao,
    enviar_email_tomador = excluded.enviar_email_tomador,
    autorizacao_texto = excluded.autorizacao_texto,
    autorizado_por = excluded.autorizado_por,
    autorizado_em = excluded.autorizado_em,
    atualizado_por = auth.uid();
end;
$$;

create or replace function public.nfse_servico_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'nfse.configurar');
  if p_id is null then
    insert into public.nfse_servicos (empresa_id, nome, codigo_tributacao_nacional, codigo_tributacao_municipal, codigo_nbs, descricao_padrao, ativo)
    values (p_empresa_id, trim(p_dados ->> 'nome'), p_dados ->> 'codigo_tributacao_nacional',
            nullif(p_dados ->> 'codigo_tributacao_municipal', ''), nullif(p_dados ->> 'codigo_nbs', ''),
            nullif(trim(p_dados ->> 'descricao_padrao'), ''), coalesce((p_dados ->> 'ativo')::boolean, true))
    returning id into v_id;
  else
    update public.nfse_servicos
       set nome = trim(p_dados ->> 'nome'),
           codigo_tributacao_nacional = p_dados ->> 'codigo_tributacao_nacional',
           codigo_tributacao_municipal = nullif(p_dados ->> 'codigo_tributacao_municipal', ''),
           codigo_nbs = nullif(p_dados ->> 'codigo_nbs', ''),
           descricao_padrao = nullif(trim(p_dados ->> 'descricao_padrao'), ''),
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Serviço não encontrado.';
    end if;
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Pedido da nota (emite na hora: entra na fila com prioridade)
-- -----------------------------------------------------------------------------
create or replace function public.nfse_pedir(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfse_emissao_config;
  v_serv public.nfse_servicos;
  v_emp public.empresas;
  v_numero bigint;
  v_id uuid;
  v_valor numeric := round((p_dados ->> 'valor')::numeric, 2);
  v_tipo text := coalesce(p_dados ->> 'tomador_tipo', 'nao_identificado');
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'tomador_documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_desc text := trim(coalesce(p_dados ->> 'descricao', ''));
  v_retido boolean := coalesce((p_dados ->> 'iss_retido')::boolean, false);
  v_comp date := coalesce((p_dados ->> 'competencia')::date, (now() at time zone 'America/Araguaina')::date);
  v_local text;
  v_id_dps text;
begin
  perform app.exigir(p_empresa_id, 'nfse.emitir');
  select * into v_emp from public.empresas where id = p_empresa_id;
  select * into v_cfg from public.nfse_emissao_config where empresa_id = p_empresa_id for update;
  if v_cfg.empresa_id is null or not v_cfg.ativa then
    raise exception 'A emissão de notas desta empresa ainda não foi ligada pelo escritório.';
  end if;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  if v_emp.tipo_pessoa <> 'PJ' then
    raise exception 'A emissão pelo portal está disponível para empresas (CNPJ).';
  end if;
  -- Tributos aproximados (Lei 12.741/2012) são obrigatórios na nota, exceto para o MEI
  if v_emp.regime_tributario = 'simples_nacional' and v_cfg.percentual_tributos_sn is null then
    raise exception 'Falta o percentual do Simples Nacional na configuração da emissão. Fale com o escritório.';
  end if;
  if v_emp.regime_tributario not in ('mei', 'simples_nacional')
     and (v_cfg.percentual_tributos_federais is null or v_cfg.percentual_tributos_municipais is null) then
    raise exception 'Faltam os percentuais aproximados de tributos na configuração da emissão. Fale com o escritório.';
  end if;
  select * into v_serv from public.nfse_servicos where id = (p_dados ->> 'servico_id')::uuid and empresa_id = p_empresa_id and ativo;
  if v_serv.id is null then
    raise exception 'Escolha um dos serviços cadastrados pelo escritório.';
  end if;
  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe o valor do serviço.';
  end if;
  if length(v_desc) < 3 then
    raise exception 'Descreva o serviço prestado.';
  end if;
  if v_comp > (now() at time zone 'America/Araguaina')::date then
    raise exception 'A data da prestação não pode ser futura.';
  end if;
  if v_comp < (now() at time zone 'America/Araguaina')::date - 365 then
    raise exception 'A data da prestação está muito antiga. Fale com o escritório.';
  end if;
  if v_tipo = 'cpf' and (v_doc is null or not app.cpf_valido(v_doc)) then
    raise exception 'CPF do tomador inválido.';
  end if;
  if v_tipo = 'cnpj' and (v_doc is null or not app.cnpj_valido(v_doc)) then
    raise exception 'CNPJ do tomador inválido.';
  end if;
  if v_tipo = 'cnpj' and v_doc = v_emp.documento then
    raise exception 'O tomador não pode ser a própria empresa.';
  end if;
  if v_retido and not v_cfg.iss_retencao_permitida then
    raise exception 'A retenção do ISS pelo tomador não está liberada para esta empresa. Fale com o escritório.';
  end if;
  if v_retido and v_tipo = 'nao_identificado' then
    raise exception 'Com ISS retido, o tomador precisa ser identificado (CNPJ ou CPF).';
  end if;
  if v_retido and v_emp.regime_tributario = 'mei' then
    raise exception 'O MEI não tem ISS retido na nota.';
  end if;
  -- Proteção contra pedido repetido por engano (mesmo tomador, valor e descrição em 10 minutos)
  if not coalesce((p_dados ->> 'confirmar_repetida')::boolean, false) and exists (
    select 1 from public.nfse_emissoes e
     where e.empresa_id = p_empresa_id and e.valor = v_valor and e.descricao = v_desc
       and e.tomador_documento is not distinct from v_doc and e.situacao not in ('rejeitada', 'cancelada')
       and e.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'Uma nota igual (mesmo tomador, valor e descrição) foi pedida há poucos minutos. Confira a lista antes de pedir de novo.'
      using errcode = 'P0002';
  end if;
  if (select count(*) from public.nfse_emissoes e where e.empresa_id = p_empresa_id and e.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Limite de 60 notas por hora atingido. Aguarde um pouco ou fale com o escritório.';
  end if;

  v_local := case when p_dados ->> 'local_prestacao' ~ '^[0-9]{7}$' then p_dados ->> 'local_prestacao' else v_cfg.codigo_municipio end;

  -- Número da DPS (reservado agora; nunca reaproveitado)
  if v_cfg.ambiente = 'producao' then
    v_numero := v_cfg.proximo_numero_producao;
    update public.nfse_emissao_config set proximo_numero_producao = v_numero + 1 where empresa_id = p_empresa_id;
  else
    v_numero := v_cfg.proximo_numero_homologacao;
    update public.nfse_emissao_config set proximo_numero_homologacao = v_numero + 1 where empresa_id = p_empresa_id;
  end if;
  -- "DPS" + município (7) + tipo de inscrição (2 = CNPJ) + CNPJ (14) + série (5) + número (15)
  v_id_dps := 'DPS' || v_cfg.codigo_municipio || '2' || lpad(v_emp.documento, 14, '0') || lpad(v_cfg.serie::text, 5, '0') || lpad(v_numero::text, 15, '0');

  insert into public.nfse_emissoes (
    empresa_id, servico_id, ambiente, serie, numero_dps, id_dps, competencia, codigo_municipio_emissor, local_prestacao,
    codigo_tributacao_nacional, codigo_tributacao_municipal, codigo_nbs, descricao, valor, iss_retido, aliquota_iss,
    tomador_tipo, tomador_documento, tomador_nome, tomador_email, tomador_telefone, tomador_endereco, informacoes_complementares
  ) values (
    p_empresa_id, v_serv.id, v_cfg.ambiente, v_cfg.serie, v_numero, v_id_dps, v_comp, v_cfg.codigo_municipio, v_local,
    v_serv.codigo_tributacao_nacional, v_serv.codigo_tributacao_municipal, v_serv.codigo_nbs, v_desc, v_valor, v_retido,
    case when v_retido then v_cfg.aliquota_iss_retencao end,
    v_tipo, v_doc, nullif(trim(p_dados ->> 'tomador_nome'), ''),
    nullif(lower(trim(p_dados ->> 'tomador_email')), ''), nullif(regexp_replace(coalesce(p_dados ->> 'tomador_telefone', ''), '\D', '', 'g'), ''),
    case when jsonb_typeof(p_dados -> 'tomador_endereco') = 'object' then p_dados -> 'tomador_endereco' end,
    nullif(trim(p_dados ->> 'informacoes_complementares'), '')
  ) returning id into v_id;

  perform app.enfileirar('emitir_nfse', jsonb_build_object('emissao_id', v_id), p_empresa_id, 'nfse:' || v_id::text, now(), 5);
  return jsonb_build_object('id', v_id, 'numero_dps', v_numero, 'ambiente', v_cfg.ambiente);
end;
$$;

-- Envia de novo uma nota que ficou sem resposta (falha de conexão). A tarefa
-- consulta antes se a DPS já virou nota, para não emitir duas vezes.
create or replace function public.nfse_tentar_de_novo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfse_emissoes;
begin
  select * into v from public.nfse_emissoes where id = p_id;
  if v.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfse.emitir');
  if v.situacao <> 'falha' then
    raise exception 'Só uma nota que ficou sem resposta pode ser enviada de novo.';
  end if;
  update public.nfse_emissoes set situacao = 'na_fila' where id = p_id;
  perform app.enfileirar('emitir_nfse', jsonb_build_object('emissao_id', p_id), v.empresa_id,
                         'nfse:' || p_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
end;
$$;

create or replace function public.nfse_cancelar(p_id uuid, p_motivo smallint, p_justificativa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfse_emissoes;
begin
  select * into v from public.nfse_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfse.emitir');
  if v.situacao <> 'autorizada' then
    raise exception 'Só uma nota autorizada pode ser cancelada.';
  end if;
  if p_motivo not in (1, 2, 9) then
    raise exception 'Motivo de cancelamento inválido.';
  end if;
  if length(trim(coalesce(p_justificativa, ''))) not between 15 and 255 then
    raise exception 'Explique o motivo do cancelamento (de 15 a 255 caracteres).';
  end if;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = v.empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  update public.nfse_emissoes
     set situacao = 'cancelando', cancelamento_motivo = p_motivo, cancelamento_justificativa = trim(p_justificativa),
         cancelamento_pedido_em = now(), cancelamento_pedido_por = auth.uid(), mensagens = null
   where id = p_id;
  perform app.enfileirar('cancelar_nfse', jsonb_build_object('emissao_id', p_id), v.empresa_id, 'nfse-cancelar:' || p_id::text, now(), 5);
end;
$$;

-- Avisos depois do retorno da Sefin (chamada pelo processador)
create or replace function public.nfse_avisar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfse_emissoes;
  v_link text;
  v_titulo text;
  v_corpo text;
begin
  select * into v from public.nfse_emissoes where id = p_id;
  if v.id is null then
    return;
  end if;
  v_link := '/e/' || v.empresa_id::text || '/notas-servico/' || v.id::text;
  if v.situacao = 'rejeitada' then
    v_titulo := 'Nota de serviço não emitida';
    v_corpo := 'A Receita (Emissor Nacional) recusou a nota de ' || to_char(v.valor, 'FM999G999G990D00') || '. Veja o motivo e peça de novo com os dados corrigidos.';
  elsif v.situacao = 'falha' then
    v_titulo := 'Nota de serviço sem resposta do Emissor Nacional';
    v_corpo := 'O Emissor Nacional não respondeu. O portal tenta de novo; se continuar, fale com o escritório.';
  elsif v.situacao = 'cancelada' then
    v_titulo := 'Nota de serviço cancelada';
    v_corpo := 'O cancelamento da nota ' || coalesce(v.numero_nfse, '') || ' foi registrado no Emissor Nacional.';
  elsif v.situacao = 'autorizada' and v.cancelamento_pedido_em is not null then
    v_titulo := 'Cancelamento da nota não aceito';
    v_corpo := 'O Emissor Nacional não aceitou o cancelamento da nota ' || coalesce(v.numero_nfse, '') || '. Veja o motivo.';
  else
    return;
  end if;
  perform app.notificar_clientes(v.empresa_id, 'nfse.emitir', 'nfse', v_titulo, v_corpo, v_link, false);
  perform app.notificar_equipe(v.empresa_id, 'nfse', v_titulo, v_corpo, v_link, false);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Carteira do escritório
-- -----------------------------------------------------------------------------
create or replace function public.nfse_carteira(p_inicio date, p_fim date)
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
    select jsonb_agg(x order by x ->> 'empresa')
      from (
        select jsonb_build_object(
                 'empresa_id', e.id,
                 'empresa', coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social),
                 'documento', e.documento,
                 'ativa', coalesce(c.ativa, false),
                 'ambiente', c.ambiente,
                 'certificado_valido_ate', (select max(cd.valido_ate) from public.certificados_digitais cd where cd.empresa_id = e.id and cd.revogado_em is null),
                 'autorizadas', count(n.id) filter (where n.situacao in ('autorizada', 'cancelando') and n.ambiente = 'producao'),
                 'valor', coalesce(sum(n.valor) filter (where n.situacao in ('autorizada', 'cancelando') and n.ambiente = 'producao'), 0),
                 'canceladas', count(n.id) filter (where n.situacao = 'cancelada' and n.ambiente = 'producao'),
                 'rejeitadas', count(n.id) filter (where n.situacao = 'rejeitada'),
                 'pendentes', count(n.id) filter (where n.situacao in ('na_fila', 'enviando', 'falha', 'cancelando')),
                 'testes', count(n.id) filter (where n.ambiente = 'homologacao')
               ) as x
          from public.empresas e
          left join public.nfse_emissao_config c on c.empresa_id = e.id
          left join public.nfse_emissoes n on n.empresa_id = e.id and n.competencia between p_inicio and p_fim
         where e.id = any (app.empresas_com('nfse.configurar'))
           and (c.empresa_id is not null or exists (select 1 from public.nfse_emissoes n2 where n2.empresa_id = e.id))
         group by e.id, c.ativa, c.ambiente
      ) s
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.nfse_configurar(uuid, jsonb), public.nfse_servico_salvar(uuid, uuid, jsonb), public.nfse_pedir(uuid, jsonb),
  public.nfse_tentar_de_novo(uuid), public.nfse_cancelar(uuid, smallint, text), public.nfse_avisar(uuid), public.nfse_carteira(date, date)
  from public, anon, authenticated;
grant execute on function public.nfse_configurar(uuid, jsonb), public.nfse_servico_salvar(uuid, uuid, jsonb), public.nfse_pedir(uuid, jsonb),
  public.nfse_tentar_de_novo(uuid), public.nfse_cancelar(uuid, smallint, text), public.nfse_carteira(date, date) to authenticated;
grant execute on function public.nfse_avisar(uuid) to service_role;
