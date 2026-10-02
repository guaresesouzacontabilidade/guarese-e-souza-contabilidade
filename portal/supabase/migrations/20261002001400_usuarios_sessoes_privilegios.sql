-- =============================================================================
-- Migração 1400: gestão de usuários e sessões, funções públicas e privilégios
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Dados públicos do escritório (tela de login)
-- -----------------------------------------------------------------------------
create or replace function public.escritorio_publico()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'nome_fantasia', e.nome_fantasia,
    'razao_social', e.razao_social,
    'cnpj', e.cnpj,
    'logradouro', e.logradouro, 'numero', e.numero, 'bairro', e.bairro,
    'cidade', e.cidade, 'uf', e.uf, 'cep', e.cep,
    'email', e.email, 'telefone', e.telefone, 'whatsapp', e.whatsapp,
    'site', e.site, 'instagram', e.instagram,
    'nome_sistema', e.nome_sistema,
    'descricao_sistema', e.descricao_sistema,
    'mensagem_login', e.mensagem_login,
    'logo_path', e.logo_path,
    'logo_atualizado_em', e.logo_atualizado_em
  )
  from public.escritorio e where e.id = 1;
$$;

-- -----------------------------------------------------------------------------
-- Vínculos e permissões
-- -----------------------------------------------------------------------------
create or replace function app.validar_gestao_membro(p_empresa_id uuid, p_papel text, p_permissoes text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_minhas text[];
begin
  perform app.exigir(p_empresa_id, 'usuarios.gerenciar');
  if p_papel not in ('equipe', 'cliente_titular', 'cliente_colaborador') then
    raise exception 'Papel inválido.';
  end if;
  if not (coalesce(p_permissoes, array[]::text[]) <@ app.permissoes_validas()) then
    raise exception 'Permissão inválida.';
  end if;
  if app.is_admin() then
    return;
  end if;
  if p_papel = 'equipe' then
    raise exception 'Somente administradores vinculam a equipe às empresas.';
  end if;
  if app.tipo_usuario() = 'cliente' then
    if p_papel <> 'cliente_colaborador' then
      raise exception 'Clientes só podem convidar colaboradores.';
    end if;
    select m.permissoes into v_minhas from public.empresa_membros m
     where m.empresa_id = p_empresa_id and m.user_id = auth.uid() and m.ativo;
    if not (coalesce(p_permissoes, array[]::text[]) <@ coalesce(v_minhas, array[]::text[])) then
      raise exception 'Você não pode conceder permissões que não possui.';
    end if;
    if 'usuarios.gerenciar' = any(p_permissoes) then
      raise exception 'Colaboradores não podem gerenciar usuários.';
    end if;
  end if;
end;
$$;

create or replace function public.vincular_membro(p_empresa_id uuid, p_user_id uuid, p_papel text, p_permissoes text[] default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perms text[] := coalesce(p_permissoes, app.permissoes_padrao(p_papel));
  v_id uuid;
  v_emp public.empresas;
begin
  perform app.validar_gestao_membro(p_empresa_id, p_papel, v_perms);
  select * into v_emp from public.empresas where id = p_empresa_id;
  insert into public.empresa_membros (empresa_id, user_id, papel, permissoes, ativo, convidado_por, convidado_em)
  values (p_empresa_id, p_user_id, p_papel, v_perms, true, auth.uid(), now())
  on conflict (empresa_id, user_id) do update
     set papel = excluded.papel, permissoes = excluded.permissoes, ativo = true,
         revogado_em = null, revogado_por = null, motivo_revogacao = null,
         convidado_por = excluded.convidado_por, convidado_em = now()
  returning id into v_id;
  perform app.notificar(p_user_id, p_empresa_id, 'acesso_concedido',
    'Você recebeu acesso à empresa ' || coalesce(v_emp.nome_fantasia, v_emp.razao_social),
    'Use o seletor de empresas no topo do portal para alternar entre as empresas.',
    '/e/' || p_empresa_id::text, false);
  return v_id;
end;
$$;

create or replace function public.atualizar_membro(p_membro_id uuid, p_papel text, p_permissoes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.empresa_membros;
begin
  select * into v_m from public.empresa_membros where id = p_membro_id for update;
  if not found then
    raise exception 'Vínculo não encontrado.';
  end if;
  if v_m.user_id = auth.uid() and not app.is_admin() then
    raise exception 'Você não pode alterar as próprias permissões.';
  end if;
  perform app.validar_gestao_membro(v_m.empresa_id, v_m.papel, v_m.permissoes);
  perform app.validar_gestao_membro(v_m.empresa_id, p_papel, p_permissoes);
  update public.empresa_membros set papel = p_papel, permissoes = p_permissoes where id = p_membro_id;
end;
$$;

create or replace function public.revogar_membro(p_membro_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.empresa_membros;
begin
  select * into v_m from public.empresa_membros where id = p_membro_id for update;
  if not found then
    raise exception 'Vínculo não encontrado.';
  end if;
  if v_m.user_id = auth.uid() then
    raise exception 'Você não pode revogar o próprio acesso.';
  end if;
  perform app.validar_gestao_membro(v_m.empresa_id, v_m.papel, v_m.permissoes);
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da revogação.';
  end if;
  update public.empresa_membros
     set ativo = false, revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = trim(p_motivo)
   where id = p_membro_id;
end;
$$;

-- Registro de convite (o usuário é criado no Auth pelo servidor)
create or replace function public.registrar_convite(
  p_email text,
  p_nome text,
  p_user_id uuid,
  p_tipo_usuario text,
  p_empresa_id uuid,
  p_papel text,
  p_permissoes text[],
  p_envio_status text,
  p_envio_erro text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_empresa_id is null then
    if not app.is_admin() then
      raise exception 'Somente administradores convidam a equipe.' using errcode = '42501';
    end if;
  else
    perform app.validar_gestao_membro(p_empresa_id, p_papel, p_permissoes);
  end if;
  insert into public.convites (email, nome, user_id, tipo_usuario, empresa_id, papel, permissoes, envio_status, envio_erro, ultimo_envio_em)
  values (lower(trim(p_email)), p_nome, p_user_id, p_tipo_usuario, p_empresa_id, p_papel, coalesce(p_permissoes, array[]::text[]),
          p_envio_status, p_envio_erro, now())
  returning id into v_id;
  perform app.registrar_auditoria('convite', 'convites', v_id::text, p_empresa_id,
                                  jsonb_build_object('email', lower(trim(p_email)), 'papel', p_papel, 'tipo', p_tipo_usuario, 'envio', p_envio_status));
  return v_id;
end;
$$;

-- Administrador: tipo, ativação e cargo de usuários
create or replace function public.administrar_usuario(p_user_id uuid, p_tipo text, p_ativo boolean, p_cargo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.perfis;
  v_admins int;
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  select * into v_p from public.perfis where id = p_user_id for update;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  if p_user_id = auth.uid() and (not p_ativo or p_tipo <> 'admin') then
    raise exception 'Você não pode desativar ou rebaixar o próprio usuário.';
  end if;
  if p_tipo not in ('admin', 'equipe', 'cliente') then
    raise exception 'Tipo inválido.';
  end if;
  if (v_p.tipo = 'cliente') <> (p_tipo = 'cliente') and exists (select 1 from public.empresa_membros where user_id = p_user_id and ativo) then
    raise exception 'Revogue os vínculos com empresas antes de mudar entre equipe e cliente.';
  end if;
  if v_p.tipo = 'admin' and (p_tipo <> 'admin' or not p_ativo) then
    select count(*) into v_admins from public.perfis where tipo = 'admin' and ativo and id <> p_user_id;
    if v_admins = 0 then
      raise exception 'O portal precisa de pelo menos um administrador ativo.';
    end if;
  end if;
  update public.perfis set tipo = p_tipo, ativo = p_ativo, cargo = nullif(trim(coalesce(p_cargo, '')), '') where id = p_user_id;
  if not p_ativo then
    delete from auth.sessions where user_id = p_user_id;
    perform app.registrar_auditoria('desativar_usuario', 'perfis', p_user_id::text, null, null);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sessões
-- -----------------------------------------------------------------------------
create or replace function public.minhas_sessoes()
returns table (id uuid, criada_em timestamptz, atualizada_em timestamptz, user_agent text, ip text, aal text, atual boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at), s.user_agent, host(s.ip), s.aal::text,
         s.id = app.try_uuid(auth.jwt() ->> 'session_id')
    from auth.sessions s
   where s.user_id = auth.uid()
   order by coalesce(s.refreshed_at::timestamptz, s.updated_at) desc nulls last;
$$;

create or replace function public.encerrar_sessao(p_sessao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  delete from auth.sessions where id = p_sessao_id and user_id = auth.uid();
  perform app.registrar_auditoria('encerrar_sessao', 'sessoes', p_sessao_id::text, null, null);
end;
$$;

-- Administrador encerra todas as sessões de um usuário (efeito imediato pelo RLS).
create or replace function public.encerrar_sessoes_usuario(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not (app.is_admin() or p_user_id = auth.uid()) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_n = row_count;
  perform app.registrar_auditoria('encerrar_sessoes', 'sessoes', p_user_id::text, null, jsonb_build_object('quantidade', v_n));
  return v_n;
end;
$$;

-- Registro de login (último acesso, aceite de convite e auditoria).
create or replace function public.registrar_login(p_ip text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.perfis;
begin
  select * into v_p from public.perfis where id = auth.uid();
  if not found then
    raise exception 'Perfil não encontrado.';
  end if;
  update public.perfis set ultimo_acesso_em = now() where id = v_p.id;
  update public.convites set status = 'aceito', aceito_em = now() where user_id = v_p.id and status = 'pendente';
  perform app.registrar_auditoria('login', 'sessoes', auth.jwt() ->> 'session_id', null,
                                  jsonb_build_object('aal', auth.jwt() ->> 'aal'), p_ip, p_user_agent);
  return jsonb_build_object('tipo', v_p.tipo, 'ativo', v_p.ativo, 'aceite_termos_versao', v_p.aceite_termos_versao);
end;
$$;

-- Eventos de segurança registrados pelo servidor (com IP/navegador).
create or replace function public.registrar_evento(
  p_acao text,
  p_entidade text,
  p_entidade_id text default null,
  p_empresa_id uuid default null,
  p_detalhes jsonb default null,
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.';
  end if;
  if p_acao not in ('logout', 'mfa_ativado', 'mfa_removido', 'senha_alterada', 'senha_redefinida', 'exportacao',
                    'download_lote', 'visualizacao_relatorio', 'convite_reenviado', 'acesso_negado') then
    raise exception 'Evento não permitido.';
  end if;
  if p_empresa_id is not null and not app.pode(p_empresa_id, 'empresa.ver') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  perform app.registrar_auditoria(p_acao, p_entidade, p_entidade_id, p_empresa_id, p_detalhes, p_ip, p_user_agent);
end;
$$;

-- Logomarca atualizada (o arquivo é enviado ao bucket público "marca")
create or replace function public.definir_logo_escritorio(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  update public.escritorio set logo_path = nullif(p_path, ''), logo_atualizado_em = now(), updated_by = auth.uid() where id = 1;
end;
$$;

-- Criação de empresa com configuração padrão e vínculo do contador responsável.
create or replace function public.criar_empresa(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_doc text := app.somente_digitos(p_dados ->> 'documento');
  v_resp uuid := app.try_uuid(p_dados ->> 'contador_responsavel_id');
begin
  if not app.is_admin() then
    raise exception 'Somente administradores cadastram empresas.' using errcode = '42501';
  end if;
  if exists (select 1 from public.empresas where documento = v_doc) then
    raise exception 'Já existe uma empresa cadastrada com este CNPJ/CPF.';
  end if;
  insert into public.empresas (
    razao_social, nome_fantasia, tipo_pessoa, documento, inscricao_estadual, inscricao_municipal, regime_tributario,
    atividade_principal, cnae, logradouro, numero, complemento, bairro, cidade, uf, cep, email, telefone,
    contador_responsavel_id, data_inicio_atendimento, servicos, controla_estoque, observacoes, demonstracao
  ) values (
    trim(p_dados ->> 'razao_social'), nullif(trim(coalesce(p_dados ->> 'nome_fantasia', '')), ''),
    coalesce(p_dados ->> 'tipo_pessoa', 'PJ'), v_doc,
    nullif(p_dados ->> 'inscricao_estadual', ''), nullif(p_dados ->> 'inscricao_municipal', ''),
    p_dados ->> 'regime_tributario', nullif(p_dados ->> 'atividade_principal', ''), nullif(p_dados ->> 'cnae', ''),
    nullif(p_dados ->> 'logradouro', ''), nullif(p_dados ->> 'numero', ''), nullif(p_dados ->> 'complemento', ''),
    nullif(p_dados ->> 'bairro', ''), nullif(p_dados ->> 'cidade', ''), nullif(upper(p_dados ->> 'uf'), ''),
    app.somente_digitos(p_dados ->> 'cep'), nullif(p_dados ->> 'email', ''), nullif(p_dados ->> 'telefone', ''),
    v_resp, (p_dados ->> 'data_inicio_atendimento')::date,
    coalesce(array(select jsonb_array_elements_text(p_dados -> 'servicos')), array['contabil', 'fiscal']),
    coalesce((p_dados ->> 'controla_estoque')::boolean, false), nullif(p_dados ->> 'observacoes', ''),
    coalesce((p_dados ->> 'demonstracao')::boolean, false)
  ) returning id into v_id;

  perform app.criar_plano_contas_padrao(v_id);
  perform app.criar_modelos_padrao(v_id);

  -- Contador responsável da equipe passa a ter acesso à empresa.
  if v_resp is not null and exists (select 1 from public.perfis where id = v_resp and tipo = 'equipe' and ativo) then
    insert into public.empresa_membros (empresa_id, user_id, papel, permissoes, convidado_por)
    values (v_id, v_resp, 'equipe', app.permissoes_padrao('equipe'), auth.uid())
    on conflict (empresa_id, user_id) do nothing;
  end if;
  return v_id;
end;
$$;

-- Categorias do sistema não podem mudar de tipo (evita distorcer juros/taxas).
create or replace function app.tg_categorias_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.codigo_sistema is not null and new.tipo <> old.tipo then
    raise exception 'A categoria "%" é usada automaticamente pelo sistema e não pode mudar de tipo.', old.nome;
  end if;
  if tg_op = 'DELETE' and old.codigo_sistema is not null then
    raise exception 'A categoria "%" é usada automaticamente pelo sistema. Você pode desativá-la, mas não excluí-la.', old.nome;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger categorias_regras before update or delete on public.categorias_financeiras
  for each row execute function app.tg_categorias_regras();

-- Baixas e transferências criadas por conciliação só mudam desfazendo a conciliação.
create or replace function app.tg_protecao_conciliacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.conciliacao_id is not null
     and coalesce(current_setting('app.contexto', true), '') <> 'conciliacao'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Este registro foi criado por uma conciliação bancária. Desfaça a conciliação para alterá-lo.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger baixas_protecao_conciliacao before update or delete on public.baixas
  for each row execute function app.tg_protecao_conciliacao();
create trigger transferencias_protecao_conciliacao before update or delete on public.transferencias
  for each row execute function app.tg_protecao_conciliacao();

-- -----------------------------------------------------------------------------
-- Privilégios: o acesso padrão é negado; somente o necessário é concedido.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Leitura (filtrada pelas políticas RLS)
grant select on all tables in schema public to authenticated;
revoke select on public.jobs from authenticated;
grant select on public.jobs to authenticated;  -- política restringe a administradores

-- Escrita direta (sempre sujeita a RLS e gatilhos)
grant update (nome_fantasia, razao_social, cnpj, logradouro, numero, complemento, bairro, cidade, uf, cep, email, telefone,
              whatsapp, site, instagram, nome_sistema, descricao_sistema, mensagem_login, exigir_2fa_equipe, exigir_2fa_clientes,
              lembretes_dias, lembretes_email_ativo, lembretes_whatsapp_ativo, whatsapp_phone_number_id, whatsapp_template_lembrete,
              whatsapp_template_idioma, retencao_padrao_anos, upload_tamanho_maximo_mb, zip_max_arquivos, zip_max_tamanho_mb, updated_by)
  on public.escritorio to authenticated;

grant update (nome, telefone, preferencias) on public.perfis to authenticated;

grant update (razao_social, nome_fantasia, inscricao_estadual, inscricao_municipal, regime_tributario, atividade_principal, cnae,
              logradouro, numero, complemento, bairro, cidade, uf, cep, email, telefone, contador_responsavel_id,
              data_inicio_atendimento, servicos, controla_estoque, observacoes, ativa, sugerir_lancamentos_xml)
  on public.empresas to authenticated;

grant insert, update, delete on public.empresa_contatos to authenticated;
grant update (lida_em) on public.notificacoes to authenticated;
grant insert, update, delete on public.checklist_modelos to authenticated;

grant insert, update, delete on public.contas_financeiras, public.centros_custo, public.projetos, public.contrapartes,
  public.estoques to authenticated;
grant insert (empresa_id, codigo, nome, tipo, pai_id, sintetica, ativa),
      update (codigo, nome, tipo, pai_id, sintetica, ativa),
      delete
  on public.categorias_financeiras to authenticated;
grant insert (empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id, valor,
              frequencia, dia_vencimento, data_inicio, data_fim, meses_a_frente, ativa),
      update (descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id, valor,
              frequencia, dia_vencimento, data_fim, meses_a_frente, ativa),
      delete
  on public.recorrencias to authenticated;
grant insert (empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id,
              data_competencia, data_vencimento, valor_previsto, numero_documento, observacoes, status_revisao),
      update (descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id, data_competencia,
              data_vencimento, valor_previsto, situacao, status_revisao, numero_documento, observacoes, motivo_cancelamento, tipo),
      delete
  on public.lancamentos to authenticated;
grant insert (lancamento_id, documento_id, empresa_id, tipo_vinculo), delete on public.lancamento_documentos to authenticated;
grant insert (empresa_id, lancamento_id, data_pagamento, conta_financeira_id, valor_principal, juros, multa, desconto, taxas,
              forma_pagamento, observacao),
      update (data_pagamento, conta_financeira_id, valor_principal, juros, multa, desconto, taxas, forma_pagamento, observacao),
      delete
  on public.baixas to authenticated;
grant insert (empresa_id, conta_origem_id, conta_destino_id, data, valor, tipo, descricao),
      update (data, valor, tipo, descricao),
      delete
  on public.transferencias to authenticated;
grant insert (empresa_id, conta_financeira_id, data, saldo, fonte), delete on public.extrato_saldos to authenticated;
grant insert, update, delete on public.categorias_documento to authenticated;      -- política: somente administrador
grant insert, update, delete on public.politicas_retencao to authenticated;        -- política: somente administrador

-- Funções do schema app (usadas pelas políticas RLS)
grant execute on all functions in schema app to authenticated, service_role;

-- RPCs disponíveis para usuários autenticados (cada uma valida permissões)
grant execute on function
  public.escritorio_publico(),
  public.criar_documento(uuid, date, text, text, text, bigint, text, text, uuid, text, boolean, text, date, numeric),
  public.confirmar_upload(uuid),
  public.substituir_documento(uuid, text, text, bigint, text, text),
  public.alterar_status_documento(uuid, text, text),
  public.atualizar_documento(uuid, text, date, text, uuid, text, date, numeric),
  public.excluir_documento(uuid, text),
  public.registrar_acesso_documento(uuid, text, int, text, text),
  public.avaliar_documento_apos_fechamento(uuid, text),
  public.gerar_checklist_competencia(uuid, date),
  public.aplicar_checklist_padrao(uuid),
  public.solicitar_nao_aplica(uuid, text),
  public.revisar_nao_aplica(uuid, boolean, text),
  public.concluir_item_checklist(uuid, text),
  public.reabrir_item_checklist(uuid, text),
  public.solicitar_correcao_item(uuid, text),
  public.adicionar_item_checklist(uuid, date, text, text, text, date, boolean, int, uuid, uuid),
  public.atualizar_item_checklist(uuid, text, text, date, boolean, int, uuid, uuid, text),
  public.resumo_checklist(uuid, date),
  public.iniciar_fechamento(uuid, date),
  public.atualizar_etapa_fechamento(uuid, text, uuid, text),
  public.registrar_pendencia_fechamento(uuid, text, text, boolean, boolean),
  public.resolver_pendencia_fechamento(uuid, text, text),
  public.fechar_competencia(uuid, date, text),
  public.reabrir_competencia(uuid, date, text),
  public.criar_conversa(uuid, text, text, text, date, uuid, uuid, uuid[]),
  public.enviar_mensagem(uuid, text, boolean, uuid[]),
  public.alterar_status_conversa(uuid, text),
  public.marcar_conversa_lida(uuid),
  public.configurar_empresa_padrao(uuid),
  public.saldo_conta(uuid, date),
  public.criar_parcelamento(uuid, text, text, uuid, numeric, int, date, date, boolean, uuid, uuid, uuid, uuid, text, text),
  public.registrar_venda_maquininha(uuid, text, date, date, numeric, numeric, uuid, uuid, uuid, uuid, boolean),
  public.registrar_compra_cartao(uuid, uuid, text, date, numeric, uuid, uuid, uuid, uuid, int),
  public.registrar_parcela_emprestimo(uuid, text, date, numeric, numeric, uuid, uuid, date),
  public.gerar_recorrencias_empresa(uuid),
  public.reprocessar_documento(uuid),
  public.importar_extrato(uuid, uuid, text, text, text, text, uuid, jsonb, jsonb, numeric, date, int, jsonb),
  public.importar_lancamentos(uuid, text, text, text, uuid, jsonb, jsonb, int, jsonb),
  public.desfazer_importacao(uuid, text),
  public.ignorar_movimento(uuid, boolean, text),
  public.registrar_sugestoes_conciliacao(uuid, jsonb),
  public.confirmar_conciliacao(uuid, text, text, uuid),
  public.rejeitar_sugestao_conciliacao(uuid, text),
  public.conciliar_manual(uuid, uuid[], uuid[], uuid[], uuid[], text, text, text, uuid),
  public.classificar_movimento(uuid, uuid, text, uuid, uuid, uuid, date, uuid[]),
  public.desfazer_conciliacao(uuid, text),
  public.conferencia_saldos(uuid, date, date),
  public.movimentos_sem_comprovante(uuid, date, date),
  public.documentos_sem_vinculo(uuid, date, date),
  public.relatorio_dre_linhas(uuid, date, date, uuid, uuid),
  public.relatorio_dre_composicao(uuid, date, date, text[], uuid, uuid),
  public.relatorio_fluxo_realizado(uuid, date, date, uuid[], uuid),
  public.saldos_contas(uuid, date),
  public.relatorio_fluxo_projetado(uuid, date),
  public.qualidade_dados(uuid, date, date),
  public.salvar_rascunho_relatorio(uuid, uuid, text, text, date, date, date, jsonb, text, text, jsonb),
  public.publicar_relatorio(uuid),
  public.excluir_rascunho_relatorio(uuid),
  public.registrar_acesso_relatorio(uuid, text),
  public.enviar_lembrete_manual(uuid, date, text),
  public.registrar_aceite_termos(text, text, text),
  public.criar_solicitacao_titular(text, text),
  public.responder_solicitacao_titular(uuid, text, text),
  public.exportar_meus_dados(),
  public.anonimizar_usuario(uuid, text),
  public.documentos_retencao_vencida(int),
  public.expurgar_documentos(uuid[], text),
  public.vincular_membro(uuid, uuid, text, text[]),
  public.atualizar_membro(uuid, text, text[]),
  public.revogar_membro(uuid, text),
  public.registrar_convite(text, text, uuid, text, uuid, text, text[], text, text),
  public.administrar_usuario(uuid, text, boolean, text),
  public.minhas_sessoes(),
  public.encerrar_sessao(uuid),
  public.encerrar_sessoes_usuario(uuid),
  public.registrar_login(text, text),
  public.registrar_evento(text, text, text, uuid, jsonb, text, text),
  public.definir_logo_escritorio(text),
  public.criar_empresa(jsonb)
to authenticated;

grant execute on function public.escritorio_publico() to anon;

-- Somente o processador em segundo plano (service_role)
grant execute on function
  public.jobs_reservar(int, text, text[]),
  public.jobs_concluir(bigint, jsonb),
  public.jobs_falhar(bigint, text, int),
  public.registrar_xml_fiscal(uuid, jsonb),
  public.rotina_diaria()
to service_role;
grant execute on all functions in schema public to service_role;
