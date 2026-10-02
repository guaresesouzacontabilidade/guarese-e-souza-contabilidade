-- =============================================================================
-- Notas automáticas (SEFAZ – NF-e Distribuição DF-e e Ambiente Nacional da NFS-e)
--
--  * Desligadas até o cadastro do certificado digital A1 (e-CNPJ) da empresa,
--    com a autorização do cliente registrada (o próprio cliente cadastra no
--    portal ou o escritório declara ter a autorização por escrito).
--  * A senha do certificado NÃO é guardada: o servidor abre o arquivo no
--    cadastro e guarda só a chave privada e o certificado, cifrados com uma
--    chave que existe apenas no servidor (CERTIFICADOS_CHAVE). A tabela com o
--    conteúdo cifrado não é acessível pela API (só pelo processador).
--  * A busca roda na fila de tarefas, respeitando as regras de consumo da SEFAZ
--    (uma consulta por hora quando não há documentos novos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissão nova: certificado.gerenciar (equipe e empresário titular)
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
    'certificado.gerenciar'
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
      'certificado.gerenciar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

update public.empresa_membros
   set permissoes = permissoes || array['certificado.gerenciar']
 where papel in ('equipe', 'cliente_titular') and not ('certificado.gerenciar' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['certificado.gerenciar']
 where status = 'pendente' and papel in ('equipe', 'cliente_titular') and cardinality(permissoes) > 0
   and not ('certificado.gerenciar' = any(permissoes));

-- Documentos trazidos pela busca automática
alter table public.documentos drop constraint documentos_origem_check;
alter table public.documentos add constraint documentos_origem_check
  check (origem in ('upload', 'camera', 'zip', 'escritorio', 'sistema', 'automatica'));

-- -----------------------------------------------------------------------------
-- Certificado digital A1 (metadados) e conteúdo cifrado
-- -----------------------------------------------------------------------------
create table public.certificados_digitais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titular text not null check (length(titular) between 1 and 300),
  documento text check (documento is null or documento ~ '^[0-9A-Z]{14}$'),
  emissor text check (emissor is null or length(emissor) <= 300),
  numero_serie text check (numero_serie is null or numero_serie ~ '^[0-9A-F]{1,80}$'),
  impressao_digital text not null check (impressao_digital ~ '^[0-9A-F]{64}$'),
  valido_de timestamptz not null,
  valido_ate timestamptz not null,
  -- Como a autorização do cliente foi dada
  autorizacao text not null check (autorizacao in ('cliente_no_portal', 'autorizacao_escrita')),
  autorizacao_texto text not null check (length(autorizacao_texto) between 10 and 2000),
  cadastrado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  revogado_em timestamptz,
  revogado_por uuid references public.perfis(id) on delete set null,
  motivo_revogacao text check (motivo_revogacao is null or length(motivo_revogacao) <= 500),
  vencimento_id uuid references public.vencimentos(id) on delete set null,
  constraint certificados_validade check (valido_de < valido_ate)
);
create unique index certificados_ativo_uk on public.certificados_digitais (empresa_id) where revogado_em is null;
create index certificados_empresa_idx on public.certificados_digitais (empresa_id, created_at desc);

-- Chave privada e certificados (PEM) cifrados no servidor com AES-256-GCM.
-- Sem políticas e sem permissão para usuários: só o processador (service_role) lê.
create table public.certificados_segredos (
  certificado_id uuid primary key references public.certificados_digitais(id) on delete cascade,
  conteudo_cifrado text not null check (conteudo_cifrado ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(conteudo_cifrado) <= 200000),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Preferências e controle da busca (NSU, próxima consulta, erros)
-- -----------------------------------------------------------------------------
create table public.notas_automaticas (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  nfe_ativa boolean not null default true,
  nfse_ativa boolean not null default true,
  ciencia_automatica boolean not null default false,
  pausada boolean not null default false,
  -- Validade do certificado ativo (nula sem certificado): a situação aparece até para quem não vê o certificado
  certificado_valido_ate timestamptz,
  nfe_ult_nsu text not null default '000000000000000' check (nfe_ult_nsu ~ '^[0-9]{15}$'),
  nfe_max_nsu text check (nfe_max_nsu is null or nfe_max_nsu ~ '^[0-9]{15}$'),
  nfe_proxima timestamptz,
  nfse_ult_nsu bigint not null default 0 check (nfse_ult_nsu >= 0),
  nfse_proxima timestamptz,
  ultima_execucao timestamptz,
  ultimo_sucesso timestamptz,
  ultimo_erro text check (ultimo_erro is null or length(ultimo_erro) <= 1000),
  erros_seguidos int not null default 0,
  executando_ate timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null,
  updated_at timestamptz not null default now()
);
create trigger notas_automaticas_updated_at before update on public.notas_automaticas
  for each row execute function app.tg_updated_at();

create table public.notas_automaticas_execucoes (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  servico text not null check (servico in ('nfe', 'nfse', 'ciencia')),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  resultado text not null check (resultado in ('novos', 'sem_novidades', 'limite', 'erro')),
  documentos int not null default 0,
  resumos int not null default 0,
  codigo text check (codigo is null or length(codigo) <= 40),
  mensagem text check (mensagem is null or length(mensagem) <= 1000)
);
create index notas_execucoes_empresa_idx on public.notas_automaticas_execucoes (empresa_id, iniciado_em desc);

-- Resumos das NF-e recebidas (a SEFAZ entrega o XML completo depois da ciência)
create table public.nfe_resumos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null check (chave ~ '^[0-9]{44}$'),
  nsu text check (nsu is null or nsu ~ '^[0-9]{1,15}$'),
  emitente_documento text check (emitente_documento is null or length(emitente_documento) <= 14),
  emitente_nome text check (emitente_nome is null or length(emitente_nome) <= 300),
  emitente_ie text check (emitente_ie is null or length(emitente_ie) <= 20),
  data_emissao timestamptz,
  tipo_operacao text check (tipo_operacao is null or tipo_operacao in ('entrada', 'saida')),
  valor numeric(15, 2),
  protocolo text check (protocolo is null or length(protocolo) <= 20),
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'denegada', 'cancelada')),
  ciencia_em timestamptz,
  ciencia_retorno text check (ciencia_retorno is null or length(ciencia_retorno) <= 300),
  documento_id uuid,
  recebido_em timestamptz not null default now(),
  constraint nfe_resumos_unico unique (empresa_id, chave),
  constraint nfe_resumos_documento_fk foreign key (empresa_id, documento_id)
    references public.documentos (empresa_id, id) on delete set null (documento_id)
);
create index nfe_resumos_empresa_idx on public.nfe_resumos (empresa_id, data_emissao desc);

-- NSU já processados (evita importar duas vezes se uma busca for interrompida)
create table public.notas_automaticas_nsu (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  servico text not null check (servico in ('nfe', 'nfse')),
  nsu text not null check (nsu ~ '^[0-9]{1,20}$'),
  tipo text check (tipo is null or length(tipo) <= 60),
  chave text check (chave is null or length(chave) <= 60),
  documento_id uuid,
  recebido_em timestamptz not null default now(),
  primary key (empresa_id, servico, nsu),
  constraint notas_nsu_documento_fk foreign key (empresa_id, documento_id)
    references public.documentos (empresa_id, id) on delete set null (documento_id)
);

alter table public.certificados_digitais enable row level security;
alter table public.certificados_segredos enable row level security;
alter table public.notas_automaticas enable row level security;
alter table public.notas_automaticas_execucoes enable row level security;
alter table public.nfe_resumos enable row level security;
alter table public.notas_automaticas_nsu enable row level security;

create policy certificados_leitura on public.certificados_digitais for select to authenticated
  using ((select app.pode(empresa_id, 'certificado.gerenciar')));
create policy notas_automaticas_leitura on public.notas_automaticas for select to authenticated
  using ((select app.pode(empresa_id, 'certificado.gerenciar')) or (select app.pode(empresa_id, 'documentos.ver')));
create policy notas_execucoes_leitura on public.notas_automaticas_execucoes for select to authenticated
  using ((select app.pode(empresa_id, 'certificado.gerenciar')) or (select app.pode(empresa_id, 'documentos.ver')));
create policy nfe_resumos_leitura on public.nfe_resumos for select to authenticated
  using ((select app.pode(empresa_id, 'documentos.ver')));

grant select on public.certificados_digitais, public.notas_automaticas, public.notas_automaticas_execucoes, public.nfe_resumos to authenticated;
grant select, insert, update, delete on public.certificados_digitais, public.certificados_segredos, public.notas_automaticas,
  public.notas_automaticas_execucoes, public.nfe_resumos, public.notas_automaticas_nsu to service_role;


-- -----------------------------------------------------------------------------
-- Funções
-- -----------------------------------------------------------------------------

-- Agenda a busca (idempotente por minuto).
create or replace function app.agendar_notas_automaticas(p_empresa_id uuid, p_quando timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quando timestamptz := greatest(coalesce(p_quando, now()), now());
begin
  if exists (select 1 from public.jobs where tipo = 'notas_automaticas' and empresa_id = p_empresa_id and status = 'pendente'
                and executar_apos <= v_quando + interval '1 minute') then
    return;
  end if;
  perform app.enfileirar('notas_automaticas', jsonb_build_object('empresa_id', p_empresa_id), p_empresa_id,
                         'notas:' || p_empresa_id::text || ':' || to_char(v_quando at time zone 'UTC', 'YYYYMMDDHH24MI'), v_quando, 150);
end;
$$;

-- Cadastro do certificado (o servidor já conferiu o arquivo e cifrou o conteúdo).
create or replace function public.registrar_certificado(
  p_empresa_id uuid,
  p_titular text,
  p_documento text,
  p_emissor text,
  p_numero_serie text,
  p_impressao_digital text,
  p_valido_de timestamptz,
  p_valido_ate timestamptz,
  p_autorizacao_texto text,
  p_conteudo_cifrado text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp public.empresas;
  v_equipe boolean;
  v_anterior public.certificados_digitais;
  v_id uuid;
  v_venc uuid;
  v_raiz_emp text;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  v_equipe := p_empresa_id = any(app.empresas_equipe());
  if p_valido_ate <= now() then
    raise exception 'Este certificado está vencido.';
  end if;
  v_raiz_emp := left(upper(regexp_replace(coalesce(v_emp.documento, ''), '[^0-9A-Za-z]', '', 'g')), 8);
  if p_documento is null or length(v_raiz_emp) < 8 or left(p_documento, 8) <> v_raiz_emp then
    raise exception 'O certificado não é desta empresa (CNPJ diferente).';
  end if;

  -- Substitui o certificado anterior (o conteúdo cifrado dele é apagado)
  select * into v_anterior from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null;
  if found then
    update public.certificados_digitais
       set revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = 'Substituído por um novo certificado.'
     where id = v_anterior.id;
    delete from public.certificados_segredos where certificado_id = v_anterior.id;
    if v_anterior.vencimento_id is not null then
      update public.vencimentos set situacao = 'arquivado' where id = v_anterior.vencimento_id;
    end if;
  end if;

  -- Validade do certificado também entra em Vencimentos (avisos de renovação)
  insert into public.vencimentos (empresa_id, tipo, descricao, numero, orgao, emissao, validade, responsavel, observacao)
  values (p_empresa_id, 'certificado_digital', 'Certificado digital A1 (notas automáticas)', left(p_numero_serie, 80), left(p_emissor, 120),
          (p_valido_de at time zone 'America/Araguaina')::date, (p_valido_ate at time zone 'America/Araguaina')::date, 'cliente',
          'Cadastrado no portal para a busca automática de notas. Ao renovar, cadastre o novo certificado em Notas automáticas.')
  returning id into v_venc;

  insert into public.certificados_digitais (empresa_id, titular, documento, emissor, numero_serie, impressao_digital, valido_de, valido_ate,
                                            autorizacao, autorizacao_texto, vencimento_id)
  values (p_empresa_id, left(p_titular, 300), p_documento, left(p_emissor, 300), p_numero_serie, upper(p_impressao_digital), p_valido_de, p_valido_ate,
          case when v_equipe then 'autorizacao_escrita' else 'cliente_no_portal' end, p_autorizacao_texto, v_venc)
  returning id into v_id;
  insert into public.certificados_segredos (certificado_id, conteudo_cifrado) values (v_id, p_conteudo_cifrado);

  insert into public.notas_automaticas (empresa_id, certificado_valido_ate, nfe_proxima, nfse_proxima, atualizado_por)
  values (p_empresa_id, p_valido_ate, now(), now(), auth.uid())
  on conflict (empresa_id) do update
     set certificado_valido_ate = p_valido_ate,
         nfe_proxima = least(coalesce(public.notas_automaticas.nfe_proxima, now()), now() + interval '1 hour'),
         nfse_proxima = now(), ultimo_erro = null, erros_seguidos = 0, atualizado_por = auth.uid();
  perform app.agendar_notas_automaticas(p_empresa_id, now());

  perform app.registrar_auditoria('certificado_cadastrado', 'certificados_digitais', v_id::text, p_empresa_id,
    jsonb_build_object('titular', left(p_titular, 300), 'valido_ate', p_valido_ate, 'impressao_digital', upper(p_impressao_digital),
                       'autorizacao', case when v_equipe then 'autorizacao_escrita' else 'cliente_no_portal' end));
  if v_equipe then
    perform app.notificar_clientes(p_empresa_id, 'certificado.gerenciar', 'certificado',
      'Certificado digital cadastrado pelo escritório',
      'O escritório cadastrou o certificado digital da empresa para buscar as notas fiscais automaticamente. Você pode revogar a qualquer momento.',
      '/e/' || p_empresa_id::text || '/notas-automaticas', true);
  else
    perform app.notificar_equipe(p_empresa_id, 'certificado', 'Certificado digital cadastrado pelo cliente',
      'A busca automática de notas foi ativada para a empresa.', '/e/' || p_empresa_id::text || '/notas-automaticas', false);
  end if;
  return v_id;
end;
$$;

-- Revogação: apaga o conteúdo cifrado e desliga a busca.
create or replace function public.revogar_certificado(p_empresa_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.certificados_digitais;
  v_equipe boolean;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  select * into v from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null;
  if not found then
    raise exception 'Não há certificado cadastrado.';
  end if;
  v_equipe := p_empresa_id = any(app.empresas_equipe());
  update public.certificados_digitais
     set revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = left(nullif(trim(coalesce(p_motivo, '')), ''), 500)
   where id = v.id;
  delete from public.certificados_segredos where certificado_id = v.id;
  update public.notas_automaticas set certificado_valido_ate = null, ultimo_erro = null, erros_seguidos = 0, executando_ate = null
   where empresa_id = p_empresa_id;
  update public.jobs set status = 'cancelado', concluido_em = now()
   where tipo = 'notas_automaticas' and empresa_id = p_empresa_id and status = 'pendente';
  perform app.registrar_auditoria('certificado_revogado', 'certificados_digitais', v.id::text, p_empresa_id,
    jsonb_build_object('motivo', left(p_motivo, 500)));
  if v_equipe then
    perform app.notificar_clientes(p_empresa_id, 'certificado.gerenciar', 'certificado', 'Certificado digital removido pelo escritório',
      coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'A busca automática de notas foi desligada.'),
      '/e/' || p_empresa_id::text || '/notas-automaticas', true);
  else
    perform app.notificar_equipe(p_empresa_id, 'certificado', 'Certificado digital removido pelo cliente',
      coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'A busca automática de notas foi desligada.'),
      '/e/' || p_empresa_id::text || '/notas-automaticas', true);
  end if;
end;
$$;

-- Preferências da busca.
create or replace function public.salvar_notas_automaticas(
  p_empresa_id uuid,
  p_nfe boolean,
  p_nfse boolean,
  p_ciencia boolean,
  p_pausada boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes public.notas_automaticas;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  select * into v_antes from public.notas_automaticas where empresa_id = p_empresa_id;
  insert into public.notas_automaticas (empresa_id, nfe_ativa, nfse_ativa, ciencia_automatica, pausada, atualizado_por)
  values (p_empresa_id, coalesce(p_nfe, true), coalesce(p_nfse, true), coalesce(p_ciencia, false), coalesce(p_pausada, false), auth.uid())
  on conflict (empresa_id) do update
     set nfe_ativa = excluded.nfe_ativa, nfse_ativa = excluded.nfse_ativa, ciencia_automatica = excluded.ciencia_automatica,
         pausada = excluded.pausada, atualizado_por = auth.uid();
  -- (O processador atualiza esta tabela a cada busca; a auditoria registra só as escolhas das pessoas.)
  perform app.registrar_auditoria('notas_automaticas_preferencias', 'notas_automaticas', p_empresa_id::text, p_empresa_id,
    jsonb_build_object('nfe', coalesce(p_nfe, true), 'nfse', coalesce(p_nfse, true), 'ciencia_automatica', coalesce(p_ciencia, false),
                       'pausada', coalesce(p_pausada, false), 'ciencia_antes', coalesce(v_antes.ciencia_automatica, false)));
  if not coalesce(p_pausada, false) and exists (select 1 from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null) then
    perform app.agendar_notas_automaticas(p_empresa_id, now());
  end if;
end;
$$;

-- "Buscar agora": agenda para já (a consulta da NF-e respeita o intervalo exigido pela SEFAZ).
create or replace function public.buscar_notas_agora(p_empresa_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  if not exists (select 1 from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null and valido_ate > now()) then
    raise exception 'Cadastre um certificado digital válido para buscar as notas.';
  end if;
  update public.notas_automaticas set nfse_proxima = now(), pausada = false where empresa_id = p_empresa_id;
  perform app.agendar_notas_automaticas(p_empresa_id, now());
end;
$$;

-- Processador: reserva a empresa para uma busca (evita duas buscas ao mesmo tempo).
create or replace function public.notas_reservar(p_empresa_id uuid, p_segundos int default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notas_automaticas
     set executando_ate = now() + make_interval(secs => greatest(30, least(coalesce(p_segundos, 120), 600)))
   where empresa_id = p_empresa_id and (executando_ate is null or executando_ate < now());
  return found;
end;
$$;

-- Processador: agenda a próxima busca.
create or replace function public.notas_agendar(p_empresa_id uuid, p_quando timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.agendar_notas_automaticas(p_empresa_id, p_quando);
end;
$$;

-- Rotina: garante a próxima busca das empresas ativas e limpa o histórico antigo.
create or replace function public.rotina_notas_automaticas()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_agendadas int := 0;
begin
  for r in
    select n.empresa_id, least(coalesce(case when n.nfe_ativa then n.nfe_proxima end, 'infinity'::timestamptz),
                                coalesce(case when n.nfse_ativa then n.nfse_proxima end, 'infinity'::timestamptz)) as proxima
      from public.notas_automaticas n
      join public.certificados_digitais c on c.empresa_id = n.empresa_id and c.revogado_em is null and c.valido_ate > now()
     where not n.pausada and (n.nfe_ativa or n.nfse_ativa)
       and not exists (select 1 from public.jobs j where j.tipo = 'notas_automaticas' and j.empresa_id = n.empresa_id and j.status in ('pendente', 'executando'))
  loop
    perform app.agendar_notas_automaticas(r.empresa_id, case when r.proxima = 'infinity'::timestamptz then now() else r.proxima end);
    v_agendadas := v_agendadas + 1;
  end loop;
  delete from public.notas_automaticas_execucoes where iniciado_em < now() - interval '180 days';
  return jsonb_build_object('agendadas', v_agendadas);
end;
$$;

revoke execute on function app.agendar_notas_automaticas(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.agendar_notas_automaticas(uuid, timestamptz) to service_role;
revoke execute on function public.registrar_certificado(uuid, text, text, text, text, text, timestamptz, timestamptz, text, text),
  public.revogar_certificado(uuid, text), public.salvar_notas_automaticas(uuid, boolean, boolean, boolean, boolean),
  public.buscar_notas_agora(uuid) from public, anon;
grant execute on function public.registrar_certificado(uuid, text, text, text, text, text, timestamptz, timestamptz, text, text),
  public.revogar_certificado(uuid, text), public.salvar_notas_automaticas(uuid, boolean, boolean, boolean, boolean),
  public.buscar_notas_agora(uuid) to authenticated;
revoke execute on function public.notas_reservar(uuid, int), public.notas_agendar(uuid, timestamptz), public.rotina_notas_automaticas()
  from public, anon, authenticated;
grant execute on function public.notas_reservar(uuid, int), public.notas_agendar(uuid, timestamptz), public.rotina_notas_automaticas() to service_role;
