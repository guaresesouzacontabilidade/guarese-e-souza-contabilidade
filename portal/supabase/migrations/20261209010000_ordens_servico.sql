-- =============================================================================
-- Ordens de serviço (OS): esteira de serviços da empresa
--
-- Para lojas que fazem serviços (ex.: madeireira: corte de chapas, fita de
-- borda, furação). Cada OS passa pela esteira:
--   Chegou (fila) → Em execução → Pronta para entrega → Entregue
-- (ou é cancelada). O portal guarda quanto tempo a OS ficou em cada etapa,
-- desconta as pausas (falta de material, esperando o cliente) do tempo de
-- execução e compara com o tempo estimado de cada serviço, que é cadastrado
-- por unidade (ex.: 4 min por chapa) mais um tempo fixo de preparação.
--
--  * Previsão de entrega: na abertura, soma o trabalho que está na frente (fila
--    e o que falta das OS em execução, por prioridade), divide pelas OS que a
--    equipe faz ao mesmo tempo e conta só o horário de trabalho da loja.
--  * Acompanhamento pelo cliente: cada OS tem um código aleatório (no QR Code
--    da via impressa); a página pública mostra só o número, a etapa, a
--    previsão e o primeiro nome do cliente.
--  * Permissões: os.operar (abrir, mover, pausar, entregar) e os.gerenciar
--    (serviços, equipe, configuração, relatório e cancelar). A ferramenta "os"
--    vem desligada: o escritório liga na empresa que contratou.
-- Tudo pelas funções abaixo; as tabelas são só lidas diretamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões e ferramenta
-- -----------------------------------------------------------------------------
create or replace function app.permissoes_validas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'empresa.ver',
    'empresa.editar',
    'usuarios.gerenciar',
    'documentos.ver',
    'documentos.enviar',
    'documentos.baixar',
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'financeiro.ver',
    'financeiro.editar',
    'financeiro.importar',
    'conciliacao.executar',
    'relatorios.ver',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'mensagens.usar',
    'calculos.ver',
    'calculos.gerenciar',
    'colaboradores.gerenciar',
    'certificado.gerenciar',
    'auditor.ver',
    'auditor.gerenciar',
    'maquininhas.ver',
    'maquininhas.gerenciar',
    'nfse.emitir',
    'nfse.configurar',
    'nfe.emitir',
    'nfe.configurar',
    'gestao.vender',
    'gestao.gerenciar',
    'cte.emitir',
    'cte.configurar',
    'escalas.ver',
    'escalas.gerenciar',
    'os.operar',
    'os.gerenciar'
  ]::text[];
$$;

create or replace function app.permissoes_padrao(p_papel text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'equipe' then array[
      'empresa.ver', 'empresa.editar', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar', 'documentos.revisar', 'documentos.publicar',
      'checklist.gerenciar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar', 'conciliacao.executar',
      'relatorios.ver', 'relatorios.publicar',
      'fechamento.gerenciar',
      'mensagens.usar',
      'calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver', 'auditor.gerenciar',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir', 'nfse.configurar',
      'nfe.emitir', 'nfe.configurar',
      'gestao.vender', 'gestao.gerenciar',
      'cte.emitir', 'cte.configurar',
      'escalas.ver', 'escalas.gerenciar',
      'os.operar', 'os.gerenciar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir',
      'nfe.emitir',
      'gestao.vender', 'gestao.gerenciar',
      'cte.emitir',
      'escalas.ver', 'escalas.gerenciar',
      'os.operar', 'os.gerenciar'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

create or replace function app.tg_validar_membro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from public.perfis where id = new.user_id;
  if v_tipo is null then
    raise exception 'Usuário inexistente.';
  end if;
  if new.papel = 'equipe' and v_tipo not in ('admin', 'equipe') then
    raise exception 'Somente usuários da equipe do escritório podem ter o papel "equipe".';
  end if;
  if new.papel <> 'equipe' and v_tipo <> 'cliente' then
    raise exception 'Usuários da equipe não podem ser vinculados como clientes.';
  end if;
  if new.papel <> 'equipe' and new.permissoes && app.permissoes_exclusivas_equipe() then
    raise exception 'Permissões exclusivas da equipe não podem ser concedidas a clientes.';
  end if;
  -- Quem pode ver qualquer coisa precisa ao menos ver a empresa.
  if cardinality(new.permissoes) > 0 and not ('empresa.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'empresa.ver');
  end if;
  -- Baixar documentos implica ver documentos.
  if 'documentos.baixar' = any(new.permissoes) and not ('documentos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'documentos.ver');
  end if;
  if 'financeiro.editar' = any(new.permissoes) and not ('financeiro.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'financeiro.ver');
  end if;
  -- Configurar os cálculos ou cadastrar colaboradores implica ver os cálculos.
  if (new.permissoes && array['calculos.gerenciar', 'colaboradores.gerenciar']) and not ('calculos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'calculos.ver');
  end if;
  -- Conduzir o auditor implica ver os achados.
  if 'auditor.gerenciar' = any(new.permissoes) and not ('auditor.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'auditor.ver');
  end if;
  -- Cadastrar contratos e importar relatórios implica ver a conferência das maquininhas.
  if 'maquininhas.gerenciar' = any(new.permissoes) and not ('maquininhas.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'maquininhas.ver');
  end if;
  -- Configurar a emissão implica poder emitir.
  if 'nfse.configurar' = any(new.permissoes) and not ('nfse.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'nfse.emitir');
  end if;
  if 'nfe.configurar' = any(new.permissoes) and not ('nfe.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'nfe.emitir');
  end if;
  if 'cte.configurar' = any(new.permissoes) and not ('cte.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'cte.emitir');
  end if;
  -- Gerenciar a loja implica poder vender.
  if 'gestao.gerenciar' = any(new.permissoes) and not ('gestao.vender' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'gestao.vender');
  end if;
  -- Montar escalas implica ver as escalas.
  if 'escalas.gerenciar' = any(new.permissoes) and not ('escalas.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'escalas.ver');
  end if;
  -- Gerenciar as ordens de serviço implica operar a esteira.
  if 'os.gerenciar' = any(new.permissoes) and not ('os.operar' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'os.operar');
  end if;
  return new;
end;
$$;

-- Acessos existentes: equipe e empresário titular passam a operar e gerenciar as OS.
update public.empresa_membros
   set permissoes = permissoes || array['os.operar', 'os.gerenciar']
 where papel in ('equipe', 'cliente_titular') and not (permissoes && array['os.operar', 'os.gerenciar']);
update public.convites
   set permissoes = permissoes || array['os.operar', 'os.gerenciar']
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and cardinality(permissoes) > 0
   and not (permissoes && array['os.operar', 'os.gerenciar']);

-- A ferramenta vem desligada (o escritório liga na empresa que contratou).
alter table public.empresas drop constraint empresas_ferramentas_validas;
alter table public.empresas
  add constraint empresas_ferramentas_validas check (
    ferramentas_desligadas <@ array[
      'nfse', 'nfe', 'cte', 'notas_automaticas', 'agenda', 'vencimentos', 'financeiro', 'maquininhas',
      'conciliacao', 'fechamento', 'calculos', 'auditor', 'relatorios', 'declaracoes', 'solicitacoes',
      'escalas', 'os'
    ]::text[]
  );
update public.empresas set ferramentas_desligadas = array(select distinct f from unnest(ferramentas_desligadas || array['os']) f order by f)
 where not ('os' = any(ferramentas_desligadas));
alter table public.empresas alter column ferramentas_desligadas set default array['os']::text[];

-- -----------------------------------------------------------------------------
-- 2. Configuração, serviços e equipe
-- -----------------------------------------------------------------------------
create table public.os_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  -- Nome e telefone que aparecem na OS impressa e na página de acompanhamento
  nome_exibicao text check (nome_exibicao is null or length(trim(nome_exibicao)) between 2 and 120),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  -- Horário de trabalho (para a previsão de entrega): 1 = segunda ... 7 = domingo
  hora_inicio time not null default '08:00',
  hora_fim time not null default '18:00',
  dias_semana smallint[] not null default '{1,2,3,4,5,6}' check (cardinality(dias_semana) between 1 and 7 and dias_semana <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- Quantas OS a equipe faz ao mesmo tempo
  executores_simultaneos smallint not null default 1 check (executores_simultaneos between 1 and 50),
  mensagem_pronta text check (mensagem_pronta is null or length(mensagem_pronta) <= 600),
  rodape_impressao text check (rodape_impressao is null or length(rodape_impressao) <= 1000),
  proximo_numero bigint not null default 1 check (proximo_numero >= 1),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_config_horario check (hora_fim > hora_inicio)
);
create trigger os_config_updated_at before update on public.os_config for each row execute function app.tg_updated_at();
create trigger auditoria_os_config after insert or update or delete on public.os_config for each row execute function app.tg_auditoria();

create table public.os_servicos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  -- Unidade do serviço (chapa, metro, peça, furo, hora...)
  unidade text not null default 'un' check (length(trim(unidade)) between 1 and 12),
  -- Tempo estimado: fixo (preparação) + por unidade
  minutos_por_unidade numeric(10, 2) not null default 0 check (minutos_por_unidade between 0 and 10000),
  minutos_fixos numeric(10, 2) not null default 0 check (minutos_fixos between 0 and 10000),
  valor_unitario numeric(12, 2) not null default 0 check (valor_unitario >= 0),
  -- Setor ou máquina (ex.: Seccionadora, Coladeira de borda)
  setor text check (setor is null or length(setor) <= 60),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_servicos_empresa_id_unico unique (empresa_id, id),
  constraint os_servicos_tempo check (minutos_por_unidade > 0 or minutos_fixos > 0)
);
create unique index os_servicos_nome_uk on public.os_servicos (empresa_id, lower(trim(nome)));
create trigger os_servicos_updated_at before update on public.os_servicos for each row execute function app.tg_updated_at();
create trigger auditoria_os_servicos after insert or update or delete on public.os_servicos for each row execute function app.tg_auditoria();

-- Quem faz o serviço (não precisa ter acesso ao portal)
create table public.os_equipe (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  cor text not null default '#2563eb' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_equipe_empresa_id_unico unique (empresa_id, id)
);
create unique index os_equipe_nome_uk on public.os_equipe (empresa_id, lower(trim(nome)));
create trigger os_equipe_updated_at before update on public.os_equipe for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Ordens, itens e histórico
-- -----------------------------------------------------------------------------
create table public.os_ordens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  -- Código do acompanhamento pelo cliente (QR Code da via impressa)
  codigo_publico text not null unique check (codigo_publico ~ '^[a-z0-9]{12}$'),
  cliente_nome text not null check (length(trim(cliente_nome)) between 2 and 120),
  cliente_telefone text check (cliente_telefone is null or cliente_telefone ~ '^[0-9]{10,13}$'),
  cliente_documento text check (cliente_documento is null or cliente_documento ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'),
  descricao text check (descricao is null or length(descricao) <= 2000),
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  prioridade text not null default 'normal' check (prioridade in ('normal', 'alta', 'urgente')),
  etapa text not null default 'fila' check (etapa in ('fila', 'execucao', 'pronta', 'entregue', 'cancelada')),
  responsavel_id uuid,
  -- Ordem do cartão dentro da coluna
  ordem double precision not null default 0,
  -- Prazo combinado com o cliente e previsão calculada na abertura
  prazo timestamptz,
  previsao timestamptz,
  minutos_estimados numeric(12, 2) not null default 0 check (minutos_estimados >= 0),
  valor_total numeric(12, 2) not null default 0 check (valor_total >= 0),
  -- Tempos: execução acumulada (sem as pausas) e pausas
  minutos_execucao numeric(12, 2) not null default 0 check (minutos_execucao >= 0),
  minutos_pausa numeric(12, 2) not null default 0 check (minutos_pausa >= 0),
  execucao_desde timestamptz,
  pausada boolean not null default false,
  pausa_motivo text check (pausa_motivo is null or length(pausa_motivo) <= 200),
  pausada_em timestamptz,
  aberta_em timestamptz not null default now(),
  iniciada_em timestamptz,
  pronta_em timestamptz,
  entregue_em timestamptz,
  retirado_por text check (retirado_por is null or length(retirado_por) <= 120),
  entregue_por uuid references public.perfis(id) on delete set null,
  cancelada_em timestamptz,
  cancelada_motivo text check (cancelada_motivo is null or length(cancelada_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_ordens_numero_uk unique (empresa_id, numero),
  constraint os_ordens_empresa_id_unico unique (empresa_id, id),
  constraint os_ordens_pausa check (pausada = (pausada_em is not null) and (not pausada or etapa = 'execucao')),
  foreign key (empresa_id, responsavel_id) references public.os_equipe (empresa_id, id)
);
create index os_ordens_esteira_idx on public.os_ordens (empresa_id, etapa, ordem);
create index os_ordens_abertura_idx on public.os_ordens (empresa_id, aberta_em desc);
create trigger os_ordens_updated_at before update on public.os_ordens for each row execute function app.tg_updated_at();
create trigger auditoria_os_ordens after insert or update or delete on public.os_ordens for each row execute function app.tg_auditoria();

create table public.os_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null,
  servico_id uuid,
  descricao text not null check (length(trim(descricao)) between 1 and 200),
  quantidade numeric(12, 3) not null check (quantidade > 0 and quantidade <= 1000000),
  unidade text not null default 'un' check (length(trim(unidade)) between 1 and 12),
  minutos_estimados numeric(12, 2) not null default 0 check (minutos_estimados >= 0),
  valor_unitario numeric(12, 2) not null default 0 check (valor_unitario >= 0),
  posicao int not null default 0,
  foreign key (empresa_id, ordem_id) references public.os_ordens (empresa_id, id) on delete cascade,
  foreign key (empresa_id, servico_id) references public.os_servicos (empresa_id, id)
);
create index os_itens_ordem_idx on public.os_itens (ordem_id, posicao);
create index os_itens_servico_idx on public.os_itens (servico_id) where servico_id is not null;

create table public.os_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null,
  tipo text not null check (tipo in ('criada', 'editada', 'etapa', 'pausa', 'retomada', 'responsavel', 'cancelada')),
  de_etapa text,
  para_etapa text,
  detalhe text check (detalhe is null or length(detalhe) <= 300),
  usuario uuid references public.perfis(id) on delete set null default auth.uid(),
  em timestamptz not null default now(),
  foreign key (empresa_id, ordem_id) references public.os_ordens (empresa_id, id) on delete cascade
);
create index os_eventos_ordem_idx on public.os_eventos (ordem_id, em);

-- -----------------------------------------------------------------------------
-- 4. Regras comuns
-- -----------------------------------------------------------------------------
create or replace function app.os_exigir(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, p_permissao);
  if exists (select 1 from public.empresas where id = p_empresa_id and 'os' = any(ferramentas_desligadas)) then
    raise exception 'As ordens de serviço não estão ligadas para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

create or replace function app.os_cfg(p_empresa_id uuid)
returns public.os_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.os_config;
begin
  select * into v from public.os_config where empresa_id = p_empresa_id;
  if v.empresa_id is null then
    insert into public.os_config (empresa_id, mensagem_pronta) values (
      p_empresa_id,
      'Olá, {cliente}! Sua ordem de serviço nº {numero} está pronta para retirada. Acompanhe: {link}'
    ) on conflict (empresa_id) do nothing;
    select * into v from public.os_config where empresa_id = p_empresa_id;
  end if;
  return v;
end;
$$;

create or replace function app.os_evento(p_empresa_id uuid, p_ordem_id uuid, p_tipo text, p_de text, p_para text, p_detalhe text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.os_eventos (empresa_id, ordem_id, tipo, de_etapa, para_etapa, detalhe)
  values (p_empresa_id, p_ordem_id, p_tipo, p_de, p_para, left(p_detalhe, 300));
$$;

-- Soma minutos de trabalho a um momento, contando só o horário e os dias de trabalho da loja
create or replace function app.os_somar_minutos_uteis(p_inicio timestamptz, p_minutos numeric, p_hora_inicio time, p_hora_fim time, p_dias smallint[])
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_inicio at time zone 'America/Araguaina';
  v_restante numeric := greatest(coalesce(p_minutos, 0), 0);
  v_dia date;
  v_ini timestamp;
  v_fim timestamp;
  v_disp numeric;
  i int := 0;
begin
  loop
    i := i + 1;
    exit when i > 800;
    v_dia := v_local::date;
    if extract(isodow from v_dia)::smallint = any(p_dias) then
      v_ini := v_dia + p_hora_inicio;
      v_fim := v_dia + p_hora_fim;
      if v_local < v_ini then
        v_local := v_ini;
      end if;
      if v_local < v_fim then
        v_disp := extract(epoch from (v_fim - v_local)) / 60;
        if v_restante <= v_disp then
          return (v_local + make_interval(secs => (v_restante * 60)::double precision)) at time zone 'America/Araguaina';
        end if;
        v_restante := v_restante - v_disp;
      end if;
    end if;
    v_local := (v_dia + 1)::timestamp;
  end loop;
  return v_local at time zone 'America/Araguaina';
end;
$$;

-- Trabalho que está na frente (minutos): a fila e o que falta das OS em execução,
-- considerando a prioridade (a urgente passa na frente da normal)
create or replace function app.os_carga(p_empresa_id uuid, p_prioridade text, p_ignorar uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
           when o.etapa = 'fila' then o.minutos_estimados
           else greatest(o.minutos_estimados - o.minutos_execucao
                         - case when o.execucao_desde is not null then extract(epoch from now() - o.execucao_desde) / 60 else 0 end, 0)
         end), 0)
    from public.os_ordens o
   where o.empresa_id = p_empresa_id
     and o.etapa in ('fila', 'execucao')
     and (p_ignorar is null or o.id <> p_ignorar)
     and (o.etapa = 'execucao'
          or p_prioridade = 'normal'
          or (p_prioridade = 'alta' and o.prioridade in ('alta', 'urgente'))
          or (p_prioridade = 'urgente' and o.prioridade = 'urgente'));
$$;

create or replace function app.os_calcular_previsao(p_empresa_id uuid, p_minutos numeric, p_prioridade text, p_ignorar uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.os_config := app.os_cfg(p_empresa_id);
begin
  return app.os_somar_minutos_uteis(
    now(),
    app.os_carga(p_empresa_id, coalesce(p_prioridade, 'normal'), p_ignorar) / c.executores_simultaneos + greatest(coalesce(p_minutos, 0), 0),
    c.hora_inicio, c.hora_fim, c.dias_semana
  );
end;
$$;

-- Previsão para a tela de abertura (antes de salvar)
create or replace function public.os_previsao(p_empresa_id uuid, p_minutos numeric, p_prioridade text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.os_exigir(p_empresa_id, 'os.operar');
  if coalesce(p_prioridade, 'normal') not in ('normal', 'alta', 'urgente') then
    raise exception 'Prioridade inválida.';
  end if;
  return app.os_calcular_previsao(p_empresa_id, least(greatest(coalesce(p_minutos, 0), 0), 1000000), p_prioridade, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Configuração, serviços e equipe (os.gerenciar)
-- -----------------------------------------------------------------------------
create or replace function public.os_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dias smallint[];
begin
  perform app.os_exigir(p_empresa_id, 'os.gerenciar');
  perform app.os_cfg(p_empresa_id);
  if jsonb_typeof(p_dados -> 'dias_semana') = 'array' then
    select coalesce(array_agg(distinct d::smallint order by d::smallint), '{}') into v_dias
      from jsonb_array_elements_text(p_dados -> 'dias_semana') d;
    if cardinality(v_dias) = 0 or not (v_dias <@ '{1,2,3,4,5,6,7}'::smallint[]) then
      raise exception 'Escolha os dias de trabalho.';
    end if;
  end if;
  if nullif(p_dados ->> 'hora_inicio', '') is not null and nullif(p_dados ->> 'hora_fim', '') is not null
     and (p_dados ->> 'hora_fim')::time <= (p_dados ->> 'hora_inicio')::time then
    raise exception 'O fim do expediente precisa ser depois do início.';
  end if;
  update public.os_config set
    nome_exibicao = nullif(left(trim(coalesce(p_dados ->> 'nome_exibicao', '')), 120), ''),
    telefone = nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
    hora_inicio = coalesce(nullif(p_dados ->> 'hora_inicio', '')::time, hora_inicio),
    hora_fim = coalesce(nullif(p_dados ->> 'hora_fim', '')::time, hora_fim),
    dias_semana = coalesce(v_dias, dias_semana),
    executores_simultaneos = coalesce(nullif(p_dados ->> 'executores_simultaneos', '')::smallint, executores_simultaneos),
    mensagem_pronta = nullif(left(trim(coalesce(p_dados ->> 'mensagem_pronta', '')), 600), ''),
    rodape_impressao = nullif(left(trim(coalesce(p_dados ->> 'rodape_impressao', '')), 1000), ''),
    atualizado_por = auth.uid()
  where empresa_id = p_empresa_id;
end;
$$;

create or replace function public.os_servico_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text := nullif(left(trim(coalesce(p_dados ->> 'nome', '')), 120), '');
  v_por numeric := coalesce(nullif(replace(p_dados ->> 'minutos_por_unidade', ',', '.'), '')::numeric, 0);
  v_fixo numeric := coalesce(nullif(replace(p_dados ->> 'minutos_fixos', ',', '.'), '')::numeric, 0);
  v_valor numeric := coalesce(nullif(replace(p_dados ->> 'valor_unitario', ',', '.'), '')::numeric, 0);
begin
  perform app.os_exigir(p_empresa_id, 'os.gerenciar');
  if v_nome is null or length(v_nome) < 2 then
    raise exception 'Informe o nome do serviço.';
  end if;
  if v_por < 0 or v_fixo < 0 or v_por > 10000 or v_fixo > 10000 or (v_por = 0 and v_fixo = 0) then
    raise exception 'Informe o tempo estimado do serviço (por unidade ou fixo).';
  end if;
  if v_valor < 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Valor do serviço inválido.';
  end if;
  if p_id is not null and not exists (select 1 from public.os_servicos where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Serviço não encontrado.';
  end if;
  insert into public.os_servicos as s (id, empresa_id, nome, unidade, minutos_por_unidade, minutos_fixos, valor_unitario, setor, ativo)
  values (
    coalesce(p_id, gen_random_uuid()), p_empresa_id, v_nome, coalesce(nullif(left(trim(coalesce(p_dados ->> 'unidade', '')), 12), ''), 'un'),
    round(v_por, 2), round(v_fixo, 2), v_valor, nullif(left(trim(coalesce(p_dados ->> 'setor', '')), 60), ''),
    coalesce((p_dados ->> 'ativo')::boolean, true)
  )
  on conflict (id) do update set
    nome = excluded.nome, unidade = excluded.unidade, minutos_por_unidade = excluded.minutos_por_unidade,
    minutos_fixos = excluded.minutos_fixos, valor_unitario = excluded.valor_unitario, setor = excluded.setor, ativo = excluded.ativo
  returning s.id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um serviço com este nome.';
end;
$$;

create or replace function public.os_equipe_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text := nullif(left(trim(coalesce(p_dados ->> 'nome', '')), 80), '');
begin
  perform app.os_exigir(p_empresa_id, 'os.gerenciar');
  if v_nome is null or length(v_nome) < 2 then
    raise exception 'Informe o nome.';
  end if;
  if p_id is not null and not exists (select 1 from public.os_equipe where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Pessoa não encontrada.';
  end if;
  insert into public.os_equipe as e (id, empresa_id, nome, cor, ativo)
  values (coalesce(p_id, gen_random_uuid()), p_empresa_id, v_nome, coalesce(nullif(p_dados ->> 'cor', ''), '#2563eb'), coalesce((p_dados ->> 'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, cor = excluded.cor, ativo = excluded.ativo
  returning e.id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe alguém com este nome na equipe.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Abrir e alterar a OS (os.operar)
-- p_dados: cliente_nome, cliente_telefone, cliente_documento, descricao,
-- observacoes, prioridade, responsavel_id, prazo, itens: [{ servico_id?,
-- descricao?, quantidade, unidade?, minutos? (só item avulso), valor_unitario? }]
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
      prioridade, responsavel_id, prazo, previsao, minutos_estimados, valor_total, ordem
    ) values (
      v_id, p_empresa_id, v_numero, substr(translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789abcdefghijklmnopqrstuvwxyz0123'), 1, 12),
      left(trim(p_dados ->> 'cliente_nome'), 120), v_tel, v_doc,
      nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), ''), nullif(left(trim(coalesce(p_dados ->> 'observacoes', '')), 2000), ''),
      v_prio, v_resp, v_prazo, app.os_calcular_previsao(p_empresa_id, v_total_min, v_prio, null), v_total_min, v_total_valor,
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
      prioridade = v_prio, responsavel_id = v_resp, prazo = v_prazo, minutos_estimados = v_total_min, valor_total = v_total_valor
    where id = p_id;
    delete from public.os_itens where ordem_id = p_id;
    perform app.os_evento(p_empresa_id, p_id, 'editada', null, null, null);
  end if;

  insert into public.os_itens (empresa_id, ordem_id, servico_id, descricao, quantidade, unidade, minutos_estimados, valor_unitario, posicao)
  select p_empresa_id, v_id, nullif(x ->> 'servico_id', '')::uuid, x ->> 'descricao', (x ->> 'quantidade')::numeric, x ->> 'unidade',
         (x ->> 'minutos')::numeric, (x ->> 'valor')::numeric, (x ->> 'posicao')::int
    from jsonb_array_elements(v_itens) x;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Esteira: mover, pausar, retomar, responsável, cancelar
-- -----------------------------------------------------------------------------
create or replace function public.os_mover(p_id uuid, p_etapa text, p_posicao double precision default null, p_retirado_por text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  v_agora timestamptz := now();
  v_exec numeric;
  v_pausa numeric;
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
    retirado_por = case when p_etapa = 'entregue' then nullif(left(trim(coalesce(p_retirado_por, '')), 120), '') end
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'etapa', o.etapa, p_etapa,
    case when p_etapa = 'entregue' and nullif(trim(coalesce(p_retirado_por, '')), '') is not null then 'Retirado por ' || left(trim(p_retirado_por), 120) end);
end;
$$;

create or replace function public.os_pausar(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 200), '');
begin
  select * into o from public.os_ordens where id = p_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  if o.etapa <> 'execucao' then
    raise exception 'Só a OS em execução pode ser pausada.';
  end if;
  if o.pausada then
    raise exception 'A OS já está pausada.';
  end if;
  if v_motivo is null then
    raise exception 'Informe o motivo da pausa.';
  end if;
  update public.os_ordens set
    minutos_execucao = round(minutos_execucao + coalesce(extract(epoch from now() - execucao_desde) / 60, 0), 2),
    execucao_desde = null, pausada = true, pausada_em = now(), pausa_motivo = v_motivo
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'pausa', null, null, v_motivo);
end;
$$;

create or replace function public.os_retomar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
begin
  select * into o from public.os_ordens where id = p_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  if not o.pausada then
    raise exception 'A OS não está pausada.';
  end if;
  update public.os_ordens set
    minutos_pausa = round(minutos_pausa + extract(epoch from now() - pausada_em) / 60, 2),
    pausada = false, pausada_em = null, pausa_motivo = null, execucao_desde = now()
  where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'retomada', null, null, o.pausa_motivo);
end;
$$;

create or replace function public.os_atribuir(p_id uuid, p_responsavel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.os_ordens;
  v_nome text;
begin
  select * into o from public.os_ordens where id = p_id for update;
  if o.id is null then
    raise exception 'Ordem de serviço não encontrada.';
  end if;
  perform app.os_exigir(o.empresa_id, 'os.operar');
  if o.etapa in ('entregue', 'cancelada') then
    raise exception 'OS entregue ou cancelada não muda.';
  end if;
  if p_responsavel_id is not null then
    select nome into v_nome from public.os_equipe where id = p_responsavel_id and empresa_id = o.empresa_id;
    if v_nome is null then
      raise exception 'Responsável não encontrado.';
    end if;
  end if;
  update public.os_ordens set responsavel_id = p_responsavel_id where id = o.id;
  perform app.os_evento(o.empresa_id, o.id, 'responsavel', null, null, coalesce(v_nome, 'Sem responsável'));
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
-- 8. Acompanhamento pelo cliente (sem login): só o necessário
-- -----------------------------------------------------------------------------
create or replace function public.os_acompanhar(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'numero', o.numero,
    'etapa', o.etapa,
    'cliente', split_part(trim(o.cliente_nome), ' ', 1),
    'previsao', o.previsao,
    'prazo', o.prazo,
    'aberta_em', o.aberta_em,
    'pronta_em', o.pronta_em,
    'entregue_em', o.entregue_em,
    'pausada', o.pausada,
    'loja', coalesce(c.nome_exibicao, e.nome_fantasia, e.razao_social),
    'telefone', c.telefone,
    'servicos', (select coalesce(jsonb_agg(i.descricao order by i.posicao), '[]'::jsonb) from public.os_itens i where i.ordem_id = o.id)
  )
    from public.os_ordens o
    join public.empresas e on e.id = o.empresa_id
    left join public.os_config c on c.empresa_id = o.empresa_id
   where p_codigo ~ '^[a-z0-9]{12}$'
     and o.codigo_publico = p_codigo
     and not ('os' = any(e.ferramentas_desligadas));
$$;

-- -----------------------------------------------------------------------------
-- 9. RLS e privilégios
-- -----------------------------------------------------------------------------
alter table public.os_config enable row level security;
alter table public.os_servicos enable row level security;
alter table public.os_equipe enable row level security;
alter table public.os_ordens enable row level security;
alter table public.os_itens enable row level security;
alter table public.os_eventos enable row level security;

create policy os_config_leitura on public.os_config for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_servicos_leitura on public.os_servicos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_equipe_leitura on public.os_equipe for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_ordens_leitura on public.os_ordens for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_itens_leitura on public.os_itens for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));
create policy os_eventos_leitura on public.os_eventos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('os.operar'))::uuid[]));

grant select on public.os_config, public.os_servicos, public.os_equipe, public.os_ordens, public.os_itens, public.os_eventos to authenticated;
grant select, insert, update, delete on public.os_config, public.os_servicos, public.os_equipe, public.os_ordens, public.os_itens, public.os_eventos to service_role;

revoke execute on function app.os_exigir(uuid, text), app.os_cfg(uuid), app.os_evento(uuid, uuid, text, text, text, text),
  app.os_carga(uuid, text, uuid), app.os_calcular_previsao(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke execute on function public.os_previsao(uuid, numeric, text), public.os_configurar(uuid, jsonb), public.os_servico_salvar(uuid, uuid, jsonb),
  public.os_equipe_salvar(uuid, uuid, jsonb), public.os_salvar(uuid, uuid, jsonb), public.os_mover(uuid, text, double precision, text),
  public.os_pausar(uuid, text), public.os_retomar(uuid), public.os_atribuir(uuid, uuid), public.os_cancelar(uuid, text)
  from public, anon;
grant execute on function public.os_previsao(uuid, numeric, text), public.os_configurar(uuid, jsonb), public.os_servico_salvar(uuid, uuid, jsonb),
  public.os_equipe_salvar(uuid, uuid, jsonb), public.os_salvar(uuid, uuid, jsonb), public.os_mover(uuid, text, double precision, text),
  public.os_pausar(uuid, text), public.os_retomar(uuid), public.os_atribuir(uuid, uuid), public.os_cancelar(uuid, text)
  to authenticated;
-- Acompanhamento: público (só com o código aleatório da OS)
revoke execute on function public.os_acompanhar(text) from public;
grant execute on function public.os_acompanhar(text) to anon, authenticated;
