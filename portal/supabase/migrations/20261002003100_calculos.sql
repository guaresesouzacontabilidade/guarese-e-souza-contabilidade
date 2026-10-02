-- =============================================================================
-- Cálculos: previsão de impostos do mês e simulação de rescisão
--
--  * Previsão de impostos: estimativa dos tributos da competência pelo regime
--    da empresa, a partir das notas fiscais (XML) enviadas, da folha
--    (colaboradores e pró-labore) e dos parâmetros definidos pelo escritório.
--    As contas são feitas no servidor do portal com as tabelas oficiais
--    (fonte e vigência em src/lib/calculos); o banco entrega somente os totais
--    a quem tem permissão. É sempre uma estimativa: os valores oficiais são os
--    das guias emitidas pelo escritório.
--  * Colaboradores: cadastro simples (nome, cargo, admissão, salário) usado na
--    previsão da folha e na simulação de rescisão.
--  * Nada é enviado a órgãos públicos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissões novas
--   calculos.ver             ver a previsão e simular rescisões
--   calculos.gerenciar       configurar os cálculos da empresa (somente equipe)
--   colaboradores.gerenciar  cadastrar e alterar colaboradores
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
    'colaboradores.gerenciar'
  ]::text[];
$$;

create or replace function app.permissoes_exclusivas_equipe()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'calculos.gerenciar'
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
      'calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

-- Coerência entre tipo do usuário, papel e permissões (inclui as dos cálculos).
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
  return new;
end;
$$;

-- Acessos existentes: a equipe passa a ter os cálculos; o empresário titular
-- passa a ver a previsão e a cadastrar colaboradores (como nos novos convites).
update public.empresa_membros
   set permissoes = permissoes || array['calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar']
 where papel = 'equipe' and not (permissoes && array['calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar']);
update public.empresa_membros
   set permissoes = permissoes || array['calculos.ver', 'colaboradores.gerenciar']
 where papel = 'cliente_titular' and not (permissoes && array['calculos.ver', 'colaboradores.gerenciar']);
update public.convites
   set permissoes = permissoes || array['calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar']
 where status = 'pendente' and papel = 'equipe' and cardinality(permissoes) > 0
   and not (permissoes && array['calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar']);
update public.convites
   set permissoes = permissoes || array['calculos.ver', 'colaboradores.gerenciar']
 where status = 'pendente' and papel = 'cliente_titular' and cardinality(permissoes) > 0
   and not (permissoes && array['calculos.ver', 'colaboradores.gerenciar']);

-- -----------------------------------------------------------------------------
-- Parâmetros de cálculo da empresa (definidos pelo escritório)
-- -----------------------------------------------------------------------------
create table public.calculo_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  inicio_atividade date,                              -- para proporcionalizar a receita dos 12 meses (Simples)
  -- MEI: valor fixo do DAS conforme a atividade
  mei_atividade text check (mei_atividade in ('comercio_industria', 'servicos', 'comercio_servicos', 'caminhoneiro')),
  -- Simples Nacional
  anexo_mercadorias text not null default 'I' check (anexo_mercadorias in ('I', 'II')),
  anexo_servicos text not null default 'III' check (anexo_servicos in ('III', 'IV', 'V')),
  fator_r boolean not null default false,             -- serviços do Anexo V sujeitos ao Fator R
  -- Lucro Presumido e estimativa mensal do Lucro Real (percentuais de presunção)
  presuncao_irpj_mercadorias numeric(5, 2) not null default 8 check (presuncao_irpj_mercadorias between 0 and 100),
  presuncao_irpj_servicos numeric(5, 2) not null default 32 check (presuncao_irpj_servicos between 0 and 100),
  presuncao_csll_mercadorias numeric(5, 2) not null default 12 check (presuncao_csll_mercadorias between 0 and 100),
  presuncao_csll_servicos numeric(5, 2) not null default 32 check (presuncao_csll_servicos between 0 and 100),
  acrescimo_lc224 boolean not null default true,      -- +10% na presunção acima de R$ 5 milhões/ano (LC 224/2025)
  creditos_pis_cofins boolean not null default true,  -- Lucro Real: créditos sobre as compras das notas de entrada
  -- Tributos estaduais e municipais
  aliquota_iss numeric(5, 2) check (aliquota_iss is null or aliquota_iss between 0 and 5),
  calcular_icms boolean not null default true,
  calcular_ipi boolean not null default false,
  -- Folha (fora do Simples e Anexo IV)
  rat numeric(3, 1) not null default 2 check (rat in (1, 2, 3)),
  fap numeric(5, 4) not null default 1 check (fap between 0.5 and 2),
  terceiros numeric(5, 2) not null default 5.8 check (terceiros between 0 and 10),
  -- Pró-labore mensal (total) e número de sócios que o recebem
  pro_labore numeric(15, 2) not null default 0 check (pro_labore >= 0),
  socios_pro_labore int not null default 1 check (socios_pro_labore between 1 and 50),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger calculo_parametros_updated_at before update on public.calculo_parametros
  for each row execute function app.tg_updated_at();
create trigger auditoria_calculo_parametros after insert or update or delete on public.calculo_parametros
  for each row execute function app.tg_auditoria();

-- Receita e folha informadas mês a mês (histórico anterior ao portal, ou
-- quando as notas do mês não representam toda a receita). Quando informada,
-- a receita do mês substitui a lida das notas.
create table public.calculo_meses (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  receita_mercadorias numeric(15, 2) check (receita_mercadorias is null or receita_mercadorias >= 0),
  receita_servicos numeric(15, 2) check (receita_servicos is null or receita_servicos >= 0),
  folha_fator_r numeric(15, 2) check (folha_fator_r is null or folha_fator_r >= 0),
  observacao text check (observacao is null or length(observacao) <= 500),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (empresa_id, competencia),
  constraint calculo_meses_algum_valor check (num_nonnulls(receita_mercadorias, receita_servicos, folha_fator_r) > 0)
);
create trigger calculo_meses_updated_at before update on public.calculo_meses
  for each row execute function app.tg_updated_at();
create trigger auditoria_calculo_meses after insert or update or delete on public.calculo_meses
  for each row execute function app.tg_auditoria();

-- Valores lançados pelo escritório na previsão do mês (ex.: ICMS-ST, DIFAL,
-- IRPJ por balancete). Negativo reduz a previsão.
create table public.calculo_ajustes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  descricao text not null check (length(trim(descricao)) between 3 and 120),
  valor numeric(15, 2) not null check (valor <> 0),
  observacao text check (observacao is null or length(observacao) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index calculo_ajustes_empresa_idx on public.calculo_ajustes (empresa_id, competencia);
create trigger auditoria_calculo_ajustes after insert or update or delete on public.calculo_ajustes
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- Colaboradores (empregados) da empresa
-- -----------------------------------------------------------------------------
create table public.colaboradores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  cargo text check (cargo is null or length(cargo) <= 80),
  admissao date not null,
  desligamento date,
  contrato text not null default 'indeterminado' check (contrato in ('indeterminado', 'experiencia', 'determinado')),
  fim_contrato date,
  salario numeric(12, 2) not null check (salario > 0 and salario < 1000000),
  adicionais numeric(12, 2) not null default 0 check (adicionais >= 0 and adicionais < 1000000),
  dependentes_ir int not null default 0 check (dependentes_ir between 0 and 20),
  ferias_vencidas int not null default 0 check (ferias_vencidas between 0 and 2),
  saldo_fgts numeric(12, 2) check (saldo_fgts is null or saldo_fgts >= 0),
  observacao text check (observacao is null or length(observacao) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint colaboradores_datas check (
    (desligamento is null or desligamento >= admissao)
    and (fim_contrato is null or fim_contrato >= admissao)
    and (contrato = 'indeterminado' or fim_contrato is not null)
  )
);
create index colaboradores_empresa_idx on public.colaboradores (empresa_id, nome);
create trigger colaboradores_updated_at before update on public.colaboradores
  for each row execute function app.tg_updated_at();
create trigger auditoria_colaboradores after insert or update or delete on public.colaboradores
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- RLS e privilégios
-- -----------------------------------------------------------------------------
alter table public.calculo_parametros enable row level security;
alter table public.calculo_meses enable row level security;
alter table public.calculo_ajustes enable row level security;
alter table public.colaboradores enable row level security;

create policy calculo_parametros_leitura on public.calculo_parametros for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));
create policy calculo_parametros_insercao on public.calculo_parametros for insert to authenticated
  with check ((select app.pode(empresa_id, 'calculos.gerenciar')));
create policy calculo_parametros_alteracao on public.calculo_parametros for update to authenticated
  using ((select app.pode(empresa_id, 'calculos.gerenciar')))
  with check ((select app.pode(empresa_id, 'calculos.gerenciar')));

create policy calculo_meses_leitura on public.calculo_meses for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));
create policy calculo_meses_escrita on public.calculo_meses for all to authenticated
  using ((select app.pode(empresa_id, 'calculos.gerenciar')))
  with check ((select app.pode(empresa_id, 'calculos.gerenciar')));

create policy calculo_ajustes_leitura on public.calculo_ajustes for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));
create policy calculo_ajustes_insercao on public.calculo_ajustes for insert to authenticated
  with check ((select app.pode(empresa_id, 'calculos.gerenciar')));
create policy calculo_ajustes_exclusao on public.calculo_ajustes for delete to authenticated
  using ((select app.pode(empresa_id, 'calculos.gerenciar')));

create policy colaboradores_leitura on public.colaboradores for select to authenticated
  using ((select app.pode(empresa_id, 'calculos.ver')));
create policy colaboradores_escrita on public.colaboradores for all to authenticated
  using ((select app.pode(empresa_id, 'colaboradores.gerenciar')))
  with check ((select app.pode(empresa_id, 'colaboradores.gerenciar')));

grant select on public.calculo_parametros, public.calculo_meses, public.calculo_ajustes, public.colaboradores to authenticated;
grant insert, update on public.calculo_parametros to authenticated;
grant insert, update, delete on public.calculo_meses to authenticated;
grant insert, delete on public.calculo_ajustes to authenticated;
grant insert, update, delete on public.colaboradores to authenticated;

-- Número lido de texto (valores dos XML); inválido vira nulo.
create or replace function app.try_numeric(p_texto text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_texto::numeric;
exception when others then
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Classificação das operações pelo CFOP (aproximação usada na previsão)
-- -----------------------------------------------------------------------------
-- Vendas de mercadorias e produtos (x.1xx; x.401–x.405 com ST; combustíveis)
create or replace function app.cfop_venda(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_cfop ~ '^[567]1[0-9]{2}$' or p_cfop ~ '^[56]40[1-5]$' or p_cfop ~ '^[567]65[1-6]$' or p_cfop ~ '^[56]667$', false);
$$;

-- Venda de mercadoria cujo ICMS já foi retido por substituição tributária
create or replace function app.cfop_venda_st(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_cfop in ('5405', '6404', '5656', '6656'), false);
$$;

-- Prestação de serviços em NF-e/CT-e (ISS conjugado, transporte, comunicação)
create or replace function app.cfop_servico(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_cfop ~ '^[567]93[23]$' or p_cfop ~ '^[567]30[1-7]$' or p_cfop ~ '^[567]35[1-9]$' or p_cfop ~ '^[567]360$', false);
$$;

-- Devolução de vendas recebida (reduz a receita)
create or replace function app.cfop_devolucao_venda(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_cfop ~ '^[123]20[1-4]$' or p_cfop ~ '^[12]41[01]$' or p_cfop ~ '^[12]66[0-2]$', false);
$$;

-- Compras para comercialização ou industrialização (base de créditos)
create or replace function app.cfop_compra(p_cfop text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_cfop ~ '^[123]1[0-9]{2}$' or p_cfop ~ '^[12]40[1-3]$' or p_cfop ~ '^[123]65[1-3]$', false);
$$;

-- -----------------------------------------------------------------------------
-- Dados da previsão: totais do mês e dos 12 anteriores, checklist, folha,
-- ajustes e vencimentos (das tarefas de obrigações). Somente totais.
-- -----------------------------------------------------------------------------
create or replace function public.dados_previsao_impostos(p_empresa_id uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_inicio date := (date_trunc('month', p_competencia) - interval '12 months')::date;
  v_emp public.empresas;
  v_meses jsonb;
  v_checklist jsonb;
begin
  perform app.exigir(p_empresa_id, 'calculos.ver');
  select * into v_emp from public.empresas where id = p_empresa_id;

  with notas as (
    select df.*
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
     where df.empresa_id = p_empresa_id
       and df.competencia between v_inicio and v_comp
       and df.relacionado_empresa
       and not df.cancelada_evento
       and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
       and d.excluido_em is null
       and coalesce(d.verificacao_status, '') <> 'bloqueado'
       and not (df.avisos::text ilike '%registro de cancelamento%')
  ),
  itens as (
    select n.competencia, n.operacao, i.cfop,
           coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor,
           coalesce(app.try_numeric(i.tributos ->> 'icms'), 0) as icms
      from notas n
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
     where n.modelo in ('55', '65')
  ),
  servicos as (
    select n.competencia,
           coalesce(n.valor_servicos, n.valor_total, 0) as valor,
           n.tributos ? 'iss_retido' as retido,
           app.try_numeric(n.tributos ->> 'iss') as iss
      from notas n
     where n.operacao = 'saida' and n.modelo in ('nfse_nacional', 'nfse_abrasf', '57')
  ),
  meses as (
    select g::date as competencia from generate_series(v_inicio, v_comp, interval '1 month') g
  )
  select jsonb_agg(jsonb_build_object(
           'competencia', m.competencia,
           'vendas', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'vendas_st', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda_st(i.cfop)),
           'icms_vendas', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'servicos_nfe', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_servico(i.cfop)),
           'devolucoes', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'icms_devolucoes', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'compras', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop)),
           'icms_compras', (select coalesce(sum(icms), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_compra(i.cfop)),
           'servicos', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia),
           'servicos_retido', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'iss_destacado', (select coalesce(sum(iss), 0) from servicos s where s.competencia = m.competencia and not s.retido),
           'servicos_sem_iss', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia and not s.retido and s.iss is null),
           'iss_retido', (select coalesce(sum(iss), 0) from servicos s where s.competencia = m.competencia and s.retido),
           'icms_debito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'icms')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'saida' and n.modelo in ('55', '65')),
           'icms_credito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'icms')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'entrada' and n.modelo in ('55', '57')),
           'ipi_debito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'ipi')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'saida' and n.modelo = '55'),
           'ipi_credito', (select coalesce(sum(app.try_numeric(n.tributos ->> 'ipi')), 0) from notas n where n.competencia = m.competencia and n.operacao = 'entrada' and n.modelo = '55'),
           'notas_saida', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'saida'),
           'notas_entrada', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'entrada'),
           'informado', (select jsonb_build_object('receita_mercadorias', cm.receita_mercadorias, 'receita_servicos', cm.receita_servicos,
                                                   'folha_fator_r', cm.folha_fator_r, 'observacao', cm.observacao)
                           from public.calculo_meses cm where cm.empresa_id = p_empresa_id and cm.competencia = m.competencia)
         ) order by m.competencia)
    into v_meses
    from meses m;

  select jsonb_build_object(
           'itens', count(*),
           'obrigatorios', count(*) filter (where c.obrigatorio),
           'faltantes', coalesce(jsonb_agg(jsonb_build_object('titulo', c.titulo, 'status', c.status, 'prazo', c.prazo) order by c.prazo, c.titulo)
                                   filter (where c.obrigatorio and c.status in ('pendente', 'correcao')), '[]'::jsonb)
         )
    into v_checklist
    from public.checklist_itens c
   where c.empresa_id = p_empresa_id and c.competencia = v_comp;

  return jsonb_build_object(
    'competencia', v_comp,
    'empresa', jsonb_build_object(
      'nome', coalesce(nullif(trim(v_emp.nome_fantasia), ''), v_emp.razao_social),
      'regime', app.regime_em(p_empresa_id, v_comp),
      'lucro_real_apuracao', app.lucro_real_apuracao_em(p_empresa_id, v_comp),
      'contribuinte_icms', v_emp.contribuinte_icms,
      'contribuinte_iss', v_emp.contribuinte_iss,
      'tem_empregados', v_emp.tem_empregados,
      'tem_pro_labore', v_emp.tem_pro_labore,
      'uf', v_emp.uf
    ),
    'parametros', (select to_jsonb(p) - 'atualizado_por' - 'created_at' from public.calculo_parametros p where p.empresa_id = p_empresa_id),
    'meses', coalesce(v_meses, '[]'::jsonb),
    'checklist', v_checklist,
    -- Folha: só valores e datas (sem nomes)
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object('admissao', c.admissao, 'desligamento', c.desligamento, 'salario', c.salario,
                                          'adicionais', c.adicionais, 'dependentes_ir', c.dependentes_ir))
        from public.colaboradores c
       where c.empresa_id = p_empresa_id
         and c.admissao <= (v_comp + interval '1 month' - interval '1 day')::date
         and (c.desligamento is null or c.desligamento >= v_inicio)
    ), '[]'::jsonb),
    'ajustes', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'descricao', a.descricao, 'valor', a.valor, 'observacao', a.observacao) order by a.created_at)
        from public.calculo_ajustes a
       where a.empresa_id = p_empresa_id and a.competencia = v_comp
    ), '[]'::jsonb),
    -- Vencimentos calculados pelo módulo de obrigações (regras validadas) e
    -- o valor da guia, quando o escritório já a publicou.
    'vencimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', o.codigo,
               'vencimento', t.prazo_legal,
               'valor_guia', case when gd.publicado_em is not null and gd.excluido_em is null then t.valor end,
               'concluida', t.status = 'concluida'))
        from public.tarefas t
        join public.obrigacoes o on o.id = t.obrigacao_id
        left join public.documentos gd on gd.id = t.guia_documento_id
       where t.empresa_id = p_empresa_id and t.competencia = v_comp and t.etapa = 'pagamento' and t.status <> 'dispensada'
    ), '[]'::jsonb),
    'guias_publicadas', (
      select count(*) from public.documentos d
       where d.empresa_id = p_empresa_id and d.competencia = v_comp and d.categoria_codigo = 'esc_guia'
         and d.publicado_em is not null and d.excluido_em is null
    )
  );
end;
$$;

revoke execute on function public.dados_previsao_impostos(uuid, date) from public, anon;
grant execute on function public.dados_previsao_impostos(uuid, date) to authenticated;
revoke execute on function app.try_numeric(text), app.cfop_venda(text), app.cfop_venda_st(text), app.cfop_servico(text),
  app.cfop_devolucao_venda(text), app.cfop_compra(text) from public, anon;
grant execute on function app.try_numeric(text), app.cfop_venda(text), app.cfop_venda_st(text), app.cfop_servico(text),
  app.cfop_devolucao_venda(text), app.cfop_compra(text) to authenticated, service_role;
