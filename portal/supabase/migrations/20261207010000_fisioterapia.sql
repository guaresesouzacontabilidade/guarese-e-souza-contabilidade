-- =============================================================================
-- Gestão: modalidade "Clínica de fisioterapia"
--
-- O escritório liga a gestão na modalidade "fisioterapia" para clínicas e
-- consultórios de fisioterapia. A clínica se administra pelo portal:
--  * Pacientes com a identificação pedida no prontuário (Res. COFFITO nº
--    414/2012, art. 1º, § 1º, I) e o consentimento para o tratamento dos dados
--    de saúde (LGPD, art. 11).
--  * Agenda por fisioterapeuta (avaliação, sessão, reavaliação, grupo), com
--    sessões repetidas na semana (ex.: seg, qua e sex por 4 semanas), aviso de
--    choque de horário, confirmação pelo WhatsApp da própria clínica (link
--    aberto pela recepção), faltas e cancelamentos.
--  * Pacotes de sessões (particular ou convênio, com a guia/autorização):
--    sessões contratadas, usadas e restantes.
--  * Prontuário (Res. COFFITO nº 414/2012): avaliação com história clínica,
--    exame físico-funcional, exames complementares, diagnóstico e prognóstico
--    fisioterapêuticos e plano terapêutico (objetivos, recursos e técnicas,
--    número provável de sessões); evolução de cada sessão (SOAP, dor antes e
--    depois, condutas, intercorrências); alta. Cada registro leva o nome e o
--    CREFITO de quem atendeu e a data. Registro finalizado não muda: correções
--    entram como adendo datado. Nada do prontuário é apagado (guarda mínima de
--    5 anos a partir do último registro, art. 6º).
--  * Documentos do fisioterapeuta: declaração de comparecimento, relatório,
--    encaminhamento e orientações para casa.
--  * Recebimentos (sessão, avaliação, pacote) que viram lançamentos no
--    Financeiro, e o repasse por fisioterapeuta no mês.
-- Sigilo (art. 3º e 4º): o prontuário (avaliações, evoluções, adendos e
-- documentos) só é lido pelos fisioterapeutas da clínica, ligados ao próprio
-- usuário. A recepção vê agenda, cadastros, pacotes e recebimentos; o
-- escritório de contabilidade não vê o prontuário. Esses registros clínicos
-- também não vão para a trilha de auditoria (que o administrador do escritório
-- lê): a imutabilidade e o autor de cada registro ficam no próprio registro.
-- Tudo pelas funções abaixo; as tabelas são só lidas diretamente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Modalidade e origens no Financeiro
-- -----------------------------------------------------------------------------
alter table public.gestao_config drop constraint gestao_config_modalidade_check;
alter table public.gestao_config add constraint gestao_config_modalidade_check check (modalidade in ('loja', 'notas', 'hotel', 'veterinaria', 'fisioterapia'));

alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha', 'cartao', 'venda', 'hotel',
  'veterinaria', 'fisioterapia'
));
alter table public.baixas drop constraint baixas_origem_check;
alter table public.baixas add constraint baixas_origem_check check (origem in (
  'manual', 'conciliacao', 'importacao', 'maquininha', 'cartao', 'venda', 'hotel', 'veterinaria', 'fisioterapia'
));

-- -----------------------------------------------------------------------------
-- 2. Configuração da clínica
-- -----------------------------------------------------------------------------
create table public.fisio_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  nome_clinica text check (nome_clinica is null or length(trim(nome_clinica)) between 2 and 120),
  -- Registro da clínica no CREFITO (pessoa jurídica)
  registro_crefito text check (registro_crefito is null or length(trim(registro_crefito)) between 1 and 30),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  endereco text check (endereco is null or length(endereco) <= 300),
  cidade_documentos text check (cidade_documentos is null or length(cidade_documentos) <= 80),
  horario_inicio time not null default '07:00',
  horario_fim time not null default '19:00',
  duracao_padrao_min int not null default 50 check (duracao_padrao_min between 10 and 240),
  -- Valor da sessão avulsa (base do repasse quando a sessão não é de pacote)
  valor_sessao numeric(12, 2) not null default 0 check (valor_sessao >= 0),
  -- Falta sem aviso conta como sessão usada do pacote?
  falta_desconta_sessao boolean not null default false,
  mensagem_confirmacao text check (mensagem_confirmacao is null or length(mensagem_confirmacao) <= 600),
  proximo_numero_registro bigint not null default 1 check (proximo_numero_registro >= 1),
  proximo_numero_documento bigint not null default 1 check (proximo_numero_documento >= 1),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_config_horario check (horario_fim > horario_inicio)
);
create trigger fisio_config_updated_at before update on public.fisio_config for each row execute function app.tg_updated_at();
create trigger auditoria_fisio_config after insert or update or delete on public.fisio_config for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Fisioterapeutas (ligados ao usuário do portal para assinar os registros)
-- -----------------------------------------------------------------------------
create table public.fisio_profissionais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete set null,
  nome text not null check (length(trim(nome)) between 3 and 120),
  -- Ex.: 123456-F
  crefito text not null check (crefito ~ '^[0-9A-Za-z./-]{1,15}$'),
  -- Região do CREFITO (1 a 20)
  crefito_regiao smallint not null check (crefito_regiao between 1 and 30),
  especialidade text check (especialidade is null or length(especialidade) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  -- Cor na agenda (#RRGGBB)
  cor text not null default '#2563eb' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  -- Repasse: percentual do valor das sessões realizadas
  repasse_percentual numeric(5, 2) not null default 0 check (repasse_percentual between 0 and 100),
  responsavel_tecnico boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_profissionais_empresa_id_unico unique (empresa_id, id)
);
create unique index fisio_profissionais_perfil_uk on public.fisio_profissionais (empresa_id, perfil_id) where perfil_id is not null;
create unique index fisio_profissionais_crefito_uk on public.fisio_profissionais (empresa_id, crefito_regiao, upper(crefito));
create trigger fisio_profissionais_updated_at before update on public.fisio_profissionais for each row execute function app.tg_updated_at();
create trigger auditoria_fisio_profissionais after insert or update or delete on public.fisio_profissionais for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 4. Pacientes (identificação do art. 1º, § 1º, I)
-- -----------------------------------------------------------------------------
create table public.fisio_pacientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 3 and 120),
  nome_social text check (nome_social is null or length(trim(nome_social)) between 2 and 120),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  nascimento date check (nascimento is null or nascimento between '1900-01-01' and '2100-01-01'),
  genero text check (genero is null or genero in ('feminino', 'masculino', 'outro', 'nao_informado')),
  estado_civil text check (estado_civil is null or estado_civil in ('solteiro', 'casado', 'uniao_estavel', 'divorciado', 'viuvo', 'outro')),
  -- Naturalidade (cidade/UF onde nasceu)
  naturalidade text check (naturalidade is null or length(naturalidade) <= 80),
  profissao text check (profissao is null or length(profissao) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  logradouro text check (logradouro is null or length(logradouro) <= 150),
  numero text check (numero is null or length(numero) <= 20),
  complemento text check (complemento is null or length(complemento) <= 80),
  bairro text check (bairro is null or length(bairro) <= 80),
  cidade text check (cidade is null or length(cidade) <= 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  -- Responsável legal (menor de idade) e contato de emergência
  responsavel text check (responsavel is null or length(responsavel) <= 120),
  contato_emergencia text check (contato_emergencia is null or length(contato_emergencia) <= 160),
  convenio text check (convenio is null or length(convenio) <= 80),
  carteirinha text check (carteirinha is null or length(carteirinha) <= 40),
  -- Médico que encaminhou (quando houver pedido médico)
  medico_encaminhador text check (medico_encaminhador is null or length(medico_encaminhador) <= 120),
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  aceita_whatsapp boolean not null default true,
  -- Consentimento para o tratamento dos dados de saúde (LGPD, art. 11, I), registrado pela recepção
  consentimento_em timestamptz,
  consentimento_por uuid references public.perfis(id) on delete set null,
  ativo boolean not null default true,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_pacientes_empresa_id_unico unique (empresa_id, id)
);
create unique index fisio_pacientes_cpf_uk on public.fisio_pacientes (empresa_id, cpf) where cpf is not null;
create index fisio_pacientes_nome_idx on public.fisio_pacientes using gin (app.normalizar(nome) extensions.gin_trgm_ops);
create trigger fisio_pacientes_updated_at before update on public.fisio_pacientes for each row execute function app.tg_updated_at();
create trigger auditoria_fisio_pacientes after insert or update or delete on public.fisio_pacientes for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 5. Pacotes de sessões (particular ou convênio)
-- -----------------------------------------------------------------------------
create table public.fisio_pacotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paciente_id uuid not null,
  descricao text not null check (length(trim(descricao)) between 2 and 120),
  sessoes int not null check (sessoes between 1 and 200),
  valor_total numeric(12, 2) not null default 0 check (valor_total >= 0),
  inicio date not null,
  validade date,
  convenio text check (convenio is null or length(convenio) <= 80),
  -- Número da guia ou da autorização do convênio
  guia text check (guia is null or length(guia) <= 40),
  status text not null default 'ativo' check (status in ('ativo', 'encerrado', 'cancelado')),
  observacao text check (observacao is null or length(observacao) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_pacotes_empresa_id_unico unique (empresa_id, id),
  constraint fisio_pacotes_validade check (validade is null or validade >= inicio),
  foreign key (empresa_id, paciente_id) references public.fisio_pacientes (empresa_id, id)
);
create index fisio_pacotes_paciente_idx on public.fisio_pacotes (paciente_id, created_at desc);
create trigger fisio_pacotes_updated_at before update on public.fisio_pacotes for each row execute function app.tg_updated_at();
create trigger auditoria_fisio_pacotes after insert or update or delete on public.fisio_pacotes for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 6. Agenda
-- -----------------------------------------------------------------------------
create table public.fisio_agenda (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  inicio timestamptz not null,
  duracao_min int not null default 50 check (duracao_min between 10 and 480),
  tipo text not null default 'sessao' check (tipo in ('avaliacao', 'sessao', 'reavaliacao', 'grupo', 'domiciliar', 'outro')),
  paciente_id uuid,
  -- Quem ainda não tem cadastro (primeira avaliação marcada por telefone)
  nome_avulso text check (nome_avulso is null or length(trim(nome_avulso)) between 2 and 120),
  telefone_avulso text check (telefone_avulso is null or telefone_avulso ~ '^[0-9]{10,13}$'),
  profissional_id uuid,
  pacote_id uuid,
  sala text check (sala is null or length(sala) <= 40),
  status text not null default 'agendado' check (status in ('agendado', 'confirmado', 'chegou', 'realizado', 'faltou', 'cancelado')),
  observacoes text check (observacoes is null or length(observacoes) <= 500),
  -- Sessões criadas juntas (repetição semanal)
  serie_id uuid,
  motivo text check (motivo is null or length(motivo) <= 300),
  confirmado_em timestamptz,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_agenda_empresa_id_unico unique (empresa_id, id),
  constraint fisio_agenda_quem check (paciente_id is not null or nome_avulso is not null),
  foreign key (empresa_id, paciente_id) references public.fisio_pacientes (empresa_id, id),
  foreign key (empresa_id, profissional_id) references public.fisio_profissionais (empresa_id, id),
  foreign key (empresa_id, pacote_id) references public.fisio_pacotes (empresa_id, id)
);
create index fisio_agenda_dia_idx on public.fisio_agenda (empresa_id, inicio);
create index fisio_agenda_paciente_idx on public.fisio_agenda (paciente_id, inicio desc);
create index fisio_agenda_pacote_idx on public.fisio_agenda (pacote_id) where pacote_id is not null;
create trigger fisio_agenda_updated_at before update on public.fisio_agenda for each row execute function app.tg_updated_at();
create trigger auditoria_fisio_agenda after insert or update or delete on public.fisio_agenda for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 7. Prontuário: avaliações (itens I a VI), evoluções e alta (item VII) e adendos
-- -----------------------------------------------------------------------------
create table public.fisio_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  paciente_id uuid not null,
  profissional_id uuid not null,
  agendamento_id uuid,
  tipo text not null default 'inicial' check (tipo in ('inicial', 'reavaliacao')),
  data_hora timestamptz not null default now(),
  -- II. História clínica
  queixa_principal text check (queixa_principal is null or length(queixa_principal) <= 2000),
  historia_atual text check (historia_atual is null or length(historia_atual) <= 5000),
  historia_pregressa text check (historia_pregressa is null or length(historia_pregressa) <= 5000),
  antecedentes text check (antecedentes is null or length(antecedentes) <= 3000),
  habitos text check (habitos is null or length(habitos) <= 2000),
  medicamentos text check (medicamentos is null or length(medicamentos) <= 2000),
  tratamentos_anteriores text check (tratamentos_anteriores is null or length(tratamentos_anteriores) <= 2000),
  -- III. Exame clínico/físico-funcional
  dor_eva smallint check (dor_eva is null or dor_eva between 0 and 10),
  dor_local text check (dor_local is null or length(dor_local) <= 300),
  exame_fisico text check (exame_fisico is null or length(exame_fisico) <= 10000),
  amplitude_movimento text check (amplitude_movimento is null or length(amplitude_movimento) <= 3000),
  forca_muscular text check (forca_muscular is null or length(forca_muscular) <= 3000),
  testes_especiais text check (testes_especiais is null or length(testes_especiais) <= 3000),
  -- IV. Exames complementares (já feitos e pedidos)
  exames_complementares text check (exames_complementares is null or length(exames_complementares) <= 3000),
  -- V. Diagnóstico e prognóstico fisioterapêuticos
  diagnostico text check (diagnostico is null or length(diagnostico) <= 3000),
  -- Código da CID do pedido médico, quando houver (o diagnóstico fisioterapêutico é o de cima)
  cid text check (cid is null or cid ~ '^[A-Z][0-9]{2}(\.?[0-9A-Z]{1,2})?$'),
  prognostico text check (prognostico is null or length(prognostico) <= 2000),
  -- VI. Plano terapêutico
  objetivos text check (objetivos is null or length(objetivos) <= 3000),
  condutas text check (condutas is null or length(condutas) <= 5000),
  frequencia_semanal smallint check (frequencia_semanal is null or frequencia_semanal between 1 and 14),
  sessoes_previstas smallint check (sessoes_previstas is null or sessoes_previstas between 1 and 500),
  status text not null default 'aberta' check (status in ('aberta', 'finalizada', 'cancelada')),
  finalizado_em timestamptz,
  finalizado_por uuid references public.perfis(id) on delete set null,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_avaliacoes_empresa_id_unico unique (empresa_id, id),
  constraint fisio_avaliacoes_numero_uk unique (empresa_id, numero),
  foreign key (empresa_id, paciente_id) references public.fisio_pacientes (empresa_id, id),
  foreign key (empresa_id, profissional_id) references public.fisio_profissionais (empresa_id, id),
  foreign key (empresa_id, agendamento_id) references public.fisio_agenda (empresa_id, id)
);
create index fisio_avaliacoes_paciente_idx on public.fisio_avaliacoes (paciente_id, data_hora desc);
create trigger fisio_avaliacoes_updated_at before update on public.fisio_avaliacoes for each row execute function app.tg_updated_at();

create table public.fisio_evolucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  paciente_id uuid not null,
  profissional_id uuid not null,
  agendamento_id uuid,
  -- Sessão comum ou alta (encerra o tratamento)
  tipo text not null default 'sessao' check (tipo in ('sessao', 'alta')),
  data_hora timestamptz not null default now(),
  -- SOAP
  subjetivo text check (subjetivo is null or length(subjetivo) <= 5000),
  objetivo text check (objetivo is null or length(objetivo) <= 5000),
  analise text check (analise is null or length(analise) <= 5000),
  plano text check (plano is null or length(plano) <= 5000),
  -- Recursos usados na sessão (cinesioterapia, eletroterapia, terapia manual...)
  condutas text[] not null default '{}' check (cardinality(condutas) <= 30),
  dor_antes smallint check (dor_antes is null or dor_antes between 0 and 10),
  dor_depois smallint check (dor_depois is null or dor_depois between 0 and 10),
  intercorrencias text check (intercorrencias is null or length(intercorrencias) <= 3000),
  orientacoes text check (orientacoes is null or length(orientacoes) <= 3000),
  alta_motivo text check (alta_motivo is null or alta_motivo in ('objetivos_alcancados', 'melhora_parcial', 'abandono', 'encaminhamento', 'pedido_paciente', 'outro')),
  status text not null default 'aberta' check (status in ('aberta', 'finalizada', 'cancelada')),
  finalizado_em timestamptz,
  finalizado_por uuid references public.perfis(id) on delete set null,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fisio_evolucoes_empresa_id_unico unique (empresa_id, id),
  constraint fisio_evolucoes_numero_uk unique (empresa_id, numero),
  constraint fisio_evolucoes_alta check ((tipo = 'alta') = (alta_motivo is not null)),
  foreign key (empresa_id, paciente_id) references public.fisio_pacientes (empresa_id, id),
  foreign key (empresa_id, profissional_id) references public.fisio_profissionais (empresa_id, id),
  foreign key (empresa_id, agendamento_id) references public.fisio_agenda (empresa_id, id)
);
create index fisio_evolucoes_paciente_idx on public.fisio_evolucoes (paciente_id, data_hora desc);
create unique index fisio_evolucoes_agendamento_uk on public.fisio_evolucoes (agendamento_id) where agendamento_id is not null and status <> 'cancelada';
create trigger fisio_evolucoes_updated_at before update on public.fisio_evolucoes for each row execute function app.tg_updated_at();

-- Prontuário sem rasuras: registro finalizado não muda; nada é apagado
create or replace function app.tg_fisio_registro_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Ações em cascata (exclusão da empresa, usuário removido) passam
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'O prontuário não pode ser apagado.';
  end if;
  if old.status = 'finalizada' then
    raise exception 'Registro finalizado não pode ser alterado. Registre um adendo.';
  end if;
  if old.status = 'cancelada' then
    raise exception 'Registro cancelado não pode ser alterado.';
  end if;
  return new;
end;
$$;
create trigger fisio_avaliacoes_imutavel before update or delete on public.fisio_avaliacoes
  for each row execute function app.tg_fisio_registro_imutavel();
create trigger fisio_evolucoes_imutavel before update or delete on public.fisio_evolucoes
  for each row execute function app.tg_fisio_registro_imutavel();

create table public.fisio_adendos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  avaliacao_id uuid,
  evolucao_id uuid,
  profissional_id uuid not null,
  texto text not null check (length(trim(texto)) between 3 and 5000),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint fisio_adendos_um check (num_nonnulls(avaliacao_id, evolucao_id) = 1),
  foreign key (empresa_id, avaliacao_id) references public.fisio_avaliacoes (empresa_id, id),
  foreign key (empresa_id, evolucao_id) references public.fisio_evolucoes (empresa_id, id),
  foreign key (empresa_id, profissional_id) references public.fisio_profissionais (empresa_id, id)
);
create index fisio_adendos_avaliacao_idx on public.fisio_adendos (avaliacao_id, created_at) where avaliacao_id is not null;
create index fisio_adendos_evolucao_idx on public.fisio_adendos (evolucao_id, created_at) where evolucao_id is not null;

create or replace function app.tg_fisio_somente_insercao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  raise exception 'Este registro do prontuário não pode ser alterado nem apagado.';
end;
$$;
create trigger fisio_adendos_somente_insercao before update or delete on public.fisio_adendos
  for each row execute function app.tg_fisio_somente_insercao();

-- -----------------------------------------------------------------------------
-- 8. Documentos do fisioterapeuta
-- -----------------------------------------------------------------------------
create table public.fisio_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  paciente_id uuid not null,
  profissional_id uuid not null,
  tipo text not null check (tipo in ('comparecimento', 'relatorio', 'encaminhamento', 'orientacoes', 'declaracao')),
  titulo text not null check (length(trim(titulo)) between 3 and 120),
  texto text not null check (length(trim(texto)) between 3 and 10000),
  emitido_em timestamptz not null default now(),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  constraint fisio_documentos_numero_uk unique (empresa_id, numero),
  foreign key (empresa_id, paciente_id) references public.fisio_pacientes (empresa_id, id),
  foreign key (empresa_id, profissional_id) references public.fisio_profissionais (empresa_id, id)
);
create index fisio_documentos_paciente_idx on public.fisio_documentos (paciente_id, emitido_em desc);

create or replace function app.tg_fisio_documento_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'O documento emitido não pode ser apagado. Cancele-o.';
  end if;
  if old.cancelado_em is not null
     or new.texto is distinct from old.texto or new.titulo is distinct from old.titulo or new.tipo is distinct from old.tipo
     or new.paciente_id is distinct from old.paciente_id or new.profissional_id is distinct from old.profissional_id
     or new.numero is distinct from old.numero or new.emitido_em is distinct from old.emitido_em then
    raise exception 'O documento emitido não pode ser alterado. Cancele e emita outro.';
  end if;
  return new;
end;
$$;
create trigger fisio_documentos_imutavel before update or delete on public.fisio_documentos
  for each row execute function app.tg_fisio_documento_imutavel();

-- -----------------------------------------------------------------------------
-- 9. Recebimentos (ligados ao Financeiro)
-- -----------------------------------------------------------------------------
create table public.fisio_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paciente_id uuid not null,
  pacote_id uuid,
  descricao text not null check (length(trim(descricao)) between 2 and 120),
  data date not null,
  forma text not null check (forma in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'a_receber', 'outro')),
  valor numeric(12, 2) not null check (valor > 0),
  vencimento date,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  observacao text check (observacao is null or length(observacao) <= 300),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  registrado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint fisio_recebimentos_a_receber check ((forma = 'a_receber') = (vencimento is not null)),
  foreign key (empresa_id, paciente_id) references public.fisio_pacientes (empresa_id, id),
  foreign key (empresa_id, pacote_id) references public.fisio_pacotes (empresa_id, id)
);
create index fisio_recebimentos_empresa_idx on public.fisio_recebimentos (empresa_id, data desc);
create index fisio_recebimentos_paciente_idx on public.fisio_recebimentos (paciente_id, data desc);
create trigger auditoria_fisio_recebimentos after insert or update or delete on public.fisio_recebimentos for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 10. Regras comuns
-- -----------------------------------------------------------------------------
create or replace function app.exigir_fisio(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, p_permissao);
  if coalesce((select modalidade from public.gestao_config where empresa_id = p_empresa_id), '') <> 'fisioterapia' then
    raise exception 'A gestão da clínica de fisioterapia não está ligada para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

-- Quem usa o portal é fisioterapeuta ativo desta clínica? (leitura do prontuário)
create or replace function app.fisio_e_profissional(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.usuario_valido() and exists (
    select 1 from public.fisio_profissionais p
     where p.empresa_id = p_empresa_id and p.perfil_id = auth.uid() and p.ativo
  ) and exists (
    select 1 from public.gestao_config g where g.empresa_id = p_empresa_id and g.ativa and g.modalidade = 'fisioterapia'
  );
$$;

-- Fisioterapeuta ligado a quem está usando o portal (os registros clínicos são assinados por ele)
create or replace function app.fisio_profissional_do_usuario(p_empresa_id uuid)
returns public.fisio_profissionais
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.fisio_profissionais;
begin
  if coalesce((select modalidade from public.gestao_config where empresa_id = p_empresa_id and ativa), '') <> 'fisioterapia' then
    raise exception 'A gestão da clínica de fisioterapia não está ligada para esta empresa. Fale com o escritório.';
  end if;
  select * into v from public.fisio_profissionais where empresa_id = p_empresa_id and perfil_id = auth.uid() and ativo;
  if v.id is null or not app.usuario_valido() then
    raise exception 'Só o fisioterapeuta cadastrado na clínica, com o próprio usuário, registra no prontuário. Peça ao responsável para ligar o seu usuário ao seu CREFITO em Configurações da clínica.';
  end if;
  return v;
end;
$$;

-- Configuração da clínica (cria a padrão na primeira vez)
create or replace function app.fisio_cfg(p_empresa_id uuid)
returns public.fisio_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fisio_config;
begin
  select * into v from public.fisio_config where empresa_id = p_empresa_id;
  if v.empresa_id is null then
    insert into public.fisio_config (empresa_id, mensagem_confirmacao) values (
      p_empresa_id,
      'Olá, {paciente}! Aqui é da {clinica}. Confirmando a sua sessão de fisioterapia em {data} às {hora} com {profissional}. Pode confirmar?'
    ) on conflict (empresa_id) do nothing;
    select * into v from public.fisio_config where empresa_id = p_empresa_id;
  end if;
  return v;
end;
$$;

-- Próximo número (registro do prontuário ou documento), com a configuração travada
create or replace function app.fisio_proximo_numero(p_empresa_id uuid, p_tipo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  perform app.fisio_cfg(p_empresa_id);
  if p_tipo = 'registro' then
    update public.fisio_config set proximo_numero_registro = proximo_numero_registro + 1 where empresa_id = p_empresa_id
      returning proximo_numero_registro - 1 into v;
  elsif p_tipo = 'documento' then
    update public.fisio_config set proximo_numero_documento = proximo_numero_documento + 1 where empresa_id = p_empresa_id
      returning proximo_numero_documento - 1 into v;
  else
    raise exception 'Numeração desconhecida.';
  end if;
  return v;
end;
$$;

-- Sessões usadas de um pacote (realizadas; faltas, se a clínica descontar)
create or replace function app.fisio_sessoes_usadas(p_pacote_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.fisio_agenda a
    join public.fisio_config c on c.empresa_id = a.empresa_id
   where a.pacote_id = p_pacote_id
     and (a.status = 'realizado' or (a.status = 'faltou' and c.falta_desconta_sessao));
$$;

-- -----------------------------------------------------------------------------
-- 11. Ligar a modalidade (gestao_configurar aceita "fisioterapia")
-- -----------------------------------------------------------------------------
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
  v_modalidade text;
  v_desc numeric := nullif(p_dados ->> 'desconto_maximo_operador', '')::numeric;
  v_dinheiro uuid := nullif(p_dados ->> 'conta_dinheiro_id', '')::uuid;
  v_pix uuid := nullif(p_dados ->> 'conta_pix_id', '')::uuid;
  v_cartao uuid := nullif(p_dados ->> 'conta_cartao_id', '')::uuid;
  v_nfe_op uuid;
  v_nfe_emit uuid;
begin
  select * into v_atual from public.gestao_config where empresa_id = p_empresa_id;
  if v_equipe then
    v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_atual.ativa, false);
    v_perfil := coalesce(nullif(p_dados ->> 'perfil_fiscal', ''), v_atual.perfil_fiscal, 'comercio');
    v_modalidade := coalesce(nullif(p_dados ->> 'modalidade', ''), v_atual.modalidade, 'loja');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
    v_ativa := v_atual.ativa;
    v_perfil := v_atual.perfil_fiscal;
    v_modalidade := v_atual.modalidade;
  end if;
  if v_modalidade not in ('loja', 'notas', 'hotel', 'veterinaria', 'fisioterapia') then
    raise exception 'Escolha a modalidade: loja completa, notas e transporte, hotel, clínica veterinária ou clínica de fisioterapia.';
  end if;

  -- As contas do caixa, do banco e da maquininha: loja completa, hotel e clínicas (recepção e loja)
  if v_ativa and v_modalidade in ('loja', 'hotel', 'veterinaria', 'fisioterapia') then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', case v_modalidade
      when 'hotel' then 'Caixa da recepção' when 'veterinaria' then 'Caixa da clínica' when 'fisioterapia' then 'Caixa da clínica' else 'Caixa da loja' end));
    v_pix := coalesce(v_pix, v_atual.conta_pix_id, app.gestao_conta(p_empresa_id, 'conta_corrente', 'Banco (PIX e transferências)'));
    v_cartao := coalesce(v_cartao, v_atual.conta_cartao_id, app.gestao_conta(p_empresa_id, 'adquirente', 'Maquininha de cartão'));
  end if;
  -- NF-e na hora da venda: operação fiscal e inscrição que emite (da própria empresa)
  v_nfe_op := case when p_dados ? 'nfe_operacao_id' then nullif(p_dados ->> 'nfe_operacao_id', '')::uuid else v_atual.nfe_operacao_id end;
  v_nfe_emit := case when p_dados ? 'nfe_emitente_id' then nullif(p_dados ->> 'nfe_emitente_id', '')::uuid else v_atual.nfe_emitente_id end;
  if v_nfe_op is not null and not exists (select 1 from public.nfe_operacoes where id = v_nfe_op and empresa_id = p_empresa_id and ativa) then
    raise exception 'A operação da NF-e escolhida não é desta empresa ou está desativada.';
  end if;
  if v_nfe_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_nfe_emit and empresa_id = p_empresa_id and ativo) then
    raise exception 'A inscrição que emite a NF-e não é desta empresa ou está desativada.';
  end if;
  if (v_dinheiro is not null and v_dinheiro in (v_pix, v_cartao)) then
    raise exception 'A conta do dinheiro precisa ser diferente da conta do PIX e da maquininha.';
  end if;

  insert into public.gestao_config as g (
    empresa_id, ativa, perfil_fiscal, permitir_estoque_negativo, permitir_venda_prazo, desconto_maximo_operador,
    conta_dinheiro_id, conta_pix_id, conta_cartao_id, validade_orcamento_dias, mensagem_comprovante, ativada_por, ativada_em,
    nfe_operacao_id, nfe_emitente_id, nfe_marcada_padrao, modalidade
  ) values (
    p_empresa_id, v_ativa, v_perfil,
    coalesce((p_dados ->> 'permitir_estoque_negativo')::boolean, v_atual.permitir_estoque_negativo, false),
    coalesce((p_dados ->> 'permitir_venda_prazo')::boolean, v_atual.permitir_venda_prazo, true),
    case when p_dados ? 'desconto_maximo_operador' then v_desc else v_atual.desconto_maximo_operador end,
    v_dinheiro, v_pix, v_cartao,
    coalesce((p_dados ->> 'validade_orcamento_dias')::int, v_atual.validade_orcamento_dias, 15),
    case when p_dados ? 'mensagem_comprovante' then nullif(trim(p_dados ->> 'mensagem_comprovante'), '') else v_atual.mensagem_comprovante end,
    case when v_ativa then auth.uid() end, case when v_ativa then now() end,
    v_nfe_op, v_nfe_emit, coalesce((p_dados ->> 'nfe_marcada_padrao')::boolean, v_atual.nfe_marcada_padrao, false), v_modalidade
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
    nfe_operacao_id = excluded.nfe_operacao_id,
    nfe_emitente_id = excluded.nfe_emitente_id,
    nfe_marcada_padrao = excluded.nfe_marcada_padrao,
    modalidade = excluded.modalidade,
    atualizado_por = auth.uid();

  if v_ativa and v_modalidade = 'hotel' then
    perform app.hotel_cfg(p_empresa_id);
  end if;
  if v_ativa and v_modalidade = 'veterinaria' then
    perform app.vet_cfg(p_empresa_id);
  end if;
  if v_ativa and v_modalidade = 'fisioterapia' then
    perform app.fisio_cfg(p_empresa_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Configurações e fisioterapeutas (responsável: gestao.gerenciar)
-- -----------------------------------------------------------------------------
create or replace function public.fisio_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.gerenciar');
  perform app.fisio_cfg(p_empresa_id);
  update public.fisio_config set
    nome_clinica = app.vet_texto(p_dados, 'nome_clinica', 120),
    registro_crefito = app.vet_texto(p_dados, 'registro_crefito', 30),
    telefone = app.vet_digitos(p_dados, 'telefone'),
    email = lower(app.vet_texto(p_dados, 'email', 200)),
    endereco = app.vet_texto(p_dados, 'endereco', 300),
    cidade_documentos = app.vet_texto(p_dados, 'cidade_documentos', 80),
    horario_inicio = coalesce(nullif(p_dados ->> 'horario_inicio', '')::time, horario_inicio),
    horario_fim = coalesce(nullif(p_dados ->> 'horario_fim', '')::time, horario_fim),
    duracao_padrao_min = coalesce(nullif(p_dados ->> 'duracao_padrao_min', '')::int, duracao_padrao_min),
    valor_sessao = coalesce(app.vet_numero(p_dados, 'valor_sessao', 'valor da sessão'), valor_sessao),
    falta_desconta_sessao = coalesce((p_dados ->> 'falta_desconta_sessao')::boolean, falta_desconta_sessao),
    mensagem_confirmacao = app.vet_texto(p_dados, 'mensagem_confirmacao', 600),
    atualizado_por = auth.uid()
  where empresa_id = p_empresa_id;
end;
$$;

create or replace function public.fisio_profissional_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_perfil uuid := nullif(p_dados ->> 'perfil_id', '')::uuid;
  v_crefito text := upper(app.vet_texto(p_dados, 'crefito', 15));
  v_regiao smallint := nullif(p_dados ->> 'crefito_regiao', '')::smallint;
  v_repasse numeric := coalesce(app.vet_numero(p_dados, 'repasse_percentual', 'repasse'), 0);
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.gerenciar');
  if app.vet_texto(p_dados, 'nome', 120) is null or length(app.vet_texto(p_dados, 'nome', 120)) < 3 then
    raise exception 'Informe o nome do fisioterapeuta.';
  end if;
  if v_crefito is null or v_crefito !~ '^[0-9A-Z./-]{1,15}$' then
    raise exception 'Informe o número do CREFITO (ex.: 123456-F).';
  end if;
  if v_regiao is null or v_regiao not between 1 and 30 then
    raise exception 'Informe a região do CREFITO (ex.: 11).';
  end if;
  if v_repasse < 0 or v_repasse > 100 then
    raise exception 'O repasse vai de 0 a 100%%.';
  end if;
  -- Só um usuário com acesso a esta empresa pode ser ligado ao fisioterapeuta
  if v_perfil is not null and not exists (
    select 1 from public.empresa_membros m where m.empresa_id = p_empresa_id and m.user_id = v_perfil and m.ativo
  ) then
    raise exception 'Escolha um usuário que já tem acesso a esta empresa.';
  end if;
  if p_id is not null and not exists (select 1 from public.fisio_profissionais where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Fisioterapeuta não encontrado.';
  end if;
  insert into public.fisio_profissionais as f (id, empresa_id, perfil_id, nome, crefito, crefito_regiao, especialidade, telefone, email, cor, repasse_percentual, responsavel_tecnico, ativo)
  values (
    coalesce(p_id, gen_random_uuid()), p_empresa_id, v_perfil, app.vet_texto(p_dados, 'nome', 120), v_crefito, v_regiao,
    app.vet_texto(p_dados, 'especialidade', 80), app.vet_digitos(p_dados, 'telefone'), lower(app.vet_texto(p_dados, 'email', 200)),
    coalesce(nullif(p_dados ->> 'cor', ''), '#2563eb'), v_repasse,
    coalesce((p_dados ->> 'responsavel_tecnico')::boolean, false), coalesce((p_dados ->> 'ativo')::boolean, true)
  )
  on conflict (id) do update set
    perfil_id = excluded.perfil_id,
    nome = excluded.nome,
    crefito = excluded.crefito,
    crefito_regiao = excluded.crefito_regiao,
    especialidade = excluded.especialidade,
    telefone = excluded.telefone,
    email = excluded.email,
    cor = excluded.cor,
    repasse_percentual = excluded.repasse_percentual,
    responsavel_tecnico = excluded.responsavel_tecnico,
    ativo = excluded.ativo
  returning f.id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um fisioterapeuta com este CREFITO ou ligado a este usuário.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 13. Pacientes e pacotes (recepção: gestao.vender)
-- -----------------------------------------------------------------------------
create or replace function public.fisio_paciente_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_atual public.fisio_pacientes;
  v_cpf text := app.vet_digitos(p_dados, 'cpf');
  v_consentiu boolean := coalesce((p_dados ->> 'consentimento')::boolean, false);
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.vender');
  if p_id is not null then
    select * into v_atual from public.fisio_pacientes where id = p_id and empresa_id = p_empresa_id;
    if v_atual.id is null then
      raise exception 'Paciente não encontrado.';
    end if;
  end if;
  if app.vet_texto(p_dados, 'nome', 120) is null or length(app.vet_texto(p_dados, 'nome', 120)) < 3 then
    raise exception 'Informe o nome completo do paciente.';
  end if;
  if v_cpf is not null and not app.cpf_valido(v_cpf) then
    raise exception 'CPF inválido.';
  end if;
  insert into public.fisio_pacientes as p (
    id, empresa_id, nome, nome_social, cpf, nascimento, genero, estado_civil, naturalidade, profissao, telefone, email,
    cep, logradouro, numero, complemento, bairro, cidade, uf, responsavel, contato_emergencia, convenio, carteirinha,
    medico_encaminhador, observacoes, aceita_whatsapp, consentimento_em, consentimento_por, ativo
  ) values (
    coalesce(p_id, gen_random_uuid()), p_empresa_id, app.vet_texto(p_dados, 'nome', 120), app.vet_texto(p_dados, 'nome_social', 120), v_cpf,
    nullif(p_dados ->> 'nascimento', '')::date, nullif(p_dados ->> 'genero', ''), nullif(p_dados ->> 'estado_civil', ''),
    app.vet_texto(p_dados, 'naturalidade', 80), app.vet_texto(p_dados, 'profissao', 80), app.vet_digitos(p_dados, 'telefone'),
    lower(app.vet_texto(p_dados, 'email', 200)), app.vet_digitos(p_dados, 'cep'), app.vet_texto(p_dados, 'logradouro', 150),
    app.vet_texto(p_dados, 'numero', 20), app.vet_texto(p_dados, 'complemento', 80), app.vet_texto(p_dados, 'bairro', 80),
    app.vet_texto(p_dados, 'cidade', 80), upper(app.vet_texto(p_dados, 'uf', 2)), app.vet_texto(p_dados, 'responsavel', 120),
    app.vet_texto(p_dados, 'contato_emergencia', 160), app.vet_texto(p_dados, 'convenio', 80), app.vet_texto(p_dados, 'carteirinha', 40),
    app.vet_texto(p_dados, 'medico_encaminhador', 120), app.vet_texto(p_dados, 'observacoes', 1000),
    coalesce((p_dados ->> 'aceita_whatsapp')::boolean, true),
    case when v_consentiu then coalesce(v_atual.consentimento_em, now()) else null end,
    case when v_consentiu then coalesce(v_atual.consentimento_por, auth.uid()) else null end,
    coalesce((p_dados ->> 'ativo')::boolean, true)
  )
  on conflict (id) do update set
    nome = excluded.nome, nome_social = excluded.nome_social, cpf = excluded.cpf, nascimento = excluded.nascimento,
    genero = excluded.genero, estado_civil = excluded.estado_civil, naturalidade = excluded.naturalidade, profissao = excluded.profissao,
    telefone = excluded.telefone, email = excluded.email, cep = excluded.cep, logradouro = excluded.logradouro, numero = excluded.numero,
    complemento = excluded.complemento, bairro = excluded.bairro, cidade = excluded.cidade, uf = excluded.uf,
    responsavel = excluded.responsavel, contato_emergencia = excluded.contato_emergencia, convenio = excluded.convenio,
    carteirinha = excluded.carteirinha, medico_encaminhador = excluded.medico_encaminhador, observacoes = excluded.observacoes,
    aceita_whatsapp = excluded.aceita_whatsapp, consentimento_em = excluded.consentimento_em,
    consentimento_por = excluded.consentimento_por, ativo = excluded.ativo
  returning p.id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Já existe um paciente com este CPF.';
end;
$$;

create or replace function public.fisio_pacote_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_paciente uuid := nullif(p_dados ->> 'paciente_id', '')::uuid;
  v_sessoes int := nullif(p_dados ->> 'sessoes', '')::int;
  v_valor numeric := coalesce(app.vet_numero(p_dados, 'valor_total', 'valor do pacote'), 0);
  v_status text := coalesce(nullif(p_dados ->> 'status', ''), 'ativo');
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.vender');
  if p_id is not null then
    select paciente_id into v_paciente from public.fisio_pacotes where id = p_id and empresa_id = p_empresa_id;
    if v_paciente is null then
      raise exception 'Pacote não encontrado.';
    end if;
  elsif v_paciente is null or not exists (select 1 from public.fisio_pacientes where id = v_paciente and empresa_id = p_empresa_id) then
    raise exception 'Escolha o paciente.';
  end if;
  if v_sessoes is null or v_sessoes not between 1 and 200 then
    raise exception 'Informe quantas sessões o pacote tem (1 a 200).';
  end if;
  if v_valor < 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Valor do pacote inválido.';
  end if;
  if v_status not in ('ativo', 'encerrado', 'cancelado') then
    raise exception 'Situação do pacote inválida.';
  end if;
  if p_id is not null and v_sessoes < app.fisio_sessoes_usadas(p_id) then
    raise exception 'O pacote já usou % sessões: não dá para deixá-lo com menos.', app.fisio_sessoes_usadas(p_id);
  end if;
  insert into public.fisio_pacotes as k (id, empresa_id, paciente_id, descricao, sessoes, valor_total, inicio, validade, convenio, guia, status, observacao)
  values (
    coalesce(p_id, gen_random_uuid()), p_empresa_id, v_paciente,
    coalesce(app.vet_texto(p_dados, 'descricao', 120), 'Pacote de ' || v_sessoes || ' sessões'), v_sessoes, v_valor,
    coalesce(nullif(p_dados ->> 'inicio', '')::date, app.hoje()), nullif(p_dados ->> 'validade', '')::date,
    app.vet_texto(p_dados, 'convenio', 80), app.vet_texto(p_dados, 'guia', 40), v_status, app.vet_texto(p_dados, 'observacao', 300)
  )
  on conflict (id) do update set
    descricao = excluded.descricao, sessoes = excluded.sessoes, valor_total = excluded.valor_total, inicio = excluded.inicio,
    validade = excluded.validade, convenio = excluded.convenio, guia = excluded.guia, status = excluded.status, observacao = excluded.observacao
  returning k.id into v_id;
  return v_id;
end;
$$;

-- Pacotes do paciente com as sessões usadas (para a recepção e os fisioterapeutas)
create or replace function public.fisio_pacotes_resumo(p_empresa_id uuid, p_paciente_id uuid default null)
returns table (id uuid, paciente_id uuid, descricao text, sessoes int, usadas int, agendadas int, valor_total numeric, inicio date, validade date,
               convenio text, guia text, status text, recebido numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.paciente_id, k.descricao, k.sessoes, app.fisio_sessoes_usadas(k.id),
         (select count(*)::int from public.fisio_agenda a where a.pacote_id = k.id and a.status in ('agendado', 'confirmado', 'chegou')),
         k.valor_total, k.inicio, k.validade, k.convenio, k.guia, k.status,
         coalesce((select sum(r.valor) from public.fisio_recebimentos r where r.pacote_id = k.id and r.cancelado_em is null), 0)
    from public.fisio_pacotes k
   where k.empresa_id = p_empresa_id
     and (p_paciente_id is null or k.paciente_id = p_paciente_id)
     and (app.pode(p_empresa_id, 'gestao.vender') or app.fisio_e_profissional(p_empresa_id))
   order by (k.status = 'ativo') desc, k.created_at desc;
$$;

-- -----------------------------------------------------------------------------
-- 14. Agenda (recepção)
-- -----------------------------------------------------------------------------
create or replace function app.fisio_choque(p_empresa_id uuid, p_profissional_id uuid, p_inicio timestamptz, p_duracao int, p_ignorar uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.nome, a.nome_avulso) || ' às ' || to_char(a.inicio at time zone 'America/Araguaina', 'HH24:MI')
    from public.fisio_agenda a
    left join public.fisio_pacientes p on p.id = a.paciente_id
   where a.empresa_id = p_empresa_id
     and a.profissional_id = p_profissional_id
     and a.status not in ('cancelado', 'faltou')
     and a.tipo <> 'grupo'
     and (p_ignorar is null or a.id <> p_ignorar)
     and tstzrange(a.inicio, a.inicio + make_interval(mins => a.duracao_min)) && tstzrange(p_inicio, p_inicio + make_interval(mins => p_duracao))
   order by a.inicio
   limit 1;
$$;

-- Agenda (ou altera) um horário. Na criação, "dias_semana" (1 = segunda ... 7 = domingo) e "semanas"
-- repetem a sessão (ex.: seg, qua e sex por 4 semanas), a partir do dia escolhido.
create or replace function public.fisio_agenda_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.fisio_agenda;
  v_cfg public.fisio_config;
  v_paciente uuid := nullif(p_dados ->> 'paciente_id', '')::uuid;
  v_prof uuid := nullif(p_dados ->> 'profissional_id', '')::uuid;
  v_pacote uuid := nullif(p_dados ->> 'pacote_id', '')::uuid;
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'sessao');
  v_inicio timestamptz := nullif(p_dados ->> 'inicio', '')::timestamptz;
  v_duracao int;
  v_dias int[];
  v_semanas int := greatest(coalesce(nullif(p_dados ->> 'semanas', '')::int, 1), 1);
  v_serie uuid;
  v_datas timestamptz[] := '{}';
  v_d timestamptz;
  v_i int;
  v_choque text;
  v_hora_local time;
  v_criados int := 0;
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.vender');
  v_cfg := app.fisio_cfg(p_empresa_id);
  v_duracao := coalesce(nullif(p_dados ->> 'duracao_min', '')::int, v_cfg.duracao_padrao_min);
  if p_id is not null then
    select * into a from public.fisio_agenda where id = p_id and empresa_id = p_empresa_id for update;
    if a.id is null then
      raise exception 'Agendamento não encontrado.';
    end if;
    if a.status not in ('agendado', 'confirmado', 'chegou') then
      raise exception 'Este horário já foi encerrado (realizado, falta ou cancelado).';
    end if;
  end if;
  if v_inicio is null then
    raise exception 'Escolha o dia e a hora.';
  end if;
  if v_tipo not in ('avaliacao', 'sessao', 'reavaliacao', 'grupo', 'domiciliar', 'outro') then
    raise exception 'Tipo de atendimento inválido.';
  end if;
  if v_duracao not between 10 and 480 then
    raise exception 'Duração de 10 a 480 minutos.';
  end if;
  if v_paciente is not null and not exists (select 1 from public.fisio_pacientes where id = v_paciente and empresa_id = p_empresa_id and ativo) then
    raise exception 'Paciente não encontrado.';
  end if;
  if v_paciente is null and app.vet_texto(p_dados, 'nome_avulso', 120) is null then
    raise exception 'Escolha o paciente ou escreva o nome de quem vem.';
  end if;
  if v_prof is null or not exists (select 1 from public.fisio_profissionais where id = v_prof and empresa_id = p_empresa_id and ativo) then
    raise exception 'Escolha o fisioterapeuta.';
  end if;
  -- Pacote: o informado (do mesmo paciente) ou o ativo do paciente
  if v_pacote is not null and not exists (
    select 1 from public.fisio_pacotes where id = v_pacote and empresa_id = p_empresa_id and paciente_id = v_paciente and status = 'ativo'
  ) then
    raise exception 'O pacote escolhido não é deste paciente ou não está ativo.';
  end if;
  if v_pacote is null and v_paciente is not null and v_tipo in ('sessao', 'grupo', 'domiciliar') and not (p_dados ? 'pacote_id') then
    select id into v_pacote from public.fisio_pacotes
     where empresa_id = p_empresa_id and paciente_id = v_paciente and status = 'ativo'
     order by created_at limit 1;
  end if;

  if p_id is not null then
    v_choque := app.fisio_choque(p_empresa_id, v_prof, v_inicio, v_duracao, p_id);
    if v_choque is not null and v_tipo <> 'grupo' and not coalesce((p_dados ->> 'permitir_choque')::boolean, false) then
      raise exception 'O fisioterapeuta já tem horário neste período (%).', v_choque;
    end if;
    update public.fisio_agenda set
      inicio = v_inicio, duracao_min = v_duracao, tipo = v_tipo, paciente_id = v_paciente,
      nome_avulso = case when v_paciente is null then app.vet_texto(p_dados, 'nome_avulso', 120) end,
      telefone_avulso = case when v_paciente is null then app.vet_digitos(p_dados, 'telefone_avulso') end,
      profissional_id = v_prof, pacote_id = v_pacote, sala = app.vet_texto(p_dados, 'sala', 40),
      observacoes = app.vet_texto(p_dados, 'observacoes', 500)
    where id = p_id;
    return 1;
  end if;

  -- Datas: a escolhida e, com repetição, os mesmos horários nos dias marcados das semanas seguintes
  v_dias := coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(p_dados -> 'dias_semana', '[]'::jsonb)) x), '{}');
  if v_semanas > 12 then
    raise exception 'Repita por no máximo 12 semanas.';
  end if;
  if cardinality(v_dias) = 0 then
    v_datas := array[v_inicio];
    if v_semanas > 1 then
      for v_i in 1..v_semanas - 1 loop
        v_datas := v_datas || (v_inicio + make_interval(days => 7 * v_i));
      end loop;
    end if;
  else
    if exists (select 1 from unnest(v_dias) d where d not between 1 and 7) then
      raise exception 'Dias da semana inválidos.';
    end if;
    v_hora_local := (v_inicio at time zone 'America/Araguaina')::time;
    for v_i in 0..(7 * v_semanas - 1) loop
      v_d := ((((v_inicio at time zone 'America/Araguaina')::date + v_i) + v_hora_local) at time zone 'America/Araguaina');
      if extract(isodow from (v_d at time zone 'America/Araguaina'))::int = any (v_dias) then
        v_datas := v_datas || v_d;
      end if;
    end loop;
  end if;
  if cardinality(v_datas) = 0 then
    raise exception 'Nenhum dia escolhido cai no período.';
  end if;
  if cardinality(v_datas) > 60 then
    raise exception 'No máximo 60 horários de uma vez.';
  end if;
  -- Nenhum horário entra se algum chocar (a recepção decide antes)
  if v_tipo <> 'grupo' and not coalesce((p_dados ->> 'permitir_choque')::boolean, false) then
    foreach v_d in array v_datas loop
      v_choque := app.fisio_choque(p_empresa_id, v_prof, v_d, v_duracao, null);
      if v_choque is not null then
        raise exception 'O fisioterapeuta já tem horário em % (%). Escolha outro horário ou outro fisioterapeuta.',
          to_char(v_d at time zone 'America/Araguaina', 'DD/MM'), v_choque;
      end if;
    end loop;
  end if;
  v_serie := case when cardinality(v_datas) > 1 then gen_random_uuid() end;
  foreach v_d in array v_datas loop
    insert into public.fisio_agenda (empresa_id, inicio, duracao_min, tipo, paciente_id, nome_avulso, telefone_avulso, profissional_id, pacote_id, sala, observacoes, serie_id)
    values (
      p_empresa_id, v_d, v_duracao, v_tipo, v_paciente,
      case when v_paciente is null then app.vet_texto(p_dados, 'nome_avulso', 120) end,
      case when v_paciente is null then app.vet_digitos(p_dados, 'telefone_avulso') end,
      v_prof, v_pacote, app.vet_texto(p_dados, 'sala', 40), app.vet_texto(p_dados, 'observacoes', 500), v_serie
    );
    v_criados := v_criados + 1;
  end loop;
  return v_criados;
end;
$$;

-- Confirmado, chegou, faltou ou cancelado ("realizado" vem da evolução finalizada).
-- Com "toda_serie", cancela também os próximos horários da mesma repetição.
create or replace function public.fisio_agenda_status(p_agenda_id uuid, p_status text, p_motivo text default null, p_toda_serie boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.fisio_agenda;
begin
  select * into a from public.fisio_agenda where id = p_agenda_id for update;
  if a.id is null then
    raise exception 'Agendamento não encontrado.';
  end if;
  perform app.exigir_fisio(a.empresa_id, 'gestao.vender');
  if p_status not in ('agendado', 'confirmado', 'chegou', 'faltou', 'cancelado') then
    raise exception 'Situação inválida.';
  end if;
  if a.status = 'realizado' then
    raise exception 'A sessão já foi realizada (evolução registrada).';
  end if;
  if p_status = 'cancelado' and length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.fisio_agenda set
    status = p_status,
    motivo = case when p_status in ('cancelado', 'faltou') then left(nullif(trim(coalesce(p_motivo, '')), ''), 300) else motivo end,
    confirmado_em = case when p_status = 'confirmado' then now() else confirmado_em end
  where id = a.id;
  if p_toda_serie and p_status = 'cancelado' and a.serie_id is not null then
    update public.fisio_agenda set status = 'cancelado', motivo = left(trim(p_motivo), 300)
     where serie_id = a.serie_id and inicio > a.inicio and status in ('agendado', 'confirmado');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. Prontuário (só o fisioterapeuta ligado ao próprio usuário registra)
-- -----------------------------------------------------------------------------
create or replace function public.fisio_avaliacao_abrir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof public.fisio_profissionais := app.fisio_profissional_do_usuario(p_empresa_id);
  v_paciente uuid := nullif(p_dados ->> 'paciente_id', '')::uuid;
  v_ag public.fisio_agenda;
  v_id uuid;
begin
  if nullif(p_dados ->> 'agendamento_id', '') is not null then
    select * into v_ag from public.fisio_agenda where id = (p_dados ->> 'agendamento_id')::uuid and empresa_id = p_empresa_id;
    if v_ag.id is null or v_ag.paciente_id is null then
      raise exception 'Agendamento não encontrado ou sem paciente cadastrado.';
    end if;
    select id into v_id from public.fisio_avaliacoes where agendamento_id = v_ag.id and status <> 'cancelada';
    if v_id is not null then
      return v_id;
    end if;
    v_paciente := v_ag.paciente_id;
  end if;
  if v_paciente is null or not exists (select 1 from public.fisio_pacientes where id = v_paciente and empresa_id = p_empresa_id) then
    raise exception 'Escolha o paciente.';
  end if;
  insert into public.fisio_avaliacoes (empresa_id, numero, paciente_id, profissional_id, agendamento_id, tipo)
  values (
    p_empresa_id, app.fisio_proximo_numero(p_empresa_id, 'registro'), v_paciente, v_prof.id, v_ag.id,
    case when coalesce(p_dados ->> 'tipo', v_ag.tipo) = 'reavaliacao' then 'reavaliacao' else 'inicial' end
  ) returning id into v_id;
  if v_ag.id is not null and v_ag.status in ('agendado', 'confirmado') then
    update public.fisio_agenda set status = 'chegou' where id = v_ag.id;
  end if;
  return v_id;
end;
$$;

create or replace function public.fisio_avaliacao_salvar(p_avaliacao_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  av public.fisio_avaliacoes;
  v_prof public.fisio_profissionais;
  v_eva smallint := nullif(p_dados ->> 'dor_eva', '')::smallint;
  v_cid text := upper(replace(app.vet_texto(p_dados, 'cid', 8), ' ', ''));
begin
  select * into av from public.fisio_avaliacoes where id = p_avaliacao_id for update;
  if av.id is null then
    raise exception 'Avaliação não encontrada.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(av.empresa_id);
  if av.profissional_id <> v_prof.id then
    raise exception 'Só quem abriu a avaliação pode preenchê-la. Registre um adendo, se precisar.';
  end if;
  if v_eva is not null and v_eva not between 0 and 10 then
    raise exception 'A dor vai de 0 a 10.';
  end if;
  if v_cid is not null and v_cid !~ '^[A-Z][0-9]{2}(\.?[0-9A-Z]{1,2})?$' then
    raise exception 'CID inválida (ex.: M54.5).';
  end if;
  update public.fisio_avaliacoes set
    queixa_principal = app.vet_texto(p_dados, 'queixa_principal', 2000),
    historia_atual = app.vet_texto(p_dados, 'historia_atual', 5000),
    historia_pregressa = app.vet_texto(p_dados, 'historia_pregressa', 5000),
    antecedentes = app.vet_texto(p_dados, 'antecedentes', 3000),
    habitos = app.vet_texto(p_dados, 'habitos', 2000),
    medicamentos = app.vet_texto(p_dados, 'medicamentos', 2000),
    tratamentos_anteriores = app.vet_texto(p_dados, 'tratamentos_anteriores', 2000),
    dor_eva = v_eva,
    dor_local = app.vet_texto(p_dados, 'dor_local', 300),
    exame_fisico = app.vet_texto(p_dados, 'exame_fisico', 10000),
    amplitude_movimento = app.vet_texto(p_dados, 'amplitude_movimento', 3000),
    forca_muscular = app.vet_texto(p_dados, 'forca_muscular', 3000),
    testes_especiais = app.vet_texto(p_dados, 'testes_especiais', 3000),
    exames_complementares = app.vet_texto(p_dados, 'exames_complementares', 3000),
    diagnostico = app.vet_texto(p_dados, 'diagnostico', 3000),
    cid = v_cid,
    prognostico = app.vet_texto(p_dados, 'prognostico', 2000),
    objetivos = app.vet_texto(p_dados, 'objetivos', 3000),
    condutas = app.vet_texto(p_dados, 'condutas', 5000),
    frequencia_semanal = nullif(p_dados ->> 'frequencia_semanal', '')::smallint,
    sessoes_previstas = nullif(p_dados ->> 'sessoes_previstas', '')::smallint
  where id = av.id;
end;
$$;

create or replace function public.fisio_avaliacao_finalizar(p_avaliacao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  av public.fisio_avaliacoes;
  v_prof public.fisio_profissionais;
begin
  select * into av from public.fisio_avaliacoes where id = p_avaliacao_id for update;
  if av.id is null then
    raise exception 'Avaliação não encontrada.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(av.empresa_id);
  if av.profissional_id <> v_prof.id then
    raise exception 'Só quem abriu a avaliação pode finalizá-la.';
  end if;
  if av.status <> 'aberta' then
    raise exception 'Esta avaliação já foi finalizada ou cancelada.';
  end if;
  -- Mínimo do prontuário (Res. COFFITO nº 414/2012): queixa, diagnóstico e plano terapêutico
  if av.queixa_principal is null then
    raise exception 'Preencha a queixa principal antes de finalizar.';
  end if;
  if av.diagnostico is null then
    raise exception 'Preencha o diagnóstico fisioterapêutico antes de finalizar.';
  end if;
  if av.objetivos is null or av.condutas is null then
    raise exception 'Preencha o plano terapêutico (objetivos e recursos/técnicas) antes de finalizar.';
  end if;
  update public.fisio_avaliacoes set status = 'finalizada', finalizado_em = now(), finalizado_por = auth.uid() where id = av.id;
  if av.agendamento_id is not null then
    update public.fisio_agenda set status = 'realizado' where id = av.agendamento_id and status in ('agendado', 'confirmado', 'chegou');
  end if;
end;
$$;

create or replace function public.fisio_registro_cancelar(p_tipo text, p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_prof_registro uuid;
  v_status text;
  v_prof public.fisio_profissionais;
begin
  if p_tipo = 'avaliacao' then
    select empresa_id, profissional_id, status into v_empresa, v_prof_registro, v_status from public.fisio_avaliacoes where id = p_id;
  elsif p_tipo = 'evolucao' then
    select empresa_id, profissional_id, status into v_empresa, v_prof_registro, v_status from public.fisio_evolucoes where id = p_id;
  else
    raise exception 'Registro inválido.';
  end if;
  if v_empresa is null then
    raise exception 'Registro não encontrado.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(v_empresa);
  if v_prof_registro <> v_prof.id then
    raise exception 'Só quem abriu o registro pode cancelá-lo.';
  end if;
  if v_status <> 'aberta' then
    raise exception 'Registro finalizado não é cancelado: registre um adendo.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  if p_tipo = 'avaliacao' then
    update public.fisio_avaliacoes set status = 'cancelada', cancelado_motivo = left(trim(p_motivo), 300) where id = p_id;
  else
    update public.fisio_evolucoes set status = 'cancelada', cancelado_motivo = left(trim(p_motivo), 300) where id = p_id;
  end if;
end;
$$;

create or replace function public.fisio_evolucao_abrir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof public.fisio_profissionais := app.fisio_profissional_do_usuario(p_empresa_id);
  v_paciente uuid := nullif(p_dados ->> 'paciente_id', '')::uuid;
  v_tipo text := case when p_dados ->> 'tipo' = 'alta' then 'alta' else 'sessao' end;
  v_ag public.fisio_agenda;
  v_id uuid;
  v_ultima public.fisio_evolucoes;
begin
  if nullif(p_dados ->> 'agendamento_id', '') is not null then
    select * into v_ag from public.fisio_agenda where id = (p_dados ->> 'agendamento_id')::uuid and empresa_id = p_empresa_id;
    if v_ag.id is null or v_ag.paciente_id is null then
      raise exception 'Agendamento não encontrado ou sem paciente cadastrado.';
    end if;
    if v_ag.status in ('cancelado', 'faltou') then
      raise exception 'Este horário foi cancelado ou marcado como falta.';
    end if;
    select id into v_id from public.fisio_evolucoes where agendamento_id = v_ag.id and status <> 'cancelada';
    if v_id is not null then
      return v_id;
    end if;
    v_paciente := v_ag.paciente_id;
  end if;
  if v_paciente is null or not exists (select 1 from public.fisio_pacientes where id = v_paciente and empresa_id = p_empresa_id) then
    raise exception 'Escolha o paciente.';
  end if;
  -- A evolução nova já vem com o plano (P) da última, para o fisioterapeuta continuar
  select * into v_ultima from public.fisio_evolucoes
   where paciente_id = v_paciente and status = 'finalizada' and tipo = 'sessao' order by data_hora desc limit 1;
  insert into public.fisio_evolucoes (empresa_id, numero, paciente_id, profissional_id, agendamento_id, tipo, condutas, alta_motivo)
  values (
    p_empresa_id, app.fisio_proximo_numero(p_empresa_id, 'registro'), v_paciente, v_prof.id, v_ag.id, v_tipo,
    coalesce(v_ultima.condutas, '{}'), case when v_tipo = 'alta' then 'objetivos_alcancados' end
  ) returning id into v_id;
  if v_ag.id is not null and v_ag.status in ('agendado', 'confirmado') then
    update public.fisio_agenda set status = 'chegou' where id = v_ag.id;
  end if;
  return v_id;
end;
$$;

create or replace function public.fisio_evolucao_salvar(p_evolucao_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.fisio_evolucoes;
  v_prof public.fisio_profissionais;
  v_antes smallint := nullif(p_dados ->> 'dor_antes', '')::smallint;
  v_depois smallint := nullif(p_dados ->> 'dor_depois', '')::smallint;
  v_condutas text[];
  v_motivo text := nullif(p_dados ->> 'alta_motivo', '');
begin
  select * into ev from public.fisio_evolucoes where id = p_evolucao_id for update;
  if ev.id is null then
    raise exception 'Evolução não encontrada.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(ev.empresa_id);
  if ev.profissional_id <> v_prof.id then
    raise exception 'Só quem abriu a evolução pode preenchê-la. Registre um adendo, se precisar.';
  end if;
  if (v_antes is not null and v_antes not between 0 and 10) or (v_depois is not null and v_depois not between 0 and 10) then
    raise exception 'A dor vai de 0 a 10.';
  end if;
  select coalesce(array_agg(distinct left(trim(x), 60)) filter (where trim(x) <> ''), '{}') into v_condutas
    from jsonb_array_elements_text(coalesce(p_dados -> 'condutas', '[]'::jsonb)) x;
  if cardinality(v_condutas) > 30 then
    raise exception 'No máximo 30 recursos por sessão.';
  end if;
  if ev.tipo = 'alta' and (v_motivo is null or v_motivo not in ('objetivos_alcancados', 'melhora_parcial', 'abandono', 'encaminhamento', 'pedido_paciente', 'outro')) then
    raise exception 'Escolha o motivo da alta.';
  end if;
  update public.fisio_evolucoes set
    subjetivo = app.vet_texto(p_dados, 'subjetivo', 5000),
    objetivo = app.vet_texto(p_dados, 'objetivo', 5000),
    analise = app.vet_texto(p_dados, 'analise', 5000),
    plano = app.vet_texto(p_dados, 'plano', 5000),
    condutas = v_condutas,
    dor_antes = v_antes,
    dor_depois = v_depois,
    intercorrencias = app.vet_texto(p_dados, 'intercorrencias', 3000),
    orientacoes = app.vet_texto(p_dados, 'orientacoes', 3000),
    alta_motivo = case when ev.tipo = 'alta' then v_motivo end
  where id = ev.id;
end;
$$;

create or replace function public.fisio_evolucao_finalizar(p_evolucao_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.fisio_evolucoes;
  v_prof public.fisio_profissionais;
begin
  select * into ev from public.fisio_evolucoes where id = p_evolucao_id for update;
  if ev.id is null then
    raise exception 'Evolução não encontrada.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(ev.empresa_id);
  if ev.profissional_id <> v_prof.id then
    raise exception 'Só quem abriu a evolução pode finalizá-la.';
  end if;
  if ev.status <> 'aberta' then
    raise exception 'Esta evolução já foi finalizada ou cancelada.';
  end if;
  if ev.subjetivo is null and ev.objetivo is null and ev.analise is null and ev.plano is null then
    raise exception 'Escreva a evolução da sessão antes de finalizar.';
  end if;
  update public.fisio_evolucoes set status = 'finalizada', finalizado_em = now(), finalizado_por = auth.uid() where id = ev.id;
  if ev.agendamento_id is not null then
    update public.fisio_agenda set status = 'realizado' where id = ev.agendamento_id and status in ('agendado', 'confirmado', 'chegou');
  end if;
  -- Alta: encerra os pacotes ativos sem sessões a usar e cancela os próximos horários
  if ev.tipo = 'alta' then
    update public.fisio_agenda set status = 'cancelado', motivo = 'Alta do paciente'
     where paciente_id = ev.paciente_id and inicio > now() and status in ('agendado', 'confirmado');
  end if;
end;
$$;

create or replace function public.fisio_adendo_registrar(p_tipo text, p_id uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_status text;
  v_prof public.fisio_profissionais;
  v_id uuid;
begin
  if p_tipo = 'avaliacao' then
    select empresa_id, status into v_empresa, v_status from public.fisio_avaliacoes where id = p_id;
  elsif p_tipo = 'evolucao' then
    select empresa_id, status into v_empresa, v_status from public.fisio_evolucoes where id = p_id;
  else
    raise exception 'Registro inválido.';
  end if;
  if v_empresa is null then
    raise exception 'Registro não encontrado.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(v_empresa);
  if v_status <> 'finalizada' then
    raise exception 'O adendo é para registro finalizado. Este ainda pode ser editado.';
  end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then
    raise exception 'Escreva o adendo.';
  end if;
  insert into public.fisio_adendos (empresa_id, avaliacao_id, evolucao_id, profissional_id, texto)
  values (v_empresa, case when p_tipo = 'avaliacao' then p_id end, case when p_tipo = 'evolucao' then p_id end, v_prof.id, left(trim(p_texto), 5000))
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 16. Documentos (fisioterapeuta)
-- -----------------------------------------------------------------------------
create or replace function public.fisio_documento_emitir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prof public.fisio_profissionais := app.fisio_profissional_do_usuario(p_empresa_id);
  v_paciente uuid := nullif(p_dados ->> 'paciente_id', '')::uuid;
  v_tipo text := p_dados ->> 'tipo';
  v_id uuid;
begin
  if v_paciente is null or not exists (select 1 from public.fisio_pacientes where id = v_paciente and empresa_id = p_empresa_id) then
    raise exception 'Escolha o paciente.';
  end if;
  if v_tipo is null or v_tipo not in ('comparecimento', 'relatorio', 'encaminhamento', 'orientacoes', 'declaracao') then
    raise exception 'Escolha o tipo do documento.';
  end if;
  if app.vet_texto(p_dados, 'texto', 10000) is null or length(app.vet_texto(p_dados, 'texto', 10000)) < 3 then
    raise exception 'Escreva o texto do documento.';
  end if;
  insert into public.fisio_documentos (empresa_id, numero, paciente_id, profissional_id, tipo, titulo, texto)
  values (
    p_empresa_id, app.fisio_proximo_numero(p_empresa_id, 'documento'), v_paciente, v_prof.id, v_tipo,
    coalesce(app.vet_texto(p_dados, 'titulo', 120), case v_tipo
      when 'comparecimento' then 'Declaração de comparecimento' when 'relatorio' then 'Relatório fisioterapêutico'
      when 'encaminhamento' then 'Encaminhamento' when 'orientacoes' then 'Orientações para casa' else 'Declaração' end),
    app.vet_texto(p_dados, 'texto', 10000)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fisio_documento_cancelar(p_documento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.fisio_documentos;
  v_prof public.fisio_profissionais;
begin
  select * into d from public.fisio_documentos where id = p_documento_id for update;
  if d.id is null then
    raise exception 'Documento não encontrado.';
  end if;
  v_prof := app.fisio_profissional_do_usuario(d.empresa_id);
  if d.profissional_id <> v_prof.id then
    raise exception 'Só quem emitiu o documento pode cancelá-lo.';
  end if;
  if d.cancelado_em is not null then
    raise exception 'Este documento já foi cancelado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.fisio_documentos set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300) where id = d.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 17. Recebimentos (recepção) → Financeiro
-- -----------------------------------------------------------------------------
create or replace function public.fisio_recebimento_registrar(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.gestao_config;
  v_paciente public.fisio_pacientes;
  v_pacote uuid := nullif(p_dados ->> 'pacote_id', '')::uuid;
  v_forma text := p_dados ->> 'forma';
  v_valor numeric := app.vet_numero(p_dados, 'valor', 'valor');
  v_venc date := nullif(p_dados ->> 'vencimento', '')::date;
  v_hoje date := app.hoje();
  v_desc text := app.vet_texto(p_dados, 'descricao', 120);
  v_cat uuid;
  v_conta uuid;
  v_lanc uuid;
  v_id uuid;
  v_texto text;
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.vender');
  select * into v_paciente from public.fisio_pacientes where id = nullif(p_dados ->> 'paciente_id', '')::uuid and empresa_id = p_empresa_id;
  if v_paciente.id is null then
    raise exception 'Escolha o paciente.';
  end if;
  if v_pacote is not null and not exists (select 1 from public.fisio_pacotes where id = v_pacote and paciente_id = v_paciente.id and status <> 'cancelado') then
    raise exception 'O pacote escolhido não é deste paciente.';
  end if;
  if v_desc is null then
    select descricao into v_desc from public.fisio_pacotes where id = v_pacote;
    v_desc := coalesce(v_desc, 'Sessão de fisioterapia');
  end if;
  if v_forma is null or v_forma not in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'a_receber', 'outro') then
    raise exception 'Escolha a forma de pagamento.';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Informe o valor recebido.';
  end if;
  select * into v_cfg from public.gestao_config where empresa_id = p_empresa_id;
  v_cat := app.categoria_sistema(p_empresa_id, 'SERVICOS');
  if v_cat is null then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_cat := app.categoria_sistema(p_empresa_id, 'SERVICOS');
  end if;
  v_texto := 'Fisioterapia — ' || v_desc || ' — ' || v_paciente.nome;
  if v_forma = 'a_receber' then
    if v_venc is null or v_venc < v_hoje then
      raise exception 'Informe o vencimento combinado (hoje ou depois).';
    end if;
    insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto, origem, origem_referencia)
    values (p_empresa_id, 'receber', left(v_texto || ' (a receber)', 300), v_cat, v_hoje, v_venc, v_valor, 'fisioterapia', v_paciente.id::text)
    returning id into v_lanc;
  else
    v_venc := null;
    v_conta := case v_forma
      when 'pix' then v_cfg.conta_pix_id
      when 'transferencia' then v_cfg.conta_pix_id
      when 'cartao_debito' then v_cfg.conta_cartao_id
      when 'cartao_credito' then v_cfg.conta_cartao_id
      else v_cfg.conta_dinheiro_id
    end;
    if v_conta is null then
      raise exception 'Configure a conta que recebe este pagamento (caixa, PIX e maquininha) com o escritório.';
    end if;
    insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, conta_financeira_id, data_competencia, data_vencimento, valor_previsto, origem, origem_referencia)
    values (p_empresa_id, 'receber', left(v_texto, 300), v_cat, v_conta, v_hoje, v_hoje, v_valor, 'fisioterapia', v_paciente.id::text)
    returning id into v_lanc;
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem, observacao)
    values (p_empresa_id, v_lanc, 'receber', v_hoje, v_conta, v_valor, case v_forma when 'outro' then 'outro' else v_forma end, 'fisioterapia', left(v_texto, 300));
  end if;
  insert into public.fisio_recebimentos (empresa_id, paciente_id, pacote_id, descricao, data, forma, valor, vencimento, lancamento_id, observacao)
  values (p_empresa_id, v_paciente.id, v_pacote, v_desc, v_hoje, v_forma, v_valor, v_venc, v_lanc, app.vet_texto(p_dados, 'observacao', 300))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fisio_recebimento_estornar(p_recebimento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.fisio_recebimentos;
begin
  select * into r from public.fisio_recebimentos where id = p_recebimento_id for update;
  if r.id is null then
    raise exception 'Recebimento não encontrado.';
  end if;
  perform app.exigir_fisio(r.empresa_id, 'gestao.gerenciar');
  if r.cancelado_em is not null then
    raise exception 'Este recebimento já foi estornado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do estorno.';
  end if;
  if r.lancamento_id is not null then
    if exists (select 1 from public.baixas b where b.lancamento_id = r.lancamento_id and b.origem <> 'fisioterapia') then
      raise exception 'Este recebimento já foi conciliado ou baixado no Financeiro. Desfaça antes de estornar.';
    end if;
    delete from public.baixas where lancamento_id = r.lancamento_id and origem = 'fisioterapia';
    update public.lancamentos
       set situacao = 'cancelado', motivo_cancelamento = left('Recebimento da fisioterapia estornado: ' || trim(p_motivo), 500)
     where id = r.lancamento_id and situacao <> 'cancelado';
  end if;
  update public.fisio_recebimentos set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300) where id = r.id;
end;
$$;

-- Repasse do mês por fisioterapeuta: sessões realizadas e valor (do pacote ou da sessão avulsa)
create or replace function public.fisio_repasse(p_empresa_id uuid, p_mes date)
returns table (profissional_id uuid, nome text, sessoes int, avaliacoes int, faltas int, valor_sessoes numeric, repasse_percentual numeric, repasse numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ini timestamptz := (date_trunc('month', p_mes)::date::timestamp at time zone 'America/Araguaina');
  v_fim timestamptz := ((date_trunc('month', p_mes) + interval '1 month')::date::timestamp at time zone 'America/Araguaina');
begin
  perform app.exigir_fisio(p_empresa_id, 'gestao.gerenciar');
  return query
  with feitos as (
    select a.profissional_id, a.tipo, a.status,
           case when a.status <> 'realizado' then 0
                when k.id is not null and k.sessoes > 0 then round(k.valor_total / k.sessoes, 2)
                else c.valor_sessao end as valor
      from public.fisio_agenda a
      join public.fisio_config c on c.empresa_id = a.empresa_id
      left join public.fisio_pacotes k on k.id = a.pacote_id
     where a.empresa_id = p_empresa_id and a.inicio >= v_ini and a.inicio < v_fim and a.status in ('realizado', 'faltou')
  )
  select p.id, p.nome,
         count(*) filter (where f.status = 'realizado' and f.tipo not in ('avaliacao', 'reavaliacao'))::int,
         count(*) filter (where f.status = 'realizado' and f.tipo in ('avaliacao', 'reavaliacao'))::int,
         count(*) filter (where f.status = 'faltou')::int,
         coalesce(sum(f.valor), 0)::numeric,
         p.repasse_percentual,
         round(coalesce(sum(f.valor), 0) * p.repasse_percentual / 100, 2)
    from public.fisio_profissionais p
    left join feitos f on f.profissional_id = p.id
   where p.empresa_id = p_empresa_id and (p.ativo or f.profissional_id is not null)
   group by p.id, p.nome, p.repasse_percentual
   order by p.nome;
end;
$$;

-- -----------------------------------------------------------------------------
-- 18. Acesso
--  * Cadastros, agenda, pacotes e recebimentos: quem usa a gestão da empresa
--    (recepção) e os fisioterapeutas da clínica.
--  * Prontuário (avaliações, evoluções, adendos e documentos): só os
--    fisioterapeutas da clínica (sigilo, Res. COFFITO nº 414/2012, art. 3º).
--  Escrita só pelas funções.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fisio_config', 'fisio_profissionais', 'fisio_pacientes', 'fisio_pacotes', 'fisio_agenda', 'fisio_recebimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (empresa_id = any ((select app.empresas_com(''gestao.vender''))::uuid[]) or app.fisio_e_profissional(empresa_id))',
      t || '_leitura', t
    );
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  foreach t in array array['fisio_avaliacoes', 'fisio_evolucoes', 'fisio_adendos', 'fisio_documentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.fisio_e_profissional(empresa_id))', t || '_leitura', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

revoke execute on function app.exigir_fisio(uuid, text), app.fisio_cfg(uuid), app.fisio_profissional_do_usuario(uuid),
  app.fisio_proximo_numero(uuid, text), app.fisio_sessoes_usadas(uuid), app.fisio_choque(uuid, uuid, timestamptz, int, uuid),
  app.tg_fisio_registro_imutavel(), app.tg_fisio_somente_insercao(), app.tg_fisio_documento_imutavel()
  from public, anon, authenticated;
-- Usada nas políticas de leitura (responde só sobre o próprio usuário)
revoke execute on function app.fisio_e_profissional(uuid) from public, anon;
grant execute on function app.fisio_e_profissional(uuid) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.fisio_configurar(uuid, jsonb)', 'public.fisio_profissional_salvar(uuid, uuid, jsonb)',
    'public.fisio_paciente_salvar(uuid, uuid, jsonb)', 'public.fisio_pacote_salvar(uuid, uuid, jsonb)',
    'public.fisio_pacotes_resumo(uuid, uuid)', 'public.fisio_agenda_salvar(uuid, uuid, jsonb)',
    'public.fisio_agenda_status(uuid, text, text, boolean)', 'public.fisio_avaliacao_abrir(uuid, jsonb)',
    'public.fisio_avaliacao_salvar(uuid, jsonb)', 'public.fisio_avaliacao_finalizar(uuid)', 'public.fisio_registro_cancelar(text, uuid, text)',
    'public.fisio_evolucao_abrir(uuid, jsonb)', 'public.fisio_evolucao_salvar(uuid, jsonb)', 'public.fisio_evolucao_finalizar(uuid)',
    'public.fisio_adendo_registrar(text, uuid, text)', 'public.fisio_documento_emitir(uuid, jsonb)', 'public.fisio_documento_cancelar(uuid, text)',
    'public.fisio_recebimento_registrar(uuid, jsonb)', 'public.fisio_recebimento_estornar(uuid, text)', 'public.fisio_repasse(uuid, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
