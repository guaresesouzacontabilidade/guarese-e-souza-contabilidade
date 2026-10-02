-- =============================================================================
-- Migração 0300: documentos, versões, histórico, acessos e armazenamento privado
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categorias de documentos
-- -----------------------------------------------------------------------------
create table public.categorias_documento (
  codigo text primary key,
  nome text not null,
  descricao text,
  grupo text not null,
  extensoes text[] not null,
  escritorio boolean not null default false,   -- documento disponibilizado pelo escritório ao cliente
  ordem int not null default 100,
  ativo boolean not null default true
);

insert into public.categorias_documento (codigo, nome, descricao, grupo, extensoes, escritorio, ordem) values
  ('nfe_saida_xml', 'XML de notas fiscais de saída', 'NF-e e NFC-e emitidas pela empresa (vendas, remessas, devoluções emitidas). Aceita XML ou ZIP com XMLs.', 'fiscal', array['xml','zip'], false, 10),
  ('nfe_entrada_xml', 'XML de notas fiscais de entrada', 'NF-e recebidas de fornecedores (compras, serviços com mercadorias, devoluções recebidas). Aceita XML ou ZIP com XMLs.', 'fiscal', array['xml','zip'], false, 20),
  ('cte_xml', 'XML de conhecimentos de transporte (CT-e)', 'CT-e emitidos ou tomados pela empresa. Aceita XML ou ZIP com XMLs.', 'fiscal', array['xml','zip'], false, 25),
  ('eventos_fiscais', 'Eventos fiscais', 'Cancelamentos, cartas de correção e demais eventos de NF-e/CT-e em XML.', 'fiscal', array['xml','zip'], false, 30),
  ('nfse', 'Notas fiscais de serviço (NFS-e)', 'NFS-e emitidas ou tomadas, em XML ou PDF.', 'fiscal', array['xml','pdf','zip'], false, 40),
  ('notas_pdf', 'Notas fiscais e documentos em PDF', 'DANFE, cupons e demais documentos fiscais em PDF ou foto.', 'fiscal', array['pdf','jpg','jpeg','png','webp','heic'], false, 50),
  ('extrato_bancario', 'Extratos bancários', 'Extrato completo do mês de cada conta bancária (de preferência OFX).', 'financeiro', array['ofx','csv','xlsx','xls','pdf','txt'], false, 60),
  ('extrato_cartao', 'Extratos e faturas de cartão de crédito', 'Fatura completa do cartão de crédito da empresa.', 'financeiro', array['ofx','csv','xlsx','xls','pdf'], false, 70),
  ('relatorio_maquininha', 'Relatórios de maquininhas e plataformas de pagamento', 'Relatórios de vendas e recebimentos de adquirentes (Stone, Cielo, Rede, PagSeguro, Mercado Pago etc.).', 'financeiro', array['csv','xlsx','xls','pdf','ofx'], false, 80),
  ('comprovante', 'Comprovantes de PIX, transferências, pagamentos e recebimentos', 'Comprovantes que identificam pagamentos e recebimentos.', 'financeiro', array['pdf','jpg','jpeg','png','webp','heic'], false, 90),
  ('boleto', 'Boletos e comprovantes de quitação', 'Boletos a pagar e seus comprovantes de pagamento.', 'financeiro', array['pdf','jpg','jpeg','png','webp','heic'], false, 100),
  ('compras_vendas_despesas', 'Documentos de compras, vendas, custos e despesas', 'Recibos, cupons, pedidos e demais documentos de operações.', 'financeiro', array['pdf','jpg','jpeg','png','webp','heic','xml','xlsx','xls','csv'], false, 110),
  ('folha_pagamento', 'Folha de pagamento, pró-labore e documentos trabalhistas', 'Informações de ponto, admissões, demissões, férias, pró-labore etc.', 'trabalhista', array['pdf','xlsx','xls','csv','jpg','jpeg','png','doc','docx'], false, 120),
  ('guia_imposto', 'Guias de impostos e comprovantes de recolhimento', 'Guias pagas e comprovantes de recolhimento de tributos.', 'tributario', array['pdf','jpg','jpeg','png','webp','heic'], false, 130),
  ('contrato_emprestimo', 'Contratos, empréstimos e financiamentos', 'Contratos, cédulas de crédito, cronogramas de financiamento.', 'contratos', array['pdf','doc','docx','jpg','jpeg','png','xlsx'], false, 140),
  ('outros', 'Outros documentos solicitados pelo escritório', 'Qualquer outro documento solicitado pela equipe.', 'outros', array['pdf','jpg','jpeg','png','webp','heic','xml','xlsx','xls','csv','ofx','doc','docx','txt','zip'], false, 150),
  ('esc_guia', 'Guias de impostos', 'Guias emitidas pelo escritório para pagamento.', 'escritorio', array['pdf','jpg','jpeg','png','zip'], true, 200),
  ('esc_folha', 'Folhas de pagamento', 'Folhas, holerites e relatórios de folha.', 'escritorio', array['pdf','xlsx','xls','csv','zip'], true, 210),
  ('esc_recibo', 'Recibos', 'Recibos de honorários, pró-labore e outros.', 'escritorio', array['pdf','jpg','jpeg','png'], true, 220),
  ('esc_relatorio', 'Relatórios', 'Balancetes, demonstrações e relatórios contábeis.', 'escritorio', array['pdf','xlsx','xls','csv','zip'], true, 230),
  ('esc_contrato', 'Contratos', 'Contratos e documentos societários.', 'escritorio', array['pdf','doc','docx','zip'], true, 240),
  ('esc_outros', 'Outros documentos do escritório', 'Demais documentos destinados ao cliente.', 'escritorio', array['pdf','jpg','jpeg','png','xlsx','xls','csv','doc','docx','xml','txt','zip'], true, 250);

-- -----------------------------------------------------------------------------
-- Documentos
-- -----------------------------------------------------------------------------
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  direcao text not null default 'cliente' check (direcao in ('cliente', 'escritorio')),
  competencia date not null check (extract(day from competencia) = 1),
  categoria_codigo text not null references public.categorias_documento(codigo),
  titulo text,
  nome_original text not null,
  extensao text,
  mime text,
  tamanho bigint,
  sha256 text,
  versao_atual int not null default 1,
  storage_path text,
  upload_status text not null default 'pendente' check (upload_status in ('pendente', 'concluido')),
  status text check (status in ('recebido', 'em_analise', 'aprovado', 'correcao')),
  status_motivo text,
  status_alterado_em timestamptz,
  status_alterado_por uuid references public.perfis(id) on delete set null,
  observacao text,
  checklist_item_id uuid,
  origem text not null default 'upload' check (origem in ('upload', 'camera', 'zip', 'escritorio', 'sistema')),
  zip_origem_id uuid references public.documentos(id) on delete set null,
  duplicado_de uuid references public.documentos(id) on delete set null,
  recebido_apos_fechamento boolean not null default false,
  apos_fechamento_avaliado_em timestamptz,
  apos_fechamento_avaliado_por uuid references public.perfis(id) on delete set null,
  apos_fechamento_parecer text,
  sugestao jsonb,
  verificacao_status text not null default 'pendente' check (verificacao_status in ('pendente', 'ok', 'bloqueado', 'erro')),
  verificacao_detalhes text,
  processamento_status text not null default 'pendente'
    check (processamento_status in ('pendente', 'processando', 'concluido', 'erro', 'nao_aplicavel')),
  processamento_detalhes jsonb,
  extracao jsonb,
  requer_conferencia boolean not null default false,
  publicado_em timestamptz,
  vencimento date,
  valor numeric(15,2),
  enviado_por uuid references public.perfis(id) on delete set null,
  enviado_em timestamptz,
  excluido_em timestamptz,
  excluido_por uuid references public.perfis(id) on delete set null,
  motivo_exclusao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documentos_sha256_formato check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint documentos_status_coerente check (
    (direcao = 'cliente' and status is not null) or (direcao = 'escritorio' and status is null)
  )
);

create index documentos_empresa_competencia_idx on public.documentos (empresa_id, competencia desc) where excluido_em is null;
create index documentos_empresa_status_idx on public.documentos (empresa_id, status) where excluido_em is null;
create index documentos_sha256_idx on public.documentos (empresa_id, sha256);
create index documentos_checklist_idx on public.documentos (checklist_item_id);
create index documentos_zip_idx on public.documentos (zip_origem_id);
create index documentos_fila_idx on public.documentos (status, enviado_em) where excluido_em is null and upload_status = 'concluido';
create index documentos_nome_idx on public.documentos using gin (app.normalizar(nome_original || ' ' || coalesce(titulo, '')) extensions.gin_trgm_ops);

create trigger documentos_updated_at before update on public.documentos
  for each row execute function app.tg_updated_at();
create trigger auditoria_documentos after insert or update or delete on public.documentos
  for each row execute function app.tg_auditoria();

-- Versões: o arquivo original nunca é sobrescrito; substituições criam nova versão.
create table public.documento_versoes (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  versao int not null check (versao >= 1),
  storage_path text not null unique,
  nome_original text not null,
  mime text,
  tamanho bigint,
  sha256 text,
  motivo text,
  enviado_por uuid references public.perfis(id) on delete set null,
  criado_em timestamptz not null default now(),
  upload_concluido_em timestamptz,
  verificacao_status text not null default 'pendente' check (verificacao_status in ('pendente', 'ok', 'bloqueado', 'erro')),
  verificacao_detalhes text,
  constraint documento_versoes_unica unique (documento_id, versao)
);
create index documento_versoes_documento_idx on public.documento_versoes (documento_id);

-- Histórico de status e alterações relevantes
create table public.documento_historico (
  id bigint generated always as identity primary key,
  documento_id uuid not null references public.documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  acao text not null,
  status_anterior text,
  status_novo text,
  motivo text,
  detalhes jsonb,
  alterado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  alterado_em timestamptz not null default now()
);
create index documento_historico_documento_idx on public.documento_historico (documento_id, alterado_em);

-- Acessos: visualizações e downloads (visualização NÃO comprova pagamento)
create table public.documento_acessos (
  id bigint generated always as identity primary key,
  documento_id uuid not null references public.documentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  user_id uuid references public.perfis(id) on delete set null,
  tipo text not null check (tipo in ('visualizacao', 'download', 'download_lote')),
  versao int,
  ip text,
  user_agent text,
  ocorrido_em timestamptz not null default now()
);
create index documento_acessos_documento_idx on public.documento_acessos (documento_id, ocorrido_em desc);
create index documento_acessos_empresa_idx on public.documento_acessos (empresa_id, ocorrido_em desc);

-- -----------------------------------------------------------------------------
-- Funções auxiliares
-- -----------------------------------------------------------------------------
create or replace function app.extensao_arquivo(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(substring(coalesce(p_nome, '') from '\.([A-Za-z0-9]{1,8})$'));
$$;

create or replace function app.nome_seguro(p_nome text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ext text := app.extensao_arquivo(p_nome);
  v_base text;
begin
  v_base := regexp_replace(coalesce(p_nome, 'arquivo'), '\.[A-Za-z0-9]{1,8}$', '');
  v_base := regexp_replace(app.normalizar(v_base), '[^a-z0-9_-]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then
    v_base := 'arquivo';
  end if;
  v_base := left(v_base, 80);
  return v_base || coalesce('.' || v_ext, '');
end;
$$;

-- Pode o usuário baixar este objeto do armazenamento? (usada pela política do Storage)
create or replace function app.pode_baixar_objeto(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select d.empresa_id, d.direcao, d.publicado_em, d.excluido_em, dv.verificacao_status
    into v
    from public.documento_versoes dv
    join public.documentos d on d.id = dv.documento_id
   where dv.storage_path = p_nome
   limit 1;
  if not found then
    return false;
  end if;
  if not app.pode(v.empresa_id, 'documentos.baixar') then
    return false;
  end if;
  -- Equipe com permissão de revisão vê tudo (inclusive excluídos e bloqueados).
  if app.pode(v.empresa_id, 'documentos.revisar') or app.pode(v.empresa_id, 'documentos.publicar') then
    return true;
  end if;
  if v.excluido_em is not null or v.verificacao_status = 'bloqueado' then
    return false;
  end if;
  if v.direcao = 'escritorio' and v.publicado_em is null then
    return false;
  end if;
  return true;
end;
$$;

create or replace function app.e_equipe_da_empresa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.pode(p_empresa_id, 'documentos.revisar') or app.pode(p_empresa_id, 'documentos.publicar');
$$;

-- -----------------------------------------------------------------------------
-- RPC: criar documento (antes do envio do arquivo)
-- -----------------------------------------------------------------------------
create or replace function public.criar_documento(
  p_empresa_id uuid,
  p_competencia date,
  p_categoria text,
  p_nome_arquivo text,
  p_mime text,
  p_tamanho bigint,
  p_sha256 text,
  p_observacao text default null,
  p_checklist_item_id uuid default null,
  p_origem text default 'upload',
  p_forcar_duplicado boolean default false,
  p_titulo text default null,
  p_vencimento date default null,
  p_valor numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat public.categorias_documento;
  v_esc public.escritorio;
  v_direcao text;
  v_ext text;
  v_competencia date;
  v_dup record;
  v_doc_id uuid := gen_random_uuid();
  v_versao_id uuid := gen_random_uuid();
  v_path text;
  v_item record;
  v_tem_dup boolean := false;
begin
  select * into v_cat from public.categorias_documento where codigo = p_categoria and ativo;
  if not found then
    raise exception 'Categoria de documento inválida.';
  end if;

  if v_cat.escritorio then
    perform app.exigir(p_empresa_id, 'documentos.publicar');
    v_direcao := 'escritorio';
  else
    perform app.exigir(p_empresa_id, 'documentos.enviar');
    v_direcao := 'cliente';
  end if;

  if p_competencia is null then
    raise exception 'Informe a competência (mês de referência) do documento.';
  end if;
  v_competencia := app.competencia_de(p_competencia);
  if v_competencia < date '2000-01-01' or v_competencia > (app.competencia_de(app.hoje()) + interval '12 months')::date then
    raise exception 'Competência fora do intervalo permitido.';
  end if;

  v_ext := app.extensao_arquivo(p_nome_arquivo);
  if v_ext is null then
    raise exception 'O arquivo precisa ter uma extensão (ex.: .pdf, .xml, .ofx).';
  end if;
  if not (v_ext = any(v_cat.extensoes)) then
    raise exception 'Formato .% não é aceito para "%". Formatos aceitos: %.', v_ext, v_cat.nome, array_to_string(v_cat.extensoes, ', ');
  end if;

  select * into v_esc from public.escritorio where id = 1;
  if p_tamanho is null or p_tamanho <= 0 then
    raise exception 'Arquivo vazio.';
  end if;
  if p_tamanho > v_esc.upload_tamanho_maximo_mb::bigint * 1024 * 1024 then
    raise exception 'Arquivo maior que o limite de % MB.', v_esc.upload_tamanho_maximo_mb;
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Assinatura do arquivo (SHA-256) inválida.';
  end if;

  if p_checklist_item_id is not null then
    select id, empresa_id, competencia into v_item
      from public.checklist_itens where id = p_checklist_item_id;
    if not found or v_item.empresa_id <> p_empresa_id then
      raise exception 'Item do checklist não pertence a esta empresa.';
    end if;
  end if;

  -- Duplicidade: mesmo conteúdo (hash) já enviado para a empresa.
  select d.id, d.nome_original, d.competencia, d.enviado_em, d.status, d.categoria_codigo
    into v_dup
    from public.documentos d
   where d.empresa_id = p_empresa_id
     and d.excluido_em is null
     and d.upload_status = 'concluido'
     and (d.sha256 = p_sha256 or exists (
           select 1 from public.documento_versoes dv where dv.documento_id = d.id and dv.sha256 = p_sha256))
   order by d.enviado_em
   limit 1;
  v_tem_dup := found;
  if v_tem_dup and not coalesce(p_forcar_duplicado, false) then
    return jsonb_build_object(
      'situacao', 'duplicado',
      'duplicado', jsonb_build_object(
        'id', v_dup.id,
        'nome', v_dup.nome_original,
        'competencia', v_dup.competencia,
        'enviado_em', v_dup.enviado_em,
        'status', v_dup.status,
        'categoria', v_dup.categoria_codigo
      )
    );
  end if;

  v_path := p_empresa_id::text || '/' || to_char(v_competencia, 'YYYY-MM') || '/' || v_doc_id::text || '/v1-' || app.nome_seguro(p_nome_arquivo);

  insert into public.documentos (
    id, empresa_id, direcao, competencia, categoria_codigo, titulo, nome_original, extensao, mime, tamanho, sha256,
    versao_atual, storage_path, upload_status, status, observacao, checklist_item_id, origem,
    duplicado_de, vencimento, valor, enviado_por
  ) values (
    v_doc_id, p_empresa_id, v_direcao, v_competencia, p_categoria, nullif(trim(coalesce(p_titulo, '')), ''),
    left(p_nome_arquivo, 255), v_ext, left(p_mime, 150), p_tamanho, p_sha256,
    1, v_path, 'pendente',
    case when v_direcao = 'cliente' then 'recebido' else null end,
    nullif(trim(coalesce(p_observacao, '')), ''),
    p_checklist_item_id,
    case when v_direcao = 'escritorio' then 'escritorio'
         when p_origem in ('upload', 'camera') then p_origem else 'upload' end,
    case when v_tem_dup then v_dup.id else null end,
    p_vencimento,
    p_valor,
    auth.uid()
  );

  insert into public.documento_versoes (id, documento_id, empresa_id, versao, storage_path, nome_original, mime, tamanho, sha256, enviado_por)
  values (v_versao_id, v_doc_id, p_empresa_id, 1, v_path, left(p_nome_arquivo, 255), left(p_mime, 150), p_tamanho, p_sha256, auth.uid());

  return jsonb_build_object(
    'situacao', 'criado',
    'documento_id', v_doc_id,
    'versao_id', v_versao_id,
    'storage_path', v_path
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: confirmar recebimento do arquivo enviado
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_upload(p_versao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versao public.documento_versoes;
  v_doc public.documentos;
  v_obj record;
  v_tamanho bigint;
  v_mime text;
  v_fechada boolean;
begin
  select * into v_versao from public.documento_versoes where id = p_versao_id for update;
  if not found then
    raise exception 'Envio não encontrado.';
  end if;
  select * into v_doc from public.documentos where id = v_versao.documento_id for update;

  if v_doc.direcao = 'escritorio' then
    perform app.exigir(v_doc.empresa_id, 'documentos.publicar');
  else
    perform app.exigir(v_doc.empresa_id, 'documentos.enviar');
  end if;
  if v_versao.enviado_por is distinct from auth.uid() and not app.e_equipe_da_empresa(v_doc.empresa_id) then
    raise exception 'Somente quem iniciou o envio pode confirmá-lo.';
  end if;

  if v_versao.upload_concluido_em is not null then
    return jsonb_build_object('documento_id', v_doc.id, 'versao', v_versao.versao, 'ja_confirmado', true);
  end if;

  select o.metadata into v_obj
    from storage.objects o
   where o.bucket_id = 'documentos' and o.name = v_versao.storage_path;
  if not found then
    raise exception 'O arquivo não chegou ao armazenamento. Tente enviar novamente.';
  end if;
  v_tamanho := coalesce((v_obj.metadata ->> 'size')::bigint, v_versao.tamanho);
  v_mime := coalesce(v_obj.metadata ->> 'mimetype', v_versao.mime);

  update public.documento_versoes
     set upload_concluido_em = now(), tamanho = v_tamanho, mime = left(v_mime, 150)
   where id = v_versao.id;

  v_fechada := app.competencia_fechada(v_doc.empresa_id, v_doc.competencia);

  if v_versao.versao = 1 then
    update public.documentos
       set upload_status = 'concluido',
           enviado_em = now(),
           tamanho = v_tamanho,
           mime = left(v_mime, 150),
           publicado_em = case when direcao = 'escritorio' then now() else null end,
           recebido_apos_fechamento = (direcao = 'cliente' and v_fechada)
     where id = v_doc.id;
    insert into public.documento_historico (documento_id, empresa_id, acao, status_novo, detalhes)
    values (v_doc.id, v_doc.empresa_id,
            case when v_doc.direcao = 'escritorio' then 'publicado' else 'recebido' end,
            v_doc.status,
            jsonb_build_object('versao', 1, 'arquivo', v_versao.nome_original, 'tamanho', v_tamanho));
  else
    update public.documentos
       set versao_atual = v_versao.versao,
           storage_path = v_versao.storage_path,
           nome_original = v_versao.nome_original,
           extensao = app.extensao_arquivo(v_versao.nome_original),
           tamanho = v_tamanho,
           mime = left(v_mime, 150),
           sha256 = v_versao.sha256,
           status = case when direcao = 'cliente' then 'recebido' else null end,
           status_motivo = null,
           status_alterado_em = now(),
           status_alterado_por = auth.uid(),
           verificacao_status = 'pendente',
           processamento_status = 'pendente',
           recebido_apos_fechamento = recebido_apos_fechamento or (direcao = 'cliente' and v_fechada)
     where id = v_doc.id;
    insert into public.documento_historico (documento_id, empresa_id, acao, status_anterior, status_novo, motivo, detalhes)
    values (v_doc.id, v_doc.empresa_id, 'substituido', v_doc.status,
            case when v_doc.direcao = 'cliente' then 'recebido' else null end,
            v_versao.motivo,
            jsonb_build_object('versao', v_versao.versao, 'arquivo', v_versao.nome_original));
  end if;

  perform app.enfileirar(
    'processar_documento',
    jsonb_build_object('documento_id', v_doc.id, 'versao_id', v_versao.id),
    v_doc.empresa_id,
    'processar_documento:' || v_versao.id::text,
    now(),
    20
  );

  if v_doc.checklist_item_id is not null then
    perform app.recalcular_item_checklist(v_doc.checklist_item_id);
  end if;

  if v_doc.direcao = 'escritorio' then
    perform app.notificar_clientes(
      v_doc.empresa_id, 'documentos.ver', 'documento_escritorio',
      'Novo documento disponível: ' || coalesce(v_doc.titulo, v_doc.nome_original),
      'O escritório disponibilizou um documento para sua empresa.',
      '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
      true
    );
  elsif v_fechada then
    perform app.notificar_equipe(
      v_doc.empresa_id, 'documento_apos_fechamento',
      'Documento recebido após o fechamento',
      'O documento "' || v_versao.nome_original || '" chegou para a competência ' || to_char(v_doc.competencia, 'MM/YYYY') || ', que já está fechada. Avalie o impacto.',
      '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
      true
    );
  end if;

  return jsonb_build_object('documento_id', v_doc.id, 'versao', v_versao.versao, 'ja_confirmado', false,
                            'recebido_apos_fechamento', v_fechada);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: substituir arquivo (cria nova versão preservando a original)
-- -----------------------------------------------------------------------------
create or replace function public.substituir_documento(
  p_documento_id uuid,
  p_nome_arquivo text,
  p_mime text,
  p_tamanho bigint,
  p_sha256 text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_cat public.categorias_documento;
  v_esc public.escritorio;
  v_ext text;
  v_versao int;
  v_versao_id uuid := gen_random_uuid();
  v_path text;
  v_equipe boolean;
begin
  select * into v_doc from public.documentos where id = p_documento_id for update;
  if not found or v_doc.excluido_em is not null then
    raise exception 'Documento não encontrado.';
  end if;
  v_equipe := app.e_equipe_da_empresa(v_doc.empresa_id);
  if v_doc.direcao = 'escritorio' then
    perform app.exigir(v_doc.empresa_id, 'documentos.publicar');
  else
    perform app.exigir(v_doc.empresa_id, 'documentos.enviar');
    if not v_equipe and v_doc.status not in ('recebido', 'correcao') then
      raise exception 'Este documento já está em análise ou aprovado. Fale com o escritório para substituí-lo.';
    end if;
  end if;
  if v_doc.upload_status <> 'concluido' then
    raise exception 'O envio original ainda não foi concluído.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da substituição.';
  end if;

  select * into v_cat from public.categorias_documento where codigo = v_doc.categoria_codigo;
  v_ext := app.extensao_arquivo(p_nome_arquivo);
  if v_ext is null or not (v_ext = any(v_cat.extensoes)) then
    raise exception 'Formato não aceito para "%". Formatos aceitos: %.', v_cat.nome, array_to_string(v_cat.extensoes, ', ');
  end if;
  select * into v_esc from public.escritorio where id = 1;
  if p_tamanho is null or p_tamanho <= 0 or p_tamanho > v_esc.upload_tamanho_maximo_mb::bigint * 1024 * 1024 then
    raise exception 'Tamanho de arquivo inválido (limite de % MB).', v_esc.upload_tamanho_maximo_mb;
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Assinatura do arquivo (SHA-256) inválida.';
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao from public.documento_versoes where documento_id = v_doc.id;
  v_path := v_doc.empresa_id::text || '/' || to_char(v_doc.competencia, 'YYYY-MM') || '/' || v_doc.id::text || '/v' || v_versao || '-' || app.nome_seguro(p_nome_arquivo);

  insert into public.documento_versoes (id, documento_id, empresa_id, versao, storage_path, nome_original, mime, tamanho, sha256, motivo, enviado_por)
  values (v_versao_id, v_doc.id, v_doc.empresa_id, v_versao, v_path, left(p_nome_arquivo, 255), left(p_mime, 150), p_tamanho, p_sha256, left(p_motivo, 1000), auth.uid());

  return jsonb_build_object('documento_id', v_doc.id, 'versao_id', v_versao_id, 'versao', v_versao, 'storage_path', v_path);
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: conferência pelo escritório (status do documento)
-- A aprovação significa conferência interna; não representa validação fiscal.
-- -----------------------------------------------------------------------------
create or replace function public.alterar_status_documento(p_documento_id uuid, p_status text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_titulo text;
begin
  select * into v_doc from public.documentos where id = p_documento_id for update;
  if not found or v_doc.excluido_em is not null then
    raise exception 'Documento não encontrado.';
  end if;
  perform app.exigir(v_doc.empresa_id, 'documentos.revisar');
  if v_doc.direcao <> 'cliente' then
    raise exception 'Documentos do escritório não passam por conferência.';
  end if;
  if v_doc.upload_status <> 'concluido' then
    raise exception 'O arquivo ainda não foi recebido.';
  end if;
  if p_status not in ('recebido', 'em_analise', 'aprovado', 'correcao') then
    raise exception 'Status inválido.';
  end if;
  if p_status = 'correcao' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Explique ao cliente o motivo da correção.';
  end if;
  if p_status = v_doc.status and p_status <> 'correcao' then
    return;
  end if;

  update public.documentos
     set status = p_status,
         status_motivo = case when p_status = 'correcao' then trim(p_motivo) else nullif(trim(coalesce(p_motivo, '')), '') end,
         status_alterado_em = now(),
         status_alterado_por = auth.uid()
   where id = v_doc.id;

  insert into public.documento_historico (documento_id, empresa_id, acao, status_anterior, status_novo, motivo)
  values (v_doc.id, v_doc.empresa_id, 'status', v_doc.status, p_status, nullif(trim(coalesce(p_motivo, '')), ''));

  if v_doc.checklist_item_id is not null then
    perform app.recalcular_item_checklist(v_doc.checklist_item_id);
  end if;

  v_titulo := coalesce(v_doc.titulo, v_doc.nome_original);
  if p_status = 'correcao' then
    if v_doc.enviado_por is not null then
      perform app.notificar(
        v_doc.enviado_por, v_doc.empresa_id, 'documento_correcao',
        'Documento precisa de correção: ' || v_titulo,
        trim(p_motivo),
        '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
        true
      );
    end if;
    perform app.notificar_clientes(
      v_doc.empresa_id, 'documentos.enviar', 'documento_correcao',
      'Documento precisa de correção: ' || v_titulo,
      trim(p_motivo),
      '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
      false
    );
  elsif p_status = 'aprovado' and v_doc.enviado_por is not null then
    perform app.notificar(
      v_doc.enviado_por, v_doc.empresa_id, 'documento_aprovado',
      'Documento conferido: ' || v_titulo,
      'O escritório conferiu este documento. A conferência é interna e não representa validação fiscal junto aos órgãos públicos.',
      '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text,
      false
    );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: reclassificar (categoria, competência, item do checklist, observação)
-- -----------------------------------------------------------------------------
create or replace function public.atualizar_documento(
  p_documento_id uuid,
  p_categoria text,
  p_competencia date,
  p_observacao text default null,
  p_checklist_item_id uuid default null,
  p_titulo text default null,
  p_vencimento date default null,
  p_valor numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_cat public.categorias_documento;
  v_equipe boolean;
  v_comp date := app.competencia_de(p_competencia);
  v_item record;
begin
  select * into v_doc from public.documentos where id = p_documento_id for update;
  if not found or v_doc.excluido_em is not null then
    raise exception 'Documento não encontrado.';
  end if;
  v_equipe := app.e_equipe_da_empresa(v_doc.empresa_id);
  if v_doc.direcao = 'escritorio' then
    perform app.exigir(v_doc.empresa_id, 'documentos.publicar');
  elsif not v_equipe then
    perform app.exigir(v_doc.empresa_id, 'documentos.enviar');
    if v_doc.status not in ('recebido', 'correcao') then
      raise exception 'O documento já está em análise. Peça ao escritório para reclassificá-lo.';
    end if;
  end if;

  select * into v_cat from public.categorias_documento where codigo = p_categoria and ativo;
  if not found then
    raise exception 'Categoria inválida.';
  end if;
  if v_cat.escritorio <> (v_doc.direcao = 'escritorio') then
    raise exception 'Categoria incompatível com a origem do documento.';
  end if;
  if not (coalesce(v_doc.extensao, '') = any(v_cat.extensoes)) then
    raise exception 'O formato .% não é aceito na categoria "%".', v_doc.extensao, v_cat.nome;
  end if;
  if v_comp is null then
    raise exception 'Informe a competência.';
  end if;

  if p_checklist_item_id is not null then
    select id, empresa_id, competencia into v_item from public.checklist_itens where id = p_checklist_item_id;
    if not found or v_item.empresa_id <> v_doc.empresa_id then
      raise exception 'Item do checklist inválido.';
    end if;
  end if;

  update public.documentos
     set categoria_codigo = p_categoria,
         competencia = v_comp,
         observacao = case when v_equipe and v_doc.enviado_por is distinct from auth.uid() then observacao
                           else nullif(trim(coalesce(p_observacao, '')), '') end,
         checklist_item_id = p_checklist_item_id,
         titulo = nullif(trim(coalesce(p_titulo, '')), ''),
         vencimento = case when direcao = 'escritorio' then p_vencimento else vencimento end,
         valor = case when direcao = 'escritorio' then p_valor else valor end
   where id = v_doc.id;

  insert into public.documento_historico (documento_id, empresa_id, acao, detalhes)
  values (v_doc.id, v_doc.empresa_id, 'reclassificado', jsonb_build_object(
    'categoria_anterior', v_doc.categoria_codigo, 'categoria_nova', p_categoria,
    'competencia_anterior', v_doc.competencia, 'competencia_nova', v_comp,
    'item_anterior', v_doc.checklist_item_id, 'item_novo', p_checklist_item_id));

  if v_doc.checklist_item_id is not null then
    perform app.recalcular_item_checklist(v_doc.checklist_item_id);
  end if;
  if p_checklist_item_id is not null and p_checklist_item_id is distinct from v_doc.checklist_item_id then
    perform app.recalcular_item_checklist(p_checklist_item_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: excluir (exclusão lógica — o arquivo é preservado conforme retenção)
-- -----------------------------------------------------------------------------
create or replace function public.excluir_documento(p_documento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_equipe boolean;
begin
  select * into v_doc from public.documentos where id = p_documento_id for update;
  if not found or v_doc.excluido_em is not null then
    raise exception 'Documento não encontrado.';
  end if;
  v_equipe := app.e_equipe_da_empresa(v_doc.empresa_id);
  if v_doc.direcao = 'escritorio' then
    perform app.exigir(v_doc.empresa_id, 'documentos.publicar');
  elsif not v_equipe then
    perform app.exigir(v_doc.empresa_id, 'documentos.enviar');
    if v_doc.status <> 'recebido' and v_doc.upload_status = 'concluido' then
      raise exception 'Somente documentos ainda não conferidos podem ser excluídos pelo cliente.';
    end if;
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusão.';
  end if;

  update public.documentos
     set excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = trim(p_motivo)
   where id = v_doc.id;
  -- Documentos extraídos de um ZIP acompanham a exclusão do ZIP.
  update public.documentos
     set excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = 'ZIP de origem excluído: ' || trim(p_motivo)
   where zip_origem_id = v_doc.id and excluido_em is null;

  insert into public.documento_historico (documento_id, empresa_id, acao, status_anterior, motivo)
  values (v_doc.id, v_doc.empresa_id, 'excluido', v_doc.status, trim(p_motivo));

  if v_doc.checklist_item_id is not null then
    perform app.recalcular_item_checklist(v_doc.checklist_item_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: registrar acesso e devolver o caminho do arquivo (para link temporário)
-- -----------------------------------------------------------------------------
create or replace function public.registrar_acesso_documento(
  p_documento_id uuid,
  p_tipo text,
  p_versao int default null,
  p_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_versao public.documento_versoes;
begin
  if p_tipo not in ('visualizacao', 'download', 'download_lote') then
    raise exception 'Tipo de acesso inválido.';
  end if;
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  perform app.exigir(v_doc.empresa_id, 'documentos.baixar');
  if not app.e_equipe_da_empresa(v_doc.empresa_id) then
    if v_doc.excluido_em is not null or (v_doc.direcao = 'escritorio' and v_doc.publicado_em is null) then
      raise exception 'Documento indisponível.';
    end if;
  end if;

  select * into v_versao
    from public.documento_versoes
   where documento_id = v_doc.id and versao = coalesce(p_versao, v_doc.versao_atual);
  if not found or v_versao.upload_concluido_em is null then
    raise exception 'Versão do documento indisponível.';
  end if;
  if v_versao.verificacao_status = 'bloqueado' and not app.e_equipe_da_empresa(v_doc.empresa_id) then
    raise exception 'Este arquivo foi bloqueado pela verificação de segurança.';
  end if;

  insert into public.documento_acessos (documento_id, empresa_id, user_id, tipo, versao, ip, user_agent)
  values (v_doc.id, v_doc.empresa_id, auth.uid(), p_tipo, v_versao.versao, left(p_ip, 100), left(p_user_agent, 500));

  return jsonb_build_object(
    'storage_path', v_versao.storage_path,
    'nome', v_versao.nome_original,
    'mime', v_versao.mime,
    'versao', v_versao.versao
  );
end;
$$;

-- Avaliação de documento que chegou após o fechamento.
create or replace function public.avaliar_documento_apos_fechamento(p_documento_id uuid, p_parecer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
begin
  select * into v_doc from public.documentos where id = p_documento_id for update;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  perform app.exigir(v_doc.empresa_id, 'fechamento.gerenciar');
  if coalesce(trim(p_parecer), '') = '' then
    raise exception 'Registre o parecer da avaliação.';
  end if;
  update public.documentos
     set apos_fechamento_avaliado_em = now(),
         apos_fechamento_avaliado_por = auth.uid(),
         apos_fechamento_parecer = trim(p_parecer)
   where id = v_doc.id;
  insert into public.documento_historico (documento_id, empresa_id, acao, motivo)
  values (v_doc.id, v_doc.empresa_id, 'avaliado_apos_fechamento', trim(p_parecer));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.categorias_documento enable row level security;
alter table public.documentos enable row level security;
alter table public.documento_versoes enable row level security;
alter table public.documento_historico enable row level security;
alter table public.documento_acessos enable row level security;

create policy categorias_documento_leitura on public.categorias_documento for select to authenticated
  using ((select app.usuario_valido()));
create policy categorias_documento_admin on public.categorias_documento for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Documentos: escrita somente via funções RPC (que validam permissões e regras).
create policy documentos_leitura on public.documentos for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[])
    and (
      empresa_id = any ((select app.empresas_com('documentos.revisar'))::uuid[])
      or empresa_id = any ((select app.empresas_com('documentos.publicar'))::uuid[])
      or (excluido_em is null and (direcao = 'cliente' or publicado_em is not null))
    )
  );

create policy documento_versoes_leitura on public.documento_versoes for select to authenticated
  using (exists (select 1 from public.documentos d where d.id = documento_versoes.documento_id));

create policy documento_historico_leitura on public.documento_historico for select to authenticated
  using (exists (select 1 from public.documentos d where d.id = documento_historico.documento_id));

create policy documento_acessos_leitura on public.documento_acessos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('documentos.ver'))::uuid[]));

-- -----------------------------------------------------------------------------
-- Armazenamento (Supabase Storage)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 524288000)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152, array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do nothing;

-- Leitura de documentos: somente com permissão de download e visibilidade do documento.
-- Inserção: feita por URL de envio assinada gerada pelo servidor após validação.
create policy documentos_storage_leitura on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and app.pode_baixar_objeto(name));

-- Logomarca: escrita apenas por administradores (leitura é pública pelo bucket).
create policy marca_storage_insercao on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and (select app.is_admin()));
create policy marca_storage_alteracao on storage.objects for update to authenticated
  using (bucket_id = 'marca' and (select app.is_admin()))
  with check (bucket_id = 'marca' and (select app.is_admin()));
create policy marca_storage_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'marca' and (select app.is_admin()));
