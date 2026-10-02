-- =============================================================================
-- Maquininhas: conferência das taxas cobradas × taxas do contrato
--
--  * Catálogo das adquirentes (cartão, frota, convênio e benefícios) e
--    contratos de cada empresa com as taxas por bandeira, modalidade e
--    número de parcelas (com vigência).
--  * O relatório de vendas que a adquirente fornece (CSV ou Excel) entra como
--    documento da categoria "Relatórios de maquininhas"; o processador
--    reconhece o formato já aprendido (colunas lembradas) ou deixa o relatório
--    aguardando a conferência das colunas.
--  * Cada venda é comparada com a taxa do contrato; o mês mostra quanto foi
--    cobrado acima do combinado. A equipe e o cliente são avisados.
--  * Nenhuma consulta é feita às adquirentes: a conexão automática (API/EDI)
--    depende do acesso liberado por cada cliente e fica desligada até lá.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões: maquininhas.ver e maquininhas.gerenciar (equipe e titular)
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
    'maquininhas.gerenciar'
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
      'maquininhas.ver', 'maquininhas.gerenciar'
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
      'maquininhas.ver', 'maquininhas.gerenciar'
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
  return new;
end;
$$;

update public.empresa_membros
   set permissoes = permissoes || array['maquininhas.ver', 'maquininhas.gerenciar']
 where papel in ('equipe', 'cliente_titular') and not (permissoes && array['maquininhas.ver', 'maquininhas.gerenciar']);
update public.convites
   set permissoes = permissoes || array['maquininhas.ver', 'maquininhas.gerenciar']
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and cardinality(permissoes) > 0
   and not (permissoes && array['maquininhas.ver', 'maquininhas.gerenciar']);

-- -----------------------------------------------------------------------------
-- 2. Catálogo das adquirentes
-- -----------------------------------------------------------------------------
create or replace function app.maquininha_normalizar(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
    upper(translate(coalesce(p, ''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^A-Z0-9]+', ' ', 'g')), '');
$$;

create table public.maquininha_adquirentes (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null check (length(nome) between 2 and 80),
  tipo text not null check (tipo in ('cartao', 'frota', 'beneficio', 'convenio')),
  observacao text check (observacao is null or length(observacao) <= 300),
  ordem int not null default 100,
  ativo boolean not null default true
);

insert into public.maquininha_adquirentes (codigo, nome, tipo, ordem, observacao) values
  -- Cartões (credenciadoras e subcredenciadoras)
  ('cielo', 'Cielo', 'cartao', 10, null),
  ('rede', 'Rede (Itaú)', 'cartao', 11, null),
  ('getnet', 'Getnet (Santander)', 'cartao', 12, null),
  ('stone', 'Stone', 'cartao', 13, null),
  ('ton', 'Ton', 'cartao', 14, null),
  ('pagbank', 'PagBank / PagSeguro (Moderninha)', 'cartao', 15, null),
  ('mercado_pago', 'Mercado Pago (Point)', 'cartao', 16, null),
  ('infinitepay', 'InfinitePay', 'cartao', 17, null),
  ('sumup', 'SumUp', 'cartao', 18, null),
  ('safrapay', 'SafraPay', 'cartao', 19, null),
  ('sipag', 'Sipag (Sicoob)', 'cartao', 20, null),
  ('sicredi', 'Sicredi', 'cartao', 21, null),
  ('vero', 'Vero (Banrisul)', 'cartao', 22, null),
  ('c6_pay', 'C6 Pay', 'cartao', 23, null),
  ('bin', 'Bin (Fiserv)', 'cartao', 24, null),
  ('adiq', 'Adiq', 'cartao', 25, null),
  ('global_payments', 'Global Payments', 'cartao', 26, null),
  ('granito', 'Granito', 'cartao', 27, null),
  ('entrepay', 'Entrepay', 'cartao', 28, null),
  ('picpay', 'PicPay', 'cartao', 29, null),
  ('inter', 'Banco Inter', 'cartao', 30, null),
  ('caixa', 'Caixa (Azulzinha)', 'cartao', 31, null),
  ('ifood_pago', 'iFood Pago', 'cartao', 32, null),
  ('pagarme', 'Pagar.me', 'cartao', 33, 'Vendas online e TEF'),
  ('zoop', 'Zoop', 'cartao', 34, null),
  -- Frota e combustível
  ('ticket_log', 'Ticket Log (Edenred)', 'frota', 50, null),
  ('valecard', 'Valecard', 'frota', 51, null),
  ('goodcard', 'Goodcard', 'frota', 52, null),
  ('neo', 'Neo Facilities', 'frota', 53, null),
  ('maxifrota', 'Maxifrota', 'frota', 54, null),
  ('prime_frota', 'Prime (gestão de frotas)', 'frota', 55, null),
  ('veloe', 'Veloe', 'frota', 56, null),
  ('sem_parar', 'Sem Parar Empresas', 'frota', 57, null),
  ('alelo_frota', 'Alelo Frota', 'frota', 58, null),
  ('repom', 'Repom (Edenred)', 'frota', 59, null),
  ('pamcard', 'Pamcard', 'frota', 60, null),
  ('roadcard', 'Roadcard', 'frota', 61, null),
  ('truckpag', 'TruckPag', 'frota', 62, null),
  ('volus', 'Volus', 'frota', 63, null),
  ('shell_box', 'Shell Box Empresas', 'frota', 64, null),
  ('policard_frota', 'Policard (frota)', 'frota', 65, null),
  -- Benefícios (refeição e alimentação)
  ('alelo', 'Alelo', 'beneficio', 80, null),
  ('pluxee', 'Pluxee (antiga Sodexo)', 'beneficio', 81, null),
  ('ticket', 'Ticket (Edenred)', 'beneficio', 82, null),
  ('vr', 'VR Benefícios', 'beneficio', 83, null),
  ('ben', 'Ben Visa Vale', 'beneficio', 84, null),
  ('flash', 'Flash', 'beneficio', 85, null),
  ('ifood_beneficios', 'iFood Benefícios', 'beneficio', 86, null),
  ('caju', 'Caju', 'beneficio', 87, null),
  ('swile', 'Swile', 'beneficio', 88, null),
  ('up_brasil', 'Up Brasil', 'beneficio', 89, null),
  ('verocard', 'Verocard', 'beneficio', 90, null),
  ('green_card', 'Green Card', 'beneficio', 91, null),
  ('coopercard', 'Coopercard', 'beneficio', 92, null),
  ('valecard_beneficios', 'Valecard (benefícios)', 'beneficio', 93, null),
  ('policard', 'Policard', 'beneficio', 94, null),
  -- Convênios (cartões de convênio e programas de farmácia)
  ('brasilcard', 'Brasilcard', 'convenio', 110, null),
  ('senff', 'Senff', 'convenio', 111, null),
  ('epharma', 'ePharma (PBM)', 'convenio', 112, 'Programa de benefício em medicamentos'),
  ('funcional', 'Funcional (PBM)', 'convenio', 113, 'Programa de benefício em medicamentos'),
  ('vidalink', 'Vidalink (PBM)', 'convenio', 114, 'Programa de benefício em medicamentos'),
  ('orizon', 'Orizon (PBM)', 'convenio', 115, 'Programa de benefício em medicamentos');

alter table public.maquininha_adquirentes enable row level security;
create policy maquininha_adquirentes_leitura on public.maquininha_adquirentes for select to authenticated
  using ((select app.usuario_valido()));
create policy maquininha_adquirentes_admin on public.maquininha_adquirentes for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public.maquininha_adquirentes to authenticated;
create trigger auditoria_maquininha_adquirentes after insert or update or delete on public.maquininha_adquirentes
  for each row execute function app.tg_auditoria();

-- A categoria de documento já existente recebe os relatórios (CSV ou Excel)
update public.categorias_documento
   set descricao = 'Relatórios de vendas das maquininhas e plataformas (cartão, frota, convênio e benefícios). Em CSV ou Excel, o portal confere as taxas com o contrato.'
 where codigo = 'relatorio_maquininha';

-- -----------------------------------------------------------------------------
-- 3. Contratos e taxas
-- -----------------------------------------------------------------------------
create table public.maquininha_contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  adquirente_codigo text references public.maquininha_adquirentes(codigo),
  -- Nome para exibição (o do catálogo ou o informado em "outra")
  adquirente_nome text not null check (length(adquirente_nome) between 2 and 80),
  tipo text not null check (tipo in ('cartao', 'frota', 'beneficio', 'convenio')),
  adquirente_chave text generated always as (coalesce(adquirente_codigo, 'outra:' || lower(coalesce(app.maquininha_normalizar(adquirente_nome), '')))) stored,
  apelido text check (apelido is null or length(apelido) <= 80),
  codigo_estabelecimento text check (codigo_estabelecimento is null or length(codigo_estabelecimento) <= 40),
  vigencia_inicio date not null,
  vigencia_fim date check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  aluguel_mensal numeric(12, 2) check (aluguel_mensal is null or aluguel_mensal >= 0),
  observacao text check (observacao is null or length(observacao) <= 1000),
  ativo boolean not null default true,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index maquininha_contratos_empresa_idx on public.maquininha_contratos (empresa_id, adquirente_chave);

create table public.maquininha_taxas (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.maquininha_contratos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  -- Bandeira já normalizada (VISA, MASTERCARD...); nula = todas
  bandeira text check (bandeira is null or length(bandeira) between 2 and 40),
  modalidade text not null check (modalidade in ('debito', 'credito_vista', 'credito_parcelado', 'pre_pago', 'voucher', 'frota', 'pix', 'outros')),
  parcelas_de int not null default 1 check (parcelas_de between 1 and 99),
  parcelas_ate int not null default 1 check (parcelas_ate between 1 and 99),
  taxa_percentual numeric(7, 4) not null check (taxa_percentual >= 0 and taxa_percentual <= 100),
  tarifa_fixa numeric(12, 2) not null default 0 check (tarifa_fixa >= 0),
  prazo_dias int check (prazo_dias is null or prazo_dias between 0 and 400),
  observacao text check (observacao is null or length(observacao) <= 300),
  check (parcelas_ate >= parcelas_de)
);
create index maquininha_taxas_contrato_idx on public.maquininha_taxas (contrato_id, modalidade);

-- A taxa pertence à mesma empresa do contrato
create or replace function app.tg_maquininha_taxa_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select c.empresa_id into new.empresa_id from public.maquininha_contratos c where c.id = new.contrato_id;
  if new.empresa_id is null then
    raise exception 'Contrato não encontrado.';
  end if;
  return new;
end;
$$;
create trigger maquininha_taxas_empresa before insert or update on public.maquininha_taxas
  for each row execute function app.tg_maquininha_taxa_empresa();

create trigger maquininha_contratos_updated_at before update on public.maquininha_contratos
  for each row execute function app.tg_updated_at();
create trigger auditoria_maquininha_contratos after insert or update or delete on public.maquininha_contratos
  for each row execute function app.tg_auditoria();
create trigger auditoria_maquininha_taxas after insert or update or delete on public.maquininha_taxas
  for each row execute function app.tg_auditoria();

alter table public.maquininha_contratos enable row level security;
alter table public.maquininha_taxas enable row level security;
create policy maquininha_contratos_leitura on public.maquininha_contratos for select to authenticated
  using ((select app.pode(empresa_id, 'maquininhas.ver')));
create policy maquininha_contratos_escrita on public.maquininha_contratos for all to authenticated
  using ((select app.pode(empresa_id, 'maquininhas.gerenciar')))
  with check ((select app.pode(empresa_id, 'maquininhas.gerenciar')));
create policy maquininha_taxas_leitura on public.maquininha_taxas for select to authenticated
  using ((select app.pode(empresa_id, 'maquininhas.ver')));
create policy maquininha_taxas_escrita on public.maquininha_taxas for all to authenticated
  using ((select app.pode(empresa_id, 'maquininhas.gerenciar')))
  with check ((select app.pode(empresa_id, 'maquininhas.gerenciar')));
grant select, insert, update, delete on public.maquininha_contratos, public.maquininha_taxas to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Formatos lembrados, relatórios importados e vendas
-- -----------------------------------------------------------------------------
create table public.maquininha_layouts (
  id uuid primary key default gen_random_uuid(),
  -- Nulo: formato do escritório (vale para todas as empresas)
  empresa_id uuid references public.empresas(id) on delete cascade,
  assinatura text not null check (length(assinatura) between 3 and 2000),
  adquirente_codigo text references public.maquininha_adquirentes(codigo),
  adquirente_nome text not null check (length(adquirente_nome) between 2 and 80),
  tipo text not null check (tipo in ('cartao', 'frota', 'beneficio', 'convenio')),
  mapeamento jsonb not null check (jsonb_typeof(mapeamento) = 'object'),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (empresa_id, assinatura)
);

create table public.maquininha_importacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento_id uuid references public.documentos(id) on delete set null,
  versao int,
  nome_arquivo text,
  situacao text not null default 'aguardando_mapeamento'
    check (situacao in ('aguardando_mapeamento', 'na_fila', 'importando', 'importada', 'erro')),
  adquirente_codigo text references public.maquininha_adquirentes(codigo),
  adquirente_nome text,
  tipo text check (tipo is null or tipo in ('cartao', 'frota', 'beneficio', 'convenio')),
  adquirente_chave text,
  assinatura text,
  cabecalho jsonb,
  amostra jsonb,
  mapeamento jsonb,
  linhas int,
  periodo_inicio date,
  periodo_fim date,
  vendas int,
  duplicadas int,
  canceladas int,
  invalidas int,
  total_bruto numeric(14, 2),
  total_taxas numeric(14, 2),
  total_acima numeric(14, 2),
  erros jsonb,
  erro text check (erro is null or length(erro) <= 1000),
  criado_por uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now(),
  concluida_em timestamptz,
  unique (documento_id, versao)
);
create index maquininha_importacoes_empresa_idx on public.maquininha_importacoes (empresa_id, created_at desc);

create table public.maquininha_vendas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  importacao_id uuid not null references public.maquininha_importacoes(id) on delete cascade,
  adquirente_chave text not null,
  data_venda date not null,
  bandeira text,
  modalidade text not null check (modalidade in ('debito', 'credito_vista', 'credito_parcelado', 'pre_pago', 'voucher', 'frota', 'pix', 'outros')),
  parcelas int not null default 1 check (parcelas between 1 and 99),
  valor_bruto numeric(14, 2) not null check (valor_bruto > 0),
  valor_taxa numeric(14, 2) not null,
  valor_liquido numeric(14, 2),
  nsu text check (nsu is null or length(nsu) <= 60),
  autorizacao text check (autorizacao is null or length(autorizacao) <= 60),
  terminal text check (terminal is null or length(terminal) <= 60),
  data_prevista date,
  situacao text not null default 'aprovada' check (situacao in ('aprovada', 'cancelada', 'chargeback')),
  linha int,
  chave_unica text not null,
  -- Conferência com o contrato
  contrato_id uuid references public.maquininha_contratos(id) on delete set null,
  taxa_id uuid references public.maquininha_taxas(id) on delete set null,
  taxa_contratada numeric(7, 4),
  tarifa_contratada numeric(12, 2),
  valor_esperado numeric(14, 2),
  diferenca numeric(14, 2),
  conferencia text not null default 'pendente'
    check (conferencia in ('pendente', 'ok', 'acima', 'abaixo', 'sem_contrato', 'sem_taxa', 'cancelada')),
  unique (empresa_id, chave_unica)
);
create index maquininha_vendas_empresa_data_idx on public.maquininha_vendas (empresa_id, data_venda);
create index maquininha_vendas_importacao_idx on public.maquininha_vendas (importacao_id);

alter table public.maquininha_layouts enable row level security;
alter table public.maquininha_importacoes enable row level security;
alter table public.maquininha_vendas enable row level security;
-- Formatos: só nomes e posições de colunas (sem dados de vendas)
create policy maquininha_layouts_leitura on public.maquininha_layouts for select to authenticated
  using (empresa_id is null or (select app.pode(empresa_id, 'maquininhas.ver')));
create policy maquininha_importacoes_leitura on public.maquininha_importacoes for select to authenticated
  using ((select app.pode(empresa_id, 'maquininhas.ver')));
create policy maquininha_vendas_leitura on public.maquininha_vendas for select to authenticated
  using ((select app.pode(empresa_id, 'maquininhas.ver')));
grant select on public.maquininha_layouts, public.maquininha_importacoes, public.maquininha_vendas to authenticated;
grant select, insert, update, delete on public.maquininha_layouts, public.maquininha_importacoes, public.maquininha_vendas to service_role;
grant select, insert, update, delete on public.maquininha_adquirentes, public.maquininha_contratos, public.maquininha_taxas to service_role;

-- -----------------------------------------------------------------------------
-- 5. Conferência das vendas com o contrato
-- -----------------------------------------------------------------------------
-- Diferença de até 2 centavos por venda é arredondamento.
create or replace function app.maquininha_auditar(p_empresa_id uuid, p_inicio date, p_fim date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with escolha as (
    select v.id as venda_id, c.id as contrato_id, t.id as taxa_id, t.taxa_percentual, t.tarifa_fixa,
           case when t.id is null then null else round(v.valor_bruto * t.taxa_percentual / 100 + t.tarifa_fixa, 2) end as esperado,
           v.valor_taxa, v.situacao
      from public.maquininha_vendas v
      left join lateral (
        select c.* from public.maquininha_contratos c
         where c.empresa_id = v.empresa_id and c.ativo and c.adquirente_chave = v.adquirente_chave
           and c.vigencia_inicio <= v.data_venda and (c.vigencia_fim is null or c.vigencia_fim >= v.data_venda)
         order by c.vigencia_inicio desc, c.created_at desc
         limit 1
      ) c on true
      left join lateral (
        select t.* from public.maquininha_taxas t
         where t.contrato_id = c.id and t.modalidade = v.modalidade
           and v.parcelas between t.parcelas_de and t.parcelas_ate
           and (t.bandeira is null or t.bandeira = v.bandeira)
         order by (t.bandeira is not null) desc, (t.parcelas_ate - t.parcelas_de), t.taxa_percentual
         limit 1
      ) t on true
     where v.empresa_id = p_empresa_id and v.data_venda between p_inicio and p_fim
  )
  update public.maquininha_vendas v
     set contrato_id = e.contrato_id,
         taxa_id = e.taxa_id,
         taxa_contratada = e.taxa_percentual,
         tarifa_contratada = e.tarifa_fixa,
         valor_esperado = e.esperado,
         diferenca = case when e.esperado is null then null else e.valor_taxa - e.esperado end,
         conferencia = case
           when e.situacao <> 'aprovada' then 'cancelada'
           when e.contrato_id is null then 'sem_contrato'
           when e.taxa_id is null then 'sem_taxa'
           when abs(e.valor_taxa - e.esperado) <= 0.02 then 'ok'
           when e.valor_taxa > e.esperado then 'acima'
           else 'abaixo'
         end
    from escolha e
   where v.id = e.venda_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Depois de mudar contratos e taxas: confere de novo (equipe ou titular)
create or replace function public.maquininha_reconferir(p_empresa_id uuid, p_inicio date default null, p_fim date default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'maquininhas.gerenciar');
  return app.maquininha_auditar(p_empresa_id, coalesce(p_inicio, date '2000-01-01'), coalesce(p_fim, date '2999-12-31'));
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Relatórios: chegada (processador), conferência das colunas (usuário) e
--    conclusão da importação (processador)
-- -----------------------------------------------------------------------------
create or replace function public.maquininha_registrar_relatorio(
  p_documento_id uuid, p_versao int, p_nome text, p_assinatura text, p_cabecalho jsonb, p_amostra jsonb, p_linhas int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos;
  v_layout public.maquininha_layouts;
  v_id uuid;
  v_situacao text;
begin
  select * into v_doc from public.documentos where id = p_documento_id;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
  -- Formato já aprendido: primeiro o da empresa, depois o do escritório
  select * into v_layout from public.maquininha_layouts l
   where l.assinatura = p_assinatura and (l.empresa_id = v_doc.empresa_id or l.empresa_id is null)
   order by l.empresa_id nulls last
   limit 1;
  v_situacao := case when v_layout.id is null then 'aguardando_mapeamento' else 'na_fila' end;

  insert into public.maquininha_importacoes (empresa_id, documento_id, versao, nome_arquivo, situacao, adquirente_codigo, adquirente_nome, tipo,
                                             adquirente_chave, assinatura, cabecalho, amostra, mapeamento, linhas, criado_por)
  values (v_doc.empresa_id, v_doc.id, p_versao, left(p_nome, 300), v_situacao, v_layout.adquirente_codigo, v_layout.adquirente_nome, v_layout.tipo,
          case when v_layout.id is null then null
               else coalesce(v_layout.adquirente_codigo, 'outra:' || lower(coalesce(app.maquininha_normalizar(v_layout.adquirente_nome), ''))) end,
          left(p_assinatura, 2000), p_cabecalho, p_amostra, v_layout.mapeamento, p_linhas, v_doc.enviado_por)
  on conflict (documento_id, versao) do update
     set nome_arquivo = excluded.nome_arquivo, assinatura = excluded.assinatura, cabecalho = excluded.cabecalho, amostra = excluded.amostra,
         linhas = excluded.linhas,
         situacao = case when public.maquininha_importacoes.situacao = 'importada' then 'importada' else excluded.situacao end,
         adquirente_codigo = coalesce(public.maquininha_importacoes.adquirente_codigo, excluded.adquirente_codigo),
         adquirente_nome = coalesce(public.maquininha_importacoes.adquirente_nome, excluded.adquirente_nome),
         tipo = coalesce(public.maquininha_importacoes.tipo, excluded.tipo),
         adquirente_chave = coalesce(public.maquininha_importacoes.adquirente_chave, excluded.adquirente_chave),
         mapeamento = coalesce(public.maquininha_importacoes.mapeamento, excluded.mapeamento)
  returning id, situacao into v_id, v_situacao;

  if v_situacao = 'na_fila' then
    perform app.enfileirar('importar_maquininha', jsonb_build_object('importacao_id', v_id), v_doc.empresa_id,
                           'maquininha:' || v_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 70);
  elsif v_situacao = 'aguardando_mapeamento' then
    perform app.notificar_equipe(v_doc.empresa_id, 'maquininha_relatorio', 'Relatório de maquininha para conferir',
      'Chegou um relatório de vendas em um formato novo. Confira as colunas uma vez e o portal aprende para as próximas.',
      '/e/' || v_doc.empresa_id::text || '/maquininhas/importacoes/' || v_id::text, false);
  end if;
  return jsonb_build_object('importacao_id', v_id, 'situacao', v_situacao);
end;
$$;

create or replace function public.maquininha_confirmar_mapeamento(
  p_importacao_id uuid, p_mapeamento jsonb, p_adquirente_codigo text default null, p_adquirente_nome text default null, p_lembrar boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.maquininha_importacoes;
  v_cat public.maquininha_adquirentes;
  v_nome text;
  v_tipo text;
begin
  select * into v from public.maquininha_importacoes where id = p_importacao_id;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'maquininhas.gerenciar');
  -- Já na fila ou importando (com a tarefa viva): espera terminar
  if v.situacao in ('na_fila', 'importando') and exists (
       select 1 from public.jobs j
        where j.tipo = 'importar_maquininha' and j.payload ->> 'importacao_id' = v.id::text and j.status in ('pendente', 'executando')) then
    raise exception 'Este relatório já está sendo importado.';
  end if;
  if p_mapeamento is null or jsonb_typeof(p_mapeamento) <> 'object'
     or p_mapeamento ->> 'data' is null or p_mapeamento ->> 'bruto' is null
     or (p_mapeamento ->> 'liquido' is null and p_mapeamento ->> 'taxa' is null and p_mapeamento ->> 'taxa_percentual' is null) then
    raise exception 'Escolha ao menos as colunas da data, do valor da venda e do valor líquido ou da taxa.';
  end if;
  if p_adquirente_codigo is not null then
    select * into v_cat from public.maquininha_adquirentes where codigo = p_adquirente_codigo and ativo;
    if not found then
      raise exception 'Adquirente inválida.';
    end if;
    v_nome := v_cat.nome;
    v_tipo := v_cat.tipo;
  else
    v_nome := btrim(coalesce(p_adquirente_nome, ''));
    if length(v_nome) < 2 or length(v_nome) > 80 then
      raise exception 'Informe o nome da adquirente.';
    end if;
    v_tipo := 'cartao';
    -- Adquirente "outra": usa o tipo do contrato da empresa com o mesmo nome, se houver
    select c.tipo into v_tipo from public.maquininha_contratos c
     where c.empresa_id = v.empresa_id and c.adquirente_codigo is null
       and app.maquininha_normalizar(c.adquirente_nome) = app.maquininha_normalizar(v_nome)
     limit 1;
    v_tipo := coalesce(v_tipo, 'cartao');
  end if;

  update public.maquininha_importacoes
     set adquirente_codigo = p_adquirente_codigo, adquirente_nome = v_nome, tipo = v_tipo,
         adquirente_chave = coalesce(p_adquirente_codigo, 'outra:' || lower(coalesce(app.maquininha_normalizar(v_nome), ''))),
         mapeamento = p_mapeamento, situacao = 'na_fila', erro = null
   where id = v.id;

  if coalesce(p_lembrar, true) and v.assinatura is not null then
    -- A equipe ensina o formato para todo o escritório; o cliente, só para a empresa dele
    insert into public.maquininha_layouts (empresa_id, assinatura, adquirente_codigo, adquirente_nome, tipo, mapeamento)
    values (case when app.e_equipe_da_empresa(v.empresa_id) then null else v.empresa_id end, v.assinatura, p_adquirente_codigo, v_nome, v_tipo, p_mapeamento)
    on conflict (empresa_id, assinatura) do update
       set adquirente_codigo = excluded.adquirente_codigo, adquirente_nome = excluded.adquirente_nome, tipo = excluded.tipo,
           mapeamento = excluded.mapeamento, criado_por = auth.uid(), updated_at = now();
  end if;

  perform app.enfileirar('importar_maquininha', jsonb_build_object('importacao_id', v.id), v.empresa_id,
                         'maquininha:' || v.id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 70);
  perform app.registrar_auditoria('maquininha_mapeamento', 'maquininha_importacoes', v.id::text, v.empresa_id,
    jsonb_build_object('adquirente', v_nome, 'lembrar', coalesce(p_lembrar, true)));
  return v.id;
end;
$$;

-- Grava um lote de vendas lidas do relatório (processador). A mesma venda em
-- outro relatório (semanal e mensal, por exemplo) não duplica: fica a leitura
-- mais recente, que pode trazer o cancelamento.
create or replace function public.maquininha_gravar_vendas(p_importacao_id uuid, p_vendas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.maquininha_importacoes;
  v_novas int := 0;
  v_total int := 0;
begin
  select * into v from public.maquininha_importacoes where id = p_importacao_id;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  if v.adquirente_chave is null then
    raise exception 'Adquirente do relatório não definida.';
  end if;
  with dados as (
    select distinct on (x.chave_unica) x.*
      from jsonb_to_recordset(coalesce(p_vendas, '[]'::jsonb)) as x(
             data_venda date, bandeira text, modalidade text, parcelas int, valor_bruto numeric, valor_taxa numeric,
             valor_liquido numeric, nsu text, autorizacao text, terminal text, data_prevista date, situacao text, linha int,
             chave_unica text)
     where x.chave_unica is not null
     order by x.chave_unica, x.linha
  ), gravadas as (
    insert into public.maquininha_vendas as mv (empresa_id, importacao_id, adquirente_chave, data_venda, bandeira, modalidade, parcelas,
                                               valor_bruto, valor_taxa, valor_liquido, nsu, autorizacao, terminal, data_prevista,
                                               situacao, linha, chave_unica)
    select v.empresa_id, v.id, v.adquirente_chave, d.data_venda, d.bandeira, d.modalidade, coalesce(d.parcelas, 1),
           d.valor_bruto, d.valor_taxa, d.valor_liquido, d.nsu, d.autorizacao, d.terminal, d.data_prevista,
           coalesce(d.situacao, 'aprovada'), d.linha, left(v.adquirente_chave || '|' || d.chave_unica, 500)
      from dados d
    on conflict (empresa_id, chave_unica) do update
       set importacao_id = excluded.importacao_id, bandeira = excluded.bandeira, modalidade = excluded.modalidade,
           parcelas = excluded.parcelas, valor_bruto = excluded.valor_bruto, valor_taxa = excluded.valor_taxa,
           valor_liquido = excluded.valor_liquido, nsu = excluded.nsu, autorizacao = excluded.autorizacao,
           terminal = excluded.terminal, data_prevista = excluded.data_prevista, situacao = excluded.situacao,
           linha = excluded.linha, conferencia = 'pendente'
    returning (mv.xmax = 0) as nova
  )
  select count(*) filter (where nova), count(*) into v_novas, v_total from gravadas;
  return jsonb_build_object('novas', v_novas, 'atualizadas', v_total - v_novas);
end;
$$;

-- Exclui um relatório importado e as vendas que vieram dele (equipe ou titular)
create or replace function public.maquininha_excluir_importacao(p_importacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.maquininha_importacoes;
begin
  select * into v from public.maquininha_importacoes where id = p_importacao_id;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  perform app.exigir(v.empresa_id, 'maquininhas.gerenciar');
  -- Se a importação estiver rodando, ela para sozinha ao não encontrar mais o relatório
  delete from public.maquininha_importacoes where id = v.id;
  perform app.registrar_auditoria('maquininha_excluir_relatorio', 'maquininha_importacoes', v.id::text, v.empresa_id,
    jsonb_build_object('arquivo', v.nome_arquivo, 'adquirente', v.adquirente_nome, 'vendas', v.vendas));
end;
$$;

create or replace function public.maquininha_concluir_importacao(p_importacao_id uuid, p_resumo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.maquininha_importacoes;
  v_inicio date := (p_resumo ->> 'periodo_inicio')::date;
  v_fim date := (p_resumo ->> 'periodo_fim')::date;
  v_acima numeric(14, 2) := 0;
  v_n_acima int := 0;
  v_texto text;
begin
  select * into v from public.maquininha_importacoes where id = p_importacao_id for update;
  if not found then
    raise exception 'Relatório não encontrado.';
  end if;
  if v_inicio is not null and v_fim is not null then
    perform app.maquininha_auditar(v.empresa_id, v_inicio, v_fim);
    -- Só as vendas deste relatório (a venda repetida em outro relatório fica com o mais recente)
    select coalesce(sum(diferenca), 0), count(*) into v_acima, v_n_acima
      from public.maquininha_vendas
     where importacao_id = v.id and conferencia = 'acima';
  end if;
  update public.maquininha_importacoes
     set situacao = 'importada', concluida_em = now(), erro = null,
         periodo_inicio = v_inicio, periodo_fim = v_fim,
         vendas = (p_resumo ->> 'vendas')::int, duplicadas = (p_resumo ->> 'duplicadas')::int,
         canceladas = (p_resumo ->> 'canceladas')::int, invalidas = (p_resumo ->> 'invalidas')::int,
         total_bruto = (p_resumo ->> 'total_bruto')::numeric, total_taxas = (p_resumo ->> 'total_taxas')::numeric,
         total_acima = v_acima, erros = p_resumo -> 'erros'
   where id = v.id;
  perform app.registrar_auditoria('maquininha_importacao', 'maquininha_importacoes', v.id::text, v.empresa_id,
    jsonb_build_object('arquivo', v.nome_arquivo, 'adquirente', v.adquirente_nome, 'vendas', (p_resumo ->> 'vendas')::int,
                       'periodo_inicio', v_inicio, 'periodo_fim', v_fim, 'acima', v_acima));
  if v_acima >= 0.01 then
    v_texto := v_n_acima || case when v_n_acima = 1 then ' venda' else ' vendas' end || ' de ' || to_char(v_inicio, 'DD/MM') || ' a ' ||
               to_char(v_fim, 'DD/MM/YYYY') || ' com taxa acima do contrato: R$ ' ||
               replace(replace(replace(to_char(v_acima, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ' a mais.';
    perform app.notificar_equipe(v.empresa_id, 'maquininha_taxa', 'Taxas acima do contrato — ' || coalesce(v.adquirente_nome, 'maquininha'), v_texto,
      '/e/' || v.empresa_id::text || '/maquininhas?competencia=' || to_char(v_fim, 'YYYY-MM'), false);
    perform app.notificar_clientes(v.empresa_id, 'maquininhas.ver', 'maquininha_taxa',
      'Taxas acima do contrato — ' || coalesce(v.adquirente_nome, 'maquininha'), v_texto,
      '/e/' || v.empresa_id::text || '/maquininhas?competencia=' || to_char(v_fim, 'YYYY-MM'), true);
  end if;
  return jsonb_build_object('acima', v_acima, 'vendas_acima', v_n_acima);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Resumo do período (empresa) e da carteira (equipe)
-- -----------------------------------------------------------------------------
create or replace function public.maquininha_resumo(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'maquininhas.ver');
  return jsonb_build_object(
    'totais', (
      select jsonb_build_object(
               'vendas', count(*) filter (where situacao = 'aprovada'),
               'bruto', coalesce(sum(valor_bruto) filter (where situacao = 'aprovada'), 0),
               'taxas', coalesce(sum(valor_taxa) filter (where situacao = 'aprovada'), 0),
               'acima', coalesce(sum(diferenca) filter (where conferencia = 'acima'), 0),
               'vendas_acima', count(*) filter (where conferencia = 'acima'),
               'abaixo', coalesce(sum(-diferenca) filter (where conferencia = 'abaixo'), 0),
               'sem_taxa', count(*) filter (where conferencia in ('sem_taxa', 'sem_contrato')),
               'canceladas', count(*) filter (where situacao <> 'aprovada'))
        from public.maquininha_vendas
       where empresa_id = p_empresa_id and data_venda between p_inicio and p_fim
    ),
    'grupos', coalesce((
      select jsonb_agg(g order by g ->> 'adquirente', g ->> 'bandeira', g ->> 'modalidade', (g ->> 'parcelas')::int)
        from (
          select jsonb_build_object(
                   'adquirente_chave', v.adquirente_chave,
                   'adquirente', coalesce(max(c.adquirente_nome), max(i.adquirente_nome), v.adquirente_chave),
                   'bandeira', coalesce(v.bandeira, '—'),
                   'modalidade', v.modalidade,
                   'parcelas', v.parcelas,
                   'vendas', count(*),
                   'bruto', sum(v.valor_bruto),
                   'taxas', sum(v.valor_taxa),
                   'esperado', sum(v.valor_esperado),
                   'taxa_contratada', max(v.taxa_contratada),
                   'tarifa_contratada', max(v.tarifa_contratada),
                   'acima', coalesce(sum(v.diferenca) filter (where v.conferencia = 'acima'), 0),
                   'vendas_acima', count(*) filter (where v.conferencia = 'acima'),
                   'sem_taxa', count(*) filter (where v.conferencia in ('sem_taxa', 'sem_contrato')),
                   'sem_contrato', bool_or(v.conferencia = 'sem_contrato')
                 ) as g
            from public.maquininha_vendas v
            left join public.maquininha_contratos c on c.id = v.contrato_id
            left join public.maquininha_importacoes i on i.id = v.importacao_id
           where v.empresa_id = p_empresa_id and v.data_venda between p_inicio and p_fim and v.situacao = 'aprovada'
           group by v.adquirente_chave, v.bandeira, v.modalidade, v.parcelas
        ) x
    ), '[]'::jsonb),
    'maiores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'data', v.data_venda, 'bandeira', v.bandeira, 'modalidade', v.modalidade, 'parcelas', v.parcelas,
               'bruto', v.valor_bruto, 'taxa', v.valor_taxa, 'esperado', v.valor_esperado, 'diferenca', v.diferenca,
               'taxa_contratada', v.taxa_contratada, 'nsu', v.nsu, 'autorizacao', v.autorizacao, 'adquirente_chave', v.adquirente_chave)
             order by v.diferenca desc, v.data_venda)
        from (
          select * from public.maquininha_vendas
           where empresa_id = p_empresa_id and data_venda between p_inicio and p_fim and conferencia = 'acima'
           order by diferenca desc, data_venda
           limit 100
        ) v
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.maquininha_carteira(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(app.tipo_usuario(), '') not in ('admin', 'equipe') then
    raise exception 'Somente a equipe do escritório.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x ->> 'acima')::numeric desc, x ->> 'empresa')
      from (
        select jsonb_build_object(
                 'empresa_id', e.id,
                 'empresa', coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social),
                 'documento', e.documento,
                 'contratos', (select count(*) from public.maquininha_contratos c where c.empresa_id = e.id and c.ativo),
                 'vendas', count(v.id) filter (where v.situacao = 'aprovada'),
                 'bruto', coalesce(sum(v.valor_bruto) filter (where v.situacao = 'aprovada'), 0),
                 'taxas', coalesce(sum(v.valor_taxa) filter (where v.situacao = 'aprovada'), 0),
                 'acima', coalesce(sum(v.diferenca) filter (where v.conferencia = 'acima'), 0),
                 'sem_taxa', count(v.id) filter (where v.conferencia in ('sem_taxa', 'sem_contrato')),
                 'aguardando', (select count(*) from public.maquininha_importacoes i where i.empresa_id = e.id and i.situacao = 'aguardando_mapeamento'),
                 'ultimo_relatorio', (select max(i.created_at) from public.maquininha_importacoes i where i.empresa_id = e.id)
               ) as x
          from public.empresas e
          left join public.maquininha_vendas v on v.empresa_id = e.id and v.data_venda between p_inicio and p_fim
         where e.id = any (app.empresas_com('maquininhas.ver'))
           and (exists (select 1 from public.maquininha_contratos c where c.empresa_id = e.id)
                or exists (select 1 from public.maquininha_importacoes i where i.empresa_id = e.id))
         group by e.id
      ) s
  ), '[]'::jsonb);
end;
$$;

revoke execute on function app.maquininha_normalizar(text), app.maquininha_auditar(uuid, date, date), app.tg_maquininha_taxa_empresa()
  from public, anon, authenticated;
grant execute on function app.maquininha_normalizar(text) to authenticated, service_role;
revoke execute on function public.maquininha_reconferir(uuid, date, date), public.maquininha_registrar_relatorio(uuid, int, text, text, jsonb, jsonb, int),
  public.maquininha_confirmar_mapeamento(uuid, jsonb, text, text, boolean), public.maquininha_concluir_importacao(uuid, jsonb),
  public.maquininha_gravar_vendas(uuid, jsonb), public.maquininha_excluir_importacao(uuid),
  public.maquininha_resumo(uuid, date, date), public.maquininha_carteira(date, date) from public, anon, authenticated;
grant execute on function public.maquininha_reconferir(uuid, date, date), public.maquininha_confirmar_mapeamento(uuid, jsonb, text, text, boolean),
  public.maquininha_excluir_importacao(uuid), public.maquininha_resumo(uuid, date, date), public.maquininha_carteira(date, date) to authenticated;
grant execute on function public.maquininha_registrar_relatorio(uuid, int, text, text, jsonb, jsonb, int), public.maquininha_concluir_importacao(uuid, jsonb),
  public.maquininha_gravar_vendas(uuid, jsonb) to service_role;
