-- =============================================================================
-- Escalas de trabalho dos funcionários (com assistente de IA opcional)
--
-- Cada empresa monta a escala do mês dos seus funcionários com os modelos
-- usados no mercado (5x2, 6x1, 12x36, 24x48, 4x3, 5x1, 6x2, turnos de
-- revezamento, jornada parcial ou personalizada). O portal gera a grade do
-- mês e confere as regras da CLT no servidor (src/lib/escalas); o banco
-- guarda a configuração, a grade e quem pode ver ou alterar.
--
--  * escalas.gerenciar: cadastrar funcionários da escala, montar, alterar e
--    publicar escalas (equipe e empresário, por padrão).
--  * escalas.ver: ver as escalas publicadas (dá para liberar a um colaborador
--    do cliente, como o gerente da loja).
--  * Assistente de IA (Claude, da Anthropic): fica desconectado até o
--    administrador do escritório cadastrar a chave. A chave fica cifrada numa
--    tabela que nenhum usuário lê pelo navegador (só o servidor do portal).
--    Os nomes dos funcionários não são enviados (a IA recebe apelidos P1, P2...).
--    Cada uso é registrado (sem o conteúdo) e há limite diário por empresa.
-- =============================================================================

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
    'escalas.gerenciar'
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
      'escalas.ver', 'escalas.gerenciar'
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
      'escalas.ver', 'escalas.gerenciar'
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
  return new;
end;
$$;

-- Acessos existentes: equipe e empresário titular passam a montar escalas.
update public.empresa_membros
   set permissoes = permissoes || array['escalas.ver', 'escalas.gerenciar']
 where papel in ('equipe', 'cliente_titular') and not (permissoes && array['escalas.ver', 'escalas.gerenciar']);
update public.convites
   set permissoes = permissoes || array['escalas.ver', 'escalas.gerenciar']
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and cardinality(permissoes) > 0
   and not (permissoes && array['escalas.ver', 'escalas.gerenciar']);

-- A ferramenta pode ser desligada pelo escritório em cada empresa (some do menu).
alter table public.empresas drop constraint empresas_ferramentas_validas;
alter table public.empresas
  add constraint empresas_ferramentas_validas check (
    ferramentas_desligadas <@ array[
      'nfse', 'nfe', 'cte', 'notas_automaticas', 'agenda', 'vencimentos', 'financeiro', 'maquininhas',
      'conciliacao', 'fechamento', 'calculos', 'auditor', 'relatorios', 'declaracoes', 'solicitacoes',
      'escalas'
    ]::text[]
  );

-- -----------------------------------------------------------------------------
-- 2. Funcionários da escala (cadastro próprio: nome, cargo, jornada e
--    restrições; sem salário nem documentos)
-- -----------------------------------------------------------------------------
create table public.escala_funcionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  cargo text check (cargo is null or length(cargo) <= 80),
  setor text check (setor is null or length(setor) <= 60),
  -- Jornada do contrato (horas por semana); acima de 44 a Constituição não permite
  jornada_semanal numeric(4, 1) not null default 44 check (jornada_semanal > 0 and jornada_semanal <= 44),
  -- Dias da semana em que não trabalha (0 = domingo ... 6 = sábado)
  nao_trabalha smallint[] not null default '{}'::smallint[]
    check (nao_trabalha <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- Folga em domingo a cada 15 dias (art. 386 da CLT, empregadas mulheres)
  domingo_quinzenal boolean not null default false,
  -- Menor de 18 anos: não pode trabalhar à noite nem fazer hora extra (arts. 404 e 413 da CLT)
  menor_idade boolean not null default false,
  -- Preferências para montar a escala (vão ao assistente de IA, sem o nome)
  preferencias text check (preferencias is null or length(preferencias) <= 200),
  ativo boolean not null default true,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index escala_funcionarios_empresa_idx on public.escala_funcionarios (empresa_id, nome);
create trigger escala_funcionarios_updated_at before update on public.escala_funcionarios
  for each row execute function app.tg_updated_at();
create trigger auditoria_escala_funcionarios after insert or update or delete on public.escala_funcionarios
  for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Escalas do mês: configuração (turnos, funcionamento, cobertura, regras e
--    pessoas, com nome e cargo copiados) e grade (código de cada dia)
-- -----------------------------------------------------------------------------
create table public.escalas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  competencia date not null check (extract(day from competencia) = 1),
  status text not null default 'rascunho' check (status in ('rascunho', 'publicada')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 200000),
  grade jsonb not null default '{}'::jsonb check (jsonb_typeof(grade) = 'object' and pg_column_size(grade) < 400000),
  -- Explicação da última sugestão do assistente de IA aplicada (quando houver)
  ia_resumo text check (ia_resumo is null or length(ia_resumo) <= 4000),
  publicada_em timestamptz,
  publicada_por uuid references public.perfis(id) on delete set null,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint escalas_publicacao check ((status = 'publicada') = (publicada_em is not null))
);
create index escalas_empresa_idx on public.escalas (empresa_id, competencia desc);
create trigger escalas_updated_at before update on public.escalas
  for each row execute function app.tg_updated_at();
create trigger auditoria_escalas after insert or update or delete on public.escalas
  for each row execute function app.tg_auditoria();

-- Publicar registra quem e quando; voltar a rascunho limpa.
create or replace function app.tg_escala_publicacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'publicada' and (tg_op = 'INSERT' or old.status is distinct from 'publicada') then
    new.publicada_em := now();
    new.publicada_por := auth.uid();
  elsif new.status = 'rascunho' then
    new.publicada_em := null;
    new.publicada_por := null;
  end if;
  return new;
end;
$$;
create trigger escalas_publicacao before insert or update of status on public.escalas
  for each row execute function app.tg_escala_publicacao();

-- -----------------------------------------------------------------------------
-- 4. Assistente de IA: configuração do escritório (só o servidor lê) e uso
-- -----------------------------------------------------------------------------
create table public.escritorio_ia (
  id smallint primary key default 1 check (id = 1),
  ativa boolean not null default false,
  -- Só os 4 últimos caracteres da chave, para o administrador reconhecer qual está cadastrada
  chave_final text check (chave_final is null or chave_final ~ '^[A-Za-z0-9_-]{4}$'),
  modelo text not null default 'claude-opus-5-5' check (modelo ~ '^claude-[a-z0-9-]{3,40}$'),
  limite_diario int not null default 30 check (limite_diario between 1 and 500),
  testada_em timestamptz,
  teste_ok boolean,
  teste_erro text check (teste_erro is null or length(teste_erro) <= 300),
  atualizado_por uuid references public.perfis(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.escritorio_ia (id) values (1) on conflict do nothing;
create trigger escritorio_ia_updated_at before update on public.escritorio_ia
  for each row execute function app.tg_updated_at();
create trigger auditoria_escritorio_ia after update on public.escritorio_ia
  for each row execute function app.tg_auditoria();

-- Chave da API da Anthropic, cifrada no servidor (AES-256-GCM com a chave que só
-- existe na hospedagem). Sem política de acesso e fora da auditoria: só o
-- servidor do portal lê, e o texto cifrado não vai para registro nenhum.
create table public.escritorio_ia_segredo (
  id smallint primary key default 1 check (id = 1) references public.escritorio_ia(id) on delete cascade,
  chave_cifrada text not null check (chave_cifrada ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(chave_cifrada) <= 2000),
  created_at timestamptz not null default now()
);

alter table public.escritorio_ia enable row level security;
alter table public.escritorio_ia_segredo enable row level security;
create policy escritorio_ia_leitura on public.escritorio_ia for select to authenticated using ((select app.is_admin()));
revoke all on public.escritorio_ia, public.escritorio_ia_segredo from anon, authenticated;
grant select on public.escritorio_ia to authenticated;
grant select, insert, update, delete on public.escritorio_ia, public.escritorio_ia_segredo to service_role;

-- O administrador liga ou desliga o assistente, escolhe o modelo e o limite diário.
create or replace function public.escritorio_ia_configurar(p_ativa boolean, p_modelo text, p_limite_diario int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório configura o assistente de IA.' using errcode = '42501';
  end if;
  if p_ativa and not exists (select 1 from public.escritorio_ia_segredo where id = 1) then
    raise exception 'Cadastre a chave da Anthropic antes de ligar o assistente.' using errcode = 'P0001';
  end if;
  update public.escritorio_ia
     set ativa = p_ativa, modelo = p_modelo, limite_diario = p_limite_diario, atualizado_por = auth.uid()
   where id = 1;
end;
$$;

-- Guarda a chave (já cifrada pelo servidor) ou remove (nulo). Trocar a chave pede novo teste.
create or replace function public.escritorio_ia_salvar_chave(p_chave_cifrada text, p_chave_final text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório cadastra a chave do assistente de IA.' using errcode = '42501';
  end if;
  if p_chave_cifrada is null then
    delete from public.escritorio_ia_segredo where id = 1;
    update public.escritorio_ia
       set ativa = false, chave_final = null, testada_em = null, teste_ok = null, teste_erro = null, atualizado_por = auth.uid()
     where id = 1;
    return;
  end if;
  insert into public.escritorio_ia_segredo (id, chave_cifrada) values (1, p_chave_cifrada)
  on conflict (id) do update set chave_cifrada = excluded.chave_cifrada, created_at = now();
  update public.escritorio_ia
     set chave_final = p_chave_final, testada_em = null, teste_ok = null, teste_erro = null, atualizado_por = auth.uid()
   where id = 1;
end;
$$;

-- Resultado do teste da conexão (feito pelo servidor com a chave guardada).
create or replace function public.escritorio_ia_registrar_teste(p_ok boolean, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório testa o assistente de IA.' using errcode = '42501';
  end if;
  update public.escritorio_ia
     set testada_em = now(), teste_ok = p_ok, teste_erro = case when p_ok then null else left(p_erro, 300) end
   where id = 1;
end;
$$;

revoke execute on function public.escritorio_ia_configurar(boolean, text, int) from public, anon;
revoke execute on function public.escritorio_ia_salvar_chave(text, text) from public, anon;
revoke execute on function public.escritorio_ia_registrar_teste(boolean, text) from public, anon;
grant execute on function public.escritorio_ia_configurar(boolean, text, int) to authenticated;
grant execute on function public.escritorio_ia_salvar_chave(text, text) to authenticated;
grant execute on function public.escritorio_ia_registrar_teste(boolean, text) to authenticated;

-- Registro de cada pedido ao assistente (sem o conteúdo do pedido nem da resposta)
create table public.escala_ia_usos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid references public.perfis(id) on delete set null default auth.uid(),
  tipo text not null check (tipo in ('sugerir', 'ajustar')),
  modelo text not null check (length(modelo) <= 60),
  situacao text not null default 'enviado' check (situacao in ('enviado', 'ok', 'erro')),
  tokens_entrada int check (tokens_entrada is null or tokens_entrada >= 0),
  tokens_saida int check (tokens_saida is null or tokens_saida >= 0),
  erro text check (erro is null or length(erro) <= 300),
  created_at timestamptz not null default now(),
  concluido_em timestamptz
);
create index escala_ia_usos_empresa_idx on public.escala_ia_usos (empresa_id, created_at desc);

-- Reserva um uso (confere a permissão e o limite do dia, um de cada vez por empresa).
create or replace function public.escala_ia_reservar(p_empresa_id uuid, p_tipo text)
returns table (uso_id bigint, modelo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.escritorio_ia;
  v_usados int;
  v_id bigint;
begin
  perform app.exigir(p_empresa_id, 'escalas.gerenciar');
  select * into v_cfg from public.escritorio_ia where id = 1;
  if v_cfg.id is null or not v_cfg.ativa or not exists (select 1 from public.escritorio_ia_segredo where id = 1) then
    raise exception 'O assistente de IA está desconectado. O administrador do escritório precisa cadastrar a chave em Configurações → Integrações.'
      using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('escala_ia:' || p_empresa_id::text, 0));
  select count(*) into v_usados
    from public.escala_ia_usos u
   where u.empresa_id = p_empresa_id
     and u.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_usados >= v_cfg.limite_diario then
    raise exception 'Limite de % pedidos por dia ao assistente nesta empresa atingido. Amanhã o limite volta.', v_cfg.limite_diario
      using errcode = 'P0001';
  end if;
  insert into public.escala_ia_usos (empresa_id, user_id, tipo, modelo)
  values (p_empresa_id, auth.uid(), p_tipo, v_cfg.modelo)
  returning id into v_id;
  return query select v_id, v_cfg.modelo;
end;
$$;

-- Fecha o registro do uso (só quem reservou).
create or replace function public.escala_ia_concluir(p_uso_id bigint, p_ok boolean, p_tokens_entrada int, p_tokens_saida int, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.escala_ia_usos
     set situacao = case when p_ok then 'ok' else 'erro' end,
         tokens_entrada = p_tokens_entrada,
         tokens_saida = p_tokens_saida,
         erro = left(p_erro, 300),
         concluido_em = now()
   where id = p_uso_id and user_id = auth.uid() and situacao = 'enviado';
end;
$$;

-- Situação do assistente para as telas (sem a chave).
create or replace function public.escala_ia_situacao(p_empresa_id uuid)
returns table (ligada boolean, limite_diario int, usados_hoje int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.escritorio_ia;
begin
  perform app.exigir(p_empresa_id, 'escalas.gerenciar');
  select * into v_cfg from public.escritorio_ia where id = 1;
  return query
    select coalesce(v_cfg.ativa and exists (select 1 from public.escritorio_ia_segredo where id = 1), false),
           coalesce(v_cfg.limite_diario, 0),
           (select count(*)::int from public.escala_ia_usos u
             where u.empresa_id = p_empresa_id
               and u.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS e privilégios
-- -----------------------------------------------------------------------------
alter table public.escala_funcionarios enable row level security;
alter table public.escalas enable row level security;
alter table public.escala_ia_usos enable row level security;

create policy escala_funcionarios_leitura on public.escala_funcionarios for select to authenticated
  using ((select app.pode(empresa_id, 'escalas.gerenciar')));
create policy escala_funcionarios_escrita on public.escala_funcionarios for all to authenticated
  using ((select app.pode(empresa_id, 'escalas.gerenciar')))
  with check ((select app.pode(empresa_id, 'escalas.gerenciar')));

-- Quem só vê enxerga as escalas publicadas; quem monta vê também os rascunhos.
create policy escalas_leitura on public.escalas for select to authenticated
  using ((select app.pode(empresa_id, 'escalas.gerenciar')) or (status = 'publicada' and (select app.pode(empresa_id, 'escalas.ver'))));
create policy escalas_escrita on public.escalas for all to authenticated
  using ((select app.pode(empresa_id, 'escalas.gerenciar')))
  with check ((select app.pode(empresa_id, 'escalas.gerenciar')));

create policy escala_ia_usos_leitura on public.escala_ia_usos for select to authenticated
  using ((select app.is_equipe()) or (select app.pode(empresa_id, 'escalas.gerenciar')));

grant select, insert, update, delete on public.escala_funcionarios, public.escalas to authenticated;
grant select on public.escala_ia_usos to authenticated;

revoke execute on function public.escala_ia_reservar(uuid, text) from public, anon;
revoke execute on function public.escala_ia_concluir(bigint, boolean, int, int, text) from public, anon;
revoke execute on function public.escala_ia_situacao(uuid) from public, anon;
grant execute on function public.escala_ia_reservar(uuid, text) to authenticated;
grant execute on function public.escala_ia_concluir(bigint, boolean, int, int, text) to authenticated;
grant execute on function public.escala_ia_situacao(uuid) to authenticated;
revoke all on function app.tg_escala_publicacao() from public, anon;
