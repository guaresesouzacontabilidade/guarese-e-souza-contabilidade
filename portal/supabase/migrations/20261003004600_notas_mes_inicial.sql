-- =============================================================================
-- Notas automáticas organizadas por mês: mês inicial da busca
--
-- A SEFAZ e o Ambiente Nacional da NFS-e entregam as notas numa fila (NSU), da
-- mais antiga para a mais nova; não existe consulta "por mês". Na primeira
-- busca vinha todo o histórico disponível de uma vez (anos de NFS-e). Agora:
--  * cada empresa tem um mês inicial (buscar_desde): notas emitidas antes dele
--    são ignoradas na busca — nada é guardado, só o NSU fica marcado como
--    ignorado (com o mês da nota);
--  * empresas novas começam no mês anterior ao cadastro do certificado (o mês
--    que o escritório vai fechar); no cadastro dá para escolher outro mês;
--  * recuar o mês inicial busca de novo as NFS-e ignoradas dos meses incluídos.
--    As NF-e não voltam: a SEFAZ entrega cada documento uma vez e recusa quem
--    volta a um NSU já consultado (rejeição 656, consumo indevido);
--  * o administrador pode apagar do portal as notas automáticas anteriores ao
--    mês inicial, com o que veio delas (notas lidas, eventos, resumos,
--    lançamentos sugeridos e achados do auditor não publicados), com motivo e
--    registro na auditoria. Os arquivos saem do armazenamento pela fila.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colunas
-- -----------------------------------------------------------------------------
alter table public.notas_automaticas
  add column buscar_desde date check (buscar_desde is null or extract(day from buscar_desde) = 1);
comment on column public.notas_automaticas.buscar_desde is
  'Primeiro mês (de emissão) trazido pela busca; notas anteriores são ignoradas. Nulo: tudo o que os serviços ainda disponibilizam.';
-- As empresas que já tinham a busca continuam sem limite até alguém escolher o mês;
-- as novas começam no mês anterior ao cadastro.
alter table public.notas_automaticas alter column buscar_desde
  set default (date_trunc('month', (now() at time zone 'America/Araguaina')::date) - interval '1 month')::date;

alter table public.notas_automaticas_nsu
  add column ignorado boolean not null default false,
  add column competencia date check (competencia is null or extract(day from competencia) = 1);
comment on column public.notas_automaticas_nsu.ignorado is
  'Documento anterior ao mês inicial (não importado) ou apagado do portal; a NFS-e volta a ser buscada se o mês inicial recuar.';
create index notas_nsu_ignorados_idx on public.notas_automaticas_nsu (empresa_id, servico) where ignorado;

alter table public.notas_automaticas_execucoes
  add column ignorados int not null default 0 check (ignorados >= 0);

-- -----------------------------------------------------------------------------
-- Mês inicial
-- -----------------------------------------------------------------------------
create or replace function app.validar_mes_inicial(p_desde date)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_desde is null then
    return;
  end if;
  if extract(day from p_desde) <> 1 then
    raise exception 'Mês inicial inválido.';
  end if;
  if p_desde < date '2015-01-01' then
    raise exception 'Mês inicial muito antigo.';
  end if;
  if p_desde > date_trunc('month', (now() at time zone 'America/Araguaina')::date)::date then
    raise exception 'O mês inicial não pode ser depois do mês atual.';
  end if;
end;
$$;

-- Grava o mês inicial; se recuou, libera as NFS-e ignoradas dos meses incluídos
-- (a busca da NFS-e volta ao primeiro NSU liberado). Uso interno.
create or replace function app.aplicar_mes_inicial(p_empresa_id uuid, p_desde date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes public.notas_automaticas;
  v_min numeric;
  v_nfse int := 0;
  v_nfe int := 0;
begin
  perform app.validar_mes_inicial(p_desde);
  select * into v_antes from public.notas_automaticas where empresa_id = p_empresa_id for update;
  if not found then
    insert into public.notas_automaticas (empresa_id, buscar_desde, atualizado_por) values (p_empresa_id, p_desde, auth.uid());
    return jsonb_build_object('nfse_rebuscar', 0, 'nfe_sem_volta', 0);
  end if;
  update public.notas_automaticas set buscar_desde = p_desde, atualizado_por = auth.uid() where empresa_id = p_empresa_id;

  if v_antes.buscar_desde is not null and (p_desde is null or p_desde < v_antes.buscar_desde) then
    with liberados as (
      delete from public.notas_automaticas_nsu n
       where n.empresa_id = p_empresa_id and n.servico = 'nfse' and n.ignorado
         and (p_desde is null or n.competencia is null or n.competencia >= p_desde)
      returning n.nsu
    )
    select count(*)::int, min(nsu::numeric) into v_nfse, v_min from liberados;
    if v_min is not null then
      update public.notas_automaticas
         set nfse_ult_nsu = least(nfse_ult_nsu, greatest(v_min - 1, 0)::bigint), nfse_proxima = now()
       where empresa_id = p_empresa_id;
    end if;
    select count(*)::int into v_nfe from public.notas_automaticas_nsu n
     where n.empresa_id = p_empresa_id and n.servico = 'nfe' and n.ignorado
       and (p_desde is null or n.competencia is null or n.competencia >= p_desde);
  end if;
  return jsonb_build_object('nfse_rebuscar', v_nfse, 'nfe_sem_volta', v_nfe);
end;
$$;

create or replace function public.definir_inicio_notas(p_empresa_id uuid, p_desde date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes date;
  v_res jsonb;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  select buscar_desde into v_antes from public.notas_automaticas where empresa_id = p_empresa_id;
  v_res := app.aplicar_mes_inicial(p_empresa_id, p_desde);
  if (v_res ->> 'nfse_rebuscar')::int > 0
     and exists (select 1 from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null and valido_ate > now())
     and not coalesce((select pausada from public.notas_automaticas where empresa_id = p_empresa_id), false) then
    perform app.agendar_notas_automaticas(p_empresa_id, now());
  end if;
  perform app.registrar_auditoria('notas_automaticas_mes_inicial', 'notas_automaticas', p_empresa_id::text, p_empresa_id,
    jsonb_build_object('antes', v_antes, 'depois', p_desde) || v_res);
  return v_res || jsonb_build_object('anteriores_no_portal',
    case when p_desde is null then 0 else
      (select count(*)::int from public.documentos d
        where d.empresa_id = p_empresa_id and d.origem = 'automatica' and d.competencia < p_desde) end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Cadastro do certificado: escolhe o mês inicial (só no primeiro cadastro;
-- a troca por um certificado renovado mantém o mês). p_sem_limite: tudo o que
-- os serviços ainda disponibilizam.
-- -----------------------------------------------------------------------------
drop function public.registrar_certificado(uuid, text, text, text, text, text, timestamptz, timestamptz, text, text);
create function public.registrar_certificado(
  p_empresa_id uuid,
  p_titular text,
  p_documento text,
  p_emissor text,
  p_numero_serie text,
  p_impressao_digital text,
  p_valido_de timestamptz,
  p_valido_ate timestamptz,
  p_autorizacao_texto text,
  p_conteudo_cifrado text,
  p_buscar_desde date default null,
  p_sem_limite boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp public.empresas;
  v_equipe boolean;
  v_anterior public.certificados_digitais;
  v_id uuid;
  v_venc uuid;
  v_raiz_emp text;
  v_existia boolean;
  v_escolheu boolean := p_buscar_desde is not null or coalesce(p_sem_limite, false);
  v_desde date := case when coalesce(p_sem_limite, false) then null
                       else coalesce(p_buscar_desde, (date_trunc('month', (now() at time zone 'America/Araguaina')::date) - interval '1 month')::date) end;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  v_equipe := p_empresa_id = any(app.empresas_equipe());
  if p_valido_ate <= now() then
    raise exception 'Este certificado está vencido.';
  end if;
  v_raiz_emp := left(upper(regexp_replace(coalesce(v_emp.documento, ''), '[^0-9A-Za-z]', '', 'g')), 8);
  if p_documento is null or length(v_raiz_emp) < 8 or left(p_documento, 8) <> v_raiz_emp then
    raise exception 'O certificado não é desta empresa (CNPJ diferente).';
  end if;
  perform app.validar_mes_inicial(p_buscar_desde);

  -- Substitui o certificado anterior (o conteúdo cifrado dele é apagado)
  select * into v_anterior from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null;
  if found then
    update public.certificados_digitais
       set revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = 'Substituído por um novo certificado.'
     where id = v_anterior.id;
    delete from public.certificados_segredos where certificado_id = v_anterior.id;
    if v_anterior.vencimento_id is not null then
      update public.vencimentos set situacao = 'arquivado' where id = v_anterior.vencimento_id;
    end if;
  end if;

  -- Validade do certificado também entra em Vencimentos (avisos de renovação)
  insert into public.vencimentos (empresa_id, tipo, descricao, numero, orgao, emissao, validade, responsavel, observacao)
  values (p_empresa_id, 'certificado_digital', 'Certificado digital A1 (notas automáticas)', left(p_numero_serie, 80), left(p_emissor, 120),
          (p_valido_de at time zone 'America/Araguaina')::date, (p_valido_ate at time zone 'America/Araguaina')::date, 'cliente',
          'Cadastrado no portal para a busca automática de notas. Ao renovar, cadastre o novo certificado em Notas automáticas.')
  returning id into v_venc;

  insert into public.certificados_digitais (empresa_id, titular, documento, emissor, numero_serie, impressao_digital, valido_de, valido_ate,
                                            autorizacao, autorizacao_texto, vencimento_id)
  values (p_empresa_id, left(p_titular, 300), p_documento, left(p_emissor, 300), p_numero_serie, upper(p_impressao_digital), p_valido_de, p_valido_ate,
          case when v_equipe then 'autorizacao_escrita' else 'cliente_no_portal' end, p_autorizacao_texto, v_venc)
  returning id into v_id;
  insert into public.certificados_segredos (certificado_id, conteudo_cifrado) values (v_id, p_conteudo_cifrado);

  v_existia := exists (select 1 from public.notas_automaticas where empresa_id = p_empresa_id);
  if v_existia and v_escolheu and v_anterior.id is null then
    perform app.aplicar_mes_inicial(p_empresa_id, v_desde);
  end if;
  insert into public.notas_automaticas (empresa_id, certificado_valido_ate, nfe_proxima, nfse_proxima, atualizado_por, buscar_desde)
  values (p_empresa_id, p_valido_ate, now(), now(), auth.uid(), v_desde)
  on conflict (empresa_id) do update
     set certificado_valido_ate = p_valido_ate,
         nfe_proxima = least(coalesce(public.notas_automaticas.nfe_proxima, now()), now() + interval '1 hour'),
         nfse_proxima = now(), ultimo_erro = null, erros_seguidos = 0, atualizado_por = auth.uid();
  perform app.agendar_notas_automaticas(p_empresa_id, now());

  perform app.registrar_auditoria('certificado_cadastrado', 'certificados_digitais', v_id::text, p_empresa_id,
    jsonb_build_object('titular', left(p_titular, 300), 'valido_ate', p_valido_ate, 'impressao_digital', upper(p_impressao_digital),
                       'autorizacao', case when v_equipe then 'autorizacao_escrita' else 'cliente_no_portal' end,
                       'buscar_desde', (select buscar_desde from public.notas_automaticas where empresa_id = p_empresa_id)));
  if v_equipe then
    perform app.notificar_clientes(p_empresa_id, 'certificado.gerenciar', 'certificado',
      'Certificado digital cadastrado pelo escritório',
      'O escritório cadastrou o certificado digital da empresa para buscar as notas fiscais automaticamente. Você pode revogar a qualquer momento.',
      '/e/' || p_empresa_id::text || '/notas-automaticas', true);
  else
    perform app.notificar_equipe(p_empresa_id, 'certificado', 'Certificado digital cadastrado pelo cliente',
      'A busca automática de notas foi ativada para a empresa.', '/e/' || p_empresa_id::text || '/notas-automaticas', false);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Resumo mês a mês das notas trazidas pela busca (respeita o acesso de quem vê)
-- -----------------------------------------------------------------------------
create or replace function public.notas_automaticas_por_mes(p_empresa_id uuid)
returns table (competencia date, nfe_entrada int, nfe_saida int, nfse_prestada int, nfse_tomada int, outros int, total int)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.competencia,
         (count(*) filter (where d.categoria_codigo = 'nfe_entrada_xml'))::int,
         (count(*) filter (where d.categoria_codigo = 'nfe_saida_xml'))::int,
         (count(*) filter (where d.categoria_codigo = 'nfse' and f.operacao = 'saida'))::int,
         (count(*) filter (where d.categoria_codigo = 'nfse' and f.operacao is distinct from 'saida'))::int,
         (count(*) filter (where d.categoria_codigo is null or d.categoria_codigo not in ('nfe_entrada_xml', 'nfe_saida_xml', 'nfse')))::int,
         count(*)::int
    from public.documentos d
    left join public.documentos_fiscais f on f.documento_id = d.id
   where d.empresa_id = p_empresa_id
     and d.origem = 'automatica'
     and d.excluido_em is null
   group by d.competencia
   order by d.competencia desc
$$;

-- -----------------------------------------------------------------------------
-- Exclusão definitiva de documentos e do que foi lido deles (uso interno)
-- -----------------------------------------------------------------------------
create or replace function app.apagar_documentos(p_empresa_id uuid, p_ids uuid[], p_motivo text, p_detalhes jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_docs uuid[];
  v_fis uuid[];
  v_chaves text[];
  v_lanc uuid[];
  v_itens uuid[];
  v_item uuid;
  v_caminhos jsonb;
  v_mes date;
  v_res jsonb;
  n_docs int := 0;
  n_fis int := 0;
  n_lanc int := 0;
  n_ev int := 0;
  n_res int := 0;
  n_ach int := 0;
  n_sped int := 0;
begin
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo.';
  end if;
  select coalesce(array_agg(d.id), '{}') into v_docs
    from public.documentos d where d.empresa_id = p_empresa_id and d.id = any(coalesce(p_ids, '{}'));
  -- Arquivos extraídos de um ZIP acompanham o ZIP
  v_docs := v_docs || coalesce((select array_agg(d.id) from public.documentos d
                                 where d.empresa_id = p_empresa_id and d.zip_origem_id = any(v_docs) and not d.id = any(v_docs)), '{}');
  if cardinality(v_docs) = 0 then
    return jsonb_build_object('documentos', 0, 'notas', 0, 'lancamentos', 0, 'eventos', 0, 'resumos', 0, 'achados', 0, 'sped', 0);
  end if;

  -- Mês fechado não muda
  select min(c.competencia) into v_mes
    from public.competencias c
   where c.empresa_id = p_empresa_id and c.status = 'fechada'
     and c.competencia in (select d.competencia from public.documentos d where d.id = any(v_docs));
  if v_mes is not null then
    raise exception 'O mês % está fechado. Reabra o fechamento antes de apagar os documentos dele.', to_char(v_mes, 'MM/YYYY');
  end if;

  select coalesce(array_agg(f.id), '{}'), coalesce(array_agg(f.chave_acesso) filter (where f.chave_acesso is not null), '{}')
    into v_fis, v_chaves
    from public.documentos_fiscais f where f.empresa_id = p_empresa_id and f.documento_id = any(v_docs);
  select coalesce(array_agg(l.id), '{}') into v_lanc
    from public.lancamentos l where l.empresa_id = p_empresa_id and l.documento_fiscal_id = any(v_fis);
  if exists (select 1 from public.baixas b where b.lancamento_id = any(v_lanc))
     or exists (select 1 from public.conciliacao_itens ci where ci.lancamento_id = any(v_lanc)) then
    raise exception 'Há lançamentos destas notas com pagamento, recebimento ou conciliação registrados. Desfaça antes de apagar.';
  end if;
  if exists (select 1 from public.importacoes i where i.documento_id = any(v_docs))
     or exists (select 1 from public.estoques e where e.documento_id = any(v_docs)) then
    raise exception 'Há importação de extrato ou estoque ligado a estes documentos. Desfaça antes de apagar.';
  end if;

  select coalesce(array_agg(distinct d.checklist_item_id) filter (where d.checklist_item_id is not null), '{}') into v_itens
    from public.documentos d where d.id = any(v_docs);
  select coalesce(jsonb_agg(distinct x.caminho), '[]'::jsonb) into v_caminhos
    from (select dv.storage_path as caminho from public.documento_versoes dv where dv.documento_id = any(v_docs)
          union
          select d.storage_path from public.documentos d where d.id = any(v_docs) and d.storage_path is not null) x;

  delete from public.lancamentos where id = any(v_lanc);
  get diagnostics n_lanc = row_count;
  delete from public.documento_fiscal_eventos where empresa_id = p_empresa_id and documento_id = any(v_docs);
  get diagnostics n_ev = row_count;
  -- Achados já publicados para o cliente ficam (são registro do que foi comunicado)
  delete from public.auditor_achados where empresa_id = p_empresa_id and chave = any(v_chaves) and publicado_em is null;
  get diagnostics n_ach = row_count;
  delete from public.documentos_fiscais where id = any(v_fis);
  get diagnostics n_fis = row_count;
  delete from public.nfe_resumos where empresa_id = p_empresa_id and documento_id = any(v_docs);
  get diagnostics n_res = row_count;
  delete from public.sped_arquivos where empresa_id = p_empresa_id and documento_id = any(v_docs);
  get diagnostics n_sped = row_count;
  -- Busca automática: o NSU fica como ignorado (a NFS-e volta se o mês inicial recuar)
  update public.notas_automaticas_nsu n
     set ignorado = true, competencia = coalesce(n.competencia, d.competencia), documento_id = null
    from public.documentos d
   where d.id = n.documento_id and n.empresa_id = p_empresa_id and d.id = any(v_docs);
  delete from public.documentos where id = any(v_docs);
  get diagnostics n_docs = row_count;

  foreach v_item in array v_itens loop
    perform app.recalcular_item_checklist(v_item);
  end loop;
  if jsonb_array_length(v_caminhos) > 0 then
    perform app.enfileirar('remover_arquivos', jsonb_build_object('caminhos', v_caminhos), p_empresa_id,
                           'apagar:' || md5(v_caminhos::text), now(), 150);
  end if;

  v_res := jsonb_build_object('documentos', n_docs, 'notas', n_fis, 'lancamentos', n_lanc, 'eventos', n_ev,
                              'resumos', n_res, 'achados', n_ach, 'sped', n_sped);
  perform app.registrar_auditoria('apagar_documentos', 'documentos', null, p_empresa_id,
    v_res || coalesce(p_detalhes, '{}'::jsonb) || jsonb_build_object('motivo', trim(p_motivo)));
  return v_res;
end;
$$;

-- Administrador: apaga as notas automáticas anteriores ao mês inicial da empresa
create or replace function public.apagar_notas_anteriores(p_empresa_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desde date;
  v_ids uuid[];
  v_chaves text[];
  v_res jsonb;
  v_resumos int := 0;
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_motivo), '')) < 5 then
    raise exception 'Informe o motivo (pelo menos 5 letras).';
  end if;
  select buscar_desde into v_desde from public.notas_automaticas where empresa_id = p_empresa_id;
  if v_desde is null then
    raise exception 'Escolha o mês inicial da busca antes de apagar as notas anteriores.';
  end if;
  select coalesce(array_agg(d.id), '{}') into v_ids
    from public.documentos d
   where d.empresa_id = p_empresa_id and d.origem = 'automatica' and d.competencia < v_desde;

  -- Resumos de NF-e (sem o XML) emitidas antes do mês inicial
  with apagados as (
    delete from public.nfe_resumos r
     where r.empresa_id = p_empresa_id and r.documento_id is null
       and r.data_emissao < (v_desde::timestamp at time zone 'America/Araguaina')
    returning r.chave, r.data_emissao
  ), marcados as (
    update public.notas_automaticas_nsu n
       set ignorado = true,
           competencia = date_trunc('month', (a.data_emissao at time zone 'America/Araguaina'))::date
      from apagados a
     where n.empresa_id = p_empresa_id and n.servico = 'nfe' and n.chave = a.chave and n.documento_id is null
    returning 1
  )
  select count(*)::int into v_resumos from apagados;

  v_res := app.apagar_documentos(p_empresa_id, v_ids, p_motivo,
                                 jsonb_build_object('origem', 'notas_anteriores_ao_mes_inicial', 'ate', v_desde, 'resumos_sem_xml', v_resumos));
  return v_res || jsonb_build_object('resumos', (v_res ->> 'resumos')::int + v_resumos, 'ate', v_desde);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
revoke execute on function app.validar_mes_inicial(date), app.aplicar_mes_inicial(uuid, date),
  app.apagar_documentos(uuid, uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function app.apagar_documentos(uuid, uuid[], text, jsonb) to service_role;
revoke execute on function public.definir_inicio_notas(uuid, date), public.apagar_notas_anteriores(uuid, text),
  public.notas_automaticas_por_mes(uuid),
  public.registrar_certificado(uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, date, boolean) from public, anon;
grant execute on function public.definir_inicio_notas(uuid, date), public.apagar_notas_anteriores(uuid, text),
  public.notas_automaticas_por_mes(uuid),
  public.registrar_certificado(uuid, text, text, text, text, text, timestamptz, timestamptz, text, text, date, boolean) to authenticated;
