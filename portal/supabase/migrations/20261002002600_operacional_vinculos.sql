-- =============================================================================
-- Camada operacional — vínculo automático só de guias de pagamento
--
-- A guia publicada pelo escritório (categoria "Guias de impostos") é ligada à
-- tarefa de pagamento correspondente, sem marcá-la como paga. Recibos e
-- protocolos não são vinculados automaticamente: quem conclui a tarefa
-- escolhe o comprovante.
-- =============================================================================

create or replace function app.tg_documento_liga_tarefa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if new.upload_status <> 'concluido' or old.upload_status = 'concluido' or new.direcao <> 'escritorio'
     or new.categoria_codigo <> 'esc_guia' then
    return null;
  end if;
  select array_agg(t.id) into v_ids
    from public.tarefas t
    join public.obrigacoes o on o.id = t.obrigacao_id
   where t.empresa_id = new.empresa_id and t.competencia = new.competencia and t.etapa = 'pagamento'
     and t.guia_documento_id is null and t.status not in ('concluida', 'dispensada')
     and 'esc_guia' = any (o.categorias_documento);
  if cardinality(v_ids) = 1 then
    update public.tarefas set guia_documento_id = new.id, valor = coalesce(valor, new.valor) where id = v_ids[1];
    insert into public.tarefa_historico (tarefa_id, empresa_id, acao, comentario, detalhes, usuario_id)
    values (v_ids[1], new.empresa_id, 'guia_vinculada', 'Guia publicada no portal ligada automaticamente.', jsonb_build_object('documento', new.id), auth.uid());
  end if;
  return null;
end;
$$;
