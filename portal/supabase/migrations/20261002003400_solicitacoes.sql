-- =============================================================================
-- Solicitações de serviço
--
--  * O cliente pede um serviço do catálogo (alteração contratual, declaração,
--    admissão, férias, certidões...) e acompanha o andamento.
--  * Cada solicitação tem uma conversa nas Mensagens (anexos e respostas em
--    tempo real) e um histórico de status.
--  * A equipe assume, define prazo e responsável, pede informações ao cliente
--    ("aguardando cliente") e conclui. O cliente é avisado a cada mudança.
-- =============================================================================

create table public.servicos_catalogo (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null check (length(trim(nome)) between 3 and 120),
  descricao text,
  area text not null check (area in ('societario', 'fiscal', 'pessoal', 'contabil', 'outros')),
  prazo_dias int not null default 5 check (prazo_dias between 1 and 180),
  documentos_necessarios text,
  ativo boolean not null default true,
  ordem int not null default 100
);

insert into public.servicos_catalogo (codigo, nome, descricao, area, prazo_dias, documentos_necessarios, ordem) values
  ('alteracao_contratual', 'Alteração contratual', 'Mudança de endereço, sócios, capital, atividade ou nome da empresa.', 'societario', 30,
   'Descrição da alteração; documentos pessoais dos sócios envolvidos; comprovante do novo endereço, se for o caso.', 10),
  ('abertura_filial', 'Abertura de filial', 'Registro de um novo estabelecimento da empresa.', 'societario', 30,
   'Endereço da filial, contrato de locação ou escritura e atividades que serão exercidas.', 20),
  ('encerramento', 'Encerramento da empresa', 'Baixa da empresa nos órgãos (Junta, Receita, Estado e Município).', 'societario', 60,
   'Data pretendida para o encerramento e situação de empregados, estoque e débitos.', 30),
  ('admissao', 'Admissão de empregado', 'Registro de um novo empregado (eSocial).', 'pessoal', 3,
   'Documentos pessoais, CTPS digital, exame admissional, cargo, salário, jornada e data de início.', 40),
  ('ferias', 'Férias de empregado', 'Programação e cálculo das férias (aviso com 30 dias de antecedência).', 'pessoal', 5,
   'Nome do empregado e período desejado.', 50),
  ('demissao', 'Demissão de empregado', 'Rescisão do contrato de trabalho e guias.', 'pessoal', 5,
   'Nome do empregado, tipo de desligamento, data e se o aviso será trabalhado ou indenizado.', 60),
  ('declaracao_faturamento', 'Declaração de faturamento', 'Declaração com o faturamento da empresa (bancos, licitações, financiamentos).', 'contabil', 3,
   'Período e finalidade da declaração.', 70),
  ('decore', 'DECORE (comprovação de renda)', 'Declaração de rendimentos de sócios (pró-labore e distribuição de lucros).', 'contabil', 5,
   'Sócio, período e finalidade.', 80),
  ('irpf', 'Imposto de Renda dos sócios (IRPF)', 'Declaração anual do Imposto de Renda da pessoa física.', 'contabil', 15,
   'Informes de rendimentos, despesas médicas e de educação, bens e dívidas.', 90),
  ('certidoes', 'Certidões negativas', 'Emissão de certidões negativas de débitos (federal, estadual, municipal, FGTS, trabalhista).', 'fiscal', 3,
   'Quais certidões e a finalidade (licitação, financiamento...).', 100),
  ('parcelamento', 'Parcelamento de débitos', 'Análise e adesão a parcelamento de tributos em atraso.', 'fiscal', 10,
   'Débitos ou notificações recebidas, se houver.', 110),
  ('nota_fiscal', 'Ajuda com nota fiscal', 'Emissão, correção ou cancelamento de nota fiscal.', 'fiscal', 2,
   'Número da nota e o que precisa ser feito.', 120),
  ('outro', 'Outro serviço', 'Qualquer outro pedido ao escritório.', 'outros', 5, null, 200)
on conflict (codigo) do nothing;

create table public.solicitacoes (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  servico_codigo text not null references public.servicos_catalogo(codigo),
  titulo text not null check (length(trim(titulo)) between 3 and 160),
  descricao text check (descricao is null or length(descricao) <= 4000),
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'aguardando_cliente', 'concluida', 'cancelada')),
  prioridade text not null default 'normal' check (prioridade in ('normal', 'urgente')),
  prazo date,
  responsavel_id uuid references public.perfis(id) on delete set null,
  conversa_id uuid references public.conversas(id) on delete set null,
  solicitado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  concluida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index solicitacoes_empresa_idx on public.solicitacoes (empresa_id, created_at desc);
create index solicitacoes_status_idx on public.solicitacoes (status, prazo);
create trigger solicitacoes_updated_at before update on public.solicitacoes
  for each row execute function app.tg_updated_at();

create table public.solicitacao_eventos (
  id bigint generated always as identity primary key,
  solicitacao_id uuid not null references public.solicitacoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('criada', 'status', 'responsavel', 'prazo', 'comentario')),
  status_anterior text,
  status_novo text,
  comentario text check (comentario is null or length(comentario) <= 2000),
  usuario_id uuid references public.perfis(id) on delete set null default auth.uid(),
  ocorrido_em timestamptz not null default now()
);
create index solicitacao_eventos_idx on public.solicitacao_eventos (solicitacao_id, ocorrido_em);

alter table public.servicos_catalogo enable row level security;
alter table public.solicitacoes enable row level security;
alter table public.solicitacao_eventos enable row level security;
create policy servicos_catalogo_leitura on public.servicos_catalogo for select to authenticated using (true);
create policy solicitacoes_leitura on public.solicitacoes for select to authenticated
  using ((select app.pode(empresa_id, 'mensagens.usar')));
create policy solicitacao_eventos_leitura on public.solicitacao_eventos for select to authenticated
  using ((select app.pode(empresa_id, 'mensagens.usar')));
grant select on public.servicos_catalogo, public.solicitacoes, public.solicitacao_eventos to authenticated;

-- Atualizações de solicitação também podem ir por WhatsApp (clientes que autorizaram)
create or replace function app.tipos_aviso_whatsapp()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['documento_escritorio', 'relatorio_publicado', 'mensagem', 'item_solicitado', 'item_correcao',
               'documento_correcao', 'pendencia_fechamento', 'vencimento', 'solicitacao_atualizada']::text[];
$$;

create or replace function app.rotulo_status_solicitacao(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'aberta' then 'Aberta'
    when 'em_andamento' then 'Em andamento'
    when 'aguardando_cliente' then 'Aguardando a empresa'
    when 'concluida' then 'Concluída'
    when 'cancelada' then 'Cancelada'
    else p_status end;
$$;

-- O cliente (ou a equipe, em nome dele) abre uma solicitação.
create or replace function public.abrir_solicitacao(
  p_empresa_id uuid,
  p_servico text,
  p_titulo text,
  p_descricao text default null,
  p_prioridade text default 'normal',
  p_documento_ids uuid[] default array[]::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servico public.servicos_catalogo;
  v_id uuid;
  v_numero bigint;
  v_conversa uuid;
  v_equipe boolean;
  v_corpo text;
begin
  perform app.exigir(p_empresa_id, 'mensagens.usar');
  select * into v_servico from public.servicos_catalogo where codigo = p_servico and ativo;
  if not found then
    raise exception 'Escolha um serviço da lista.';
  end if;
  if length(trim(coalesce(p_titulo, ''))) < 3 then
    raise exception 'Descreva o pedido em poucas palavras (título).';
  end if;
  if coalesce(p_prioridade, 'normal') not in ('normal', 'urgente') then
    raise exception 'Prioridade inválida.';
  end if;
  perform app.validar_anexos(p_empresa_id, p_documento_ids);
  v_equipe := p_empresa_id = any(app.empresas_equipe());

  insert into public.solicitacoes (empresa_id, servico_codigo, titulo, descricao, prioridade, prazo, solicitado_por)
  values (p_empresa_id, p_servico, trim(p_titulo), nullif(trim(coalesce(p_descricao, '')), ''), coalesce(p_prioridade, 'normal'),
          app.hoje() + v_servico.prazo_dias, auth.uid())
  returning id, numero into v_id, v_numero;

  -- Conversa da solicitação (mensagens e anexos)
  v_corpo := v_servico.nome || ': ' || trim(p_titulo) || coalesce(E'\n\n' || nullif(trim(coalesce(p_descricao, '')), ''), '');
  insert into public.conversas (empresa_id, assunto, tipo, aguardando)
  values (p_empresa_id, left('Solicitação #' || v_numero || ': ' || trim(p_titulo), 200), 'mensagem',
          case when v_equipe then 'cliente' else 'escritorio' end)
  returning id into v_conversa;
  insert into public.mensagens (conversa_id, empresa_id, corpo, documento_ids)
  values (v_conversa, p_empresa_id, left(v_corpo, 10000), coalesce(p_documento_ids, array[]::uuid[]));
  insert into public.conversa_leituras (conversa_id, user_id) values (v_conversa, auth.uid())
  on conflict (conversa_id, user_id) do update set lida_em = now();
  update public.solicitacoes set conversa_id = v_conversa where id = v_id;

  insert into public.solicitacao_eventos (solicitacao_id, empresa_id, tipo, status_novo, comentario)
  values (v_id, p_empresa_id, 'criada', 'aberta', null);

  if not v_equipe then
    perform app.notificar_equipe(p_empresa_id, 'solicitacao_nova',
      'Nova solicitação #' || v_numero || ': ' || v_servico.nome,
      trim(p_titulo) || case when p_prioridade = 'urgente' then ' (urgente)' else '' end,
      '/e/' || p_empresa_id::text || '/solicitacoes/' || v_id::text, true);
  end if;
  perform app.registrar_auditoria('solicitacao_aberta', 'solicitacoes', v_id::text, p_empresa_id,
    jsonb_build_object('servico', p_servico, 'numero', v_numero));
  return v_id;
end;
$$;

-- Mudança de andamento. Equipe: qualquer status, responsável e prazo.
-- Cliente: cancelar (aberta ou aguardando) ou devolver ao escritório depois de
-- enviar o que foi pedido (aguardando → em andamento).
create or replace function public.atualizar_solicitacao(
  p_id uuid,
  p_status text default null,
  p_comentario text default null,
  p_responsavel uuid default null,
  p_prazo date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.solicitacoes;
  v_equipe boolean;
  v_comentario text := nullif(trim(coalesce(p_comentario, '')), '');
  v_titulo text;
begin
  select * into v from public.solicitacoes where id = p_id;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'mensagens.usar');
  v_equipe := v.empresa_id = any(app.empresas_equipe());
  if v.status in ('concluida', 'cancelada') and not v_equipe then
    raise exception 'Esta solicitação já foi encerrada.';
  end if;

  if p_status is not null and p_status <> v.status then
    if p_status not in ('aberta', 'em_andamento', 'aguardando_cliente', 'concluida', 'cancelada') then
      raise exception 'Situação inválida.';
    end if;
    if not v_equipe and not (
         (p_status = 'cancelada' and v.status in ('aberta', 'aguardando_cliente'))
      or (p_status = 'em_andamento' and v.status = 'aguardando_cliente')) then
      raise exception 'Somente o escritório altera esta situação.' using errcode = '42501';
    end if;
    if p_status in ('aguardando_cliente', 'cancelada') and v_comentario is null then
      raise exception 'Explique o motivo (o que falta ou por que cancelar).';
    end if;
    update public.solicitacoes
       set status = p_status,
           concluida_em = case when p_status = 'concluida' then now() when p_status <> 'concluida' then null end
     where id = p_id;
    insert into public.solicitacao_eventos (solicitacao_id, empresa_id, tipo, status_anterior, status_novo, comentario)
    values (p_id, v.empresa_id, 'status', v.status, p_status, v_comentario);
    v_titulo := 'Solicitação #' || v.numero || ': ' || lower(app.rotulo_status_solicitacao(p_status));
    if v_equipe then
      perform app.notificar_clientes(v.empresa_id, 'mensagens.usar', 'solicitacao_atualizada', v_titulo,
        coalesce(v_comentario, v.titulo), '/e/' || v.empresa_id::text || '/solicitacoes/' || p_id::text, true);
    else
      perform app.notificar_equipe(v.empresa_id, 'solicitacao_atualizada', v_titulo,
        coalesce(v_comentario, v.titulo), '/e/' || v.empresa_id::text || '/solicitacoes/' || p_id::text, false);
    end if;
  elsif v_comentario is not null then
    -- Só o comentário (a tela da equipe reenvia responsável e prazo atuais)
    insert into public.solicitacao_eventos (solicitacao_id, empresa_id, tipo, comentario)
    values (p_id, v.empresa_id, 'comentario', v_comentario);
    v_titulo := 'Solicitação #' || v.numero || ': novo comentário';
    if v_equipe then
      perform app.notificar_clientes(v.empresa_id, 'mensagens.usar', 'solicitacao_atualizada', v_titulo,
        v_comentario, '/e/' || v.empresa_id::text || '/solicitacoes/' || p_id::text, true);
    else
      perform app.notificar_equipe(v.empresa_id, 'solicitacao_atualizada', v_titulo,
        v_comentario, '/e/' || v.empresa_id::text || '/solicitacoes/' || p_id::text, false);
    end if;
  end if;

  if p_responsavel is not null and p_responsavel is distinct from v.responsavel_id then
    if not v_equipe then
      raise exception 'Somente o escritório define o responsável.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.perfis where id = p_responsavel and tipo in ('admin', 'equipe') and ativo) then
      raise exception 'Responsável inválido.';
    end if;
    update public.solicitacoes set responsavel_id = p_responsavel where id = p_id;
    insert into public.solicitacao_eventos (solicitacao_id, empresa_id, tipo, comentario)
    values (p_id, v.empresa_id, 'responsavel', (select nome from public.perfis where id = p_responsavel));
  end if;

  if p_prazo is not null and p_prazo is distinct from v.prazo then
    if not v_equipe then
      raise exception 'Somente o escritório define o prazo.' using errcode = '42501';
    end if;
    update public.solicitacoes set prazo = p_prazo where id = p_id;
    insert into public.solicitacao_eventos (solicitacao_id, empresa_id, tipo, comentario)
    values (p_id, v.empresa_id, 'prazo', to_char(p_prazo, 'DD/MM/YYYY'));
  end if;
end;
$$;

revoke execute on function public.abrir_solicitacao(uuid, text, text, text, text, uuid[]), public.atualizar_solicitacao(uuid, text, text, uuid, date) from public, anon;
grant execute on function public.abrir_solicitacao(uuid, text, text, text, text, uuid[]), public.atualizar_solicitacao(uuid, text, text, uuid, date) to authenticated;
revoke execute on function app.rotulo_status_solicitacao(text) from public, anon;
grant execute on function app.rotulo_status_solicitacao(text) to authenticated, service_role;

-- Andamento ao vivo na tela da solicitação (o banco só entrega o que a pessoa pode ver)
alter publication supabase_realtime add table public.solicitacoes, public.solicitacao_eventos;
