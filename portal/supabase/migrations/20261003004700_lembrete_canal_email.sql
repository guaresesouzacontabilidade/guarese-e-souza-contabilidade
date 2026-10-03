-- =============================================================================
-- Lembretes: o canal "e-mail" derrubava a rotina diária
--
-- app.enviar_lembrete acrescentava o canal com `v_canais || 'email'`. Com o
-- texto sem tipo, o PostgreSQL trata 'email' como uma lista e recusa
-- ("malformed array literal: \"email\""). Isso acontecia sempre que o envio
-- por e-mail estava ligado e havia um lembrete a mandar: o botão de lembrete
-- falhava e a rotina diária parava inteira (sem gerar as tarefas das
-- obrigações, os avisos de vencimento e as demais rotinas do dia).
-- Correção: array_append (mesmo resultado, sem ambiguidade de tipo).
-- =============================================================================
CREATE OR REPLACE FUNCTION app.enviar_lembrete(p_empresa_id uuid, p_competencia date, p_itens uuid[], p_regra text, p_tipo text, p_mensagem text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_esc public.escritorio;
  v_emp public.empresas;
  v_lista text;
  v_titulo text;
  v_corpo text;
  v_id uuid;
  v_n int;
  v_canais text[] := array['sistema'];
  v_atrasados int;
  r record;
  v_envio uuid;
begin
  select * into v_esc from public.escritorio where id = 1;
  select * into v_emp from public.empresas where id = p_empresa_id;
  if cardinality(coalesce(p_itens, array[]::uuid[])) = 0 then
    return null;
  end if;

  select string_agg('• ' || i.titulo || ' — prazo ' || to_char(i.prazo, 'DD/MM/YYYY')
                    || case when i.status = 'correcao' then ' (precisa de correção)' when i.prazo < app.hoje() then ' (atrasado)' else '' end,
                    E'\n' order by i.prazo, i.titulo),
         count(*) filter (where i.prazo < app.hoje())
    into v_lista, v_atrasados
    from public.checklist_itens i
   where i.id = any(p_itens);

  v_titulo := case when v_atrasados > 0
                   then 'Documentos em atraso — ' || coalesce(v_emp.nome_fantasia, v_emp.razao_social)
                   else 'Lembrete de documentos — ' || coalesce(v_emp.nome_fantasia, v_emp.razao_social) end;
  v_corpo := coalesce(nullif(trim(coalesce(p_mensagem, '')), '') || E'\n\n', '')
          || 'Pendências da competência ' || to_char(p_competencia, 'MM/YYYY') || E':\n' || v_lista;

  if v_esc.lembretes_email_ativo then
    v_canais := array_append(v_canais, 'email');
  end if;

  insert into public.lembretes (empresa_id, competencia, tipo, regra, itens, mensagem, canais)
  values (p_empresa_id, p_competencia, p_tipo, p_regra, p_itens, v_corpo, v_canais)
  on conflict (empresa_id, data_referencia, regra, tipo) do nothing
  returning id into v_id;
  if v_id is null then
    return null;   -- lembrete automático desta regra já enviado hoje
  end if;

  v_n := app.notificar_clientes(
    p_empresa_id, 'documentos.enviar', 'lembrete', v_titulo, v_corpo,
    '/e/' || p_empresa_id::text || '/pendencias?competencia=' || to_char(p_competencia, 'YYYY-MM'),
    v_esc.lembretes_email_ativo
  );

  -- WhatsApp (API oficial): somente quando habilitado e configurado.
  if v_esc.lembretes_whatsapp_ativo and coalesce(v_esc.whatsapp_phone_number_id, '') <> '' then
    for r in
      select c.whatsapp from public.empresa_contatos c
       where c.empresa_id = p_empresa_id and c.recebe_lembretes and coalesce(c.whatsapp, '') <> ''
    loop
      insert into public.envios (empresa_id, canal, destinatario, assunto, conteudo, tipo, referencia_tipo, referencia_id)
      values (p_empresa_id, 'whatsapp', r.whatsapp, v_titulo, v_corpo, 'lembrete', 'lembrete', v_id::text)
      returning id into v_envio;
      perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), p_empresa_id, 'envio:' || v_envio::text, now(), 60);
      v_n := v_n + 1;
    end loop;
    update public.lembretes set canais = array_append(canais, 'whatsapp') where id = v_id;
  end if;

  update public.lembretes set destinatarios = v_n where id = v_id;
  return v_id;
end;
$function$;
