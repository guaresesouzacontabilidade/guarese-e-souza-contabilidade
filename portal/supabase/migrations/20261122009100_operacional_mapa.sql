-- =============================================================================
-- Mapa da carteira: onde cada empresa está no mês, em 6 etapas
--   documentos do cliente · notas da SEFAZ · extrato e conciliação ·
--   impostos e guias · obrigações entregues · fechamento
-- Só a equipe do escritório vê (administrador: todas; equipe: as empresas que
-- atende). O cliente não vê nada disto.
--
--  * app.operacional_dados(empresa, competência): os números de cada etapa,
--    lidos do que o portal já guarda (checklist, notas, extratos, tarefas das
--    obrigações e fechamento). A tela transforma os números em situação e texto.
--  * operacional_marcacoes: a equipe marca uma etapa como concluída no mês, ou
--    como "não se aplica" (no mês ou em todos os meses da empresa).
--  * operacional_anotacoes: recados internos da equipe sobre a empresa.
-- =============================================================================

create table public.operacional_marcacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  etapa text not null check (etapa in ('documentos', 'notas', 'extrato', 'impostos', 'obrigacoes', 'fechamento')),
  -- vazia = todos os meses (só para "não se aplica")
  competencia date check (competencia is null or extract(day from competencia) = 1),
  situacao text not null check (situacao in ('concluida', 'nao_se_aplica')),
  observacao text check (observacao is null or length(observacao) <= 500),
  marcada_por uuid references public.perfis(id) on delete set null default auth.uid(),
  marcada_em timestamptz not null default now(),
  constraint operacional_marcacoes_todas_nao_aplica check (competencia is not null or situacao = 'nao_se_aplica'),
  constraint operacional_marcacoes_unica unique nulls not distinct (empresa_id, etapa, competencia)
);
create trigger auditoria_operacional_marcacoes after insert or update or delete on public.operacional_marcacoes
  for each row execute function app.tg_auditoria();

create table public.operacional_anotacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  texto text not null check (length(trim(texto)) between 3 and 1000),
  autor_id uuid references public.perfis(id) on delete set null default auth.uid(),
  criada_em timestamptz not null default now()
);
create index operacional_anotacoes_empresa_idx on public.operacional_anotacoes (empresa_id, criada_em desc);
create trigger auditoria_operacional_anotacoes after insert or update or delete on public.operacional_anotacoes
  for each row execute function app.tg_auditoria();

alter table public.operacional_marcacoes enable row level security;
alter table public.operacional_anotacoes enable row level security;
create policy operacional_marcacoes_leitura on public.operacional_marcacoes for select to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)));
create policy operacional_anotacoes_leitura on public.operacional_anotacoes for select to authenticated
  using ((select app.equipe_ve_empresa(empresa_id)));
grant select on public.operacional_marcacoes, public.operacional_anotacoes to authenticated;

-- -----------------------------------------------------------------------------
-- Tarefas das obrigações de uma etapa (impostos: apuração e pagamento;
-- obrigações: entrega). Para o escritório, o pagamento está feito quando a
-- guia foi enviada (quem paga é o cliente).
-- -----------------------------------------------------------------------------
create or replace function app.operacional_tarefas(p_empresa_id uuid, p_competencia date, p_etapas text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select t.*, o.nome as obrigacao,
           (t.status in ('concluida', 'dispensada') or (t.etapa = 'pagamento' and t.guia_documento_id is not null)) as feito,
           coalesce(t.prazo_legal, t.prazo_interno) as limite
      from public.tarefas t
      join public.obrigacoes o on o.id = t.obrigacao_id
     where t.empresa_id = p_empresa_id and t.competencia = p_competencia and t.etapa = any (p_etapas)
  )
  select jsonb_build_object(
    'total', count(*),
    'ok', count(*) filter (where t.feito),
    'cliente', count(*) filter (where not t.feito and t.status = 'aguardando_cliente'),
    'revisao', count(*) filter (where not t.feito and t.status = 'em_revisao'),
    'andamento', count(*) filter (where not t.feito and t.status = 'em_andamento'),
    'atrasadas', count(*) filter (where not t.feito and t.limite < app.hoje()),
    'prazo', min(t.limite) filter (where not t.feito),
    'prazo_nome', (select x.obrigacao from t x where not x.feito order by x.limite, x.obrigacao limit 1),
    'tarde', coalesce(bool_or(
      (not t.feito and t.limite < app.hoje())
      or (t.status = 'concluida' and (t.concluida_em at time zone 'America/Araguaina')::date > t.limite)), false)
  )
  from t;
$$;

-- -----------------------------------------------------------------------------
-- Números das 6 etapas de uma empresa numa competência (uso interno)
-- -----------------------------------------------------------------------------
create or replace function app.operacional_dados(p_empresa_id uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c date := app.competencia_de(p_competencia);
  f date := (app.competencia_de(p_competencia) + interval '1 month')::date;
  h date := app.hoje();
  v_doc jsonb;
  v_not jsonb;
  v_ext jsonb;
  v_fec jsonb;
  v_mar jsonb;
begin
  -- 1. Documentos do cliente: itens obrigatórios do checklist do mês
  select jsonb_build_object(
    'total', count(*),
    'ok', count(*) filter (where i.status in ('concluido', 'nao_se_aplica')),
    'cliente', count(*) filter (where i.status in ('pendente', 'correcao') and i.prazo >= h),
    'atrasados', count(*) filter (where i.status in ('pendente', 'correcao') and i.prazo < h),
    'conferir', count(*) filter (where i.status in ('enviado', 'em_analise', 'nao_se_aplica_solicitado')),
    'prazo', min(i.prazo) filter (where i.status in ('pendente', 'correcao')),
    'faltam', coalesce((
      select jsonb_agg(x.titulo order by x.prazo, x.titulo)
        from (select i2.titulo, i2.prazo from public.checklist_itens i2
               where i2.empresa_id = p_empresa_id and i2.competencia = c and i2.obrigatorio
                 and i2.status in ('pendente', 'correcao')
               order by i2.prazo, i2.titulo limit 5) x), '[]'::jsonb),
    -- Chegou atrasado: ainda pendente depois do prazo, ou saiu de "pendente" depois do prazo
    'tarde', coalesce(bool_or(
      (i.status in ('pendente', 'correcao') and i.prazo < h)
      or ((select (min(ch.alterado_em) at time zone 'America/Araguaina')::date
             from public.checklist_historico ch
            where ch.item_id = i.id and ch.status_anterior = 'pendente' and ch.status_novo is distinct from 'pendente') > i.prazo)), false)
  ) into v_doc
  from public.checklist_itens i
  where i.empresa_id = p_empresa_id and i.competencia = c and i.obrigatorio;

  -- 2. Notas da SEFAZ: XML do mês no portal e resumos ainda sem o XML completo
  select jsonb_build_object(
    'docs', (select count(*) from public.documentos d
              where d.empresa_id = p_empresa_id and d.competencia = c and d.excluido_em is null
                and d.upload_status = 'concluido' and coalesce(d.extensao, '') <> 'zip'
                and d.categoria_codigo in ('nfe_entrada_xml', 'nfe_saida_xml', 'nfse', 'cte_xml')),
    'sem_xml', (select count(*) from public.nfe_resumos r
                 where r.empresa_id = p_empresa_id and r.documento_id is null and r.situacao = 'autorizada'
                   and r.data_emissao >= (c::timestamp at time zone 'America/Araguaina')
                   and r.data_emissao < (f::timestamp at time zone 'America/Araguaina')),
    'auto', case
      when na.empresa_id is null or na.certificado_valido_ate is null then 'sem'
      when na.certificado_valido_ate < now() then 'certificado_vencido'
      when na.pausada then 'pausada'
      when na.erros_seguidos >= 3 then 'erro'
      else 'ativa' end,
    'erro', case when na.erros_seguidos >= 3 then left(na.ultimo_erro, 200) end
  ) into v_not
  from (select 1) um
  left join public.notas_automaticas na on na.empresa_id = p_empresa_id;

  -- 3. Extrato e conciliação: lançamentos do extrato no mês
  select jsonb_build_object(
    'contas', (select count(*) from public.contas_financeiras cf
                where cf.empresa_id = p_empresa_id and cf.ativa and cf.tipo in ('conta_corrente', 'poupanca')
                  and cf.saldo_inicial_data < f),
    'movimentos', count(m.id),
    'pendentes', count(m.id) filter (where m.status_conciliacao = 'pendente'),
    'contas_sem_extrato', (
      select count(*) from public.contas_financeiras cf
       where cf.empresa_id = p_empresa_id and cf.ativa and cf.tipo in ('conta_corrente', 'poupanca')
         and cf.saldo_inicial_data < f
         and not exists (select 1 from public.movimentos_bancarios m2
                          where m2.conta_financeira_id = cf.id and m2.data >= c and m2.data < f)
         and not exists (select 1 from public.extrato_saldos s
                          where s.conta_financeira_id = cf.id and s.data >= c and s.data < f))
  ) into v_ext
  from public.movimentos_bancarios m
  where m.empresa_id = p_empresa_id and m.data >= c and m.data < f;

  -- 6. Fechamento do mês
  select jsonb_build_object(
    'status', coalesce(cp.status, 'aberta'),
    'fechada_em', cp.fechada_em,
    'fechada_por', (select p.nome from public.perfis p where p.id = cp.fechada_por),
    'etapa', (select fe.etapa from public.fechamento_etapas fe
               where fe.competencia_id = cp.id and fe.status <> 'concluida' order by fe.ordem limit 1),
    'pendencias', (select count(*) from public.fechamento_pendencias fp
                    where fp.competencia_id = cp.id and fp.status = 'aberta' and fp.impeditiva)
  ) into v_fec
  from (select 1) um
  left join public.competencias cp on cp.empresa_id = p_empresa_id and cp.competencia = c;

  -- Marcações da equipe (a do mês vale sobre a de "todos os meses")
  select coalesce(jsonb_object_agg(x.etapa, jsonb_build_object(
           'situacao', x.situacao, 'todas', x.competencia is null, 'observacao', x.observacao,
           'por', p.nome, 'em', x.marcada_em)), '{}'::jsonb)
    into v_mar
    from (select distinct on (m.etapa) m.*
            from public.operacional_marcacoes m
           where m.empresa_id = p_empresa_id and (m.competencia = c or m.competencia is null)
           order by m.etapa, m.competencia nulls last) x
    left join public.perfis p on p.id = x.marcada_por;

  return jsonb_build_object(
    'documentos', v_doc,
    'notas', v_not,
    'extrato', v_ext,
    'impostos', app.operacional_tarefas(p_empresa_id, c, array['apuracao', 'pagamento']),
    'obrigacoes', app.operacional_tarefas(p_empresa_id, c, array['entrega']),
    'fechamento', v_fec,
    'marcacoes', v_mar
  );
end;
$$;

revoke execute on function app.operacional_tarefas(uuid, date, text[]) from public, anon, authenticated;
revoke execute on function app.operacional_dados(uuid, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Mapa da carteira (uma competência; uma empresa ou todas as que a pessoa atende)
-- -----------------------------------------------------------------------------
create or replace function public.operacional_mapa(p_competencia date, p_empresa_id uuid default null)
returns table (
  empresa_id uuid, razao_social text, nome_fantasia text, documento text, regime text, cidade text, uf text,
  responsavel_id uuid, responsavel text, dados jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_competencia is null then
    raise exception 'Informe a competência.';
  end if;
  if not (app.is_admin() or app.is_equipe()) then
    raise exception 'Acesso negado.';
  end if;
  return query
  select e.id, e.razao_social::text, e.nome_fantasia::text, e.documento::text,
         app.regime_em(e.id, app.competencia_de(p_competencia)),
         coalesce(mu.nome, e.cidade)::text, e.uf::text, e.contador_responsavel_id, pr.nome::text,
         app.operacional_dados(e.id, p_competencia)
    from public.empresas e
    left join public.municipios mu on mu.ibge = e.municipio_ibge
    left join public.perfis pr on pr.id = e.contador_responsavel_id
   where e.ativa
     and (p_empresa_id is null or e.id = p_empresa_id)
     and app.equipe_ve_empresa(e.id)
   order by e.razao_social;
end;
$$;

-- Como foi nos últimos meses (até 12), para a ficha da empresa
create or replace function public.operacional_historico(p_empresa_id uuid, p_ate date, p_meses int default 6)
returns table (competencia date, dados jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_ate is null or not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.';
  end if;
  return query
  select g.mes::date, app.operacional_dados(p_empresa_id, g.mes::date)
    from generate_series(
           app.competencia_de(p_ate) - make_interval(months => least(greatest(coalesce(p_meses, 6), 1), 12) - 1),
           app.competencia_de(p_ate), interval '1 month') as g(mes)
   order by 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Marcar / desmarcar uma etapa
-- -----------------------------------------------------------------------------
create or replace function public.operacional_marcar(
  p_empresa_id uuid, p_etapa text, p_competencia date, p_situacao text,
  p_observacao text default null, p_todas boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date;
  v_id uuid;
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.';
  end if;
  if p_etapa is null or p_etapa not in ('documentos', 'notas', 'extrato', 'impostos', 'obrigacoes', 'fechamento') then
    raise exception 'Etapa inválida.';
  end if;
  if p_situacao is null or p_situacao not in ('concluida', 'nao_se_aplica') then
    raise exception 'Situação inválida.';
  end if;
  if coalesce(p_todas, false) then
    if p_situacao <> 'nao_se_aplica' then
      raise exception 'Só "não se aplica" vale para todos os meses.';
    end if;
    v_comp := null;
  else
    if p_competencia is null then
      raise exception 'Informe a competência.';
    end if;
    v_comp := app.competencia_de(p_competencia);
  end if;
  if length(coalesce(p_observacao, '')) > 500 then
    raise exception 'A observação pode ter até 500 caracteres.';
  end if;
  insert into public.operacional_marcacoes (empresa_id, etapa, competencia, situacao, observacao, marcada_por, marcada_em)
  values (p_empresa_id, p_etapa, v_comp, p_situacao, nullif(trim(p_observacao), ''), auth.uid(), now())
  on conflict on constraint operacional_marcacoes_unica do update
    set situacao = excluded.situacao, observacao = excluded.observacao,
        marcada_por = excluded.marcada_por, marcada_em = excluded.marcada_em
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.operacional_desmarcar(p_empresa_id uuid, p_etapa text, p_competencia date, p_todas boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.';
  end if;
  delete from public.operacional_marcacoes m
   where m.empresa_id = p_empresa_id and m.etapa = p_etapa
     and m.competencia is not distinct from (case when coalesce(p_todas, false) then null else app.competencia_de(p_competencia) end);
end;
$$;

-- -----------------------------------------------------------------------------
-- Anotações da equipe
-- -----------------------------------------------------------------------------
create or replace function public.operacional_anotar(p_empresa_id uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.';
  end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then
    raise exception 'Escreva a anotação (pelo menos 3 letras).';
  end if;
  if length(trim(p_texto)) > 1000 then
    raise exception 'A anotação pode ter até 1000 caracteres.';
  end if;
  insert into public.operacional_anotacoes (empresa_id, texto, autor_id)
  values (p_empresa_id, trim(p_texto), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.operacional_anotacao_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.operacional_anotacoes;
begin
  select * into v from public.operacional_anotacoes where id = p_id;
  if v.id is null or not app.equipe_ve_empresa(v.empresa_id) then
    raise exception 'Anotação não encontrada.';
  end if;
  if v.autor_id is distinct from auth.uid() and not app.is_admin() then
    raise exception 'Só quem escreveu (ou o administrador) apaga a anotação.';
  end if;
  delete from public.operacional_anotacoes where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Últimas ações na empresa (tarefas, checklist, fechamento e marcações)
-- -----------------------------------------------------------------------------
create or replace function public.operacional_ultimas_acoes(p_empresa_id uuid, p_limite int default 8)
returns table (quando timestamptz, quem text, texto text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.equipe_ve_empresa(p_empresa_id) then
    raise exception 'Acesso negado.';
  end if;
  return query
  select x.quando, x.quem, x.texto
    from (
      select th.ocorrido_em as quando, p.nome as quem,
             o.nome || ' (' || case t.etapa when 'apuracao' then 'apuração' when 'entrega' then 'entrega' else 'pagamento' end || '): '
               || case th.status_novo
                    when 'concluida' then 'concluída'
                    when 'em_revisao' then 'enviada para revisão'
                    when 'aguardando_cliente' then 'esperando o cliente'
                    when 'em_andamento' then 'em andamento'
                    when 'dispensada' then 'dispensada'
                    else 'reaberta' end as texto
        from public.tarefa_historico th
        join public.tarefas t on t.id = th.tarefa_id
        join public.obrigacoes o on o.id = t.obrigacao_id
        left join public.perfis p on p.id = th.usuario_id
       where th.empresa_id = p_empresa_id and th.status_novo is not null
         and th.status_novo is distinct from th.status_anterior
      union all
      select ch.alterado_em, p.nome,
             i.titulo || ': ' || case ch.status_novo
                                   when 'concluido' then 'conferido'
                                   when 'enviado' then 'enviado pelo cliente'
                                   when 'correcao' then 'correção pedida ao cliente'
                                   else 'não se aplica' end
        from public.checklist_historico ch
        join public.checklist_itens i on i.id = ch.item_id
        left join public.perfis p on p.id = ch.alterado_por
       where ch.empresa_id = p_empresa_id and ch.status_novo in ('concluido', 'enviado', 'correcao', 'nao_se_aplica')
      union all
      select h.em, p.nome,
             case h.acao when 'fechamento_iniciado' then 'Fechamento iniciado' when 'fechada' then 'Mês fechado' else 'Mês reaberto' end
               || ' (' || to_char(cp.competencia, 'MM/YYYY') || ')'
        from public.competencia_historico h
        join public.competencias cp on cp.id = h.competencia_id
        left join public.perfis p on p.id = h.por
       where h.empresa_id = p_empresa_id and h.acao in ('fechamento_iniciado', 'fechada', 'reaberta')
      union all
      select m.marcada_em, p.nome,
             'Etapa "' || case m.etapa
                            when 'documentos' then 'Documentos do cliente'
                            when 'notas' then 'Notas da SEFAZ'
                            when 'extrato' then 'Extrato e conciliação'
                            when 'impostos' then 'Impostos e guias'
                            when 'obrigacoes' then 'Obrigações entregues'
                            else 'Fechamento' end
               || '" marcada como ' || case m.situacao when 'concluida' then 'concluída' else 'não se aplica' end
               || case when m.competencia is null then ' (todos os meses)' else ' (' || to_char(m.competencia, 'MM/YYYY') || ')' end
        from public.operacional_marcacoes m
        left join public.perfis p on p.id = m.marcada_por
       where m.empresa_id = p_empresa_id
    ) x
   order by x.quando desc
   limit least(greatest(coalesce(p_limite, 8), 1), 30);
end;
$$;

revoke execute on function public.operacional_mapa(date, uuid) from public, anon;
revoke execute on function public.operacional_historico(uuid, date, int) from public, anon;
revoke execute on function public.operacional_marcar(uuid, text, date, text, text, boolean) from public, anon;
revoke execute on function public.operacional_desmarcar(uuid, text, date, boolean) from public, anon;
revoke execute on function public.operacional_anotar(uuid, text) from public, anon;
revoke execute on function public.operacional_anotacao_excluir(uuid) from public, anon;
revoke execute on function public.operacional_ultimas_acoes(uuid, int) from public, anon;
grant execute on function public.operacional_mapa(date, uuid) to authenticated;
grant execute on function public.operacional_historico(uuid, date, int) to authenticated;
grant execute on function public.operacional_marcar(uuid, text, date, text, text, boolean) to authenticated;
grant execute on function public.operacional_desmarcar(uuid, text, date, boolean) to authenticated;
grant execute on function public.operacional_anotar(uuid, text) to authenticated;
grant execute on function public.operacional_anotacao_excluir(uuid) to authenticated;
grant execute on function public.operacional_ultimas_acoes(uuid, int) to authenticated;
