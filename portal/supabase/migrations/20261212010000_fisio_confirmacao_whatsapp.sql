-- =============================================================================
-- Clínica de fisioterapia: confirmação do atendimento pelo WhatsApp da clínica
--
-- No dia do atendimento, no horário escolhido pela clínica, o portal manda ao
-- paciente (pelo número oficial da clínica no WhatsApp Business, Cloud API da
-- Meta) o modelo de mensagem aprovado com um link. No link, sem login, o
-- paciente confirma a presença ou avisa que não vai; a agenda mostra a
-- resposta e a recepção é avisada quando alguém desmarca.
--
-- Modo teste (ligado de início): todas as mensagens vão para o número de
-- teste da clínica, não para os pacientes, até a clínica desligar o teste.
-- Fica desconectado até a clínica informar o número, o modelo e o token.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuração (número oficial da clínica, modelo, horário e modo teste)
-- -----------------------------------------------------------------------------
alter table public.fisio_config
  add column whatsapp_ativo boolean not null default false,
  add column whatsapp_phone_number_id text check (whatsapp_phone_number_id is null or whatsapp_phone_number_id ~ '^[0-9]{5,30}$'),
  add column whatsapp_modelo text check (whatsapp_modelo is null or (whatsapp_modelo ~ '^[a-z0-9_]+$' and length(whatsapp_modelo) <= 512)),
  add column whatsapp_idioma text not null default 'pt_BR' check (whatsapp_idioma ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  -- Horário do envio no dia do atendimento (horário de Brasília/Tocantins)
  add column whatsapp_hora_envio time not null default '07:00',
  -- Modo teste: tudo vai para o número de teste, nunca para os pacientes
  add column whatsapp_modo_teste boolean not null default true,
  add column whatsapp_numero_teste text check (whatsapp_numero_teste is null or whatsapp_numero_teste ~ '^[0-9]{10,13}$'),
  add constraint fisio_config_whatsapp check (not whatsapp_ativo or (whatsapp_phone_number_id is not null and whatsapp_modelo is not null)),
  add constraint fisio_config_whatsapp_teste check (not whatsapp_ativo or not whatsapp_modo_teste or whatsapp_numero_teste is not null);

-- Token da clínica na Cloud API (cifrado no servidor; o navegador nunca recebe)
create table public.fisio_whatsapp_segredo (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  token_cifrado text not null check (token_cifrado ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(token_cifrado) <= 4000),
  atualizado_por uuid references public.perfis(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.fisio_whatsapp_segredo enable row level security;
grant select, insert, update, delete on public.fisio_whatsapp_segredo to service_role;

-- -----------------------------------------------------------------------------
-- 2. Confirmação em cada horário da agenda
-- -----------------------------------------------------------------------------
alter table public.fisio_agenda
  -- Código aleatório do link de confirmação (sem login)
  add column confirmacao_codigo text unique check (confirmacao_codigo is null or confirmacao_codigo ~ '^[a-z0-9]{16}$'),
  add column confirmacao_envio text check (confirmacao_envio is null or confirmacao_envio in ('pendente', 'enviado', 'falhou', 'nao_configurado', 'dispensado')),
  -- Para quem foi: o paciente ou o número de teste da clínica
  add column confirmacao_destino text check (confirmacao_destino is null or confirmacao_destino in ('paciente', 'teste')),
  add column confirmacao_enviada_em timestamptz,
  add column confirmacao_erro text check (confirmacao_erro is null or length(confirmacao_erro) <= 300),
  add column confirmacao_resposta text check (confirmacao_resposta is null or confirmacao_resposta in ('confirmou', 'desmarcou')),
  add column confirmacao_respondida_em timestamptz;

-- Remarcou para outro dia: a confirmação recomeça (sai de novo no novo dia)
create or replace function app.tg_fisio_agenda_remarcou()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.inicio at time zone 'America/Araguaina')::date <> (old.inicio at time zone 'America/Araguaina')::date then
    new.confirmacao_envio := null;
    new.confirmacao_destino := null;
    new.confirmacao_enviada_em := null;
    new.confirmacao_erro := null;
    new.confirmacao_resposta := null;
    new.confirmacao_respondida_em := null;
  end if;
  return new;
end;
$$;
create trigger fisio_agenda_remarcou before update of inicio on public.fisio_agenda
  for each row execute function app.tg_fisio_agenda_remarcou();

-- Telefone para a confirmação: o do paciente (se autorizou WhatsApp) ou o do agendamento avulso
create or replace function app.fisio_telefone_confirmacao(p_agenda_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when a.paciente_id is not null then (case when p.aceita_whatsapp and p.ativo then p.telefone end)
              else a.telefone_avulso end
    from public.fisio_agenda a
    left join public.fisio_pacientes p on p.id = a.paciente_id
   where a.id = p_agenda_id;
$$;

-- Programa o envio (quando = horário do envio; antes disso a mensagem espera na fila).
-- Devolve o que aconteceu: programado, ja_enviado, sem_telefone, desligado, fora_do_prazo.
create or replace function app.fisio_programar_confirmacao(p_agenda_id uuid, p_quando timestamptz, p_reenviar boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.fisio_agenda;
  c public.fisio_config;
  v_destino text;
  v_numero text;
  v_envio uuid;
  v_codigo text;
begin
  select * into a from public.fisio_agenda where id = p_agenda_id for update;
  if a.id is null then
    return 'nao_encontrado';
  end if;
  select * into c from public.fisio_config where empresa_id = a.empresa_id;
  if c.empresa_id is null or not c.whatsapp_ativo then
    return 'desligado';
  end if;
  if coalesce((select modalidade from public.gestao_config where empresa_id = a.empresa_id and ativa), '') <> 'fisioterapia' then
    return 'desligado';
  end if;
  if a.status <> 'agendado' or a.inicio <= now() then
    return 'fora_do_prazo';
  end if;
  if a.confirmacao_envio in ('pendente', 'enviado') and not p_reenviar then
    return 'ja_enviado';
  end if;
  if c.whatsapp_modo_teste then
    v_destino := 'teste';
    v_numero := c.whatsapp_numero_teste;
  else
    v_destino := 'paciente';
    v_numero := app.fisio_telefone_confirmacao(a.id);
  end if;
  if v_numero is null then
    update public.fisio_agenda set confirmacao_envio = 'dispensado', confirmacao_erro = 'Sem telefone ou sem autorização para WhatsApp no cadastro do paciente.'
     where id = a.id;
    return 'sem_telefone';
  end if;
  v_codigo := coalesce(a.confirmacao_codigo,
    substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789abcdefghijklmnopqrstuvwxyz0123'), 1, 16));
  insert into public.envios (empresa_id, canal, destinatario, conteudo, tipo, referencia_tipo, referencia_id)
  values (a.empresa_id, 'whatsapp', v_numero, 'Confirmação do atendimento de ' || to_char(a.inicio at time zone 'America/Araguaina', 'DD/MM HH24:MI'),
          'fisio_confirmacao', 'fisio_agenda', a.id::text)
  returning id into v_envio;
  perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), a.empresa_id, 'envio:' || v_envio::text, greatest(coalesce(p_quando, now()), now()), 60);
  update public.fisio_agenda set
    confirmacao_codigo = v_codigo, confirmacao_envio = 'pendente', confirmacao_destino = v_destino,
    confirmacao_erro = null, confirmacao_enviada_em = null
  where id = a.id;
  return 'programado';
end;
$$;

-- Horário do envio de hoje na clínica (como momento)
create or replace function app.fisio_hora_envio_hoje(c public.fisio_config)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (app.hoje() + c.whatsapp_hora_envio) at time zone 'America/Araguaina';
$$;

-- Agendou (ou remarcou) para hoje: programa a confirmação de hoje
create or replace function app.tg_fisio_agenda_confirmacao_hoje()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.fisio_config;
begin
  if new.status = 'agendado' and new.confirmacao_envio is null
     and (new.inicio at time zone 'America/Araguaina')::date = app.hoje() and new.inicio > now() then
    select * into c from public.fisio_config where empresa_id = new.empresa_id;
    if c.empresa_id is not null and c.whatsapp_ativo then
      perform app.fisio_programar_confirmacao(new.id, app.fisio_hora_envio_hoje(c));
    end if;
  end if;
  return null;
end;
$$;
create trigger fisio_agenda_confirmacao_hoje after insert or update of inicio, status on public.fisio_agenda
  for each row execute function app.tg_fisio_agenda_confirmacao_hoje();

-- Rotina diária (servidor): programa as confirmações dos atendimentos de hoje
create or replace function public.rotina_fisio_confirmacoes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.fisio_config;
  a record;
  v_programadas int := 0;
  v_sem_telefone int := 0;
  v_r text;
begin
  for c in
    select f.* from public.fisio_config f
      join public.gestao_config g on g.empresa_id = f.empresa_id and g.ativa and g.modalidade = 'fisioterapia'
     where f.whatsapp_ativo
  loop
    for a in
      select id from public.fisio_agenda
       where empresa_id = c.empresa_id and status = 'agendado' and confirmacao_envio is null
         and (inicio at time zone 'America/Araguaina')::date = app.hoje() and inicio > now()
       order by inicio
    loop
      v_r := app.fisio_programar_confirmacao(a.id, app.fisio_hora_envio_hoje(c));
      if v_r = 'programado' then
        v_programadas := v_programadas + 1;
      elsif v_r = 'sem_telefone' then
        v_sem_telefone := v_sem_telefone + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('programadas', v_programadas, 'sem_telefone', v_sem_telefone);
end;
$$;

-- Envio na hora, pela recepção (atendimento de hoje ou futuro; respeita o modo teste)
create or replace function public.fisio_confirmacao_enviar(p_agenda_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.fisio_agenda;
  v_r text;
begin
  select * into a from public.fisio_agenda where id = p_agenda_id;
  if a.id is null then
    raise exception 'Agendamento não encontrado.';
  end if;
  perform app.exigir_fisio(a.empresa_id, 'gestao.vender');
  if a.confirmacao_envio = 'pendente' then
    raise exception 'A confirmação deste horário já está na fila de envio.';
  end if;
  v_r := app.fisio_programar_confirmacao(a.id, now(), true);
  if v_r = 'desligado' then
    raise exception 'A confirmação pelo WhatsApp está desligada. Configure em Configurações da clínica.';
  elsif v_r = 'fora_do_prazo' then
    raise exception 'Só dá para enviar a confirmação de um horário agendado que ainda não começou.';
  elsif v_r = 'sem_telefone' then
    raise exception 'O paciente não tem celular cadastrado ou não autorizou o WhatsApp.';
  end if;
  return v_r;
end;
$$;

create or replace function public.fisio_configurar_whatsapp(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativo boolean := coalesce((p_dados ->> 'whatsapp_ativo')::boolean, false);
  v_phone text := nullif(regexp_replace(coalesce(p_dados ->> 'whatsapp_phone_number_id', ''), '\D', '', 'g'), '');
  v_modelo text := nullif(lower(trim(coalesce(p_dados ->> 'whatsapp_modelo', ''))), '');
  v_idioma text := coalesce(nullif(trim(coalesce(p_dados ->> 'whatsapp_idioma', '')), ''), 'pt_BR');
  v_teste boolean := coalesce((p_dados ->> 'whatsapp_modo_teste')::boolean, true);
  v_numero text := nullif(regexp_replace(coalesce(p_dados ->> 'whatsapp_numero_teste', ''), '\D', '', 'g'), '');
  v_hora time;
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.gerenciar');
  perform app.fisio_cfg(p_empresa_id);
  begin
    v_hora := coalesce(nullif(p_dados ->> 'whatsapp_hora_envio', '')::time, '07:00');
  exception when others then
    raise exception 'Horário do envio inválido.';
  end;
  if v_phone is not null and v_phone !~ '^[0-9]{5,30}$' then
    raise exception 'O identificador do número (Phone Number ID) tem só números.';
  end if;
  if v_modelo is not null and (v_modelo !~ '^[a-z0-9_]+$' or length(v_modelo) > 512) then
    raise exception 'O nome do modelo aprovado usa só letras minúsculas, números e _ (ex.: confirmacao_atendimento).';
  end if;
  if v_idioma !~ '^[a-z]{2,3}(_[A-Z]{2})?$' then
    raise exception 'Idioma do modelo inválido (ex.: pt_BR).';
  end if;
  if v_numero is not null and v_numero !~ '^[0-9]{10,13}$' then
    raise exception 'Número de teste inválido (celular com DDD).';
  end if;
  if v_ativo and (v_phone is null or v_modelo is null) then
    raise exception 'Para ligar a confirmação, informe o Phone Number ID e o nome do modelo aprovado.';
  end if;
  if v_ativo and v_teste and v_numero is null then
    raise exception 'No modo teste, informe o número de teste (as mensagens vão só para ele).';
  end if;
  update public.fisio_config set
    whatsapp_ativo = v_ativo,
    whatsapp_phone_number_id = v_phone,
    whatsapp_modelo = v_modelo,
    whatsapp_idioma = v_idioma,
    whatsapp_hora_envio = v_hora,
    whatsapp_modo_teste = v_teste,
    whatsapp_numero_teste = v_numero,
    atualizado_por = auth.uid()
  where empresa_id = p_empresa_id;
end;
$$;

-- Resultado do envio (gravado pelo processador de tarefas, no servidor)
create or replace function public.fisio_confirmacao_resultado(p_agenda_id uuid, p_situacao text, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_situacao not in ('enviado', 'falhou', 'nao_configurado', 'dispensado') then
    raise exception 'Situação inválida.';
  end if;
  update public.fisio_agenda set
    confirmacao_envio = p_situacao,
    confirmacao_enviada_em = case when p_situacao = 'enviado' then now() else confirmacao_enviada_em end,
    confirmacao_erro = nullif(left(coalesce(p_erro, ''), 300), '')
  where id = p_agenda_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Página de confirmação pelo paciente (sem login, só com o código do link)
-- Mostra só o primeiro nome, o dia, a hora e os contatos da clínica.
-- -----------------------------------------------------------------------------
create or replace function public.fisio_confirmacao_ver(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paciente', split_part(trim(coalesce(p.nome_social, p.nome, a.nome_avulso)), ' ', 1),
    'inicio', a.inicio,
    'duracao_min', a.duracao_min,
    'status', a.status,
    'resposta', a.confirmacao_resposta,
    'pode_responder', a.status in ('agendado', 'confirmado') and a.inicio > now(),
    'clinica', coalesce(c.nome_clinica, e.nome_fantasia, e.razao_social),
    'telefone', coalesce(c.telefone, e.telefone),
    'endereco', c.endereco
  )
    from public.fisio_agenda a
    join public.empresas e on e.id = a.empresa_id
    left join public.fisio_config c on c.empresa_id = a.empresa_id
    left join public.fisio_pacientes p on p.id = a.paciente_id
   where p_codigo ~ '^[a-z0-9]{16}$'
     and a.confirmacao_codigo = p_codigo
     and a.inicio > now() - interval '2 days';
$$;

create or replace function public.fisio_confirmacao_responder(p_codigo text, p_resposta text, p_motivo text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.fisio_agenda;
  v_nome text;
  v_quando text;
begin
  if p_codigo !~ '^[a-z0-9]{16}$' or p_resposta not in ('confirmou', 'desmarcou') then
    raise exception 'Link inválido.';
  end if;
  select * into a from public.fisio_agenda where confirmacao_codigo = p_codigo for update;
  if a.id is null then
    raise exception 'Link inválido ou vencido.';
  end if;
  if a.status not in ('agendado', 'confirmado') or a.inicio <= now() then
    raise exception 'Este horário não pode mais ser alterado pelo link. Fale com a clínica.';
  end if;
  select split_part(trim(coalesce(p.nome_social, p.nome, a.nome_avulso)), ' ', 1) into v_nome
    from public.fisio_agenda x left join public.fisio_pacientes p on p.id = x.paciente_id where x.id = a.id;
  v_quando := to_char(a.inicio at time zone 'America/Araguaina', 'DD/MM "às" HH24:MI');
  if p_resposta = 'confirmou' then
    update public.fisio_agenda set status = 'confirmado', confirmado_em = coalesce(confirmado_em, now()),
      confirmacao_resposta = 'confirmou', confirmacao_respondida_em = now()
    where id = a.id;
    return 'confirmado';
  end if;
  update public.fisio_agenda set status = 'cancelado',
    motivo = left('Desmarcado pelo paciente no link de confirmação' || coalesce(': ' || nullif(trim(coalesce(p_motivo, '')), ''), ''), 300),
    confirmacao_resposta = 'desmarcou', confirmacao_respondida_em = now()
  where id = a.id;
  -- A recepção fica sabendo (para oferecer o horário a outro paciente)
  perform app.notificar_clientes(a.empresa_id, 'gestao.vender', 'fisio_desmarcou',
    coalesce(v_nome, 'Paciente') || ' desmarcou o horário de ' || v_quando,
    'Desmarcou pelo link de confirmação do WhatsApp' || coalesce('. Motivo: ' || left(nullif(trim(coalesce(p_motivo, '')), ''), 200), '') || '.',
    '/e/' || a.empresa_id::text || '/fisioterapia/agenda', false);
  return 'desmarcado';
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Privilégios
-- -----------------------------------------------------------------------------
revoke execute on function app.fisio_telefone_confirmacao(uuid), app.fisio_programar_confirmacao(uuid, timestamptz, boolean),
  app.fisio_hora_envio_hoje(public.fisio_config), app.tg_fisio_agenda_confirmacao_hoje(), app.tg_fisio_agenda_remarcou()
  from public, anon, authenticated;
revoke execute on function public.fisio_confirmacao_enviar(uuid), public.fisio_configurar_whatsapp(uuid, jsonb) from public, anon;
grant execute on function public.fisio_confirmacao_enviar(uuid), public.fisio_configurar_whatsapp(uuid, jsonb) to authenticated;
-- Só o servidor: rotina diária e resultado do envio
revoke execute on function public.rotina_fisio_confirmacoes(), public.fisio_confirmacao_resultado(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rotina_fisio_confirmacoes(), public.fisio_confirmacao_resultado(uuid, text, text) to service_role;
-- Página do paciente: pública (só com o código aleatório do link)
revoke execute on function public.fisio_confirmacao_ver(text), public.fisio_confirmacao_responder(text, text, text) from public;
grant execute on function public.fisio_confirmacao_ver(text), public.fisio_confirmacao_responder(text, text, text) to anon, authenticated;
