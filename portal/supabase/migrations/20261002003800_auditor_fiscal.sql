-- =============================================================================
-- Auditor fiscal das notas
--
--  * Leitura completa dos códigos fiscais de cada item (versão 2 da leitura):
--    CST/CSOSN, ICMS-ST, PIS/Cofins, IBS/CBS, GTIN, CEST e Ex da TIPI.
--  * Catálogo de produtos com PIS/Cofins monofásico por NCM, com a lei de
--    cada linha (Leis 10.147/2000, 10.485/2002, 13.097/2015, 9.718/1998...).
--  * Achados com memória de cálculo e base legal. São INDÍCIOS para o
--    contador conferir: nada é enviado à Receita. O cliente só vê o que a
--    equipe revisou e publicou.
--  * Os valores saem de regras fixas (sem inteligência artificial).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões: auditor.ver (cliente vê oportunidades publicadas) e
--    auditor.gerenciar (equipe analisa, revisa e publica)
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
    'auditor.gerenciar'
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
    'auditor.gerenciar'
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
      'auditor.ver', 'auditor.gerenciar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

-- Coerência entre tipo do usuário, papel e permissões (inclui as do auditor).
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
  return new;
end;
$$;

-- Acessos existentes: a equipe passa a conduzir o auditor; o empresário
-- titular passa a ver as oportunidades publicadas (como nos novos convites).
update public.empresa_membros
   set permissoes = permissoes || array['auditor.ver', 'auditor.gerenciar']
 where papel = 'equipe' and not (permissoes && array['auditor.ver', 'auditor.gerenciar']);
update public.empresa_membros
   set permissoes = permissoes || array['auditor.ver']
 where papel = 'cliente_titular' and not ('auditor.ver' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['auditor.ver', 'auditor.gerenciar']
 where status = 'pendente' and papel = 'equipe' and cardinality(permissoes) > 0
   and not (permissoes && array['auditor.ver', 'auditor.gerenciar']);
update public.convites
   set permissoes = permissoes || array['auditor.ver']
 where status = 'pendente' and papel = 'cliente_titular' and cardinality(permissoes) > 0
   and not ('auditor.ver' = any(permissoes));

-- -----------------------------------------------------------------------------
-- 2. Leitura versão 2 das notas (cabeçalho e itens)
-- -----------------------------------------------------------------------------
alter table public.documentos_fiscais
  add column crt_emitente text check (crt_emitente is null or crt_emitente ~ '^[0-9]$'),
  add column consumidor_final boolean,
  add column id_destino text check (id_destino is null or id_destino ~ '^[0-9]$'),
  add column ind_ie_dest text check (ind_ie_dest is null or ind_ie_dest ~ '^[0-9]$'),
  add column leitura_versao smallint not null default 1 check (leitura_versao between 1 and 99);

alter table public.documento_fiscal_itens
  add column gtin text check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  add column cest text check (cest is null or cest ~ '^[0-9]{7}$'),
  add column ex_tipi text check (ex_tipi is null or ex_tipi ~ '^[0-9A-Za-z]{1,10}$');

create index documentos_fiscais_leitura_idx on public.documentos_fiscais (empresa_id, leitura_versao)
  where leitura_versao < 2;

-- Completa uma nota já registrada com a leitura atual (cabeçalho, códigos dos
-- itens). Usada logo após o registro e para reler notas antigas. Somente o
-- processador (service_role) executa.
create or replace function public.atualizar_leitura_xml_fiscal(p_documento_fiscal_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_dados ->> 'tipo' is distinct from 'nota' then
    raise exception 'Somente notas fiscais.';
  end if;
  update public.documentos_fiscais
     set crt_emitente = nullif(p_dados ->> 'crt_emitente', ''),
         consumidor_final = (p_dados ->> 'consumidor_final')::boolean,
         id_destino = nullif(p_dados ->> 'id_destino', ''),
         ind_ie_dest = nullif(p_dados ->> 'ind_ie_dest', ''),
         tributos = coalesce(p_dados -> 'tributos', tributos),
         leitura_versao = coalesce((p_dados ->> 'leitura_versao')::smallint, 2)
   where id = p_documento_fiscal_id;
  if not found then
    raise exception 'Nota não encontrada.';
  end if;
  update public.documento_fiscal_itens i
     set gtin = x.gtin,
         cest = x.cest,
         ex_tipi = x.ex_tipi,
         ncm = coalesce(x.ncm, i.ncm),
         cfop = coalesce(x.cfop, i.cfop),
         tributos = coalesce(x.tributos, i.tributos)
    from jsonb_to_recordset(coalesce(p_dados -> 'itens', '[]'::jsonb))
         as x(numero_item int, gtin text, cest text, ex_tipi text, ncm text, cfop text, tributos jsonb)
   where i.documento_fiscal_id = p_documento_fiscal_id
     and i.numero_item = x.numero_item;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Catálogo de produtos com PIS/Cofins monofásico (por NCM)
-- -----------------------------------------------------------------------------
create table public.auditor_ncm_monofasico (
  id uuid primary key default gen_random_uuid(),
  ncm_prefixo text not null check (ncm_prefixo ~ '^[0-9]{4,8}$'),
  ex_tipi text check (ex_tipi is null or ex_tipi ~ '^[0-9]{1,3}$'),
  -- Linha de exceção: o código (ou o Ex) fica FORA do regime
  excecao boolean not null default false,
  grupo text not null check (grupo in (
    'farmaceuticos', 'higiene_perfumaria', 'veiculos_maquinas', 'autopecas', 'pneus', 'bebidas_frias', 'combustiveis'
  )),
  descricao text not null check (length(descricao) between 3 and 300),
  -- Condição para valer (ex.: "somente revenda no varejo", "depende da destinação")
  condicao text check (condicao is null or length(condicao) <= 500),
  -- "varejo": vale só na venda ao consumidor final (bebidas frias, art. 28 da Lei 13.097/2015)
  somente_varejo boolean not null default false,
  confianca text not null default 'alta' check (confianca in ('alta', 'conferir')),
  fonte_titulo text not null check (length(fonte_titulo) between 3 and 300),
  fonte_url text check (fonte_url is null or fonte_url ~ '^https?://'),
  vigencia_inicio date not null default '2004-01-01',
  vigencia_fim date check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index auditor_ncm_monofasico_uk on public.auditor_ncm_monofasico (ncm_prefixo, coalesce(ex_tipi, ''), excecao, vigencia_inicio);
create trigger auditor_ncm_monofasico_updated_at before update on public.auditor_ncm_monofasico
  for each row execute function app.tg_updated_at();
create trigger auditoria_auditor_ncm_monofasico after insert or update or delete on public.auditor_ncm_monofasico
  for each row execute function app.tg_auditoria();

-- Fontes (texto vigente conferido em 02/10/2026 no portal da legislação)
insert into public.auditor_ncm_monofasico (ncm_prefixo, ex_tipi, excecao, grupo, descricao, condicao, somente_varejo, confianca, fonte_titulo, fonte_url)
select v.ncm, v.ex, v.exc, v.grupo, v.descricao, v.condicao, v.varejo, v.confianca, f.titulo, f.url
  from (values
    -- Farmacêuticos — Lei 10.147/2000, art. 1º, I, "a" (redação da Lei 10.865/2004)
    ('3001', null, false, 'farmaceuticos', 'Glândulas e outros órgãos para usos opoterápicos (posição 30.01)', null, false, 'alta', 'l10147'),
    ('3003', null, false, 'farmaceuticos', 'Medicamentos não acondicionados para venda a retalho (posição 30.03)', null, false, 'alta', 'l10147'),
    ('30039056', null, true, 'farmaceuticos', 'Exceção: código 3003.90.56', null, false, 'alta', 'l10147'),
    ('3004', null, false, 'farmaceuticos', 'Medicamentos em doses ou acondicionados para venda a retalho (posição 30.04)', null, false, 'alta', 'l10147'),
    ('30049046', null, true, 'farmaceuticos', 'Exceção: código 3004.90.46', null, false, 'alta', 'l10147'),
    ('3002101', null, false, 'farmaceuticos', 'Antissoros e frações do sangue (item 3002.10.1 da TIPI de 2011)', null, false, 'alta', 'l10147'),
    ('3002102', null, false, 'farmaceuticos', 'Item 3002.10.2 da TIPI de 2011', null, false, 'alta', 'l10147'),
    ('3002103', null, false, 'farmaceuticos', 'Item 3002.10.3 da TIPI de 2011', null, false, 'alta', 'l10147'),
    ('3002201', null, false, 'farmaceuticos', 'Vacinas para medicina humana (item 3002.20.1 da TIPI de 2011)', null, false, 'alta', 'l10147'),
    ('3002202', null, false, 'farmaceuticos', 'Vacinas para medicina humana (item 3002.20.2 da TIPI de 2011)', null, false, 'alta', 'l10147'),
    ('30029020', null, false, 'farmaceuticos', 'Código 3002.90.20 da TIPI de 2011', null, false, 'alta', 'l10147'),
    ('30029092', null, false, 'farmaceuticos', 'Código 3002.90.92 da TIPI de 2011', null, false, 'alta', 'l10147'),
    ('30029099', null, false, 'farmaceuticos', 'Código 3002.90.99 da TIPI de 2011', null, false, 'alta', 'l10147'),
    ('300212', null, false, 'farmaceuticos', 'Antissoros e frações do sangue (NCM 2022, correlação com 3002.10)',
       'A lei cita os itens 3002.10.1, 3002.10.2 e 3002.10.3 da TIPI de 2011; confira a correlação com a NCM atual.', false, 'conferir', 'l10147'),
    ('300213', null, false, 'farmaceuticos', 'Produtos imunológicos não misturados (NCM 2022, correlação com 3002.10)',
       'A lei cita os itens 3002.10.1, 3002.10.2 e 3002.10.3 da TIPI de 2011; confira a correlação com a NCM atual.', false, 'conferir', 'l10147'),
    ('300214', null, false, 'farmaceuticos', 'Produtos imunológicos misturados (NCM 2022, correlação com 3002.10)',
       'A lei cita os itens 3002.10.1, 3002.10.2 e 3002.10.3 da TIPI de 2011; confira a correlação com a NCM atual.', false, 'conferir', 'l10147'),
    ('300215', null, false, 'farmaceuticos', 'Produtos imunológicos em doses (NCM 2022, correlação com 3002.10)',
       'A lei cita os itens 3002.10.1, 3002.10.2 e 3002.10.3 da TIPI de 2011; confira a correlação com a NCM atual.', false, 'conferir', 'l10147'),
    ('300241', null, false, 'farmaceuticos', 'Vacinas para medicina humana (NCM 2022, correlação com 3002.20)',
       'A lei cita os itens 3002.20.1 e 3002.20.2 da TIPI de 2011; confira a correlação com a NCM atual.', false, 'conferir', 'l10147'),
    ('30051010', null, false, 'farmaceuticos', 'Curativos adesivos (código 3005.10.10)', null, false, 'alta', 'l10147'),
    ('3006301', null, false, 'farmaceuticos', 'Preparações opacificantes e reagentes de diagnóstico (item 3006.30.1)', null, false, 'alta', 'l10147'),
    ('3006302', null, false, 'farmaceuticos', 'Reagentes de diagnóstico (item 3006.30.2)', null, false, 'alta', 'l10147'),
    ('30066000', null, false, 'farmaceuticos', 'Preparações químicas contraceptivas (código 3006.60.00)', null, false, 'alta', 'l10147'),
    -- Perfumaria, toucador e higiene — Lei 10.147/2000, art. 1º, I, "b" (redação da Lei 12.839/2013)
    ('3303', null, false, 'higiene_perfumaria', 'Perfumes e águas-de-colônia (posição 33.03)', null, false, 'alta', 'l10147'),
    ('3304', null, false, 'higiene_perfumaria', 'Produtos de beleza, maquiagem e cuidados da pele (posição 33.04)', null, false, 'alta', 'l10147'),
    ('3305', null, false, 'higiene_perfumaria', 'Preparações capilares — xampus, condicionadores, tinturas (posição 33.05)', null, false, 'alta', 'l10147'),
    ('3307', null, false, 'higiene_perfumaria', 'Desodorantes, preparações para barbear e banho (posição 33.07)', null, false, 'alta', 'l10147'),
    ('34011190', null, false, 'higiene_perfumaria', 'Sabões de toucador (código 3401.11.90)', null, false, 'alta', 'l10147'),
    ('34011190', '01', true, 'higiene_perfumaria', 'Exceção: 3401.11.90 Ex 01', null, false, 'alta', 'l10147'),
    ('34012010', null, false, 'higiene_perfumaria', 'Sabões de toucador em outras formas (código 3401.20.10)', null, false, 'alta', 'l10147'),
    ('96032100', null, false, 'higiene_perfumaria', 'Escovas de dentes (código 9603.21.00)', null, false, 'alta', 'l10147'),
    -- Máquinas e veículos — Lei 10.485/2002, art. 1º (redação da Lei 12.973/2014); revenda: art. 3º, § 2º, II
    ('7309', null, false, 'veiculos_maquinas', 'Reservatórios e tanques (posição 73.09)', null, false, 'alta', 'l10485'),
    ('731029', null, false, 'veiculos_maquinas', 'Recipientes (código 7310.29)', null, false, 'alta', 'l10485'),
    ('76129012', null, false, 'veiculos_maquinas', 'Recipientes de alumínio (código 7612.90.12)', null, false, 'alta', 'l10485'),
    ('842481', null, false, 'veiculos_maquinas', 'Pulverizadores agrícolas (código 8424.81)', null, false, 'alta', 'l10485'),
    ('8429', null, false, 'veiculos_maquinas', 'Tratores de esteira, escavadeiras, niveladoras (posição 84.29)', null, false, 'alta', 'l10485'),
    ('84306990', null, false, 'veiculos_maquinas', 'Máquinas de terraplenagem (código 8430.69.90)', null, false, 'alta', 'l10485'),
    ('8432', null, false, 'veiculos_maquinas', 'Máquinas agrícolas para preparação do solo (posição 84.32)', null, false, 'alta', 'l10485'),
    ('8433', null, false, 'veiculos_maquinas', 'Colheitadeiras e máquinas de colheita (posição 84.33)', null, false, 'alta', 'l10485'),
    ('8434', null, false, 'veiculos_maquinas', 'Ordenhadeiras e máquinas para leite (posição 84.34)', null, false, 'alta', 'l10485'),
    ('8435', null, false, 'veiculos_maquinas', 'Prensas para vinho e sucos (posição 84.35)', null, false, 'alta', 'l10485'),
    ('8436', null, false, 'veiculos_maquinas', 'Outras máquinas agrícolas e avícolas (posição 84.36)', null, false, 'alta', 'l10485'),
    ('8437', null, false, 'veiculos_maquinas', 'Máquinas para limpeza de grãos (posição 84.37)', null, false, 'alta', 'l10485'),
    ('8701', null, false, 'veiculos_maquinas', 'Tratores (posição 87.01)', null, false, 'alta', 'l10485'),
    ('8702', null, false, 'veiculos_maquinas', 'Ônibus e micro-ônibus (posição 87.02)', null, false, 'alta', 'l10485'),
    ('8703', null, false, 'veiculos_maquinas', 'Automóveis (posição 87.03)', null, false, 'alta', 'l10485'),
    ('8704', null, false, 'veiculos_maquinas', 'Caminhões e veículos de carga (posição 87.04)', null, false, 'alta', 'l10485'),
    ('8705', null, false, 'veiculos_maquinas', 'Veículos para usos especiais (posição 87.05)', null, false, 'alta', 'l10485'),
    ('8706', null, false, 'veiculos_maquinas', 'Chassis com motor (posição 87.06)', null, false, 'alta', 'l10485'),
    ('87162000', null, false, 'veiculos_maquinas', 'Reboques agrícolas (código 8716.20.00)', null, false, 'alta', 'l10485'),
    -- Autopeças — Lei 10.485/2002, art. 3º, Anexo I; revenda: art. 3º, § 2º, I
    ('40161010', null, false, 'autopecas', 'Partes de borracha (código 4016.10.10)', null, false, 'alta', 'l10485'),
    ('40169990', '03', false, 'autopecas', 'Artefatos de borracha (4016.99.90 Ex 03)', null, false, 'alta', 'l10485'),
    ('40169990', '05', false, 'autopecas', 'Artefatos de borracha (4016.99.90 Ex 05)', null, false, 'alta', 'l10485'),
    ('6813', null, false, 'autopecas', 'Guarnições de fricção — lonas e pastilhas de freio (posição 68.13)', null, false, 'alta', 'l10485'),
    ('70071100', null, false, 'autopecas', 'Vidros temperados para veículos (código 7007.11.00)', null, false, 'alta', 'l10485'),
    ('70072100', null, false, 'autopecas', 'Vidros laminados para veículos (código 7007.21.00)', null, false, 'alta', 'l10485'),
    ('70091000', null, false, 'autopecas', 'Espelhos retrovisores (código 7009.10.00)', null, false, 'alta', 'l10485'),
    ('73201000', '01', false, 'autopecas', 'Molas de lâminas (7320.10.00 Ex 01)', null, false, 'alta', 'l10485'),
    ('83012000', null, false, 'autopecas', 'Fechaduras para veículos (código 8301.20.00)', null, false, 'alta', 'l10485'),
    ('83023000', null, false, 'autopecas', 'Guarnições e ferragens para veículos (código 8302.30.00)', null, false, 'alta', 'l10485'),
    ('84073390', null, false, 'autopecas', 'Motores de explosão (código 8407.33.90)', null, false, 'alta', 'l10485'),
    ('84073490', null, false, 'autopecas', 'Motores de explosão (código 8407.34.90)', null, false, 'alta', 'l10485'),
    ('840820', null, false, 'autopecas', 'Motores diesel para veículos (código 8408.20)', null, false, 'alta', 'l10485'),
    ('840991', null, false, 'autopecas', 'Partes de motores a explosão (código 8409.91)', null, false, 'alta', 'l10485'),
    ('840999', null, false, 'autopecas', 'Partes de motores diesel (código 8409.99)', null, false, 'alta', 'l10485'),
    ('841330', null, false, 'autopecas', 'Bombas de combustível e óleo para motores (código 8413.30)', null, false, 'alta', 'l10485'),
    ('84139100', '01', false, 'autopecas', 'Partes de bombas (8413.91.00 Ex 01)', null, false, 'alta', 'l10485'),
    ('84148021', null, false, 'autopecas', 'Turbocompressores (código 8414.80.21)', null, false, 'alta', 'l10485'),
    ('84148022', null, false, 'autopecas', 'Turbocompressores (código 8414.80.22)', null, false, 'alta', 'l10485'),
    ('841520', null, false, 'autopecas', 'Ar-condicionado para veículos (código 8415.20)', null, false, 'alta', 'l10485'),
    ('84212300', null, false, 'autopecas', 'Filtros de óleo e combustível (código 8421.23.00)', null, false, 'alta', 'l10485'),
    ('84213100', null, false, 'autopecas', 'Filtros de ar para motores (código 8421.31.00)', null, false, 'alta', 'l10485'),
    ('84314100', null, false, 'autopecas', 'Caçambas, pás e garras (código 8431.41.00)', null, false, 'alta', 'l10485'),
    ('84314200', null, false, 'autopecas', 'Lâminas de buldôzer (código 8431.42.00)', null, false, 'alta', 'l10485'),
    ('84339090', null, false, 'autopecas', 'Partes de máquinas agrícolas (código 8433.90.90)', null, false, 'alta', 'l10485'),
    ('84818099', '01', false, 'autopecas', 'Válvulas (8481.80.99 Ex 01)', null, false, 'alta', 'l10485'),
    ('84818099', '02', false, 'autopecas', 'Válvulas (8481.80.99 Ex 02)', null, false, 'alta', 'l10485'),
    ('848310', null, false, 'autopecas', 'Árvores de transmissão e manivelas (código 8483.10)', null, false, 'alta', 'l10485'),
    ('84832000', null, false, 'autopecas', 'Mancais com rolamentos (código 8483.20.00)', null, false, 'alta', 'l10485'),
    ('848330', null, false, 'autopecas', 'Mancais e bronzinas (código 8483.30)', null, false, 'alta', 'l10485'),
    ('848340', null, false, 'autopecas', 'Engrenagens e caixas de câmbio (código 8483.40)', null, false, 'alta', 'l10485'),
    ('848350', null, false, 'autopecas', 'Volantes e polias (código 8483.50)', null, false, 'alta', 'l10485'),
    ('850520', null, false, 'autopecas', 'Embreagens eletromagnéticas (código 8505.20)', null, false, 'alta', 'l10485'),
    ('85071000', null, false, 'autopecas', 'Baterias de chumbo para partida (código 8507.10.00)', null, false, 'alta', 'l10485'),
    ('8511', null, false, 'autopecas', 'Velas, bobinas, alternadores e motores de partida (posição 85.11)', null, false, 'alta', 'l10485'),
    ('851220', null, false, 'autopecas', 'Faróis e lanternas (código 8512.20)', null, false, 'alta', 'l10485'),
    ('85123000', null, false, 'autopecas', 'Buzinas e alarmes (código 8512.30.00)', null, false, 'alta', 'l10485'),
    ('851240', null, false, 'autopecas', 'Limpadores de para-brisa (código 8512.40)', null, false, 'alta', 'l10485'),
    ('85129000', null, false, 'autopecas', 'Partes de aparelhos de iluminação e sinalização (código 8512.90.00)', null, false, 'alta', 'l10485'),
    ('85272', null, false, 'autopecas', 'Rádios para veículos (código 8527.2)', null, false, 'alta', 'l10485'),
    ('85365090', '01', false, 'autopecas', 'Interruptores (8536.50.90 Ex 01)', null, false, 'alta', 'l10485'),
    ('853910', null, false, 'autopecas', 'Faróis selados (código 8539.10)', null, false, 'alta', 'l10485'),
    ('85443000', null, false, 'autopecas', 'Jogos de fios para veículos (código 8544.30.00)', null, false, 'alta', 'l10485'),
    ('870600', null, false, 'autopecas', 'Chassis com motor (código 8706.00)', null, false, 'alta', 'l10485'),
    ('8707', null, false, 'autopecas', 'Carroçarias (posição 87.07)', null, false, 'alta', 'l10485'),
    ('8708', null, false, 'autopecas', 'Partes e acessórios de veículos — freios, suspensão, escapamento (posição 87.08)', null, false, 'alta', 'l10485'),
    ('90292010', null, false, 'autopecas', 'Velocímetros (código 9029.20.10)', null, false, 'alta', 'l10485'),
    ('90299010', null, false, 'autopecas', 'Partes de velocímetros (código 9029.90.10)', null, false, 'alta', 'l10485'),
    ('90303921', null, false, 'autopecas', 'Amperímetros para veículos (código 9030.39.21)', null, false, 'alta', 'l10485'),
    ('90318040', null, false, 'autopecas', 'Aparelhos de medida para veículos (código 9031.80.40)', null, false, 'alta', 'l10485'),
    ('9032892', null, false, 'autopecas', 'Reguladores automáticos (item 9032.89.2)', null, false, 'alta', 'l10485'),
    ('91040000', null, false, 'autopecas', 'Relógios de painel (código 9104.00.00)', null, false, 'alta', 'l10485'),
    ('94012000', null, false, 'autopecas', 'Assentos para veículos (código 9401.20.00)', null, false, 'alta', 'l10485'),
    -- Autopeças do Anexo II (dependem da destinação do produto)
    ('4009', null, false, 'autopecas', 'Tubos de borracha com acessórios (Anexo II, item 1)',
       'Somente os próprios para máquinas e veículos autopropulsados (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84089090', null, false, 'autopecas', 'Motores (Anexo II, item 3)',
       'Somente os próprios para as máquinas das posições 84.29 e 84.33 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84122110', null, false, 'autopecas', 'Cilindros hidráulicos (Anexo II, item 4)',
       'Somente os próprios para as máquinas das posições 84.29 e 84.33 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84122190', null, false, 'autopecas', 'Outros cilindros hidráulicos (Anexo II, item 5)',
       'Somente os próprios para as máquinas das posições 84.29 e 84.33 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84123110', null, false, 'autopecas', 'Cilindros pneumáticos (Anexo II, item 6)',
       'Somente os próprios para os veículos 8701.20.00, 87.02 e 87.04 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84136019', null, false, 'autopecas', 'Bombas volumétricas rotativas (Anexo II, item 7)',
       'Somente as próprias para máquinas e veículos do Anexo II da Lei 10.485/2002.', false, 'conferir', 'l10485'),
    ('84148019', null, false, 'autopecas', 'Compressores de ar (Anexo II, item 8)',
       'Somente os próprios para os veículos 8701.20.00, 87.02 e 87.04 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84149039', null, false, 'autopecas', 'Caixas de ventilação para veículos (Anexo II, item 9)', null, false, 'alta', 'l10485'),
    ('84329000', null, false, 'autopecas', 'Partes de máquinas agrícolas (Anexo II, item 10)',
       'Somente partes de máquinas 8432.40.00 e 8432.80.00 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84811000', null, false, 'autopecas', 'Válvulas redutoras de pressão (Anexo II, item 11)',
       'Somente as próprias para máquinas e veículos autopropulsados (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84812090', null, false, 'autopecas', 'Válvulas para transmissões hidráulicas (Anexo II, item 12)',
       'Somente as próprias para as máquinas das posições 84.29 e 84.33 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('84818092', null, false, 'autopecas', 'Válvulas solenoides (Anexo II, item 13)',
       'Somente as próprias para máquinas e veículos autopropulsados (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('8483601', null, false, 'autopecas', 'Embreagens de fricção (Anexo II, item 14)',
       'Somente as próprias para as máquinas das posições 84.29 e 84.33 (Anexo II da Lei 10.485/2002).', false, 'conferir', 'l10485'),
    ('85011019', null, false, 'autopecas', 'Motores de vidros elétricos de veículos (Anexo II, item 15)', null, false, 'alta', 'l10485'),
    -- Pneus — Lei 10.485/2002, art. 5º; revenda: parágrafo único
    ('4011', null, false, 'pneus', 'Pneus novos de borracha (posição 40.11)', null, false, 'alta', 'l10485'),
    ('4013', null, false, 'pneus', 'Câmaras de ar de borracha (posição 40.13)', null, false, 'alta', 'l10485'),
    -- Bebidas frias — Lei 13.097/2015, art. 14; alíquota zero só para o varejista (art. 28)
    ('21069010', '02', false, 'bebidas_frias', 'Preparações para refrigerantes (2106.90.10 Ex 02)',
       'Alíquota zero somente na revenda pelo varejista (art. 28 da Lei 13.097/2015).', true, 'alta', 'l13097'),
    ('2201', null, false, 'bebidas_frias', 'Águas minerais e gaseificadas (posição 22.01)',
       'Alíquota zero somente na revenda pelo varejista (art. 28 da Lei 13.097/2015).', true, 'alta', 'l13097'),
    ('22011000', '01', true, 'bebidas_frias', 'Exceção: 2201.10.00 Ex 01', null, false, 'alta', 'l13097'),
    ('22011000', '02', true, 'bebidas_frias', 'Exceção: 2201.10.00 Ex 02', null, false, 'alta', 'l13097'),
    ('2202', null, false, 'bebidas_frias', 'Refrigerantes, chás, refrescos, isotônicos e energéticos (posição 22.02)',
       'Alcança só água, refrigerantes, chás, refrescos, cerveja sem álcool, isotônicos e energéticos (art. 14, parágrafo único); alíquota zero somente no varejo (art. 28).',
       true, 'conferir', 'l13097'),
    ('2203', null, false, 'bebidas_frias', 'Cervejas de malte (posição 22.03)',
       'Alíquota zero somente na revenda pelo varejista (art. 28 da Lei 13.097/2015).', true, 'alta', 'l13097'),
    -- Combustíveis — Lei 9.718/1998, art. 4º; revenda no varejo: MP 2.158-35/2001, art. 42
    ('27101259', null, false, 'combustiveis', 'Gasolinas, exceto de aviação (código 2710.12.59)', null, false, 'alta', 'l9718'),
    ('27101921', null, false, 'combustiveis', 'Óleo diesel (código 2710.19.21)', null, false, 'alta', 'l9718'),
    ('27111910', null, false, 'combustiveis', 'Gás liquefeito de petróleo — GLP (código 2711.19.10)', null, false, 'alta', 'l9718'),
    ('27101911', null, false, 'combustiveis', 'Querosene de aviação (código 2710.19.11)', null, false, 'alta', 'l10560'),
    ('38260000', null, false, 'combustiveis', 'Biodiesel (código 3826.00.00)', null, false, 'alta', 'l11116'),
    ('22071000', null, false, 'combustiveis', 'Álcool etílico, inclusive para fins carburantes (código 2207.10.00)',
       'Álcool combustível: confira o regime (Lei 9.718/1998, art. 5º).', false, 'conferir', 'l9718'),
    ('220720', null, false, 'combustiveis', 'Álcool etílico desnaturado (código 2207.20)',
       'Álcool combustível: confira o regime (Lei 9.718/1998, art. 5º).', false, 'conferir', 'l9718')
  ) as v(ncm, ex, exc, grupo, descricao, condicao, varejo, confianca, fonte)
  join (values
    ('l10147', 'Lei nº 10.147/2000, art. 1º, I (medicamentos, perfumaria e higiene) e art. 2º (revenda à alíquota zero)', 'https://www.planalto.gov.br/ccivil_03/leis/l10147.htm'),
    ('l10485', 'Lei nº 10.485/2002, arts. 1º, 3º e 5º e Anexos I e II (máquinas, veículos, autopeças e pneus)', 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10485.htm'),
    ('l13097', 'Lei nº 13.097/2015, arts. 14 e 28 (bebidas frias)', 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13097.htm'),
    ('l9718', 'Lei nº 9.718/1998, arts. 4º e 5º, e MP nº 2.158-35/2001, art. 42 (combustíveis)', 'https://www.planalto.gov.br/ccivil_03/leis/l9718compilada.htm'),
    ('l10560', 'Lei nº 10.560/2002, art. 2º (querosene de aviação)', 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10560.htm'),
    ('l11116', 'Lei nº 11.116/2005, art. 3º (biodiesel)', 'https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2005/lei/l11116.htm')
  ) as f(codigo, titulo, url) on f.codigo = v.fonte;

-- -----------------------------------------------------------------------------
-- 4. Execuções e achados
-- -----------------------------------------------------------------------------
create table public.auditor_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'processando', 'concluida', 'erro')),
  origem text not null default 'automatica' check (origem in ('automatica', 'manual', 'mensal')),
  solicitada_por uuid references public.perfis(id) on delete set null,
  criada_em timestamptz not null default now(),
  iniciada_em timestamptz,
  concluida_em timestamptz,
  periodo_inicio date,
  periodo_fim date,
  notas_analisadas int,
  itens_analisados int,
  notas_relidas int,
  achados_novos int,
  achados_atualizados int,
  resumo jsonb,
  erro text check (erro is null or length(erro) <= 2000)
);
create index auditor_execucoes_empresa_idx on public.auditor_execucoes (empresa_id, criada_em desc);

create table public.auditor_achados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  execucao_id uuid references public.auditor_execucoes(id) on delete set null,
  regra text not null check (regra ~ '^[a-z0-9_]{3,40}$'),
  -- Identifica o achado entre execuções (regra:competência[:detalhe])
  chave text not null check (length(chave) between 3 and 200),
  competencia date not null check (extract(day from competencia) = 1),
  tipo text not null check (tipo in ('oportunidade', 'risco', 'informativo')),
  confianca text not null check (confianca in ('alta', 'media', 'conferir')),
  titulo text not null check (length(titulo) between 3 and 200),
  resumo text not null check (length(resumo) between 3 and 3000),
  valor_base numeric(15,2),
  valor_estimado numeric(15,2),
  memoria jsonb not null default '[]'::jsonb check (jsonb_typeof(memoria) = 'array' and pg_column_size(memoria) <= 60000),
  referencias jsonb not null default '[]'::jsonb check (jsonb_typeof(referencias) = 'array' and pg_column_size(referencias) <= 200000),
  fontes jsonb not null default '[]'::jsonb check (jsonb_typeof(fontes) = 'array' and pg_column_size(fontes) <= 20000),
  situacao text not null default 'novo' check (situacao in ('novo', 'confirmado', 'descartado', 'publicado', 'resolvido')),
  motivo text check (motivo is null or length(motivo) <= 1000),
  texto_cliente text check (texto_cliente is null or length(texto_cliente) <= 3000),
  revisado_por uuid references public.perfis(id) on delete set null,
  revisado_em timestamptz,
  publicado_por uuid references public.perfis(id) on delete set null,
  publicado_em timestamptz,
  solicitacao_id uuid references public.solicitacoes(id) on delete set null,
  detectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Valores mudaram depois da revisão (novas notas, por exemplo)
  valores_alterados_em timestamptz,
  constraint auditor_achados_chave_uk unique (empresa_id, chave)
);
create index auditor_achados_empresa_idx on public.auditor_achados (empresa_id, situacao, competencia desc);

alter table public.auditor_ncm_monofasico enable row level security;
alter table public.auditor_execucoes enable row level security;
alter table public.auditor_achados enable row level security;

create policy auditor_ncm_leitura on public.auditor_ncm_monofasico for select to authenticated
  using ((select app.tipo_usuario()) in ('admin', 'equipe'));
create policy auditor_ncm_inclusao on public.auditor_ncm_monofasico for insert to authenticated
  with check ((select app.tipo_usuario()) = 'admin');
create policy auditor_ncm_alteracao on public.auditor_ncm_monofasico for update to authenticated
  using ((select app.tipo_usuario()) = 'admin') with check ((select app.tipo_usuario()) = 'admin');
create policy auditor_ncm_exclusao on public.auditor_ncm_monofasico for delete to authenticated
  using ((select app.tipo_usuario()) = 'admin');

create policy auditor_execucoes_leitura on public.auditor_execucoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('auditor.gerenciar'))::uuid[]));

-- A equipe vê todos os achados; o cliente só os publicados (ou já resolvidos depois de publicados).
create policy auditor_achados_leitura on public.auditor_achados for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('auditor.gerenciar'))::uuid[])
    or (situacao in ('publicado', 'resolvido') and publicado_em is not null
        and empresa_id = any ((select app.empresas_com('auditor.ver'))::uuid[]))
  );

grant select on public.auditor_ncm_monofasico, public.auditor_execucoes, public.auditor_achados to authenticated;
grant insert, update, delete on public.auditor_ncm_monofasico to authenticated;
grant select, insert, update, delete on public.auditor_ncm_monofasico, public.auditor_execucoes, public.auditor_achados to service_role;

-- Serviço do catálogo para o cliente pedir a recuperação
insert into public.servicos_catalogo (codigo, nome, descricao, area, prazo_dias, documentos_necessarios, ordem) values
  ('recuperacao_tributos', 'Recuperação de impostos pagos a mais',
   'Análise e pedido de restituição ou compensação de tributos pagos a mais (por exemplo, PIS/Cofins monofásico ou ICMS-ST no Simples).',
   'fiscal', 30, null, 115)
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Agendamento das análises
-- -----------------------------------------------------------------------------
-- Valor em reais com separadores brasileiros (independe da configuração do banco)
create or replace function app.moeda_br(p_valor numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'R$ ' || translate(to_char(coalesce(p_valor, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;
-- Uma análise por empresa a cada janela de 10 minutos em que chegaram notas
-- (a análise roda logo depois que a janela fecha, juntando os envios).
create or replace function app.agendar_auditor_fiscal(p_empresa_id uuid, p_quando timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_janela timestamptz := date_trunc('hour', p_quando) + floor(extract(minute from p_quando) / 10) * interval '10 minutes';
begin
  return app.enfileirar(
    'auditor_fiscal',
    jsonb_build_object('empresa_id', p_empresa_id, 'origem', 'automatica'),
    p_empresa_id,
    'auditor:auto:' || p_empresa_id::text || ':' || extract(epoch from v_janela)::bigint::text,
    v_janela + interval '12 minutes',
    120
  );
end;
$$;

create or replace function app.tg_documentos_fiscais_auditor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.relacionado_empresa and new.modelo in ('55', '65') then
    perform app.agendar_auditor_fiscal(new.empresa_id, now());
  end if;
  return new;
end;
$$;
create trigger documentos_fiscais_auditor after insert on public.documentos_fiscais
  for each row execute function app.tg_documentos_fiscais_auditor();

-- "Analisar agora" (equipe)
create or replace function public.auditor_analisar(p_empresa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'auditor.gerenciar');
  select id into v_id from public.auditor_execucoes
   where empresa_id = p_empresa_id and situacao in ('pendente', 'processando') and criada_em > now() - interval '15 minutes'
   order by criada_em desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.auditor_execucoes (empresa_id, origem, solicitada_por)
  values (p_empresa_id, 'manual', auth.uid())
  returning id into v_id;
  perform app.enfileirar('auditor_fiscal', jsonb_build_object('empresa_id', p_empresa_id, 'execucao_id', v_id, 'origem', 'manual'),
                         p_empresa_id, 'auditor:manual:' || v_id::text, now(), 50);
  return v_id;
end;
$$;

-- Rotina diária: no dia 2 de cada mês reanalisa as empresas com notas nos
-- últimos 5 anos (a receita de 12 meses e a faixa do Simples mudam a cada mês).
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
                    where df.empresa_id = e.id and df.relacionado_empresa and df.modelo in ('55', '65')
                      and df.competencia >= (date_trunc('month', v_hoje) - interval '60 months')::date)
  loop
    perform app.enfileirar('auditor_fiscal', jsonb_build_object('empresa_id', r.id, 'origem', 'mensal'), r.id,
                           'auditor:mensal:' || r.id::text || ':' || to_char(v_hoje, 'YYYY-MM'), now(), 130);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('agendadas', v_n);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Dados para a análise (processador)
-- -----------------------------------------------------------------------------
-- Notas válidas da empresa no período (mesmos filtros da previsão de impostos:
-- sem documentos excluídos ou bloqueados, sem notas canceladas ou não autorizadas).
create or replace function app.auditor_notas_validas(p_empresa_id uuid, p_inicio date, p_fim date)
returns setof public.documentos_fiscais
language sql
stable
security definer
set search_path = ''
as $$
  select df.*
    from public.documentos_fiscais df
    join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
   where df.empresa_id = p_empresa_id
     and df.competencia between p_inicio and p_fim
     and df.relacionado_empresa
     and not df.cancelada_evento
     and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
     and d.excluido_em is null
     and coalesce(d.verificacao_status, '') <> 'bloqueado'
     and not (df.avisos::text ilike '%registro de cancelamento%');
$$;

-- Itens das NF-e/NFC-e agrupados por mês, operação e códigos fiscais (com
-- até 3 exemplos por grupo): o auditor trabalha sobre os grupos, o que mantém
-- a análise rápida mesmo com milhares de cupons por mês.
create or replace function public.auditor_itens_agrupados(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with notas as (
    select n.id, n.documento_id, n.modelo, n.numero, n.data_emissao, n.competencia, n.operacao, n.crt_emitente,
           coalesce(n.consumidor_final, n.modelo = '65') as consumidor_final,
           coalesce(n.data_emissao >= timestamptz '2026-08-03 00:00:00-03', false) as apos_ibscbs_normal
      from app.auditor_notas_validas(p_empresa_id, p_inicio, p_fim) n
     where n.modelo in ('55', '65') and n.operacao in ('entrada', 'saida')
  ),
  itens as (
    select n.*, i.numero_item, i.descricao, nullif(trim(coalesce(i.ncm, '')), '') as ncm, i.cfop, i.gtin, i.cest, i.ex_tipi,
           coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor, i.tributos as t
      from notas n
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
  ),
  grupos as (
    select competencia, operacao, modelo, consumidor_final, crt_emitente as crt, cfop, ncm, gtin, cest, ex_tipi as ex,
           t ->> 'csosn' as csosn, t ->> 'cst_icms' as cst_icms, t ->> 'cst_pis' as cst_pis, t ->> 'cst_cofins' as cst_cofins,
           t ->> 'cst_ibscbs' as cst_ibscbs, t ->> 'cclasstrib' as cclasstrib,
           t ->> 'p_cbs' as p_cbs, t ->> 'p_ibs_uf' as p_ibs_uf, t ->> 'p_ibs_mun' as p_ibs_mun,
           (t ? 'p_red_cbs' or t ? 'p_red_ibs') as reducao,
           apos_ibscbs_normal,
           count(*)::int as itens,
           count(distinct id)::int as notas,
           sum(valor) as valor,
           sum(coalesce(app.try_numeric(t ->> 'icms'), 0)) as icms,
           sum(coalesce(app.try_numeric(t ->> 'icms_st'), 0)) as icms_st,
           sum(coalesce(app.try_numeric(t ->> 'icms_st_retido'), 0)) as icms_st_retido,
           sum(coalesce(app.try_numeric(t ->> 'pis'), 0)) as pis,
           sum(coalesce(app.try_numeric(t ->> 'cofins'), 0)) as cofins,
           sum(coalesce(app.try_numeric(t ->> 'cbs'), 0)) as cbs,
           sum(coalesce(app.try_numeric(t ->> 'ibs'),
                        coalesce(app.try_numeric(t ->> 'ibs_uf'), 0) + coalesce(app.try_numeric(t ->> 'ibs_mun'), 0))) as ibs,
           to_jsonb((array_agg(jsonb_build_object(
             'nota_id', id, 'documento_id', documento_id, 'numero', numero, 'modelo', modelo, 'data', data_emissao, 'item', numero_item,
             'descricao', left(descricao, 120), 'valor', valor) order by valor desc))[1:3]) as exemplos
      from itens
     group by competencia, operacao, modelo, consumidor_final, crt_emitente, cfop, ncm, gtin, cest, ex_tipi,
              t ->> 'csosn', t ->> 'cst_icms', t ->> 'cst_pis', t ->> 'cst_cofins', t ->> 'cst_ibscbs', t ->> 'cclasstrib',
              t ->> 'p_cbs', t ->> 'p_ibs_uf', t ->> 'p_ibs_mun', (t ? 'p_red_cbs' or t ? 'p_red_ibs'), apos_ibscbs_normal
  )
  select coalesce(jsonb_agg(to_jsonb(g) order by g.competencia, g.operacao), '[]'::jsonb) from grupos g;
$$;

-- Empresa, regime de cada mês, parâmetros dos cálculos, receitas mensais
-- (para a receita bruta de 12 meses do Simples) e o catálogo de NCM.
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
       where n.leitura_versao < 2 and n.modelo in ('55', '65')
    ),
    'notas', (
      select count(*) from app.auditor_notas_validas(p_empresa_id, p_inicio, p_fim) n
       where n.modelo in ('55', '65') and n.operacao in ('entrada', 'saida')
    ),
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

-- -----------------------------------------------------------------------------
-- 7. Resultado da análise (processador)
-- -----------------------------------------------------------------------------
create or replace function public.auditor_registrar_resultado(p_execucao_id uuid, p_achados jsonb, p_resumo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exec public.auditor_execucoes;
  a jsonb;
  v_atual public.auditor_achados;
  v_novos int := 0;
  v_atualizados int := 0;
  v_removidos int := 0;
  v_valor_novos numeric := 0;
  v_chaves text[];
  v_nome text;
begin
  select * into v_exec from public.auditor_execucoes where id = p_execucao_id for update;
  if not found then
    raise exception 'Execução não encontrada.';
  end if;
  if jsonb_typeof(coalesce(p_achados, '[]'::jsonb)) <> 'array' then
    raise exception 'Achados inválidos.';
  end if;
  select coalesce(array_agg(x ->> 'chave'), array[]::text[]) into v_chaves from jsonb_array_elements(coalesce(p_achados, '[]'::jsonb)) x;

  for a in select * from jsonb_array_elements(coalesce(p_achados, '[]'::jsonb))
  loop
    select * into v_atual from public.auditor_achados where empresa_id = v_exec.empresa_id and chave = a ->> 'chave';
    if not found then
      insert into public.auditor_achados (
        empresa_id, execucao_id, regra, chave, competencia, tipo, confianca, titulo, resumo,
        valor_base, valor_estimado, memoria, referencias, fontes
      ) values (
        v_exec.empresa_id, v_exec.id, a ->> 'regra', a ->> 'chave', (a ->> 'competencia')::date, a ->> 'tipo', a ->> 'confianca',
        left(a ->> 'titulo', 200), left(a ->> 'resumo', 3000),
        (a ->> 'valor_base')::numeric, (a ->> 'valor_estimado')::numeric,
        coalesce(a -> 'memoria', '[]'::jsonb), coalesce(a -> 'referencias', '[]'::jsonb), coalesce(a -> 'fontes', '[]'::jsonb)
      );
      v_novos := v_novos + 1;
      if a ->> 'tipo' = 'oportunidade' then
        v_valor_novos := v_valor_novos + coalesce((a ->> 'valor_estimado')::numeric, 0);
      end if;
    else
      update public.auditor_achados
         set execucao_id = v_exec.id,
             tipo = a ->> 'tipo',
             confianca = a ->> 'confianca',
             titulo = left(a ->> 'titulo', 200),
             resumo = left(a ->> 'resumo', 3000),
             valor_base = (a ->> 'valor_base')::numeric,
             valor_estimado = (a ->> 'valor_estimado')::numeric,
             memoria = coalesce(a -> 'memoria', '[]'::jsonb),
             referencias = coalesce(a -> 'referencias', '[]'::jsonb),
             fontes = coalesce(a -> 'fontes', '[]'::jsonb),
             atualizado_em = now(),
             valores_alterados_em = case
               when v_atual.situacao <> 'novo'
                and (v_atual.valor_estimado is distinct from (a ->> 'valor_estimado')::numeric
                     or v_atual.valor_base is distinct from (a ->> 'valor_base')::numeric)
               then now() else v_atual.valores_alterados_em end
       where id = v_atual.id;
      v_atualizados := v_atualizados + 1;
    end if;
  end loop;

  -- Achados ainda não revisados que deixaram de aparecer (ex.: nota excluída) saem da lista.
  delete from public.auditor_achados
   where empresa_id = v_exec.empresa_id and situacao = 'novo' and not (chave = any(v_chaves));
  get diagnostics v_removidos = row_count;

  update public.auditor_execucoes
     set situacao = 'concluida',
         concluida_em = now(),
         periodo_inicio = (p_resumo ->> 'periodo_inicio')::date,
         periodo_fim = (p_resumo ->> 'periodo_fim')::date,
         notas_analisadas = (p_resumo ->> 'notas')::int,
         itens_analisados = (p_resumo ->> 'itens')::int,
         notas_relidas = coalesce((p_resumo ->> 'notas_relidas')::int, notas_relidas),
         achados_novos = v_novos,
         achados_atualizados = v_atualizados,
         resumo = p_resumo,
         erro = null
   where id = v_exec.id;

  if v_novos > 0 then
    select coalesce(nullif(nome_fantasia, ''), razao_social) into v_nome from public.empresas where id = v_exec.empresa_id;
    perform app.notificar_equipe(
      v_exec.empresa_id, 'auditor_fiscal',
      'Auditor fiscal: ' || v_novos || case when v_novos = 1 then ' achado novo' else ' achados novos' end || ' — ' || coalesce(v_nome, ''),
      case when v_valor_novos > 0
           then 'Possível economia de ' || app.moeda_br(v_valor_novos) || ' para revisar.'
           else 'Há pontos para revisar nas notas da empresa.' end,
      '/e/' || v_exec.empresa_id::text || '/auditor-fiscal',
      false
    );
  end if;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados, 'removidos', v_removidos);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Revisão pela equipe e pedido do cliente
-- -----------------------------------------------------------------------------
create or replace function public.auditor_revisar(p_id uuid, p_acao text, p_motivo text default null, p_texto_cliente text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.auditor_achados;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_texto text := nullif(trim(coalesce(p_texto_cliente, '')), '');
begin
  select * into v from public.auditor_achados where id = p_id for update;
  if not found then
    raise exception 'Achado não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'auditor.gerenciar');

  if p_acao = 'confirmar' then
    if v.situacao <> 'novo' then
      raise exception 'Somente achados novos podem ser confirmados.';
    end if;
    update public.auditor_achados set situacao = 'confirmado', motivo = coalesce(v_motivo, motivo), revisado_por = auth.uid(), revisado_em = now()
     where id = p_id;
  elsif p_acao = 'descartar' then
    if v.situacao not in ('novo', 'confirmado') then
      raise exception 'Este achado não pode ser descartado na situação atual.';
    end if;
    if v_motivo is null or length(v_motivo) < 5 then
      raise exception 'Explique em poucas palavras por que o achado foi descartado.';
    end if;
    update public.auditor_achados set situacao = 'descartado', motivo = v_motivo, revisado_por = auth.uid(), revisado_em = now()
     where id = p_id;
  elsif p_acao = 'publicar' then
    if v.situacao not in ('novo', 'confirmado') then
      raise exception 'Somente achados novos ou confirmados podem ser publicados ao cliente.';
    end if;
    if v_texto is null or length(v_texto) < 10 then
      raise exception 'Escreva a mensagem que o cliente vai ler (ao menos 10 caracteres).';
    end if;
    update public.auditor_achados
       set situacao = 'publicado', texto_cliente = v_texto, motivo = coalesce(v_motivo, motivo),
           revisado_por = coalesce(revisado_por, auth.uid()), revisado_em = coalesce(revisado_em, now()),
           publicado_por = auth.uid(), publicado_em = now()
     where id = p_id;
    perform app.notificar_clientes(
      v.empresa_id, 'auditor.ver', 'auditor_fiscal_publicado',
      'O escritório encontrou uma oportunidade de economia',
      left(v.titulo, 200),
      '/e/' || v.empresa_id::text || '/auditor-fiscal',
      true
    );
  elsif p_acao = 'retirar' then
    -- Publicação feita por engano: volta para a equipe (se o cliente ainda não pediu ajuda)
    if v.situacao <> 'publicado' then
      raise exception 'Somente achados publicados podem ser retirados do cliente.';
    end if;
    if v.solicitacao_id is not null then
      raise exception 'O cliente já pediu ajuda com este achado: responda pela solicitação.';
    end if;
    update public.auditor_achados
       set situacao = 'confirmado', publicado_em = null, publicado_por = null, motivo = coalesce(v_motivo, motivo)
     where id = p_id;
  elsif p_acao = 'resolver' then
    if v.situacao not in ('confirmado', 'publicado') then
      raise exception 'Somente achados confirmados ou publicados podem ser concluídos.';
    end if;
    update public.auditor_achados set situacao = 'resolvido', motivo = coalesce(v_motivo, motivo), revisado_em = now() where id = p_id;
  elsif p_acao = 'reabrir' then
    if v.situacao not in ('descartado', 'resolvido') then
      raise exception 'Somente achados descartados ou concluídos podem ser reabertos.';
    end if;
    update public.auditor_achados
       set situacao = case when v.publicado_em is not null then 'publicado' else 'novo' end,
           motivo = v_motivo
     where id = p_id;
  else
    raise exception 'Ação inválida.';
  end if;

  perform app.registrar_auditoria('auditor_' || p_acao, 'auditor_achados', p_id::text, v.empresa_id,
    jsonb_build_object('titulo', v.titulo, 'competencia', v.competencia, 'valor_estimado', v.valor_estimado, 'motivo', v_motivo));
end;
$$;

-- O cliente pede ao escritório que cuide de uma oportunidade publicada (abre uma solicitação).
create or replace function public.auditor_pedir_ajuda(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.auditor_achados;
  v_sol uuid;
begin
  select * into v from public.auditor_achados where id = p_id for update;
  if not found or v.situacao <> 'publicado' or v.publicado_em is null then
    raise exception 'Oportunidade não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'auditor.ver');
  if v.solicitacao_id is not null then
    return v.solicitacao_id;
  end if;
  v_sol := public.abrir_solicitacao(
    v.empresa_id,
    'recuperacao_tributos',
    left('Recuperar: ' || v.titulo, 160),
    'Pedido aberto a partir do auditor fiscal (' || to_char(v.competencia, 'MM/YYYY') || ').'
      || case when v.valor_estimado is not null
              then ' Valor estimado: ' || app.moeda_br(v.valor_estimado) || '.' else '' end,
    'normal',
    array[]::uuid[]
  );
  update public.auditor_achados set solicitacao_id = v_sol where id = p_id;
  perform app.registrar_auditoria('auditor_pedido_cliente', 'auditor_achados', p_id::text, v.empresa_id,
    jsonb_build_object('solicitacao_id', v_sol));
  return v_sol;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Permissões de execução
-- -----------------------------------------------------------------------------
revoke execute on function public.atualizar_leitura_xml_fiscal(uuid, jsonb), public.auditor_registrar_resultado(uuid, jsonb, jsonb),
  public.rotina_auditor_fiscal(), public.auditor_itens_agrupados(uuid, date, date), public.auditor_dados(uuid, date, date), public.auditor_analisar(uuid), public.auditor_revisar(uuid, text, text, text),
  public.auditor_pedir_ajuda(uuid) from public, anon, authenticated;
revoke execute on function app.agendar_auditor_fiscal(uuid, timestamptz), app.tg_documentos_fiscais_auditor() from public, anon, authenticated;
revoke execute on function app.moeda_br(numeric) from public, anon;
grant execute on function app.moeda_br(numeric) to authenticated, service_role;
grant execute on function public.auditor_analisar(uuid), public.auditor_revisar(uuid, text, text, text), public.auditor_pedir_ajuda(uuid)
  to authenticated;
grant execute on function public.atualizar_leitura_xml_fiscal(uuid, jsonb), public.auditor_registrar_resultado(uuid, jsonb, jsonb),
  public.rotina_auditor_fiscal(), public.auditor_itens_agrupados(uuid, date, date), public.auditor_dados(uuid, date, date),
  app.agendar_auditor_fiscal(uuid, timestamptz), app.auditor_notas_validas(uuid, date, date) to service_role;
revoke execute on function app.auditor_notas_validas(uuid, date, date) from public, anon, authenticated;
