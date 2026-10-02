-- =============================================================================
-- Migração 1600: apoio ao processamento em segundo plano
-- =============================================================================

-- Arquivos extraídos de ZIP: caminho dentro do ZIP (garante extração idempotente)
alter table public.documentos add column zip_caminho text;
create unique index documentos_zip_caminho_unico on public.documentos (zip_origem_id, zip_caminho)
  where zip_origem_id is not null and zip_caminho is not null;

-- Notificação disparada pelo processador (service_role)
create or replace function public.sistema_notificar(
  p_user_id uuid,
  p_empresa_id uuid,
  p_tipo text,
  p_titulo text,
  p_corpo text default null,
  p_link text default null,
  p_email boolean default false
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select app.notificar(p_user_id, p_empresa_id, p_tipo, p_titulo, p_corpo, p_link, p_email);
$$;

create or replace function public.sistema_notificar_equipe(
  p_empresa_id uuid,
  p_tipo text,
  p_titulo text,
  p_corpo text default null,
  p_link text default null
)
returns int
language sql
security definer
set search_path = ''
as $$
  select app.notificar_equipe(p_empresa_id, p_tipo, p_titulo, p_corpo, p_link, false);
$$;

-- Recusa de arquivo pela verificação de segurança (somente processador)
create or replace function public.sistema_bloquear_documento(p_documento_id uuid, p_versao_id uuid, p_motivo text)
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
    return;
  end if;
  update public.documento_versoes set verificacao_status = 'bloqueado', verificacao_detalhes = p_motivo where id = p_versao_id;
  update public.documentos
     set verificacao_status = 'bloqueado',
         verificacao_detalhes = p_motivo,
         processamento_status = 'erro',
         status = case when direcao = 'cliente' then 'correcao' else status end,
         status_motivo = case when direcao = 'cliente' then 'Arquivo recusado pela verificação de segurança: ' || p_motivo else status_motivo end,
         status_alterado_em = now()
   where id = p_documento_id;
  insert into public.documento_historico (documento_id, empresa_id, acao, status_anterior, status_novo, motivo, alterado_por)
  values (p_documento_id, v_doc.empresa_id, 'bloqueado', v_doc.status, 'correcao', p_motivo, null);
  if v_doc.checklist_item_id is not null then
    perform app.recalcular_item_checklist(v_doc.checklist_item_id);
  end if;
  if v_doc.enviado_por is not null then
    perform app.notificar(v_doc.enviado_por, v_doc.empresa_id, 'documento_correcao',
      'Arquivo recusado: ' || v_doc.nome_original,
      'O arquivo foi recusado pela verificação de segurança: ' || p_motivo || ' Envie novamente o documento correto.',
      '/e/' || v_doc.empresa_id::text || '/documentos/' || v_doc.id::text, true);
  end if;
end;
$$;

revoke execute on function public.sistema_notificar(uuid, uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.sistema_notificar_equipe(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.sistema_bloquear_documento(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sistema_notificar(uuid, uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.sistema_notificar_equipe(uuid, text, text, text, text) to service_role;
grant execute on function public.sistema_bloquear_documento(uuid, uuid, text) to service_role;
