-- =============================================================================
-- Ordens de serviço: melhorias
--  1. Recebimento da OS pelo caixa da Loja (sinal na abertura, restante na
--     retirada ou "a receber"), com lançamento e baixa no Financeiro e o
--     dinheiro contado na gaveta do caixa.
--  2. Aviso automático por WhatsApp quando a OS fica pronta (número oficial da
--     própria loja na Cloud API da Meta). Desligado até a loja configurar.
--  3. Fotos da OS (material recebido, serviço pronto) em armazenamento privado.
--  4. Entrega com o nome, o documento e a assinatura de quem retira; a loja
--     pode exigir a assinatura e o pagamento antes da entrega.
--  5. Fila por setor ou máquina: cada setor tem quantas máquinas trabalham ao
--     mesmo tempo e a previsão espera a máquina mais ocupada que a OS usa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Setores e máquinas
-- -----------------------------------------------------------------------------
create or replace function app.os_setor_chave(p_setor text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(trim(coalesce(p_setor, '')));
$$;

create table public.os_setores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 60),
  -- Quantas máquinas (ou pessoas) desse setor trabalham ao mesmo tempo
  maquinas smallint not null default 1 check (maquinas between 1 and 50),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_setores_empresa_id_unico unique (empresa_id, id)
);
create unique index os_setores_nome_uk on public.os_setores (empresa_id, (app.os_setor_chave(nome)));
create trigger os_setores_updated_at before update on public.os_setores for each row execute function app.tg_updated_at();
create trigger auditoria_os_setores after insert or update or delete on public.os_setores for each row execute function app.tg_auditoria();

-- Os setores já escritos nos serviços viram setores (com a capacidade geral da equipe)
insert into public.os_setores (empresa_id, nome, maquinas)
select distinct on (s.empresa_id, app.os_setor_chave(s.setor)) s.empresa_id, trim(s.setor), coalesce(c.executores_simultaneos, 1)
  from public.os_servicos s
  left join public.os_config c on c.empresa_id = s.empresa_id
 where length(trim(coalesce(s.setor, ''))) >= 2
on conflict do nothing;

-- Serviço com setor novo: o setor é cadastrado com 1 máquina (ajustável)
create or replace function app.tg_os_servico_setor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(new.setor, ''))) >= 2 then
    insert into public.os_setores (empresa_id, nome) values (new.empresa_id, trim(new.setor))
    on conflict (empresa_id, (app.os_setor_chave(nome))) do nothing;
  end if;
  return new;
end;
$$;
create trigger os_servicos_setor after insert or update of setor on public.os_servicos
  for each row execute function app.tg_os_servico_setor();

-- Capacidade de um setor ('' = sem setor: a capacidade geral da equipe)
create or replace function app.os_capacidade(p_empresa_id uuid, p_chave text, p_padrao smallint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(
    case when coalesce(p_chave, '') = '' then null
         else (select s.maquinas from public.os_setores s
                where s.empresa_id = p_empresa_id and s.ativo and app.os_setor_chave(s.nome) = p_chave) end,
    p_padrao, 1), 1)::numeric;
$$;

-- Trabalho na frente, por setor (minutos): a fila inteira e o que falta das OS
-- em execução, respeitando a prioridade (a urgente passa na frente)
create or replace function app.os_carga_setores(p_empresa_id uuid, p_prioridade text, p_ignorar uuid)
returns table (setor text, minutos numeric, ordens bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select o.id,
           case when o.etapa = 'fila' then 1::numeric
                when o.minutos_estimados > 0 then greatest(o.minutos_estimados - o.minutos_execucao
                       - case when o.execucao_desde is not null then extract(epoch from now() - o.execucao_desde) / 60 else 0 end, 0)
                     / o.minutos_estimados
                else 0::numeric end as fator
      from public.os_ordens o
     where o.empresa_id = p_empresa_id
       and o.etapa in ('fila', 'execucao')
       and (p_ignorar is null or o.id <> p_ignorar)
       and (o.etapa = 'execucao'
            or coalesce(p_prioridade, 'normal') = 'normal'
            or (p_prioridade = 'alta' and o.prioridade in ('alta', 'urgente'))
            or (p_prioridade = 'urgente' and o.prioridade = 'urgente'))
  )
  select app.os_setor_chave(s.setor), sum(i.minutos_estimados * o.fator), count(distinct o.id)
    from o
    join public.os_itens i on i.ordem_id = o.id
    left join public.os_servicos s on s.id = i.servico_id
   group by 1;
$$;

-- Minutos de uma OS em cada setor: { "seccionadora": 24, "": 10 }
create or replace function app.os_minutos_setores(p_ordem_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(chave, minutos), '{}'::jsonb)
    from (
      select app.os_setor_chave(s.setor) as chave, sum(i.minutos_estimados) as minutos
        from public.os_itens i
        left join public.os_servicos s on s.id = i.servico_id
       where i.ordem_id = p_ordem_id
       group by 1
    ) t;
$$;

-- Previsão: espera a máquina mais ocupada entre as que a OS usa (fila do setor
-- dividida pelas máquinas dele) e soma o tempo dos serviços da própria OS
create or replace function app.os_previsao_por_setor(p_empresa_id uuid, p_minutos jsonb, p_prioridade text, p_ignorar uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.os_config := app.os_cfg(p_empresa_id);
  v_chaves text[];
  v_proprio numeric;
  v_espera numeric;
begin
  select coalesce(array_agg(key), '{}'), coalesce(sum(greatest(value::numeric, 0)), 0)
    into v_chaves, v_proprio
    from jsonb_each_text(coalesce(p_minutos, '{}'::jsonb))
   where value ~ '^[0-9]+(\.[0-9]+)?$' and value::numeric > 0;
  if cardinality(v_chaves) = 0 then
    v_chaves := array[''];
  end if;
  select coalesce(max(cs.minutos / app.os_capacidade(p_empresa_id, cs.setor, c.executores_simultaneos)), 0)
    into v_espera
    from app.os_carga_setores(p_empresa_id, coalesce(p_prioridade, 'normal'), p_ignorar) cs
   where cs.setor = any(v_chaves);
  return app.os_somar_minutos_uteis(now(), v_espera + v_proprio, c.hora_inicio, c.hora_fim, c.dias_semana);
end;
$$;

-- Previsão para a tela de abertura, pelos serviços escolhidos (antes de salvar)
-- p_itens: [{ servico_id?, quantidade, minutos? (avulso) }]
create or replace function public.os_previsao_itens(p_empresa_id uuid, p_itens jsonb, p_prioridade text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  i jsonb;
  s public.os_servicos;
  v_q numeric;
  v_min numeric;
  v_chave text;
  v_mapa jsonb := '{}'::jsonb;
begin
  perform app.os_exigir(p_empresa_id, 'os.operar');
  if coalesce(p_prioridade, 'normal') not in ('normal', 'alta', 'urgente') then
    raise exception 'Prioridade inválida.';
  end if;
  if jsonb_typeof(p_itens) = 'array' then
    for i in select * from jsonb_array_elements(p_itens) limit 60 loop
      v_q := least(greatest(coalesce(nullif(replace(i ->> 'quantidade', ',', '.'), '')::numeric, 0), 0), 1000000);
      if nullif(i ->> 'servico_id', '') is not null then
        select * into s from public.os_servicos where id = (i ->> 'servico_id')::uuid and empresa_id = p_empresa_id;
        continue when s.id is null;
        v_min := s.minutos_fixos + s.minutos_por_unidade * v_q;
        v_chave := app.os_setor_chave(s.setor);
      else
        v_min := least(greatest(coalesce(nullif(replace(i ->> 'minutos', ',', '.'), '')::numeric, 0), 0), 1000000);
        v_chave := '';
      end if;
      v_mapa := v_mapa || jsonb_build_object(v_chave, coalesce((v_mapa ->> v_chave)::numeric, 0) + v_min);
    end loop;
  end if;
  return app.os_previsao_por_setor(p_empresa_id, v_mapa, p_prioridade, null);
end;
$$;

-- Fila de cada setor agora (para a esteira): minutos na frente e máquinas
create or replace function public.os_fila_setores(p_empresa_id uuid)
returns table (setor text, maquinas numeric, minutos numeric, ordens bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.os_config;
begin
  perform app.os_exigir(p_empresa_id, 'os.operar');
  select * into c from public.os_config where empresa_id = p_empresa_id;
  return query
    select coalesce((select st.nome from public.os_setores st where st.empresa_id = p_empresa_id and app.os_setor_chave(st.nome) = cs.setor), ''),
           app.os_capacidade(p_empresa_id, cs.setor, coalesce(c.executores_simultaneos, 1::smallint)),
           round(cs.minutos, 1),
           cs.ordens
      from app.os_carga_setores(p_empresa_id, 'normal', null) cs
     where cs.minutos > 0
     order by cs.minutos desc;
end;
$$;

create or replace function public.os_setor_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := nullif(left(trim(coalesce(p_dados ->> 'nome', '')), 60), '');
  v_maquinas smallint;
  v_atual public.os_setores;
  v_id uuid;
begin
  perform app.os_exigir(p_empresa_id, 'os.gerenciar');
  if v_nome is null or length(v_nome) < 2 then
    raise exception 'Informe o nome do setor ou da máquina.';
  end if;
  begin
    v_maquinas := coalesce(nullif(p_dados ->> 'maquinas', '')::smallint, 1);
  exception when others then
    v_maquinas := null;
  end;
  if v_maquinas is null or v_maquinas < 1 or v_maquinas > 50 then
    raise exception 'Informe de 1 a 50 máquinas trabalhando ao mesmo tempo.';
  end if;
  if p_id is not null then
    select * into v_atual from public.os_setores where id = p_id and empresa_id = p_empresa_id for update;
    if v_atual.id is null then
      raise exception 'Setor não encontrado.';
    end if;
    update public.os_setores set nome = v_nome, maquinas = v_maquinas, ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo)
     where id = p_id returning id into v_id;
    -- Renomeou: os serviços do setor acompanham
    if app.os_setor_chave(v_atual.nome) <> app.os_setor_chave(v_nome) or v_atual.nome <> v_nome then
      update public.os_servicos set setor = v_nome
       where empresa_id = p_empresa_id and app.os_setor_chave(setor) = app.os_setor_chave(v_atual.nome);
    end if;
  else
    insert into public.os_setores (empresa_id, nome, maquinas, ativo)
    values (p_empresa_id, v_nome, v_maquinas, coalesce((p_dados ->> 'ativo')::boolean, true))
    returning id into v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um setor com este nome.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Novos dados da OS e da configuração
-- -----------------------------------------------------------------------------
alter table public.os_config
  -- Aviso automático por WhatsApp (Cloud API oficial da Meta, número da própria loja)
  add column whatsapp_ativo boolean not null default false,
  add column whatsapp_phone_number_id text check (whatsapp_phone_number_id is null or whatsapp_phone_number_id ~ '^[0-9]{5,30}$'),
  add column whatsapp_modelo text check (whatsapp_modelo is null or (whatsapp_modelo ~ '^[a-z0-9_]+$' and length(whatsapp_modelo) <= 512)),
  add column whatsapp_idioma text not null default 'pt_BR' check (whatsapp_idioma ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  -- Regras da entrega
  add column exigir_assinatura boolean not null default false,
  add column exigir_pagamento_entrega boolean not null default false,
  add constraint os_config_whatsapp check (not whatsapp_ativo or (whatsapp_phone_number_id is not null and whatsapp_modelo is not null));

-- Token próprio da loja na Cloud API (cifrado no servidor; o navegador nunca recebe)
create table public.os_whatsapp_segredo (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  token_cifrado text not null check (token_cifrado ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(token_cifrado) <= 4000),
  atualizado_por uuid references public.perfis(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.os_whatsapp_segredo enable row level security;
grant select, insert, update, delete on public.os_whatsapp_segredo to service_role;

alter table public.os_ordens
  add column valor_recebido numeric(12, 2) not null default 0 check (valor_recebido >= 0),
  add column valor_a_receber numeric(12, 2) not null default 0 check (valor_a_receber >= 0),
  add column avisar_whatsapp boolean not null default true,
  add column aviso_whatsapp text check (aviso_whatsapp is null or aviso_whatsapp in ('pendente', 'enviado', 'falhou', 'nao_configurado', 'dispensado')),
  add column aviso_whatsapp_em timestamptz,
  add column aviso_whatsapp_erro text check (aviso_whatsapp_erro is null or length(aviso_whatsapp_erro) <= 300),
  add column retirado_documento text check (retirado_documento is null or length(retirado_documento) <= 30),
  add column assinatura_caminho text check (assinatura_caminho is null or assinatura_caminho like empresa_id::text || '/' || id::text || '/assinatura-%.png'),
  add constraint os_ordens_pagos check (valor_recebido + valor_a_receber <= valor_total);

-- Alterar a OS não pode deixar o total menor que o já recebido
create or replace function app.tg_os_total_recebido()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.valor_total < new.valor_recebido + new.valor_a_receber then
    raise exception 'O total da OS (R$ %) ficou menor que o já recebido (R$ %). Estorne um recebimento antes de diminuir o valor.',
      to_char(new.valor_total, 'FM999G999G990D00'), to_char(new.valor_recebido + new.valor_a_receber, 'FM999G999G990D00');
  end if;
  return new;
end;
$$;
create trigger os_ordens_total_recebido before update of valor_total on public.os_ordens
  for each row execute function app.tg_os_total_recebido();

alter table public.os_eventos drop constraint os_eventos_tipo_check;
alter table public.os_eventos add constraint os_eventos_tipo_check check (tipo in (
  'criada', 'editada', 'etapa', 'pausa', 'retomada', 'responsavel', 'cancelada', 'pagamento', 'estorno', 'foto', 'aviso'
));

-- -----------------------------------------------------------------------------
-- 3. Recebimentos da OS (caixa da Loja + Financeiro)
-- -----------------------------------------------------------------------------
alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha', 'cartao', 'venda', 'hotel',
  'veterinaria', 'fisioterapia', 'os'
));
alter table public.baixas drop constraint baixas_origem_check;
alter table public.baixas add constraint baixas_origem_check check (origem in (
  'manual', 'conciliacao', 'importacao', 'maquininha', 'cartao', 'venda', 'hotel', 'veterinaria', 'fisioterapia', 'os'
));

create table public.os_pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  ordem_id uuid not null,
  forma text not null check (forma in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'a_receber', 'outro')),
  valor numeric(12, 2) not null check (valor > 0),
  -- A receber: vencimento combinado com o cliente
  vencimento date,
  -- Recebido antes de a OS ficar pronta (sinal / entrada)
  sinal boolean not null default false,
  sessao_id uuid,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  observacao text check (observacao is null or length(observacao) <= 300),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  cancelado_por uuid references public.perfis(id) on delete set null,
  registrado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint os_pagamentos_a_receber check ((forma = 'a_receber') = (vencimento is not null)),
  constraint os_pagamentos_caixa check (forma = 'a_receber' or sessao_id is not null),
  foreign key (empresa_id, ordem_id) references public.os_ordens (empresa_id, id) on delete cascade,
  foreign key (empresa_id, sessao_id) references public.caixa_sessoes (empresa_id, id)
);
create index os_pagamentos_ordem_idx on public.os_pagamentos (ordem_id, created_at);
create index os_pagamentos_sessao_idx on public.os_pagamentos (sessao_id) where sessao_id is not null;
create trigger auditoria_os_pagamentos after insert or update or delete on public.os_pagamentos for each row execute function app.tg_auditoria();

create or replace function app.os_rotulo_forma(p_forma text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_forma
    when 'dinheiro' then 'dinheiro' when 'pix' then 'PIX' when 'cartao_debito' then 'cartão de débito'
    when 'cartao_credito' then 'cartão de crédito' when 'transferencia' then 'transferência'
    when 'a_receber' then 'a receber' else 'outra forma' end;
$$;

-- Recebe (ou deixa a receber) parte ou todo o valor da OS. Na hora, entra no
-- caixa aberto de quem recebe; a receber vira conta a receber no Financeiro.
create or replace function public.os_pagamento_registrar(p_ordem_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  v_cfg public.gestao_config;
  v_forma text := p_dados ->> 'forma';
  v_valor numeric;
  v_venc date := nullif(p_dados ->> 'vencimento', '')::date;
  v_hoje date := app.hoje();
  v_saldo numeric;
  v_sessao uuid;
  v_cat uuid;
  v_conta uuid;
  v_lanc uuid;
  v_id uuid;
  v_desc text;
begin
  select * into o from public.os_ordens where id = p_ordem_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  perform app.exigir_gestao(o.empresa_id, 'gestao.vender');
  if o.etapa = 'cancelada' then
    raise exception 'OS cancelada não recebe pagamento.';
  end if;
  if v_forma is null or v_forma not in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'a_receber', 'outro') then
    raise exception 'Escolha a forma de pagamento.';
  end if;
  begin
    v_valor := nullif(replace(p_dados ->> 'valor', ',', '.'), '')::numeric;
  exception when others then
    v_valor := null;
  end;
  if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Informe o valor.';
  end if;
  v_saldo := o.valor_total - o.valor_recebido - o.valor_a_receber;
  if v_saldo <= 0 then
    raise exception 'Esta OS já está paga.';
  end if;
  if v_valor > v_saldo then
    raise exception 'O valor passa do que falta receber (R$ %).', to_char(v_saldo, 'FM999G999G990D00');
  end if;

  select * into v_cfg from public.gestao_config where empresa_id = o.empresa_id;
  v_cat := app.categoria_sistema(o.empresa_id, 'SERVICOS');
  if v_cat is null then
    perform app.criar_plano_contas_padrao(o.empresa_id);
    v_cat := app.categoria_sistema(o.empresa_id, 'SERVICOS');
  end if;
  v_desc := 'OS nº ' || o.numero || ' — ' || o.cliente_nome;

  if v_forma = 'a_receber' then
    if v_venc is null or v_venc < v_hoje then
      raise exception 'Informe o vencimento combinado (hoje ou depois).';
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto, origem, origem_referencia, numero_documento
    ) values (
      o.empresa_id, 'receber', left(v_desc || ' (a receber)', 300), v_cat, v_hoje, v_venc, v_valor, 'os', o.id::text, 'OS ' || o.numero
    ) returning id into v_lanc;
  else
    v_venc := null;
    select id into v_sessao from public.caixa_sessoes
     where empresa_id = o.empresa_id and operador_id = auth.uid() and status = 'aberto'
     order by aberto_em desc limit 1;
    if v_sessao is null then
      raise exception 'Abra o seu caixa na Loja para receber (ou deixe "a receber").';
    end if;
    v_conta := case v_forma
      when 'pix' then v_cfg.conta_pix_id
      when 'transferencia' then v_cfg.conta_pix_id
      when 'cartao_debito' then v_cfg.conta_cartao_id
      when 'cartao_credito' then v_cfg.conta_cartao_id
      else v_cfg.conta_dinheiro_id
    end;
    if v_conta is null then
      raise exception 'Configure a conta que recebe este pagamento nas configurações da Loja (contas do caixa, do PIX e da maquininha).';
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, conta_financeira_id, data_competencia, data_vencimento, valor_previsto, origem, origem_referencia, numero_documento
    ) values (
      o.empresa_id, 'receber', left(v_desc, 300), v_cat, v_conta, v_hoje, v_hoje, v_valor, 'os', o.id::text, 'OS ' || o.numero
    ) returning id into v_lanc;
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem, observacao)
    values (o.empresa_id, v_lanc, 'receber', v_hoje, v_conta, v_valor, case v_forma when 'outro' then 'outro' else v_forma end, 'os', left(v_desc, 300));
  end if;

  insert into public.os_pagamentos (empresa_id, ordem_id, forma, valor, vencimento, sinal, sessao_id, lancamento_id, observacao)
  values (o.empresa_id, o.id, v_forma, v_valor, v_venc, o.etapa in ('fila', 'execucao'), v_sessao, v_lanc,
          nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 300), ''))
  returning id into v_id;
  update public.os_ordens set
    valor_recebido = valor_recebido + case when v_forma = 'a_receber' then 0 else v_valor end,
    valor_a_receber = valor_a_receber + case when v_forma = 'a_receber' then v_valor else 0 end
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'pagamento', null, null,
    case when v_forma = 'a_receber' then 'A receber R$ ' || to_char(v_valor, 'FM999G999G990D00') || ' até ' || to_char(v_venc, 'DD/MM/YYYY')
         else (case when o.etapa in ('fila', 'execucao') then 'Sinal' else 'Recebido' end) || ' R$ ' || to_char(v_valor, 'FM999G999G990D00') || ' (' || app.os_rotulo_forma(v_forma) || ')' end);
  return v_id;
end;
$$;

-- Estorna um recebimento: quem recebeu (com o caixa aberto) ou o gerente da Loja
create or replace function public.os_pagamento_estornar(p_pagamento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pg public.os_pagamentos;
  o public.os_ordens;
  v_sessao text;
  v_gerente boolean;
begin
  select * into pg from public.os_pagamentos where id = p_pagamento_id for update;
  if pg.id is null then
    raise exception 'Recebimento não encontrado.';
  end if;
  select * into o from public.os_ordens where id = pg.ordem_id for update;
  perform app.os_exigir(pg.empresa_id, 'os.operar');
  perform app.exigir_gestao(pg.empresa_id, 'gestao.vender');
  v_gerente := app.pode(pg.empresa_id, 'gestao.gerenciar');
  if pg.cancelado_em is not null then
    raise exception 'Este recebimento já foi estornado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do estorno.';
  end if;
  if pg.sessao_id is not null then
    select status into v_sessao from public.caixa_sessoes where id = pg.sessao_id;
  end if;
  if not v_gerente and (pg.registrado_por is distinct from auth.uid() or coalesce(v_sessao, 'fechado') <> 'aberto') then
    raise exception 'Só quem recebeu (com o caixa ainda aberto) ou o gerente da Loja estorna o recebimento.';
  end if;
  if v_sessao = 'fechado' and pg.forma = 'dinheiro' then
    raise exception 'O caixa deste recebimento já foi fechado. Faça a devolução pelo Financeiro.';
  end if;
  if pg.lancamento_id is not null then
    if exists (select 1 from public.baixas b where b.lancamento_id = pg.lancamento_id and b.origem <> 'os') then
      raise exception 'Este recebimento já foi conciliado ou baixado no Financeiro. Desfaça antes de estornar.';
    end if;
    delete from public.baixas where lancamento_id = pg.lancamento_id and origem = 'os';
    update public.lancamentos
       set situacao = 'cancelado', motivo_cancelamento = left('Recebimento da OS nº ' || o.numero || ' estornado: ' || trim(p_motivo), 500)
     where id = pg.lancamento_id and situacao <> 'cancelado';
  end if;
  update public.os_pagamentos
     set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300), cancelado_por = auth.uid()
   where id = pg.id;
  update public.os_ordens set
    valor_recebido = greatest(valor_recebido - case when pg.forma = 'a_receber' then 0 else pg.valor end, 0),
    valor_a_receber = greatest(valor_a_receber - case when pg.forma = 'a_receber' then pg.valor else 0 end, 0)
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'estorno', null, null,
    'Estornado R$ ' || to_char(pg.valor, 'FM999G999G990D00') || ' (' || app.os_rotulo_forma(pg.forma) || '): ' || left(trim(p_motivo), 200));
end;
$$;

-- Caixa do dia: os recebimentos das OS entram no resumo (e o dinheiro, na gaveta esperada)
create or replace function app.caixa_resumo(p_sessao_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.caixa_sessoes where id = p_sessao_id
  ), v as (
    select * from public.vendas where sessao_id = p_sessao_id and tipo = 'venda'
  ), pg as (
    select p.forma, sum(p.valor) as valor, count(distinct p.venda_id) as vendas
      from public.venda_pagamentos p join v on v.id = p.venda_id and v.status = 'concluida'
     group by p.forma
  ), h as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from (
        select forma, valor from public.hotel_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
        union all
        select forma, total from public.hotel_extras_recibos where sessao_id = p_sessao_id and cancelado_em is null
      ) t
     group by forma
  ), cl as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from public.vet_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
     group by forma
  ), os as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from public.os_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
     group by forma
  ), m as (
    select coalesce(sum(valor) filter (where tipo = 'sangria'), 0) as sangrias,
           coalesce(sum(valor) filter (where tipo = 'suprimento'), 0) as suprimentos,
           count(*) filter (where tipo = 'sangria') as qtd_sangrias,
           count(*) filter (where tipo = 'suprimento') as qtd_suprimentos
      from public.caixa_movimentos where sessao_id = p_sessao_id
  )
  select jsonb_build_object(
    'abertura', s.valor_abertura,
    'vendas_quantidade', (select count(*) from v where status = 'concluida'),
    'vendas_total', (select coalesce(sum(total), 0) from v where status = 'concluida'),
    'descontos', (select coalesce(sum(desconto), 0) from v where status = 'concluida'),
    'troco', (select coalesce(sum(troco), 0) from v where status = 'concluida'),
    'canceladas_quantidade', (select count(*) from v where status = 'cancelada'),
    'canceladas_total', (select coalesce(sum(total), 0) from v where status = 'cancelada'),
    'por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'vendas', vendas)) from pg), '{}'::jsonb),
    'hotel_quantidade', (select coalesce(sum(quantidade), 0) from h),
    'hotel_total', (select coalesce(sum(valor), 0) from h),
    'hotel_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from h), '{}'::jsonb),
    'clinica_quantidade', (select coalesce(sum(quantidade), 0) from cl),
    'clinica_total', (select coalesce(sum(valor), 0) from cl),
    'clinica_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from cl), '{}'::jsonb),
    'os_quantidade', (select coalesce(sum(quantidade), 0) from os),
    'os_total', (select coalesce(sum(valor), 0) from os),
    'os_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from os), '{}'::jsonb),
    'sangrias', m.sangrias,
    'suprimentos', m.suprimentos,
    'qtd_sangrias', m.qtd_sangrias,
    'qtd_suprimentos', m.qtd_suprimentos,
    'dinheiro_esperado', s.valor_abertura + coalesce((select valor from pg where forma = 'dinheiro'), 0)
      + coalesce((select valor from h where forma = 'dinheiro'), 0) + coalesce((select valor from cl where forma = 'dinheiro'), 0)
      + coalesce((select valor from os where forma = 'dinheiro'), 0)
      + m.suprimentos - m.sangrias
  )
  from s, m;
$$;

-- -----------------------------------------------------------------------------
-- 4. Aviso automático por WhatsApp quando a OS fica pronta
-- -----------------------------------------------------------------------------
create or replace function public.os_configurar_extras(p_empresa_id uuid, p_dados jsonb)
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
begin
  perform app.os_exigir(p_empresa_id, 'os.gerenciar');
  perform app.os_cfg(p_empresa_id);
  if v_phone is not null and v_phone !~ '^[0-9]{5,30}$' then
    raise exception 'O identificador do número (Phone Number ID) tem só números.';
  end if;
  if v_modelo is not null and (v_modelo !~ '^[a-z0-9_]+$' or length(v_modelo) > 512) then
    raise exception 'O nome do modelo aprovado usa só letras minúsculas, números e _ (ex.: os_pronta).';
  end if;
  if v_idioma !~ '^[a-z]{2,3}(_[A-Z]{2})?$' then
    raise exception 'Idioma do modelo inválido (ex.: pt_BR).';
  end if;
  if v_ativo and (v_phone is null or v_modelo is null) then
    raise exception 'Para ligar o aviso automático, informe o Phone Number ID e o nome do modelo aprovado.';
  end if;
  update public.os_config set
    whatsapp_ativo = v_ativo,
    whatsapp_phone_number_id = v_phone,
    whatsapp_modelo = v_modelo,
    whatsapp_idioma = v_idioma,
    exigir_assinatura = coalesce((p_dados ->> 'exigir_assinatura')::boolean, exigir_assinatura),
    exigir_pagamento_entrega = coalesce((p_dados ->> 'exigir_pagamento_entrega')::boolean, exigir_pagamento_entrega),
    atualizado_por = auth.uid()
  where empresa_id = p_empresa_id;
end;
$$;

-- Programa o aviso (1 minuto depois, para dar tempo de desfazer um clique errado)
create or replace function app.os_programar_aviso(p_ordem_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  c public.os_config;
  v_envio uuid;
begin
  select * into o from public.os_ordens where id = p_ordem_id;
  select * into c from public.os_config where empresa_id = o.empresa_id;
  if o.id is null or c.empresa_id is null or not c.whatsapp_ativo or not o.avisar_whatsapp or o.cliente_telefone is null then
    return;
  end if;
  -- Já avisado (ex.: voltou para execução e ficou pronta de novo)
  if o.aviso_whatsapp in ('enviado', 'pendente') then
    return;
  end if;
  insert into public.envios (empresa_id, canal, destinatario, conteudo, tipo, referencia_tipo, referencia_id)
  values (o.empresa_id, 'whatsapp', o.cliente_telefone, 'OS nº ' || o.numero || ' pronta para retirada', 'os_pronta', 'os', o.id::text)
  returning id into v_envio;
  perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), o.empresa_id, 'envio:' || v_envio::text, now() + interval '1 minute', 60);
  update public.os_ordens set aviso_whatsapp = 'pendente', aviso_whatsapp_em = null, aviso_whatsapp_erro = null where id = o.id;
end;
$$;

-- Resultado do envio (gravado pelo processador de tarefas, no servidor)
create or replace function public.os_aviso_resultado(p_ordem_id uuid, p_situacao text, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
begin
  if p_situacao not in ('enviado', 'falhou', 'nao_configurado', 'dispensado') then
    raise exception 'Situação inválida.';
  end if;
  select * into o from public.os_ordens where id = p_ordem_id for update;
  if o.id is null then
    return;
  end if;
  update public.os_ordens set
    aviso_whatsapp = p_situacao,
    aviso_whatsapp_em = case when p_situacao = 'enviado' then now() else aviso_whatsapp_em end,
    aviso_whatsapp_erro = nullif(left(coalesce(p_erro, ''), 300), '')
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'aviso', null, null,
    case p_situacao
      when 'enviado' then 'Cliente avisado pelo WhatsApp'
      when 'nao_configurado' then 'WhatsApp não configurado: nenhuma mensagem foi enviada'
      when 'dispensado' then 'Aviso pelo WhatsApp dispensado: ' || coalesce(left(p_erro, 200), '')
      else 'O aviso pelo WhatsApp falhou: ' || coalesce(left(p_erro, 200), '') end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Fotos da OS e assinatura da retirada (armazenamento privado)
-- Caminho: "<empresa>/<ordem>/<foto>.<ext>" e "<empresa>/<ordem>/assinatura-<id>.png".
-- O envio vai direto do navegador por uma URL temporária criada pelo servidor
-- depois que o banco valida o pedido (formato, tamanho, permissão e a OS).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('os-fotos', 'os-fotos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy os_fotos_leitura on storage.objects for select to authenticated
  using (bucket_id = 'os-fotos' and app.pode(app.empresa_do_objeto(name), 'os.operar'));

create table public.os_fotos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  ordem_id uuid not null,
  caminho text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  tamanho bigint not null check (tamanho > 0 and tamanho <= 10485760),
  -- Em que momento: material recebido, durante, serviço pronto, retirada
  momento text not null default 'outro' check (momento in ('entrada', 'execucao', 'pronta', 'retirada', 'outro')),
  legenda text check (legenda is null or length(legenda) <= 200),
  enviado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  confirmado_em timestamptz,
  constraint os_fotos_na_pasta check (caminho like empresa_id::text || '/' || ordem_id::text || '/%'),
  foreign key (empresa_id, ordem_id) references public.os_ordens (empresa_id, id) on delete cascade
);
create index os_fotos_ordem_idx on public.os_fotos (ordem_id, created_at);
create trigger auditoria_os_fotos after insert or update or delete on public.os_fotos for each row execute function app.tg_auditoria();

create or replace function public.os_foto_iniciar(p_ordem_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  v_mime text := lower(trim(coalesce(p_dados ->> 'mime', '')));
  v_momento text := coalesce(nullif(p_dados ->> 'momento', ''), 'outro');
  v_tamanho bigint;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_caminho text;
begin
  select * into o from public.os_ordens where id = p_ordem_id;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  if o.etapa = 'cancelada' then
    raise exception 'OS cancelada não recebe fotos.';
  end if;
  v_ext := case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'image/heic' then 'heic' when 'image/heif' then 'heif' end;
  if v_ext is null then
    raise exception 'Envie uma foto (JPG, PNG, WEBP ou HEIC).';
  end if;
  begin
    v_tamanho := (p_dados ->> 'tamanho')::bigint;
  exception when others then
    v_tamanho := null;
  end;
  if v_tamanho is null or v_tamanho <= 0 then
    raise exception 'Arquivo vazio.';
  end if;
  if v_tamanho > 10485760 then
    raise exception 'A foto pode ter até 10 MB.';
  end if;
  if v_momento not in ('entrada', 'execucao', 'pronta', 'retirada', 'outro') then
    v_momento := 'outro';
  end if;
  -- Envios que não terminaram há mais de uma hora não contam
  if (select count(*) from public.os_fotos
       where ordem_id = o.id and (confirmado_em is not null or created_at > now() - interval '1 hour')) >= 20 then
    raise exception 'Cada OS aceita até 20 fotos.';
  end if;
  v_caminho := o.empresa_id::text || '/' || o.id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.os_fotos (id, empresa_id, ordem_id, caminho, mime, tamanho, momento, legenda)
  values (v_id, o.empresa_id, o.id, v_caminho, v_mime, v_tamanho, v_momento, nullif(left(trim(coalesce(p_dados ->> 'legenda', '')), 200), ''));
  return jsonb_build_object('foto_id', v_id, 'caminho', v_caminho);
end;
$$;

create or replace function public.os_foto_confirmar(p_foto_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.os_fotos;
  v_obj jsonb;
begin
  select * into f from public.os_fotos where id = p_foto_id;
  if f.id is null then
    raise exception 'Foto não encontrada.';
  end if;
  perform app.os_exigir(f.empresa_id, 'os.operar');
  if f.enviado_por is distinct from auth.uid() then
    raise exception 'Somente quem iniciou o envio pode confirmá-lo.';
  end if;
  if f.confirmado_em is not null then
    return;
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'os-fotos' and o.name = f.caminho;
  if not found then
    raise exception 'A foto não chegou ao armazenamento. Tente enviar novamente.';
  end if;
  update public.os_fotos set confirmado_em = now(), tamanho = coalesce(nullif(v_obj ->> 'size', '')::bigint, tamanho) where id = f.id;
  perform app.os_evento(f.empresa_id, f.ordem_id, 'foto', null, null,
    'Foto ' || case f.momento when 'entrada' then 'do material recebido' when 'execucao' then 'durante o serviço'
                              when 'pronta' then 'do serviço pronto' when 'retirada' then 'da retirada' else 'anexada' end);
end;
$$;

-- Exclui a foto (quem enviou, antes da entrega, ou quem gerencia as OS); devolve o caminho para apagar o arquivo
create or replace function public.os_foto_excluir(p_foto_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.os_fotos;
  v_etapa text;
begin
  select * into f from public.os_fotos where id = p_foto_id;
  if f.id is null then
    raise exception 'Foto não encontrada.';
  end if;
  perform app.os_exigir(f.empresa_id, 'os.operar');
  if not app.pode(f.empresa_id, 'os.gerenciar') then
    select etapa into v_etapa from public.os_ordens where id = f.ordem_id;
    if f.enviado_por is distinct from auth.uid() or v_etapa in ('entregue', 'cancelada') then
      raise exception 'Só quem enviou a foto (antes da entrega) ou quem gerencia as OS pode excluí-la.';
    end if;
  end if;
  delete from public.os_fotos where id = f.id;
  return f.caminho;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Abrir/alterar (aviso por WhatsApp e previsão por setor), mover, entregar e cancelar
-- -----------------------------------------------------------------------------
create or replace function public.os_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual public.os_ordens;
  v_cfg public.os_config;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_numero bigint;
  v_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'cliente_telefone', ''), '\D', '', 'g'), '');
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'cliente_documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_prio text := coalesce(nullif(p_dados ->> 'prioridade', ''), 'normal');
  v_resp uuid := nullif(p_dados ->> 'responsavel_id', '')::uuid;
  v_prazo timestamptz := nullif(p_dados ->> 'prazo', '')::timestamptz;
  v_avisar boolean := coalesce((p_dados ->> 'avisar_whatsapp')::boolean, true);
  i jsonb;
  s public.os_servicos;
  v_q numeric;
  v_min numeric;
  v_valor numeric;
  v_desc text;
  v_un text;
  v_pos int := 0;
  v_total_min numeric := 0;
  v_total_valor numeric := 0;
  v_itens jsonb := '[]'::jsonb;
begin
  perform app.os_exigir(p_empresa_id, 'os.operar');
  if p_id is not null then
    select * into v_atual from public.os_ordens where id = p_id and empresa_id = p_empresa_id for update;
    if v_atual.id is null then
      raise exception 'Ordem de serviço não encontrada.';
    end if;
    if v_atual.etapa in ('entregue', 'cancelada') then
      raise exception 'OS entregue ou cancelada não muda.';
    end if;
  end if;
  if length(trim(coalesce(p_dados ->> 'cliente_nome', ''))) < 2 then
    raise exception 'Informe o nome do cliente.';
  end if;
  if v_tel is not null and v_tel !~ '^[0-9]{10,13}$' then
    raise exception 'Telefone inválido (com DDD).';
  end if;
  if v_doc is not null and not (app.cpf_valido(v_doc) or app.cnpj_valido(v_doc)) then
    raise exception 'CPF ou CNPJ do cliente inválido.';
  end if;
  if v_prio not in ('normal', 'alta', 'urgente') then
    raise exception 'Prioridade inválida.';
  end if;
  if v_resp is not null and not exists (select 1 from public.os_equipe where id = v_resp and empresa_id = p_empresa_id) then
    raise exception 'Responsável não encontrado.';
  end if;
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Informe ao menos um serviço.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 60 then
    raise exception 'No máximo 60 serviços por OS.';
  end if;

  -- Itens: o tempo dos serviços cadastrados é calculado aqui (fixo + por unidade × quantidade)
  for i in select * from jsonb_array_elements(p_dados -> 'itens') loop
    v_q := nullif(replace(i ->> 'quantidade', ',', '.'), '')::numeric;
    if v_q is null or v_q <= 0 or v_q > 1000000 then
      raise exception 'Confira a quantidade dos serviços.';
    end if;
    if nullif(i ->> 'servico_id', '') is not null then
      select * into s from public.os_servicos where id = (i ->> 'servico_id')::uuid and empresa_id = p_empresa_id;
      if s.id is null then
        raise exception 'Serviço não encontrado.';
      end if;
      v_desc := coalesce(nullif(left(trim(coalesce(i ->> 'descricao', '')), 200), ''), s.nome);
      v_un := s.unidade;
      v_min := round(s.minutos_fixos + s.minutos_por_unidade * v_q, 2);
      v_valor := coalesce(nullif(replace(i ->> 'valor_unitario', ',', '.'), '')::numeric, s.valor_unitario);
    else
      s := null;
      v_desc := nullif(left(trim(coalesce(i ->> 'descricao', '')), 200), '');
      if v_desc is null then
        raise exception 'Descreva o serviço avulso.';
      end if;
      v_un := coalesce(nullif(left(trim(coalesce(i ->> 'unidade', '')), 12), ''), 'un');
      v_min := round(coalesce(nullif(replace(i ->> 'minutos', ',', '.'), '')::numeric, 0), 2);
      v_valor := coalesce(nullif(replace(i ->> 'valor_unitario', ',', '.'), '')::numeric, 0);
    end if;
    if v_min < 0 or v_min > 1000000 then
      raise exception 'Tempo do serviço inválido.';
    end if;
    if v_valor < 0 or v_valor <> round(v_valor, 2) then
      raise exception 'Valor do serviço inválido.';
    end if;
    v_pos := v_pos + 1;
    v_total_min := v_total_min + v_min;
    v_total_valor := v_total_valor + round(v_valor * v_q, 2);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('servico_id', s.id, 'descricao', v_desc, 'quantidade', v_q, 'unidade', v_un,
      'minutos', v_min, 'valor', v_valor, 'posicao', v_pos));
  end loop;

  if p_id is null then
    v_cfg := app.os_cfg(p_empresa_id);
    update public.os_config set proximo_numero = proximo_numero + 1 where empresa_id = p_empresa_id
      returning proximo_numero - 1 into v_numero;
    insert into public.os_ordens (
      id, empresa_id, numero, codigo_publico, cliente_nome, cliente_telefone, cliente_documento, descricao, observacoes,
      prioridade, responsavel_id, prazo, previsao, minutos_estimados, valor_total, avisar_whatsapp, ordem
    ) values (
      v_id, p_empresa_id, v_numero, substr(translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789abcdefghijklmnopqrstuvwxyz0123'), 1, 12),
      left(trim(p_dados ->> 'cliente_nome'), 120), v_tel, v_doc,
      nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), ''), nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''),
      v_prio, v_resp, v_prazo, null, v_total_min, v_total_valor, v_avisar,
      -- A urgente entra no topo da fila; as demais, no fim
      case when v_prio = 'urgente' then coalesce((select min(ordem) from public.os_ordens where empresa_id = p_empresa_id and etapa = 'fila'), 1) - 1
           else coalesce((select max(ordem) from public.os_ordens where empresa_id = p_empresa_id and etapa = 'fila'), 0) + 1 end
    );
    perform app.os_evento(p_empresa_id, v_id, 'criada', null, 'fila', null);
  else
    update public.os_ordens set
      cliente_nome = left(trim(p_dados ->> 'cliente_nome'), 120), cliente_telefone = v_tel, cliente_documento = v_doc,
      descricao = nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), ''),
      observacoes = nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''),
      prioridade = v_prio, responsavel_id = v_resp, prazo = v_prazo, minutos_estimados = v_total_min, valor_total = v_total_valor,
      avisar_whatsapp = v_avisar
    where id = p_id;
    delete from public.os_itens where ordem_id = p_id;
    perform app.os_evento(p_empresa_id, p_id, 'editada', null, null, null);
  end if;

  insert into public.os_itens (empresa_id, ordem_id, servico_id, descricao, quantidade, unidade, minutos_estimados, valor_unitario, posicao)
  select p_empresa_id, v_id, nullif(x ->> 'servico_id', '')::uuid, x ->> 'descricao', (x ->> 'quantidade')::numeric, x ->> 'unidade',
         (x ->> 'minutos')::numeric, (x ->> 'valor')::numeric, (x ->> 'posicao')::int
    from jsonb_array_elements(v_itens) x;

  -- Previsão na abertura: pela fila de cada setor que a OS usa
  if p_id is null then
    update public.os_ordens set previsao = app.os_previsao_por_setor(p_empresa_id, app.os_minutos_setores(v_id), v_prio, v_id) where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.os_mover(p_id uuid, p_etapa text, p_posicao double precision default null, p_retirado_por text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  c public.os_config;
  v_agora timestamptz := now();
  v_exec numeric;
  v_pausa numeric;
  v_falta numeric;
begin
  select * into o from public.os_ordens where id = p_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  if p_etapa not in ('fila', 'execucao', 'pronta', 'entregue') then
    raise exception 'Etapa inválida.';
  end if;
  if o.etapa = 'cancelada' then
    raise exception 'OS cancelada não muda.';
  end if;
  if o.etapa = 'entregue' and p_etapa <> 'entregue' and not app.pode(o.empresa_id, 'os.gerenciar') then
    raise exception 'Só quem gerencia as OS reabre uma OS entregue.';
  end if;

  -- Só mudou a posição na coluna
  if o.etapa = p_etapa then
    update public.os_ordens set ordem = coalesce(p_posicao, ordem) where id = o.id;
    return;
  end if;

  -- Entrega com regras da loja (assinatura ou pagamento): só pelo botão Entregar
  if p_etapa = 'entregue' and coalesce(current_setting('app.os_entrega', true), '') <> o.id::text then
    c := app.os_cfg(o.empresa_id);
    if c.exigir_assinatura then
      raise exception 'Esta loja pede a assinatura de quem retira: use o botão Entregar.';
    end if;
    v_falta := o.valor_total - o.valor_recebido - o.valor_a_receber;
    if c.exigir_pagamento_entrega and v_falta > 0 then
      raise exception 'Falta receber R$ % desta OS antes da entrega.', to_char(v_falta, 'FM999G999G990D00');
    end if;
  end if;

  v_exec := o.minutos_execucao;
  v_pausa := o.minutos_pausa;
  -- Saiu de execução: soma o tempo trabalhado (ou o da pausa em andamento)
  if o.etapa = 'execucao' then
    if o.pausada then
      v_pausa := v_pausa + extract(epoch from v_agora - o.pausada_em) / 60;
    elsif o.execucao_desde is not null then
      v_exec := v_exec + extract(epoch from v_agora - o.execucao_desde) / 60;
    end if;
  end if;

  update public.os_ordens set
    etapa = p_etapa,
    ordem = coalesce(p_posicao, coalesce((select max(x.ordem) from public.os_ordens x where x.empresa_id = o.empresa_id and x.etapa = p_etapa), 0) + 1),
    minutos_execucao = round(v_exec, 2),
    minutos_pausa = round(v_pausa, 2),
    pausada = false,
    pausada_em = null,
    pausa_motivo = null,
    execucao_desde = case when p_etapa = 'execucao' then v_agora end,
    iniciada_em = case when p_etapa in ('execucao', 'pronta', 'entregue') then coalesce(o.iniciada_em, v_agora) else o.iniciada_em end,
    pronta_em = case when p_etapa = 'pronta' then v_agora when p_etapa = 'entregue' then coalesce(o.pronta_em, v_agora) else null end,
    entregue_em = case when p_etapa = 'entregue' then v_agora end,
    entregue_por = case when p_etapa = 'entregue' then auth.uid() end,
    retirado_por = case when p_etapa = 'entregue' then nullif(left(trim(coalesce(p_retirado_por, '')), 120), '') end,
    retirado_documento = case when p_etapa = 'entregue' then o.retirado_documento end,
    assinatura_caminho = case when p_etapa = 'entregue' then o.assinatura_caminho end
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'etapa', o.etapa, p_etapa,
    case when p_etapa = 'entregue' and nullif(trim(coalesce(p_retirado_por, '')), '') is not null then 'Retirado por ' || left(trim(p_retirado_por), 120) end);

  -- Ficou pronta: avisa o cliente pelo WhatsApp (se a loja ligou o aviso automático)
  if p_etapa = 'pronta' and o.etapa in ('fila', 'execucao') then
    perform app.os_programar_aviso(o.id);
  end if;
end;
$$;

-- Entrega pelo botão Entregar: quem retirou, documento e assinatura (opcional ou
-- exigida pela loja) e a regra do pagamento antes da entrega
create or replace function public.os_entregar(p_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  c public.os_config;
  v_nome text := nullif(left(trim(coalesce(p_dados ->> 'retirado_por', '')), 120), '');
  v_doc text := nullif(left(trim(coalesce(p_dados ->> 'retirado_documento', '')), 30), '');
  v_ass text := nullif(p_dados ->> 'assinatura_caminho', '');
  v_falta numeric;
begin
  select * into o from public.os_ordens where id = p_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  if o.etapa = 'entregue' then
    raise exception 'Esta OS já foi entregue.';
  end if;
  c := app.os_cfg(o.empresa_id);
  if v_ass is not null then
    if v_ass not like o.empresa_id::text || '/' || o.id::text || '/assinatura-%.png'
       or not exists (select 1 from storage.objects so where so.bucket_id = 'os-fotos' and so.name = v_ass) then
      raise exception 'A assinatura não chegou ao armazenamento. Assine de novo.';
    end if;
  end if;
  if c.exigir_assinatura and v_ass is null then
    raise exception 'Esta loja pede a assinatura de quem retira.';
  end if;
  if c.exigir_assinatura and v_nome is null then
    raise exception 'Informe o nome de quem retira.';
  end if;
  v_falta := o.valor_total - o.valor_recebido - o.valor_a_receber;
  if c.exigir_pagamento_entrega and v_falta > 0 then
    raise exception 'Falta receber R$ % desta OS antes da entrega.', to_char(v_falta, 'FM999G999G990D00');
  end if;
  update public.os_ordens set retirado_documento = v_doc, assinatura_caminho = v_ass where id = o.id;
  perform set_config('app.os_entrega', o.id::text, true);
  perform public.os_mover(o.id, 'entregue', null, v_nome);
  perform set_config('app.os_entrega', '', true);
end;
$$;

create or replace function public.os_cancelar(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 300), '');
begin
  select * into o from public.os_ordens where id = p_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.gerenciar');
  if o.etapa in ('entregue', 'cancelada') then
    raise exception 'OS entregue ou cancelada não pode ser cancelada.';
  end if;
  if v_motivo is null then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  if o.valor_recebido + o.valor_a_receber > 0 then
    raise exception 'Esta OS tem recebimentos. Estorne-os antes de cancelar.';
  end if;
  update public.os_ordens set
    minutos_execucao = round(minutos_execucao + case when etapa = 'execucao' and not pausada and execucao_desde is not null
                                                     then extract(epoch from now() - execucao_desde) / 60 else 0 end, 2),
    etapa = 'cancelada', execucao_desde = null, pausada = false, pausada_em = null, pausa_motivo = null,
    cancelada_em = now(), cancelada_motivo = v_motivo
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'cancelada', o.etapa, 'cancelada', v_motivo);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. RLS e privilégios
-- -----------------------------------------------------------------------------
alter table public.os_setores enable row level security;
alter table public.os_pagamentos enable row level security;
alter table public.os_fotos enable row level security;
create policy os_setores_leitura on public.os_setores for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_pagamentos_leitura on public.os_pagamentos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_fotos_leitura on public.os_fotos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
grant select on public.os_setores, public.os_pagamentos, public.os_fotos to authenticated;
grant select, insert, update, delete on public.os_setores, public.os_pagamentos, public.os_fotos to service_role;

-- (app.os_setor_chave e app.os_rotulo_forma são funções puras de texto: ficam livres, o índice usa a primeira)
revoke execute on function app.os_capacidade(uuid, text, smallint), app.os_carga_setores(uuid, text, uuid),
  app.os_minutos_setores(uuid), app.os_previsao_por_setor(uuid, jsonb, text, uuid),
  app.os_programar_aviso(uuid), app.tg_os_servico_setor(), app.tg_os_total_recebido()
  from public, anon, authenticated;
revoke execute on function public.os_previsao_itens(uuid, jsonb, text), public.os_fila_setores(uuid), public.os_setor_salvar(uuid, uuid, jsonb),
  public.os_pagamento_registrar(uuid, jsonb), public.os_pagamento_estornar(uuid, text), public.os_configurar_extras(uuid, jsonb),
  public.os_foto_iniciar(uuid, jsonb), public.os_foto_confirmar(uuid), public.os_foto_excluir(uuid), public.os_entregar(uuid, jsonb)
  from public, anon;
grant execute on function public.os_previsao_itens(uuid, jsonb, text), public.os_fila_setores(uuid), public.os_setor_salvar(uuid, uuid, jsonb),
  public.os_pagamento_registrar(uuid, jsonb), public.os_pagamento_estornar(uuid, text), public.os_configurar_extras(uuid, jsonb),
  public.os_foto_iniciar(uuid, jsonb), public.os_foto_confirmar(uuid), public.os_foto_excluir(uuid), public.os_entregar(uuid, jsonb)
  to authenticated;
-- Resultado do aviso: só o servidor (processador de tarefas)
revoke execute on function public.os_aviso_resultado(uuid, text, text) from public, anon, authenticated;
grant execute on function public.os_aviso_resultado(uuid, text, text) to service_role;
