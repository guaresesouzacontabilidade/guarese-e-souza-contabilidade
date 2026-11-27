-- =============================================================================
-- Financeiro, etapa 1
--  1. Permissões separadas: baixar, estornar, aprovar e exportar (quem já
--     edita o financeiro recebe baixar, estornar e exportar; o titular e o
--     escritório também aprovam).
--  2. Baixa segura: pelo servidor, com trava no título e chave contra clique
--     duplo; baixas em lote numa transação só.
--  3. Estorno com justificativa: a baixa estornada vai para o histórico
--     (baixas_estornadas) em vez de sumir.
--  4. Aprovação de pagamentos por faixa de valor (quando configurada).
--  5. Renegociação: os títulos originais ficam "renegociados" e as parcelas do
--     acordo não entram de novo no resultado (DRE); juros ou desconto do acordo
--     entram como ajuste do mês.
--  6. Recorrência: alterar só esta, esta e as próximas, ou encerrar.
--  7. Parcelas com datas e valores escolhidos; ações em lote.
--  8. Painel da visão geral e histórico do cliente/fornecedor.
-- =============================================================================

-- Troca um trecho no corpo de uma função já existente; falha se não achar.
-- (Âncoras no código, não em comentários: em produção as funções foram
-- gravadas sem comentários.)
create function pg_temp.trocar_no_corpo(p_funcao regprocedure, p_de text, p_para text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_funcao);
begin
  if position(p_de in v_def) = 0 then
    raise exception 'Trecho não encontrado em %: %', p_funcao, p_de;
  end if;
  execute replace(v_def, p_de, p_para);
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Permissões
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
    'financeiro.baixar',
    'financeiro.estornar',
    'financeiro.aprovar',
    'financeiro.exportar',
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
    'gestao.custos',
    'cte.emitir',
    'cte.configurar',
    'escalas.ver',
    'escalas.gerenciar',
    'rh.gerenciar',
    'rh.tarefas',
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
      'financeiro.baixar', 'financeiro.estornar', 'financeiro.aprovar', 'financeiro.exportar',
      'relatorios.ver', 'relatorios.publicar',
      'fechamento.gerenciar',
      'mensagens.usar',
      'calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver', 'auditor.gerenciar',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir', 'nfse.configurar',
      'nfe.emitir', 'nfe.configurar',
      'gestao.vender', 'gestao.gerenciar', 'gestao.custos',
      'cte.emitir', 'cte.configurar',
      'escalas.ver', 'escalas.gerenciar',
      'rh.gerenciar', 'rh.tarefas',
      'os.operar', 'os.gerenciar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'financeiro.baixar', 'financeiro.estornar', 'financeiro.aprovar', 'financeiro.exportar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir',
      'nfe.emitir',
      'gestao.vender', 'gestao.gerenciar', 'gestao.custos',
      'cte.emitir',
      'escalas.ver', 'escalas.gerenciar',
      'rh.gerenciar', 'rh.tarefas',
      'os.operar', 'os.gerenciar'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar',
      'rh.tarefas'
    ]
    else array[]::text[]
  end;
$$;

-- Qualquer permissão do financeiro implica ver o financeiro.
select pg_temp.trocar_no_corpo('app.tg_validar_membro()',
$a$  if 'financeiro.editar' = any(new.permissoes) and not ('financeiro.ver' = any(new.permissoes)) then$a$,
$a$  if (new.permissoes && array['financeiro.editar', 'financeiro.importar', 'financeiro.baixar', 'financeiro.estornar', 'financeiro.aprovar', 'financeiro.exportar'])
     and not ('financeiro.ver' = any(new.permissoes)) then$a$);

-- Acessos existentes: quem já editava o financeiro passa a baixar, estornar e
-- exportar (nada muda para ninguém); o titular e o escritório também aprovam.
update public.empresa_membros
   set permissoes = array(select distinct unnest(permissoes || array['financeiro.baixar', 'financeiro.estornar', 'financeiro.exportar']))
 where 'financeiro.editar' = any(permissoes)
   and not (permissoes @> array['financeiro.baixar', 'financeiro.estornar', 'financeiro.exportar']);
update public.empresa_membros
   set permissoes = array(select distinct unnest(permissoes || array['financeiro.aprovar']))
 where papel in ('equipe', 'cliente_titular') and 'financeiro.editar' = any(permissoes)
   and not ('financeiro.aprovar' = any(permissoes));
update public.convites
   set permissoes = array(select distinct unnest(permissoes || array['financeiro.baixar', 'financeiro.estornar', 'financeiro.exportar']))
 where status = 'pendente' and 'financeiro.editar' = any(permissoes)
   and not (permissoes @> array['financeiro.baixar', 'financeiro.estornar', 'financeiro.exportar']);
update public.convites
   set permissoes = array(select distinct unnest(permissoes || array['financeiro.aprovar']))
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and 'financeiro.editar' = any(permissoes)
   and not ('financeiro.aprovar' = any(permissoes));

-- Baixas: registrar exige "baixar"; alterar e apagar só pelo servidor (estorno
-- com justificativa, conciliação, cancelamento da venda...).
drop policy if exists baixas_insercao on public.baixas;
create policy baixas_insercao on public.baixas for insert to authenticated
  with check (empresa_id = any ((select app.empresas_com('financeiro.baixar'))::uuid[]));
drop policy if exists baixas_alteracao on public.baixas;
drop policy if exists baixas_exclusao on public.baixas;

-- -----------------------------------------------------------------------------
-- 2. Novas colunas e tabelas
-- -----------------------------------------------------------------------------
alter table public.lancamentos drop constraint lancamentos_situacao_check;
alter table public.lancamentos add constraint lancamentos_situacao_check
  check (situacao in ('aberto', 'parcial', 'quitado', 'cancelado', 'renegociado'));
alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha',
  'cartao', 'venda', 'hotel', 'veterinaria', 'fisioterapia', 'os', 'renegociacao'
));

alter table public.lancamentos
  add column aprovacao_status text not null default 'nao_exige'
    check (aprovacao_status in ('nao_exige', 'pendente', 'aprovado', 'reprovado')),
  add column aprovacoes_necessarias smallint not null default 0 check (aprovacoes_necessarias between 0 and 3),
  add column fora_do_resultado boolean not null default false,
  add column renegociacao_id uuid,
  add column renegociado_em_id uuid,
  add column recorrencia_data_original date;

alter table public.baixas add column chave_idempotencia uuid;
create unique index baixas_chave_idempotencia_uk on public.baixas (empresa_id, chave_idempotencia)
  where chave_idempotencia is not null;

-- Histórico das baixas estornadas (o estorno não apaga o registro).
create table public.baixas_estornadas (
  id uuid primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid not null,
  tipo text not null check (tipo in ('receber', 'pagar')),
  data_pagamento date not null,
  conta_financeira_id uuid,
  valor_principal numeric(15,2) not null,
  juros numeric(15,2) not null default 0,
  multa numeric(15,2) not null default 0,
  desconto numeric(15,2) not null default 0,
  taxas numeric(15,2) not null default 0,
  valor_total numeric(15,2) not null,
  forma_pagamento text,
  observacao text,
  origem text not null,
  criado_por uuid references public.perfis(id) on delete set null,
  criado_em timestamptz not null,
  estornado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  estornado_em timestamptz not null default now(),
  motivo_estorno text not null check (length(trim(motivo_estorno)) between 5 and 500),
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id) on delete cascade
);
alter table public.baixas_estornadas add constraint baixas_estornadas_conta_fk foreign key (empresa_id, conta_financeira_id)
  references public.contas_financeiras (empresa_id, id) on delete set null (conta_financeira_id);
create index baixas_estornadas_lancamento_idx on public.baixas_estornadas (lancamento_id);
create index baixas_estornadas_empresa_idx on public.baixas_estornadas (empresa_id, estornado_em desc);
alter table public.baixas_estornadas enable row level security;
create policy baixas_estornadas_leitura on public.baixas_estornadas for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
grant select on public.baixas_estornadas to authenticated;
create trigger auditoria_baixas_estornadas after insert or update or delete on public.baixas_estornadas
  for each row execute function app.tg_auditoria();

-- Faixas de aprovação de pagamentos (vazias = não exige aprovação).
create table public.financeiro_aprovacao_faixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  valor_minimo numeric(15,2) not null check (valor_minimo > 0 and valor_minimo < 1000000000000),
  aprovacoes smallint not null default 1 check (aprovacoes between 1 and 3),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint financeiro_aprovacao_faixas_uk unique (empresa_id, valor_minimo)
);
alter table public.financeiro_aprovacao_faixas enable row level security;
create policy financeiro_aprovacao_faixas_leitura on public.financeiro_aprovacao_faixas for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
grant select on public.financeiro_aprovacao_faixas to authenticated;
create trigger auditoria_financeiro_aprovacao_faixas after insert or update or delete on public.financeiro_aprovacao_faixas
  for each row execute function app.tg_auditoria();

-- Decisões de aprovação (cada pessoa, para o valor do título naquele momento).
create table public.lancamento_aprovacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  lancamento_id uuid not null,
  decisao text not null check (decisao in ('aprovado', 'reprovado')),
  justificativa text check (justificativa is null or length(trim(justificativa)) between 3 and 500),
  valor numeric(15,2) not null,
  decidido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, lancamento_id) references public.lancamentos (empresa_id, id) on delete cascade
);
create index lancamento_aprovacoes_lancamento_idx on public.lancamento_aprovacoes (lancamento_id, created_at);
alter table public.lancamento_aprovacoes enable row level security;
create policy lancamento_aprovacoes_leitura on public.lancamento_aprovacoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
grant select on public.lancamento_aprovacoes to authenticated;
create trigger auditoria_lancamento_aprovacoes after insert or update or delete on public.lancamento_aprovacoes
  for each row execute function app.tg_auditoria();

-- Renegociações: títulos originais ⇄ parcelas do acordo.
create table public.renegociacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  numero int not null check (numero >= 1),
  tipo text not null check (tipo in ('receber', 'pagar')),
  motivo text not null check (length(trim(motivo)) between 5 and 500),
  valor_renegociado numeric(15,2) not null check (valor_renegociado > 0),
  valor_novo numeric(15,2) not null check (valor_novo > 0),
  encargos numeric(15,2) generated always as (valor_novo - valor_renegociado) stored,
  dre_ajuste_id uuid references public.dre_ajustes(id) on delete set null,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  desfeita_em timestamptz,
  desfeita_por uuid references public.perfis(id) on delete set null,
  motivo_desfazer text,
  constraint renegociacoes_empresa_id_unico unique (empresa_id, id),
  constraint renegociacoes_numero_uk unique (empresa_id, numero)
);
alter table public.renegociacoes enable row level security;
create policy renegociacoes_leitura on public.renegociacoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
grant select on public.renegociacoes to authenticated;
create trigger auditoria_renegociacoes after insert or update or delete on public.renegociacoes
  for each row execute function app.tg_auditoria();

alter table public.lancamentos
  add constraint lancamentos_renegociacao_fk foreign key (empresa_id, renegociacao_id)
    references public.renegociacoes (empresa_id, id),
  add constraint lancamentos_renegociado_em_fk foreign key (empresa_id, renegociado_em_id)
    references public.renegociacoes (empresa_id, id);
create index lancamentos_renegociacao_idx on public.lancamentos (renegociacao_id) where renegociacao_id is not null;
create index lancamentos_renegociado_em_idx on public.lancamentos (renegociado_em_id) where renegociado_em_id is not null;
create index lancamentos_aprovacao_idx on public.lancamentos (empresa_id) where aprovacao_status = 'pendente';

-- -----------------------------------------------------------------------------
-- 3. Regras nos gatilhos
-- -----------------------------------------------------------------------------
-- Títulos renegociados não se alteram fora da renegociação; a situação
-- derivada das baixas não sobrescreve "renegociado".
select pg_temp.trocar_no_corpo('app.tg_lancamentos_regras()',
$a$  if new.tipo <> old.tipo and old.valor_baixado > 0 then$a$,
$a$  if (old.situacao = 'renegociado' or new.situacao = 'renegociado' or old.renegociacao_id is not null)
     and coalesce(current_setting('app.renegociacao', true), '') <> 'on' then
    if old.situacao = 'renegociado' and (new.situacao <> old.situacao or (to_jsonb(old) - v_livres) <> (to_jsonb(new) - v_livres)) then
      raise exception 'Este título foi renegociado. Para alterá-lo, desfaça a renegociação.';
    end if;
    if new.situacao = 'renegociado' and old.situacao <> 'renegociado' then
      raise exception 'Use a renegociação para renegociar títulos.';
    end if;
    if old.renegociacao_id is not null and new.situacao = 'cancelado' and old.situacao <> 'cancelado' then
      raise exception 'Parcela de renegociação não se cancela: desfaça a renegociação ou registre o pagamento com desconto.';
    end if;
  end if;
  if new.tipo <> old.tipo and old.valor_baixado > 0 then$a$);
select pg_temp.trocar_no_corpo('app.tg_lancamentos_regras()',
$a$  if new.situacao <> 'cancelado' then
    new.situacao := case$a$,
$a$  if new.situacao not in ('cancelado', 'renegociado') then
    new.situacao := case$a$);
select pg_temp.trocar_no_corpo('app.tg_lancamentos_regras()',
$a$    if exists (select 1 from public.baixas where lancamento_id = old.id) then$a$,
$a$    if (old.situacao = 'renegociado' or old.renegociacao_id is not null)
       and coalesce(current_setting('app.renegociacao', true), '') <> 'on' then
      raise exception 'Título de renegociação: desfaça a renegociação antes de excluir.';
    end if;
    if exists (select 1 from public.baixas where lancamento_id = old.id) then$a$);
select pg_temp.trocar_no_corpo('app.tg_lancamentos_regras()',
$a$'situacao', 'updated_at', 'observacoes'];$a$,
$a$'situacao', 'updated_at', 'observacoes', 'aprovacao_status', 'aprovacoes_necessarias'];$a$);

-- Baixa: título renegociado não recebe baixa; pagamento à espera de aprovação
-- não é baixado à mão (o que o banco já mostrou, via conciliação, entra).
select pg_temp.trocar_no_corpo('app.tg_baixas_regras()',
$a$  new.tipo := v_lanc.tipo;$a$,
$a$  if v_lanc.situacao = 'renegociado' then
    raise exception 'Título renegociado: os pagamentos agora são feitos nas parcelas do acordo.';
  end if;
  if tg_op = 'INSERT' and v_lanc.tipo = 'pagar' and v_lanc.aprovacao_status in ('pendente', 'reprovado')
     and new.origem in ('manual', 'importacao') then
    raise exception 'Este pagamento precisa ser aprovado antes da baixa (%).',
      case v_lanc.aprovacao_status when 'pendente' then 'aguardando aprovação' else 'reprovado' end;
  end if;
  new.tipo := v_lanc.tipo;$a$);

-- Aprovação calculada e data original da ocorrência recorrente.
create or replace function app.tg_lancamentos_complementos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nec int;
  v_aprov int;
  v_reprov boolean;
begin
  -- Ocorrência recorrente com vencimento mudado: guarda a data original para a
  -- recorrência não gerar outra no lugar.
  if tg_op = 'UPDATE' and new.recorrencia_id is not null and new.data_vencimento <> old.data_vencimento
     and new.recorrencia_data_original is null then
    new.recorrencia_data_original := old.data_vencimento;
  end if;

  if new.tipo <> 'pagar' or new.situacao = 'cancelado' then
    new.aprovacoes_necessarias := 0;
    new.aprovacao_status := 'nao_exige';
    return new;
  end if;
  -- Pagos e renegociados mantêm a situação de aprovação que tinham.
  if new.situacao in ('quitado', 'renegociado') then
    return new;
  end if;
  select coalesce(max(f.aprovacoes), 0) into v_nec
    from public.financeiro_aprovacao_faixas f
   where f.empresa_id = new.empresa_id and f.valor_minimo <= new.valor_previsto;
  new.aprovacoes_necessarias := v_nec;
  if v_nec = 0 then
    new.aprovacao_status := 'nao_exige';
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.aprovacao_status := 'pendente';
    return new;
  end if;
  -- A última decisão de cada pessoa, para o valor atual do título
  select count(*) filter (where d.decisao = 'aprovado'), coalesce(bool_or(d.decisao = 'reprovado'), false)
    into v_aprov, v_reprov
    from (
      select distinct on (a.decidido_por) a.decisao
        from public.lancamento_aprovacoes a
       where a.lancamento_id = new.id and a.valor = new.valor_previsto
       order by a.decidido_por, a.created_at desc
    ) d;
  new.aprovacao_status := case when v_reprov then 'reprovado' when v_aprov >= v_nec then 'aprovado' else 'pendente' end;
  return new;
end;
$$;
create trigger lancamentos_zz_complementos before insert or update on public.lancamentos
  for each row execute function app.tg_lancamentos_complementos();

-- Recorrência: a data de uma ocorrência que mudou de vencimento não é gerada de novo.
select pg_temp.trocar_no_corpo('app.gerar_recorrencias(uuid,date)',
$a$      if v_data >= r.data_inicio and not app.competencia_fechada(r.empresa_id, v_data) then$a$,
$a$      if v_data >= r.data_inicio and not app.competencia_fechada(r.empresa_id, v_data)
         and not exists (select 1 from public.lancamentos x where x.recorrencia_id = r.id and x.recorrencia_data_original = v_data) then$a$);

-- DRE: as parcelas de um acordo de renegociação não entram de novo no resultado.
select pg_temp.trocar_no_corpo('public.relatorio_dre_linhas(uuid,date,date,uuid,uuid)',
$a$and l.situacao <> 'cancelado'$a$,
$a$and l.situacao <> 'cancelado' and not l.fora_do_resultado$a$);
select pg_temp.trocar_no_corpo('public.relatorio_dre_composicao(uuid,date,date,text[],uuid,uuid,uuid[])',
$a$and l.situacao <> 'cancelado'$a$,
$a$and l.situacao <> 'cancelado' and not l.fora_do_resultado$a$);

-- -----------------------------------------------------------------------------
-- 4. Baixa segura (uma ou em lote) e estorno com justificativa
-- -----------------------------------------------------------------------------
create or replace function public.financeiro_baixar(
  p_empresa_id uuid,
  p_lancamento_id uuid,
  p_data date,
  p_conta_id uuid,
  p_valor_principal numeric,
  p_juros numeric default 0,
  p_multa numeric default 0,
  p_desconto numeric default 0,
  p_taxas numeric default 0,
  p_forma text default null,
  p_observacao text default null,
  p_chave uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'financeiro.baixar');
  -- Mesmo pedido de novo (clique duplo, rede lenta): devolve a baixa já feita
  if p_chave is not null then
    select id into v_id from public.baixas where empresa_id = p_empresa_id and chave_idempotencia = p_chave;
    if found then
      return v_id;
    end if;
  end if;
  perform 1 from public.lancamentos where id = p_lancamento_id and empresa_id = p_empresa_id for update;
  if not found then
    raise exception 'Título não encontrado.';
  end if;
  if p_chave is not null then
    select id into v_id from public.baixas where empresa_id = p_empresa_id and chave_idempotencia = p_chave;
    if found then
      return v_id;
    end if;
  end if;
  if p_data is null then
    raise exception 'Informe a data do pagamento.';
  end if;
  if p_data > app.hoje() + 1 then
    raise exception 'A data do pagamento não pode ser no futuro.';
  end if;
  insert into public.baixas (
    empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, juros, multa, desconto, taxas,
    forma_pagamento, observacao, origem, chave_idempotencia
  ) values (
    p_empresa_id, p_lancamento_id, 'receber', p_data, p_conta_id, round(p_valor_principal, 2),
    round(coalesce(p_juros, 0), 2), round(coalesce(p_multa, 0), 2), round(coalesce(p_desconto, 0), 2), round(coalesce(p_taxas, 0), 2),
    nullif(p_forma, ''), nullif(trim(coalesce(p_observacao, '')), ''), 'manual', p_chave
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.financeiro_baixar(uuid, uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.financeiro_baixar(uuid, uuid, date, uuid, numeric, numeric, numeric, numeric, numeric, text, text, uuid) to authenticated;

-- Baixa em lote: quita o saldo de cada título escolhido, tudo ou nada.
create or replace function public.financeiro_baixar_lote(
  p_empresa_id uuid, p_ids uuid[], p_data date, p_conta_id uuid, p_forma text default null, p_chave uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_qtd int := 0;
  v_total numeric(15,2) := 0;
  v_chave uuid;
begin
  perform app.exigir(p_empresa_id, 'financeiro.baixar');
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Selecione ao menos um título.';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Selecione no máximo 500 títulos por vez.';
  end if;
  if p_data is null or p_data > app.hoje() + 1 then
    raise exception 'Informe uma data de pagamento válida (até hoje).';
  end if;
  for r in
    select l.id, l.descricao, l.valor_previsto - l.valor_baixado as saldo
      from public.lancamentos l
     where l.empresa_id = p_empresa_id and l.id = any(p_ids)
     order by l.data_vencimento, l.id
       for update
  loop
    v_chave := case when p_chave is null then null else md5(p_chave::text || r.id::text)::uuid end;
    if v_chave is not null and exists (select 1 from public.baixas where empresa_id = p_empresa_id and chave_idempotencia = v_chave) then
      continue;
    end if;
    if r.saldo <= 0 then
      continue;
    end if;
    begin
      insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal,
                                 forma_pagamento, origem, chave_idempotencia)
      values (p_empresa_id, r.id, 'receber', p_data, p_conta_id, r.saldo, nullif(p_forma, ''), 'manual', v_chave);
    exception when others then
      raise exception 'Título "%": %', r.descricao, sqlerrm;
    end;
    v_qtd := v_qtd + 1;
    v_total := v_total + r.saldo;
  end loop;
  return jsonb_build_object('quantidade', v_qtd, 'total', v_total);
end;
$$;
revoke all on function public.financeiro_baixar_lote(uuid, uuid[], date, uuid, text, uuid) from public, anon;
grant execute on function public.financeiro_baixar_lote(uuid, uuid[], date, uuid, text, uuid) to authenticated;

create or replace function public.financeiro_estornar_baixa(p_empresa_id uuid, p_baixa_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.baixas;
  v_situacao text;
begin
  perform app.exigir(p_empresa_id, 'financeiro.estornar');
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Explique o motivo do estorno (ao menos 5 letras).';
  end if;
  select * into v_b from public.baixas where id = p_baixa_id and empresa_id = p_empresa_id for update;
  if not found then
    raise exception 'Pagamento não encontrado (talvez já tenha sido estornado).';
  end if;
  select situacao into v_situacao from public.lancamentos where id = v_b.lancamento_id for update;
  if v_b.conciliacao_id is not null then
    raise exception 'Este pagamento está conciliado com o extrato. Desfaça a conciliação antes de estornar.';
  end if;
  if v_b.origem not in ('manual', 'importacao') then
    raise exception 'Este pagamento veio de %. Estorne por lá para manter tudo igual.',
      case v_b.origem
        when 'venda' then 'uma venda do caixa (cancele a venda)'
        when 'maquininha' then 'uma venda em maquininha'
        when 'cartao' then 'uma compra no cartão'
        when 'hotel' then 'um pagamento do hotel'
        when 'veterinaria' then 'um pagamento da clínica'
        when 'fisioterapia' then 'um recebimento da fisioterapia'
        when 'os' then 'uma ordem de serviço'
        else 'outra tela do portal'
      end;
  end if;
  if v_situacao = 'renegociado' then
    raise exception 'O título foi renegociado. Desfaça a renegociação antes de estornar este pagamento.';
  end if;
  insert into public.baixas_estornadas (
    id, empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, juros, multa, desconto, taxas,
    valor_total, forma_pagamento, observacao, origem, criado_por, criado_em, motivo_estorno
  ) values (
    v_b.id, v_b.empresa_id, v_b.lancamento_id, v_b.tipo, v_b.data_pagamento, v_b.conta_financeira_id, v_b.valor_principal,
    v_b.juros, v_b.multa, v_b.desconto, v_b.taxas, v_b.valor_total, v_b.forma_pagamento, v_b.observacao, v_b.origem,
    v_b.criado_por, v_b.created_at, trim(p_motivo)
  );
  delete from public.baixas where id = v_b.id;
end;
$$;
revoke all on function public.financeiro_estornar_baixa(uuid, uuid, text) from public, anon;
grant execute on function public.financeiro_estornar_baixa(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Aprovação de pagamentos
-- -----------------------------------------------------------------------------
create or replace function public.financeiro_aprovacao_salvar(p_empresa_id uuid, p_faixas jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb;
  v_n int;
begin
  perform app.exigir(p_empresa_id, 'financeiro.aprovar');
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if jsonb_typeof(coalesce(p_faixas, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_faixas, '[]'::jsonb)) > 5 then
    raise exception 'Informe até 5 faixas de valor.';
  end if;
  delete from public.financeiro_aprovacao_faixas where empresa_id = p_empresa_id;
  for f in select * from jsonb_array_elements(coalesce(p_faixas, '[]'::jsonb)) loop
    if coalesce((f ->> 'valor_minimo')::numeric, 0) <= 0 then
      raise exception 'Cada faixa precisa de um valor mínimo maior que zero.';
    end if;
    insert into public.financeiro_aprovacao_faixas (empresa_id, valor_minimo, aprovacoes)
    values (p_empresa_id, round((f ->> 'valor_minimo')::numeric, 2), coalesce((f ->> 'aprovacoes')::smallint, 1));
  end loop;
  -- Recalcula os pagamentos em aberto (o gatilho decide a situação)
  update public.lancamentos
     set aprovacoes_necessarias = aprovacoes_necessarias
   where empresa_id = p_empresa_id and tipo = 'pagar' and situacao in ('aberto', 'parcial');
  get diagnostics v_n = row_count;
  return v_n;
exception when unique_violation then
  raise exception 'Há duas faixas com o mesmo valor mínimo.';
end;
$$;
revoke all on function public.financeiro_aprovacao_salvar(uuid, jsonb) from public, anon;
grant execute on function public.financeiro_aprovacao_salvar(uuid, jsonb) to authenticated;

create or replace function public.financeiro_aprovar(p_empresa_id uuid, p_ids uuid[], p_decisao text, p_justificativa text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  perform app.exigir(p_empresa_id, 'financeiro.aprovar');
  if p_decisao not in ('aprovado', 'reprovado') then
    raise exception 'Decisão inválida.';
  end if;
  if p_decisao = 'reprovado' and length(trim(coalesce(p_justificativa, ''))) < 3 then
    raise exception 'Explique por que o pagamento foi reprovado.';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Selecione ao menos um pagamento.';
  end if;
  for r in
    select l.id, l.descricao, l.valor_previsto, l.criado_por, l.aprovacao_status, l.situacao, l.tipo
      from public.lancamentos l
     where l.empresa_id = p_empresa_id and l.id = any(p_ids)
       for update
  loop
    if r.tipo <> 'pagar' or r.aprovacao_status = 'nao_exige' or r.situacao not in ('aberto', 'parcial') then
      raise exception '"%" não está aguardando aprovação.', r.descricao;
    end if;
    if r.criado_por is not null and r.criado_por = auth.uid() then
      raise exception 'Quem lançou "%" não pode aprová-lo. Peça a outra pessoa com permissão de aprovar.', r.descricao;
    end if;
    insert into public.lancamento_aprovacoes (empresa_id, lancamento_id, decisao, justificativa, valor)
    values (p_empresa_id, r.id, p_decisao, nullif(trim(coalesce(p_justificativa, '')), ''), r.valor_previsto);
    update public.lancamentos set aprovacoes_necessarias = aprovacoes_necessarias where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.financeiro_aprovar(uuid, uuid[], text, text) from public, anon;
grant execute on function public.financeiro_aprovar(uuid, uuid[], text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Renegociação
-- -----------------------------------------------------------------------------
create or replace function public.financeiro_renegociar(
  p_empresa_id uuid, p_lancamentos uuid[], p_parcelas jsonb, p_motivo text, p_descricao text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := app.hoje();
  v_ids uuid[];
  v_n int;
  v_tipos int;
  v_tipo text;
  v_saldo numeric(15,2);
  v_novo numeric(15,2) := 0;
  v_qtd int;
  v_reneg uuid;
  v_num int;
  v_cat uuid;
  v_contra uuid;
  v_centro uuid;
  v_proj uuid;
  v_desc text;
  v_cod text;
  v_aj uuid;
  p jsonb;
  i int := 0;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Explique o motivo da renegociação (ao menos 5 letras).';
  end if;
  v_ids := array(select distinct unnest(coalesce(p_lancamentos, '{}')));
  if cardinality(v_ids) = 0 then
    raise exception 'Escolha os títulos a renegociar.';
  end if;
  perform 1 from public.lancamentos where empresa_id = p_empresa_id and id = any(v_ids) order by id for update;
  select count(*), count(distinct tipo), min(tipo), sum(valor_previsto - valor_baixado)
    into v_n, v_tipos, v_tipo, v_saldo
    from public.lancamentos where empresa_id = p_empresa_id and id = any(v_ids);
  if v_n <> cardinality(v_ids) then
    raise exception 'Algum título não foi encontrado.';
  end if;
  if v_tipos > 1 then
    raise exception 'Renegocie só contas a receber ou só contas a pagar de cada vez.';
  end if;
  if exists (select 1 from public.lancamentos where empresa_id = p_empresa_id and id = any(v_ids)
              and (situacao not in ('aberto', 'parcial') or status_revisao <> 'confirmado')) then
    raise exception 'Só títulos em aberto (ou pagos em parte) e confirmados podem ser renegociados.';
  end if;

  -- Parcelas do acordo
  if jsonb_typeof(coalesce(p_parcelas, 'null'::jsonb)) <> 'array' then
    raise exception 'Informe as parcelas do acordo.';
  end if;
  v_qtd := jsonb_array_length(p_parcelas);
  if v_qtd < 1 or v_qtd > 120 then
    raise exception 'O acordo deve ter de 1 a 120 parcelas.';
  end if;
  for p in select * from jsonb_array_elements(p_parcelas) loop
    if (p ->> 'vencimento') is null or (p ->> 'vencimento')::date < v_hoje then
      raise exception 'Cada parcela precisa de um vencimento a partir de hoje.';
    end if;
    if coalesce((p ->> 'valor')::numeric, 0) <= 0 then
      raise exception 'Cada parcela precisa de um valor maior que zero.';
    end if;
    v_novo := v_novo + round((p ->> 'valor')::numeric, 2);
  end loop;

  -- O que os títulos têm em comum vai para as parcelas
  select (array_agg(categoria_id order by valor_previsto - valor_baixado desc))[1],
         case when count(distinct contraparte_id) = 1 and count(contraparte_id) = count(*) then (array_agg(contraparte_id))[1] end,
         case when count(distinct centro_custo_id) = 1 and count(centro_custo_id) = count(*) then (array_agg(centro_custo_id))[1] end,
         case when count(distinct projeto_id) = 1 and count(projeto_id) = count(*) then (array_agg(projeto_id))[1] end
    into v_cat, v_contra, v_centro, v_proj
    from public.lancamentos where empresa_id = p_empresa_id and id = any(v_ids);

  perform pg_advisory_xact_lock(hashtext('renegociacao:' || p_empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_num from public.renegociacoes where empresa_id = p_empresa_id;
  insert into public.renegociacoes (empresa_id, numero, tipo, motivo, valor_renegociado, valor_novo)
  values (p_empresa_id, v_num, v_tipo, trim(p_motivo), v_saldo, v_novo)
  returning id into v_reneg;

  perform set_config('app.renegociacao', 'on', true);
  update public.lancamentos set situacao = 'renegociado', renegociado_em_id = v_reneg
   where empresa_id = p_empresa_id and id = any(v_ids);
  v_desc := coalesce(nullif(trim(coalesce(p_descricao, '')), ''), 'Renegociação nº ' || v_num);
  for p in select * from jsonb_array_elements(p_parcelas) loop
    i := i + 1;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, data_competencia, data_vencimento,
      valor_previsto, origem, renegociacao_id, fora_do_resultado, parcela_numero, parcela_total, status_revisao, observacoes
    ) values (
      p_empresa_id, v_tipo, left(v_desc, 280) || case when v_qtd > 1 then ' (' || i || '/' || v_qtd || ')' else '' end,
      v_cat, v_contra, v_centro, v_proj, v_hoje, (p ->> 'vencimento')::date, round((p ->> 'valor')::numeric, 2),
      'renegociacao', v_reneg, true, case when v_qtd > 1 then i end, case when v_qtd > 1 then v_qtd end, 'confirmado',
      'Acordo da renegociação nº ' || v_num || '. Os títulos originais continuam no histórico.'
    );
  end loop;

  -- Juros/encargos (ou desconto) do acordo entram no resultado do mês
  if v_novo <> v_saldo then
    v_cod := case
      when v_tipo = 'receber' and v_novo > v_saldo then 'JUROS_RECEBIDOS'
      when v_tipo = 'receber' then 'DESCONTOS_CONCEDIDOS'
      when v_novo > v_saldo then 'JUROS_PAGOS'
      else 'DESCONTOS_OBTIDOS' end;
    if app.categoria_sistema(p_empresa_id, v_cod) is not null then
      insert into public.dre_ajustes (empresa_id, categoria_id, competencia, valor, motivo)
      values (p_empresa_id, app.categoria_sistema(p_empresa_id, v_cod), date_trunc('month', v_hoje)::date, abs(v_novo - v_saldo),
              'Renegociação nº ' || v_num || ': ' || case when v_novo > v_saldo then 'juros e encargos do acordo' else 'desconto do acordo' end)
      returning id into v_aj;
      update public.renegociacoes set dre_ajuste_id = v_aj where id = v_reneg;
    end if;
  end if;
  perform set_config('app.renegociacao', 'off', true);
  return v_reneg;
end;
$$;
revoke all on function public.financeiro_renegociar(uuid, uuid[], jsonb, text, text) from public, anon;
grant execute on function public.financeiro_renegociar(uuid, uuid[], jsonb, text, text) to authenticated;

create or replace function public.financeiro_desfazer_renegociacao(p_empresa_id uuid, p_renegociacao_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.renegociacoes;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'Explique por que a renegociação está sendo desfeita (ao menos 5 letras).';
  end if;
  select * into v_r from public.renegociacoes where id = p_renegociacao_id and empresa_id = p_empresa_id for update;
  if not found or v_r.desfeita_em is not null then
    raise exception 'Renegociação não encontrada ou já desfeita.';
  end if;
  if exists (select 1 from public.baixas b join public.lancamentos l on l.id = b.lancamento_id where l.renegociacao_id = v_r.id) then
    raise exception 'Já há pagamentos nas parcelas do acordo. Estorne-os antes de desfazer a renegociação.';
  end if;
  perform set_config('app.renegociacao', 'on', true);
  delete from public.lancamentos where empresa_id = p_empresa_id and renegociacao_id = v_r.id;
  update public.lancamentos
     set renegociado_em_id = null, situacao = case when valor_baixado > 0 then 'parcial' else 'aberto' end
   where empresa_id = p_empresa_id and renegociado_em_id = v_r.id;
  update public.renegociacoes
     set desfeita_em = now(), desfeita_por = auth.uid(), motivo_desfazer = trim(p_motivo), dre_ajuste_id = null
   where id = v_r.id;
  if v_r.dre_ajuste_id is not null then
    delete from public.dre_ajustes where id = v_r.dre_ajuste_id;
  end if;
  perform set_config('app.renegociacao', 'off', true);
end;
$$;
revoke all on function public.financeiro_desfazer_renegociacao(uuid, uuid, text) from public, anon;
grant execute on function public.financeiro_desfazer_renegociacao(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Parcelas com datas e valores escolhidos, recorrência e ações em lote
-- -----------------------------------------------------------------------------
create or replace function public.financeiro_criar_parcelas(p_empresa_id uuid, p_dados jsonb, p_parcelas jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grupo uuid := gen_random_uuid();
  v_qtd int;
  v_tipo text := p_dados ->> 'tipo';
  v_desc text := trim(coalesce(p_dados ->> 'descricao', ''));
  v_comp date := (p_dados ->> 'data_competencia')::date;
  v_por_parcela boolean := coalesce((p_dados ->> 'competencia_por_parcela')::boolean, false);
  p jsonb;
  i int := 0;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if v_tipo not in ('receber', 'pagar') then
    raise exception 'Escolha se é conta a receber ou a pagar.';
  end if;
  if length(v_desc) < 2 then
    raise exception 'Descreva o lançamento.';
  end if;
  if jsonb_typeof(coalesce(p_parcelas, 'null'::jsonb)) <> 'array' then
    raise exception 'Informe as parcelas.';
  end if;
  v_qtd := jsonb_array_length(p_parcelas);
  if v_qtd < 2 or v_qtd > 360 then
    raise exception 'Informe entre 2 e 360 parcelas.';
  end if;
  for p in select * from jsonb_array_elements(p_parcelas) loop
    i := i + 1;
    if (p ->> 'vencimento') is null then
      raise exception 'Parcela %: informe o vencimento.', i;
    end if;
    if coalesce((p ->> 'valor')::numeric, 0) <= 0 then
      raise exception 'Parcela %: o valor precisa ser maior que zero.', i;
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, contraparte_id, centro_custo_id, projeto_id, conta_financeira_id,
      data_competencia, data_vencimento, valor_previsto, origem, parcelamento_id, parcela_numero, parcela_total,
      numero_documento, observacoes
    ) values (
      p_empresa_id, v_tipo, left(v_desc, 280) || ' (' || i || '/' || v_qtd || ')',
      nullif(p_dados ->> 'categoria_id', '')::uuid, nullif(p_dados ->> 'contraparte_id', '')::uuid,
      nullif(p_dados ->> 'centro_custo_id', '')::uuid, nullif(p_dados ->> 'projeto_id', '')::uuid,
      nullif(p_dados ->> 'conta_financeira_id', '')::uuid,
      case when v_por_parcela then (p ->> 'vencimento')::date else coalesce(v_comp, (p ->> 'vencimento')::date) end,
      (p ->> 'vencimento')::date, round((p ->> 'valor')::numeric, 2), 'parcelamento', v_grupo, i, v_qtd,
      nullif(trim(coalesce(p_dados ->> 'numero_documento', '')), ''), nullif(trim(coalesce(p_dados ->> 'observacoes', '')), '')
    );
  end loop;
  return v_grupo;
end;
$$;
revoke all on function public.financeiro_criar_parcelas(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.financeiro_criar_parcelas(uuid, jsonb, jsonb) to authenticated;

-- Recorrência: alterar só esta ocorrência, esta e as próximas, ou encerrar a partir desta.
create or replace function public.financeiro_recorrencia_alterar(p_empresa_id uuid, p_lancamento_id uuid, p_escopo text, p_dados jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.lancamentos;
  v_r public.recorrencias;
  v_n int := 0;
  v_dia int;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  select * into v_l from public.lancamentos where id = p_lancamento_id and empresa_id = p_empresa_id for update;
  if not found or v_l.recorrencia_id is null then
    raise exception 'Este título não faz parte de uma recorrência.';
  end if;
  select * into v_r from public.recorrencias where id = v_l.recorrencia_id for update;
  p_dados := coalesce(p_dados, '{}'::jsonb);
  if p_dados ? 'valor' and coalesce((p_dados ->> 'valor')::numeric, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero.';
  end if;
  if p_dados ? 'descricao' and length(trim(coalesce(p_dados ->> 'descricao', ''))) < 2 then
    raise exception 'Descreva o lançamento.';
  end if;

  if p_escopo = 'esta' then
    update public.lancamentos set
      descricao = coalesce(nullif(trim(p_dados ->> 'descricao'), ''), descricao),
      valor_previsto = coalesce(round((p_dados ->> 'valor')::numeric, 2), valor_previsto),
      data_vencimento = coalesce((p_dados ->> 'data_vencimento')::date, data_vencimento),
      categoria_id = case when p_dados ? 'categoria_id' then nullif(p_dados ->> 'categoria_id', '')::uuid else categoria_id end,
      centro_custo_id = case when p_dados ? 'centro_custo_id' then nullif(p_dados ->> 'centro_custo_id', '')::uuid else centro_custo_id end,
      conta_financeira_id = case when p_dados ? 'conta_financeira_id' then nullif(p_dados ->> 'conta_financeira_id', '')::uuid else conta_financeira_id end
     where id = v_l.id;
    return 1;
  elsif p_escopo = 'proximas' then
    v_dia := case when p_dados ? 'data_vencimento' then extract(day from (p_dados ->> 'data_vencimento')::date)::int end;
    update public.recorrencias set
      descricao = coalesce(nullif(trim(p_dados ->> 'descricao'), ''), descricao),
      valor = coalesce(round((p_dados ->> 'valor')::numeric, 2), valor),
      categoria_id = case when p_dados ? 'categoria_id' then coalesce(nullif(p_dados ->> 'categoria_id', '')::uuid, categoria_id) else categoria_id end,
      centro_custo_id = case when p_dados ? 'centro_custo_id' then nullif(p_dados ->> 'centro_custo_id', '')::uuid else centro_custo_id end,
      conta_financeira_id = case when p_dados ? 'conta_financeira_id' then nullif(p_dados ->> 'conta_financeira_id', '')::uuid else conta_financeira_id end,
      dia_vencimento = case when v_dia is not null and frequencia not in ('semanal', 'quinzenal') then v_dia else dia_vencimento end
     where id = v_r.id;
    update public.lancamentos l set
      descricao = coalesce(nullif(trim(p_dados ->> 'descricao'), ''), l.descricao),
      valor_previsto = coalesce(round((p_dados ->> 'valor')::numeric, 2), l.valor_previsto),
      categoria_id = case when p_dados ? 'categoria_id' then coalesce(nullif(p_dados ->> 'categoria_id', '')::uuid, l.categoria_id) else l.categoria_id end,
      centro_custo_id = case when p_dados ? 'centro_custo_id' then nullif(p_dados ->> 'centro_custo_id', '')::uuid else l.centro_custo_id end,
      conta_financeira_id = case when p_dados ? 'conta_financeira_id' then nullif(p_dados ->> 'conta_financeira_id', '')::uuid else l.conta_financeira_id end,
      data_vencimento = case
        when v_dia is not null and v_r.frequencia not in ('semanal', 'quinzenal') then
          (date_trunc('month', l.data_vencimento) + make_interval(days => least(v_dia, extract(day from (date_trunc('month', l.data_vencimento) + interval '1 month - 1 day'))::int) - 1))::date
        else l.data_vencimento end
     where l.recorrencia_id = v_r.id and l.data_vencimento >= v_l.data_vencimento
       and l.situacao = 'aberto' and l.valor_baixado = 0;
    get diagnostics v_n = row_count;
    return v_n;
  elsif p_escopo = 'encerrar' then
    update public.recorrencias set data_fim = v_l.data_vencimento - 1 where id = v_r.id;
    update public.lancamentos
       set situacao = 'cancelado', motivo_cancelamento = 'Recorrência encerrada a partir de ' || to_char(v_l.data_vencimento, 'DD/MM/YYYY')
     where recorrencia_id = v_r.id and data_vencimento >= v_l.data_vencimento and situacao = 'aberto' and valor_baixado = 0;
    get diagnostics v_n = row_count;
    return v_n;
  end if;
  raise exception 'Escolha: só esta, esta e as próximas, ou encerrar.';
end;
$$;
revoke all on function public.financeiro_recorrencia_alterar(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.financeiro_recorrencia_alterar(uuid, uuid, text, jsonb) to authenticated;

-- Ações em lote (tudo ou nada): vencimento, categoria, centro de custo, cancelar.
create or replace function public.financeiro_lote_alterar(p_empresa_id uuid, p_ids uuid[], p_acao text, p_valor text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Selecione ao menos um título.';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Selecione no máximo 500 títulos por vez.';
  end if;
  perform 1 from public.lancamentos where empresa_id = p_empresa_id and id = any(p_ids) order by id for update;
  if p_acao = 'vencimento' then
    if p_valor is null or p_valor !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Informe o novo vencimento.';
    end if;
    update public.lancamentos set data_vencimento = p_valor::date
     where empresa_id = p_empresa_id and id = any(p_ids) and situacao in ('aberto', 'parcial');
  elsif p_acao = 'categoria' then
    update public.lancamentos set categoria_id = p_valor::uuid
     where empresa_id = p_empresa_id and id = any(p_ids) and situacao <> 'cancelado';
  elsif p_acao = 'centro_custo' then
    update public.lancamentos set centro_custo_id = nullif(p_valor, '')::uuid
     where empresa_id = p_empresa_id and id = any(p_ids) and situacao <> 'cancelado';
  elsif p_acao = 'cancelar' then
    if length(trim(coalesce(p_valor, ''))) < 3 then
      raise exception 'Informe o motivo do cancelamento.';
    end if;
    if exists (select 1 from public.lancamentos where empresa_id = p_empresa_id and id = any(p_ids) and valor_baixado > 0) then
      raise exception 'Há títulos com pagamentos registrados. Estorne os pagamentos antes de cancelar.';
    end if;
    update public.lancamentos set situacao = 'cancelado', motivo_cancelamento = trim(p_valor)
     where empresa_id = p_empresa_id and id = any(p_ids) and situacao in ('aberto', 'parcial');
  else
    raise exception 'Ação em lote desconhecida.';
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.financeiro_lote_alterar(uuid, uuid[], text, text) from public, anon;
grant execute on function public.financeiro_lote_alterar(uuid, uuid[], text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Painel da visão geral e histórico da contraparte
-- -----------------------------------------------------------------------------
create or replace function public.financeiro_painel(p_empresa_id uuid, p_conta_id uuid default null, p_centro_custo_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hoje date := app.hoje();
  v_ids uuid[];
  v_contas jsonb;
  v_saldo numeric(15,2);
  v_saldo_sel numeric(15,2);
  v_titulos jsonb;
  v_real jsonb;
  v_pontos jsonb := '[]'::jsonb;
  v_futuro jsonb := '[]'::jsonb;
  v_run numeric(15,2);
  v_hoje_r numeric(15,2);
  v_hoje_p numeric(15,2);
  v_prev_hoje numeric(15,2);
  v_negativo date;
  v_p7 numeric(15,2);
  v_p30 numeric(15,2);
  v_urgentes jsonb;
  v_clientes jsonb;
  v_pend jsonb;
  r record;
begin
  if not app.pode(p_empresa_id, 'financeiro.ver') then
    raise exception 'Seu acesso não inclui o financeiro desta empresa.' using errcode = '42501';
  end if;

  -- Contas e saldos de hoje
  with c as (
    select c.id, c.nome, c.tipo, c.compoe_saldo_disponivel as disponivel, c.banco_nome,
           coalesce(public.saldo_conta(c.id, v_hoje), c.saldo_inicial) as saldo,
           (select e.data from public.extrato_saldos e where e.conta_financeira_id = c.id order by e.data desc limit 1) as extrato_data,
           (select e.saldo from public.extrato_saldos e where e.conta_financeira_id = c.id order by e.data desc limit 1) as extrato_saldo,
           (select count(*) from public.movimentos_bancarios m where m.conta_financeira_id = c.id and m.status_conciliacao = 'pendente') as pendentes
      from public.contas_financeiras c
     where c.empresa_id = p_empresa_id and c.ativa and (p_conta_id is null or c.id = p_conta_id)
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.disponivel desc, c.nome), '[]'::jsonb),
         coalesce(sum(c.saldo) filter (where c.disponivel), 0),
         coalesce(sum(c.saldo) filter (where p_conta_id is not null or c.disponivel), 0),
         coalesce(array_agg(c.id) filter (where p_conta_id is not null or c.disponivel), '{}')
    into v_contas, v_saldo, v_saldo_sel, v_ids
    from c;

  -- Títulos em aberto por prazo (saldo em aberto). Compras lançadas no cartão de
  -- crédito são pagas pela fatura (transferência): ficam fora.
  with t as (
    select l.tipo, l.data_vencimento as v, (l.valor_previsto - l.valor_baixado) as s
      from public.lancamentos l
     where l.empresa_id = p_empresa_id and l.status_revisao = 'confirmado' and l.situacao in ('aberto', 'parcial') and not exists (select 1 from public.contas_financeiras cc where cc.id = l.conta_financeira_id and cc.tipo = 'cartao_credito')
       and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
  )
  select jsonb_object_agg(z.tp, z.obj) into v_titulos
    from (
      select x.tp, jsonb_build_object(
               'vencido', jsonb_build_object('total', coalesce(sum(t.s) filter (where t.v < v_hoje), 0), 'qtd', count(t.v) filter (where t.v < v_hoje)),
               'hoje', jsonb_build_object('total', coalesce(sum(t.s) filter (where t.v = v_hoje), 0), 'qtd', count(t.v) filter (where t.v = v_hoje)),
               'd7', jsonb_build_object('total', coalesce(sum(t.s) filter (where t.v > v_hoje and t.v <= v_hoje + 7), 0), 'qtd', count(t.v) filter (where t.v > v_hoje and t.v <= v_hoje + 7)),
               'd30', jsonb_build_object('total', coalesce(sum(t.s) filter (where t.v > v_hoje and t.v <= v_hoje + 30), 0), 'qtd', count(t.v) filter (where t.v > v_hoje and t.v <= v_hoje + 30)),
               'futuro', jsonb_build_object('total', coalesce(sum(t.s) filter (where t.v > v_hoje), 0), 'qtd', count(t.v) filter (where t.v > v_hoje)),
               'total', jsonb_build_object('total', coalesce(sum(t.s), 0), 'qtd', count(t.v))
             ) as obj
        from (values ('receber'), ('pagar')) x(tp)
        left join t on t.tipo = x.tp
       group by x.tp
    ) z;
  v_hoje_r := coalesce((v_titulos -> 'receber' -> 'hoje' ->> 'total')::numeric, 0);
  v_hoje_p := coalesce((v_titulos -> 'pagar' -> 'hoje' ->> 'total')::numeric, 0);

  -- Recebido e pago (hoje e no mês), em qualquer conta
  select jsonb_build_object(
           'recebido_hoje', coalesce(sum(b.valor_total) filter (where b.tipo = 'receber' and b.data_pagamento = v_hoje), 0),
           'pago_hoje', coalesce(sum(b.valor_total) filter (where b.tipo = 'pagar' and b.data_pagamento = v_hoje), 0),
           'recebido_mes', coalesce(sum(b.valor_total) filter (where b.tipo = 'receber'), 0),
           'pago_mes', coalesce(sum(b.valor_total) filter (where b.tipo = 'pagar'), 0),
           'qtd_hoje', count(*) filter (where b.data_pagamento = v_hoje))
    into v_real
    from public.baixas b
    left join public.lancamentos l on l.id = b.lancamento_id
   where b.empresa_id = p_empresa_id
     and b.data_pagamento between date_trunc('month', v_hoje)::date and v_hoje
     and (p_conta_id is null or b.conta_financeira_id = p_conta_id)
     and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id);

  -- Gráfico: últimos 30 dias (realizado) e próximos 30 dias (previsto).
  -- O saldo do passado sai do saldo de hoje, desfazendo os movimentos de cada dia.
  v_run := v_saldo_sel;
  for r in
    select d::date as d,
           coalesce((select sum(b.valor_total) from public.baixas b left join public.lancamentos l on l.id = b.lancamento_id
                      where b.empresa_id = p_empresa_id and b.data_pagamento = d::date and b.tipo = 'receber'
                        and b.conta_financeira_id = any(v_ids)
                        and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)), 0) as e,
           coalesce((select sum(b.valor_total) from public.baixas b left join public.lancamentos l on l.id = b.lancamento_id
                      where b.empresa_id = p_empresa_id and b.data_pagamento = d::date and b.tipo = 'pagar'
                        and b.conta_financeira_id = any(v_ids)
                        and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)), 0) as s,
           coalesce((select sum(case when b.tipo = 'receber' then b.valor_total else -b.valor_total end) from public.baixas b
                      where b.empresa_id = p_empresa_id and b.data_pagamento = d::date and b.conta_financeira_id = any(v_ids)), 0)
           + coalesce((select sum(case when t.conta_destino_id = any(v_ids) then t.valor else 0 end)
                            - sum(case when t.conta_origem_id = any(v_ids) then t.valor else 0 end)
                         from public.transferencias t
                        where t.empresa_id = p_empresa_id and t.data = d::date
                          and (t.conta_destino_id = any(v_ids)) <> (t.conta_origem_id = any(v_ids))), 0) as liquido
      from generate_series(v_hoje, v_hoje - 30, interval '-1 day') d
  loop
    -- (do dia mais novo para o mais antigo; cada ponto entra no começo da lista)
    v_futuro := jsonb_build_array(jsonb_build_object('data', r.d, 'entradas', r.e, 'saidas', r.s, 'saldo', v_run, 'previsto', false)) || v_futuro;
    v_run := v_run - r.liquido;
  end loop;
  v_pontos := v_futuro;

  -- Futuro: parte do saldo de hoje mais o que vence hoje e ainda está em aberto
  -- (os vencidos ficam de fora até a pessoa decidir a data).
  v_prev_hoje := v_saldo_sel + v_hoje_r - v_hoje_p;
  v_run := v_prev_hoje;
  if v_prev_hoje < 0 then
    v_negativo := v_hoje;
  end if;
  for r in
    select d::date as d,
           coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.tipo = 'receber'), 0) as e,
           coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.tipo = 'pagar'), 0) as s
      from generate_series(v_hoje + 1, v_hoje + 30, interval '1 day') d
      left join public.lancamentos l
        on l.empresa_id = p_empresa_id and l.data_vencimento = d::date and l.status_revisao = 'confirmado'
       and l.situacao in ('aberto', 'parcial') and not exists (select 1 from public.contas_financeiras cc where cc.id = l.conta_financeira_id and cc.tipo = 'cartao_credito') and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
     group by d
     order by d
  loop
    v_run := v_run + r.e - r.s;
    if v_negativo is null and v_run < 0 then
      v_negativo := r.d;
    end if;
    if r.d = v_hoje + 7 then v_p7 := v_run; end if;
    if r.d = v_hoje + 30 then v_p30 := v_run; end if;
    v_pontos := v_pontos || jsonb_build_array(jsonb_build_object('data', r.d, 'entradas', r.e, 'saidas', r.s, 'saldo', v_run, 'previsto', true));
  end loop;

  -- Pendências que se resolvem na hora: vencidos e o que vence nos próximos 3 dias
  select coalesce(jsonb_agg(x order by x.vencimento, x.tipo), '[]'::jsonb) into v_urgentes
    from (
      select l.id, l.tipo, l.descricao, l.data_vencimento as vencimento, l.valor_previsto - l.valor_baixado as saldo,
             l.situacao, l.aprovacao_status, cp.nome as contraparte, greatest(v_hoje - l.data_vencimento, 0) as dias_atraso
        from public.lancamentos l
        left join public.contrapartes cp on cp.id = l.contraparte_id
       where l.empresa_id = p_empresa_id and l.status_revisao = 'confirmado' and l.situacao in ('aberto', 'parcial') and not exists (select 1 from public.contas_financeiras cc where cc.id = l.conta_financeira_id and cc.tipo = 'cartao_credito')
         and l.data_vencimento <= v_hoje + 3
         and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
       order by l.data_vencimento, l.tipo
       limit 15
    ) x;

  -- Clientes em atraso (maiores valores)
  select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb) into v_clientes
    from (
      select l.contraparte_id, coalesce(cp.nome, 'Sem cliente identificado') as nome,
             sum(l.valor_previsto - l.valor_baixado) as total, count(*) as qtd, min(l.data_vencimento) as mais_antigo
        from public.lancamentos l
        left join public.contrapartes cp on cp.id = l.contraparte_id
       where l.empresa_id = p_empresa_id and l.tipo = 'receber' and l.status_revisao = 'confirmado'
         and l.situacao in ('aberto', 'parcial') and not exists (select 1 from public.contas_financeiras cc where cc.id = l.conta_financeira_id and cc.tipo = 'cartao_credito') and l.data_vencimento < v_hoje
         and (p_centro_custo_id is null or l.centro_custo_id = p_centro_custo_id)
       group by l.contraparte_id, cp.nome
       order by sum(l.valor_previsto - l.valor_baixado) desc
       limit 5
    ) x;

  -- O que precisa de conferência
  select jsonb_build_object(
           'sugeridos', (select count(*) from public.lancamentos where empresa_id = p_empresa_id and status_revisao = 'sugerido' and situacao <> 'cancelado'),
           'aprovacoes', (select count(*) from public.lancamentos where empresa_id = p_empresa_id and aprovacao_status = 'pendente' and situacao in ('aberto', 'parcial')),
           'aprovacoes_total', (select coalesce(sum(valor_previsto - valor_baixado), 0) from public.lancamentos where empresa_id = p_empresa_id and aprovacao_status = 'pendente' and situacao in ('aberto', 'parcial')),
           'conciliar', (select count(*) from public.movimentos_bancarios m where m.empresa_id = p_empresa_id and m.status_conciliacao = 'pendente' and (p_conta_id is null or m.conta_financeira_id = p_conta_id)),
           'conciliar_total', (select coalesce(sum(abs(m.valor)), 0) from public.movimentos_bancarios m where m.empresa_id = p_empresa_id and m.status_conciliacao = 'pendente' and (p_conta_id is null or m.conta_financeira_id = p_conta_id)),
           'sem_categoria', (select count(*) from public.lancamentos where empresa_id = p_empresa_id and categoria_id is null and situacao <> 'cancelado'))
    into v_pend;

  return jsonb_build_object(
    'hoje', v_hoje,
    'gerado_em', now(),
    'saldo_disponivel', v_saldo,
    'saldo_selecionado', v_saldo_sel,
    'contas', v_contas,
    'titulos', v_titulos,
    'realizado', v_real,
    'projecao', jsonb_build_object('hoje', v_prev_hoje, 'd7', v_p7, 'd30', v_p30, 'primeiro_negativo', v_negativo,
                                   'com_vencidos_d30', coalesce(v_p30, v_prev_hoje)
                                     + coalesce((v_titulos -> 'receber' -> 'vencido' ->> 'total')::numeric, 0)
                                     - coalesce((v_titulos -> 'pagar' -> 'vencido' ->> 'total')::numeric, 0)),
    'serie', v_pontos,
    'urgentes', v_urgentes,
    'clientes_atraso', v_clientes,
    'pendencias', v_pend
  );
end;
$$;
revoke all on function public.financeiro_painel(uuid, uuid, uuid) from public, anon;
grant execute on function public.financeiro_painel(uuid, uuid, uuid) to authenticated;

create or replace function public.financeiro_historico_contraparte(p_empresa_id uuid, p_contraparte_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hoje date := app.hoje();
  v_res jsonb;
begin
  if not app.pode(p_empresa_id, 'financeiro.ver') then
    raise exception 'Seu acesso não inclui o financeiro desta empresa.' using errcode = '42501';
  end if;
  select coalesce(jsonb_object_agg(x.tipo, to_jsonb(x) - 'tipo'), '{}'::jsonb) into v_res
    from (
      select l.tipo,
             coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.situacao in ('aberto', 'parcial')), 0) as em_aberto,
             coalesce(sum(l.valor_previsto - l.valor_baixado) filter (where l.situacao in ('aberto', 'parcial') and l.data_vencimento < v_hoje), 0) as vencido,
             count(*) filter (where l.situacao in ('aberto', 'parcial') and l.data_vencimento < v_hoje) as qtd_vencidos,
             coalesce(sum(l.valor_baixado) filter (where l.situacao <> 'cancelado'), 0) as liquidado,
             coalesce(sum(l.valor_realizado) filter (where l.situacao <> 'cancelado'), 0) as liquidado_com_encargos,
             count(*) filter (where l.situacao not in ('cancelado')) as qtd_titulos,
             max(v_hoje - l.data_vencimento) filter (where l.situacao in ('aberto', 'parcial') and l.data_vencimento < v_hoje) as maior_atraso_dias,
             max(l.data_ultimo_pagamento) as ultimo_pagamento,
             round(avg(l.data_ultimo_pagamento - l.data_vencimento) filter (where l.situacao = 'quitado'), 1) as atraso_medio_dias
        from public.lancamentos l
       where l.empresa_id = p_empresa_id and l.contraparte_id = p_contraparte_id and l.status_revisao = 'confirmado'
       group by l.tipo
    ) x;
  return v_res;
end;
$$;
revoke all on function public.financeiro_historico_contraparte(uuid, uuid) from public, anon;
grant execute on function public.financeiro_historico_contraparte(uuid, uuid) to authenticated;
