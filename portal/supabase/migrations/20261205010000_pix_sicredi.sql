-- =============================================================================
-- Pix com confirmação automática pelo banco do escritório (API Pix do Sicredi)
--
--  * Desligada até o administrador cadastrar as credenciais do Sicredi
--    (Client ID, Client Secret, certificado e chave privada), testar a
--    conexão e ligar. Nada é simulado: sem a ligação, vale o Pix comum.
--  * As credenciais ficam cifradas numa tabela sem acesso pelo navegador.
--  * Ao enviar a cobrança, o servidor cria a cobrança com vencimento no
--    banco (multa e juros calculados pelo banco na hora do pagamento).
--  * O banco avisa o pagamento (webhook) e o portal também confere a cada
--    15 minutos; com o pagamento confirmado na consulta ao banco, a baixa,
--    o lançamento na DRE e o recibo saem sozinhos.
-- =============================================================================

alter table public.honorarios_config
  add column banco_pix text check (banco_pix is null or banco_pix in ('sicredi')),
  add column banco_ambiente text not null default 'producao' check (banco_ambiente in ('producao', 'homologacao')),
  add column banco_url_token text check (banco_url_token is null or banco_url_token ~ '^https://'),
  add column banco_url_api text check (banco_url_api is null or banco_url_api ~ '^https://'),
  add column banco_ativo boolean not null default false,
  add column banco_cadastrado_em timestamptz,
  add column banco_certificado_validade timestamptz,
  add column banco_testado_em timestamptz,
  add column banco_teste_ok boolean,
  add column banco_teste_erro text,
  add column banco_webhook_em timestamptz,
  add column banco_webhook_segredo text check (banco_webhook_segredo is null or banco_webhook_segredo ~ '^[0-9a-f]{40}$'),
  add column banco_conferido_em timestamptz;

-- Credenciais cifradas (só o servidor lê e grava)
create table public.honorarios_banco_segredo (
  id smallint primary key default 1 check (id = 1),
  conteudo_cifrado text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.honorarios_banco_segredo enable row level security;
revoke all on public.honorarios_banco_segredo from anon, authenticated;

alter table public.honorarios_cobrancas
  add column banco_txid text unique check (banco_txid is null or banco_txid ~ '^[A-Za-z0-9]{26,35}$'),
  add column banco_pix text,
  add column banco_situacao text check (banco_situacao is null or banco_situacao in ('criando', 'ativa', 'concluida', 'removida', 'erro')),
  add column banco_erro text,
  add column banco_e2e text,
  add column banco_atualizado_em timestamptz;

-- Liga ou desliga (só depois de um teste com sucesso) e troca o ambiente
create or replace function public.honorarios_banco_configurar(p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.honorarios_config;
begin
  if not app.is_admin() then
    raise exception 'Só o administrador configura a ligação com o banco.' using errcode = '42501';
  end if;
  select * into v_cfg from public.honorarios_config where id = 1;
  if coalesce((p_dados ->> 'banco_ativo')::boolean, false) and not coalesce(v_cfg.banco_teste_ok, false) then
    raise exception 'Teste a conexão com o banco antes de ligar.' using errcode = 'P0001';
  end if;
  if coalesce((p_dados ->> 'banco_ativo')::boolean, false) and v_cfg.pix_chave is null then
    raise exception 'Cadastre a chave Pix do escritório antes de ligar.' using errcode = 'P0001';
  end if;
  update public.honorarios_config set
    banco_ativo = coalesce((p_dados ->> 'banco_ativo')::boolean, banco_ativo),
    updated_by = auth.uid()
  where id = 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções do servidor (chave de serviço)
-- -----------------------------------------------------------------------------
-- Credenciais novas: guarda cifradas e volta a exigir o teste
create or replace function public.honorarios_banco_guardar(p_conteudo text, p_ambiente text, p_url_token text, p_url_api text, p_validade timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.honorarios_banco_segredo (id, conteudo_cifrado) values (1, p_conteudo)
  on conflict (id) do update set conteudo_cifrado = excluded.conteudo_cifrado, atualizado_em = now();
  update public.honorarios_config set
    banco_pix = 'sicredi', banco_ambiente = p_ambiente,
    banco_url_token = nullif(p_url_token, ''), banco_url_api = nullif(p_url_api, ''),
    banco_cadastrado_em = now(), banco_certificado_validade = p_validade,
    banco_ativo = false, banco_teste_ok = null, banco_teste_erro = null, banco_testado_em = null,
    banco_webhook_em = null,
    banco_webhook_segredo = coalesce(banco_webhook_segredo, encode(extensions.gen_random_bytes(20), 'hex'))
  where id = 1;
end;
$$;

create or replace function public.honorarios_banco_remover()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.honorarios_banco_segredo where id = 1;
  update public.honorarios_config set banco_pix = null, banco_ativo = false, banco_teste_ok = null, banco_teste_erro = null,
    banco_testado_em = null, banco_cadastrado_em = null, banco_certificado_validade = null, banco_webhook_em = null
  where id = 1;
end;
$$;

create or replace function public.honorarios_banco_resultado_teste(p_ok boolean, p_erro text, p_webhook boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.honorarios_config set
    banco_testado_em = now(), banco_teste_ok = p_ok, banco_teste_erro = left(p_erro, 500),
    banco_webhook_em = case when p_webhook then now() else banco_webhook_em end,
    banco_ativo = case when p_ok then banco_ativo else false end
  where id = 1;
end;
$$;

create or replace function public.honorarios_banco_registrar_cobranca(p_id uuid, p_txid text, p_pix text, p_situacao text, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.honorarios_cobrancas set
    banco_txid = coalesce(p_txid, banco_txid), banco_pix = case when p_situacao = 'removida' then null else coalesce(p_pix, banco_pix) end,
    banco_situacao = p_situacao, banco_erro = left(p_erro, 500), banco_atualizado_em = now()
  where id = p_id;
end;
$$;

-- Baixa pela confirmação do banco (sem usuário): mesmas regras da baixa da tela
create or replace function public.honorarios_banco_baixar(p_id uuid, p_valor numeric, p_data date, p_e2e text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_cobrancas;
  v_encargos numeric;
  v_desconto numeric := 0;
  v_multa numeric := 0;
  v_juros numeric := 0;
  v_calc record;
  v_item record;
  v_comp date;
begin
  select * into v_c from public.honorarios_cobrancas where id = p_id for update;
  if v_c.id is null or v_c.situacao <> 'aberta' then
    return jsonb_build_object('ignorada', true);
  end if;
  v_encargos := p_valor - v_c.valor;
  if v_encargos < 0 then
    v_desconto := -v_encargos;
    v_encargos := 0;
  end if;
  if v_encargos > 0 then
    select * into v_calc from app.honorarios_encargos(v_c.valor, v_c.vencimento, p_data, v_c.multa_percentual, v_c.juros_mes_percentual);
    v_multa := least(v_encargos, coalesce(v_calc.multa, 0));
    v_juros := v_encargos - v_multa;
  end if;
  update public.honorarios_cobrancas set
    situacao = 'paga', pago_em = p_data, valor_pago = p_valor, multa = v_multa, juros = v_juros, desconto = v_desconto,
    forma_pagamento = 'pix', baixa_observacao = left('Confirmado pelo banco (Sicredi) — E2E ' || coalesce(p_e2e, '—'), 300),
    baixada_em = now(), banco_situacao = 'concluida', banco_e2e = p_e2e, banco_atualizado_em = now()
  where id = p_id;

  v_comp := coalesce(v_c.competencia, date_trunc('month', p_data)::date);
  for v_item in select i.* from public.honorarios_cobranca_itens i where i.cobranca_id = p_id order by i.ordem loop
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, cobranca_id, origem, forma_pagamento)
    values ('receita', p_data, v_comp, left(v_item.descricao || ' — ' || v_c.pagador_nome, 300), v_item.valor, v_item.categoria_id, v_c.empresa_id, p_id, 'cobranca', 'pix');
  end loop;
  if v_desconto > 0 then
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, cobranca_id, origem, forma_pagamento)
    values ('despesa', p_data, v_comp, left('Desconto concedido — ' || v_c.descricao || ' — ' || v_c.pagador_nome, 300), v_desconto,
            (select id from public.escritorio_categorias where chave = 'DESCONTO'), v_c.empresa_id, p_id, 'cobranca', 'pix');
  end if;
  if v_encargos > 0 then
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, cobranca_id, origem, forma_pagamento)
    values ('receita', p_data, date_trunc('month', p_data)::date,
            left(format('Juros e multa por atraso (%s dias) — %s — %s', p_data - v_c.vencimento, v_c.descricao, v_c.pagador_nome), 300),
            v_encargos, (select id from public.escritorio_categorias where chave = 'JUROS_MULTA'), v_c.empresa_id, p_id, 'cobranca', 'pix');
  end if;
  update public.envios e set status = 'desativado', erro = 'Cobrança paga.'
    from public.honorarios_lembretes l
   where l.cobranca_id = p_id and l.envio_id = e.id and e.status = 'pendente';
  perform app.honorarios_avisar_cliente(p_id, 'Pagamento recebido: ' || v_c.descricao,
    format('Recebemos %s em %s. Obrigado!', app.moeda_br(p_valor), to_char(p_data, 'DD/MM/YYYY')));
  return jsonb_build_object('multa', v_multa, 'juros', v_juros, 'desconto', v_desconto, 'empresa_id', v_c.empresa_id);
end;
$$;

-- Recibo emitido pelo servidor (baixa automática): o recibo é do escritório
create or replace function public.honorarios_banco_vincular_recibo(p_id uuid, p_recibo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.honorarios_cobrancas set recibo_id = p_recibo_id where id = p_id and situacao = 'paga';
  perform app.honorarios_agendar(p_id, 'pagamento', null, now());
end;
$$;

-- Emissão e assinatura do recibo também pela chave de serviço (baixa automática)
create or replace function app.e_servico()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

do $$
declare
  v_def text;
begin
  -- recibo_emitir e recibo_registrar_assinatura: aceitam a equipe ou o servidor
  select pg_get_functiondef('public.recibo_emitir(jsonb)'::regprocedure) into v_def;
  v_def := replace(v_def, 'if not app.is_equipe() then', 'if not (app.is_equipe() or app.e_servico()) then');
  execute v_def;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recibo_registrar_assinatura';
  v_def := replace(v_def, 'if not app.is_equipe() then', 'if not (app.is_equipe() or app.e_servico()) then');
  execute v_def;
end;
$$;

-- Aprovar: com a ligação ativa, o servidor cria a cobrança no banco antes do e-mail
create or replace function app.honorarios_banco_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select banco_ativo from public.honorarios_config where id = 1), false);
$$;

create or replace function app.tg_honorarios_banco()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.honorarios_banco_ativo() then
    return new;
  end if;
  -- Enviada (aprovada): cria no banco
  if old.situacao = 'rascunho' and new.situacao = 'aberta' then
    perform app.enfileirar('pix_banco', jsonb_build_object('acao', 'criar', 'cobranca_id', new.id), new.empresa_id, 'pix_banco:criar:' || new.id, now(), 40);
  -- Cancelada, ou paga por fora do banco: tira do banco
  elsif new.banco_txid is not null and old.situacao = 'aberta' and new.situacao in ('cancelada', 'paga') and coalesce(new.banco_situacao, '') <> 'concluida' then
    perform app.enfileirar('pix_banco', jsonb_build_object('acao', 'remover', 'cobranca_id', new.id, 'txid', new.banco_txid), new.empresa_id,
                           'pix_banco:remover:' || new.banco_txid, now(), 40);
  -- Valor ou vencimento mudou com a cobrança em aberto: troca no banco
  elsif new.situacao = 'aberta' and old.situacao = 'aberta' and new.banco_txid is not null
        and (new.valor <> old.valor or new.vencimento <> old.vencimento) then
    perform app.enfileirar('pix_banco', jsonb_build_object('acao', 'trocar', 'cobranca_id', new.id, 'txid', new.banco_txid), new.empresa_id,
                           'pix_banco:trocar:' || new.banco_txid, now(), 40);
  end if;
  return new;
end;
$$;
create trigger honorarios_cobrancas_banco after update on public.honorarios_cobrancas
  for each row execute function app.tg_honorarios_banco();

revoke execute on function public.honorarios_banco_configurar(jsonb) from public, anon;
grant execute on function public.honorarios_banco_configurar(jsonb) to authenticated;
revoke execute on function public.honorarios_banco_guardar(text, text, text, text, timestamptz), public.honorarios_banco_remover(),
  public.honorarios_banco_resultado_teste(boolean, text, boolean), public.honorarios_banco_registrar_cobranca(uuid, text, text, text, text),
  public.honorarios_banco_baixar(uuid, numeric, date, text), public.honorarios_banco_vincular_recibo(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.honorarios_banco_guardar(text, text, text, text, timestamptz), public.honorarios_banco_remover(),
  public.honorarios_banco_resultado_teste(boolean, text, boolean), public.honorarios_banco_registrar_cobranca(uuid, text, text, text, text),
  public.honorarios_banco_baixar(uuid, numeric, date, text), public.honorarios_banco_vincular_recibo(uuid, uuid)
to service_role;
