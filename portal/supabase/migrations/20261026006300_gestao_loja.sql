-- =============================================================================
-- Gestão da loja (módulo contratado): produtos com estoque, caixa, vendas,
-- orçamentos e venda a prazo, ligados ao Financeiro e à contabilidade
--
--  * O escritório liga o módulo só para as empresas que contrataram
--    (gestao_config.ativa). Sem isso, nenhuma função de gestão funciona.
--  * Os produtos são os mesmos da NF-e (nfe_produtos): um cadastro só para o
--    estoque, o caixa e a nota. Madeira: medidas da peça (espessura × largura,
--    em cm) e cubagem automática na venda (peças × comprimento → m³ ou metro).
--  * Estoque por movimentos (compra, venda, ajuste, inventário), com o saldo e
--    o custo médio mantidos no produto.
--  * Caixa: sessão aberta pelo operador com o troco inicial; sangrias e
--    suprimentos; fechamento com a contagem do dinheiro e a diferença.
--  * Venda: itens, desconto, frete e pagamentos divididos (dinheiro com troco,
--    PIX, débito, crédito, a prazo em parcelas). Cada pagamento vira lançamento
--    a receber no Financeiro (categoria Vendas): à vista já entra recebido na
--    conta configurada; a prazo fica em aberto, com os vencimentos.
--  * Tudo pelas funções abaixo, que conferem a permissão, o módulo ligado e a
--    competência aberta. As tabelas são só lidas diretamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões: gestao.vender (operar o caixa) e gestao.gerenciar (produtos,
--    estoque, cancelamentos, configurações e relatórios)
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
    'gestao.gerenciar'
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
      'gestao.vender', 'gestao.gerenciar'
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
      'gestao.vender', 'gestao.gerenciar'
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
  -- Gerenciar a loja implica poder vender.
  if 'gestao.gerenciar' = any(new.permissoes) and not ('gestao.vender' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'gestao.vender');
  end if;
  return new;
end;
$$;

update public.empresa_membros
   set permissoes = permissoes || array['gestao.vender', 'gestao.gerenciar']
 where papel in ('equipe', 'cliente_titular') and not (permissoes && array['gestao.vender', 'gestao.gerenciar']);
update public.convites
   set permissoes = permissoes || array['gestao.vender', 'gestao.gerenciar']
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and cardinality(permissoes) > 0
   and not (permissoes && array['gestao.vender', 'gestao.gerenciar']);

-- Origem "venda" nos lançamentos e baixas do Financeiro
alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha', 'cartao', 'venda'
));
alter table public.baixas drop constraint baixas_origem_check;
alter table public.baixas add constraint baixas_origem_check check (origem in ('manual', 'conciliacao', 'importacao', 'maquininha', 'cartao', 'venda'));

-- -----------------------------------------------------------------------------
-- 2. Configuração da gestão (o escritório liga o módulo contratado)
-- -----------------------------------------------------------------------------
create table public.gestao_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativa boolean not null default false,
  -- Como a empresa emite nota: MEI (nota só para empresas), comércio (NFC-e/NF-e) ou só serviços
  perfil_fiscal text not null default 'comercio' check (perfil_fiscal in ('mei', 'comercio', 'servicos')),
  permitir_estoque_negativo boolean not null default false,
  permitir_venda_prazo boolean not null default true,
  -- Desconto máximo que o operador (sem permissão de gerente) pode dar, em % do preço de tabela
  desconto_maximo_operador numeric(5, 2) check (desconto_maximo_operador is null or desconto_maximo_operador between 0 and 100),
  -- Contas do Financeiro em que entram os recebimentos à vista
  conta_dinheiro_id uuid,
  conta_pix_id uuid,
  conta_cartao_id uuid,
  validade_orcamento_dias int not null default 15 check (validade_orcamento_dias between 1 and 180),
  mensagem_comprovante text check (mensagem_comprovante is null or length(mensagem_comprovante) <= 500),
  proximo_numero_venda bigint not null default 1 check (proximo_numero_venda >= 1),
  proximo_numero_orcamento bigint not null default 1 check (proximo_numero_orcamento >= 1),
  ativada_por uuid references public.perfis(id) on delete set null,
  ativada_em timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (empresa_id, conta_dinheiro_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, conta_pix_id) references public.contas_financeiras (empresa_id, id),
  foreign key (empresa_id, conta_cartao_id) references public.contas_financeiras (empresa_id, id)
);
create trigger gestao_config_updated_at before update on public.gestao_config for each row execute function app.tg_updated_at();
create trigger auditoria_gestao_config after insert or update or delete on public.gestao_config for each row execute function app.tg_auditoria();

create or replace function app.gestao_ativa(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select ativa from public.gestao_config where empresa_id = p_empresa_id), false);
$$;

create or replace function app.exigir_gestao(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, p_permissao);
  if not app.gestao_ativa(p_empresa_id) then
    raise exception 'A gestão da loja não está ligada para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

-- Conta do Financeiro usada pela loja: a existente do tipo pedido ou uma nova
create or replace function app.gestao_conta(p_empresa_id uuid, p_tipo text, p_nome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.contas_financeiras
   where empresa_id = p_empresa_id and tipo = p_tipo and ativa
   order by (lower(nome) = lower(p_nome)) desc, created_at
   limit 1;
  if v_id is null then
    insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial, saldo_inicial_data)
    values (p_empresa_id, p_tipo, p_nome, 0, app.hoje() - 1)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Liga/desliga o módulo (só a equipe do escritório) e ajusta as preferências da loja (gerente)
create or replace function public.gestao_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_equipe boolean := app.e_equipe_da_empresa(p_empresa_id);
  v_atual public.gestao_config;
  v_ativa boolean;
  v_perfil text;
  v_desc numeric := nullif(p_dados ->> 'desconto_maximo_operador', '')::numeric;
  v_dinheiro uuid := nullif(p_dados ->> 'conta_dinheiro_id', '')::uuid;
  v_pix uuid := nullif(p_dados ->> 'conta_pix_id', '')::uuid;
  v_cartao uuid := nullif(p_dados ->> 'conta_cartao_id', '')::uuid;
begin
  select * into v_atual from public.gestao_config where empresa_id = p_empresa_id;
  if v_equipe then
    v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_atual.ativa, false);
    v_perfil := coalesce(nullif(p_dados ->> 'perfil_fiscal', ''), v_atual.perfil_fiscal, 'comercio');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
    v_ativa := v_atual.ativa;
    v_perfil := v_atual.perfil_fiscal;
  end if;

  if v_ativa then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', 'Caixa da loja'));
    v_pix := coalesce(v_pix, v_atual.conta_pix_id, app.gestao_conta(p_empresa_id, 'conta_corrente', 'Banco (PIX e transferências)'));
    v_cartao := coalesce(v_cartao, v_atual.conta_cartao_id, app.gestao_conta(p_empresa_id, 'adquirente', 'Maquininha de cartão'));
  end if;
  if (v_dinheiro is not null and v_dinheiro in (v_pix, v_cartao)) then
    raise exception 'A conta do dinheiro precisa ser diferente da conta do PIX e da maquininha.';
  end if;

  insert into public.gestao_config as g (
    empresa_id, ativa, perfil_fiscal, permitir_estoque_negativo, permitir_venda_prazo, desconto_maximo_operador,
    conta_dinheiro_id, conta_pix_id, conta_cartao_id, validade_orcamento_dias, mensagem_comprovante, ativada_por, ativada_em
  ) values (
    p_empresa_id, v_ativa, v_perfil,
    coalesce((p_dados ->> 'permitir_estoque_negativo')::boolean, v_atual.permitir_estoque_negativo, false),
    coalesce((p_dados ->> 'permitir_venda_prazo')::boolean, v_atual.permitir_venda_prazo, true),
    case when p_dados ? 'desconto_maximo_operador' then v_desc else v_atual.desconto_maximo_operador end,
    v_dinheiro, v_pix, v_cartao,
    coalesce((p_dados ->> 'validade_orcamento_dias')::int, v_atual.validade_orcamento_dias, 15),
    case when p_dados ? 'mensagem_comprovante' then nullif(trim(p_dados ->> 'mensagem_comprovante'), '') else v_atual.mensagem_comprovante end,
    case when v_ativa then auth.uid() end, case when v_ativa then now() end
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    perfil_fiscal = excluded.perfil_fiscal,
    permitir_estoque_negativo = excluded.permitir_estoque_negativo,
    permitir_venda_prazo = excluded.permitir_venda_prazo,
    desconto_maximo_operador = excluded.desconto_maximo_operador,
    conta_dinheiro_id = excluded.conta_dinheiro_id,
    conta_pix_id = excluded.conta_pix_id,
    conta_cartao_id = excluded.conta_cartao_id,
    validade_orcamento_dias = excluded.validade_orcamento_dias,
    mensagem_comprovante = excluded.mensagem_comprovante,
    ativada_por = case when excluded.ativa and not g.ativa then auth.uid() else g.ativada_por end,
    ativada_em = case when excluded.ativa and not g.ativa then now() else g.ativada_em end,
    atualizado_por = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Produtos: o cadastro da NF-e ganha preço de custo, estoque e medidas
-- -----------------------------------------------------------------------------
alter table public.nfe_produtos
  add column grupo text check (grupo is null or length(trim(grupo)) between 1 and 60),
  add column preco_custo numeric(15, 4) check (preco_custo is null or preco_custo >= 0),
  add column controla_estoque boolean not null default true,
  add column estoque_atual numeric(18, 4) not null default 0,
  add column custo_medio numeric(18, 6) not null default 0,
  add column estoque_minimo numeric(18, 4) check (estoque_minimo is null or estoque_minimo >= 0),
  -- Madeira e similares: seção da peça (cm) e comprimento padrão (m) para a cubagem
  add column espessura_cm numeric(8, 2) check (espessura_cm is null or espessura_cm > 0),
  add column largura_cm numeric(8, 2) check (largura_cm is null or largura_cm > 0),
  add column comprimento_m numeric(8, 3) check (comprimento_m is null or comprimento_m > 0);

create policy nfe_produtos_gestao on public.nfe_produtos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
-- O caixa escolhe o cliente da venda (só os clientes do cadastro do Financeiro, não os fornecedores)
create policy contrapartes_gestao on public.contrapartes for select to authenticated
  using ('cliente' = any(papeis) and empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));

create or replace function public.gestao_produto_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_codigo text := nullif(trim(p_dados ->> 'codigo'), '');
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if v_codigo is null then
    select coalesce(max(codigo::bigint), 0) + 1 into v_codigo
      from public.nfe_produtos where empresa_id = p_empresa_id and codigo ~ '^[0-9]{1,15}$';
  end if;
  if nullif(p_dados ->> 'valor_unitario', '') is null then
    raise exception 'Informe o preço de venda.';
  end if;
  begin
    if p_id is null then
      insert into public.nfe_produtos (
        empresa_id, codigo, descricao, ncm, cest, gtin, unidade, peso_kg, valor_unitario, origem, ativo,
        grupo, preco_custo, controla_estoque, estoque_minimo, espessura_cm, largura_cm, comprimento_m
      ) values (
        p_empresa_id, v_codigo, trim(p_dados ->> 'descricao'), regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
        nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
        upper(trim(p_dados ->> 'unidade')), nullif(p_dados ->> 'peso_kg', '')::numeric, (p_dados ->> 'valor_unitario')::numeric,
        coalesce((p_dados ->> 'origem')::smallint, 0), coalesce((p_dados ->> 'ativo')::boolean, true),
        nullif(trim(p_dados ->> 'grupo'), ''), nullif(p_dados ->> 'preco_custo', '')::numeric,
        coalesce((p_dados ->> 'controla_estoque')::boolean, true), nullif(p_dados ->> 'estoque_minimo', '')::numeric,
        nullif(p_dados ->> 'espessura_cm', '')::numeric, nullif(p_dados ->> 'largura_cm', '')::numeric, nullif(p_dados ->> 'comprimento_m', '')::numeric
      ) returning id into v_id;
    else
      update public.nfe_produtos
         set codigo = v_codigo,
             descricao = trim(p_dados ->> 'descricao'),
             ncm = regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
             cest = nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''),
             gtin = nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
             unidade = upper(trim(p_dados ->> 'unidade')),
             peso_kg = nullif(p_dados ->> 'peso_kg', '')::numeric,
             valor_unitario = (p_dados ->> 'valor_unitario')::numeric,
             origem = coalesce((p_dados ->> 'origem')::smallint, 0),
             ativo = coalesce((p_dados ->> 'ativo')::boolean, true),
             grupo = nullif(trim(p_dados ->> 'grupo'), ''),
             preco_custo = nullif(p_dados ->> 'preco_custo', '')::numeric,
             controla_estoque = coalesce((p_dados ->> 'controla_estoque')::boolean, true),
             estoque_minimo = nullif(p_dados ->> 'estoque_minimo', '')::numeric,
             espessura_cm = nullif(p_dados ->> 'espessura_cm', '')::numeric,
             largura_cm = nullif(p_dados ->> 'largura_cm', '')::numeric,
             comprimento_m = nullif(p_dados ->> 'comprimento_m', '')::numeric
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Produto não encontrado.';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'Já existe um produto com o código %.', v_codigo;
    when check_violation or not_null_violation then
      raise exception 'Confira os dados do produto: descrição (2 a 120 letras), NCM com 8 números, unidade (até 6 letras) e preços sem valores negativos.';
  end;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Estoque: movimentos com saldo e custo médio
-- -----------------------------------------------------------------------------
create table public.estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.nfe_produtos(id) on delete restrict,
  tipo text not null check (tipo in ('entrada_compra', 'entrada_manual', 'saida_manual', 'inventario', 'venda', 'cancelamento_venda')),
  quantidade numeric(18, 4) not null check (quantidade <> 0),
  custo_unitario numeric(18, 6) check (custo_unitario is null or custo_unitario >= 0),
  saldo_apos numeric(18, 4) not null,
  custo_medio_apos numeric(18, 6) not null,
  venda_id uuid,
  documento_fiscal_id uuid,
  observacao text check (observacao is null or length(observacao) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index estoque_movimentos_produto_idx on public.estoque_movimentos (empresa_id, produto_id, created_at desc);
create index estoque_movimentos_venda_idx on public.estoque_movimentos (venda_id) where venda_id is not null;
create index estoque_movimentos_nota_idx on public.estoque_movimentos (documento_fiscal_id) where documento_fiscal_id is not null;

create or replace function app.estoque_movimentar(
  p_empresa_id uuid, p_produto_id uuid, p_tipo text, p_quantidade numeric, p_custo numeric,
  p_venda_id uuid, p_documento_fiscal_id uuid, p_observacao text, p_permitir_negativo boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.nfe_produtos;
  v_saldo numeric;
  v_custo numeric;
begin
  select * into v_p from public.nfe_produtos where id = p_produto_id and empresa_id = p_empresa_id for update;
  if v_p.id is null then
    raise exception 'Produto não encontrado.';
  end if;
  if not v_p.controla_estoque then
    return;
  end if;
  v_saldo := v_p.estoque_atual + p_quantidade;
  if v_saldo < 0 and not p_permitir_negativo then
    raise exception 'Estoque insuficiente de "%": há % % no estoque e são precisos %.',
      v_p.descricao, app.gestao_qtd(v_p.estoque_atual), v_p.unidade, app.gestao_qtd(-p_quantidade);
  end if;
  v_custo := v_p.custo_medio;
  if p_quantidade > 0 and p_custo is not null then
    v_custo := case when v_p.estoque_atual <= 0 or v_saldo <= 0 then p_custo
                    else round((v_p.estoque_atual * v_p.custo_medio + p_quantidade * p_custo) / v_saldo, 6) end;
  end if;
  update public.nfe_produtos set estoque_atual = v_saldo, custo_medio = v_custo where id = v_p.id;
  insert into public.estoque_movimentos (empresa_id, produto_id, tipo, quantidade, custo_unitario, saldo_apos, custo_medio_apos, venda_id, documento_fiscal_id, observacao)
  values (p_empresa_id, v_p.id, p_tipo, p_quantidade, p_custo, v_saldo, v_custo, p_venda_id, p_documento_fiscal_id, nullif(trim(p_observacao), ''));
end;
$$;

-- Quantidade sem zeros à direita (mensagens)
create or replace function app.gestao_qtd(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(trim(trailing '.' from trim(trailing '0' from to_char(p, 'FM999999999990.0000'))), '.', ',');
$$;

-- Entrada ou saída manual (ajuste de estoque)
create or replace function public.gestao_estoque_lancar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text := p_dados ->> 'tipo';
  v_q numeric := nullif(p_dados ->> 'quantidade', '')::numeric;
  v_custo numeric := nullif(p_dados ->> 'custo_unitario', '')::numeric;
  v_obs text := nullif(trim(p_dados ->> 'observacao'), '');
  v_neg boolean;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if v_tipo not in ('entrada_manual', 'saida_manual') then
    raise exception 'Escolha se é entrada ou saída.';
  end if;
  if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) then
    raise exception 'Informe a quantidade (até 4 casas decimais).';
  end if;
  if v_tipo = 'saida_manual' and v_obs is null then
    raise exception 'Explique o motivo da saída (perda, uso interno, devolução ao fornecedor...).';
  end if;
  if v_custo is not null and v_custo < 0 then
    raise exception 'O custo não pode ser negativo.';
  end if;
  select permitir_estoque_negativo into v_neg from public.gestao_config where empresa_id = p_empresa_id;
  perform app.estoque_movimentar(p_empresa_id, (p_dados ->> 'produto_id')::uuid, v_tipo,
    case when v_tipo = 'saida_manual' then -v_q else v_q end,
    case when v_tipo = 'entrada_manual' then v_custo end, null, null, v_obs, coalesce(v_neg, false));
end;
$$;

-- Inventário: acerta o saldo de cada produto para a quantidade contada
create or replace function public.gestao_inventario(p_empresa_id uuid, p_itens jsonb, p_observacao text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  v_p public.nfe_produtos;
  v_contado numeric;
  v_n int := 0;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe a contagem de pelo menos um produto.';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_contado := nullif(it ->> 'contado', '')::numeric;
    if v_contado is null then
      continue;
    end if;
    if v_contado < 0 or v_contado <> round(v_contado, 4) then
      raise exception 'Contagem inválida (use até 4 casas decimais, sem número negativo).';
    end if;
    select * into v_p from public.nfe_produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id;
    if v_p.id is null then
      raise exception 'Produto não encontrado.';
    end if;
    if v_p.controla_estoque and v_contado <> v_p.estoque_atual then
      perform app.estoque_movimentar(p_empresa_id, v_p.id, 'inventario', v_contado - v_p.estoque_atual, null, null, null,
        coalesce(nullif(trim(p_observacao), ''), 'Inventário'), true);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Entrada pela nota de compra (XML já recebido no portal)
create or replace function public.gestao_entrada_nota(p_empresa_id uuid, p_documento_fiscal_id uuid, p_itens jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.documentos_fiscais;
  it jsonb;
  v_q numeric;
  v_custo numeric;
  v_n int := 0;
  v_atualizar_custo boolean;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  select * into v_doc from public.documentos_fiscais where id = p_documento_fiscal_id and empresa_id = p_empresa_id;
  if v_doc.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  if v_doc.operacao <> 'entrada' then
    raise exception 'Só notas de compra (entrada) dão entrada no estoque.';
  end if;
  if exists (select 1 from public.estoque_movimentos where documento_fiscal_id = v_doc.id) then
    raise exception 'Esta nota já deu entrada no estoque.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha o produto de pelo menos um item da nota.';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    if nullif(it ->> 'produto_id', '') is null then
      continue;
    end if;
    v_q := nullif(it ->> 'quantidade', '')::numeric;
    v_custo := nullif(it ->> 'custo_unitario', '')::numeric;
    if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) then
      raise exception 'Quantidade inválida em um dos itens (até 4 casas decimais).';
    end if;
    if v_custo is null or v_custo < 0 then
      raise exception 'Informe o custo unitário de cada item.';
    end if;
    perform app.estoque_movimentar(p_empresa_id, (it ->> 'produto_id')::uuid, 'entrada_compra', v_q, v_custo, null, v_doc.id,
      'Nota ' || coalesce(v_doc.numero, '') || ' — ' || coalesce(v_doc.emitente_nome, 'fornecedor'), true);
    v_atualizar_custo := coalesce((it ->> 'atualizar_preco_custo')::boolean, true);
    if v_atualizar_custo then
      update public.nfe_produtos set preco_custo = round(v_custo, 4) where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'Escolha o produto de pelo menos um item da nota.';
  end if;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Caixa: sessões, sangrias e suprimentos
-- -----------------------------------------------------------------------------
create table public.caixa_sessoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  caixa_nome text not null default 'Caixa 1' check (length(trim(caixa_nome)) between 1 and 40),
  operador_id uuid not null references public.perfis(id) on delete restrict default auth.uid(),
  status text not null default 'aberto' check (status in ('aberto', 'fechado')),
  data date not null default app.hoje(),
  aberto_em timestamptz not null default now(),
  valor_abertura numeric(15, 2) not null default 0 check (valor_abertura >= 0),
  fechado_em timestamptz,
  fechado_por uuid references public.perfis(id) on delete set null,
  valor_contado numeric(15, 2) check (valor_contado is null or valor_contado >= 0),
  valor_esperado numeric(15, 2),
  diferenca numeric(15, 2),
  observacao_fechamento text check (observacao_fechamento is null or length(observacao_fechamento) <= 1000),
  resumo jsonb,
  constraint caixa_sessoes_empresa_id_unico unique (empresa_id, id),
  constraint caixa_sessoes_fechamento check ((status = 'aberto') = (fechado_em is null))
);
create unique index caixa_sessoes_um_aberto on public.caixa_sessoes (empresa_id, lower(caixa_nome)) where status = 'aberto';
create index caixa_sessoes_data_idx on public.caixa_sessoes (empresa_id, data desc);
create trigger auditoria_caixa_sessoes after insert or update or delete on public.caixa_sessoes for each row execute function app.tg_auditoria();

create table public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  sessao_id uuid not null,
  tipo text not null check (tipo in ('sangria', 'suprimento')),
  valor numeric(15, 2) not null check (valor > 0),
  motivo text not null check (length(trim(motivo)) between 2 and 300),
  -- Conta de destino da sangria / origem do suprimento (vira transferência no Financeiro)
  conta_id uuid,
  transferencia_id uuid references public.transferencias(id) on delete set null,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, sessao_id) references public.caixa_sessoes (empresa_id, id) on delete cascade,
  foreign key (empresa_id, conta_id) references public.contas_financeiras (empresa_id, id)
);
create index caixa_movimentos_sessao_idx on public.caixa_movimentos (sessao_id);
create trigger auditoria_caixa_movimentos after insert or update or delete on public.caixa_movimentos for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 6. Vendas e orçamentos
-- -----------------------------------------------------------------------------
create table public.vendas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('venda', 'orcamento')),
  numero bigint not null check (numero >= 1),
  -- venda: concluida | cancelada; orçamento: aberto | convertido | cancelada
  status text not null check (status in ('concluida', 'cancelada', 'aberto', 'convertido')),
  sessao_id uuid,
  orcamento_id uuid references public.vendas(id) on delete set null,
  data date not null default app.hoje(),
  validade date,
  cliente_id uuid,
  cliente_nome text check (cliente_nome is null or length(cliente_nome) <= 120),
  cliente_documento text check (cliente_documento is null or cliente_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  cliente_telefone text check (cliente_telefone is null or cliente_telefone ~ '^[0-9]{8,14}$'),
  vendedor_id uuid references public.perfis(id) on delete set null default auth.uid(),
  subtotal numeric(15, 2) not null check (subtotal >= 0),
  desconto numeric(15, 2) not null default 0 check (desconto >= 0),
  frete numeric(15, 2) not null default 0 check (frete >= 0),
  total numeric(15, 2) not null check (total >= 0),
  troco numeric(15, 2) not null default 0 check (troco >= 0),
  observacao text check (observacao is null or length(observacao) <= 1000),
  entrega text check (entrega is null or length(entrega) <= 300),
  nfe_emissao_id uuid references public.nfe_emissoes(id) on delete set null,
  cancelada_em timestamptz,
  cancelada_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendas_empresa_id_unico unique (empresa_id, id),
  constraint vendas_numero_uk unique (empresa_id, tipo, numero),
  constraint vendas_status_tipo check (
    (tipo = 'venda' and status in ('concluida', 'cancelada') and sessao_id is not null)
    or (tipo = 'orcamento' and status in ('aberto', 'convertido', 'cancelada'))
  ),
  foreign key (empresa_id, sessao_id) references public.caixa_sessoes (empresa_id, id),
  foreign key (empresa_id, cliente_id) references public.contrapartes (empresa_id, id)
);
create index vendas_data_idx on public.vendas (empresa_id, tipo, data desc);
create index vendas_sessao_idx on public.vendas (sessao_id) where sessao_id is not null;
create trigger vendas_updated_at before update on public.vendas for each row execute function app.tg_updated_at();
create trigger auditoria_vendas after insert or update or delete on public.vendas for each row execute function app.tg_auditoria();

create table public.venda_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  venda_id uuid not null,
  ordem int not null,
  produto_id uuid not null references public.nfe_produtos(id) on delete restrict,
  codigo text not null,
  descricao text not null,
  unidade text not null,
  -- Cubagem: quantidade de peças e comprimento de cada uma
  pecas numeric(12, 3) check (pecas is null or pecas > 0),
  comprimento_m numeric(8, 3) check (comprimento_m is null or comprimento_m > 0),
  quantidade numeric(18, 4) not null check (quantidade > 0),
  preco_tabela numeric(15, 4),
  preco_unitario numeric(15, 4) not null check (preco_unitario >= 0),
  desconto numeric(15, 2) not null default 0 check (desconto >= 0),
  total numeric(15, 2) not null check (total >= 0),
  custo_unitario numeric(18, 6),
  foreign key (empresa_id, venda_id) references public.vendas (empresa_id, id) on delete cascade
);
create index venda_itens_venda_idx on public.venda_itens (venda_id, ordem);

create table public.venda_pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  venda_id uuid not null,
  forma text not null check (forma in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'a_prazo', 'outro')),
  valor numeric(15, 2) not null check (valor > 0),
  -- Dinheiro entregue pelo cliente (o troco é a diferença)
  valor_recebido numeric(15, 2),
  parcelas int not null default 1 check (parcelas between 1 and 24),
  primeiro_vencimento date,
  intervalo_dias int check (intervalo_dias is null or intervalo_dias between 1 and 90),
  lancamentos uuid[] not null default '{}',
  foreign key (empresa_id, venda_id) references public.vendas (empresa_id, id) on delete cascade,
  constraint venda_pagamentos_recebido check (valor_recebido is null or (forma = 'dinheiro' and valor_recebido >= valor)),
  constraint venda_pagamentos_prazo check (forma <> 'a_prazo' or primeiro_vencimento is not null)
);
create index venda_pagamentos_venda_idx on public.venda_pagamentos (venda_id);

-- Confere e calcula os itens (cubagem, preço, desconto e limite do operador)
create or replace function app.gestao_calcular_itens(
  p_empresa_id uuid, p_itens jsonb, p_gerente boolean, p_desconto_max numeric, p_desconto_geral numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  it jsonb;
  v_p public.nfe_produtos;
  v_pecas numeric;
  v_comp numeric;
  v_q numeric;
  v_preco numeric;
  v_desc numeric;
  v_total numeric;
  v_subtotal numeric := 0;
  v_tabela numeric := 0;
  v_desc_total numeric := 0;
  v_saida jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Adicione pelo menos um produto.';
  end if;
  if jsonb_array_length(p_itens) > 300 then
    raise exception 'No máximo 300 itens por venda.';
  end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into v_p from public.nfe_produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id and ativo;
    if v_p.id is null then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    v_pecas := nullif(it ->> 'pecas', '')::numeric;
    v_comp := coalesce(nullif(it ->> 'comprimento_m', '')::numeric, v_p.comprimento_m);
    if v_pecas is not null then
      if v_pecas <= 0 or v_pecas <> round(v_pecas, 3) then
        raise exception 'Quantidade de peças inválida em "%".', v_p.descricao;
      end if;
      if v_p.unidade = 'M3' and v_p.espessura_cm is not null and v_p.largura_cm is not null then
        if v_comp is null or v_comp <= 0 then
          raise exception 'Informe o comprimento das peças de "%".', v_p.descricao;
        end if;
        v_q := round(v_pecas * v_p.espessura_cm / 100 * v_p.largura_cm / 100 * v_comp, 4);
      elsif v_p.unidade in ('M', 'ML') then
        if v_comp is null or v_comp <= 0 then
          raise exception 'Informe o comprimento das peças de "%".', v_p.descricao;
        end if;
        v_q := round(v_pecas * v_comp, 4);
      else
        v_q := v_pecas;
        v_comp := null;
      end if;
    else
      v_q := nullif(it ->> 'quantidade', '')::numeric;
      v_comp := null;
    end if;
    if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) or v_q >= 100000000 then
      raise exception 'Quantidade inválida em "%" (até 4 casas decimais).', v_p.descricao;
    end if;
    v_preco := coalesce(nullif(it ->> 'preco_unitario', '')::numeric, v_p.valor_unitario);
    if v_preco is null then
      raise exception 'O produto "%" está sem preço de venda.', v_p.descricao;
    end if;
    if v_preco < 0 or v_preco <> round(v_preco, 4) then
      raise exception 'Preço inválido em "%".', v_p.descricao;
    end if;
    v_desc := coalesce(nullif(it ->> 'desconto', '')::numeric, 0);
    if v_desc < 0 or v_desc <> round(v_desc, 2) or v_desc > round(v_q * v_preco, 2) then
      raise exception 'Desconto inválido em "%".', v_p.descricao;
    end if;
    v_total := round(v_q * v_preco, 2) - v_desc;
    v_subtotal := v_subtotal + v_total;
    v_tabela := v_tabela + round(v_q * coalesce(v_p.valor_unitario, v_preco), 2);
    v_desc_total := v_desc_total + greatest(round(v_q * coalesce(v_p.valor_unitario, v_preco), 2) - v_total, 0);
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'produto_id', v_p.id, 'codigo', v_p.codigo, 'descricao', v_p.descricao, 'unidade', v_p.unidade,
      'pecas', v_pecas, 'comprimento_m', case when v_pecas is not null then v_comp end,
      'quantidade', v_q, 'preco_tabela', v_p.valor_unitario, 'preco_unitario', v_preco, 'desconto', v_desc, 'total', v_total,
      'custo_unitario', v_p.custo_medio
    ));
  end loop;
  v_desc_total := v_desc_total + coalesce(p_desconto_geral, 0);
  if not p_gerente and p_desconto_max is not null and v_tabela > 0 and v_desc_total > round(v_tabela * p_desconto_max / 100, 2) then
    raise exception 'O desconto (R$ %) passa do limite do operador (% %% do preço de tabela). Peça a alguém com permissão de gerente.',
      to_char(v_desc_total, 'FM999G999G990D00'), app.gestao_qtd(p_desconto_max);
  end if;
  return jsonb_build_object('itens', v_saida, 'subtotal', v_subtotal);
end;
$$;

-- Cadastro rápido de cliente no caixa (cadastro de clientes do Financeiro)
create or replace function public.gestao_cliente_salvar(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc text := nullif(regexp_replace(coalesce(p_dados ->> 'documento', ''), '\D', '', 'g'), '');
  v_nome text := nullif(trim(p_dados ->> 'nome'), '');
  v_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), '');
  v_email text := nullif(trim(p_dados ->> 'email'), '');
  v_id uuid;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe o nome do cliente.';
  end if;
  if v_doc is not null and length(v_doc) not in (11, 14) then
    raise exception 'CPF (11 números) ou CNPJ (14 números) inválido.';
  end if;
  if v_tel is not null and (length(v_tel) < 8 or length(v_tel) > 14) then
    raise exception 'Telefone inválido.';
  end if;
  if v_doc is not null then
    select id into v_id from public.contrapartes where empresa_id = p_empresa_id and documento = v_doc limit 1;
  end if;
  if v_id is not null then
    update public.contrapartes
       set papeis = case when 'cliente' = any(papeis) then papeis else array_append(papeis, 'cliente') end,
           telefone = coalesce(v_tel, telefone), email = coalesce(v_email, email), ativo = true
     where id = v_id;
    return v_id;
  end if;
  insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis, email, telefone)
  values (p_empresa_id, v_nome, v_doc, case length(v_doc) when 11 then 'PF' when 14 then 'PJ' end, array['cliente'], v_email, v_tel)
  returning id into v_id;
  return v_id;
end;
$$;

-- Abre o caixa do operador com o troco inicial
create or replace function public.gestao_caixa_abrir(p_empresa_id uuid, p_caixa_nome text, p_valor_abertura numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text := coalesce(nullif(trim(p_caixa_nome), ''), 'Caixa 1');
  v_quem text;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  if p_valor_abertura is null or p_valor_abertura < 0 or p_valor_abertura <> round(p_valor_abertura, 2) then
    raise exception 'Informe o troco inicial (pode ser zero).';
  end if;
  if exists (select 1 from public.caixa_sessoes where empresa_id = p_empresa_id and operador_id = auth.uid() and status = 'aberto') then
    raise exception 'Você já tem um caixa aberto. Feche-o antes de abrir outro.';
  end if;
  select p.nome into v_quem from public.caixa_sessoes s join public.perfis p on p.id = s.operador_id
   where s.empresa_id = p_empresa_id and s.status = 'aberto' and lower(s.caixa_nome) = lower(v_nome);
  if v_quem is not null then
    raise exception 'O % já está aberto por %. Use outro nome de caixa ou peça para fechar.', v_nome, v_quem;
  end if;
  insert into public.caixa_sessoes (empresa_id, caixa_nome, operador_id, valor_abertura, data)
  values (p_empresa_id, v_nome, auth.uid(), p_valor_abertura, app.hoje())
  returning id into v_id;
  return v_id;
end;
$$;

-- Resumo do caixa: vendas por forma de pagamento e dinheiro esperado na gaveta
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
    'sangrias', m.sangrias,
    'suprimentos', m.suprimentos,
    'qtd_sangrias', m.qtd_sangrias,
    'qtd_suprimentos', m.qtd_suprimentos,
    'dinheiro_esperado', s.valor_abertura + coalesce((select valor from pg where forma = 'dinheiro'), 0) + m.suprimentos - m.sangrias
  )
  from s, m;
$$;

create or replace function public.gestao_caixa_resumo(p_sessao_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.caixa_sessoes where id = p_sessao_id;
  if v_empresa is null then
    raise exception 'Caixa não encontrado.';
  end if;
  perform app.exigir(v_empresa, 'gestao.vender');
  return app.caixa_resumo(p_sessao_id);
end;
$$;

-- Sangria (retirada) e suprimento (reforço) do dinheiro da gaveta
create or replace function public.gestao_caixa_movimento(p_sessao_id uuid, p_tipo text, p_valor numeric, p_motivo text, p_conta_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.caixa_sessoes;
  v_cfg public.gestao_config;
  v_esperado numeric;
  v_transf uuid;
  v_id uuid;
begin
  select * into v_s from public.caixa_sessoes where id = p_sessao_id for update;
  if v_s.id is null then
    raise exception 'Caixa não encontrado.';
  end if;
  perform app.exigir_gestao(v_s.empresa_id, 'gestao.vender');
  if v_s.status <> 'aberto' then
    raise exception 'Este caixa já foi fechado.';
  end if;
  if v_s.operador_id <> auth.uid() and not app.pode(v_s.empresa_id, 'gestao.gerenciar') then
    raise exception 'Só quem abriu o caixa (ou o gerente) registra sangria e suprimento.';
  end if;
  if p_tipo not in ('sangria', 'suprimento') then
    raise exception 'Escolha sangria ou suprimento.';
  end if;
  if p_valor is null or p_valor <= 0 or p_valor <> round(p_valor, 2) then
    raise exception 'Informe o valor.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 2 then
    raise exception 'Informe o motivo.';
  end if;
  if p_tipo = 'sangria' then
    v_esperado := (app.caixa_resumo(p_sessao_id) ->> 'dinheiro_esperado')::numeric;
    if p_valor > v_esperado then
      raise exception 'A sangria (R$ %) é maior que o dinheiro que deveria estar na gaveta (R$ %).',
        to_char(p_valor, 'FM999G999G990D00'), to_char(v_esperado, 'FM999G999G990D00');
    end if;
  end if;
  select * into v_cfg from public.gestao_config where empresa_id = v_s.empresa_id;
  if p_conta_id is not null then
    if p_conta_id = v_cfg.conta_dinheiro_id then
      raise exception 'Escolha uma conta diferente da conta do caixa.';
    end if;
    if v_cfg.conta_dinheiro_id is null then
      raise exception 'Configure a conta do dinheiro nas configurações da loja.';
    end if;
    insert into public.transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor, descricao)
    values (v_s.empresa_id,
            case when p_tipo = 'sangria' then v_cfg.conta_dinheiro_id else p_conta_id end,
            case when p_tipo = 'sangria' then p_conta_id else v_cfg.conta_dinheiro_id end,
            app.hoje(), p_valor, initcap(p_tipo) || ' do ' || v_s.caixa_nome || ': ' || trim(p_motivo))
    returning id into v_transf;
  end if;
  insert into public.caixa_movimentos (empresa_id, sessao_id, tipo, valor, motivo, conta_id, transferencia_id)
  values (v_s.empresa_id, v_s.id, p_tipo, p_valor, trim(p_motivo), p_conta_id, v_transf)
  returning id into v_id;
  return v_id;
end;
$$;

-- Fecha o caixa com a contagem do dinheiro
create or replace function public.gestao_caixa_fechar(p_sessao_id uuid, p_valor_contado numeric, p_observacao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.caixa_sessoes;
  v_resumo jsonb;
  v_esperado numeric;
begin
  select * into v_s from public.caixa_sessoes where id = p_sessao_id for update;
  if v_s.id is null then
    raise exception 'Caixa não encontrado.';
  end if;
  perform app.exigir_gestao(v_s.empresa_id, 'gestao.vender');
  if v_s.status <> 'aberto' then
    raise exception 'Este caixa já foi fechado.';
  end if;
  if v_s.operador_id <> auth.uid() and not app.pode(v_s.empresa_id, 'gestao.gerenciar') then
    raise exception 'Só quem abriu o caixa (ou o gerente) pode fechá-lo.';
  end if;
  if p_valor_contado is null or p_valor_contado < 0 or p_valor_contado <> round(p_valor_contado, 2) then
    raise exception 'Informe quanto dinheiro foi contado na gaveta.';
  end if;
  v_resumo := app.caixa_resumo(p_sessao_id);
  v_esperado := (v_resumo ->> 'dinheiro_esperado')::numeric;
  update public.caixa_sessoes
     set status = 'fechado', fechado_em = now(), fechado_por = auth.uid(),
         valor_contado = p_valor_contado, valor_esperado = v_esperado, diferenca = p_valor_contado - v_esperado,
         observacao_fechamento = nullif(trim(p_observacao), ''),
         resumo = v_resumo || jsonb_build_object('contado', p_valor_contado, 'diferenca', p_valor_contado - v_esperado)
   where id = v_s.id;
  return v_resumo || jsonb_build_object('contado', p_valor_contado, 'diferenca', p_valor_contado - v_esperado);
end;
$$;

-- Venda no caixa: itens, pagamentos, estoque e Financeiro numa operação só
create or replace function public.gestao_venda_finalizar(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.gestao_config;
  v_sessao public.caixa_sessoes;
  v_gerente boolean;
  v_calc jsonb;
  v_subtotal numeric;
  v_desconto numeric := coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0);
  v_frete numeric := coalesce(nullif(p_dados ->> 'frete', '')::numeric, 0);
  v_total numeric;
  v_pag jsonb;
  v_forma text;
  v_valor numeric;
  v_recebido numeric;
  v_parc int;
  v_venc date;
  v_interv int;
  v_soma numeric := 0;
  v_troco numeric := 0;
  v_cli public.contrapartes;
  v_orc public.vendas;
  v_id uuid;
  v_numero bigint;
  v_hoje date := app.hoje();
  it jsonb;
  v_ordem int := 0;
  v_cat uuid;
  v_conta uuid;
  v_lanc uuid;
  v_lancs uuid[];
  v_desc text;
  v_valor_parc numeric;
  i int;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  v_gerente := app.pode(p_empresa_id, 'gestao.gerenciar');
  select * into v_cfg from public.gestao_config where empresa_id = p_empresa_id for update;
  select * into v_sessao from public.caixa_sessoes where id = nullif(p_dados ->> 'sessao_id', '')::uuid and empresa_id = p_empresa_id;
  if v_sessao.id is null or v_sessao.status <> 'aberto' then
    raise exception 'Abra o caixa antes de vender.';
  end if;
  if v_sessao.operador_id <> auth.uid() and not v_gerente then
    raise exception 'Este caixa foi aberto por outra pessoa. Abra o seu caixa para vender.';
  end if;
  if v_desconto < 0 or v_desconto <> round(v_desconto, 2) or v_frete < 0 or v_frete <> round(v_frete, 2) then
    raise exception 'Desconto ou frete inválido.';
  end if;

  v_calc := app.gestao_calcular_itens(p_empresa_id, p_dados -> 'itens', v_gerente, v_cfg.desconto_maximo_operador, v_desconto);
  v_subtotal := (v_calc ->> 'subtotal')::numeric;
  if v_desconto > v_subtotal then
    raise exception 'O desconto não pode ser maior que o valor dos produtos.';
  end if;
  v_total := v_subtotal - v_desconto + v_frete;
  if v_total <= 0 then
    raise exception 'O total da venda precisa ser maior que zero.';
  end if;

  if nullif(p_dados ->> 'cliente_id', '') is not null then
    select * into v_cli from public.contrapartes where id = (p_dados ->> 'cliente_id')::uuid and empresa_id = p_empresa_id;
    if v_cli.id is null then
      raise exception 'Cliente não encontrado.';
    end if;
  end if;

  -- Pagamentos: a soma precisa fechar com o total (o troco só existe no dinheiro)
  if jsonb_typeof(p_dados -> 'pagamentos') <> 'array' or jsonb_array_length(p_dados -> 'pagamentos') = 0 then
    raise exception 'Informe a forma de pagamento.';
  end if;
  if jsonb_array_length(p_dados -> 'pagamentos') > 6 then
    raise exception 'No máximo 6 formas de pagamento por venda.';
  end if;
  for v_pag in select * from jsonb_array_elements(p_dados -> 'pagamentos') loop
    v_forma := v_pag ->> 'forma';
    v_valor := nullif(v_pag ->> 'valor', '')::numeric;
    if v_forma not in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'a_prazo', 'outro') then
      raise exception 'Forma de pagamento inválida.';
    end if;
    if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
      raise exception 'Informe o valor de cada forma de pagamento.';
    end if;
    if v_forma = 'dinheiro' then
      v_recebido := coalesce(nullif(v_pag ->> 'valor_recebido', '')::numeric, v_valor);
      if v_recebido < v_valor or v_recebido <> round(v_recebido, 2) then
        raise exception 'O dinheiro recebido não pode ser menor que o valor pago em dinheiro.';
      end if;
      v_troco := v_troco + (v_recebido - v_valor);
    end if;
    if v_forma = 'a_prazo' then
      if not v_cfg.permitir_venda_prazo then
        raise exception 'A venda a prazo está desligada nas configurações da loja.';
      end if;
      if v_cli.id is null then
        raise exception 'Escolha o cliente para vender a prazo.';
      end if;
      v_parc := coalesce(nullif(v_pag ->> 'parcelas', '')::int, 1);
      v_venc := nullif(v_pag ->> 'primeiro_vencimento', '')::date;
      if v_parc < 1 or v_parc > 24 then
        raise exception 'A venda a prazo pode ter de 1 a 24 parcelas.';
      end if;
      if v_venc is null or v_venc < v_hoje then
        raise exception 'Informe o vencimento da primeira parcela (hoje ou depois).';
      end if;
    end if;
    v_soma := v_soma + v_valor;
  end loop;
  if v_soma <> v_total then
    raise exception 'A soma dos pagamentos (R$ %) é diferente do total da venda (R$ %).',
      to_char(v_soma, 'FM999G999G990D00'), to_char(v_total, 'FM999G999G990D00');
  end if;

  if nullif(p_dados ->> 'orcamento_id', '') is not null then
    select * into v_orc from public.vendas
     where id = (p_dados ->> 'orcamento_id')::uuid and empresa_id = p_empresa_id and tipo = 'orcamento' for update;
    if v_orc.id is null or v_orc.status <> 'aberto' then
      raise exception 'O orçamento não está mais em aberto.';
    end if;
  end if;

  v_numero := v_cfg.proximo_numero_venda;
  update public.gestao_config set proximo_numero_venda = proximo_numero_venda + 1 where empresa_id = p_empresa_id;

  insert into public.vendas (
    empresa_id, tipo, numero, status, sessao_id, orcamento_id, data, cliente_id, cliente_nome, cliente_documento, cliente_telefone,
    subtotal, desconto, frete, total, troco, observacao, entrega
  ) values (
    p_empresa_id, 'venda', v_numero, 'concluida', v_sessao.id, v_orc.id, v_hoje, v_cli.id,
    coalesce(v_cli.nome, nullif(trim(p_dados ->> 'cliente_nome'), '')),
    coalesce(v_cli.documento, nullif(regexp_replace(coalesce(p_dados ->> 'cliente_documento', ''), '\D', '', 'g'), '')),
    coalesce(nullif(regexp_replace(coalesce(v_cli.telefone, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'cliente_telefone', ''), '\D', '', 'g'), '')),
    v_subtotal, v_desconto, v_frete, v_total, v_troco,
    nullif(trim(p_dados ->> 'observacao'), ''), nullif(trim(p_dados ->> 'entrega'), '')
  ) returning id into v_id;

  if v_orc.id is not null then
    update public.vendas set status = 'convertido' where id = v_orc.id;
  end if;

  for it in select * from jsonb_array_elements(v_calc -> 'itens') loop
    v_ordem := v_ordem + 1;
    insert into public.venda_itens (
      empresa_id, venda_id, ordem, produto_id, codigo, descricao, unidade, pecas, comprimento_m, quantidade,
      preco_tabela, preco_unitario, desconto, total, custo_unitario
    ) values (
      p_empresa_id, v_id, v_ordem, (it ->> 'produto_id')::uuid, it ->> 'codigo', it ->> 'descricao', it ->> 'unidade',
      nullif(it ->> 'pecas', '')::numeric, nullif(it ->> 'comprimento_m', '')::numeric, (it ->> 'quantidade')::numeric,
      nullif(it ->> 'preco_tabela', '')::numeric, (it ->> 'preco_unitario')::numeric, (it ->> 'desconto')::numeric,
      (it ->> 'total')::numeric, nullif(it ->> 'custo_unitario', '')::numeric
    );
    perform app.estoque_movimentar(p_empresa_id, (it ->> 'produto_id')::uuid, 'venda', -((it ->> 'quantidade')::numeric), null,
      v_id, null, 'Venda nº ' || v_numero, v_cfg.permitir_estoque_negativo);
  end loop;

  -- Financeiro: um lançamento a receber por forma de pagamento (a prazo: um por parcela)
  v_cat := app.categoria_sistema(p_empresa_id, 'VENDAS');
  if v_cat is null then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_cat := app.categoria_sistema(p_empresa_id, 'VENDAS');
  end if;
  v_desc := 'Venda nº ' || v_numero || coalesce(' — ' || coalesce(v_cli.nome, nullif(trim(p_dados ->> 'cliente_nome'), '')), '');
  for v_pag in select * from jsonb_array_elements(p_dados -> 'pagamentos') loop
    v_forma := v_pag ->> 'forma';
    v_valor := (v_pag ->> 'valor')::numeric;
    v_lancs := '{}';
    if v_forma = 'a_prazo' then
      v_parc := coalesce(nullif(v_pag ->> 'parcelas', '')::int, 1);
      v_venc := (v_pag ->> 'primeiro_vencimento')::date;
      v_interv := coalesce(nullif(v_pag ->> 'intervalo_dias', '')::int, 30);
      if v_interv < 1 or v_interv > 90 then
        raise exception 'O intervalo entre as parcelas precisa ser de 1 a 90 dias.';
      end if;
      for i in 1 .. v_parc loop
        v_valor_parc := case when i < v_parc then round(v_valor / v_parc, 2) else v_valor - round(v_valor / v_parc, 2) * (v_parc - 1) end;
        insert into public.lancamentos (
          empresa_id, tipo, descricao, categoria_id, contraparte_id, data_competencia, data_vencimento, valor_previsto,
          origem, origem_referencia, parcela_numero, parcela_total, numero_documento
        ) values (
          p_empresa_id, 'receber', v_desc || case when v_parc > 1 then ' — parcela ' || i || '/' || v_parc else '' end,
          v_cat, v_cli.id, v_hoje, v_venc + (i - 1) * v_interv, v_valor_parc,
          'venda', v_id::text, case when v_parc > 1 then i end, case when v_parc > 1 then v_parc end, v_numero::text
        ) returning id into v_lanc;
        v_lancs := v_lancs || v_lanc;
      end loop;
    else
      v_conta := case v_forma
        when 'pix' then v_cfg.conta_pix_id
        when 'cartao_debito' then v_cfg.conta_cartao_id
        when 'cartao_credito' then v_cfg.conta_cartao_id
        else v_cfg.conta_dinheiro_id
      end;
      if v_conta is null then
        raise exception 'Configure a conta que recebe este pagamento nas configurações da loja.';
      end if;
      insert into public.lancamentos (
        empresa_id, tipo, descricao, categoria_id, contraparte_id, conta_financeira_id, data_competencia, data_vencimento,
        valor_previsto, origem, origem_referencia, numero_documento
      ) values (
        p_empresa_id, 'receber', v_desc, v_cat, v_cli.id, v_conta, v_hoje, v_hoje, v_valor, 'venda', v_id::text, v_numero::text
      ) returning id into v_lanc;
      insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem, observacao)
      values (p_empresa_id, v_lanc, 'receber', v_hoje, v_conta, v_valor, case v_forma when 'outro' then 'outro' else v_forma end, 'venda', v_desc);
      v_lancs := array[v_lanc];
    end if;
    insert into public.venda_pagamentos (empresa_id, venda_id, forma, valor, valor_recebido, parcelas, primeiro_vencimento, intervalo_dias, lancamentos)
    values (
      p_empresa_id, v_id, v_forma, v_valor,
      case when v_forma = 'dinheiro' then coalesce(nullif(v_pag ->> 'valor_recebido', '')::numeric, v_valor) end,
      case when v_forma in ('a_prazo', 'cartao_credito') then coalesce(nullif(v_pag ->> 'parcelas', '')::int, 1) else 1 end,
      case when v_forma = 'a_prazo' then (v_pag ->> 'primeiro_vencimento')::date end,
      case when v_forma = 'a_prazo' then coalesce(nullif(v_pag ->> 'intervalo_dias', '')::int, 30) end,
      v_lancs
    );
  end loop;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'total', v_total, 'troco', v_troco);
end;
$$;

-- Cancela a venda (devolve o estoque e cancela os lançamentos) ou o orçamento
create or replace function public.gestao_venda_cancelar(p_venda_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
  v_sessao text;
  v_lancs uuid[];
  it public.venda_itens;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if v.id is null then
    raise exception 'Venda não encontrada.';
  end if;
  if v.tipo = 'orcamento' then
    perform app.exigir_gestao(v.empresa_id, 'gestao.vender');
    if v.status <> 'aberto' then
      raise exception 'Só orçamentos em aberto podem ser cancelados.';
    end if;
    update public.vendas set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(),
      motivo_cancelamento = nullif(trim(p_motivo), '') where id = v.id;
    return;
  end if;
  perform app.exigir_gestao(v.empresa_id, 'gestao.gerenciar');
  if v.status <> 'concluida' then
    raise exception 'Esta venda já está cancelada.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  select status into v_sessao from public.caixa_sessoes where id = v.sessao_id;
  if v_sessao <> 'aberto' then
    raise exception 'O caixa desta venda já foi fechado. Faça a devolução pelo Financeiro e um ajuste de estoque.';
  end if;
  if v.nfe_emissao_id is not null and exists (
    select 1 from public.nfe_emissoes where id = v.nfe_emissao_id and situacao in ('na_fila', 'enviando', 'aguardando', 'autorizada', 'cancelando', 'falha')
  ) then
    raise exception 'Esta venda tem NF-e. Cancele a nota antes de cancelar a venda.';
  end if;
  select coalesce(array_agg(l), '{}') into v_lancs from public.venda_pagamentos p, unnest(p.lancamentos) l where p.venda_id = v.id;
  if exists (select 1 from public.baixas b where b.lancamento_id = any(v_lancs) and b.origem <> 'venda') then
    raise exception 'Uma parcela desta venda já foi recebida. Estorne o recebimento no Financeiro antes de cancelar.';
  end if;
  delete from public.baixas where lancamento_id = any(v_lancs) and origem = 'venda';
  update public.lancamentos
     set situacao = 'cancelado', motivo_cancelamento = left('Venda nº ' || v.numero || ' cancelada: ' || trim(p_motivo), 500)
   where id = any(v_lancs) and situacao <> 'cancelado';
  for it in select * from public.venda_itens where venda_id = v.id order by ordem loop
    perform app.estoque_movimentar(v.empresa_id, it.produto_id, 'cancelamento_venda', it.quantidade, null, v.id, null,
      'Cancelamento da venda nº ' || v.numero, true);
  end loop;
  update public.vendas
     set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 500)
   where id = v.id;
end;
$$;

-- Orçamento: salva (ou atualiza) sem mexer no estoque nem no Financeiro
create or replace function public.gestao_orcamento_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.gestao_config;
  v_calc jsonb;
  v_subtotal numeric;
  v_desconto numeric := coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0);
  v_frete numeric := coalesce(nullif(p_dados ->> 'frete', '')::numeric, 0);
  v_cli public.contrapartes;
  v_atual public.vendas;
  v_id uuid;
  v_numero bigint;
  v_validade date := nullif(p_dados ->> 'validade', '')::date;
  it jsonb;
  v_ordem int := 0;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  select * into v_cfg from public.gestao_config where empresa_id = p_empresa_id for update;
  if v_desconto < 0 or v_desconto <> round(v_desconto, 2) or v_frete < 0 or v_frete <> round(v_frete, 2) then
    raise exception 'Desconto ou frete inválido.';
  end if;
  v_calc := app.gestao_calcular_itens(p_empresa_id, p_dados -> 'itens', app.pode(p_empresa_id, 'gestao.gerenciar'), v_cfg.desconto_maximo_operador, v_desconto);
  v_subtotal := (v_calc ->> 'subtotal')::numeric;
  if v_desconto > v_subtotal then
    raise exception 'O desconto não pode ser maior que o valor dos produtos.';
  end if;
  if nullif(p_dados ->> 'cliente_id', '') is not null then
    select * into v_cli from public.contrapartes where id = (p_dados ->> 'cliente_id')::uuid and empresa_id = p_empresa_id;
    if v_cli.id is null then
      raise exception 'Cliente não encontrado.';
    end if;
  end if;
  if v_validade is null then
    v_validade := app.hoje() + v_cfg.validade_orcamento_dias;
  end if;
  if p_id is null then
    v_numero := v_cfg.proximo_numero_orcamento;
    update public.gestao_config set proximo_numero_orcamento = proximo_numero_orcamento + 1 where empresa_id = p_empresa_id;
    insert into public.vendas (
      empresa_id, tipo, numero, status, data, validade, cliente_id, cliente_nome, cliente_documento, cliente_telefone,
      subtotal, desconto, frete, total, observacao, entrega
    ) values (
      p_empresa_id, 'orcamento', v_numero, 'aberto', app.hoje(), v_validade, v_cli.id,
      coalesce(v_cli.nome, nullif(trim(p_dados ->> 'cliente_nome'), '')),
      coalesce(v_cli.documento, nullif(regexp_replace(coalesce(p_dados ->> 'cliente_documento', ''), '\D', '', 'g'), '')),
      coalesce(nullif(regexp_replace(coalesce(v_cli.telefone, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'cliente_telefone', ''), '\D', '', 'g'), '')),
      v_subtotal, v_desconto, v_frete, v_subtotal - v_desconto + v_frete,
      nullif(trim(p_dados ->> 'observacao'), ''), nullif(trim(p_dados ->> 'entrega'), '')
    ) returning id, numero into v_id, v_numero;
  else
    select * into v_atual from public.vendas where id = p_id and empresa_id = p_empresa_id and tipo = 'orcamento' for update;
    if v_atual.id is null or v_atual.status <> 'aberto' then
      raise exception 'Só orçamentos em aberto podem ser alterados.';
    end if;
    update public.vendas
       set validade = v_validade, cliente_id = v_cli.id,
           cliente_nome = coalesce(v_cli.nome, nullif(trim(p_dados ->> 'cliente_nome'), '')),
           cliente_documento = coalesce(v_cli.documento, nullif(regexp_replace(coalesce(p_dados ->> 'cliente_documento', ''), '\D', '', 'g'), '')),
           cliente_telefone = coalesce(nullif(regexp_replace(coalesce(v_cli.telefone, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'cliente_telefone', ''), '\D', '', 'g'), '')),
           subtotal = v_subtotal, desconto = v_desconto, frete = v_frete, total = v_subtotal - v_desconto + v_frete,
           observacao = nullif(trim(p_dados ->> 'observacao'), ''), entrega = nullif(trim(p_dados ->> 'entrega'), '')
     where id = p_id;
    delete from public.venda_itens where venda_id = p_id;
    v_id := p_id;
    v_numero := v_atual.numero;
  end if;
  for it in select * from jsonb_array_elements(v_calc -> 'itens') loop
    v_ordem := v_ordem + 1;
    insert into public.venda_itens (
      empresa_id, venda_id, ordem, produto_id, codigo, descricao, unidade, pecas, comprimento_m, quantidade,
      preco_tabela, preco_unitario, desconto, total, custo_unitario
    ) values (
      p_empresa_id, v_id, v_ordem, (it ->> 'produto_id')::uuid, it ->> 'codigo', it ->> 'descricao', it ->> 'unidade',
      nullif(it ->> 'pecas', '')::numeric, nullif(it ->> 'comprimento_m', '')::numeric, (it ->> 'quantidade')::numeric,
      nullif(it ->> 'preco_tabela', '')::numeric, (it ->> 'preco_unitario')::numeric, (it ->> 'desconto')::numeric,
      (it ->> 'total')::numeric, nullif(it ->> 'custo_unitario', '')::numeric
    );
  end loop;
  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$$;

-- Liga a NF-e emitida à venda
create or replace function public.gestao_venda_vincular_nfe(p_venda_id uuid, p_nfe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
begin
  select * into v from public.vendas where id = p_venda_id;
  if v.id is null or v.tipo <> 'venda' then
    raise exception 'Venda não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.emitir');
  if not exists (select 1 from public.nfe_emissoes where id = p_nfe_id and empresa_id = v.empresa_id) then
    raise exception 'Nota não encontrada.';
  end if;
  update public.vendas set nfe_emissao_id = p_nfe_id where id = v.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Acesso: leitura por quem usa a loja; escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.gestao_config enable row level security;
create policy gestao_config_leitura on public.gestao_config for select to authenticated
  using (empresa_id = any ((select app.empresas_com('empresa.ver'))::uuid[]));
grant select on public.gestao_config to authenticated;
grant select, insert, update, delete on public.gestao_config to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['estoque_movimentos', 'caixa_sessoes', 'caixa_movimentos', 'vendas', 'venda_itens', 'venda_pagamentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (empresa_id = any ((select app.empresas_com(''gestao.vender''))::uuid[]))',
      t || '_leitura', t
    );
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

revoke execute on function public.gestao_configurar(uuid, jsonb), public.gestao_produto_salvar(uuid, uuid, jsonb),
  public.gestao_estoque_lancar(uuid, jsonb), public.gestao_inventario(uuid, jsonb, text), public.gestao_entrada_nota(uuid, uuid, jsonb),
  public.gestao_cliente_salvar(uuid, jsonb), public.gestao_caixa_abrir(uuid, text, numeric), public.gestao_caixa_resumo(uuid),
  public.gestao_caixa_movimento(uuid, text, numeric, text, uuid), public.gestao_caixa_fechar(uuid, numeric, text),
  public.gestao_venda_finalizar(uuid, jsonb), public.gestao_venda_cancelar(uuid, text), public.gestao_orcamento_salvar(uuid, uuid, jsonb),
  public.gestao_venda_vincular_nfe(uuid, uuid),
  app.gestao_ativa(uuid), app.exigir_gestao(uuid, text), app.gestao_conta(uuid, text, text),
  app.estoque_movimentar(uuid, uuid, text, numeric, numeric, uuid, uuid, text, boolean), app.gestao_qtd(numeric),
  app.caixa_resumo(uuid), app.gestao_calcular_itens(uuid, jsonb, boolean, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.gestao_configurar(uuid, jsonb), public.gestao_produto_salvar(uuid, uuid, jsonb),
  public.gestao_estoque_lancar(uuid, jsonb), public.gestao_inventario(uuid, jsonb, text), public.gestao_entrada_nota(uuid, uuid, jsonb),
  public.gestao_cliente_salvar(uuid, jsonb), public.gestao_caixa_abrir(uuid, text, numeric), public.gestao_caixa_resumo(uuid),
  public.gestao_caixa_movimento(uuid, text, numeric, text, uuid), public.gestao_caixa_fechar(uuid, numeric, text),
  public.gestao_venda_finalizar(uuid, jsonb), public.gestao_venda_cancelar(uuid, text), public.gestao_orcamento_salvar(uuid, uuid, jsonb),
  public.gestao_venda_vincular_nfe(uuid, uuid)
  to authenticated;
grant execute on function app.gestao_ativa(uuid) to authenticated;
