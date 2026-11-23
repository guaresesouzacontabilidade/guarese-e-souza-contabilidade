-- =============================================================================
-- Honorários do escritório: ficha de cada cliente, cobranças com Pix, robô de
-- cobrança (e-mail e WhatsApp) e o financeiro do próprio escritório (DRE)
--
--  * Só o administrador e quem ele autorizar na equipe mexem no financeiro do
--    escritório (fichas, cobranças, lançamentos, configuração).
--  * O cliente vê só as cobranças da própria empresa, depois de aprovadas.
--  * Todo dinheiro que entra ou sai tem descrição e a linha da DRE
--    (categoria). Sem categoria, o lançamento fica "a classificar" e não entra
--    na DRE.
--  * A baixa separa o valor dos honorários, os juros e a multa recebidos e o
--    desconto dado; cada item da cobrança vira a sua linha na DRE.
--  * O Pix "comum" (QR code com a chave do escritório) não confirma o
--    pagamento sozinho: a baixa é feita pelo escritório. Nada é simulado.
--  * O robô só lembra cobranças abertas; para quando a cobrança é paga ou
--    cancelada; não envia em fim de semana e feriado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Acesso: administrador ou quem ele autorizar na equipe
-- -----------------------------------------------------------------------------
create table public.honorarios_acessos (
  user_id uuid primary key references public.perfis(id) on delete cascade,
  concedido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  concedido_em timestamptz not null default now()
);
alter table public.honorarios_acessos enable row level security;
revoke insert, update, delete on public.honorarios_acessos from anon, authenticated;
grant select on public.honorarios_acessos to authenticated;
create policy honorarios_acessos_leitura on public.honorarios_acessos for select to authenticated
  using ((select app.is_admin()) or user_id = (select auth.uid()));

create or replace function app.pode_honorarios()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or (app.is_equipe() and exists (select 1 from public.honorarios_acessos a where a.user_id = auth.uid()));
$$;

create or replace function app.exigir_honorarios()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.pode_honorarios() then
    raise exception 'Só o administrador e quem ele autorizar mexem no financeiro do escritório.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.honorarios_acesso_definir(p_user_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador autoriza o acesso ao financeiro do escritório.' using errcode = '42501';
  end if;
  if p_ativo then
    if not exists (select 1 from public.perfis p where p.id = p_user_id and p.tipo = 'equipe' and p.ativo) then
      raise exception 'Escolha alguém ativo da equipe do escritório.' using errcode = 'P0001';
    end if;
    insert into public.honorarios_acessos (user_id) values (p_user_id) on conflict (user_id) do nothing;
  else
    delete from public.honorarios_acessos where user_id = p_user_id;
  end if;
end;
$$;

-- Texto "outubro/2026"
create or replace function app.mes_ano_br(p_data date)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from p_data)::int]
         || '/' || extract(year from p_data)::int;
$$;

-- -----------------------------------------------------------------------------
-- Configuração (uma linha)
-- -----------------------------------------------------------------------------
create table public.honorarios_config (
  id smallint primary key default 1 check (id = 1),
  -- Pix "comum" (BR Code estático) com a chave do escritório
  pix_chave text check (pix_chave is null or length(pix_chave) between 1 and 77),
  pix_tipo text check (pix_tipo is null or pix_tipo in ('cnpj', 'cpf', 'email', 'telefone', 'aleatoria')),
  pix_nome text check (pix_nome is null or length(pix_nome) between 1 and 25),
  pix_cidade text check (pix_cidade is null or length(pix_cidade) between 1 and 15),
  -- Geração do mês
  geracao_automatica boolean not null default true,
  dia_geracao smallint not null default 1 check (dia_geracao between 1 and 28),
  aprovacao_automatica boolean not null default false,
  competencia_referencia text not null default 'mes_anterior' check (competencia_referencia in ('mes_anterior', 'mes_atual')),
  -- Encargos de atraso
  cobrar_encargos boolean not null default true,
  multa_percentual numeric(5, 2) not null default 2 check (multa_percentual between 0 and 20),
  juros_mes_percentual numeric(5, 2) not null default 1 check (juros_mes_percentual between 0 and 10),
  -- Robô de cobrança: dias em relação ao vencimento (negativo = antes)
  robo_ativo boolean not null default true,
  regua int[] not null default array[-5, 0, 3, 10, 30]
    check (cardinality(regua) between 0 and 12 and -60 <= all (regua) and 180 >= all (regua)),
  email_ativo boolean not null default true,
  whatsapp_ativo boolean not null default false,
  whatsapp_template text check (whatsapp_template is null or whatsapp_template ~ '^[a-z0-9_]{1,512}$'),
  -- Textos editados pelo escritório (sem a chave, vale o texto padrão)
  mensagens jsonb not null default '{}'::jsonb check (jsonb_typeof(mensagens) = 'object' and pg_column_size(mensagens) < 20000),
  -- Ao receber: recibo assinado e publicado ao cliente
  recibo_automatico boolean not null default true,
  recibo_publicar boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfis(id) on delete set null
);
insert into public.honorarios_config (id) values (1) on conflict do nothing;
create trigger honorarios_config_updated_at before update on public.honorarios_config
  for each row execute function app.tg_updated_at();
create trigger auditoria_honorarios_config after insert or update or delete on public.honorarios_config
  for each row execute function app.tg_auditoria();
alter table public.honorarios_config enable row level security;
revoke insert, update, delete on public.honorarios_config from anon, authenticated;
grant select on public.honorarios_config to authenticated;
create policy honorarios_config_leitura on public.honorarios_config for select to authenticated using ((select app.pode_honorarios()));

-- -----------------------------------------------------------------------------
-- Plano de contas do escritório (linhas da DRE)
-- -----------------------------------------------------------------------------
create table public.escritorio_categorias (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[0-9]{1,2}(\.[0-9]{1,3}){0,2}$'),
  nome text not null check (length(trim(nome)) between 2 and 120),
  tipo text not null check (tipo in (
    'receita_operacional', 'deducao_receita', 'custo_servico', 'despesa_operacional',
    'receita_financeira', 'despesa_financeira', 'outras_receitas', 'outras_despesas', 'impostos_lucro',
    'investimento', 'aporte_socio', 'retirada_socio'
  )),
  -- Linhas que o portal usa sozinho (honorários, extras, juros, desconto...)
  chave text unique check (chave is null or chave ~ '^[A-Z0-9_]{2,30}$'),
  sistema boolean not null default false,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.escritorio_categorias enable row level security;
revoke insert, update, delete on public.escritorio_categorias from anon, authenticated;
grant select on public.escritorio_categorias to authenticated;
create policy escritorio_categorias_leitura on public.escritorio_categorias for select to authenticated using ((select app.pode_honorarios()));

insert into public.escritorio_categorias (codigo, nome, tipo, chave, sistema) values
  ('1.01', 'Honorários mensais', 'receita_operacional', 'HON_MENSAL', true),
  ('1.02', '13º honorário', 'receita_operacional', 'HON_13', true),
  ('1.03', 'Extras de honorário (funcionários e notas acima do limite)', 'receita_operacional', 'HON_EXTRA', true),
  ('1.04', 'Abertura, alteração e baixa de empresas', 'receita_operacional', 'SERV_SOCIETARIO', true),
  ('1.05', 'Imposto de renda pessoa física', 'receita_operacional', 'SERV_IRPF', true),
  ('1.06', 'Certidões, parcelamentos e outros serviços avulsos', 'receita_operacional', 'SERV_AVULSO', true),
  ('1.07', 'Consultoria e planejamento', 'receita_operacional', 'SERV_CONSULTORIA', true),
  ('2.01', 'Impostos sobre o faturamento (Simples, ISS)', 'deducao_receita', 'IMPOSTO_FATURAMENTO', true),
  ('2.02', 'Descontos concedidos a clientes', 'deducao_receita', 'DESCONTO', true),
  ('3.01', 'Salários e encargos da equipe', 'custo_servico', null, true),
  ('3.02', 'Sistemas e softwares contábeis', 'custo_servico', null, true),
  ('3.03', 'Certificados digitais e taxas de serviço', 'custo_servico', null, true),
  ('4.01', 'Aluguel e condomínio', 'despesa_operacional', null, true),
  ('4.02', 'Energia, água, internet e telefone', 'despesa_operacional', null, true),
  ('4.03', 'Material de escritório e limpeza', 'despesa_operacional', null, true),
  ('4.04', 'Marketing e publicidade', 'despesa_operacional', null, true),
  ('4.05', 'Conselho (CRC), associações e cursos', 'despesa_operacional', null, true),
  ('4.06', 'Serviços de terceiros (advogado, TI, contador)', 'despesa_operacional', null, true),
  ('4.07', 'Pró-labore dos sócios', 'despesa_operacional', null, true),
  ('4.08', 'Outras despesas administrativas', 'despesa_operacional', null, true),
  ('5.01', 'Juros e multas recebidos de clientes', 'receita_financeira', 'JUROS_MULTA', true),
  ('5.02', 'Rendimentos de aplicações', 'receita_financeira', null, true),
  ('6.01', 'Tarifas bancárias e do Pix', 'despesa_financeira', 'TARIFA', true),
  ('6.02', 'Juros e multas pagos', 'despesa_financeira', null, true),
  ('7.01', 'Outras receitas', 'outras_receitas', null, true),
  ('7.02', 'Outras despesas', 'outras_despesas', null, true),
  ('8.01', 'IRPJ e CSLL', 'impostos_lucro', null, true),
  ('9.01', 'Distribuição de lucros aos sócios', 'retirada_socio', null, true),
  ('9.02', 'Dinheiro colocado pelos sócios', 'aporte_socio', null, true),
  ('9.03', 'Compra de equipamentos e móveis', 'investimento', null, true);

create or replace function public.escritorio_categoria_salvar(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cat public.escritorio_categorias;
begin
  perform app.exigir_honorarios();
  if p_id is null then
    insert into public.escritorio_categorias (codigo, nome, tipo)
    values (trim(p_dados ->> 'codigo'), trim(p_dados ->> 'nome'), p_dados ->> 'tipo')
    returning id into v_id;
    return v_id;
  end if;
  select * into v_cat from public.escritorio_categorias where id = p_id;
  if v_cat.id is null then
    raise exception 'Categoria não encontrada.' using errcode = 'P0001';
  end if;
  -- Linhas do sistema: só o nome e se está ativa mudam (o tipo e o código seguem a DRE)
  update public.escritorio_categorias
     set nome = coalesce(nullif(trim(p_dados ->> 'nome'), ''), nome),
         codigo = case when v_cat.sistema then codigo else coalesce(nullif(trim(p_dados ->> 'codigo'), ''), codigo) end,
         tipo = case when v_cat.sistema then tipo else coalesce(nullif(p_dados ->> 'tipo', ''), tipo) end,
         ativa = case when v_cat.chave is not null then true else coalesce((p_dados ->> 'ativa')::boolean, ativa) end
   where id = p_id;
  return p_id;
exception
  when unique_violation then
    raise exception 'Já existe uma linha com esse código.' using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Ficha de honorários de cada cliente (uma por empresa)
-- -----------------------------------------------------------------------------
create table public.honorarios_fichas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  situacao text not null default 'ativa' check (situacao in ('ativa', 'pausada', 'encerrada')),
  valor_mensal numeric(12, 2) not null check (valor_mensal > 0 and valor_mensal < 1000000),
  dia_vencimento smallint not null check (dia_vencimento between 1 and 28),
  inicio date not null check (extract(day from inicio) = 1),
  fim date check (fim is null or extract(day from fim) = 1),
  servicos text[] not null default array[]::text[]
    check (servicos <@ array['contabil', 'fiscal', 'folha', 'societario', 'irpf', 'bpo_financeiro', 'consultoria', 'outros']),
  funcionarios_inclusos int check (funcionarios_inclusos is null or funcionarios_inclusos between 0 and 100000),
  valor_funcionario_extra numeric(10, 2) check (valor_funcionario_extra is null or valor_funcionario_extra between 0 and 100000),
  notas_inclusas int check (notas_inclusas is null or notas_inclusas between 0 and 1000000),
  valor_nota_extra numeric(10, 2) check (valor_nota_extra is null or valor_nota_extra between 0 and 100000),
  decimo_terceiro boolean not null default false,
  decimo_terceiro_mes smallint not null default 12 check (decimo_terceiro_mes between 1 and 12),
  reajuste_indice text not null default 'nenhum' check (reajuste_indice in ('nenhum', 'ipca', 'igpm', 'inpc')),
  reajuste_mes smallint check (reajuste_mes is null or reajuste_mes between 1 and 12),
  contato_nome text check (contato_nome is null or length(contato_nome) <= 120),
  contato_email text check (contato_email is null or contato_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contato_whatsapp text check (contato_whatsapp is null or contato_whatsapp ~ '^[0-9]{12,13}$'),
  whatsapp_autorizado boolean not null default false,
  canal_email boolean not null default true,
  canal_whatsapp boolean not null default true,
  robo_pausado_ate date,
  observacao text check (observacao is null or length(observacao) <= 1000),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint honorarios_fichas_periodo check (fim is null or fim >= inicio),
  constraint honorarios_fichas_extras check (
    (funcionarios_inclusos is null) = (valor_funcionario_extra is null)
    and (notas_inclusas is null) = (valor_nota_extra is null)
  )
);
create trigger honorarios_fichas_updated_at before update on public.honorarios_fichas
  for each row execute function app.tg_updated_at();
create trigger auditoria_honorarios_fichas after insert or update or delete on public.honorarios_fichas
  for each row execute function app.tg_auditoria();
alter table public.honorarios_fichas enable row level security;
revoke insert, update, delete on public.honorarios_fichas from anon, authenticated;
grant select on public.honorarios_fichas to authenticated;
create policy honorarios_fichas_leitura on public.honorarios_fichas for select to authenticated using ((select app.pode_honorarios()));

create or replace function public.honorarios_ficha_salvar(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_zap text := nullif(regexp_replace(coalesce(p_dados ->> 'contato_whatsapp', ''), '\D', '', 'g'), '');
begin
  perform app.exigir_honorarios();
  if v_zap is not null and length(v_zap) in (10, 11) then
    v_zap := '55' || v_zap;
  end if;
  if p_id is null then
    insert into public.honorarios_fichas (
      empresa_id, situacao, valor_mensal, dia_vencimento, inicio, fim, servicos,
      funcionarios_inclusos, valor_funcionario_extra, notas_inclusas, valor_nota_extra,
      decimo_terceiro, decimo_terceiro_mes, reajuste_indice, reajuste_mes,
      contato_nome, contato_email, contato_whatsapp, whatsapp_autorizado, canal_email, canal_whatsapp,
      robo_pausado_ate, observacao
    ) values (
      (p_dados ->> 'empresa_id')::uuid,
      coalesce(nullif(p_dados ->> 'situacao', ''), 'ativa'),
      (p_dados ->> 'valor_mensal')::numeric,
      (p_dados ->> 'dia_vencimento')::smallint,
      date_trunc('month', (p_dados ->> 'inicio')::date)::date,
      date_trunc('month', nullif(p_dados ->> 'fim', '')::date)::date,
      coalesce(array(select jsonb_array_elements_text(coalesce(p_dados -> 'servicos', '[]'::jsonb))), array[]::text[]),
      nullif(p_dados ->> 'funcionarios_inclusos', '')::int,
      nullif(p_dados ->> 'valor_funcionario_extra', '')::numeric,
      nullif(p_dados ->> 'notas_inclusas', '')::int,
      nullif(p_dados ->> 'valor_nota_extra', '')::numeric,
      coalesce((p_dados ->> 'decimo_terceiro')::boolean, false),
      coalesce(nullif(p_dados ->> 'decimo_terceiro_mes', '')::smallint, 12),
      coalesce(nullif(p_dados ->> 'reajuste_indice', ''), 'nenhum'),
      nullif(p_dados ->> 'reajuste_mes', '')::smallint,
      nullif(trim(p_dados ->> 'contato_nome'), ''),
      nullif(lower(trim(p_dados ->> 'contato_email')), ''),
      v_zap,
      coalesce((p_dados ->> 'whatsapp_autorizado')::boolean, false) and v_zap is not null,
      coalesce((p_dados ->> 'canal_email')::boolean, true),
      coalesce((p_dados ->> 'canal_whatsapp')::boolean, true),
      nullif(p_dados ->> 'robo_pausado_ate', '')::date,
      nullif(trim(p_dados ->> 'observacao'), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.honorarios_fichas f set
    situacao = coalesce(nullif(p_dados ->> 'situacao', ''), f.situacao),
    valor_mensal = (p_dados ->> 'valor_mensal')::numeric,
    dia_vencimento = (p_dados ->> 'dia_vencimento')::smallint,
    inicio = date_trunc('month', (p_dados ->> 'inicio')::date)::date,
    fim = date_trunc('month', nullif(p_dados ->> 'fim', '')::date)::date,
    servicos = coalesce(array(select jsonb_array_elements_text(coalesce(p_dados -> 'servicos', '[]'::jsonb))), array[]::text[]),
    funcionarios_inclusos = nullif(p_dados ->> 'funcionarios_inclusos', '')::int,
    valor_funcionario_extra = nullif(p_dados ->> 'valor_funcionario_extra', '')::numeric,
    notas_inclusas = nullif(p_dados ->> 'notas_inclusas', '')::int,
    valor_nota_extra = nullif(p_dados ->> 'valor_nota_extra', '')::numeric,
    decimo_terceiro = coalesce((p_dados ->> 'decimo_terceiro')::boolean, false),
    decimo_terceiro_mes = coalesce(nullif(p_dados ->> 'decimo_terceiro_mes', '')::smallint, 12),
    reajuste_indice = coalesce(nullif(p_dados ->> 'reajuste_indice', ''), 'nenhum'),
    reajuste_mes = nullif(p_dados ->> 'reajuste_mes', '')::smallint,
    contato_nome = nullif(trim(p_dados ->> 'contato_nome'), ''),
    contato_email = nullif(lower(trim(p_dados ->> 'contato_email')), ''),
    contato_whatsapp = v_zap,
    whatsapp_autorizado = coalesce((p_dados ->> 'whatsapp_autorizado')::boolean, false) and v_zap is not null,
    canal_email = coalesce((p_dados ->> 'canal_email')::boolean, true),
    canal_whatsapp = coalesce((p_dados ->> 'canal_whatsapp')::boolean, true),
    robo_pausado_ate = nullif(p_dados ->> 'robo_pausado_ate', '')::date,
    observacao = nullif(trim(p_dados ->> 'observacao'), '')
  where f.id = p_id
  returning f.id into v_id;
  if v_id is null then
    raise exception 'Ficha não encontrada.' using errcode = 'P0001';
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Esta empresa já tem uma ficha de honorários.' using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- Cobranças e itens
-- -----------------------------------------------------------------------------
create table public.honorarios_cobrancas (
  id uuid primary key default gen_random_uuid(),
  ano int not null check (ano between 2000 and 2100),
  numero int not null check (numero between 1 and 999999),
  tipo text not null check (tipo in ('mensal', 'avulsa')),
  empresa_id uuid references public.empresas(id) on delete set null,
  ficha_id uuid references public.honorarios_fichas(id) on delete set null,
  competencia date check (competencia is null or extract(day from competencia) = 1),
  pagador_nome text not null check (length(trim(pagador_nome)) between 2 and 200),
  pagador_documento text check (pagador_documento is null or pagador_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  contato_email text check (contato_email is null or contato_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contato_whatsapp text check (contato_whatsapp is null or contato_whatsapp ~ '^[0-9]{12,13}$'),
  whatsapp_autorizado boolean not null default false,
  descricao text not null check (length(trim(descricao)) between 3 and 200),
  valor numeric(12, 2) not null check (valor > 0 and valor < 10000000),
  vencimento date not null,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'aberta', 'paga', 'cancelada')),
  robo_ativo boolean not null default true,
  -- Encargos de atraso que valiam quando a cobrança foi aprovada
  cobrar_encargos boolean not null default true,
  multa_percentual numeric(5, 2) not null default 2 check (multa_percentual between 0 and 20),
  juros_mes_percentual numeric(5, 2) not null default 1 check (juros_mes_percentual between 0 and 10),
  -- Pix "comum" (copiado da configuração ao aprovar)
  pix_txid text unique check (pix_txid is null or pix_txid ~ '^[A-Za-z0-9]{1,25}$'),
  pix_chave text,
  pix_nome text,
  pix_cidade text,
  -- Link de pagamento (sem login) enviado ao cliente
  token_publico text unique check (token_publico is null or token_publico ~ '^[0-9a-f]{32}$'),
  aprovada_em timestamptz,
  aprovada_por uuid references public.perfis(id) on delete set null,
  -- Baixa
  pago_em date,
  valor_pago numeric(12, 2) check (valor_pago is null or valor_pago > 0),
  multa numeric(12, 2) not null default 0 check (multa >= 0),
  juros numeric(12, 2) not null default 0 check (juros >= 0),
  desconto numeric(12, 2) not null default 0 check (desconto >= 0),
  forma_pagamento text check (forma_pagamento is null or forma_pagamento in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque')),
  baixa_observacao text check (baixa_observacao is null or length(baixa_observacao) <= 300),
  baixada_por uuid references public.perfis(id) on delete set null,
  baixada_em timestamptz,
  recibo_id uuid references public.recibos_honorarios(id) on delete set null,
  -- Cancelamento
  cancelada_em timestamptz,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ano, numero),
  constraint honorarios_cobrancas_mensal check (tipo <> 'mensal' or (ficha_id is not null and competencia is not null)),
  constraint honorarios_cobrancas_paga check ((situacao = 'paga') = (pago_em is not null and valor_pago is not null)),
  constraint honorarios_cobrancas_cancelada check ((situacao = 'cancelada') = (cancelada_em is not null))
);
create unique index honorarios_cobrancas_mes_unico on public.honorarios_cobrancas (ficha_id, competencia)
  where tipo = 'mensal' and situacao <> 'cancelada';
create index honorarios_cobrancas_empresa_idx on public.honorarios_cobrancas (empresa_id, vencimento desc);
create index honorarios_cobrancas_situacao_idx on public.honorarios_cobrancas (situacao, vencimento);
create trigger honorarios_cobrancas_updated_at before update on public.honorarios_cobrancas
  for each row execute function app.tg_updated_at();
create trigger auditoria_honorarios_cobrancas after insert or update or delete on public.honorarios_cobrancas
  for each row execute function app.tg_auditoria();
alter table public.honorarios_cobrancas enable row level security;
revoke insert, update, delete on public.honorarios_cobrancas from anon, authenticated;
grant select on public.honorarios_cobrancas to authenticated;
-- Escritório autorizado vê todas; o cliente vê só as da própria empresa, depois de aprovadas
create policy honorarios_cobrancas_leitura on public.honorarios_cobrancas for select to authenticated using (
  (select app.pode_honorarios())
  or (not (select app.is_equipe()) and situacao in ('aberta', 'paga') and empresa_id is not null and app.pode(empresa_id, 'financeiro.ver'))
);

create table public.honorarios_cobranca_itens (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.honorarios_cobrancas(id) on delete cascade,
  ordem smallint not null default 0,
  descricao text not null check (length(trim(descricao)) between 2 and 200),
  categoria_id uuid not null references public.escritorio_categorias(id),
  quantidade numeric(12, 3) not null default 1 check (quantidade > 0),
  valor_unitario numeric(12, 2) not null check (valor_unitario > 0),
  valor numeric(12, 2) not null check (valor > 0)
);
create index honorarios_cobranca_itens_cobranca_idx on public.honorarios_cobranca_itens (cobranca_id, ordem);
alter table public.honorarios_cobranca_itens enable row level security;
revoke insert, update, delete on public.honorarios_cobranca_itens from anon, authenticated;
grant select on public.honorarios_cobranca_itens to authenticated;
create policy honorarios_cobranca_itens_leitura on public.honorarios_cobranca_itens for select to authenticated using (
  exists (select 1 from public.honorarios_cobrancas c where c.id = cobranca_id)
);

-- Encargos de atraso (multa fixa + juros simples por dia), iguais aos da tela
create or replace function app.honorarios_encargos(p_valor numeric, p_vencimento date, p_data date, p_multa numeric, p_juros_mes numeric)
returns table (multa numeric, juros numeric)
language sql
immutable
set search_path = ''
as $$
  select case when p_data > p_vencimento then round(p_valor * p_multa / 100, 2) else 0 end,
         case when p_data > p_vencimento then round(p_valor * p_juros_mes / 100 / 30 * (p_data - p_vencimento), 2) else 0 end;
$$;

-- Próximo número de cobrança do ano (um de cada vez)
create or replace function app.honorarios_numero(p_ano int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  perform pg_advisory_xact_lock(hashtextextended('honorarios_cobrancas:' || p_ano, 0));
  select coalesce(max(numero), 0) + 1 into v from public.honorarios_cobrancas where ano = p_ano;
  return v;
end;
$$;

-- Grava os itens (lista JSON) e devolve o total. Itens só em linhas de receita.
create or replace function app.honorarios_gravar_itens(p_cobranca_id uuid, p_itens jsonb)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_ordem int := 0;
  v_total numeric := 0;
  v_qtd numeric;
  v_unit numeric;
  v_valor numeric;
  v_cat public.escritorio_categorias;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'A cobrança precisa de pelo menos um item.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_itens) > 30 then
    raise exception 'No máximo 30 itens por cobrança.' using errcode = 'P0001';
  end if;
  delete from public.honorarios_cobranca_itens where cobranca_id = p_cobranca_id;
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_cat from public.escritorio_categorias c where c.id = nullif(v_item ->> 'categoria_id', '')::uuid;
    if v_cat.id is null or v_cat.tipo <> 'receita_operacional' then
      raise exception 'Escolha a linha da DRE de cada item (uma receita de serviço).' using errcode = 'P0001';
    end if;
    v_qtd := coalesce(nullif(v_item ->> 'quantidade', '')::numeric, 1);
    v_unit := (v_item ->> 'valor_unitario')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_unit is null or v_unit <= 0 then
      raise exception 'Cada item precisa de quantidade e valor maiores que zero.' using errcode = 'P0001';
    end if;
    v_valor := round(v_qtd * v_unit, 2);
    insert into public.honorarios_cobranca_itens (cobranca_id, ordem, descricao, categoria_id, quantidade, valor_unitario, valor)
    values (p_cobranca_id, v_ordem, trim(v_item ->> 'descricao'), v_cat.id, v_qtd, v_unit, v_valor);
    v_ordem := v_ordem + 1;
    v_total := v_total + v_valor;
  end loop;
  return v_total;
end;
$$;

-- Itens do mês de uma ficha: honorário, extras (funcionários e notas do mês acima do limite) e 13º
create or replace function app.honorarios_itens_mes(p_ficha public.honorarios_fichas, p_competencia date, p_vencimento date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_itens jsonb := '[]'::jsonb;
  v_fim date := (p_competencia + interval '1 month - 1 day')::date;
  v_func int;
  v_notas int;
  v_extra int;
begin
  v_itens := v_itens || jsonb_build_object(
    'descricao', 'Honorários contábeis — ' || app.mes_ano_br(p_competencia),
    'categoria_id', (select id from public.escritorio_categorias where chave = 'HON_MENSAL'),
    'quantidade', 1, 'valor_unitario', p_ficha.valor_mensal);
  if p_ficha.funcionarios_inclusos is not null and p_ficha.valor_funcionario_extra > 0 then
    select count(*) into v_func from public.colaboradores c
     where c.empresa_id = p_ficha.empresa_id and c.admissao <= v_fim and (c.desligamento is null or c.desligamento >= p_competencia);
    v_extra := v_func - p_ficha.funcionarios_inclusos;
    if v_extra > 0 then
      v_itens := v_itens || jsonb_build_object(
        'descricao', format('Funcionários acima do limite (%s de %s no mês)', v_func, p_ficha.funcionarios_inclusos),
        'categoria_id', (select id from public.escritorio_categorias where chave = 'HON_EXTRA'),
        'quantidade', v_extra, 'valor_unitario', p_ficha.valor_funcionario_extra);
    end if;
  end if;
  if p_ficha.notas_inclusas is not null and p_ficha.valor_nota_extra > 0 then
    select count(*) into v_notas from public.documentos_fiscais d
     where d.empresa_id = p_ficha.empresa_id and d.competencia = p_competencia
       and d.operacao in ('entrada', 'saida') and not d.cancelada_evento;
    v_extra := v_notas - p_ficha.notas_inclusas;
    if v_extra > 0 then
      v_itens := v_itens || jsonb_build_object(
        'descricao', format('Notas fiscais acima do limite (%s de %s no mês)', v_notas, p_ficha.notas_inclusas),
        'categoria_id', (select id from public.escritorio_categorias where chave = 'HON_EXTRA'),
        'quantidade', v_extra, 'valor_unitario', p_ficha.valor_nota_extra);
    end if;
  end if;
  if p_ficha.decimo_terceiro and extract(month from p_vencimento) = p_ficha.decimo_terceiro_mes then
    v_itens := v_itens || jsonb_build_object(
      'descricao', '13º honorário de ' || extract(year from p_vencimento)::int,
      'categoria_id', (select id from public.escritorio_categorias where chave = 'HON_13'),
      'quantidade', 1, 'valor_unitario', p_ficha.valor_mensal);
  end if;
  return v_itens;
end;
$$;

-- Gera as cobranças mensais (rascunho) das fichas ativas para um mês de referência
create table public.honorarios_geracoes (
  competencia date primary key check (extract(day from competencia) = 1),
  quantidade int not null default 0,
  automatica boolean not null default false,
  gerado_por uuid references public.perfis(id) on delete set null,
  gerado_em timestamptz not null default now()
);
alter table public.honorarios_geracoes enable row level security;
revoke insert, update, delete on public.honorarios_geracoes from anon, authenticated;
grant select on public.honorarios_geracoes to authenticated;
create policy honorarios_geracoes_leitura on public.honorarios_geracoes for select to authenticated using ((select app.pode_honorarios()));

create or replace function app.honorarios_gerar_mes(p_competencia date, p_automatica boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.honorarios_config;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_mes_venc date;
  v_venc date;
  v_ficha public.honorarios_fichas;
  v_emp public.empresas;
  v_id uuid;
  v_total numeric;
  v_qtd int := 0;
begin
  select * into v_cfg from public.honorarios_config where id = 1;
  v_mes_venc := case when v_cfg.competencia_referencia = 'mes_anterior' then (v_comp + interval '1 month')::date else v_comp end;
  for v_ficha in
    select f.* from public.honorarios_fichas f
      join public.empresas e on e.id = f.empresa_id and e.ativa
     where f.situacao = 'ativa' and f.inicio <= v_comp and (f.fim is null or f.fim >= v_comp)
       and not exists (select 1 from public.honorarios_cobrancas c
                        where c.ficha_id = f.id and c.competencia = v_comp and c.tipo = 'mensal' and c.situacao <> 'cancelada')
  loop
    select * into v_emp from public.empresas where id = v_ficha.empresa_id;
    v_venc := make_date(extract(year from v_mes_venc)::int, extract(month from v_mes_venc)::int, v_ficha.dia_vencimento);
    insert into public.honorarios_cobrancas (
      ano, numero, tipo, empresa_id, ficha_id, competencia, pagador_nome, pagador_documento,
      contato_email, contato_whatsapp, whatsapp_autorizado, descricao, valor, vencimento, criado_por
    ) values (
      extract(year from v_venc)::int, app.honorarios_numero(extract(year from v_venc)::int), 'mensal',
      v_ficha.empresa_id, v_ficha.id, v_comp, v_emp.razao_social,
      nullif(regexp_replace(coalesce(v_emp.documento, ''), '\D', '', 'g'), ''),
      v_ficha.contato_email, v_ficha.contato_whatsapp, v_ficha.whatsapp_autorizado,
      'Honorários contábeis — ' || app.mes_ano_br(v_comp), 1, v_venc, auth.uid()
    ) returning id into v_id;
    v_total := app.honorarios_gravar_itens(v_id, app.honorarios_itens_mes(v_ficha, v_comp, v_venc));
    update public.honorarios_cobrancas set valor = v_total where id = v_id;
    v_qtd := v_qtd + 1;
  end loop;
  insert into public.honorarios_geracoes (competencia, quantidade, automatica, gerado_por)
  values (v_comp, v_qtd, p_automatica, auth.uid())
  on conflict (competencia) do update set quantidade = public.honorarios_geracoes.quantidade + excluded.quantidade,
                                          gerado_em = now(), gerado_por = coalesce(excluded.gerado_por, public.honorarios_geracoes.gerado_por);
  return v_qtd;
end;
$$;

create or replace function public.honorarios_gerar(p_competencia date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  if p_competencia is null or p_competencia > (now() at time zone 'America/Sao_Paulo')::date + 62 then
    raise exception 'Escolha o mês de referência das cobranças.' using errcode = 'P0001';
  end if;
  return app.honorarios_gerar_mes(p_competencia, false);
end;
$$;

-- Cobrança avulsa (ou edição de rascunho/aberta)
create or replace function public.honorarios_cobranca_salvar(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_c public.honorarios_cobrancas;
  v_emp public.empresas;
  v_empresa uuid := nullif(p_dados ->> 'empresa_id', '')::uuid;
  v_venc date := (p_dados ->> 'vencimento')::date;
  v_nome text := nullif(trim(p_dados ->> 'pagador_nome'), '');
  v_doc text := nullif(regexp_replace(coalesce(p_dados ->> 'pagador_documento', ''), '\D', '', 'g'), '');
  v_zap text := nullif(regexp_replace(coalesce(p_dados ->> 'contato_whatsapp', ''), '\D', '', 'g'), '');
  v_ficha public.honorarios_fichas;
  v_total numeric;
begin
  perform app.exigir_honorarios();
  if v_venc is null then
    raise exception 'Informe o vencimento.' using errcode = 'P0001';
  end if;
  if v_zap is not null and length(v_zap) in (10, 11) then
    v_zap := '55' || v_zap;
  end if;

  if p_id is not null then
    select * into v_c from public.honorarios_cobrancas where id = p_id for update;
    if v_c.id is null then
      raise exception 'Cobrança não encontrada.' using errcode = 'P0001';
    end if;
    if v_c.situacao not in ('rascunho', 'aberta') then
      raise exception 'Cobrança paga ou cancelada não muda.' using errcode = 'P0001';
    end if;
    update public.honorarios_cobrancas set
      descricao = coalesce(nullif(trim(p_dados ->> 'descricao'), ''), descricao),
      vencimento = v_venc,
      contato_email = case when p_dados ? 'contato_email' then nullif(lower(trim(p_dados ->> 'contato_email')), '') else contato_email end,
      contato_whatsapp = case when p_dados ? 'contato_whatsapp' then v_zap else contato_whatsapp end,
      whatsapp_autorizado = case when p_dados ? 'whatsapp_autorizado' then coalesce((p_dados ->> 'whatsapp_autorizado')::boolean, false) and v_zap is not null else whatsapp_autorizado end,
      robo_ativo = coalesce((p_dados ->> 'robo_ativo')::boolean, robo_ativo)
    where id = p_id;
    if p_dados ? 'itens' then
      v_total := app.honorarios_gravar_itens(p_id, p_dados -> 'itens');
      update public.honorarios_cobrancas set valor = v_total where id = p_id;
    end if;
    return p_id;
  end if;

  -- Nova (avulsa): empresa da carteira ou pagador de fora
  if v_empresa is not null then
    select * into v_emp from public.empresas where id = v_empresa;
    if v_emp.id is null then
      raise exception 'Empresa não encontrada.' using errcode = 'P0001';
    end if;
    select * into v_ficha from public.honorarios_fichas where empresa_id = v_empresa;
    v_nome := coalesce(v_nome, v_emp.razao_social);
    v_doc := coalesce(v_doc, nullif(regexp_replace(coalesce(v_emp.documento, ''), '\D', '', 'g'), ''));
  end if;
  if v_nome is null then
    raise exception 'Informe para quem é a cobrança.' using errcode = 'P0001';
  end if;
  insert into public.honorarios_cobrancas (
    ano, numero, tipo, empresa_id, ficha_id, competencia, pagador_nome, pagador_documento,
    contato_email, contato_whatsapp, whatsapp_autorizado, descricao, valor, vencimento
  ) values (
    extract(year from v_venc)::int, app.honorarios_numero(extract(year from v_venc)::int), 'avulsa',
    v_empresa, v_ficha.id, nullif(p_dados ->> 'competencia', '')::date, v_nome, v_doc,
    coalesce(nullif(lower(trim(p_dados ->> 'contato_email')), ''), v_ficha.contato_email),
    coalesce(v_zap, v_ficha.contato_whatsapp),
    case when v_zap is not null then coalesce((p_dados ->> 'whatsapp_autorizado')::boolean, false) else coalesce(v_ficha.whatsapp_autorizado, false) end,
    trim(p_dados ->> 'descricao'), 1, v_venc
  ) returning id into v_id;
  v_total := app.honorarios_gravar_itens(v_id, p_dados -> 'itens');
  update public.honorarios_cobrancas set valor = v_total where id = v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Envios do robô (histórico por cobrança)
-- -----------------------------------------------------------------------------
create table public.honorarios_lembretes (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references public.honorarios_cobrancas(id) on delete cascade,
  motivo text not null check (motivo in ('emissao', 'lembrete', 'manual', 'pagamento')),
  dias int,
  canal text not null check (canal in ('email', 'whatsapp', 'nenhum')),
  situacao text not null default 'agendado' check (situacao in ('agendado', 'pulado', 'sem_contato')),
  envio_id uuid references public.envios(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint honorarios_lembretes_dias check ((motivo = 'lembrete') = (dias is not null))
);
create unique index honorarios_lembretes_etapa_unica on public.honorarios_lembretes (cobranca_id, dias, canal) where motivo = 'lembrete';
create index honorarios_lembretes_cobranca_idx on public.honorarios_lembretes (cobranca_id, criado_em desc);
create index honorarios_lembretes_envio_idx on public.honorarios_lembretes (envio_id);
alter table public.honorarios_lembretes enable row level security;
revoke insert, update, delete on public.honorarios_lembretes from anon, authenticated;
grant select on public.honorarios_lembretes to authenticated;
create policy honorarios_lembretes_leitura on public.honorarios_lembretes for select to authenticated using ((select app.pode_honorarios()));

-- Agenda o envio de uma cobrança pelos canais disponíveis (e-mail e WhatsApp)
create or replace function app.honorarios_agendar(p_cobranca_id uuid, p_motivo text, p_dias int, p_quando timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_cobrancas;
  v_f public.honorarios_fichas;
  v_cfg public.honorarios_config;
  v_canal text;
  v_dest text;
  v_envio uuid;
  v_assunto text;
  v_qtd int := 0;
begin
  select * into v_c from public.honorarios_cobrancas where id = p_cobranca_id;
  select * into v_cfg from public.honorarios_config where id = 1;
  if v_c.ficha_id is not null then
    select * into v_f from public.honorarios_fichas where id = v_c.ficha_id;
  end if;
  v_assunto := case p_motivo
    when 'pagamento' then 'Pagamento recebido: ' || v_c.descricao
    when 'lembrete' then case when p_dias < 0 then format('Lembrete (%s dias antes): ', -p_dias)
                              when p_dias = 0 then 'Vence hoje: '
                              else format('Em aberto há %s dias: ', p_dias) end || v_c.descricao
    else 'Cobrança: ' || v_c.descricao end;

  foreach v_canal in array array['email', 'whatsapp'] loop
    v_dest := null;
    if v_canal = 'email' and v_cfg.email_ativo and coalesce(v_f.canal_email, true) then
      v_dest := v_c.contato_email;
    elsif v_canal = 'whatsapp' and p_motivo <> 'pagamento' and v_cfg.whatsapp_ativo and coalesce(v_f.canal_whatsapp, true) and v_c.whatsapp_autorizado then
      v_dest := v_c.contato_whatsapp;
    end if;
    continue when v_dest is null;
    insert into public.envios (empresa_id, canal, destinatario, assunto, conteudo, tipo, referencia_tipo, referencia_id, solicitado_por)
    values (v_c.empresa_id, v_canal, v_dest, v_assunto,
            format('%s · %s · vencimento %s', v_c.descricao, app.moeda_br(v_c.valor), to_char(v_c.vencimento, 'DD/MM/YYYY')),
            'cobranca', 'honorarios_cobranca', v_c.id::text, auth.uid())
    returning id into v_envio;
    insert into public.honorarios_lembretes (cobranca_id, motivo, dias, canal, envio_id)
    values (v_c.id, p_motivo, p_dias, v_canal, v_envio);
    perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), v_c.empresa_id, 'envio:' || v_envio::text,
                           greatest(coalesce(p_quando, now()), now()), 60);
    v_qtd := v_qtd + 1;
  end loop;
  if v_qtd = 0 then
    insert into public.honorarios_lembretes (cobranca_id, motivo, dias, canal, situacao)
    values (v_c.id, p_motivo, p_dias, 'nenhum', 'sem_contato');
  end if;
  return v_qtd;
end;
$$;

-- Avisa no sino do portal quem cuida do financeiro da empresa cliente
create or replace function app.honorarios_avisar_cliente(p_cobranca_id uuid, p_titulo text, p_corpo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_cobrancas;
  v_user uuid;
begin
  select * into v_c from public.honorarios_cobrancas where id = p_cobranca_id;
  if v_c.empresa_id is null then
    return;
  end if;
  for v_user in
    select m.user_id from public.empresa_membros m
     where m.empresa_id = v_c.empresa_id and m.ativo and m.papel <> 'equipe' and 'financeiro.ver' = any (m.permissoes)
  loop
    perform app.notificar(v_user, v_c.empresa_id, 'honorario', p_titulo, p_corpo, '/e/' || v_c.empresa_id || '/honorarios', false);
  end loop;
end;
$$;

-- Aprova rascunhos: copia o Pix, cria o link de pagamento, envia ao cliente
create or replace function app.honorarios_aprovar(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.honorarios_config;
  v_c public.honorarios_cobrancas;
  v_qtd int := 0;
begin
  select * into v_cfg from public.honorarios_config where id = 1;
  for v_c in
    select * from public.honorarios_cobrancas where id = any (p_ids) and situacao = 'rascunho' order by ano, numero for update
  loop
    update public.honorarios_cobrancas set
      situacao = 'aberta',
      aprovada_em = now(),
      aprovada_por = auth.uid(),
      pix_txid = 'HON' || ano || lpad(numero::text, 6, '0'),
      pix_chave = v_cfg.pix_chave,
      pix_nome = v_cfg.pix_nome,
      pix_cidade = v_cfg.pix_cidade,
      cobrar_encargos = v_cfg.cobrar_encargos,
      multa_percentual = v_cfg.multa_percentual,
      juros_mes_percentual = v_cfg.juros_mes_percentual,
      token_publico = encode(extensions.gen_random_bytes(16), 'hex')
    where id = v_c.id;
    perform app.honorarios_agendar(v_c.id, 'emissao', null, now());
    perform app.honorarios_avisar_cliente(v_c.id, v_c.descricao || ' disponível',
      format('Valor %s, vencimento %s. Pague pelo Pix no portal.', app.moeda_br(v_c.valor), to_char(v_c.vencimento, 'DD/MM/YYYY')));
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

create or replace function public.honorarios_cobrancas_aprovar(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  return app.honorarios_aprovar(p_ids);
end;
$$;

-- Reenvia agora (e-mail e WhatsApp)
create or replace function public.honorarios_cobranca_reenviar(p_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_situacao text;
begin
  perform app.exigir_honorarios();
  select situacao into v_situacao from public.honorarios_cobrancas where id = p_id;
  if v_situacao is distinct from 'aberta' then
    raise exception 'Só cobranças em aberto são reenviadas.' using errcode = 'P0001';
  end if;
  return app.honorarios_agendar(p_id, 'manual', null, now());
end;
$$;

create or replace function public.honorarios_cobranca_cancelar(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  update public.honorarios_cobrancas
     set situacao = 'cancelada', cancelada_em = now(), motivo_cancelamento = trim(p_motivo)
   where id = p_id and situacao in ('rascunho', 'aberta');
  if not found then
    raise exception 'Só cobranças em rascunho ou em aberto são canceladas.' using errcode = 'P0001';
  end if;
  -- Envios ainda na fila não saem mais
  update public.envios e set status = 'desativado', erro = 'Cobrança cancelada.'
    from public.honorarios_lembretes l
   where l.cobranca_id = p_id and l.envio_id = e.id and e.status = 'pendente';
end;
$$;

-- -----------------------------------------------------------------------------
-- Lançamentos do escritório (a base da DRE)
-- -----------------------------------------------------------------------------
create table public.escritorio_lancamentos (
  id uuid primary key default gen_random_uuid(),
  natureza text not null check (natureza in ('receita', 'despesa')),
  data date not null,
  competencia date not null check (extract(day from competencia) = 1),
  descricao text not null check (length(trim(descricao)) between 3 and 300),
  valor numeric(14, 2) not null check (valor > 0 and valor < 100000000),
  -- Sem categoria = "a classificar" (fora da DRE)
  categoria_id uuid references public.escritorio_categorias(id),
  empresa_id uuid references public.empresas(id) on delete set null,
  cobranca_id uuid references public.honorarios_cobrancas(id) on delete restrict,
  origem text not null default 'manual' check (origem in ('cobranca', 'manual', 'extrato')),
  forma_pagamento text check (forma_pagamento is null or forma_pagamento in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque', 'debito')),
  observacao text check (observacao is null or length(observacao) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index escritorio_lancamentos_competencia_idx on public.escritorio_lancamentos (competencia);
create index escritorio_lancamentos_data_idx on public.escritorio_lancamentos (data);
create index escritorio_lancamentos_classificar_idx on public.escritorio_lancamentos (data) where categoria_id is null;
create index escritorio_lancamentos_cobranca_idx on public.escritorio_lancamentos (cobranca_id);
create trigger escritorio_lancamentos_updated_at before update on public.escritorio_lancamentos
  for each row execute function app.tg_updated_at();
create trigger auditoria_escritorio_lancamentos after insert or update or delete on public.escritorio_lancamentos
  for each row execute function app.tg_auditoria();
alter table public.escritorio_lancamentos enable row level security;
revoke insert, update, delete on public.escritorio_lancamentos from anon, authenticated;
grant select on public.escritorio_lancamentos to authenticated;
create policy escritorio_lancamentos_leitura on public.escritorio_lancamentos for select to authenticated using ((select app.pode_honorarios()));

-- A natureza do lançamento segue a linha da DRE escolhida
create or replace function app.tg_escritorio_lancamentos_regras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tipo text;
begin
  if new.categoria_id is not null then
    select tipo into v_tipo from public.escritorio_categorias where id = new.categoria_id;
    if app.natureza_tipo_categoria(v_tipo) <> new.natureza then
      raise exception 'A linha da DRE escolhida é de %, mas o lançamento é de %.',
        case when new.natureza = 'receita' then 'despesa' else 'receita' end, new.natureza using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger escritorio_lancamentos_regras before insert or update on public.escritorio_lancamentos
  for each row execute function app.tg_escritorio_lancamentos_regras();

-- Lançamento manual (receita ou despesa), classificação e correção
create or replace function public.escritorio_lancamento_salvar(p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_l public.escritorio_lancamentos;
  v_data date := (p_dados ->> 'data')::date;
  v_desc text := trim(coalesce(p_dados ->> 'descricao', ''));
begin
  perform app.exigir_honorarios();
  if length(v_desc) < 3 then
    raise exception 'Escreva a descrição do lançamento (ela aparece na DRE).' using errcode = 'P0001';
  end if;
  if p_id is null then
    if v_data is null then
      raise exception 'Informe a data.' using errcode = 'P0001';
    end if;
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, origem, forma_pagamento, observacao)
    values (
      p_dados ->> 'natureza', v_data,
      coalesce(date_trunc('month', nullif(p_dados ->> 'competencia', '')::date)::date, date_trunc('month', v_data)::date),
      v_desc, (p_dados ->> 'valor')::numeric,
      nullif(p_dados ->> 'categoria_id', '')::uuid,
      nullif(p_dados ->> 'empresa_id', '')::uuid,
      case when p_dados ->> 'origem' = 'extrato' then 'extrato' else 'manual' end,
      nullif(p_dados ->> 'forma_pagamento', ''),
      nullif(trim(p_dados ->> 'observacao'), '')
    ) returning id into v_id;
    return v_id;
  end if;

  select * into v_l from public.escritorio_lancamentos where id = p_id;
  if v_l.id is null then
    raise exception 'Lançamento não encontrado.' using errcode = 'P0001';
  end if;
  if v_l.origem = 'cobranca' then
    -- Os de cobrança mudam só a descrição e a linha da DRE (valores vêm da baixa)
    update public.escritorio_lancamentos
       set descricao = v_desc,
           categoria_id = coalesce(nullif(p_dados ->> 'categoria_id', '')::uuid, categoria_id)
     where id = p_id;
  else
    update public.escritorio_lancamentos set
      natureza = coalesce(nullif(p_dados ->> 'natureza', ''), natureza),
      data = coalesce(v_data, data),
      competencia = coalesce(date_trunc('month', nullif(p_dados ->> 'competencia', '')::date)::date, date_trunc('month', coalesce(v_data, data))::date),
      descricao = v_desc,
      valor = coalesce(nullif(p_dados ->> 'valor', '')::numeric, valor),
      categoria_id = nullif(p_dados ->> 'categoria_id', '')::uuid,
      empresa_id = nullif(p_dados ->> 'empresa_id', '')::uuid,
      forma_pagamento = nullif(p_dados ->> 'forma_pagamento', ''),
      observacao = nullif(trim(p_dados ->> 'observacao'), '')
    where id = p_id;
  end if;
  return p_id;
end;
$$;

create or replace function public.escritorio_lancamento_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  delete from public.escritorio_lancamentos where id = p_id and origem <> 'cobranca';
  if not found then
    raise exception 'Lançamento de cobrança sai só ao desfazer o pagamento da cobrança.' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Baixa (pagamento recebido): lançamentos por item, juros/multa e desconto
-- -----------------------------------------------------------------------------
create or replace function public.honorarios_cobranca_baixar(p_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_cobrancas;
  v_data date := (p_dados ->> 'pago_em')::date;
  v_pago numeric := (p_dados ->> 'valor_pago')::numeric;
  v_desconto numeric := coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0);
  v_forma text := coalesce(nullif(p_dados ->> 'forma_pagamento', ''), 'pix');
  v_encargos numeric;
  v_multa numeric := 0;
  v_juros numeric := 0;
  v_calc record;
  v_item record;
  v_comp date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform app.exigir_honorarios();
  select * into v_c from public.honorarios_cobrancas where id = p_id for update;
  if v_c.id is null then
    raise exception 'Cobrança não encontrada.' using errcode = 'P0001';
  end if;
  if v_c.situacao <> 'aberta' then
    raise exception 'Só cobranças em aberto recebem baixa.' using errcode = 'P0001';
  end if;
  if v_data is null or v_data > v_hoje then
    raise exception 'Informe a data do pagamento (até hoje).' using errcode = 'P0001';
  end if;
  if v_pago is null or v_pago <= 0 then
    raise exception 'Informe o valor recebido.' using errcode = 'P0001';
  end if;
  if v_desconto < 0 or v_desconto >= v_c.valor then
    raise exception 'Desconto inválido.' using errcode = 'P0001';
  end if;
  v_encargos := v_pago - v_c.valor + v_desconto;
  if v_encargos < 0 then
    raise exception 'O valor recebido é menor que o da cobrança. Informe o desconto dado (%).', app.moeda_br(-v_encargos) using errcode = 'P0001';
  end if;
  if v_encargos > 0 then
    select * into v_calc from app.honorarios_encargos(v_c.valor, v_c.vencimento, v_data, v_c.multa_percentual, v_c.juros_mes_percentual);
    v_multa := least(v_encargos, coalesce(v_calc.multa, 0));
    v_juros := v_encargos - v_multa;
  end if;

  update public.honorarios_cobrancas set
    situacao = 'paga', pago_em = v_data, valor_pago = v_pago, multa = v_multa, juros = v_juros, desconto = v_desconto,
    forma_pagamento = v_forma, baixa_observacao = nullif(trim(p_dados ->> 'observacao'), ''),
    baixada_por = auth.uid(), baixada_em = now()
  where id = p_id;

  -- DRE: cada item na sua linha; desconto e juros/multa separados
  v_comp := coalesce(v_c.competencia, date_trunc('month', v_data)::date);
  for v_item in select i.* from public.honorarios_cobranca_itens i where i.cobranca_id = p_id order by i.ordem loop
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, cobranca_id, origem, forma_pagamento)
    values ('receita', v_data, v_comp, left(v_item.descricao || ' — ' || v_c.pagador_nome, 300), v_item.valor, v_item.categoria_id,
            v_c.empresa_id, p_id, 'cobranca', v_forma);
  end loop;
  if v_desconto > 0 then
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, cobranca_id, origem, forma_pagamento)
    values ('despesa', v_data, v_comp, left('Desconto concedido — ' || v_c.descricao || ' — ' || v_c.pagador_nome, 300), v_desconto,
            (select id from public.escritorio_categorias where chave = 'DESCONTO'), v_c.empresa_id, p_id, 'cobranca', v_forma);
  end if;
  if v_encargos > 0 then
    insert into public.escritorio_lancamentos (natureza, data, competencia, descricao, valor, categoria_id, empresa_id, cobranca_id, origem, forma_pagamento)
    values ('receita', v_data, date_trunc('month', v_data)::date,
            left(format('Juros e multa por atraso (%s dias) — %s — %s', v_data - v_c.vencimento, v_c.descricao, v_c.pagador_nome), 300),
            v_encargos, (select id from public.escritorio_categorias where chave = 'JUROS_MULTA'), v_c.empresa_id, p_id, 'cobranca', v_forma);
  end if;

  -- Envios ainda na fila não saem mais; agradecimento por e-mail (com o recibo, quando houver)
  update public.envios e set status = 'desativado', erro = 'Cobrança paga.'
    from public.honorarios_lembretes l
   where l.cobranca_id = p_id and l.envio_id = e.id and e.status = 'pendente';
  perform app.honorarios_agendar(p_id, 'pagamento', null, now() + interval '3 minutes');
  perform app.honorarios_avisar_cliente(p_id, 'Pagamento recebido: ' || v_c.descricao,
    format('Recebemos %s em %s. Obrigado!', app.moeda_br(v_pago), to_char(v_data, 'DD/MM/YYYY')));

  return jsonb_build_object('multa', v_multa, 'juros', v_juros, 'desconto', v_desconto);
end;
$$;

create or replace function public.honorarios_cobranca_vincular_recibo(p_id uuid, p_recibo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_honorarios();
  update public.honorarios_cobrancas set recibo_id = p_recibo_id where id = p_id and situacao = 'paga';
end;
$$;

-- Desfaz a baixa (pagamento lançado por engano): tira os lançamentos e volta a cobrança para "em aberto".
-- Devolve o recibo ligado, para o portal cancelá-lo.
create or replace function public.honorarios_cobranca_estornar(p_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.honorarios_cobrancas;
begin
  perform app.exigir_honorarios();
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo.' using errcode = 'P0001';
  end if;
  select * into v_c from public.honorarios_cobrancas where id = p_id for update;
  if v_c.situacao is distinct from 'paga' then
    raise exception 'Só cobranças pagas têm o pagamento desfeito.' using errcode = 'P0001';
  end if;
  delete from public.escritorio_lancamentos where cobranca_id = p_id and origem = 'cobranca';
  update public.envios e set status = 'desativado', erro = 'Pagamento desfeito.'
    from public.honorarios_lembretes l
   where l.cobranca_id = p_id and l.motivo = 'pagamento' and l.envio_id = e.id and e.status = 'pendente';
  update public.honorarios_cobrancas set
    situacao = 'aberta', pago_em = null, valor_pago = null, multa = 0, juros = 0, desconto = 0, forma_pagamento = null,
    baixa_observacao = left('Pagamento desfeito: ' || trim(p_motivo), 300), baixada_por = null, baixada_em = null, recibo_id = null
  where id = p_id;
  return v_c.recibo_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Configuração
-- -----------------------------------------------------------------------------
create or replace function public.honorarios_config_salvar(p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regua int[];
begin
  perform app.exigir_honorarios();
  if p_dados ? 'regua' then
    select coalesce(array_agg(distinct d order by d), array[]::int[]) into v_regua
      from jsonb_array_elements_text(p_dados -> 'regua') as t(x), lateral (select x::int as d) s;
  end if;
  update public.honorarios_config c set
    pix_chave = case when p_dados ? 'pix_chave' then nullif(trim(p_dados ->> 'pix_chave'), '') else c.pix_chave end,
    pix_tipo = case when p_dados ? 'pix_tipo' then nullif(p_dados ->> 'pix_tipo', '') else c.pix_tipo end,
    pix_nome = case when p_dados ? 'pix_nome' then nullif(trim(p_dados ->> 'pix_nome'), '') else c.pix_nome end,
    pix_cidade = case when p_dados ? 'pix_cidade' then nullif(trim(p_dados ->> 'pix_cidade'), '') else c.pix_cidade end,
    geracao_automatica = coalesce((p_dados ->> 'geracao_automatica')::boolean, c.geracao_automatica),
    dia_geracao = coalesce(nullif(p_dados ->> 'dia_geracao', '')::smallint, c.dia_geracao),
    aprovacao_automatica = coalesce((p_dados ->> 'aprovacao_automatica')::boolean, c.aprovacao_automatica),
    competencia_referencia = coalesce(nullif(p_dados ->> 'competencia_referencia', ''), c.competencia_referencia),
    cobrar_encargos = coalesce((p_dados ->> 'cobrar_encargos')::boolean, c.cobrar_encargos),
    multa_percentual = coalesce(nullif(p_dados ->> 'multa_percentual', '')::numeric, c.multa_percentual),
    juros_mes_percentual = coalesce(nullif(p_dados ->> 'juros_mes_percentual', '')::numeric, c.juros_mes_percentual),
    robo_ativo = coalesce((p_dados ->> 'robo_ativo')::boolean, c.robo_ativo),
    regua = coalesce(v_regua, c.regua),
    email_ativo = coalesce((p_dados ->> 'email_ativo')::boolean, c.email_ativo),
    whatsapp_ativo = coalesce((p_dados ->> 'whatsapp_ativo')::boolean, c.whatsapp_ativo),
    whatsapp_template = case when p_dados ? 'whatsapp_template' then nullif(trim(p_dados ->> 'whatsapp_template'), '') else c.whatsapp_template end,
    mensagens = case when p_dados ? 'mensagens' then coalesce(p_dados -> 'mensagens', '{}'::jsonb) else c.mensagens end,
    recibo_automatico = coalesce((p_dados ->> 'recibo_automatico')::boolean, c.recibo_automatico),
    recibo_publicar = coalesce((p_dados ->> 'recibo_publicar')::boolean, c.recibo_publicar),
    updated_by = auth.uid()
  where c.id = 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rotina diária (servidor): gera as cobranças do mês no dia escolhido e
-- agenda os lembretes da régua (só em dia útil, às 9h de Brasília)
-- -----------------------------------------------------------------------------
create or replace function public.rotina_honorarios()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.honorarios_config;
  v_esc public.escritorio;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_comp date;
  v_geradas int := 0;
  v_aprovadas int := 0;
  v_lembretes int := 0;
  v_c record;
  v_dia int;
  v_alvo date;
  v_escolhido int;
  v_quando timestamptz := greatest(now(), ((v_hoje + time '09:00') at time zone 'America/Sao_Paulo'));
  v_user uuid;
  v_ids uuid[];
begin
  select * into v_cfg from public.honorarios_config where id = 1;
  select * into v_esc from public.escritorio where id = 1;

  -- 1. Cobranças do mês (uma vez por mês de referência)
  v_comp := case when v_cfg.competencia_referencia = 'mes_anterior'
                 then (date_trunc('month', v_hoje) - interval '1 month')::date
                 else date_trunc('month', v_hoje)::date end;
  if v_cfg.geracao_automatica and extract(day from v_hoje) >= v_cfg.dia_geracao
     and not exists (select 1 from public.honorarios_geracoes g where g.competencia = v_comp) then
    v_geradas := app.honorarios_gerar_mes(v_comp, true);
    if v_cfg.aprovacao_automatica and v_geradas > 0 then
      select array_agg(id) into v_ids from public.honorarios_cobrancas where competencia = v_comp and tipo = 'mensal' and situacao = 'rascunho';
      v_aprovadas := app.honorarios_aprovar(v_ids);
    end if;
    if v_geradas > 0 then
      for v_user in
        select p.id from public.perfis p where p.ativo and (p.tipo = 'admin' or (p.tipo = 'equipe' and exists (select 1 from public.honorarios_acessos a where a.user_id = p.id)))
      loop
        perform app.notificar(v_user, null, 'honorarios_gerados',
          format('Cobranças de %s geradas', app.mes_ano_br(v_comp)),
          case when v_aprovadas > 0 then format('%s cobranças foram enviadas aos clientes.', v_aprovadas)
               else format('%s cobranças aguardando sua conferência.', v_geradas) end,
          '/escritorio/honorarios/cobrancas?situacao=' || case when v_aprovadas > 0 then 'aberta' else 'rascunho' end, false);
      end loop;
    end if;
  end if;

  -- 2. Lembretes da régua (só em dia útil; o atrasado de fim de semana sai no próximo dia útil)
  if v_cfg.robo_ativo and cardinality(v_cfg.regua) > 0 and app.e_dia_util(v_hoje, v_esc.uf, null, false) then
    for v_c in
      select c.id, c.vencimento, c.aprovada_em
        from public.honorarios_cobrancas c
        left join public.honorarios_fichas f on f.id = c.ficha_id
       where c.situacao = 'aberta' and c.robo_ativo
         and (f.id is null or f.robo_pausado_ate is null or f.robo_pausado_ate < v_hoje)
    loop
      v_escolhido := null;
      foreach v_dia in array (select array_agg(d order by d desc) from unnest(v_cfg.regua) d) loop
        v_alvo := v_c.vencimento + v_dia;
        continue when v_alvo > v_hoje or v_hoje - v_alvo > 4 or v_alvo <= (v_c.aprovada_em at time zone 'America/Sao_Paulo')::date;
        continue when exists (select 1 from public.honorarios_lembretes l where l.cobranca_id = v_c.id and l.motivo = 'lembrete' and l.dias = v_dia);
        if v_escolhido is null then
          v_escolhido := v_dia;
          v_lembretes := v_lembretes + app.honorarios_agendar(v_c.id, 'lembrete', v_dia, v_quando);
        else
          -- Etapa mais antiga que ficou para trás (ex.: fim de semana): não sai junto com a atual
          insert into public.honorarios_lembretes (cobranca_id, motivo, dias, canal, situacao)
          values (v_c.id, 'lembrete', v_dia, 'nenhum', 'pulado');
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object('competencia', v_comp, 'geradas', v_geradas, 'aprovadas', v_aprovadas, 'lembretes', v_lembretes);
end;
$$;

revoke execute on function public.rotina_honorarios() from public, anon, authenticated;
grant execute on function public.rotina_honorarios() to service_role;

revoke execute on function
  public.honorarios_acesso_definir(uuid, boolean),
  public.escritorio_categoria_salvar(uuid, jsonb),
  public.honorarios_ficha_salvar(uuid, jsonb),
  public.honorarios_gerar(date),
  public.honorarios_cobranca_salvar(uuid, jsonb),
  public.honorarios_cobrancas_aprovar(uuid[]),
  public.honorarios_cobranca_reenviar(uuid),
  public.honorarios_cobranca_cancelar(uuid, text),
  public.escritorio_lancamento_salvar(uuid, jsonb),
  public.escritorio_lancamento_excluir(uuid),
  public.honorarios_cobranca_baixar(uuid, jsonb),
  public.honorarios_cobranca_vincular_recibo(uuid, uuid),
  public.honorarios_cobranca_estornar(uuid, text),
  public.honorarios_config_salvar(jsonb)
from public, anon;
grant execute on function
  public.honorarios_acesso_definir(uuid, boolean),
  public.escritorio_categoria_salvar(uuid, jsonb),
  public.honorarios_ficha_salvar(uuid, jsonb),
  public.honorarios_gerar(date),
  public.honorarios_cobranca_salvar(uuid, jsonb),
  public.honorarios_cobrancas_aprovar(uuid[]),
  public.honorarios_cobranca_reenviar(uuid),
  public.honorarios_cobranca_cancelar(uuid, text),
  public.escritorio_lancamento_salvar(uuid, jsonb),
  public.escritorio_lancamento_excluir(uuid),
  public.honorarios_cobranca_baixar(uuid, jsonb),
  public.honorarios_cobranca_vincular_recibo(uuid, uuid),
  public.honorarios_cobranca_estornar(uuid, text),
  public.honorarios_config_salvar(jsonb)
to authenticated;

-- Funções internas não ficam expostas
revoke execute on function app.honorarios_gerar_mes(date, boolean), app.honorarios_aprovar(uuid[]),
  app.honorarios_agendar(uuid, text, int, timestamptz), app.honorarios_avisar_cliente(uuid, text, text),
  app.honorarios_gravar_itens(uuid, jsonb), app.honorarios_numero(int),
  app.honorarios_itens_mes(public.honorarios_fichas, date, date)
from public, anon, authenticated;
