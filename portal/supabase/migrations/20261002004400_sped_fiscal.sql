-- =============================================================================
-- SPED Fiscal (EFD ICMS/IPI): leitura do arquivo e cruzamento com os XML
--
--  * O arquivo (.txt) entra como documento da categoria "Arquivos do SPED".
--    O processador lê o registro 0000 (período, CNPJ, perfil), as notas do
--    registro C100 (com os CFOP do C190) e a apuração do ICMS (E110), conforme
--    o Guia Prático da EFD ICMS/IPI 3.2.2.
--  * O cruzamento compara as notas escrituradas com os XML que o portal já tem
--    (enviados pelo cliente ou trazidos pelas notas automáticas): nota emitida
--    não escriturada, nota recebida não escriturada, nota cancelada escriturada
--    como regular, valor ou ICMS/IPI diferente do XML, crédito de ICMS não
--    aproveitado na compra para revenda/industrialização, nota em duplicidade
--    e nota escriturada sem XML no portal.
--  * A EFD-Contribuições é reconhecida e guardada, mas ainda não é lida.
--  * Uso interno da equipe (permissão "Conduzir o auditor"). Nada é enviado
--    a órgãos públicos: o portal não transmite nem altera a EFD.
-- =============================================================================

insert into public.categorias_documento (codigo, nome, descricao, grupo, extensoes, escritorio, ordem) values
  ('sped_fiscal', 'Arquivos do SPED (EFD ICMS/IPI e EFD-Contribuições)',
   'Arquivo .txt da EFD gerado pelo sistema fiscal. O escritório confere as notas escrituradas com os XML recebidos.',
   'fiscal', array['txt'], false, 35)
on conflict (codigo) do nothing;

-- -----------------------------------------------------------------------------
-- 1. Tabelas
-- -----------------------------------------------------------------------------
create table public.sped_arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento_id uuid references public.documentos(id) on delete set null,
  versao int,
  nome_arquivo text,
  tipo text not null check (tipo in ('efd_icms_ipi', 'efd_contribuicoes')),
  versao_leiaute text,
  finalidade text check (finalidade is null or finalidade in ('original', 'substituto')),
  periodo_inicio date not null,
  periodo_fim date not null check (periodo_fim >= periodo_inicio),
  cnpj text,
  nome text,
  uf text,
  ie text,
  perfil text,
  situacao text not null default 'processando' check (situacao in ('processando', 'conferido', 'nao_suportado', 'erro')),
  -- O mais recente do mesmo período e tipo é o que vale
  vigente boolean not null default true,
  totais jsonb,
  resumo jsonb,
  avisos jsonb,
  erro text check (erro is null or length(erro) <= 1000),
  created_at timestamptz not null default now(),
  conferido_em timestamptz,
  unique (documento_id, versao)
);
create index sped_arquivos_empresa_idx on public.sped_arquivos (empresa_id, periodo_inicio desc, created_at desc);

create table public.sped_documentos (
  id bigint generated always as identity primary key,
  arquivo_id uuid not null references public.sped_arquivos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  linha int,
  ind_oper text not null check (ind_oper in ('0', '1')),
  ind_emit text not null check (ind_emit in ('0', '1')),
  cod_mod text not null,
  cod_sit text not null,
  serie text,
  numero text,
  chave text check (chave is null or chave ~ '^[0-9]{44}$'),
  participante_nome text,
  participante_documento text,
  dt_doc date,
  dt_e_s date,
  vl_doc numeric(15, 2),
  vl_icms numeric(15, 2),
  vl_icms_st numeric(15, 2),
  vl_ipi numeric(15, 2),
  cfops text[] not null default array[]::text[]
);
create index sped_documentos_arquivo_idx on public.sped_documentos (arquivo_id);
create index sped_documentos_chave_idx on public.sped_documentos (empresa_id, chave) where chave is not null;

create table public.sped_divergencias (
  id bigint generated always as identity primary key,
  arquivo_id uuid not null references public.sped_arquivos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  regra text not null,
  gravidade text not null check (gravidade in ('alta', 'media', 'baixa')),
  chave text,
  modelo text,
  serie text,
  numero text,
  data date,
  operacao text check (operacao is null or operacao in ('entrada', 'saida')),
  participante text,
  valor_sped numeric(15, 2),
  valor_xml numeric(15, 2),
  diferenca numeric(15, 2),
  documento_fiscal_id uuid references public.documentos_fiscais(id) on delete set null,
  detalhe text
);
create index sped_divergencias_arquivo_idx on public.sped_divergencias (arquivo_id, gravidade, regra);

alter table public.sped_arquivos enable row level security;
alter table public.sped_documentos enable row level security;
alter table public.sped_divergencias enable row level security;
create policy sped_arquivos_leitura on public.sped_arquivos for select to authenticated
  using ((select app.pode(empresa_id, 'auditor.gerenciar')));
create policy sped_documentos_leitura on public.sped_documentos for select to authenticated
  using ((select app.pode(empresa_id, 'auditor.gerenciar')));
create policy sped_divergencias_leitura on public.sped_divergencias for select to authenticated
  using ((select app.pode(empresa_id, 'auditor.gerenciar')));
grant select on public.sped_arquivos, public.sped_documentos, public.sped_divergencias to authenticated;
grant select, insert, update, delete on public.sped_arquivos, public.sped_documentos, public.sped_divergencias to service_role;

-- -----------------------------------------------------------------------------
-- 2. Registro do arquivo e das notas (processador)
-- -----------------------------------------------------------------------------
create or replace function public.sped_registrar_arquivo(
  p_documento_id uuid, p_versao int, p_nome text, p_cabecalho jsonb, p_situacao text, p_erro text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_id uuid;
begin
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  if p_situacao not in ('processando', 'nao_suportado', 'erro') then
    raise exception 'Situação inválida.';
  end if;
  insert into public.sped_arquivos (empresa_id, documento_id, versao, nome_arquivo, tipo, versao_leiaute, finalidade, periodo_inicio, periodo_fim,
                                    cnpj, nome, uf, ie, perfil, situacao, erro)
  values (v_doc.empresa_id, v_doc.id, p_versao, left(p_nome, 300), p_cabecalho ->> 'tipo', left(p_cabecalho ->> 'versao_leiaute', 10),
          p_cabecalho ->> 'finalidade', (p_cabecalho ->> 'inicio')::date, (p_cabecalho ->> 'fim')::date,
          nullif(regexp_replace(coalesce(p_cabecalho ->> 'cnpj', p_cabecalho ->> 'cpf', ''), '\D', '', 'g'), ''),
          left(p_cabecalho ->> 'nome', 200), left(p_cabecalho ->> 'uf', 2), left(p_cabecalho ->> 'ie', 20), left(p_cabecalho ->> 'perfil', 1),
          p_situacao, left(p_erro, 1000))
  on conflict (documento_id, versao) do update
     set nome_arquivo = excluded.nome_arquivo, tipo = excluded.tipo, versao_leiaute = excluded.versao_leiaute, finalidade = excluded.finalidade,
         periodo_inicio = excluded.periodo_inicio, periodo_fim = excluded.periodo_fim, cnpj = excluded.cnpj, nome = excluded.nome,
         uf = excluded.uf, ie = excluded.ie, perfil = excluded.perfil, situacao = excluded.situacao, erro = excluded.erro,
         totais = null, resumo = null, conferido_em = null
  returning id into v_id;
  -- Releitura: começa do zero
  delete from public.sped_documentos where arquivo_id = v_id;
  delete from public.sped_divergencias where arquivo_id = v_id;
  return v_id;
end;
$$;

create or replace function public.sped_gravar_documentos(p_arquivo_id uuid, p_documentos jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.sped_arquivos;
  v_n int;
begin
  select * into v from public.sped_arquivos where id = p_arquivo_id;
  if not found then
    raise exception 'Arquivo do SPED não encontrado.';
  end if;
  insert into public.sped_documentos (arquivo_id, empresa_id, linha, ind_oper, ind_emit, cod_mod, cod_sit, serie, numero, chave,
                                      participante_nome, participante_documento, dt_doc, dt_e_s, vl_doc, vl_icms, vl_icms_st, vl_ipi, cfops)
  select v.id, v.empresa_id, d.linha, d.ind_oper, d.ind_emit, left(d.cod_mod, 4), left(d.cod_sit, 2), left(d.serie, 5), left(d.numero, 12),
         case when d.chave ~ '^[0-9]{44}$' then d.chave end, left(d.participante_nome, 200), left(d.participante_documento, 14),
         d.dt_doc, d.dt_e_s, d.vl_doc, d.vl_icms, d.vl_icms_st, d.vl_ipi, coalesce(d.cfops, array[]::text[])
    from jsonb_to_recordset(coalesce(p_documentos, '[]'::jsonb)) as d(
           linha int, ind_oper text, ind_emit text, cod_mod text, cod_sit text, serie text, numero text, chave text,
           participante_nome text, participante_documento text, dt_doc date, dt_e_s date, vl_doc numeric, vl_icms numeric,
           vl_icms_st numeric, vl_ipi numeric, cfops text[]);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Cruzamento SPED × XML
-- -----------------------------------------------------------------------------
create or replace function app.sped_conferir(p_arquivo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.sped_arquivos;
  v_resumo jsonb;
begin
  select * into v from public.sped_arquivos where id = p_arquivo_id;
  if not found or v.tipo <> 'efd_icms_ipi' then
    return null;
  end if;
  delete from public.sped_divergencias where arquivo_id = v.id;

  -- XML da empresa (notas fiscais eletrônicas guardadas no portal)
  create temporary table if not exists pg_temp.sped_xml (
    id uuid, chave text, modelo text, numero text, serie text, data date, operacao text, propria boolean, recebida boolean,
    cancelada boolean, valor numeric, icms numeric, icms_st numeric, ipi numeric, participante text
  ) on commit drop;
  truncate pg_temp.sped_xml;
  insert into pg_temp.sped_xml
  select f.id, f.chave_acesso, f.modelo, f.numero, f.serie, (f.data_emissao at time zone 'America/Sao_Paulo')::date, f.operacao,
         f.emitente_documento = v.cnpj,
         f.destinatario_documento = v.cnpj and f.emitente_documento is distinct from v.cnpj,
         f.cancelada_evento, f.valor_total,
         coalesce((f.tributos ->> 'icms')::numeric, 0), coalesce((f.tributos ->> 'icms_st')::numeric, 0), coalesce((f.tributos ->> 'ipi')::numeric, 0),
         case when f.emitente_documento = v.cnpj then f.destinatario_nome else f.emitente_nome end
    from public.documentos_fiscais f
    join public.documentos d on d.id = f.documento_id and d.excluido_em is null
   where f.empresa_id = v.empresa_id and f.modelo in ('55', '65') and f.chave_acesso is not null
     and f.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo';

  -- Nota em duplicidade no arquivo
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, detalhe)
  select v.id, v.empresa_id, 'duplicada', 'alta', s.chave, min(s.cod_mod), min(s.serie), min(s.numero), min(s.dt_doc),
         case when min(s.ind_oper) = '1' then 'saida' else 'entrada' end, min(s.participante_nome), sum(s.vl_doc),
         'A mesma chave aparece ' || count(*) || ' vezes no arquivo (linhas ' || string_agg(s.linha::text, ', ' order by s.linha) || ').'
    from public.sped_documentos s
   where s.arquivo_id = v.id and s.chave is not null
   group by s.chave having count(*) > 1;

  -- Escriturada sem XML no portal
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, detalhe)
  select v.id, v.empresa_id, 'sem_xml', 'baixa', s.chave, s.cod_mod, s.serie, s.numero, s.dt_doc,
         case when s.ind_oper = '1' then 'saida' else 'entrada' end, s.participante_nome, s.vl_doc,
         'O XML desta nota não está no portal. Peça ao cliente (ou ative as notas automáticas) para completar a conferência.'
    from public.sped_documentos s
   where s.arquivo_id = v.id and s.chave is not null and s.cod_mod in ('55', '65') and s.cod_sit not in ('04', '05')
     and not exists (select 1 from pg_temp.sped_xml x where x.chave = s.chave);

  -- Nota emitida no período e não escriturada
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_xml, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id, 'nao_escriturada_saida', 'alta', x.chave, x.modelo, x.serie, x.numero, x.data, x.operacao, x.participante, x.valor, x.id,
         'Nota emitida pela empresa no período e que não está no arquivo.'
    from pg_temp.sped_xml x
   where x.propria and not x.cancelada and x.data between v.periodo_inicio and v.periodo_fim
     and not exists (select 1 from public.sped_documentos s where s.arquivo_id = v.id and s.chave = x.chave);

  -- Nota emitida e cancelada que não foi informada (a EFD pede a nota cancelada com a chave)
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_xml, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id, 'cancelada_nao_informada', 'baixa', x.chave, x.modelo, x.serie, x.numero, x.data, x.operacao, x.participante, x.valor, x.id,
         'Nota própria cancelada no período: deve constar no C100 com a situação 02 (cancelada).'
    from pg_temp.sped_xml x
   where x.propria and x.cancelada and x.data between v.periodo_inicio and v.periodo_fim
     and not exists (select 1 from public.sped_documentos s where s.arquivo_id = v.id and s.chave = x.chave);

  -- Nota recebida no período que não está em nenhum SPED vigente da empresa
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_xml, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id, 'nao_escriturada_entrada', 'media', x.chave, x.modelo, x.serie, x.numero, x.data, 'entrada', x.participante, x.valor, x.id,
         'Nota recebida no período e que não está neste arquivo nem nos outros SPED da empresa no portal. Se a mercadoria chegou no mês seguinte, ela entra no SPED daquele mês.'
    from pg_temp.sped_xml x
   where x.recebida and x.modelo = '55' and not x.cancelada and x.data between v.periodo_inicio and v.periodo_fim
     and not exists (
       select 1 from public.sped_documentos s join public.sped_arquivos a on a.id = s.arquivo_id
        where s.empresa_id = v.empresa_id and s.chave = x.chave and (a.vigente or a.id = v.id));

  -- Situação diferente entre o SPED e o XML
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, valor_xml, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id,
         case when x.cancelada then 'cancelada_escriturada' else 'cancelada_no_sped' end,
         case when x.cancelada then 'alta' else 'media' end,
         s.chave, s.cod_mod, s.serie, s.numero, coalesce(s.dt_doc, x.data), case when s.ind_oper = '1' then 'saida' else 'entrada' end,
         coalesce(s.participante_nome, x.participante), s.vl_doc, x.valor, x.id,
         case when x.cancelada then 'O XML tem o evento de cancelamento, mas a nota foi escriturada como regular (situação ' || s.cod_sit || ').'
              else 'A nota foi escriturada como cancelada, mas o portal não tem o evento de cancelamento. Se foi cancelada mesmo, envie o XML do evento.' end
    from public.sped_documentos s
    join pg_temp.sped_xml x on x.chave = s.chave
   where s.arquivo_id = v.id
     and ((x.cancelada and s.cod_sit in ('00', '01', '06', '07', '08')) or (not x.cancelada and s.cod_sit in ('02', '03')));

  -- Valor total da nota diferente do XML
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, valor_xml, diferenca, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id, 'valor_divergente', 'alta', s.chave, s.cod_mod, s.serie, s.numero, s.dt_doc,
         case when s.ind_oper = '1' then 'saida' else 'entrada' end, coalesce(s.participante_nome, x.participante), s.vl_doc, x.valor, s.vl_doc - x.valor, x.id,
         'Valor total escriturado (VL_DOC) diferente do total do XML.'
    from public.sped_documentos s
    join pg_temp.sped_xml x on x.chave = s.chave
   where s.arquivo_id = v.id and s.cod_sit in ('00', '01', '08') and not x.cancelada
     and abs(coalesce(s.vl_doc, 0) - coalesce(x.valor, 0)) > 0.01;

  -- ICMS, ICMS-ST e IPI das notas emitidas diferentes do destacado no XML
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, valor_xml, diferenca, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id, t.regra, 'alta', s.chave, s.cod_mod, s.serie, s.numero, s.dt_doc, 'saida', coalesce(s.participante_nome, x.participante),
         t.sped, t.xml, t.sped - t.xml, x.id, t.detalhe
    from public.sped_documentos s
    join pg_temp.sped_xml x on x.chave = s.chave
    cross join lateral (values
      ('icms_divergente', coalesce(s.vl_icms, 0), x.icms, 'ICMS escriturado diferente do destacado no XML.'),
      ('icms_st_divergente', coalesce(s.vl_icms_st, 0), x.icms_st, 'ICMS-ST escriturado diferente do destacado no XML.'),
      ('ipi_divergente', coalesce(s.vl_ipi, 0), x.ipi, 'IPI escriturado diferente do destacado no XML.')
    ) as t(regra, sped, xml, detalhe)
   where s.arquivo_id = v.id and s.ind_emit = '0' and s.ind_oper = '1' and s.cod_sit in ('00', '01', '08') and not x.cancelada
     -- Na NFC-e não se informam ICMS-ST e IPI no C100
     and (s.cod_mod <> '65' or t.regra = 'icms_divergente')
     and abs(t.sped - t.xml) > 0.01;

  -- Compra para revenda ou industrialização com ICMS destacado e sem crédito escriturado
  insert into public.sped_divergencias (arquivo_id, empresa_id, regra, gravidade, chave, modelo, serie, numero, data, operacao, participante, valor_sped, valor_xml, diferenca, documento_fiscal_id, detalhe)
  select v.id, v.empresa_id, 'credito_nao_aproveitado', 'media', s.chave, s.cod_mod, s.serie, s.numero, coalesce(s.dt_e_s, s.dt_doc), 'entrada',
         coalesce(s.participante_nome, x.participante), coalesce(s.vl_icms, 0), x.icms, x.icms - coalesce(s.vl_icms, 0), x.id,
         'Compra para revenda ou industrialização (CFOP ' || array_to_string(s.cfops, ', ') || ') com ICMS destacado no XML e sem crédito escriturado. Confira se a empresa tem direito ao crédito.'
    from public.sped_documentos s
    join pg_temp.sped_xml x on x.chave = s.chave
   where s.arquivo_id = v.id and s.ind_oper = '0' and s.ind_emit = '1' and s.cod_sit in ('00', '01', '08') and not x.cancelada
     and coalesce(s.vl_icms, 0) = 0 and x.icms > 0
     and s.cfops && array['1101', '1102', '2101', '2102'];

  -- Resumo
  select jsonb_build_object(
           'documentos', (select count(*) from public.sped_documentos where arquivo_id = v.id),
           'saidas', (select count(*) from public.sped_documentos where arquivo_id = v.id and ind_oper = '1'),
           'entradas', (select count(*) from public.sped_documentos where arquivo_id = v.id and ind_oper = '0'),
           'canceladas', (select count(*) from public.sped_documentos where arquivo_id = v.id and cod_sit in ('02', '03', '04', '05')),
           'valor_saidas', (select coalesce(sum(vl_doc), 0) from public.sped_documentos where arquivo_id = v.id and ind_oper = '1' and cod_sit not in ('02', '03', '04', '05')),
           'valor_entradas', (select coalesce(sum(vl_doc), 0) from public.sped_documentos where arquivo_id = v.id and ind_oper = '0' and cod_sit not in ('02', '03', '04', '05')),
           'com_xml', (select count(*) from public.sped_documentos s where s.arquivo_id = v.id and exists (select 1 from pg_temp.sped_xml x where x.chave = s.chave)),
           'xml_emitidas', (select count(*) from pg_temp.sped_xml x where x.propria and x.data between v.periodo_inicio and v.periodo_fim),
           'xml_recebidas', (select count(*) from pg_temp.sped_xml x where x.recebida and x.data between v.periodo_inicio and v.periodo_fim),
           'alta', (select count(*) from public.sped_divergencias where arquivo_id = v.id and gravidade = 'alta'),
           'media', (select count(*) from public.sped_divergencias where arquivo_id = v.id and gravidade = 'media'),
           'baixa', (select count(*) from public.sped_divergencias where arquivo_id = v.id and gravidade = 'baixa'),
           'regras', coalesce((select jsonb_object_agg(regra, n) from (
               select regra, count(*) as n from public.sped_divergencias where arquivo_id = v.id group by regra) r), '{}'::jsonb))
    into v_resumo;
  update public.sped_arquivos set resumo = v_resumo, conferido_em = now(), situacao = 'conferido' where id = v.id;
  drop table if exists pg_temp.sped_xml;
  return v_resumo;
end;
$$;

-- Conclusão da leitura (processador): totais, arquivo vigente do período, cruzamento e aviso à equipe
create or replace function public.sped_concluir(p_arquivo_id uuid, p_totais jsonb, p_avisos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.sped_arquivos;
  v_resumo jsonb;
  v_pontos int;
begin
  select * into v from public.sped_arquivos where id = p_arquivo_id for update;
  if not found then
    raise exception 'Arquivo do SPED não encontrado.';
  end if;
  update public.sped_arquivos set totais = p_totais, avisos = p_avisos where id = v.id;
  -- O arquivo mais recente do período passa a valer (substituto ou reenvio)
  update public.sped_arquivos set vigente = (id = v.id)
   where empresa_id = v.empresa_id and tipo = v.tipo and periodo_inicio = v.periodo_inicio and periodo_fim = v.periodo_fim;
  v_resumo := app.sped_conferir(v.id);
  v_pontos := coalesce((v_resumo ->> 'alta')::int, 0) + coalesce((v_resumo ->> 'media')::int, 0);
  perform app.notificar_equipe(v.empresa_id, 'sped_conferido',
    'SPED Fiscal ' || to_char(v.periodo_inicio, 'MM/YYYY') || ' conferido',
    case when v_pontos > 0 then v_pontos || case when v_pontos = 1 then ' ponto para conferir' else ' pontos para conferir' end || ' entre o SPED e os XML.'
         else 'As notas escrituradas batem com os XML do portal.' end,
    '/e/' || v.empresa_id::text || '/auditor-fiscal/sped?arquivo=' || v.id::text, false);
  perform app.registrar_auditoria('sped_conferido', 'sped_arquivos', v.id::text, v.empresa_id,
    jsonb_build_object('arquivo', v.nome_arquivo, 'periodo', to_char(v.periodo_inicio, 'MM/YYYY'), 'resumo', v_resumo));
  return v_resumo;
end;
$$;

-- Conferir de novo (equipe), por exemplo depois que chegaram os XML que faltavam
create or replace function public.sped_conferir_de_novo(p_arquivo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.sped_arquivos;
begin
  select * into v from public.sped_arquivos where id = p_arquivo_id;
  if not found then
    raise exception 'Arquivo do SPED não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'auditor.gerenciar');
  if v.situacao not in ('conferido') then
    raise exception 'Este arquivo ainda não foi lido.';
  end if;
  return app.sped_conferir(v.id);
end;
$$;

-- Tirar um arquivo da conferência (equipe); o documento continua em Documentos
create or replace function public.sped_excluir_arquivo(p_arquivo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.sped_arquivos;
begin
  select * into v from public.sped_arquivos where id = p_arquivo_id;
  if not found then
    raise exception 'Arquivo do SPED não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'auditor.gerenciar');
  delete from public.sped_arquivos where id = v.id;
  -- O anterior do mesmo período volta a valer
  update public.sped_arquivos set vigente = true
   where id = (select id from public.sped_arquivos
                where empresa_id = v.empresa_id and tipo = v.tipo and periodo_inicio = v.periodo_inicio and periodo_fim = v.periodo_fim
                order by created_at desc limit 1);
  perform app.registrar_auditoria('sped_excluido', 'sped_arquivos', v.id::text, v.empresa_id,
    jsonb_build_object('arquivo', v.nome_arquivo, 'periodo', to_char(v.periodo_inicio, 'MM/YYYY')));
end;
$$;

-- Carteira: último SPED de cada empresa
create or replace function public.sped_carteira()
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
    select jsonb_agg(jsonb_build_object(
             'empresa_id', e.id, 'empresa', coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social), 'documento', e.documento,
             'arquivo_id', a.id, 'tipo', a.tipo, 'periodo_inicio', a.periodo_inicio, 'situacao', a.situacao, 'conferido_em', a.conferido_em,
             'alta', coalesce((a.resumo ->> 'alta')::int, 0), 'media', coalesce((a.resumo ->> 'media')::int, 0),
             'baixa', coalesce((a.resumo ->> 'baixa')::int, 0))
           order by coalesce((a.resumo ->> 'alta')::int, 0) desc, a.periodo_inicio desc, e.razao_social)
      from public.empresas e
      join lateral (
        select * from public.sped_arquivos s
         where s.empresa_id = e.id and s.vigente
         order by s.periodo_inicio desc, s.created_at desc
         limit 1
      ) a on true
     where e.id = any (app.empresas_com('auditor.gerenciar'))
  ), '[]'::jsonb);
end;
$$;

revoke execute on function app.sped_conferir(uuid) from public, anon, authenticated;
revoke execute on function public.sped_registrar_arquivo(uuid, int, text, jsonb, text, text), public.sped_gravar_documentos(uuid, jsonb),
  public.sped_concluir(uuid, jsonb, jsonb), public.sped_conferir_de_novo(uuid), public.sped_excluir_arquivo(uuid), public.sped_carteira()
  from public, anon, authenticated;
grant execute on function public.sped_conferir_de_novo(uuid), public.sped_excluir_arquivo(uuid), public.sped_carteira() to authenticated;
grant execute on function public.sped_registrar_arquivo(uuid, int, text, jsonb, text, text), public.sped_gravar_documentos(uuid, jsonb),
  public.sped_concluir(uuid, jsonb, jsonb) to service_role;
