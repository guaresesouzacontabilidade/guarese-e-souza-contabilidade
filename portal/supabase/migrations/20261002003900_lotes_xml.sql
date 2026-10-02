-- =============================================================================
-- XML em lote por competência
--
--  * Quem pode baixar os documentos da empresa pede o lote de um mês (pela data
--    de emissão) com os tipos de nota escolhidos; a carteira inteira pode ser
--    pedida de uma vez pela equipe.
--  * O processador monta, em segundo plano, um ZIP organizado em pastas (dividido
--    em partes se for grande), com a relação das notas em planilha e um LEIA-ME;
--    o arquivo fica 7 dias no armazenamento privado e depois é apagado.
--  * Cada download registra o acesso a cada documento do lote (LGPD).
-- =============================================================================

create table public.xml_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  tipos text[] not null check (
    cardinality(tipos) between 1 and 7
    and tipos <@ array['nfe_entrada', 'nfe_saida', 'nfce', 'cte', 'nfse_prestada', 'nfse_tomada', 'eventos']
  ),
  -- Lotes pedidos juntos para a carteira
  pedido_id uuid,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'gerando', 'pronto', 'vazio', 'erro', 'expirado')),
  partes jsonb not null default '[]'::jsonb check (jsonb_typeof(partes) = 'array'),
  total_arquivos int,
  total_bytes bigint,
  resumo jsonb,
  erro text check (erro is null or length(erro) <= 1000),
  -- Pedido por quem vê os arquivos do escritório ainda não publicados: só a equipe vê
  equipe boolean not null default false,
  solicitado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  expira_em timestamptz
);
create index xml_lotes_empresa_idx on public.xml_lotes (empresa_id, criado_em desc);
create index xml_lotes_pedido_idx on public.xml_lotes (pedido_id) where pedido_id is not null;
create index xml_lotes_expira_idx on public.xml_lotes (expira_em) where situacao in ('pronto', 'erro');

-- Arquivos de cada lote (uso exclusivo do processador). parte = 0: arquivo
-- que não pôde ser lido (fica listado no LEIA-ME).
create table public.xml_lote_itens (
  lote_id uuid not null references public.xml_lotes(id) on delete cascade,
  ordem int not null,
  documento_id uuid,
  caminho text,
  arquivo text not null,
  dados jsonb not null default '{}'::jsonb,
  parte int,
  primary key (lote_id, ordem)
);

alter table public.xml_lotes enable row level security;
alter table public.xml_lote_itens enable row level security;
create policy xml_lotes_leitura on public.xml_lotes for select to authenticated
  using (
    empresa_id = any ((select app.empresas_com('documentos.baixar'))::uuid[])
    and (not equipe or app.e_equipe_da_empresa(empresa_id))
  );
grant select on public.xml_lotes to authenticated;
grant select, insert, update, delete on public.xml_lotes, public.xml_lote_itens to service_role;

-- Tipo de arquivo do lote conforme o modelo e a operação da nota
create or replace function app.tipo_lote_xml(p_modelo text, p_operacao text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_modelo = '55' and p_operacao = 'entrada' then 'nfe_entrada'
    when p_modelo = '55' and p_operacao = 'saida' then 'nfe_saida'
    when p_modelo = '65' then 'nfce'
    when p_modelo in ('57', '67') then 'cte'
    when p_modelo like 'nfse%' and p_operacao = 'saida' then 'nfse_prestada'
    when p_modelo like 'nfse%' and p_operacao = 'entrada' then 'nfse_tomada'
  end;
$$;

-- -----------------------------------------------------------------------------
-- Pedido do lote
-- -----------------------------------------------------------------------------
create or replace function app.criar_lote_xml(p_empresa_id uuid, p_competencia date, p_tipos text[], p_pedido uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_tipos text[];
  v_equipe boolean;
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'documentos.baixar');
  if p_competencia is null or v_comp > date_trunc('month', app.hoje())::date or v_comp < date '2000-01-01' then
    raise exception 'Escolha um mês válido (que já começou).';
  end if;
  if p_tipos is null or cardinality(p_tipos) = 0 then
    raise exception 'Escolha ao menos um tipo de nota.';
  end if;
  if not (p_tipos <@ array['nfe_entrada', 'nfe_saida', 'nfce', 'cte', 'nfse_prestada', 'nfse_tomada', 'eventos']) then
    raise exception 'Tipo de nota inválido.';
  end if;
  v_tipos := (select array_agg(distinct t order by t) from unnest(p_tipos) t);
  v_equipe := app.e_equipe_da_empresa(p_empresa_id);

  -- O mesmo lote pedido há pouco e ainda em preparo é reaproveitado
  select id into v_id from public.xml_lotes
   where empresa_id = p_empresa_id and competencia = v_comp and tipos = v_tipos and equipe = v_equipe
     and situacao in ('pendente', 'gerando') and criado_em > now() - interval '1 hour'
   order by criado_em desc limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.xml_lotes (empresa_id, competencia, tipos, pedido_id, equipe)
  values (p_empresa_id, v_comp, v_tipos, p_pedido, v_equipe)
  returning id into v_id;
  perform app.enfileirar('gerar_lote_xml', jsonb_build_object('lote_id', v_id), p_empresa_id, 'lote:' || v_id::text, now(), 60);
  return v_id;
end;
$$;

create or replace function public.solicitar_lote_xml(p_empresa_id uuid, p_competencia date, p_tipos text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'documentos.baixar');
  if (select count(*) from public.xml_lotes
       where solicitado_por = auth.uid() and pedido_id is null and criado_em > now() - interval '1 hour') >= 30 then
    raise exception 'Muitos lotes pedidos na última hora. Aguarde um pouco e tente de novo.';
  end if;
  v_id := app.criar_lote_xml(p_empresa_id, p_competencia, p_tipos, null);
  perform app.registrar_auditoria('lote_xml_solicitado', 'xml_lotes', v_id::text, p_empresa_id,
    jsonb_build_object('competencia', date_trunc('month', p_competencia)::date, 'tipos', p_tipos));
  return v_id;
end;
$$;

-- Lote de todas as empresas da carteira com notas do mês nos tipos escolhidos (equipe)
create or replace function public.solicitar_lotes_xml_carteira(p_competencia date, p_tipos text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_pedido uuid := gen_random_uuid();
  v_n int := 0;
  r record;
begin
  if coalesce(app.tipo_usuario(), '') not in ('admin', 'equipe') then
    raise exception 'Somente a equipe do escritório pode pedir o lote da carteira.' using errcode = '42501';
  end if;
  if p_tipos is null or cardinality(p_tipos) = 0 then
    raise exception 'Escolha ao menos um tipo de nota.';
  end if;
  if (select count(distinct pedido_id) from public.xml_lotes
       where solicitado_por = auth.uid() and pedido_id is not null and criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'Muitos lotes da carteira pedidos na última hora. Aguarde um pouco e tente de novo.';
  end if;
  for r in
    select e.id
      from public.empresas e
     where e.ativa
       and e.id = any (app.empresas_com('documentos.baixar'))
       and (
         exists (
           select 1 from public.documentos_fiscais df
             join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
            where df.empresa_id = e.id and df.competencia = v_comp and df.relacionado_empresa and d.excluido_em is null
              and app.tipo_lote_xml(df.modelo, df.operacao) = any (p_tipos)
         )
         or ('eventos' = any (p_tipos) and exists (
           select 1 from public.documento_fiscal_eventos ev
            where ev.empresa_id = e.id
              and ev.data_evento >= (v_comp::timestamp at time zone 'America/Araguaina')
              and ev.data_evento < ((v_comp + interval '1 month')::timestamp at time zone 'America/Araguaina')
         ))
       )
     order by e.razao_social
  loop
    perform app.criar_lote_xml(r.id, v_comp, p_tipos, v_pedido);
    v_n := v_n + 1;
  end loop;
  perform app.registrar_auditoria('lote_xml_carteira', 'xml_lotes', v_pedido::text, null,
    jsonb_build_object('competencia', v_comp, 'tipos', p_tipos, 'empresas', v_n));
  return jsonb_build_object('pedido_id', v_pedido, 'empresas', v_n);
end;
$$;

-- -----------------------------------------------------------------------------
-- Preparação (processador): escolhe os arquivos e monta a relação
-- -----------------------------------------------------------------------------
create or replace function public.preparar_lote_xml(p_lote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.xml_lotes;
  v_total int;
  v_resumo jsonb;
begin
  select * into v from public.xml_lotes where id = p_lote_id for update;
  if not found then
    raise exception 'Lote não encontrado.';
  end if;
  -- Recomeço (depois de um erro): partes já gravadas são apagadas
  if jsonb_array_length(v.partes) > 0 then
    perform app.enfileirar('remover_arquivos',
      jsonb_build_object('caminhos', (select coalesce(jsonb_agg(x ->> 'caminho'), '[]'::jsonb) from jsonb_array_elements(v.partes) x)),
      null, 'lote-recomeco:' || v.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text, now(), 150);
  end if;
  delete from public.xml_lote_itens where lote_id = v.id;

  with notas as (
    select df.*, dv.storage_path, app.tipo_lote_xml(df.modelo, df.operacao) as tipo
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
      join public.documento_versoes dv on dv.documento_id = d.id and dv.versao = d.versao_atual and dv.upload_concluido_em is not null
     where df.empresa_id = v.empresa_id
       and df.competencia = v.competencia
       and df.relacionado_empresa
       and d.excluido_em is null
       and coalesce(dv.verificacao_status, '') <> 'bloqueado'
       and (v.equipe or d.direcao <> 'escritorio' or d.publicado_em is not null)
  ),
  eventos as (
    -- Eventos do mês e eventos (de qualquer data) das notas do lote
    select ev.*, dv.storage_path
      from public.documento_fiscal_eventos ev
      join public.documentos d on d.id = ev.documento_id and d.empresa_id = ev.empresa_id
      join public.documento_versoes dv on dv.documento_id = d.id and dv.versao = d.versao_atual and dv.upload_concluido_em is not null
     where ev.empresa_id = v.empresa_id
       and 'eventos' = any (v.tipos)
       and d.excluido_em is null
       and coalesce(dv.verificacao_status, '') <> 'bloqueado'
       and (v.equipe or d.direcao <> 'escritorio' or d.publicado_em is not null)
       and ((ev.data_evento >= (v.competencia::timestamp at time zone 'America/Araguaina')
             and ev.data_evento < ((v.competencia + interval '1 month')::timestamp at time zone 'America/Araguaina'))
            or ev.chave_acesso in (select n.chave_acesso from notas n where n.chave_acesso is not null and n.tipo = any (v.tipos)))
  ),
  -- Pastas sem acento (descompactadores antigos do Windows trocam os acentos)
  pastas(tipo, pasta, rotulo) as (
    values ('nfe_entrada', 'NF-e de entrada', 'NF-e de entrada'), ('nfe_saida', 'NF-e de saida', 'NF-e de saída'),
           ('nfce', 'NFC-e', 'NFC-e'), ('cte', 'CT-e', 'CT-e'),
           ('nfse_prestada', 'NFS-e prestadas', 'NFS-e prestada'), ('nfse_tomada', 'NFS-e tomadas', 'NFS-e tomada')
  ),
  arquivos as (
    select n.tipo, n.documento_id, n.storage_path,
           p.pasta || '/' || coalesce(n.chave_acesso, regexp_replace(upper(coalesce(n.modelo, 'nota')), '[^A-Z0-9]+', '', 'g')
             || '-' || coalesce(nullif(regexp_replace(n.numero, '[^0-9A-Za-z]+', '', 'g'), ''), 'sn') || '-' || left(n.id::text, 8)) || '.xml' as arquivo,
           jsonb_build_object(
             'tipo', p.rotulo, 'numero', n.numero, 'serie', n.serie, 'chave', n.chave_acesso,
             'data', to_char(n.data_emissao at time zone 'America/Araguaina', 'DD/MM/YYYY'),
             'emitente_documento', n.emitente_documento, 'emitente', n.emitente_nome,
             'destinatario_documento', n.destinatario_documento, 'destinatario', n.destinatario_nome,
             'valor', n.valor_total,
             'situacao', case when n.cancelada_evento then 'cancelada'
                              when n.situacao_arquivo = 'sem_protocolo' then 'sem protocolo no arquivo'
                              when n.situacao_arquivo = 'protocolo_nao_autorizado_no_arquivo' then 'não autorizada'
                              else 'autorizada' end
           ) as dados,
           n.data_emissao as ordem_data
      from notas n
      join pastas p on p.tipo = n.tipo
     where n.tipo = any (v.tipos)
    union all
    select 'zz_eventos', e.documento_id, e.storage_path,
           'Eventos/' || coalesce(e.chave_acesso, 'evento-' || left(e.id::text, 8)) || '-' || coalesce(e.tipo_evento, 'evento') || '-' || coalesce(e.sequencia, 1) || '.xml',
           jsonb_build_object('tipo', 'Evento: ' || coalesce(e.descricao_evento, e.tipo_evento, 'evento'), 'chave', e.chave_acesso,
                              'data', to_char(e.data_evento at time zone 'America/Araguaina', 'DD/MM/YYYY'),
                              'situacao', coalesce('cStat ' || e.cstat, '')),
           e.data_evento
      from eventos e
  )
  insert into public.xml_lote_itens (lote_id, ordem, documento_id, caminho, arquivo, dados)
  select v.id, row_number() over (order by a.tipo, a.ordem_data nulls last, a.arquivo), a.documento_id, a.storage_path, a.arquivo, a.dados
    from (select distinct on (arquivo) * from arquivos order by arquivo, ordem_data) a;
  get diagnostics v_total = row_count;

  select jsonb_build_object(
           'arquivos', v_total,
           'por_tipo', coalesce((select jsonb_object_agg(t.tipo, t.n) from (
               select i.dados ->> 'tipo' as tipo, count(*) as n from public.xml_lote_itens i where i.lote_id = v.id group by 1) t), '{}'::jsonb),
           'valor_notas', (select coalesce(sum((i.dados ->> 'valor')::numeric), 0) from public.xml_lote_itens i
                            where i.lote_id = v.id and i.dados ->> 'valor' is not null and i.dados ->> 'situacao' <> 'cancelada'),
           -- NF-e que a SEFAZ entregou só em resumo (sem o XML completo)
           'resumos_sem_xml', coalesce((
             select jsonb_agg(jsonb_build_object('chave', r.chave, 'emitente', r.emitente_nome, 'emitente_documento', r.emitente_documento,
                                                 'data', to_char(r.data_emissao at time zone 'America/Araguaina', 'DD/MM/YYYY'), 'valor', r.valor)
                              order by r.data_emissao)
               from public.nfe_resumos r
              where r.empresa_id = v.empresa_id and r.documento_id is null and r.situacao = 'autorizada'
                and 'nfe_entrada' = any (v.tipos)
                and r.data_emissao >= (v.competencia::timestamp at time zone 'America/Araguaina')
                and r.data_emissao < ((v.competencia + interval '1 month')::timestamp at time zone 'America/Araguaina')
           ), '[]'::jsonb)
         ) into v_resumo;

  update public.xml_lotes
     set situacao = 'gerando', resumo = v_resumo, total_arquivos = v_total, total_bytes = 0, partes = '[]'::jsonb, erro = null
   where id = v.id;
  return v_resumo;
end;
$$;

-- Parte gerada (processador): marca os arquivos incluídos e os que não puderam
-- ser lidos (parte 0) e acrescenta a parte ao lote, tudo de uma vez.
create or replace function public.registrar_parte_lote_xml(p_lote_id uuid, p_parte jsonb, p_ate_ordem int, p_falhos int[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero int := (p_parte ->> 'numero')::int;
begin
  if v_numero is null or v_numero < 1 or p_parte ->> 'caminho' is null then
    raise exception 'Parte inválida.';
  end if;
  update public.xml_lote_itens set parte = 0
   where lote_id = p_lote_id and parte is null and ordem = any (coalesce(p_falhos, array[]::int[]));
  update public.xml_lote_itens set parte = v_numero
   where lote_id = p_lote_id and parte is null and ordem <= p_ate_ordem;
  update public.xml_lotes
     set partes = partes || jsonb_build_array(p_parte),
         total_bytes = coalesce(total_bytes, 0) + coalesce((p_parte ->> 'bytes')::bigint, 0)
   where id = p_lote_id
     and not exists (select 1 from jsonb_array_elements(partes) x where (x ->> 'numero')::int = v_numero);
end;
$$;

-- Conclusão (processador): grava o resultado e avisa quem pediu. Na carteira,
-- o aviso sai uma vez, quando o último lote do pedido termina.
create or replace function public.concluir_lote_xml(p_lote_id uuid, p_situacao text, p_partes jsonb default null, p_total_bytes bigint default null, p_erro text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.xml_lotes;
  v_emp text;
  v_mes text;
  v_titulo text;
  v_corpo text;
  v_prontos int;
  v_vazios int;
  v_erros int;
  v_arquivos int;
begin
  if p_situacao not in ('pronto', 'vazio', 'erro') then
    raise exception 'Situação inválida.';
  end if;
  select * into v from public.xml_lotes where id = p_lote_id;
  if not found then
    raise exception 'Lote não encontrado.';
  end if;
  perform pg_advisory_xact_lock(hashtext('lote-xml:' || coalesce(v.pedido_id, v.id)::text));
  update public.xml_lotes
     set situacao = p_situacao,
         partes = coalesce(p_partes, partes),
         total_bytes = coalesce(p_total_bytes, total_bytes),
         erro = case when p_situacao = 'erro' then left(coalesce(p_erro, 'Falha ao gerar o lote.'), 1000) end,
         concluido_em = now(),
         expira_em = case when p_situacao in ('pronto', 'erro') then now() + interval '7 days' end
   where id = v.id
   returning * into v;
  if v.solicitado_por is null then
    return;
  end if;
  v_mes := to_char(v.competencia, 'MM/YYYY');
  v_arquivos := coalesce((select sum((x ->> 'arquivos')::int) from jsonb_array_elements(v.partes) x), 0);

  if v.pedido_id is null then
    select coalesce(nome_fantasia, razao_social) into v_emp from public.empresas where id = v.empresa_id;
    if p_situacao = 'pronto' then
      v_titulo := 'XML de ' || v_mes || ' prontos para baixar';
      v_corpo := v_emp || ': ' || v_arquivos || case when v_arquivos = 1 then ' arquivo' else ' arquivos' end
                 || case when jsonb_array_length(v.partes) > 1 then ' em ' || jsonb_array_length(v.partes) || ' partes' else '' end
                 || '. Disponível por 7 dias.';
    elsif p_situacao = 'vazio' then
      v_titulo := 'Nenhum XML em ' || v_mes;
      v_corpo := v_emp || ': não há notas desse mês nos tipos escolhidos.';
    else
      v_titulo := 'Não foi possível gerar os XML de ' || v_mes;
      v_corpo := v_emp || ': peça o lote de novo. Se o erro continuar, avise o escritório.';
    end if;
    perform app.notificar(v.solicitado_por, v.empresa_id, 'lote_xml', v_titulo, v_corpo,
      '/e/' || v.empresa_id::text || '/notas-automaticas#lotes-xml', false);
    return;
  end if;

  -- Carteira: avisa quando não resta nenhum lote do pedido em preparo
  if exists (select 1 from public.xml_lotes where pedido_id = v.pedido_id and situacao in ('pendente', 'gerando')) then
    return;
  end if;
  select count(*) filter (where situacao = 'pronto'), count(*) filter (where situacao = 'vazio'), count(*) filter (where situacao = 'erro')
    into v_prontos, v_vazios, v_erros
    from public.xml_lotes where pedido_id = v.pedido_id;
  perform app.notificar(v.solicitado_por, null, 'lote_xml', 'XML da carteira de ' || v_mes || ' prontos',
    v_prontos || case when v_prontos = 1 then ' empresa com arquivos' else ' empresas com arquivos' end
      || case when v_vazios > 0 then ', ' || v_vazios || ' sem notas' else '' end
      || case when v_erros > 0 then ', ' || v_erros || ' com erro' else '' end
      || '. Disponível por 7 dias.',
    '/escritorio/notas-automaticas#lotes-xml', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Download de uma parte (registra o acesso a cada documento)
-- -----------------------------------------------------------------------------
create or replace function public.baixar_lote_xml(p_lote_id uuid, p_parte int, p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.xml_lotes;
  v_parte jsonb;
begin
  select * into v from public.xml_lotes where id = p_lote_id;
  if not found then
    raise exception 'Lote não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'documentos.baixar');
  if v.equipe and not app.e_equipe_da_empresa(v.empresa_id) then
    raise exception 'Lote não encontrado.';
  end if;
  if v.situacao <> 'pronto' or v.expira_em is null or v.expira_em < now() then
    raise exception 'Este lote não está mais disponível. Gere de novo.';
  end if;
  select x into v_parte from jsonb_array_elements(v.partes) x where (x ->> 'numero')::int = p_parte;
  if v_parte is null then
    raise exception 'Parte do lote não encontrada.';
  end if;
  -- Documento excluído depois da geração: o lote não é mais entregue
  if exists (
    select 1 from public.xml_lote_itens i join public.documentos d on d.id = i.documento_id
     where i.lote_id = v.id and i.parte = p_parte and d.excluido_em is not null
  ) then
    raise exception 'Algum arquivo deste lote foi excluído depois que ele foi gerado. Gere o lote de novo.';
  end if;
  insert into public.documento_acessos (documento_id, empresa_id, user_id, tipo, versao, ip, user_agent)
  select d.id, d.empresa_id, auth.uid(), 'download_lote', d.versao_atual, left(p_ip, 100), left(p_user_agent, 500)
    from public.documentos d
   where d.empresa_id = v.empresa_id
     and d.id in (select distinct i.documento_id from public.xml_lote_itens i where i.lote_id = v.id and i.parte = p_parte and i.documento_id is not null);
  perform app.registrar_auditoria('download_lote_xml', 'xml_lotes', v.id::text, v.empresa_id,
    jsonb_build_object('competencia', v.competencia, 'parte', p_parte, 'arquivos', v_parte -> 'arquivos'), p_ip, p_user_agent);
  return jsonb_build_object('caminho', v_parte ->> 'caminho', 'nome', v_parte ->> 'nome');
end;
$$;

-- -----------------------------------------------------------------------------
-- Rotina diária: lotes vencidos têm os arquivos apagados
-- -----------------------------------------------------------------------------
create or replace function public.rotina_lotes_xml()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
  v_caminhos jsonb;
begin
  for r in select id, situacao, partes from public.xml_lotes
            where situacao in ('pronto', 'erro') and expira_em < now() for update skip locked
  loop
    select coalesce(jsonb_agg(x ->> 'caminho'), '[]'::jsonb) into v_caminhos from jsonb_array_elements(r.partes) x where x ? 'caminho';
    if jsonb_array_length(v_caminhos) > 0 then
      perform app.enfileirar('remover_arquivos', jsonb_build_object('caminhos', v_caminhos), null, 'lote-expirado:' || r.id::text, now(), 150);
    end if;
    update public.xml_lotes
       set situacao = case when r.situacao = 'pronto' then 'expirado' else r.situacao end, partes = '[]'::jsonb, expira_em = null
     where id = r.id;
    delete from public.xml_lote_itens where lote_id = r.id;
    v_n := v_n + 1;
  end loop;
  -- Pedidos que não andaram em 2 dias (falha repetida) ficam como erro
  update public.xml_lotes set situacao = 'erro', erro = coalesce(erro, 'O lote não foi gerado. Peça de novo.'), expira_em = now()
   where situacao in ('pendente', 'gerando') and criado_em < now() - interval '2 days';
  -- Histórico: lotes encerrados há mais de 90 dias saem da lista
  delete from public.xml_lotes where situacao in ('expirado', 'vazio', 'erro') and partes = '[]'::jsonb and criado_em < now() - interval '90 days';
  return jsonb_build_object('expirados', v_n);
end;
$$;

-- Lote apagado (ex.: empresa excluída) leva junto os arquivos gerados
create or replace function app.tg_xml_lotes_remover_arquivos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caminhos jsonb;
begin
  select coalesce(jsonb_agg(x ->> 'caminho'), '[]'::jsonb) into v_caminhos from jsonb_array_elements(old.partes) x where x ? 'caminho';
  if jsonb_array_length(v_caminhos) > 0 then
    perform app.enfileirar('remover_arquivos', jsonb_build_object('caminhos', v_caminhos), null, 'lote-apagado:' || old.id::text, now(), 150);
  end if;
  return old;
end;
$$;
create trigger xml_lotes_remover_arquivos after delete on public.xml_lotes
  for each row execute function app.tg_xml_lotes_remover_arquivos();

revoke execute on function app.tipo_lote_xml(text, text), app.criar_lote_xml(uuid, date, text[], uuid), app.tg_xml_lotes_remover_arquivos()
  from public, anon, authenticated;
revoke execute on function public.solicitar_lote_xml(uuid, date, text[]), public.solicitar_lotes_xml_carteira(date, text[]),
  public.preparar_lote_xml(uuid), public.registrar_parte_lote_xml(uuid, jsonb, int, int[]), public.concluir_lote_xml(uuid, text, jsonb, bigint, text),
  public.baixar_lote_xml(uuid, int, text, text), public.rotina_lotes_xml() from public, anon, authenticated;
grant execute on function public.solicitar_lote_xml(uuid, date, text[]), public.solicitar_lotes_xml_carteira(date, text[]),
  public.baixar_lote_xml(uuid, int, text, text) to authenticated;
grant execute on function public.preparar_lote_xml(uuid), public.registrar_parte_lote_xml(uuid, jsonb, int, int[]),
  public.concluir_lote_xml(uuid, text, jsonb, bigint, text), public.rotina_lotes_xml() to service_role;
