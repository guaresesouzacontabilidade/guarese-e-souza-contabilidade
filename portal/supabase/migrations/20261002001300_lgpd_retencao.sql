-- =============================================================================
-- Migração 1300: LGPD, consentimentos, solicitações de titulares e retenção
-- =============================================================================

alter table public.documentos
  add column expurgado_em timestamptz,
  add column expurgado_por uuid references public.perfis(id) on delete set null,
  add column expurgo_motivo text;

-- Política de retenção por categoria (anos contados a partir do fim da competência)
create table public.politicas_retencao (
  categoria_codigo text primary key references public.categorias_documento(codigo) on delete cascade,
  anos int not null check (anos between 1 and 50),
  observacao text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfis(id) on delete set null default auth.uid()
);

-- Valores sugeridos (podem ser alterados pelo administrador):
-- documentos fiscais e financeiros: 6 anos (prazo decadencial/prescricional tributário de 5 anos + margem);
-- folha e trabalhistas: 30 anos para FGTS/previdência em alguns casos — mantidos por mais tempo.
insert into public.politicas_retencao (categoria_codigo, anos, observacao) values
  ('folha_pagamento', 30, 'Documentos trabalhistas e previdenciários podem ser exigidos por prazos longos.'),
  ('contrato_emprestimo', 10, 'Contratos: manter por no mínimo 10 anos após o término.'),
  ('esc_folha', 30, 'Folhas de pagamento emitidas pelo escritório.'),
  ('esc_contrato', 10, 'Contratos e documentos societários.');

create table public.aceites_termos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.perfis(id) on delete cascade,
  versao text not null,
  aceito_em timestamptz not null default now(),
  ip text,
  user_agent text
);
create index aceites_termos_usuario_idx on public.aceites_termos (user_id, aceito_em desc);

create table public.solicitacoes_titular (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.perfis(id) on delete set null default auth.uid(),
  email text,
  tipo text not null check (tipo in ('acesso', 'correcao', 'anonimizacao', 'exclusao', 'portabilidade', 'informacao', 'revogacao_consentimento')),
  descricao text,
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'concluida', 'recusada')),
  resposta text,
  created_at timestamptz not null default now(),
  respondida_em timestamptz,
  respondida_por uuid references public.perfis(id) on delete set null
);

-- -----------------------------------------------------------------------------
-- RPCs de privacidade
-- -----------------------------------------------------------------------------
create or replace function public.registrar_aceite_termos(p_versao text, p_ip text default null, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  insert into public.aceites_termos (user_id, versao, ip, user_agent)
  values (auth.uid(), p_versao, left(p_ip, 100), left(p_user_agent, 500));
  update public.perfis set aceite_termos_versao = p_versao, aceite_termos_em = now() where id = auth.uid();
end;
$$;

create or replace function public.criar_solicitacao_titular(p_tipo text, p_descricao text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_admin uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  insert into public.solicitacoes_titular (user_id, email, tipo, descricao)
  values (auth.uid(), (select email from public.perfis where id = auth.uid()), p_tipo, left(p_descricao, 4000))
  returning id into v_id;
  for v_admin in select id from public.perfis where tipo = 'admin' and ativo loop
    perform app.notificar(v_admin, null, 'lgpd', 'Nova solicitação de titular de dados (LGPD)', p_tipo, '/escritorio/configuracoes', true);
  end loop;
  return v_id;
end;
$$;

create or replace function public.responder_solicitacao_titular(p_id uuid, p_status text, p_resposta text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sol public.solicitacoes_titular;
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into v_sol from public.solicitacoes_titular where id = p_id for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  update public.solicitacoes_titular
     set status = p_status, resposta = p_resposta, respondida_em = now(), respondida_por = auth.uid()
   where id = p_id;
  if v_sol.user_id is not null then
    perform app.notificar(v_sol.user_id, null, 'lgpd', 'Sua solicitação sobre dados pessoais foi atualizada', p_resposta, '/conta/privacidade', true);
  end if;
end;
$$;

-- Exporta os dados pessoais do próprio usuário (direito de acesso/portabilidade).
create or replace function public.exportar_meus_dados()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  perform app.registrar_auditoria('exportar_dados_pessoais', 'perfis', v_uid::text, null, null);
  return jsonb_build_object(
    'gerado_em', now(),
    'perfil', (select to_jsonb(p) from public.perfis p where p.id = v_uid),
    'vinculos', (select coalesce(jsonb_agg(jsonb_build_object(
                   'empresa', coalesce(e.nome_fantasia, e.razao_social), 'papel', m.papel, 'permissoes', m.permissoes,
                   'ativo', m.ativo, 'convidado_em', m.convidado_em, 'revogado_em', m.revogado_em)), '[]'::jsonb)
                   from public.empresa_membros m join public.empresas e on e.id = m.empresa_id where m.user_id = v_uid),
    'aceites_termos', (select coalesce(jsonb_agg(to_jsonb(a) - 'user_id'), '[]'::jsonb) from public.aceites_termos a where a.user_id = v_uid),
    'notificacoes', (select coalesce(jsonb_agg(jsonb_build_object('titulo', n.titulo, 'criada_em', n.created_at, 'lida_em', n.lida_em)), '[]'::jsonb)
                       from public.notificacoes n where n.user_id = v_uid),
    'envios', (select coalesce(jsonb_agg(jsonb_build_object('canal', s.canal, 'assunto', s.assunto, 'status', s.status, 'criado_em', s.created_at)), '[]'::jsonb)
                 from public.envios s where s.user_id = v_uid),
    'acessos_documentos', (select coalesce(jsonb_agg(jsonb_build_object('documento_id', a.documento_id, 'tipo', a.tipo, 'em', a.ocorrido_em, 'ip', a.ip)), '[]'::jsonb)
                             from public.documento_acessos a where a.user_id = v_uid),
    'auditoria', (select coalesce(jsonb_agg(jsonb_build_object('acao', a.acao, 'entidade', a.entidade, 'em', a.ocorrido_em, 'ip', a.ip)), '[]'::jsonb)
                    from (select * from public.auditoria where user_id = v_uid order by ocorrido_em desc limit 5000) a),
    'solicitacoes', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.solicitacoes_titular s where s.user_id = v_uid)
  );
end;
$$;

-- Anonimiza um usuário (o registro de auditoria é preservado sem dados pessoais).
create or replace function public.anonimizar_usuario(p_user_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode anonimizar o próprio usuário.';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo.';
  end if;
  update public.empresa_membros
     set ativo = false, revogado_em = coalesce(revogado_em, now()), revogado_por = auth.uid(), motivo_revogacao = 'Anonimização (LGPD)'
   where user_id = p_user_id;
  update public.perfis
     set nome = 'Usuário anonimizado',
         email = 'anonimizado+' || substr(md5(p_user_id::text), 1, 12) || '@removido.invalid',
         telefone = null,
         cargo = null,
         preferencias = '{}'::jsonb,
         ativo = false,
         anonimizado_em = now()
   where id = p_user_id;
  update public.auditoria set user_email = null where user_id = p_user_id;
  update public.envios set destinatario = 'anonimizado' where user_id = p_user_id;
  perform app.registrar_auditoria('anonimizar_usuario', 'perfis', p_user_id::text, null, jsonb_build_object('motivo', p_motivo));
end;
$$;

-- Documentos que já ultrapassaram o prazo de retenção (para revisão do administrador).
create or replace function public.documentos_retencao_vencida(p_limite int default 500)
returns table (
  documento_id uuid,
  empresa_id uuid,
  empresa_nome text,
  categoria_codigo text,
  competencia date,
  nome_original text,
  anos_retencao int,
  vence_em date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return query
  select d.id, d.empresa_id, coalesce(e.nome_fantasia, e.razao_social), d.categoria_codigo, d.competencia, d.nome_original,
         coalesce(pr.anos, esc.retencao_padrao_anos),
         ((d.competencia + interval '1 month') + make_interval(years => coalesce(pr.anos, esc.retencao_padrao_anos)))::date
    from public.documentos d
    join public.empresas e on e.id = d.empresa_id
    cross join public.escritorio esc
    left join public.politicas_retencao pr on pr.categoria_codigo = d.categoria_codigo
   where d.expurgado_em is null
     and d.upload_status = 'concluido'
     and ((d.competencia + interval '1 month') + make_interval(years => coalesce(pr.anos, esc.retencao_padrao_anos)))::date < app.hoje()
   order by d.competencia
   limit p_limite;
end;
$$;

-- Expurgo: remove os arquivos (via processador) e mantém apenas metadados mínimos.
create or replace function public.expurgar_documentos(p_ids uuid[], p_motivo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caminhos jsonb;
  v_n int;
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do expurgo.';
  end if;
  select coalesce(jsonb_agg(dv.storage_path), '[]'::jsonb) into v_caminhos
    from public.documento_versoes dv
    join public.documentos d on d.id = dv.documento_id
   where d.id = any(p_ids) and d.expurgado_em is null;
  update public.documentos
     set expurgado_em = now(), expurgado_por = auth.uid(), expurgo_motivo = trim(p_motivo),
         excluido_em = coalesce(excluido_em, now()), excluido_por = coalesce(excluido_por, auth.uid()),
         motivo_exclusao = coalesce(motivo_exclusao, 'Expurgo por política de retenção'),
         observacao = null, extracao = null, nome_original = 'expurgado-' || substr(id::text, 1, 8)
   where id = any(p_ids) and expurgado_em is null;
  get diagnostics v_n = row_count;
  perform app.enfileirar('remover_arquivos', jsonb_build_object('caminhos', v_caminhos), null,
                         'expurgo:' || md5(v_caminhos::text), now(), 150);
  perform app.registrar_auditoria('expurgar_documentos', 'documentos', null, null,
                                  jsonb_build_object('quantidade', v_n, 'motivo', p_motivo));
  return v_n;
end;
$$;

alter table public.politicas_retencao enable row level security;
alter table public.aceites_termos enable row level security;
alter table public.solicitacoes_titular enable row level security;

create policy politicas_retencao_leitura on public.politicas_retencao for select to authenticated
  using ((select app.usuario_valido()));
create policy politicas_retencao_admin on public.politicas_retencao for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy aceites_termos_leitura on public.aceites_termos for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy solicitacoes_titular_leitura on public.solicitacoes_titular for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
