-- =============================================================================
-- Gestão de RH: cargos, funcionário ligado ao acesso do portal e quadro de
-- tarefas recorrentes (modelo × ocorrência), com conclusão manual (data, hora,
-- quem estava logado e evidências quando o modelo exige) ou automática pelo
-- registro do próprio sistema (fechamento do caixa, conciliação da semana,
-- conferência do estoque).
--
--  * Modelo: a rotina (título, periodicidade e calendário, cargo, responsável
--    padrão, exigências e regra de conclusão). Ocorrência: a tarefa de um
--    período (um dia, uma semana, uma quinzena ou um mês). Uma ocorrência por
--    modelo e período (único no banco): a geração pode rodar várias vezes sem
--    duplicar. Ao concluir, o registro do período fica e a próxima é criada.
--  * Dependência: uma tarefa só conclui depois das tarefas de que depende.
--    O modelo pode depender de outro (a ocorrência do mesmo período).
--  * Conclusão automática: o vínculo com o registro (caixa, conciliação,
--    conferência) fica no histórico; processar o mesmo registro de novo não
--    muda nada. Quando o registro não bate com uma só ocorrência, o sistema
--    sugere as candidatas e uma pessoa confirma (a IA do escritório, se
--    ligada, pode indicar a mais provável).
--  * Permissões: rh.gerenciar (gestor: cargos, modelos, atribuir, ver todas)
--    e rh.tarefas (vê e conclui as tarefas atribuídas a ele). Quem já montava
--    escalas, o titular e o escritório passam a gerenciar; colaboradores
--    passam a poder fazer as próprias tarefas (nada aparece até atribuírem).
-- Tudo pelas funções abaixo; as tabelas são só lidas diretamente.
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

-- Gerenciar a equipe e as tarefas implica fazer as próprias tarefas.
select pg_temp.trocar_no_corpo('app.tg_validar_membro()',
$a$  if 'escalas.gerenciar' = any(new.permissoes) and not ('escalas.ver' = any(new.permissoes)) then$a$,
$a$  if 'rh.gerenciar' = any(new.permissoes) and not ('rh.tarefas' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'rh.tarefas');
  end if;
  if 'escalas.gerenciar' = any(new.permissoes) and not ('escalas.ver' = any(new.permissoes)) then$a$);

-- Acessos existentes: quem montava escalas (e o cadastro dos funcionários), o
-- titular e o escritório gerenciam; colaboradores fazem as próprias tarefas.
update public.empresa_membros
   set permissoes = permissoes || array['rh.gerenciar', 'rh.tarefas']
 where (papel in ('equipe', 'cliente_titular') or 'escalas.gerenciar' = any(permissoes))
   and not ('rh.gerenciar' = any(permissoes));
update public.empresa_membros
   set permissoes = permissoes || array['rh.tarefas']
 where papel = 'cliente_colaborador' and cardinality(permissoes) > 0 and not ('rh.tarefas' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['rh.gerenciar', 'rh.tarefas']
 where status = 'pendente' and cardinality(permissoes) > 0
   and (papel in ('equipe', 'cliente_titular') or 'escalas.gerenciar' = any(permissoes))
   and not ('rh.gerenciar' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['rh.tarefas']
 where status = 'pendente' and papel = 'cliente_colaborador' and cardinality(permissoes) > 0
   and not ('rh.tarefas' = any(permissoes));

-- -----------------------------------------------------------------------------
-- 2. Cargos e funcionário ligado ao acesso do portal
-- -----------------------------------------------------------------------------
create table public.rh_cargos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  descricao text check (descricao is null or length(descricao) <= 2000),
  ativo boolean not null default true,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rh_cargos_empresa_id_unico unique (empresa_id, id)
);
create unique index rh_cargos_nome_uk on public.rh_cargos (empresa_id, lower(nome));
create trigger rh_cargos_updated_at before update on public.rh_cargos for each row execute function app.tg_updated_at();
create trigger auditoria_rh_cargos after insert or update or delete on public.rh_cargos for each row execute function app.tg_auditoria();

alter table public.escala_funcionarios
  add column cargo_id uuid,
  add column usuario_id uuid references public.perfis(id) on delete set null,
  add constraint escala_funcionarios_empresa_id_unico unique (empresa_id, id),
  add constraint escala_funcionarios_cargo_fk foreign key (empresa_id, cargo_id) references public.rh_cargos (empresa_id, id) on delete set null (cargo_id);
create unique index escala_funcionarios_usuario_uk on public.escala_funcionarios (empresa_id, usuario_id) where usuario_id is not null;
create index escala_funcionarios_cargo_idx on public.escala_funcionarios (cargo_id) where cargo_id is not null;

-- Os cargos escritos no cadastro viram cargos (um por nome, sem diferenciar maiúsculas)
insert into public.rh_cargos (empresa_id, nome, criado_por)
select empresa_id, min(trim(cargo)), null
  from public.escala_funcionarios
 where length(trim(coalesce(cargo, ''))) >= 2
 group by empresa_id, lower(trim(cargo))
on conflict do nothing;
update public.escala_funcionarios f
   set cargo_id = c.id
  from public.rh_cargos c
 where c.empresa_id = f.empresa_id and lower(c.nome) = lower(trim(f.cargo)) and f.cargo_id is null;

-- Cargo escolhido: o nome vai para o campo de texto (a escala copia o nome do cargo);
-- o acesso ao portal só pode ser de alguém que entra na empresa.
create or replace function app.tg_funcionario_rh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cargo_id is not null then
    select nome into new.cargo from public.rh_cargos where id = new.cargo_id and empresa_id = new.empresa_id;
  end if;
  if new.usuario_id is not null
     and (tg_op = 'INSERT' or new.usuario_id is distinct from old.usuario_id)
     and not exists (select 1 from public.empresa_membros m
                      where m.empresa_id = new.empresa_id and m.user_id = new.usuario_id and m.ativo) then
    raise exception 'O acesso escolhido não é de alguém que entra nesta empresa.';
  end if;
  return new;
end;
$$;
create trigger escala_funcionarios_rh before insert or update on public.escala_funcionarios
  for each row execute function app.tg_funcionario_rh();

-- Renomear o cargo atualiza o nome nos funcionários
create or replace function app.tg_cargo_renomeado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nome is distinct from old.nome then
    update public.escala_funcionarios set cargo = new.nome where cargo_id = new.id;
  end if;
  return new;
end;
$$;
create trigger rh_cargos_renomeado after update of nome on public.rh_cargos
  for each row execute function app.tg_cargo_renomeado();

-- Quem gerencia escalas ou a equipe cuida do cadastro; cada um lê o próprio cadastro.
drop policy escala_funcionarios_leitura on public.escala_funcionarios;
drop policy escala_funcionarios_escrita on public.escala_funcionarios;
create policy escala_funcionarios_leitura on public.escala_funcionarios for select to authenticated
  using ((select app.pode(empresa_id, 'escalas.gerenciar')) or (select app.pode(empresa_id, 'rh.gerenciar'))
         or (usuario_id = (select auth.uid()) and (select app.pode(empresa_id, 'rh.tarefas'))));
create policy escala_funcionarios_escrita on public.escala_funcionarios for all to authenticated
  using ((select app.pode(empresa_id, 'escalas.gerenciar')) or (select app.pode(empresa_id, 'rh.gerenciar')))
  with check ((select app.pode(empresa_id, 'escalas.gerenciar')) or (select app.pode(empresa_id, 'rh.gerenciar')));

-- -----------------------------------------------------------------------------
-- 3. Modelos de tarefa e ocorrências
-- -----------------------------------------------------------------------------
create table public.rh_tarefa_modelos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 2 and 120),
  descricao text check (descricao is null or length(descricao) <= 2000),
  cargo_id uuid,
  responsavel_id uuid,
  periodicidade text not null check (periodicidade in ('diaria', 'semanal', 'quinzenal', 'mensal')),
  -- Diária: dias da semana em que acontece (1 = segunda ... 7 = domingo)
  dias_semana smallint[] not null default '{1,2,3,4,5,6}'
    check (cardinality(dias_semana) between 1 and 7 and dias_semana <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- Semanal: dia do prazo dentro da semana (1 = segunda ... 7 = domingo)
  dia_semana smallint not null default 5 check (dia_semana between 1 and 7),
  -- Mensal: dia do prazo (31 = último dia do mês)
  dia_mes smallint not null default 5 check (dia_mes between 1 and 31),
  hora_limite time not null default '18:00',
  -- Como conclui: manual (com as exigências abaixo) ou pelo registro do sistema
  regra text not null default 'manual'
    check (regra in ('manual', 'envio_extrato', 'fechamento_caixa', 'conciliacao_semanal', 'conferencia_estoque')),
  exige_foto boolean not null default false,
  exige_area boolean not null default false,
  exige_semana boolean not null default false,
  -- Fechamento do caixa: nome do caixa (vazio = todos os caixas do dia);
  -- conciliação: conta (vazio = todas as contas)
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object' and pg_column_size(parametros) < 2000),
  depende_de_id uuid,
  -- Rotina inicial criada pelo portal (para não criar duas vezes)
  chave_rotina text check (chave_rotina is null or chave_rotina ~ '^[a-z_]{3,40}$'),
  ativo boolean not null default true,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rh_tarefa_modelos_empresa_id_unico unique (empresa_id, id),
  constraint rh_tarefa_modelos_dependencia check (depende_de_id is distinct from id),
  foreign key (empresa_id, cargo_id) references public.rh_cargos (empresa_id, id) on delete set null (cargo_id),
  foreign key (empresa_id, responsavel_id) references public.escala_funcionarios (empresa_id, id) on delete set null (responsavel_id),
  foreign key (empresa_id, depende_de_id) references public.rh_tarefa_modelos (empresa_id, id) on delete set null (depende_de_id)
);
create unique index rh_tarefa_modelos_rotina_uk on public.rh_tarefa_modelos (empresa_id, chave_rotina) where chave_rotina is not null;
create index rh_tarefa_modelos_empresa_idx on public.rh_tarefa_modelos (empresa_id, ativo);
create index rh_tarefa_modelos_cargo_idx on public.rh_tarefa_modelos (cargo_id) where cargo_id is not null;
create trigger rh_tarefa_modelos_updated_at before update on public.rh_tarefa_modelos for each row execute function app.tg_updated_at();
create trigger auditoria_rh_tarefa_modelos after insert or update or delete on public.rh_tarefa_modelos for each row execute function app.tg_auditoria();

create table public.rh_tarefas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  modelo_id uuid not null,
  titulo text not null check (length(trim(titulo)) between 2 and 120),
  periodicidade text not null check (periodicidade in ('diaria', 'semanal', 'quinzenal', 'mensal')),
  periodo_inicio date not null,
  periodo_fim date not null,
  prazo timestamptz not null,
  responsavel_id uuid,
  status text not null default 'a_fazer' check (status in ('a_fazer', 'em_andamento', 'concluida')),
  ordem double precision not null default 0,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  concluida_por uuid references public.perfis(id) on delete set null,
  origem_conclusao text check (origem_conclusao in ('manual', 'automatica')),
  -- Registro do sistema confere, mas falta concluir a tarefa de que esta depende
  conclusao_pendente boolean not null default false,
  area text check (area is null or length(trim(area)) between 2 and 120),
  semana_referencia date check (semana_referencia is null or extract(isodow from semana_referencia) = 1),
  observacao text check (observacao is null or length(observacao) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rh_tarefas_empresa_id_unico unique (empresa_id, id),
  -- Uma ocorrência por modelo e período: gerar de novo não duplica
  constraint rh_tarefas_periodo_uk unique (modelo_id, periodo_inicio),
  constraint rh_tarefas_periodo check (periodo_fim >= periodo_inicio),
  constraint rh_tarefas_conclusao check ((status = 'concluida') = (concluida_em is not null and origem_conclusao is not null)),
  foreign key (empresa_id, modelo_id) references public.rh_tarefa_modelos (empresa_id, id) on delete cascade,
  foreign key (empresa_id, responsavel_id) references public.escala_funcionarios (empresa_id, id) on delete set null (responsavel_id)
);
create index rh_tarefas_quadro_idx on public.rh_tarefas (empresa_id, status, prazo);
create index rh_tarefas_responsavel_idx on public.rh_tarefas (responsavel_id) where responsavel_id is not null;
create trigger rh_tarefas_updated_at before update on public.rh_tarefas for each row execute function app.tg_updated_at();
create trigger auditoria_rh_tarefas after insert or update or delete on public.rh_tarefas for each row execute function app.tg_auditoria();

create table public.rh_tarefa_dependencias (
  empresa_id uuid not null,
  tarefa_id uuid not null,
  depende_de_id uuid not null,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (tarefa_id, depende_de_id),
  constraint rh_tarefa_dependencias_diferentes check (tarefa_id <> depende_de_id),
  foreign key (empresa_id, tarefa_id) references public.rh_tarefas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, depende_de_id) references public.rh_tarefas (empresa_id, id) on delete cascade
);
create index rh_tarefa_dependencias_de_idx on public.rh_tarefa_dependencias (depende_de_id);

create table public.rh_tarefa_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null,
  tarefa_id uuid not null,
  tipo text not null check (tipo in ('criada', 'atribuida', 'status', 'concluida', 'evidencia', 'vinculo', 'sugestao',
                                     'sugestao_confirmada', 'sugestao_recusada', 'dependencia', 'aguardando')),
  origem text not null default 'manual' check (origem in ('manual', 'automatica', 'sistema')),
  detalhe text check (detalhe is null or length(detalhe) <= 500),
  usuario uuid references public.perfis(id) on delete set null default auth.uid(),
  em timestamptz not null default now(),
  foreign key (empresa_id, tarefa_id) references public.rh_tarefas (empresa_id, id) on delete cascade
);
create index rh_tarefa_eventos_tarefa_idx on public.rh_tarefa_eventos (tarefa_id, em);

-- Vínculo com o registro do sistema (confirmado, ou sugerido esperando uma pessoa)
create table public.rh_tarefa_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  tarefa_id uuid not null,
  tipo text not null check (tipo in ('caixa_sessao', 'conciliacao_semana', 'estoque_conferencia', 'documento')),
  registro_id uuid,
  descricao text not null check (length(descricao) between 2 and 300),
  detalhe jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhe) = 'object' and pg_column_size(detalhe) < 20000),
  situacao text not null default 'confirmado' check (situacao in ('confirmado', 'sugerido', 'recusado')),
  origem text not null default 'automatica' check (origem in ('automatica', 'manual')),
  ia_recomendado boolean not null default false,
  ia_explicacao text check (ia_explicacao is null or length(ia_explicacao) <= 600),
  criado_em timestamptz not null default now(),
  decidido_por uuid references public.perfis(id) on delete set null,
  decidido_em timestamptz,
  foreign key (empresa_id, tarefa_id) references public.rh_tarefas (empresa_id, id) on delete cascade
);
create unique index rh_tarefa_vinculos_registro_uk on public.rh_tarefa_vinculos (tarefa_id, tipo, registro_id) where registro_id is not null;
create unique index rh_tarefa_vinculos_semana_uk on public.rh_tarefa_vinculos (tarefa_id, tipo) where registro_id is null;
create index rh_tarefa_vinculos_registro_idx on public.rh_tarefa_vinculos (tipo, registro_id) where registro_id is not null;
create trigger auditoria_rh_tarefa_vinculos after insert or update or delete on public.rh_tarefa_vinculos for each row execute function app.tg_auditoria();

-- Conferência do estoque (botão "Confirmar conferência")
create table public.estoque_conferencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conferido_por uuid not null references public.perfis(id) on delete restrict default auth.uid(),
  conferido_em timestamptz not null default now(),
  observacao text check (observacao is null or length(observacao) <= 500),
  tarefa_id uuid,
  foreign key (empresa_id, tarefa_id) references public.rh_tarefas (empresa_id, id) on delete set null (tarefa_id)
);
create index estoque_conferencias_empresa_idx on public.estoque_conferencias (empresa_id, conferido_em desc);
create trigger auditoria_estoque_conferencias after insert or update or delete on public.estoque_conferencias for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 4. Evidências (armazenamento privado: "<empresa>/<tarefa>/<id>.<ext>")
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rh-evidencias', 'rh-evidencias', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create table public.rh_tarefa_evidencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  tarefa_id uuid not null,
  caminho text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  tamanho bigint not null check (tamanho > 0 and tamanho <= 10485760),
  legenda text check (legenda is null or length(legenda) <= 200),
  enviado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  confirmado_em timestamptz,
  constraint rh_tarefa_evidencias_na_pasta check (caminho like empresa_id::text || '/' || tarefa_id::text || '/%'),
  foreign key (empresa_id, tarefa_id) references public.rh_tarefas (empresa_id, id) on delete cascade
);
create index rh_tarefa_evidencias_tarefa_idx on public.rh_tarefa_evidencias (tarefa_id, created_at);
create trigger auditoria_rh_tarefa_evidencias after insert or update or delete on public.rh_tarefa_evidencias for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 5. Quem vê e quem mexe
-- -----------------------------------------------------------------------------
-- Funcionários (cadastros) ligados ao usuário logado nesta empresa
create or replace function app.rh_meus_funcionarios(p_empresa_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(f.id), array[]::uuid[])
    from public.escala_funcionarios f
   where f.empresa_id = p_empresa_id and f.usuario_id = auth.uid() and auth.uid() is not null;
$$;

create or replace function app.rh_pode_tarefa(p_empresa_id uuid, p_responsavel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.pode(p_empresa_id, 'rh.gerenciar')
      or (p_responsavel_id is not null and app.pode(p_empresa_id, 'rh.tarefas')
          and p_responsavel_id = any(app.rh_meus_funcionarios(p_empresa_id)));
$$;

create or replace function app.rh_pode_ver_tarefa(p_tarefa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rh_tarefas t where t.id = p_tarefa_id and app.rh_pode_tarefa(t.empresa_id, t.responsavel_id));
$$;

-- Confere a permissão (com a ferramenta da equipe ligada na empresa)
create or replace function app.rh_exigir(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, p_permissao);
  if exists (select 1 from public.empresas e where e.id = p_empresa_id and 'escalas' = any(e.ferramentas_desligadas)) then
    raise exception 'A Gestão de RH está desligada para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

alter table public.rh_cargos enable row level security;
alter table public.rh_tarefa_modelos enable row level security;
alter table public.rh_tarefas enable row level security;
alter table public.rh_tarefa_dependencias enable row level security;
alter table public.rh_tarefa_eventos enable row level security;
alter table public.rh_tarefa_vinculos enable row level security;
alter table public.rh_tarefa_evidencias enable row level security;
alter table public.estoque_conferencias enable row level security;

create policy rh_cargos_leitura on public.rh_cargos for select to authenticated
  using ((select app.pode(empresa_id, 'rh.gerenciar')) or (select app.pode(empresa_id, 'escalas.gerenciar')) or (select app.pode(empresa_id, 'rh.tarefas')));
create policy rh_tarefa_modelos_leitura on public.rh_tarefa_modelos for select to authenticated
  using ((select app.pode(empresa_id, 'rh.gerenciar')) or (select app.pode(empresa_id, 'rh.tarefas')));
create policy rh_tarefas_leitura on public.rh_tarefas for select to authenticated
  using ((select app.pode(empresa_id, 'rh.gerenciar'))
         or ((select app.pode(empresa_id, 'rh.tarefas')) and responsavel_id = any(app.rh_meus_funcionarios(empresa_id))));
create policy rh_tarefa_dependencias_leitura on public.rh_tarefa_dependencias for select to authenticated
  using ((select app.rh_pode_ver_tarefa(tarefa_id)));
create policy rh_tarefa_eventos_leitura on public.rh_tarefa_eventos for select to authenticated
  using ((select app.rh_pode_ver_tarefa(tarefa_id)));
create policy rh_tarefa_vinculos_leitura on public.rh_tarefa_vinculos for select to authenticated
  using ((select app.rh_pode_ver_tarefa(tarefa_id)));
create policy rh_tarefa_evidencias_leitura on public.rh_tarefa_evidencias for select to authenticated
  using ((select app.rh_pode_ver_tarefa(tarefa_id)));
create policy estoque_conferencias_leitura on public.estoque_conferencias for select to authenticated
  using ((select app.pode(empresa_id, 'rh.gerenciar')) or (select app.pode(empresa_id, 'gestao.gerenciar')) or conferido_por = (select auth.uid()));

create policy rh_evidencias_leitura on storage.objects for select to authenticated
  using (bucket_id = 'rh-evidencias'
         and split_part(name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and app.rh_pode_ver_tarefa(split_part(name, '/', 2)::uuid));

revoke all on public.rh_cargos, public.rh_tarefa_modelos, public.rh_tarefas, public.rh_tarefa_dependencias, public.rh_tarefa_eventos,
  public.rh_tarefa_vinculos, public.rh_tarefa_evidencias, public.estoque_conferencias from anon, authenticated;
grant select on public.rh_cargos, public.rh_tarefa_modelos, public.rh_tarefas, public.rh_tarefa_dependencias, public.rh_tarefa_eventos,
  public.rh_tarefa_vinculos, public.rh_tarefa_evidencias, public.estoque_conferencias to authenticated;
grant select, insert, update, delete on public.rh_cargos, public.rh_tarefa_modelos, public.rh_tarefas, public.rh_tarefa_dependencias,
  public.rh_tarefa_eventos, public.rh_tarefa_vinculos, public.rh_tarefa_evidencias, public.estoque_conferencias to service_role;

-- -----------------------------------------------------------------------------
-- 6. Calendário: período, prazo e geração (sem duplicar)
-- -----------------------------------------------------------------------------
create or replace function app.rh_semana(p_data date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_data - (extract(isodow from p_data)::int - 1);
$$;

-- Período que contém a data
create or replace function app.rh_periodo(p_periodicidade text, p_data date, out inicio date, out fim date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mes date := date_trunc('month', p_data)::date;
begin
  case p_periodicidade
    when 'diaria' then inicio := p_data; fim := p_data;
    when 'semanal' then inicio := app.rh_semana(p_data); fim := inicio + 6;
    when 'quinzenal' then
      if extract(day from p_data) <= 15 then inicio := v_mes; fim := v_mes + 14;
      else inicio := v_mes + 15; fim := (v_mes + interval '1 month' - interval '1 day')::date; end if;
    when 'mensal' then inicio := v_mes; fim := (v_mes + interval '1 month' - interval '1 day')::date;
    else raise exception 'Periodicidade inválida.';
  end case;
end;
$$;

-- Prazo da ocorrência (no fuso do escritório)
create or replace function app.rh_prazo(m public.rh_tarefa_modelos, p_inicio date, p_fim date)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dia date;
begin
  v_dia := case m.periodicidade
    when 'diaria' then p_inicio
    when 'semanal' then p_inicio + (m.dia_semana - 1)
    when 'quinzenal' then p_fim
    else least(make_date(extract(year from p_inicio)::int, extract(month from p_inicio)::int, 1) + (m.dia_mes - 1), p_fim)
  end;
  return (v_dia + m.hora_limite) at time zone 'America/Araguaina';
end;
$$;

create or replace function app.rh_evento(p_empresa_id uuid, p_tarefa_id uuid, p_tipo text, p_origem text, p_detalhe text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rh_tarefa_eventos (empresa_id, tarefa_id, tipo, origem, detalhe)
  values (p_empresa_id, p_tarefa_id, p_tipo, p_origem, left(p_detalhe, 500));
$$;

-- Ocorrência do período que contém a data (cria se não existir; null quando a
-- rotina diária não acontece nesse dia da semana). Rodar de novo devolve a mesma.
create or replace function app.rh_gerar(p_modelo_id uuid, p_data date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.rh_tarefa_modelos;
  v_inicio date;
  v_fim date;
  v_id uuid;
  v_resp uuid;
  v_dep uuid;
begin
  select * into m from public.rh_tarefa_modelos where id = p_modelo_id;
  if m.id is null or not m.ativo or p_data is null then
    return null;
  end if;
  if m.periodicidade = 'diaria' and not (extract(isodow from p_data)::smallint = any(m.dias_semana)) then
    return null;
  end if;
  select inicio, fim into v_inicio, v_fim from app.rh_periodo(m.periodicidade, p_data);
  select id into v_id from public.rh_tarefas where modelo_id = m.id and periodo_inicio = v_inicio;
  if v_id is not null then
    return v_id;
  end if;
  -- Responsável: o do modelo; senão, o único funcionário ativo do cargo
  select f.id into v_resp from public.escala_funcionarios f where f.id = m.responsavel_id and f.ativo;
  if v_resp is null and m.cargo_id is not null then
    select (array_agg(f.id))[1] into v_resp
      from public.escala_funcionarios f
     where f.empresa_id = m.empresa_id and f.cargo_id = m.cargo_id and f.ativo
    having count(*) = 1;
  end if;
  insert into public.rh_tarefas (empresa_id, modelo_id, titulo, periodicidade, periodo_inicio, periodo_fim, prazo, responsavel_id, ordem)
  values (m.empresa_id, m.id, m.titulo, m.periodicidade, v_inicio, v_fim, app.rh_prazo(m, v_inicio, v_fim), v_resp,
          extract(epoch from app.rh_prazo(m, v_inicio, v_fim)))
  on conflict (modelo_id, periodo_inicio) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.rh_tarefas where modelo_id = m.id and periodo_inicio = v_inicio;
    return v_id;
  end if;
  perform app.rh_evento(m.empresa_id, v_id, 'criada', 'sistema', 'Tarefa do período criada pela rotina');
  -- Depende da tarefa do mesmo período do modelo indicado
  if m.depende_de_id is not null then
    v_dep := app.rh_gerar(m.depende_de_id, v_inicio);
    if v_dep is not null then
      insert into public.rh_tarefa_dependencias (empresa_id, tarefa_id, depende_de_id, criado_por)
      values (m.empresa_id, v_id, v_dep, null)
      on conflict do nothing;
    end if;
  end if;
  return v_id;
end;
$$;

-- Próxima ocorrência depois do período (na diária, o próximo dia em que acontece)
create or replace function app.rh_gerar_proxima(p_tarefa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  v_data date;
  v_id uuid;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id;
  if t.id is null then
    return null;
  end if;
  v_data := t.periodo_fim + 1;
  for i in 1..7 loop
    v_id := app.rh_gerar(t.modelo_id, v_data);
    exit when v_id is not null or t.periodicidade <> 'diaria';
    v_data := v_data + 1;
  end loop;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Conclusão (comum à manual e à automática)
-- -----------------------------------------------------------------------------
create or replace function app.rh_dependencias_abertas(p_tarefa_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(d.titulo || ' (' || to_char(d.periodo_inicio, 'DD/MM') || ')', ', ' order by d.prazo)
    from public.rh_tarefa_dependencias x
    join public.rh_tarefas d on d.id = x.depende_de_id
   where x.tarefa_id = p_tarefa_id and d.status <> 'concluida';
$$;

-- Conclui a tarefa; devolve false (e deixa aguardando) se falta concluir uma
-- tarefa de que ela depende. Já concluída: não muda nada.
create or replace function app.rh_concluir(p_tarefa_id uuid, p_origem text, p_detalhe text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  v_abertas text;
  r record;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id for update;
  if t.id is null or t.status = 'concluida' then
    return t.id is not null;
  end if;
  v_abertas := app.rh_dependencias_abertas(t.id);
  if v_abertas is not null then
    if p_origem = 'manual' then
      raise exception 'Conclua antes: %.', v_abertas;
    end if;
    if not t.conclusao_pendente then
      update public.rh_tarefas set conclusao_pendente = true, status = 'em_andamento', iniciada_em = coalesce(iniciada_em, now()) where id = t.id;
      perform app.rh_evento(t.empresa_id, t.id, 'aguardando', p_origem, 'Registro conferido; aguardando: ' || v_abertas);
    end if;
    return false;
  end if;
  update public.rh_tarefas
     set status = 'concluida', concluida_em = now(), concluida_por = auth.uid(), origem_conclusao = p_origem,
         conclusao_pendente = false, iniciada_em = coalesce(iniciada_em, now())
   where id = t.id;
  perform app.rh_evento(t.empresa_id, t.id, 'concluida', p_origem, p_detalhe);
  perform app.rh_gerar_proxima(t.id);
  -- Tarefas que esperavam por esta e já tinham o registro conferido
  for r in
    select x.tarefa_id from public.rh_tarefa_dependencias x
      join public.rh_tarefas d on d.id = x.tarefa_id
     where x.depende_de_id = t.id and d.conclusao_pendente and d.status <> 'concluida'
  loop
    perform app.rh_concluir(r.tarefa_id, 'automatica', 'Concluída pelo registro do sistema depois da etapa anterior');
  end loop;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Conclusão automática pelos registros do sistema
-- -----------------------------------------------------------------------------
-- Liga a tarefa ao registro (sem duplicar); devolve true se o vínculo é novo
create or replace function app.rh_vincular(p_tarefa_id uuid, p_tipo text, p_registro_id uuid, p_descricao text, p_detalhe jsonb, p_situacao text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  v_n int;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id;
  if p_registro_id is null then
    insert into public.rh_tarefa_vinculos (empresa_id, tarefa_id, tipo, registro_id, descricao, detalhe, situacao, origem, decidido_em)
    values (t.empresa_id, t.id, p_tipo, null, left(p_descricao, 300), coalesce(p_detalhe, '{}'), p_situacao, 'automatica',
            case when p_situacao = 'confirmado' then now() end)
    on conflict (tarefa_id, tipo) where registro_id is null
    do update set descricao = excluded.descricao, detalhe = excluded.detalhe
    where rh_tarefa_vinculos.situacao <> 'confirmado';
  else
    insert into public.rh_tarefa_vinculos (empresa_id, tarefa_id, tipo, registro_id, descricao, detalhe, situacao, origem, decidido_em)
    values (t.empresa_id, t.id, p_tipo, p_registro_id, left(p_descricao, 300), coalesce(p_detalhe, '{}'), p_situacao, 'automatica',
            case when p_situacao = 'confirmado' then now() end)
    on conflict (tarefa_id, tipo, registro_id) where registro_id is not null do nothing;
  end if;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app.rh_evento(t.empresa_id, t.id, case when p_situacao = 'sugerido' then 'sugestao' else 'vinculo' end, 'automatica',
      case when p_situacao = 'sugerido' then 'Registro para confirmar: ' else 'Ligada ao registro: ' end || p_descricao);
  end if;
  return v_n > 0;
end;
$$;

-- Fechamento do caixa: a tarefa diária do dia do caixa conclui quando os caixas
-- daquele dia (ou o caixa escolhido no modelo) estão fechados. Sem tarefa para o
-- dia (ex.: domingo fora da rotina), sugere as tarefas abertas próximas.
create or replace function app.rh_avaliar_caixa(p_empresa_id uuid, p_data date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.rh_tarefa_modelos;
  s record;
  c record;
  v_tarefa uuid;
  v_caixa text;
  v_abertos int;
  v_fechados int;
  v_concluidas int := 0;
begin
  for m in
    select * from public.rh_tarefa_modelos
     where empresa_id = p_empresa_id and ativo and regra = 'fechamento_caixa'
  loop
    v_caixa := nullif(trim(m.parametros ->> 'caixa_nome'), '');
    select count(*) filter (where status = 'aberto'), count(*) filter (where status = 'fechado')
      into v_abertos, v_fechados
      from public.caixa_sessoes
     where empresa_id = p_empresa_id and data = p_data and (v_caixa is null or lower(caixa_nome) = lower(v_caixa));
    continue when v_fechados = 0;
    v_tarefa := app.rh_gerar(m.id, p_data);
    if v_tarefa is null then
      -- Dia fora da rotina: sugere as tarefas abertas de até 3 dias antes ou do dia seguinte
      for c in
        select t.id from public.rh_tarefas t
         where t.modelo_id = m.id and t.status <> 'concluida' and t.periodo_inicio between p_data - 3 and p_data + 1
      loop
        for s in
          select cs.id, cs.caixa_nome, cs.fechado_em from public.caixa_sessoes cs
           where cs.empresa_id = p_empresa_id and cs.data = p_data and cs.status = 'fechado'
             and (v_caixa is null or lower(cs.caixa_nome) = lower(v_caixa))
        loop
          perform app.rh_vincular(c.id, 'caixa_sessao', s.id,
            s.caixa_nome || ' de ' || to_char(p_data, 'DD/MM/YYYY') || ', fechado em ' || to_char(s.fechado_em at time zone 'America/Araguaina', 'DD/MM HH24:MI'),
            jsonb_build_object('data', p_data, 'caixa', s.caixa_nome), 'sugerido');
        end loop;
      end loop;
      continue;
    end if;
    for s in
      select cs.id, cs.caixa_nome, cs.fechado_em, cs.diferenca, p.nome as quem
        from public.caixa_sessoes cs
        left join public.perfis p on p.id = cs.fechado_por
       where cs.empresa_id = p_empresa_id and cs.data = p_data and cs.status = 'fechado'
         and (v_caixa is null or lower(cs.caixa_nome) = lower(v_caixa))
    loop
      perform app.rh_vincular(v_tarefa, 'caixa_sessao', s.id,
        s.caixa_nome || ' fechado em ' || to_char(s.fechado_em at time zone 'America/Araguaina', 'DD/MM/YYYY HH24:MI') || coalesce(' por ' || s.quem, ''),
        jsonb_build_object('data', p_data, 'caixa', s.caixa_nome, 'diferenca', s.diferenca), 'confirmado');
    end loop;
    if v_abertos = 0 then
      if app.rh_concluir(v_tarefa, 'automatica', 'Concluída pelo fechamento do caixa de ' || to_char(p_data, 'DD/MM/YYYY')) then
        v_concluidas := v_concluidas + 1;
      end if;
    end if;
  end loop;
  return v_concluidas;
end;
$$;

create or replace function app.tg_caixa_fechado_rh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A rotina do RH nunca impede o fechamento do caixa
  begin
    perform app.rh_avaliar_caixa(new.empresa_id, new.data);
  exception when others then
    raise warning 'Gestão de RH: não foi possível avaliar o fechamento do caixa %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
create trigger caixa_sessoes_rh after update of status on public.caixa_sessoes
  for each row when (old.status = 'aberto' and new.status = 'fechado')
  execute function app.tg_caixa_fechado_rh();

-- Conciliação da semana: conclui quando TODOS os movimentos do extrato da
-- semana (fora os ignorados) estão conciliados. Antes disso, nada conclui.
create or replace function app.rh_avaliar_conciliacao(p_empresa_id uuid, p_semana date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.rh_tarefa_modelos;
  v_tarefa uuid;
  v_conta uuid;
  v_total int;
  v_pendentes int;
  v_conciliacoes jsonb;
  v_concluidas int := 0;
begin
  for m in
    select * from public.rh_tarefa_modelos
     where empresa_id = p_empresa_id and ativo and regra = 'conciliacao_semanal'
  loop
    v_conta := case when (m.parametros ->> 'conta_financeira_id') ~ '^[0-9a-f-]{36}$' then (m.parametros ->> 'conta_financeira_id')::uuid end;
    select count(*) filter (where mb.status_conciliacao <> 'ignorado'), count(*) filter (where mb.status_conciliacao = 'pendente')
      into v_total, v_pendentes
      from public.movimentos_bancarios mb
     where mb.empresa_id = p_empresa_id and mb.data between p_semana and p_semana + 6
       and (v_conta is null or mb.conta_financeira_id = v_conta);
    continue when v_total = 0 or v_pendentes > 0;
    v_tarefa := app.rh_gerar(m.id, p_semana);
    continue when v_tarefa is null;
    select coalesce(jsonb_agg(distinct ci.conciliacao_id), '[]'::jsonb) into v_conciliacoes
      from public.movimentos_bancarios mb
      join public.conciliacao_itens ci on ci.movimento_id = mb.id and ci.ativo
     where mb.empresa_id = p_empresa_id and mb.data between p_semana and p_semana + 6
       and (v_conta is null or mb.conta_financeira_id = v_conta);
    perform app.rh_vincular(v_tarefa, 'conciliacao_semana', null,
      'Conciliação da semana de ' || to_char(p_semana, 'DD/MM') || ' a ' || to_char(p_semana + 6, 'DD/MM/YYYY') || ': ' || v_total || ' movimento(s) do extrato resolvido(s)',
      jsonb_build_object('semana', p_semana, 'movimentos', v_total, 'conciliacoes', v_conciliacoes, 'conta_financeira_id', v_conta), 'confirmado');
    if app.rh_concluir(v_tarefa, 'automatica', 'Concluída: todos os movimentos do extrato da semana conciliados') then
      v_concluidas := v_concluidas + 1;
    end if;
  end loop;
  return v_concluidas;
end;
$$;

create or replace function app.tg_movimentos_conciliados_rh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  begin
    for r in
      select distinct n.empresa_id, app.rh_semana(n.data) as semana
        from novos n join antigos a on a.id = n.id
       where a.status_conciliacao is distinct from n.status_conciliacao and n.status_conciliacao <> 'pendente'
         and exists (select 1 from public.rh_tarefa_modelos m where m.empresa_id = n.empresa_id and m.ativo and m.regra = 'conciliacao_semanal')
    loop
      perform app.rh_avaliar_conciliacao(r.empresa_id, r.semana);
    end loop;
  exception when others then
    raise warning 'Gestão de RH: não foi possível avaliar a conciliação: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger movimentos_bancarios_rh after update on public.movimentos_bancarios
  referencing old table as antigos new table as novos
  for each statement execute function app.tg_movimentos_conciliados_rh();

-- Progresso da conciliação por semana (para os cartões)
create or replace function public.rh_conciliacao_progresso(p_empresa_id uuid, p_semanas date[])
returns table (semana date, total int, pendentes int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.pode(p_empresa_id, 'rh.gerenciar') or app.pode(p_empresa_id, 'rh.tarefas')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return query
  select s.semana,
         (select count(*)::int from public.movimentos_bancarios mb where mb.empresa_id = p_empresa_id and mb.data between s.semana and s.semana + 6 and mb.status_conciliacao <> 'ignorado'),
         (select count(*)::int from public.movimentos_bancarios mb where mb.empresa_id = p_empresa_id and mb.data between s.semana and s.semana + 6 and mb.status_conciliacao = 'pendente')
    from unnest(p_semanas[1:60]) as s(semana);
end;
$$;

-- Conferência do estoque: registra quem conferiu e quando e liga à tarefa do
-- período atual. Sem tarefa do período, mas com uma atrasada aberta, sugere.
create or replace function public.rh_confirmar_conferencia_estoque(p_empresa_id uuid, p_observacao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.rh_tarefa_modelos;
  v_conf uuid;
  v_tarefa uuid;
  v_t public.rh_tarefas;
  v_gestor boolean := app.pode(p_empresa_id, 'rh.gerenciar') or app.pode(p_empresa_id, 'gestao.gerenciar');
  v_quem text;
  v_resultado text := 'sem_tarefa';
  v_tarefa_final uuid;
  c record;
begin
  if not (v_gestor or app.pode(p_empresa_id, 'rh.tarefas')) then
    raise exception 'Acesso negado: você não pode confirmar a conferência do estoque nesta empresa.' using errcode = '42501';
  end if;
  -- Tarefa do período atual (a primeira rotina de conferência ativa)
  select * into m from public.rh_tarefa_modelos
   where empresa_id = p_empresa_id and ativo and regra = 'conferencia_estoque'
   order by created_at limit 1;
  if m.id is not null then
    v_tarefa := app.rh_gerar(m.id, app.hoje());
  end if;
  if v_tarefa is not null then
    select * into v_t from public.rh_tarefas where id = v_tarefa;
    if not v_gestor and not (v_t.responsavel_id = any(app.rh_meus_funcionarios(p_empresa_id))) then
      raise exception 'A conferência do estoque deste período não está atribuída a você.' using errcode = '42501';
    end if;
  elsif not v_gestor then
    raise exception 'Não há conferência do estoque atribuída a você agora.' using errcode = '42501';
  end if;
  select nome into v_quem from public.perfis where id = auth.uid();
  insert into public.estoque_conferencias (empresa_id, observacao, tarefa_id)
  values (p_empresa_id, nullif(left(trim(coalesce(p_observacao, '')), 500), ''), case when v_t.status is distinct from 'concluida' then v_tarefa end)
  returning id into v_conf;
  if v_tarefa is not null then
    if v_t.status = 'concluida' then
      v_resultado := 'ja_concluida';
    else
      perform app.rh_vincular(v_tarefa, 'estoque_conferencia', v_conf,
        'Conferência confirmada por ' || coalesce(v_quem, 'usuário') || ' em ' || to_char(now() at time zone 'America/Araguaina', 'DD/MM/YYYY HH24:MI'),
        jsonb_build_object('conferido_por', auth.uid()), 'confirmado');
      if app.rh_concluir(v_tarefa, 'automatica', 'Concluída pela conferência do estoque confirmada por ' || coalesce(v_quem, 'usuário')) then
        v_resultado := 'concluida';
      else
        v_resultado := 'aguardando';
      end if;
      v_tarefa_final := v_tarefa;
    end if;
  elsif m.id is not null then
    -- Hoje fora da rotina: sugere as tarefas abertas atrasadas
    for c in select t.id from public.rh_tarefas t where t.modelo_id = m.id and t.status <> 'concluida' and t.periodo_fim < app.hoje() order by t.periodo_inicio desc limit 3 loop
      perform app.rh_vincular(c.id, 'estoque_conferencia', v_conf,
        'Conferência confirmada por ' || coalesce(v_quem, 'usuário') || ' em ' || to_char(now() at time zone 'America/Araguaina', 'DD/MM/YYYY HH24:MI'),
        jsonb_build_object('conferido_por', auth.uid()), 'sugerido');
      v_resultado := 'sugerida';
    end loop;
  end if;
  return jsonb_build_object('conferencia_id', v_conf, 'tarefa_id', v_tarefa_final, 'situacao', v_resultado);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Sugestões: uma pessoa confirma ou recusa (a IA só indica)
-- -----------------------------------------------------------------------------
create or replace function public.rh_vinculo_confirmar(p_vinculo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rh_tarefa_vinculos;
  t public.rh_tarefas;
  r record;
begin
  select * into v from public.rh_tarefa_vinculos where id = p_vinculo_id for update;
  if v.id is null then
    raise exception 'Sugestão não encontrada.';
  end if;
  select * into t from public.rh_tarefas where id = v.tarefa_id;
  perform app.rh_exigir(t.empresa_id, 'rh.tarefas');
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado: esta tarefa não é sua.' using errcode = '42501';
  end if;
  if v.situacao <> 'sugerido' then
    raise exception 'Esta sugestão já foi decidida.';
  end if;
  if t.status = 'concluida' then
    raise exception 'Esta tarefa já está concluída.';
  end if;
  update public.rh_tarefa_vinculos set situacao = 'confirmado', origem = 'manual', decidido_por = auth.uid(), decidido_em = now() where id = v.id;
  -- O mesmo registro sugerido para outras tarefas fica recusado
  for r in
    update public.rh_tarefa_vinculos set situacao = 'recusado', decidido_por = auth.uid(), decidido_em = now()
     where tipo = v.tipo and registro_id = v.registro_id and situacao = 'sugerido' and id <> v.id
    returning empresa_id, tarefa_id
  loop
    perform app.rh_evento(r.empresa_id, r.tarefa_id, 'sugestao_recusada', 'manual', 'O registro foi ligado a outra tarefa');
  end loop;
  if v.tipo = 'estoque_conferencia' then
    update public.estoque_conferencias set tarefa_id = t.id where id = v.registro_id;
  end if;
  perform app.rh_evento(t.empresa_id, t.id, 'sugestao_confirmada', 'manual', 'Confirmado: ' || v.descricao);
  perform app.rh_concluir(t.id, 'automatica', 'Concluída pelo registro confirmado: ' || v.descricao);
end;
$$;

create or replace function public.rh_vinculo_recusar(p_vinculo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rh_tarefa_vinculos;
  t public.rh_tarefas;
begin
  select * into v from public.rh_tarefa_vinculos where id = p_vinculo_id for update;
  if v.id is null then
    raise exception 'Sugestão não encontrada.';
  end if;
  select * into t from public.rh_tarefas where id = v.tarefa_id;
  perform app.rh_exigir(t.empresa_id, 'rh.tarefas');
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado: esta tarefa não é sua.' using errcode = '42501';
  end if;
  if v.situacao <> 'sugerido' then
    raise exception 'Esta sugestão já foi decidida.';
  end if;
  update public.rh_tarefa_vinculos set situacao = 'recusado', decidido_por = auth.uid(), decidido_em = now() where id = v.id;
  perform app.rh_evento(t.empresa_id, t.id, 'sugestao_recusada', 'manual', 'Não é desta tarefa: ' || v.descricao);
end;
$$;

-- Guarda a indicação da IA (a mais provável entre as sugestões do mesmo registro)
create or replace function public.rh_vinculo_ia_registrar(p_vinculo_id uuid, p_explicacao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rh_tarefa_vinculos;
  t public.rh_tarefas;
begin
  select * into v from public.rh_tarefa_vinculos where id = p_vinculo_id;
  if v.id is null or v.situacao <> 'sugerido' then
    raise exception 'Sugestão não encontrada.';
  end if;
  select * into t from public.rh_tarefas where id = v.tarefa_id;
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  update public.rh_tarefa_vinculos set ia_recomendado = false, ia_explicacao = null
   where tipo = v.tipo and registro_id = v.registro_id and situacao = 'sugerido';
  update public.rh_tarefa_vinculos set ia_recomendado = true, ia_explicacao = left(trim(coalesce(p_explicacao, '')), 600) where id = v.id;
end;
$$;

-- Reprocessa um fechamento de caixa (gestor; não duplica nada)
create or replace function public.rh_reprocessar_caixa(p_sessao_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.caixa_sessoes;
begin
  select * into s from public.caixa_sessoes where id = p_sessao_id;
  if s.id is null then
    raise exception 'Caixa não encontrado.';
  end if;
  perform app.rh_exigir(s.empresa_id, 'rh.gerenciar');
  if s.status <> 'fechado' then
    raise exception 'O caixa ainda está aberto.';
  end if;
  return app.rh_avaliar_caixa(s.empresa_id, s.data);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Quadro: mover, atribuir, depender e concluir à mão
-- -----------------------------------------------------------------------------
create or replace function public.rh_tarefa_mover(p_tarefa_id uuid, p_status text, p_ordem double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id for update;
  if t.id is null then
    raise exception 'Tarefa não encontrada.';
  end if;
  perform app.rh_exigir(t.empresa_id, 'rh.tarefas');
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado: esta tarefa não é sua.' using errcode = '42501';
  end if;
  if t.status = 'concluida' then
    raise exception 'Tarefa concluída não volta: o registro do período fica guardado.';
  end if;
  if p_status not in ('a_fazer', 'em_andamento') then
    raise exception 'Para concluir, use o botão Concluir (ele pede o que a tarefa exige).';
  end if;
  update public.rh_tarefas
     set status = p_status, ordem = coalesce(p_ordem, ordem),
         iniciada_em = case when p_status = 'em_andamento' then coalesce(iniciada_em, now()) else iniciada_em end
   where id = t.id;
  if p_status is distinct from t.status then
    perform app.rh_evento(t.empresa_id, t.id, 'status', 'manual', case p_status when 'em_andamento' then 'Movida para Em andamento' else 'Movida para A fazer' end);
  end if;
end;
$$;

create or replace function public.rh_tarefa_atribuir(p_tarefa_id uuid, p_funcionario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  v_nome text;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id for update;
  if t.id is null then
    raise exception 'Tarefa não encontrada.';
  end if;
  perform app.rh_exigir(t.empresa_id, 'rh.gerenciar');
  if t.status = 'concluida' then
    raise exception 'Tarefa concluída não muda de responsável.';
  end if;
  if p_funcionario_id is not null then
    select nome into v_nome from public.escala_funcionarios where id = p_funcionario_id and empresa_id = t.empresa_id and ativo;
    if v_nome is null then
      raise exception 'Funcionário não encontrado (ou inativo).';
    end if;
  end if;
  update public.rh_tarefas set responsavel_id = p_funcionario_id where id = t.id;
  perform app.rh_evento(t.empresa_id, t.id, 'atribuida', 'manual', coalesce('Responsável: ' || v_nome, 'Sem responsável'));
end;
$$;

create or replace function public.rh_tarefa_dependencia(p_tarefa_id uuid, p_depende_de_id uuid, p_ligar boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  d public.rh_tarefas;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id;
  select * into d from public.rh_tarefas where id = p_depende_de_id;
  if t.id is null or d.id is null or d.empresa_id <> t.empresa_id then
    raise exception 'Tarefa não encontrada.';
  end if;
  perform app.rh_exigir(t.empresa_id, 'rh.gerenciar');
  if not p_ligar then
    delete from public.rh_tarefa_dependencias where tarefa_id = t.id and depende_de_id = d.id;
    if found then
      perform app.rh_evento(t.empresa_id, t.id, 'dependencia', 'manual', 'Não depende mais de: ' || d.titulo);
    end if;
    return;
  end if;
  if t.id = d.id then
    raise exception 'A tarefa não pode depender dela mesma.';
  end if;
  if t.status = 'concluida' then
    raise exception 'Tarefa concluída não ganha dependência.';
  end if;
  -- Sem ciclo: a outra tarefa não pode depender (direta ou indiretamente) desta
  if exists (
    with recursive cadeia(id) as (
      select x.depende_de_id from public.rh_tarefa_dependencias x where x.tarefa_id = d.id
      union
      select x.depende_de_id from public.rh_tarefa_dependencias x join cadeia c on x.tarefa_id = c.id
    )
    select 1 from cadeia where id = t.id
  ) then
    raise exception 'Não dá: "%" já depende desta tarefa.', d.titulo;
  end if;
  insert into public.rh_tarefa_dependencias (empresa_id, tarefa_id, depende_de_id) values (t.empresa_id, t.id, d.id) on conflict do nothing;
  if found then
    perform app.rh_evento(t.empresa_id, t.id, 'dependencia', 'manual', 'Depende de: ' || d.titulo || ' (' || to_char(d.periodo_inicio, 'DD/MM') || ')');
  end if;
end;
$$;

-- Conclusão manual: data, hora e quem está logado; exige foto, área e semana
-- quando o modelo pede; no envio do extrato, pode ligar o extrato enviado.
create or replace function public.rh_tarefa_concluir(p_tarefa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  m public.rh_tarefa_modelos;
  v_area text := nullif(left(trim(coalesce(p_dados ->> 'area', '')), 120), '');
  v_obs text := nullif(left(trim(coalesce(p_dados ->> 'observacao', '')), 1000), '');
  v_semana date;
  v_doc uuid;
  v_doc_nome text;
  v_detalhe text;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id for update;
  if t.id is null then
    raise exception 'Tarefa não encontrada.';
  end if;
  perform app.rh_exigir(t.empresa_id, 'rh.tarefas');
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado: esta tarefa não é sua.' using errcode = '42501';
  end if;
  if t.status = 'concluida' then
    raise exception 'Esta tarefa já está concluída.';
  end if;
  select * into m from public.rh_tarefa_modelos where id = t.modelo_id;
  if m.regra not in ('manual', 'envio_extrato') then
    raise exception 'Esta tarefa conclui sozinha pelo registro do sistema (%).',
      case m.regra when 'fechamento_caixa' then 'fechamento do caixa' when 'conciliacao_semanal' then 'conciliação da semana' else 'botão Confirmar conferência' end;
  end if;
  begin
    v_semana := nullif(p_dados ->> 'semana', '')::date;
  exception when others then
    v_semana := null;
  end;
  if m.exige_semana or m.regra = 'envio_extrato' then
    if v_semana is null then
      raise exception 'Informe a semana de referência.';
    end if;
    if app.rh_semana(v_semana) <> app.rh_semana(t.periodo_inicio) then
      raise exception 'A semana informada (%) não é a desta tarefa (% a %).', to_char(app.rh_semana(v_semana), 'DD/MM'),
        to_char(app.rh_semana(t.periodo_inicio), 'DD/MM'), to_char(app.rh_semana(t.periodo_inicio) + 6, 'DD/MM/YYYY');
    end if;
    v_semana := app.rh_semana(v_semana);
  end if;
  if m.exige_area and (v_area is null or length(v_area) < 2) then
    raise exception 'Informe a área.';
  end if;
  if m.exige_foto and not exists (
    select 1 from public.rh_tarefa_evidencias e where e.tarefa_id = t.id and e.confirmado_em is not null and e.mime like 'image/%'
  ) then
    raise exception 'Anexe uma foto antes de concluir.';
  end if;
  if m.regra = 'envio_extrato' and (p_dados ->> 'documento_id') ~ '^[0-9a-f-]{36}$' then
    v_doc := (p_dados ->> 'documento_id')::uuid;
    select coalesce(d.titulo, d.nome_original) into v_doc_nome from public.documentos d
     where d.id = v_doc and d.empresa_id = t.empresa_id and d.categoria_codigo = 'extrato_bancario' and d.excluido_em is null;
    if v_doc_nome is null then
      raise exception 'Extrato não encontrado entre os documentos da empresa.';
    end if;
  end if;
  update public.rh_tarefas
     set area = coalesce(v_area, area), semana_referencia = coalesce(v_semana, semana_referencia), observacao = coalesce(v_obs, observacao)
   where id = t.id;
  if v_doc is not null then
    insert into public.rh_tarefa_vinculos (empresa_id, tarefa_id, tipo, registro_id, descricao, situacao, origem, decidido_por, decidido_em)
    values (t.empresa_id, t.id, 'documento', v_doc, left('Extrato enviado pelo portal: ' || v_doc_nome, 300), 'confirmado', 'manual', auth.uid(), now())
    on conflict do nothing;
  end if;
  v_detalhe := concat_ws(' · ',
    'Concluída à mão',
    case when v_semana is not null then 'semana de ' || to_char(v_semana, 'DD/MM') || ' a ' || to_char(v_semana + 6, 'DD/MM/YYYY') end,
    case when v_area is not null then 'área: ' || v_area end,
    case when v_doc_nome is not null then 'extrato: ' || v_doc_nome end);
  perform app.rh_concluir(t.id, 'manual', v_detalhe);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Evidências: iniciar envio, confirmar e excluir
-- -----------------------------------------------------------------------------
create or replace function public.rh_evidencia_iniciar(p_tarefa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.rh_tarefas;
  v_mime text := lower(trim(coalesce(p_dados ->> 'mime', '')));
  v_tamanho bigint;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_caminho text;
begin
  select * into t from public.rh_tarefas where id = p_tarefa_id;
  if t.id is null then
    raise exception 'Tarefa não encontrada.';
  end if;
  perform app.rh_exigir(t.empresa_id, 'rh.tarefas');
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado: esta tarefa não é sua.' using errcode = '42501';
  end if;
  if t.status = 'concluida' then
    raise exception 'Tarefa concluída não recebe anexos.';
  end if;
  v_ext := case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
  if v_ext is null then
    raise exception 'Envie uma foto (JPG, PNG, WEBP ou HEIC) ou um PDF.';
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
    raise exception 'O arquivo pode ter até 10 MB.';
  end if;
  if (select count(*) from public.rh_tarefa_evidencias
       where tarefa_id = t.id and (confirmado_em is not null or created_at > now() - interval '1 hour')) >= 10 then
    raise exception 'Cada tarefa aceita até 10 anexos.';
  end if;
  v_caminho := t.empresa_id::text || '/' || t.id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.rh_tarefa_evidencias (id, empresa_id, tarefa_id, caminho, mime, tamanho, legenda)
  values (v_id, t.empresa_id, t.id, v_caminho, v_mime, v_tamanho, nullif(left(trim(coalesce(p_dados ->> 'legenda', '')), 200), ''));
  return jsonb_build_object('evidencia_id', v_id, 'caminho', v_caminho);
end;
$$;

create or replace function public.rh_evidencia_confirmar(p_evidencia_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.rh_tarefa_evidencias;
  v_obj jsonb;
begin
  select * into e from public.rh_tarefa_evidencias where id = p_evidencia_id;
  if e.id is null then
    raise exception 'Anexo não encontrado.';
  end if;
  perform app.rh_exigir(e.empresa_id, 'rh.tarefas');
  if e.enviado_por is distinct from auth.uid() then
    raise exception 'Somente quem iniciou o envio pode confirmá-lo.';
  end if;
  if e.confirmado_em is not null then
    return;
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'rh-evidencias' and o.name = e.caminho;
  if not found then
    raise exception 'O arquivo não chegou ao armazenamento. Tente enviar novamente.';
  end if;
  update public.rh_tarefa_evidencias set confirmado_em = now(), tamanho = coalesce(nullif(v_obj ->> 'size', '')::bigint, tamanho) where id = e.id;
  perform app.rh_evento(e.empresa_id, e.tarefa_id, 'evidencia', 'manual',
    case when e.mime like 'image/%' then 'Foto anexada' else 'Arquivo anexado' end || coalesce(': ' || e.legenda, ''));
end;
$$;

-- Exclui o anexo (antes de concluir); devolve o caminho para apagar o arquivo
create or replace function public.rh_evidencia_excluir(p_evidencia_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.rh_tarefa_evidencias;
  t public.rh_tarefas;
begin
  select * into e from public.rh_tarefa_evidencias where id = p_evidencia_id;
  if e.id is null then
    raise exception 'Anexo não encontrado.';
  end if;
  select * into t from public.rh_tarefas where id = e.tarefa_id;
  perform app.rh_exigir(e.empresa_id, 'rh.tarefas');
  if not app.rh_pode_tarefa(t.empresa_id, t.responsavel_id) then
    raise exception 'Acesso negado: esta tarefa não é sua.' using errcode = '42501';
  end if;
  if t.status = 'concluida' then
    raise exception 'O anexo de uma tarefa concluída é a evidência dela e fica guardado.';
  end if;
  delete from public.rh_tarefa_evidencias where id = e.id;
  return e.caminho;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Cadastros do gestor: cargos e modelos
-- -----------------------------------------------------------------------------
create or replace function public.rh_cargo_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text := trim(coalesce(p_dados ->> 'nome', ''));
  v_modelos uuid[];
begin
  perform app.rh_exigir(p_empresa_id, 'rh.gerenciar');
  if length(v_nome) < 2 or length(v_nome) > 80 then
    raise exception 'Informe o nome do cargo (2 a 80 letras).';
  end if;
  begin
    if p_id is null then
      insert into public.rh_cargos (empresa_id, nome, descricao)
      values (p_empresa_id, v_nome, nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), ''))
      returning id into v_id;
    else
      update public.rh_cargos set nome = v_nome, descricao = nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), '')
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Cargo não encontrado.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe um cargo com o nome "%".', v_nome;
  end;
  -- Modelos de tarefa de responsabilidade do cargo
  if p_dados ? 'modelos' and jsonb_typeof(p_dados -> 'modelos') = 'array' then
    select coalesce(array_agg(x::uuid), array[]::uuid[]) into v_modelos
      from jsonb_array_elements_text(p_dados -> 'modelos') x where x ~ '^[0-9a-f-]{36}$';
    update public.rh_tarefa_modelos set cargo_id = null where empresa_id = p_empresa_id and cargo_id = v_id and not (id = any(v_modelos));
    update public.rh_tarefa_modelos set cargo_id = v_id where empresa_id = p_empresa_id and id = any(v_modelos);
  end if;
  return v_id;
end;
$$;

create or replace function public.rh_cargo_excluir(p_cargo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.rh_cargos;
begin
  select * into c from public.rh_cargos where id = p_cargo_id;
  if c.id is null then
    raise exception 'Cargo não encontrado.';
  end if;
  perform app.rh_exigir(c.empresa_id, 'rh.gerenciar');
  -- Os funcionários continuam com o nome do cargo escrito; os modelos ficam sem cargo
  delete from public.rh_cargos where id = c.id;
end;
$$;

create or replace function public.rh_modelo_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_titulo text := trim(coalesce(p_dados ->> 'titulo', ''));
  v_per text := coalesce(p_dados ->> 'periodicidade', '');
  v_regra text := coalesce(nullif(p_dados ->> 'regra', ''), 'manual');
  v_dias smallint[];
  v_cargo uuid := case when (p_dados ->> 'cargo_id') ~ '^[0-9a-f-]{36}$' then (p_dados ->> 'cargo_id')::uuid end;
  v_resp uuid := case when (p_dados ->> 'responsavel_id') ~ '^[0-9a-f-]{36}$' then (p_dados ->> 'responsavel_id')::uuid end;
  v_dep uuid := case when (p_dados ->> 'depende_de_id') ~ '^[0-9a-f-]{36}$' then (p_dados ->> 'depende_de_id')::uuid end;
  v_param jsonb := '{}'::jsonb;
begin
  perform app.rh_exigir(p_empresa_id, 'rh.gerenciar');
  if length(v_titulo) < 2 or length(v_titulo) > 120 then
    raise exception 'Informe o título da tarefa (2 a 120 letras).';
  end if;
  if v_per not in ('diaria', 'semanal', 'quinzenal', 'mensal') then
    raise exception 'Escolha a periodicidade.';
  end if;
  if v_regra not in ('manual', 'envio_extrato', 'fechamento_caixa', 'conciliacao_semanal', 'conferencia_estoque') then
    raise exception 'Escolha como a tarefa é concluída.';
  end if;
  if v_regra = 'fechamento_caixa' and v_per <> 'diaria' then
    raise exception 'O fechamento do caixa é uma tarefa diária.';
  end if;
  if v_regra in ('conciliacao_semanal', 'envio_extrato') and v_per <> 'semanal' then
    raise exception 'O envio do extrato e a conciliação da semana são tarefas semanais.';
  end if;
  if jsonb_typeof(p_dados -> 'dias_semana') = 'array' then
    select coalesce(array_agg(distinct x::smallint order by x::smallint), array[]::smallint[]) into v_dias
      from jsonb_array_elements_text(p_dados -> 'dias_semana') x where x ~ '^[1-7]$';
  end if;
  if v_per = 'diaria' and coalesce(cardinality(v_dias), 0) = 0 then
    raise exception 'Escolha os dias da semana em que a tarefa acontece.';
  end if;
  if v_cargo is not null and not exists (select 1 from public.rh_cargos where id = v_cargo and empresa_id = p_empresa_id) then
    raise exception 'Cargo não encontrado.';
  end if;
  if v_resp is not null and not exists (select 1 from public.escala_funcionarios where id = v_resp and empresa_id = p_empresa_id) then
    raise exception 'Funcionário não encontrado.';
  end if;
  if v_dep is not null and (v_dep = p_id or not exists (select 1 from public.rh_tarefa_modelos where id = v_dep and empresa_id = p_empresa_id)) then
    raise exception 'A tarefa de que esta depende não foi encontrada.';
  end if;
  if v_dep is not null and p_id is not null and exists (
    with recursive cadeia(id) as (
      select depende_de_id from public.rh_tarefa_modelos where id = v_dep
      union
      select m.depende_de_id from public.rh_tarefa_modelos m join cadeia c on m.id = c.id where m.depende_de_id is not null
    )
    select 1 from cadeia where id = p_id
  ) then
    raise exception 'Não dá: a outra tarefa já depende desta.';
  end if;
  if nullif(trim(p_dados -> 'parametros' ->> 'caixa_nome'), '') is not null then
    v_param := v_param || jsonb_build_object('caixa_nome', left(trim(p_dados -> 'parametros' ->> 'caixa_nome'), 40));
  end if;
  if (p_dados -> 'parametros' ->> 'conta_financeira_id') ~ '^[0-9a-f-]{36}$' then
    v_param := v_param || jsonb_build_object('conta_financeira_id', p_dados -> 'parametros' ->> 'conta_financeira_id');
  end if;
  if p_id is null then
    insert into public.rh_tarefa_modelos (empresa_id, titulo, descricao, cargo_id, responsavel_id, periodicidade, dias_semana, dia_semana, dia_mes,
                                          hora_limite, regra, exige_foto, exige_area, exige_semana, parametros, depende_de_id, ativo)
    values (p_empresa_id, v_titulo, nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), ''), v_cargo, v_resp, v_per,
            coalesce(v_dias, '{1,2,3,4,5,6}'), coalesce(nullif(p_dados ->> 'dia_semana', '')::smallint, 5), coalesce(nullif(p_dados ->> 'dia_mes', '')::smallint, 5),
            coalesce(nullif(p_dados ->> 'hora_limite', '')::time, '18:00'), v_regra,
            coalesce((p_dados ->> 'exige_foto')::boolean, false), coalesce((p_dados ->> 'exige_area')::boolean, false),
            coalesce((p_dados ->> 'exige_semana')::boolean, false), v_param, v_dep, coalesce((p_dados ->> 'ativo')::boolean, true))
    returning id into v_id;
  else
    update public.rh_tarefa_modelos
       set titulo = v_titulo, descricao = nullif(left(trim(coalesce(p_dados ->> 'descricao', '')), 2000), ''), cargo_id = v_cargo, responsavel_id = v_resp,
           periodicidade = v_per, dias_semana = coalesce(v_dias, dias_semana),
           dia_semana = coalesce(nullif(p_dados ->> 'dia_semana', '')::smallint, dia_semana), dia_mes = coalesce(nullif(p_dados ->> 'dia_mes', '')::smallint, dia_mes),
           hora_limite = coalesce(nullif(p_dados ->> 'hora_limite', '')::time, hora_limite), regra = v_regra,
           exige_foto = coalesce((p_dados ->> 'exige_foto')::boolean, false), exige_area = coalesce((p_dados ->> 'exige_area')::boolean, false),
           exige_semana = coalesce((p_dados ->> 'exige_semana')::boolean, false), parametros = v_param, depende_de_id = v_dep,
           ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo)
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Modelo não encontrado.';
    end if;
    -- As tarefas abertas acompanham o título
    update public.rh_tarefas set titulo = v_titulo where modelo_id = v_id and status <> 'concluida' and titulo <> v_titulo;
  end if;
  perform app.rh_gerar(v_id, app.hoje());
  return v_id;
end;
$$;

-- Rotinas iniciais (cria só as que faltam; a conciliação depende do envio do extrato)
create or replace function public.rh_criar_rotinas_iniciais(p_empresa_id uuid, p_chaves text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_criadas int := 0;
  v_n int;
  v_envio uuid;
  r record;
begin
  perform app.rh_exigir(p_empresa_id, 'rh.gerenciar');
  for r in
    select * from (values
      ('conferencia_estoque', 'Conferência de estoque', 'Conferir o estoque e clicar em "Confirmar conferência". O portal registra quem conferiu e quando.',
       'semanal', 5, '17:00'::time, 'conferencia_estoque', false, false, false, '{1,2,3,4,5,6}'::smallint[]),
      ('envio_extrato', 'Envio do extrato bancário à contabilidade', 'Enviar à contabilidade o extrato bancário da semana e confirmar aqui a semana de referência.',
       'semanal', 5, '18:00'::time, 'envio_extrato', false, false, true, '{1,2,3,4,5,6}'::smallint[]),
      ('conciliacao_semanal', 'Conciliação bancária semanal', 'Conclui sozinha quando todos os movimentos do extrato da semana estiverem conciliados. Depende do envio do extrato.',
       'semanal', 5, '18:00'::time, 'conciliacao_semanal', false, false, false, '{1,2,3,4,5,6}'::smallint[]),
      ('organizacao_patio', 'Organização do pátio', 'Organizar o pátio e concluir com a foto do pátio organizado, a área e a semana.',
       'semanal', 6, '12:00'::time, 'manual', true, true, true, '{1,2,3,4,5,6}'::smallint[]),
      ('fechamento_caixa', 'Fechamento do caixa', 'Conclui sozinha quando o caixa do dia é fechado no portal.',
       'diaria', 5, '19:00'::time, 'fechamento_caixa', false, false, false, '{1,2,3,4,5,6}'::smallint[])
    ) as x(chave, titulo, descricao, periodicidade, dia_semana, hora, regra, foto, area, semana, dias)
    where x.chave = any(p_chaves)
  loop
    insert into public.rh_tarefa_modelos (empresa_id, titulo, descricao, periodicidade, dia_semana, hora_limite, regra, exige_foto, exige_area, exige_semana,
                                          dias_semana, chave_rotina)
    values (p_empresa_id, r.titulo, r.descricao, r.periodicidade, r.dia_semana, r.hora, r.regra, r.foto, r.area, r.semana, r.dias, r.chave)
    on conflict (empresa_id, chave_rotina) where chave_rotina is not null do nothing;
    get diagnostics v_n = row_count;
    v_criadas := v_criadas + v_n;
  end loop;
  select id into v_envio from public.rh_tarefa_modelos where empresa_id = p_empresa_id and chave_rotina = 'envio_extrato';
  if v_envio is not null then
    update public.rh_tarefa_modelos set depende_de_id = v_envio
     where empresa_id = p_empresa_id and chave_rotina = 'conciliacao_semanal' and depende_de_id is null;
  end if;
  -- Tarefas do período atual (a do envio antes, por causa da dependência)
  perform app.rh_gerar(m.id, app.hoje())
     from public.rh_tarefa_modelos m
    where m.empresa_id = p_empresa_id and m.chave_rotina = any(p_chaves) and m.ativo
    order by (m.depende_de_id is not null);
  return v_criadas;
end;
$$;

-- Rotina diária: a tarefa do período atual de cada modelo ativo (não duplica)
create or replace function public.rotina_rh_tarefas()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes int;
  v_modelos int := 0;
  m record;
begin
  select count(*) into v_antes from public.rh_tarefas;
  for m in
    select tm.id from public.rh_tarefa_modelos tm
      join public.empresas e on e.id = tm.empresa_id
     where tm.ativo and not ('escalas' = any(e.ferramentas_desligadas))
     order by (tm.depende_de_id is not null)
  loop
    perform app.rh_gerar(m.id, app.hoje());
    v_modelos := v_modelos + 1;
  end loop;
  return jsonb_build_object('modelos', v_modelos, 'criadas', (select count(*) from public.rh_tarefas) - v_antes);
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Privilégios das funções
-- -----------------------------------------------------------------------------
revoke all on function
  app.rh_meus_funcionarios(uuid), app.rh_pode_tarefa(uuid, uuid), app.rh_pode_ver_tarefa(uuid), app.rh_exigir(uuid, text),
  app.rh_semana(date), app.rh_periodo(text, date), app.rh_prazo(public.rh_tarefa_modelos, date, date),
  app.rh_evento(uuid, uuid, text, text, text), app.rh_gerar(uuid, date), app.rh_gerar_proxima(uuid),
  app.rh_dependencias_abertas(uuid), app.rh_concluir(uuid, text, text), app.rh_vincular(uuid, text, uuid, text, jsonb, text),
  app.rh_avaliar_caixa(uuid, date), app.rh_avaliar_conciliacao(uuid, date)
from public, anon;
-- As que as políticas de acesso usam ficam para quem está logado
grant execute on function app.rh_meus_funcionarios(uuid), app.rh_pode_tarefa(uuid, uuid), app.rh_pode_ver_tarefa(uuid), app.rh_semana(date)
  to authenticated, service_role;

revoke all on function
  public.rh_conciliacao_progresso(uuid, date[]), public.rh_confirmar_conferencia_estoque(uuid, text),
  public.rh_vinculo_confirmar(uuid), public.rh_vinculo_recusar(uuid), public.rh_vinculo_ia_registrar(uuid, text), public.rh_reprocessar_caixa(uuid),
  public.rh_tarefa_mover(uuid, text, double precision), public.rh_tarefa_atribuir(uuid, uuid), public.rh_tarefa_dependencia(uuid, uuid, boolean),
  public.rh_tarefa_concluir(uuid, jsonb), public.rh_evidencia_iniciar(uuid, jsonb), public.rh_evidencia_confirmar(uuid), public.rh_evidencia_excluir(uuid),
  public.rh_cargo_salvar(uuid, uuid, jsonb), public.rh_cargo_excluir(uuid), public.rh_modelo_salvar(uuid, uuid, jsonb),
  public.rh_criar_rotinas_iniciais(uuid, text[]), public.rotina_rh_tarefas()
from public, anon;
grant execute on function
  public.rh_conciliacao_progresso(uuid, date[]), public.rh_confirmar_conferencia_estoque(uuid, text),
  public.rh_vinculo_confirmar(uuid), public.rh_vinculo_recusar(uuid), public.rh_vinculo_ia_registrar(uuid, text), public.rh_reprocessar_caixa(uuid),
  public.rh_tarefa_mover(uuid, text, double precision), public.rh_tarefa_atribuir(uuid, uuid), public.rh_tarefa_dependencia(uuid, uuid, boolean),
  public.rh_tarefa_concluir(uuid, jsonb), public.rh_evidencia_iniciar(uuid, jsonb), public.rh_evidencia_confirmar(uuid), public.rh_evidencia_excluir(uuid),
  public.rh_cargo_salvar(uuid, uuid, jsonb), public.rh_cargo_excluir(uuid), public.rh_modelo_salvar(uuid, uuid, jsonb),
  public.rh_criar_rotinas_iniciais(uuid, text[])
to authenticated;
revoke all on function public.rotina_rh_tarefas() from authenticated;
grant execute on function public.rotina_rh_tarefas() to service_role;

-- -----------------------------------------------------------------------------
-- 14. Sugestão da IA para registro duvidoso (usa a IA do escritório; limite do dia)
-- -----------------------------------------------------------------------------
alter table public.escala_ia_usos drop constraint escala_ia_usos_tipo_check;
alter table public.escala_ia_usos add constraint escala_ia_usos_tipo_check check (tipo in ('sugerir', 'ajustar', 'rh_vinculo'));

create or replace function public.rh_ia_reservar(p_empresa_id uuid)
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
  perform app.rh_exigir(p_empresa_id, 'rh.tarefas');
  select * into v_cfg from public.escritorio_ia where id = 1;
  if v_cfg.id is null or not v_cfg.ativa or not exists (select 1 from public.escritorio_ia_segredo where id = 1) then
    raise exception 'A IA está desligada. O administrador do escritório liga em Configurações → Integrações. Enquanto isso, escolha a tarefa certa você mesmo.'
      using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('escala_ia:' || p_empresa_id::text, 0));
  select count(*) into v_usados
    from public.escala_ia_usos u
   where u.empresa_id = p_empresa_id
     and u.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_usados >= v_cfg.limite_diario then
    raise exception 'Limite de % pedidos por dia à IA nesta empresa atingido. Amanhã o limite volta.', v_cfg.limite_diario
      using errcode = 'P0001';
  end if;
  insert into public.escala_ia_usos (empresa_id, user_id, tipo, modelo)
  values (p_empresa_id, auth.uid(), 'rh_vinculo', v_cfg.modelo)
  returning id into v_id;
  return query select v_id, v_cfg.modelo;
end;
$$;
revoke all on function public.rh_ia_reservar(uuid) from public, anon;
grant execute on function public.rh_ia_reservar(uuid) to authenticated;
