-- =============================================================================
-- Gestão: modalidade "Clínica veterinária"
--
-- O escritório liga a gestão na modalidade "veterinaria" para clínicas e
-- consultórios veterinários. A clínica se administra pelo portal:
--  * Tutores (responsáveis pelos animais) e animais (pacientes), com os dados
--    de identificação pedidos nos documentos (Res. CFMV nº 1.321/2020, art. 3º).
--  * Agenda (consulta, retorno, vacina, cirurgia, exame, banho e tosa).
--  * Prontuário: cada atendimento traz data, hora, local, veterinário,
--    relatos do responsável, parâmetros, achados, diagnósticos, procedimentos
--    e imunizações (art. 9º). Atendimento finalizado não se altera: correções
--    entram como adendo datado e assinado. Laudos de exames ficam anexados.
--  * Receitas: comum (2 vias, uma fica arquivada no portal), antimicrobiano de
--    uso humano (2 vias, validade de 10 dias — RDC Anvisa nº 471/2021) e
--    preparação magistral sujeita a controle especial (3 vias, numeração com o
--    cadastro do veterinário no MAPA, validade de 30 dias ou 180 em uso
--    contínuo — Portaria MAPA nº 837/2025). A Notificação de Receita
--    Veterinária de produto industrializado controlado é emitida só no sistema
--    do MAPA, e os receituários controlados de uso humano seguem os modelos da
--    Anvisa: o portal não os imita.
--  * Vacinas: catálogo da clínica, aplicações com nome, partida, fabricante,
--    dose, fabricação e validade (art. 6º e 7º), próxima dose e lembretes ao
--    tutor (WhatsApp da própria clínica, aberto pela recepção, ou e-mail
--    automático para quem autorizou).
--  * Atestados (sanitário, vacinação, óbito) e termos de consentimento
--    (Anexos da Res. CFMV nº 1.321/2020).
--  * Contas da clínica (consultas, vacinas, exames...) com pagamentos que
--    viram lançamentos no Financeiro e entram na conferência do caixa.
-- Só o médico-veterinário cadastrado (ligado ao próprio usuário) registra os
-- atos clínicos; a recepção cuida da agenda, dos cadastros e das contas.
-- Tudo pelas funções abaixo; as tabelas são só lidas diretamente, e só por
-- quem usa a gestão da própria empresa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Modalidade e origens no Financeiro
-- -----------------------------------------------------------------------------
alter table public.gestao_config drop constraint gestao_config_modalidade_check;
alter table public.gestao_config add constraint gestao_config_modalidade_check check (modalidade in ('loja', 'notas', 'hotel', 'veterinaria'));

alter table public.lancamentos drop constraint lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check check (origem in (
  'manual', 'importacao', 'nfe', 'nfse', 'cte', 'recorrencia', 'parcelamento', 'conciliacao', 'ocr', 'maquininha', 'cartao', 'venda', 'hotel',
  'veterinaria'
));
alter table public.baixas drop constraint baixas_origem_check;
alter table public.baixas add constraint baixas_origem_check check (origem in (
  'manual', 'conciliacao', 'importacao', 'maquininha', 'cartao', 'venda', 'hotel', 'veterinaria'
));

-- -----------------------------------------------------------------------------
-- 2. Configuração da clínica
-- -----------------------------------------------------------------------------
create table public.vet_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  -- Nome que sai nos documentos (vazio = nome fantasia ou razão social)
  nome_clinica text check (nome_clinica is null or length(trim(nome_clinica)) between 2 and 120),
  -- Registro do estabelecimento no CRMV (art. 3º, IV)
  registro_crmv text check (registro_crmv is null or length(trim(registro_crmv)) between 1 and 30),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  -- Endereço completo dos documentos (vazio = endereço do cadastro da empresa)
  endereco text check (endereco is null or length(endereco) <= 300),
  cidade_documentos text check (cidade_documentos is null or length(cidade_documentos) <= 80),
  -- Agenda
  horario_inicio time not null default '08:00',
  horario_fim time not null default '18:00',
  duracao_padrao_min int not null default 30 check (duracao_padrao_min between 5 and 240),
  -- Lembretes ao tutor: quantos dias antes da vacina ou do retorno
  lembrete_dias_antes int not null default 7 check (lembrete_dias_antes between 0 and 60),
  -- E-mail automático aos tutores que autorizaram (pelo e-mail configurado no portal)
  lembrete_email boolean not null default false,
  mensagem_vacina text check (mensagem_vacina is null or length(mensagem_vacina) <= 600),
  mensagem_retorno text check (mensagem_retorno is null or length(mensagem_retorno) <= 600),
  proximo_numero_atendimento bigint not null default 1 check (proximo_numero_atendimento >= 1),
  proximo_numero_receita bigint not null default 1 check (proximo_numero_receita >= 1),
  proximo_numero_documento bigint not null default 1 check (proximo_numero_documento >= 1),
  proximo_numero_conta bigint not null default 1 check (proximo_numero_conta >= 1),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_config_horario check (horario_fim > horario_inicio)
);
create trigger vet_config_updated_at before update on public.vet_config for each row execute function app.tg_updated_at();
create trigger auditoria_vet_config after insert or update or delete on public.vet_config for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 3. Médicos-veterinários (ligados ao usuário do portal para assinar os atos)
-- -----------------------------------------------------------------------------
create table public.vet_veterinarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  perfil_id uuid references public.perfis(id) on delete set null,
  nome text not null check (length(trim(nome)) between 3 and 120),
  crmv text not null check (crmv ~ '^[0-9A-Za-z./-]{1,15}$'),
  crmv_uf text not null check (crmv_uf ~ '^[A-Z]{2}$'),
  -- Cadastro no MAPA (SIPEAGRO): numeração das receitas magistrais controladas
  cadastro_mapa text check (cadastro_mapa is null or cadastro_mapa ~ '^[0-9A-Za-z./-]{1,30}$'),
  proximo_numero_magistral int not null default 1 check (proximo_numero_magistral >= 1),
  especialidade text check (especialidade is null or length(especialidade) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  responsavel_tecnico boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_veterinarios_empresa_id_unico unique (empresa_id, id)
);
create unique index vet_veterinarios_perfil_uk on public.vet_veterinarios (empresa_id, perfil_id) where perfil_id is not null;
create unique index vet_veterinarios_crmv_uk on public.vet_veterinarios (empresa_id, crmv_uf, upper(crmv));
create trigger vet_veterinarios_updated_at before update on public.vet_veterinarios for each row execute function app.tg_updated_at();
create trigger auditoria_vet_veterinarios after insert or update or delete on public.vet_veterinarios for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 4. Tutores (responsáveis) e animais
-- -----------------------------------------------------------------------------
create table public.vet_tutores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 120),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  telefone2 text check (telefone2 is null or telefone2 ~ '^[0-9]{10,13}$'),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  logradouro text check (logradouro is null or length(logradouro) <= 150),
  numero text check (numero is null or length(numero) <= 20),
  complemento text check (complemento is null or length(complemento) <= 80),
  bairro text check (bairro is null or length(bairro) <= 80),
  cidade text check (cidade is null or length(cidade) <= 80),
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  -- Pessoas autorizadas a buscar o animal ou pedir cópia do prontuário (art. 9º, § 1º, "f")
  autorizados text check (autorizados is null or length(autorizados) <= 500),
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  -- Lembretes de vacina e retorno: o tutor autoriza cada canal
  aceita_whatsapp boolean not null default true,
  aceita_email boolean not null default false,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_tutores_empresa_id_unico unique (empresa_id, id)
);
create unique index vet_tutores_cpf_uk on public.vet_tutores (empresa_id, cpf) where cpf is not null;
create index vet_tutores_nome_idx on public.vet_tutores using gin (app.normalizar(nome) extensions.gin_trgm_ops);
create trigger vet_tutores_updated_at before update on public.vet_tutores for each row execute function app.tg_updated_at();
create trigger auditoria_vet_tutores after insert or update or delete on public.vet_tutores for each row execute function app.tg_auditoria();

create table public.vet_pacientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tutor_id uuid not null,
  nome text not null check (length(trim(nome)) between 1 and 80),
  especie text not null check (especie in (
    'canina', 'felina', 'ave', 'roedor', 'lagomorfo', 'reptil', 'equina', 'bovina', 'ovina', 'caprina', 'suina', 'peixe', 'outra'
  )),
  especie_outra text check (especie_outra is null or length(especie_outra) <= 60),
  raca text check (raca is null or length(raca) <= 80),
  sexo text not null default 'indefinido' check (sexo in ('macho', 'femea', 'indefinido')),
  castrado boolean not null default false,
  nascimento date,
  -- Idade presumida (nascimento estimado pelo veterinário)
  nascimento_estimado boolean not null default false,
  pelagem text check (pelagem is null or length(pelagem) <= 80),
  porte text check (porte is null or porte in ('mini', 'pequeno', 'medio', 'grande', 'gigante')),
  peso_kg numeric(8, 3) check (peso_kg is null or (peso_kg > 0 and peso_kg < 2000)),
  microchip text check (microchip is null or microchip ~ '^[0-9A-Za-z]{6,23}$'),
  sinais_particulares text check (sinais_particulares is null or length(sinais_particulares) <= 300),
  alergias text check (alergias is null or length(alergias) <= 500),
  observacoes text check (observacoes is null or length(observacoes) <= 1000),
  obito_em timestamptz,
  obito_causa text check (obito_causa is null or length(obito_causa) <= 500),
  ativo boolean not null default true,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_pacientes_empresa_id_unico unique (empresa_id, id),
  constraint vet_pacientes_especie_outra check (especie <> 'outra' or especie_outra is not null),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id)
);
create unique index vet_pacientes_microchip_uk on public.vet_pacientes (empresa_id, upper(microchip)) where microchip is not null;
create index vet_pacientes_tutor_idx on public.vet_pacientes (tutor_id);
create index vet_pacientes_nome_idx on public.vet_pacientes using gin (app.normalizar(nome) extensions.gin_trgm_ops);
create trigger vet_pacientes_updated_at before update on public.vet_pacientes for each row execute function app.tg_updated_at();
create trigger auditoria_vet_pacientes after insert or update or delete on public.vet_pacientes for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 5. Agenda
-- -----------------------------------------------------------------------------
create table public.vet_agenda (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  inicio timestamptz not null,
  duracao_min int not null default 30 check (duracao_min between 5 and 720),
  tipo text not null default 'consulta' check (tipo in ('consulta', 'retorno', 'vacina', 'cirurgia', 'exame', 'banho_tosa', 'outro')),
  paciente_id uuid,
  tutor_id uuid,
  -- Quem ainda não tem cadastro (primeira consulta marcada por telefone)
  nome_avulso text check (nome_avulso is null or length(trim(nome_avulso)) between 2 and 120),
  telefone_avulso text check (telefone_avulso is null or telefone_avulso ~ '^[0-9]{10,13}$'),
  veterinario_id uuid,
  status text not null default 'agendado' check (status in ('agendado', 'confirmado', 'chegou', 'em_atendimento', 'concluido', 'faltou', 'cancelado')),
  observacoes text check (observacoes is null or length(observacoes) <= 500),
  atendimento_id uuid,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_agenda_empresa_id_unico unique (empresa_id, id),
  constraint vet_agenda_quem check (paciente_id is not null or nome_avulso is not null),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id),
  foreign key (empresa_id, veterinario_id) references public.vet_veterinarios (empresa_id, id)
);
create index vet_agenda_dia_idx on public.vet_agenda (empresa_id, inicio);
create trigger vet_agenda_updated_at before update on public.vet_agenda for each row execute function app.tg_updated_at();
create trigger auditoria_vet_agenda after insert or update or delete on public.vet_agenda for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 6. Prontuário: atendimentos, adendos e anexos
-- -----------------------------------------------------------------------------
create table public.vet_atendimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  paciente_id uuid not null,
  -- Responsável no dia do atendimento
  tutor_id uuid not null,
  veterinario_id uuid not null,
  agendamento_id uuid,
  data_hora timestamptz not null default now(),
  local text check (local is null or length(local) <= 120),
  tipo text not null default 'consulta' check (tipo in (
    'consulta', 'retorno', 'vacinacao', 'emergencia', 'cirurgia', 'internacao', 'exame', 'procedimento', 'outro'
  )),
  -- Relatos e informações do responsável (queixa principal e histórico)
  relato text check (relato is null or length(relato) <= 5000),
  anamnese text check (anamnese is null or length(anamnese) <= 10000),
  -- Parâmetros mensurados e estado geral
  peso_kg numeric(8, 3) check (peso_kg is null or (peso_kg > 0 and peso_kg < 2000)),
  temperatura numeric(4, 1) check (temperatura is null or temperatura between 25 and 46),
  frequencia_cardiaca int check (frequencia_cardiaca is null or frequencia_cardiaca between 1 and 400),
  frequencia_respiratoria int check (frequencia_respiratoria is null or frequencia_respiratoria between 1 and 200),
  tpc numeric(3, 1) check (tpc is null or tpc between 0 and 10),
  mucosas text check (mucosas is null or length(mucosas) <= 60),
  hidratacao text check (hidratacao is null or length(hidratacao) <= 60),
  estado_geral text check (estado_geral is null or length(estado_geral) <= 300),
  exame_fisico text check (exame_fisico is null or length(exame_fisico) <= 10000),
  diagnostico_presuntivo text check (diagnostico_presuntivo is null or length(diagnostico_presuntivo) <= 2000),
  diagnostico_conclusivo text check (diagnostico_conclusivo is null or length(diagnostico_conclusivo) <= 2000),
  procedimentos text check (procedimentos is null or length(procedimentos) <= 5000),
  tratamento text check (tratamento is null or length(tratamento) <= 5000),
  orientacoes text check (orientacoes is null or length(orientacoes) <= 5000),
  retorno_em date,
  retorno_motivo text check (retorno_motivo is null or length(retorno_motivo) <= 200),
  status text not null default 'aberto' check (status in ('aberto', 'finalizado', 'cancelado')),
  finalizado_em timestamptz,
  finalizado_por uuid references public.perfis(id) on delete set null,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_atendimentos_empresa_id_unico unique (empresa_id, id),
  constraint vet_atendimentos_numero_uk unique (empresa_id, numero),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id),
  foreign key (empresa_id, veterinario_id) references public.vet_veterinarios (empresa_id, id),
  foreign key (empresa_id, agendamento_id) references public.vet_agenda (empresa_id, id)
);
create index vet_atendimentos_paciente_idx on public.vet_atendimentos (paciente_id, data_hora desc);
create index vet_atendimentos_retorno_idx on public.vet_atendimentos (empresa_id, retorno_em) where retorno_em is not null;
create trigger vet_atendimentos_updated_at before update on public.vet_atendimentos for each row execute function app.tg_updated_at();
create trigger auditoria_vet_atendimentos after insert or update or delete on public.vet_atendimentos for each row execute function app.tg_auditoria();

alter table public.vet_agenda add foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id);

-- Prontuário sem rasuras: atendimento finalizado não muda (só o cancelamento de um aberto)
create or replace function app.tg_vet_atendimento_imutavel()
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
  if old.status = 'finalizado' then
    raise exception 'Atendimento finalizado não pode ser alterado. Registre um adendo.';
  end if;
  if old.status = 'cancelado' then
    raise exception 'Atendimento cancelado não pode ser alterado.';
  end if;
  return new;
end;
$$;
create trigger vet_atendimentos_imutavel before update or delete on public.vet_atendimentos
  for each row execute function app.tg_vet_atendimento_imutavel();

create table public.vet_adendos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  atendimento_id uuid not null,
  veterinario_id uuid not null,
  texto text not null check (length(trim(texto)) between 3 and 5000),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id),
  foreign key (empresa_id, veterinario_id) references public.vet_veterinarios (empresa_id, id)
);
create index vet_adendos_atendimento_idx on public.vet_adendos (atendimento_id, created_at);
create trigger auditoria_vet_adendos after insert or update or delete on public.vet_adendos for each row execute function app.tg_auditoria();

create or replace function app.tg_vet_somente_insercao()
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
create trigger vet_adendos_somente_insercao before update or delete on public.vet_adendos
  for each row execute function app.tg_vet_somente_insercao();

-- Laudos de exames e imagens (art. 9º, X): armazenamento privado da empresa
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vet-anexos', 'vet-anexos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy vet_anexos_leitura on storage.objects for select to authenticated
  using (bucket_id = 'vet-anexos' and app.pode(app.empresa_do_objeto(name), 'gestao.vender'));

create table public.vet_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  atendimento_id uuid not null,
  caminho text not null unique,
  nome text not null check (length(trim(nome)) between 1 and 200),
  descricao text check (descricao is null or length(descricao) <= 200),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  tamanho bigint not null check (tamanho > 0 and tamanho <= 15728640),
  enviado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  confirmado_em timestamptz,
  constraint vet_anexos_na_pasta check (caminho like empresa_id::text || '/' || atendimento_id::text || '/%'),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id)
);
create index vet_anexos_atendimento_idx on public.vet_anexos (atendimento_id);
create trigger auditoria_vet_anexos after insert or update or delete on public.vet_anexos for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 7. Receitas
-- -----------------------------------------------------------------------------
create table public.vet_receitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  -- simples: comum | antimicrobiano: de uso humano, 2 vias e 10 dias | magistral_controlada: Portaria MAPA nº 837/2025
  tipo text not null default 'simples' check (tipo in ('simples', 'antimicrobiano', 'magistral_controlada')),
  paciente_id uuid not null,
  tutor_id uuid not null,
  veterinario_id uuid not null,
  atendimento_id uuid,
  -- Magistral controlada: cadastro no MAPA + sequencial do veterinário + ano (2 dígitos)
  numero_controle text,
  uso_continuo boolean not null default false,
  emitida_em timestamptz not null default now(),
  validade date,
  observacoes text check (observacoes is null or length(observacoes) <= 2000),
  cancelada_em timestamptz,
  cancelada_motivo text check (cancelada_motivo is null or length(cancelada_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vet_receitas_empresa_id_unico unique (empresa_id, id),
  constraint vet_receitas_numero_uk unique (empresa_id, numero),
  constraint vet_receitas_controle check ((tipo = 'magistral_controlada') = (numero_controle is not null)),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id),
  foreign key (empresa_id, veterinario_id) references public.vet_veterinarios (empresa_id, id),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id)
);
create unique index vet_receitas_controle_uk on public.vet_receitas (empresa_id, numero_controle) where numero_controle is not null;
create index vet_receitas_paciente_idx on public.vet_receitas (paciente_id, emitida_em desc);
create trigger auditoria_vet_receitas after insert or update or delete on public.vet_receitas for each row execute function app.tg_auditoria();

create table public.vet_receita_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  receita_id uuid not null,
  ordem int not null check (ordem between 1 and 30),
  -- Nome comercial ou Denominação Comum Brasileira (na magistral: substâncias ativas)
  medicamento text not null check (length(trim(medicamento)) between 2 and 300),
  concentracao text check (concentracao is null or length(concentracao) <= 120),
  forma_farmaceutica text check (forma_farmaceutica is null or length(forma_farmaceutica) <= 80),
  quantidade text not null check (length(trim(quantidade)) between 1 and 80),
  via text not null default 'oral' check (via in (
    'oral', 'topica', 'oftalmica', 'otologica', 'nasal', 'subcutanea', 'intramuscular', 'intravenosa', 'retal', 'transdermica', 'outra'
  )),
  posologia text not null check (length(trim(posologia)) between 2 and 1000),
  duracao text check (duracao is null or length(duracao) <= 80),
  -- Farmácia: veterinária (produto de uso veterinário), humana ou manipulação
  uso text not null default 'veterinario' check (uso in ('veterinario', 'humano', 'manipulado')),
  constraint vet_receita_itens_ordem_uk unique (receita_id, ordem),
  foreign key (empresa_id, receita_id) references public.vet_receitas (empresa_id, id) on delete cascade
);
create trigger auditoria_vet_receita_itens after insert or update or delete on public.vet_receita_itens for each row execute function app.tg_auditoria();

-- Receita emitida não muda (só o cancelamento, com motivo)
create or replace function app.tg_vet_receita_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A receita emitida não pode ser apagada. Cancele com o motivo.';
  end if;
  if old.cancelada_em is not null
     or (new.numero, new.tipo, new.paciente_id, new.tutor_id, new.veterinario_id, new.numero_controle, new.uso_continuo, new.emitida_em, new.validade, new.observacoes)
        is distinct from
        (old.numero, old.tipo, old.paciente_id, old.tutor_id, old.veterinario_id, old.numero_controle, old.uso_continuo, old.emitida_em, old.validade, old.observacoes) then
    raise exception 'A receita emitida não pode ser alterada. Cancele e emita outra.';
  end if;
  return new;
end;
$$;
create trigger vet_receitas_imutavel before update or delete on public.vet_receitas
  for each row execute function app.tg_vet_receita_imutavel();
create trigger vet_receita_itens_somente_insercao before update or delete on public.vet_receita_itens
  for each row execute function app.tg_vet_somente_insercao();

-- -----------------------------------------------------------------------------
-- 8. Vacinas: catálogo e aplicações (carteira de vacinação)
-- -----------------------------------------------------------------------------
create table public.vet_vacinas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  especie text not null default 'canina' check (especie in ('canina', 'felina', 'todas', 'outra')),
  fabricante text check (fabricante is null or length(fabricante) <= 80),
  -- Doses do esquema inicial e intervalo entre elas; reforço depois do esquema (vazio = sem reforço)
  doses_iniciais int not null default 1 check (doses_iniciais between 1 and 6),
  intervalo_doses_dias int not null default 21 check (intervalo_doses_dias between 7 and 120),
  reforco_dias int check (reforco_dias is null or reforco_dias between 30 and 1825),
  observacao text check (observacao is null or length(observacao) <= 300),
  ativa boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_vacinas_empresa_id_unico unique (empresa_id, id)
);
create unique index vet_vacinas_nome_uk on public.vet_vacinas (empresa_id, lower(nome));
create trigger vet_vacinas_updated_at before update on public.vet_vacinas for each row execute function app.tg_updated_at();
create trigger auditoria_vet_vacinas after insert or update or delete on public.vet_vacinas for each row execute function app.tg_auditoria();

create table public.vet_vacinacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paciente_id uuid not null,
  vacina_id uuid,
  vacina_nome text not null check (length(trim(vacina_nome)) between 2 and 80),
  fabricante text check (fabricante is null or length(fabricante) <= 80),
  partida text check (partida is null or length(partida) <= 40),
  fabricacao date,
  validade date,
  dose text not null check (dose in ('1', '2', '3', '4', '5', '6', 'reforco', 'unica')),
  aplicada_em date not null,
  -- clinica: aplicada aqui (assinada pelo veterinário) | externa: registro de carteira anterior
  origem text not null default 'clinica' check (origem in ('clinica', 'externa')),
  veterinario_id uuid,
  veterinario_externo text check (veterinario_externo is null or length(veterinario_externo) <= 160),
  atendimento_id uuid,
  proxima_dose_em date,
  observacao text check (observacao is null or length(observacao) <= 300),
  cancelada_em timestamptz,
  cancelada_motivo text check (cancelada_motivo is null or length(cancelada_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vet_vacinacoes_empresa_id_unico unique (empresa_id, id),
  -- Na clínica: veterinário e os dados do frasco (Res. CFMV nº 1.321/2020, arts. 6º e 7º)
  constraint vet_vacinacoes_clinica check (
    origem = 'externa' or (veterinario_id is not null and fabricante is not null and partida is not null and fabricacao is not null and validade is not null)
  ),
  constraint vet_vacinacoes_datas check (
    (fabricacao is null or validade is null or validade >= fabricacao) and (proxima_dose_em is null or proxima_dose_em > aplicada_em)
  ),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, vacina_id) references public.vet_vacinas (empresa_id, id),
  foreign key (empresa_id, veterinario_id) references public.vet_veterinarios (empresa_id, id),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id)
);
create index vet_vacinacoes_paciente_idx on public.vet_vacinacoes (paciente_id, aplicada_em desc);
create index vet_vacinacoes_proxima_idx on public.vet_vacinacoes (empresa_id, proxima_dose_em) where proxima_dose_em is not null and cancelada_em is null;
create trigger auditoria_vet_vacinacoes after insert or update or delete on public.vet_vacinacoes for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 9. Lembretes enviados ao tutor (histórico)
-- -----------------------------------------------------------------------------
create table public.vet_avisos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('vacina', 'retorno')),
  -- Vacinação (próxima dose) ou atendimento (retorno)
  referencia_id uuid not null,
  paciente_id uuid not null,
  tutor_id uuid not null,
  data_alvo date not null,
  canal text not null check (canal in ('whatsapp', 'email', 'telefone')),
  envio_id uuid references public.envios(id) on delete set null,
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id)
);
create index vet_avisos_referencia_idx on public.vet_avisos (referencia_id, data_alvo);
create unique index vet_avisos_email_uk on public.vet_avisos (referencia_id, data_alvo) where canal = 'email';

-- -----------------------------------------------------------------------------
-- 10. Atestados e termos (Res. CFMV nº 1.321/2020)
-- -----------------------------------------------------------------------------
create table public.vet_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  tipo text not null check (tipo in (
    'atestado_sanitario', 'atestado_vacinacao', 'atestado_obito',
    'termo_exames', 'termo_procedimento_risco', 'termo_retirada_corpo', 'termo_cirurgia', 'termo_internacao',
    'termo_anestesia', 'termo_eutanasia', 'termo_retirada_sem_alta', 'termo_doacao_corpo'
  )),
  paciente_id uuid not null,
  tutor_id uuid not null,
  veterinario_id uuid not null,
  atendimento_id uuid,
  -- Campos de cada documento (procedimento, riscos, causa mortis, local e hora do óbito...)
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object' and pg_column_size(dados) <= 20000),
  emitido_em timestamptz not null default now(),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vet_documentos_empresa_id_unico unique (empresa_id, id),
  constraint vet_documentos_numero_uk unique (empresa_id, numero),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id),
  foreign key (empresa_id, veterinario_id) references public.vet_veterinarios (empresa_id, id),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id)
);
create index vet_documentos_paciente_idx on public.vet_documentos (paciente_id, emitido_em desc);
create trigger auditoria_vet_documentos after insert or update or delete on public.vet_documentos for each row execute function app.tg_auditoria();

create or replace function app.tg_vet_documento_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'O documento emitido não pode ser apagado. Cancele com o motivo.';
  end if;
  if old.cancelado_em is not null
     or (new.numero, new.tipo, new.paciente_id, new.tutor_id, new.veterinario_id, new.atendimento_id, new.dados, new.emitido_em)
        is distinct from (old.numero, old.tipo, old.paciente_id, old.tutor_id, old.veterinario_id, old.atendimento_id, old.dados, old.emitido_em) then
    raise exception 'O documento emitido não pode ser alterado. Cancele e emita outro.';
  end if;
  return new;
end;
$$;
create trigger vet_documentos_imutavel before update or delete on public.vet_documentos
  for each row execute function app.tg_vet_documento_imutavel();

-- -----------------------------------------------------------------------------
-- 11. Serviços, contas e pagamentos (ligados ao Financeiro e ao caixa)
-- -----------------------------------------------------------------------------
create table public.vet_servicos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  categoria text not null default 'consulta' check (categoria in (
    'consulta', 'vacina', 'exame', 'cirurgia', 'procedimento', 'internacao', 'banho_tosa', 'outro'
  )),
  preco numeric(12, 2) not null check (preco >= 0),
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_servicos_empresa_id_unico unique (empresa_id, id)
);
create unique index vet_servicos_nome_uk on public.vet_servicos (empresa_id, lower(nome));
create trigger vet_servicos_updated_at before update on public.vet_servicos for each row execute function app.tg_updated_at();
create trigger auditoria_vet_servicos after insert or update or delete on public.vet_servicos for each row execute function app.tg_auditoria();

create table public.vet_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero bigint not null check (numero >= 1),
  tutor_id uuid not null,
  paciente_id uuid,
  atendimento_id uuid,
  status text not null default 'aberta' check (status in ('aberta', 'fechada', 'cancelada')),
  desconto numeric(12, 2) not null default 0 check (desconto >= 0),
  observacao text check (observacao is null or length(observacao) <= 300),
  fechada_em timestamptz,
  fechada_por uuid references public.perfis(id) on delete set null,
  cancelada_motivo text check (cancelada_motivo is null or length(cancelada_motivo) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vet_contas_empresa_id_unico unique (empresa_id, id),
  constraint vet_contas_numero_uk unique (empresa_id, numero),
  foreign key (empresa_id, tutor_id) references public.vet_tutores (empresa_id, id),
  foreign key (empresa_id, paciente_id) references public.vet_pacientes (empresa_id, id),
  foreign key (empresa_id, atendimento_id) references public.vet_atendimentos (empresa_id, id)
);
create unique index vet_contas_atendimento_uk on public.vet_contas (atendimento_id) where atendimento_id is not null and status <> 'cancelada';
create index vet_contas_tutor_idx on public.vet_contas (tutor_id, created_at desc);
create trigger vet_contas_updated_at before update on public.vet_contas for each row execute function app.tg_updated_at();
create trigger auditoria_vet_contas after insert or update or delete on public.vet_contas for each row execute function app.tg_auditoria();

create table public.vet_conta_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  conta_id uuid not null,
  servico_id uuid,
  descricao text not null check (length(trim(descricao)) between 2 and 120),
  quantidade numeric(10, 3) not null check (quantidade > 0),
  valor_unitario numeric(12, 2) not null check (valor_unitario >= 0),
  total numeric(12, 2) not null check (total >= 0),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  lancado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (empresa_id, conta_id) references public.vet_contas (empresa_id, id) on delete cascade,
  foreign key (empresa_id, servico_id) references public.vet_servicos (empresa_id, id)
);
create index vet_conta_itens_conta_idx on public.vet_conta_itens (conta_id);
create trigger auditoria_vet_conta_itens after insert or update or delete on public.vet_conta_itens for each row execute function app.tg_auditoria();

create table public.vet_pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  conta_id uuid not null,
  data date not null,
  forma text not null check (forma in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'a_receber', 'outro')),
  valor numeric(12, 2) not null check (valor > 0),
  -- A receber: vencimento combinado com o tutor
  vencimento date,
  sessao_id uuid references public.caixa_sessoes(id) on delete set null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  observacao text check (observacao is null or length(observacao) <= 300),
  cancelado_em timestamptz,
  cancelado_motivo text check (cancelado_motivo is null or length(cancelado_motivo) <= 300),
  registrado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vet_pagamentos_a_receber check ((forma = 'a_receber') = (vencimento is not null)),
  foreign key (empresa_id, conta_id) references public.vet_contas (empresa_id, id) on delete cascade
);
create index vet_pagamentos_conta_idx on public.vet_pagamentos (conta_id);
create index vet_pagamentos_sessao_idx on public.vet_pagamentos (sessao_id) where sessao_id is not null;
create trigger auditoria_vet_pagamentos after insert or update or delete on public.vet_pagamentos for each row execute function app.tg_auditoria();

-- -----------------------------------------------------------------------------
-- 12. Regras comuns
-- -----------------------------------------------------------------------------
create or replace function app.exigir_vet(p_empresa_id uuid, p_permissao text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, p_permissao);
  if coalesce((select modalidade from public.gestao_config where empresa_id = p_empresa_id), '') <> 'veterinaria' then
    raise exception 'A gestão da clínica veterinária não está ligada para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

-- Configuração da clínica (cria a padrão, o catálogo de vacinas e os serviços na primeira vez)
create or replace function app.vet_cfg(p_empresa_id uuid)
returns public.vet_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vet_config;
begin
  select * into v from public.vet_config where empresa_id = p_empresa_id;
  if v.empresa_id is null then
    insert into public.vet_config (empresa_id, mensagem_vacina, mensagem_retorno) values (
      p_empresa_id,
      'Olá, {tutor}! Aqui é da {clinica}. A vacina {vacina} do(a) {animal} está prevista para {data}. Quer agendar?',
      'Olá, {tutor}! Aqui é da {clinica}. O retorno do(a) {animal} está previsto para {data}. Quer agendar?'
    ) on conflict (empresa_id) do nothing;
    -- Catálogo inicial (a clínica ajusta os nomes, fabricantes e intervalos)
    insert into public.vet_vacinas (empresa_id, nome, especie, doses_iniciais, intervalo_doses_dias, reforco_dias, ordem) values
      (p_empresa_id, 'Polivalente canina (V8/V10)', 'canina', 3, 21, 365, 1),
      (p_empresa_id, 'Antirrábica', 'todas', 1, 21, 365, 2),
      (p_empresa_id, 'Gripe canina (tosse dos canis)', 'canina', 2, 21, 365, 3),
      (p_empresa_id, 'Giárdia', 'canina', 2, 21, 365, 4),
      (p_empresa_id, 'Leishmaniose', 'canina', 3, 21, 365, 5),
      (p_empresa_id, 'Polivalente felina (V3/V4/V5)', 'felina', 3, 21, 365, 6)
    on conflict do nothing;
    insert into public.vet_servicos (empresa_id, nome, categoria, preco, ordem) values
      (p_empresa_id, 'Consulta', 'consulta', 0, 1),
      (p_empresa_id, 'Retorno', 'consulta', 0, 2),
      (p_empresa_id, 'Aplicação de vacina', 'vacina', 0, 3)
    on conflict do nothing;
    select * into v from public.vet_config where empresa_id = p_empresa_id;
  end if;
  return v;
end;
$$;

-- Veterinário ligado a quem está usando o portal (os atos clínicos são assinados por ele)
create or replace function app.vet_veterinario_do_usuario(p_empresa_id uuid)
returns public.vet_veterinarios
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.vet_veterinarios;
begin
  select * into v from public.vet_veterinarios where empresa_id = p_empresa_id and perfil_id = auth.uid() and ativo;
  if v.id is null then
    raise exception 'Só o médico-veterinário cadastrado na clínica, com o próprio usuário, registra este ato. Peça ao responsável para ligar o seu usuário ao seu CRMV em Configurações da clínica.';
  end if;
  return v;
end;
$$;

-- Próximo número (atendimento, receita, documento ou conta), com a configuração travada
create or replace function app.vet_proximo_numero(p_empresa_id uuid, p_tipo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  perform app.vet_cfg(p_empresa_id);
  if p_tipo = 'atendimento' then
    update public.vet_config set proximo_numero_atendimento = proximo_numero_atendimento + 1 where empresa_id = p_empresa_id
      returning proximo_numero_atendimento - 1 into v;
  elsif p_tipo = 'receita' then
    update public.vet_config set proximo_numero_receita = proximo_numero_receita + 1 where empresa_id = p_empresa_id
      returning proximo_numero_receita - 1 into v;
  elsif p_tipo = 'documento' then
    update public.vet_config set proximo_numero_documento = proximo_numero_documento + 1 where empresa_id = p_empresa_id
      returning proximo_numero_documento - 1 into v;
  elsif p_tipo = 'conta' then
    update public.vet_config set proximo_numero_conta = proximo_numero_conta + 1 where empresa_id = p_empresa_id
      returning proximo_numero_conta - 1 into v;
  else
    raise exception 'Numeração desconhecida.';
  end if;
  return v;
end;
$$;

create or replace function app.vet_texto(p jsonb, p_chave text, p_max int)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(trim(coalesce(p ->> p_chave, '')), p_max), '');
$$;

-- Número digitado com vírgula ou ponto (vazio = nulo); texto que não é número vira mensagem clara
create or replace function app.vet_numero(p jsonb, p_chave text, p_rotulo text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(replace(trim(coalesce(p ->> p_chave, '')), ',', '.'), '');
begin
  if v is null then
    return null;
  end if;
  if v !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$' then
    raise exception 'Use só números em %.', p_rotulo;
  end if;
  return v::numeric;
end;
$$;

create or replace function app.vet_digitos(p jsonb, p_chave text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p ->> p_chave, ''), '\D', '', 'g'), '');
$$;

-- -----------------------------------------------------------------------------
-- 13. Ligar a modalidade (gestao_configurar aceita "veterinaria")
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
  if v_modalidade not in ('loja', 'notas', 'hotel', 'veterinaria') then
    raise exception 'Escolha a modalidade: loja completa, notas e transporte, hotel ou clínica veterinária.';
  end if;

  -- As contas do caixa, do banco e da maquininha: loja completa, hotel e clínica (recepção e loja)
  if v_ativa and v_modalidade in ('loja', 'hotel', 'veterinaria') then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', case v_modalidade
      when 'hotel' then 'Caixa da recepção' when 'veterinaria' then 'Caixa da clínica' else 'Caixa da loja' end));
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
end;
$$;

-- -----------------------------------------------------------------------------
-- 14. Configurações e cadastros do responsável (gestao.gerenciar)
-- -----------------------------------------------------------------------------
create or replace function public.vet_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.gerenciar');
  perform app.vet_cfg(p_empresa_id);
  update public.vet_config set
    nome_clinica = app.vet_texto(p_dados, 'nome_clinica', 120),
    registro_crmv = app.vet_texto(p_dados, 'registro_crmv', 30),
    telefone = app.vet_digitos(p_dados, 'telefone'),
    email = lower(app.vet_texto(p_dados, 'email', 200)),
    endereco = app.vet_texto(p_dados, 'endereco', 300),
    cidade_documentos = app.vet_texto(p_dados, 'cidade_documentos', 80),
    horario_inicio = coalesce(nullif(p_dados ->> 'horario_inicio', '')::time, horario_inicio),
    horario_fim = coalesce(nullif(p_dados ->> 'horario_fim', '')::time, horario_fim),
    duracao_padrao_min = coalesce(nullif(p_dados ->> 'duracao_padrao_min', '')::int, duracao_padrao_min),
    lembrete_dias_antes = coalesce(nullif(p_dados ->> 'lembrete_dias_antes', '')::int, lembrete_dias_antes),
    lembrete_email = coalesce((p_dados ->> 'lembrete_email')::boolean, lembrete_email),
    mensagem_vacina = coalesce(app.vet_texto(p_dados, 'mensagem_vacina', 600), mensagem_vacina),
    mensagem_retorno = coalesce(app.vet_texto(p_dados, 'mensagem_retorno', 600), mensagem_retorno),
    atualizado_por = auth.uid()
  where empresa_id = p_empresa_id;
end;
$$;

create or replace function public.vet_veterinario_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_dados ->> 'perfil_id', '')::uuid;
  v_id uuid := p_id;
  v_rt boolean := coalesce((p_dados ->> 'responsavel_tecnico')::boolean, false);
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.gerenciar');
  if v_perfil is not null and not exists (
    select 1 from public.empresa_membros m where m.empresa_id = p_empresa_id and m.user_id = v_perfil and m.ativo
  ) then
    raise exception 'Escolha um usuário que tenha acesso a esta empresa (convide-o em Configurações > Usuários).';
  end if;
  if app.vet_texto(p_dados, 'nome', 120) is null or app.vet_texto(p_dados, 'crmv', 15) is null or app.vet_texto(p_dados, 'crmv_uf', 2) is null then
    raise exception 'Informe o nome, o número e a UF do CRMV.';
  end if;
  begin
    if v_id is null then
      insert into public.vet_veterinarios (empresa_id, perfil_id, nome, crmv, crmv_uf, cadastro_mapa, especialidade, telefone, email, responsavel_tecnico, ativo)
      values (p_empresa_id, v_perfil, app.vet_texto(p_dados, 'nome', 120), upper(app.vet_texto(p_dados, 'crmv', 15)), upper(app.vet_texto(p_dados, 'crmv_uf', 2)),
              app.vet_texto(p_dados, 'cadastro_mapa', 30), app.vet_texto(p_dados, 'especialidade', 80), app.vet_digitos(p_dados, 'telefone'),
              lower(app.vet_texto(p_dados, 'email', 200)), v_rt, coalesce((p_dados ->> 'ativo')::boolean, true))
      returning id into v_id;
    else
      update public.vet_veterinarios set
        perfil_id = v_perfil,
        nome = app.vet_texto(p_dados, 'nome', 120),
        crmv = upper(app.vet_texto(p_dados, 'crmv', 15)),
        crmv_uf = upper(app.vet_texto(p_dados, 'crmv_uf', 2)),
        cadastro_mapa = app.vet_texto(p_dados, 'cadastro_mapa', 30),
        especialidade = app.vet_texto(p_dados, 'especialidade', 80),
        telefone = app.vet_digitos(p_dados, 'telefone'),
        email = lower(app.vet_texto(p_dados, 'email', 200)),
        responsavel_tecnico = v_rt,
        ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo)
      where id = v_id and empresa_id = p_empresa_id;
      if not found then
        raise exception 'Veterinário não encontrado.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Este CRMV ou este usuário já está ligado a outro veterinário da clínica.';
  when check_violation then
    raise exception 'Confira o CRMV (número e UF), o cadastro no MAPA, o telefone e o e-mail.';
  end;
  -- Um só responsável técnico
  if v_rt then
    update public.vet_veterinarios set responsavel_tecnico = false where empresa_id = p_empresa_id and id <> v_id and responsavel_tecnico;
  end if;
  return v_id;
end;
$$;

create or replace function public.vet_vacina_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.gerenciar');
  if app.vet_texto(p_dados, 'nome', 80) is null then
    raise exception 'Informe o nome da vacina.';
  end if;
  begin
    if v_id is null then
      insert into public.vet_vacinas (empresa_id, nome, especie, fabricante, doses_iniciais, intervalo_doses_dias, reforco_dias, observacao, ativa, ordem)
      values (p_empresa_id, app.vet_texto(p_dados, 'nome', 80), coalesce(nullif(p_dados ->> 'especie', ''), 'canina'), app.vet_texto(p_dados, 'fabricante', 80),
              coalesce(nullif(p_dados ->> 'doses_iniciais', '')::int, 1), coalesce(nullif(p_dados ->> 'intervalo_doses_dias', '')::int, 21),
              nullif(p_dados ->> 'reforco_dias', '')::int, app.vet_texto(p_dados, 'observacao', 300), coalesce((p_dados ->> 'ativa')::boolean, true),
              coalesce((select max(ordem) + 1 from public.vet_vacinas where empresa_id = p_empresa_id), 1))
      returning id into v_id;
    else
      update public.vet_vacinas set
        nome = app.vet_texto(p_dados, 'nome', 80),
        especie = coalesce(nullif(p_dados ->> 'especie', ''), especie),
        fabricante = app.vet_texto(p_dados, 'fabricante', 80),
        doses_iniciais = coalesce(nullif(p_dados ->> 'doses_iniciais', '')::int, doses_iniciais),
        intervalo_doses_dias = coalesce(nullif(p_dados ->> 'intervalo_doses_dias', '')::int, intervalo_doses_dias),
        reforco_dias = nullif(p_dados ->> 'reforco_dias', '')::int,
        observacao = app.vet_texto(p_dados, 'observacao', 300),
        ativa = coalesce((p_dados ->> 'ativa')::boolean, ativa)
      where id = v_id and empresa_id = p_empresa_id;
      if not found then
        raise exception 'Vacina não encontrada.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe uma vacina com este nome.';
  when check_violation then
    raise exception 'Confira as doses (1 a 6), o intervalo entre doses (7 a 120 dias) e o reforço (30 a 1825 dias).';
  end;
  return v_id;
end;
$$;

create or replace function public.vet_servico_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_preco numeric := app.vet_numero(p_dados, 'preco', 'preço');
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.gerenciar');
  if app.vet_texto(p_dados, 'nome', 80) is null or v_preco is null or v_preco < 0 or v_preco <> round(v_preco, 2) then
    raise exception 'Informe o nome e o preço do serviço.';
  end if;
  begin
    if v_id is null then
      insert into public.vet_servicos (empresa_id, nome, categoria, preco, ativo, ordem)
      values (p_empresa_id, app.vet_texto(p_dados, 'nome', 80), coalesce(nullif(p_dados ->> 'categoria', ''), 'outro'), v_preco,
              coalesce((p_dados ->> 'ativo')::boolean, true), coalesce((select max(ordem) + 1 from public.vet_servicos where empresa_id = p_empresa_id), 1))
      returning id into v_id;
    else
      update public.vet_servicos set
        nome = app.vet_texto(p_dados, 'nome', 80),
        categoria = coalesce(nullif(p_dados ->> 'categoria', ''), categoria),
        preco = v_preco,
        ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo)
      where id = v_id and empresa_id = p_empresa_id;
      if not found then
        raise exception 'Serviço não encontrado.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe um serviço com este nome.';
  when check_violation then
    raise exception 'Confira a categoria do serviço.';
  end;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 15. Tutores e animais (recepção: gestao.vender)
-- -----------------------------------------------------------------------------
create or replace function public.vet_tutor_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_cpf text := app.vet_digitos(p_dados, 'cpf');
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  if app.vet_texto(p_dados, 'nome', 120) is null then
    raise exception 'Informe o nome do tutor.';
  end if;
  if v_cpf is not null and not app.cpf_valido(v_cpf) then
    raise exception 'CPF inválido.';
  end if;
  begin
    if v_id is null then
      insert into public.vet_tutores (
        empresa_id, nome, cpf, telefone, telefone2, email, cep, logradouro, numero, complemento, bairro, cidade, uf,
        autorizados, observacoes, aceita_whatsapp, aceita_email
      ) values (
        p_empresa_id, app.vet_texto(p_dados, 'nome', 120), v_cpf, app.vet_digitos(p_dados, 'telefone'), app.vet_digitos(p_dados, 'telefone2'),
        lower(app.vet_texto(p_dados, 'email', 200)), app.vet_digitos(p_dados, 'cep'), app.vet_texto(p_dados, 'logradouro', 150),
        app.vet_texto(p_dados, 'numero', 20), app.vet_texto(p_dados, 'complemento', 80), app.vet_texto(p_dados, 'bairro', 80),
        app.vet_texto(p_dados, 'cidade', 80), upper(app.vet_texto(p_dados, 'uf', 2)), app.vet_texto(p_dados, 'autorizados', 500),
        app.vet_texto(p_dados, 'observacoes', 1000), coalesce((p_dados ->> 'aceita_whatsapp')::boolean, true),
        coalesce((p_dados ->> 'aceita_email')::boolean, false)
      ) returning id into v_id;
    else
      update public.vet_tutores set
        nome = app.vet_texto(p_dados, 'nome', 120),
        cpf = v_cpf,
        telefone = app.vet_digitos(p_dados, 'telefone'),
        telefone2 = app.vet_digitos(p_dados, 'telefone2'),
        email = lower(app.vet_texto(p_dados, 'email', 200)),
        cep = app.vet_digitos(p_dados, 'cep'),
        logradouro = app.vet_texto(p_dados, 'logradouro', 150),
        numero = app.vet_texto(p_dados, 'numero', 20),
        complemento = app.vet_texto(p_dados, 'complemento', 80),
        bairro = app.vet_texto(p_dados, 'bairro', 80),
        cidade = app.vet_texto(p_dados, 'cidade', 80),
        uf = upper(app.vet_texto(p_dados, 'uf', 2)),
        autorizados = app.vet_texto(p_dados, 'autorizados', 500),
        observacoes = app.vet_texto(p_dados, 'observacoes', 1000),
        aceita_whatsapp = coalesce((p_dados ->> 'aceita_whatsapp')::boolean, aceita_whatsapp),
        aceita_email = coalesce((p_dados ->> 'aceita_email')::boolean, aceita_email)
      where id = v_id and empresa_id = p_empresa_id;
      if not found then
        raise exception 'Tutor não encontrado.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Já existe um tutor com este CPF.';
  when check_violation then
    raise exception 'Confira o telefone (com DDD), o e-mail, o CEP e a UF.';
  end;
  return v_id;
end;
$$;

create or replace function public.vet_tutor_excluir(p_tutor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.vet_tutores;
begin
  select * into t from public.vet_tutores where id = p_tutor_id;
  if t.id is null then
    raise exception 'Tutor não encontrado.';
  end if;
  perform app.exigir_vet(t.empresa_id, 'gestao.gerenciar');
  if exists (select 1 from public.vet_pacientes where tutor_id = t.id)
     or exists (select 1 from public.vet_contas where tutor_id = t.id)
     or exists (select 1 from public.vet_atendimentos where tutor_id = t.id)
     or exists (select 1 from public.vet_agenda where tutor_id = t.id) then
    raise exception 'Este tutor tem animais, atendimentos ou contas: o cadastro fica guardado no histórico da clínica.';
  end if;
  delete from public.vet_tutores where id = t.id;
end;
$$;

create or replace function public.vet_paciente_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_tutor uuid := nullif(p_dados ->> 'tutor_id', '')::uuid;
  v_nasc date := nullif(p_dados ->> 'nascimento', '')::date;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  if v_tutor is null or not exists (select 1 from public.vet_tutores where id = v_tutor and empresa_id = p_empresa_id) then
    raise exception 'Escolha o tutor do animal.';
  end if;
  if app.vet_texto(p_dados, 'nome', 80) is null or nullif(p_dados ->> 'especie', '') is null then
    raise exception 'Informe o nome e a espécie do animal.';
  end if;
  if v_nasc is not null and v_nasc > app.hoje() then
    raise exception 'A data de nascimento não pode ser no futuro.';
  end if;
  begin
    if v_id is null then
      insert into public.vet_pacientes (
        empresa_id, tutor_id, nome, especie, especie_outra, raca, sexo, castrado, nascimento, nascimento_estimado, pelagem, porte,
        peso_kg, microchip, sinais_particulares, alergias, observacoes
      ) values (
        p_empresa_id, v_tutor, app.vet_texto(p_dados, 'nome', 80), p_dados ->> 'especie', app.vet_texto(p_dados, 'especie_outra', 60),
        app.vet_texto(p_dados, 'raca', 80), coalesce(nullif(p_dados ->> 'sexo', ''), 'indefinido'), coalesce((p_dados ->> 'castrado')::boolean, false),
        v_nasc, coalesce((p_dados ->> 'nascimento_estimado')::boolean, false), app.vet_texto(p_dados, 'pelagem', 80), nullif(p_dados ->> 'porte', ''),
        app.vet_numero(p_dados, 'peso_kg', 'peso'), upper(app.vet_texto(p_dados, 'microchip', 23)), app.vet_texto(p_dados, 'sinais_particulares', 300),
        app.vet_texto(p_dados, 'alergias', 500), app.vet_texto(p_dados, 'observacoes', 1000)
      ) returning id into v_id;
    else
      update public.vet_pacientes set
        tutor_id = v_tutor,
        nome = app.vet_texto(p_dados, 'nome', 80),
        especie = p_dados ->> 'especie',
        especie_outra = app.vet_texto(p_dados, 'especie_outra', 60),
        raca = app.vet_texto(p_dados, 'raca', 80),
        sexo = coalesce(nullif(p_dados ->> 'sexo', ''), sexo),
        castrado = coalesce((p_dados ->> 'castrado')::boolean, castrado),
        nascimento = v_nasc,
        nascimento_estimado = coalesce((p_dados ->> 'nascimento_estimado')::boolean, nascimento_estimado),
        pelagem = app.vet_texto(p_dados, 'pelagem', 80),
        porte = nullif(p_dados ->> 'porte', ''),
        peso_kg = coalesce(app.vet_numero(p_dados, 'peso_kg', 'peso'), peso_kg),
        microchip = upper(app.vet_texto(p_dados, 'microchip', 23)),
        sinais_particulares = app.vet_texto(p_dados, 'sinais_particulares', 300),
        alergias = app.vet_texto(p_dados, 'alergias', 500),
        observacoes = app.vet_texto(p_dados, 'observacoes', 1000),
        ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo)
      where id = v_id and empresa_id = p_empresa_id;
      if not found then
        raise exception 'Animal não encontrado.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'Este microchip já está cadastrado em outro animal.';
  when check_violation then
    raise exception 'Confira a espécie (em "outra", diga qual), o sexo, o porte, o peso e o microchip (6 a 23 letras ou números).';
  end;
  return v_id;
end;
$$;

create or replace function public.vet_paciente_excluir(p_paciente_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.vet_pacientes;
begin
  select * into p from public.vet_pacientes where id = p_paciente_id;
  if p.id is null then
    raise exception 'Animal não encontrado.';
  end if;
  perform app.exigir_vet(p.empresa_id, 'gestao.gerenciar');
  if exists (select 1 from public.vet_atendimentos where paciente_id = p.id)
     or exists (select 1 from public.vet_vacinacoes where paciente_id = p.id)
     or exists (select 1 from public.vet_receitas where paciente_id = p.id)
     or exists (select 1 from public.vet_documentos where paciente_id = p.id)
     or exists (select 1 from public.vet_contas where paciente_id = p.id)
     or exists (select 1 from public.vet_agenda where paciente_id = p.id) then
    raise exception 'Este animal tem prontuário, vacinas, receitas, agenda ou contas: o prontuário é guardado por pelo menos 5 anos. Marque como inativo.';
  end if;
  delete from public.vet_pacientes where id = p.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 16. Agenda (recepção)
-- -----------------------------------------------------------------------------
create or replace function public.vet_agenda_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_paciente uuid := nullif(p_dados ->> 'paciente_id', '')::uuid;
  v_tutor uuid;
  v_vet uuid := nullif(p_dados ->> 'veterinario_id', '')::uuid;
  v_inicio timestamptz := nullif(p_dados ->> 'inicio', '')::timestamptz;
  v_cfg public.vet_config;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  v_cfg := app.vet_cfg(p_empresa_id);
  if v_inicio is null then
    raise exception 'Informe o dia e a hora.';
  end if;
  if v_paciente is not null then
    select tutor_id into v_tutor from public.vet_pacientes where id = v_paciente and empresa_id = p_empresa_id;
    if v_tutor is null then
      raise exception 'Animal não encontrado.';
    end if;
  elsif app.vet_texto(p_dados, 'nome_avulso', 120) is null then
    raise exception 'Escolha o animal ou escreva o nome de quem vai trazer.';
  end if;
  if v_vet is not null and not exists (select 1 from public.vet_veterinarios where id = v_vet and empresa_id = p_empresa_id and ativo) then
    raise exception 'Veterinário não encontrado.';
  end if;
  begin
    if v_id is null then
      insert into public.vet_agenda (empresa_id, inicio, duracao_min, tipo, paciente_id, tutor_id, nome_avulso, telefone_avulso, veterinario_id, observacoes)
      values (p_empresa_id, v_inicio, coalesce(nullif(p_dados ->> 'duracao_min', '')::int, v_cfg.duracao_padrao_min),
              coalesce(nullif(p_dados ->> 'tipo', ''), 'consulta'), v_paciente, v_tutor,
              case when v_paciente is null then app.vet_texto(p_dados, 'nome_avulso', 120) end,
              case when v_paciente is null then app.vet_digitos(p_dados, 'telefone_avulso') end,
              v_vet, app.vet_texto(p_dados, 'observacoes', 500))
      returning id into v_id;
    else
      update public.vet_agenda set
        inicio = v_inicio,
        duracao_min = coalesce(nullif(p_dados ->> 'duracao_min', '')::int, duracao_min),
        tipo = coalesce(nullif(p_dados ->> 'tipo', ''), tipo),
        paciente_id = v_paciente,
        tutor_id = v_tutor,
        nome_avulso = case when v_paciente is null then app.vet_texto(p_dados, 'nome_avulso', 120) end,
        telefone_avulso = case when v_paciente is null then app.vet_digitos(p_dados, 'telefone_avulso') end,
        veterinario_id = v_vet,
        observacoes = app.vet_texto(p_dados, 'observacoes', 500)
      where id = v_id and empresa_id = p_empresa_id and status in ('agendado', 'confirmado', 'chegou');
      if not found then
        raise exception 'Agendamento não encontrado ou já atendido.';
      end if;
    end if;
  exception when check_violation then
    raise exception 'Confira o tipo, a duração (5 a 720 minutos) e o telefone (com DDD).';
  end;
  return v_id;
end;
$$;

create or replace function public.vet_agenda_status(p_agenda_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.vet_agenda;
begin
  select * into a from public.vet_agenda where id = p_agenda_id for update;
  if a.id is null then
    raise exception 'Agendamento não encontrado.';
  end if;
  perform app.exigir_vet(a.empresa_id, 'gestao.vender');
  if p_status not in ('agendado', 'confirmado', 'chegou', 'faltou', 'cancelado') then
    raise exception 'Situação inválida.';
  end if;
  if a.status in ('em_atendimento', 'concluido') then
    raise exception 'Este agendamento já foi atendido.';
  end if;
  update public.vet_agenda set status = p_status where id = a.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 17. Prontuário (só o médico-veterinário registra os atos clínicos)
-- -----------------------------------------------------------------------------
create or replace function public.vet_atendimento_abrir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vet public.vet_veterinarios;
  p public.vet_pacientes;
  a public.vet_agenda;
  v_agenda uuid := nullif(p_dados ->> 'agendamento_id', '')::uuid;
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'consulta');
  v_id uuid;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(p_empresa_id);
  if v_agenda is not null then
    select * into a from public.vet_agenda where id = v_agenda and empresa_id = p_empresa_id for update;
    if a.id is null then
      raise exception 'Agendamento não encontrado.';
    end if;
    if a.status in ('em_atendimento', 'concluido', 'cancelado', 'faltou') then
      raise exception 'Este agendamento não está esperando atendimento.';
    end if;
    if a.paciente_id is null then
      raise exception 'Cadastre o tutor e o animal deste agendamento antes de atender.';
    end if;
  end if;
  select * into p from public.vet_pacientes where id = coalesce(a.paciente_id, nullif(p_dados ->> 'paciente_id', '')::uuid) and empresa_id = p_empresa_id;
  if p.id is null then
    raise exception 'Escolha o animal.';
  end if;
  if p.obito_em is not null then
    raise exception 'Este animal tem óbito registrado.';
  end if;
  if a.id is not null and v_tipo = 'consulta' then
    v_tipo := case a.tipo when 'retorno' then 'retorno' when 'vacina' then 'vacinacao' when 'cirurgia' then 'cirurgia' when 'exame' then 'exame' else 'consulta' end;
  end if;
  begin
    insert into public.vet_atendimentos (empresa_id, numero, paciente_id, tutor_id, veterinario_id, agendamento_id, tipo, local, relato)
    values (p_empresa_id, app.vet_proximo_numero(p_empresa_id, 'atendimento'), p.id, p.tutor_id, v_vet.id, a.id, v_tipo,
            app.vet_texto(p_dados, 'local', 120), app.vet_texto(p_dados, 'relato', 5000))
    returning id into v_id;
  exception when check_violation then
    raise exception 'Tipo de atendimento inválido.';
  end;
  if a.id is not null then
    update public.vet_agenda set status = 'em_atendimento', atendimento_id = v_id, veterinario_id = coalesce(veterinario_id, v_vet.id) where id = a.id;
  end if;
  return v_id;
end;
$$;

create or replace function public.vet_atendimento_salvar(p_atendimento_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  v_vet public.vet_veterinarios;
  v_peso numeric := app.vet_numero(p_dados, 'peso_kg', 'peso');
  v_retorno date := nullif(p_dados ->> 'retorno_em', '')::date;
begin
  select * into at from public.vet_atendimentos where id = p_atendimento_id for update;
  if at.id is null then
    raise exception 'Atendimento não encontrado.';
  end if;
  perform app.exigir_vet(at.empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(at.empresa_id);
  if at.status <> 'aberto' then
    raise exception 'Atendimento finalizado não pode ser alterado. Registre um adendo.';
  end if;
  if at.veterinario_id <> v_vet.id then
    raise exception 'Só o veterinário que abriu o atendimento pode preenchê-lo.';
  end if;
  if v_retorno is not null and v_retorno <= (at.data_hora at time zone 'America/Sao_Paulo')::date then
    raise exception 'O retorno precisa ser depois do dia do atendimento.';
  end if;
  begin
    update public.vet_atendimentos set
      tipo = coalesce(nullif(p_dados ->> 'tipo', ''), tipo),
      local = app.vet_texto(p_dados, 'local', 120),
      relato = app.vet_texto(p_dados, 'relato', 5000),
      anamnese = app.vet_texto(p_dados, 'anamnese', 10000),
      peso_kg = v_peso,
      temperatura = app.vet_numero(p_dados, 'temperatura', 'temperatura'),
      frequencia_cardiaca = app.vet_numero(p_dados, 'frequencia_cardiaca', 'frequência cardíaca')::int,
      frequencia_respiratoria = app.vet_numero(p_dados, 'frequencia_respiratoria', 'frequência respiratória')::int,
      tpc = app.vet_numero(p_dados, 'tpc', 'TPC'),
      mucosas = app.vet_texto(p_dados, 'mucosas', 60),
      hidratacao = app.vet_texto(p_dados, 'hidratacao', 60),
      estado_geral = app.vet_texto(p_dados, 'estado_geral', 300),
      exame_fisico = app.vet_texto(p_dados, 'exame_fisico', 10000),
      diagnostico_presuntivo = app.vet_texto(p_dados, 'diagnostico_presuntivo', 2000),
      diagnostico_conclusivo = app.vet_texto(p_dados, 'diagnostico_conclusivo', 2000),
      procedimentos = app.vet_texto(p_dados, 'procedimentos', 5000),
      tratamento = app.vet_texto(p_dados, 'tratamento', 5000),
      orientacoes = app.vet_texto(p_dados, 'orientacoes', 5000),
      retorno_em = v_retorno,
      retorno_motivo = case when v_retorno is not null then app.vet_texto(p_dados, 'retorno_motivo', 200) end
    where id = at.id;
  exception when check_violation then
    raise exception 'Confira o peso, a temperatura (25 a 46 °C), as frequências e o TPC.';
  when invalid_text_representation then
    raise exception 'Use só números no peso, na temperatura, nas frequências e no TPC.';
  end;
  if v_peso is not null then
    update public.vet_pacientes set peso_kg = v_peso where id = at.paciente_id;
  end if;
end;
$$;

create or replace function public.vet_atendimento_finalizar(p_atendimento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  v_vet public.vet_veterinarios;
begin
  select * into at from public.vet_atendimentos where id = p_atendimento_id for update;
  if at.id is null then
    raise exception 'Atendimento não encontrado.';
  end if;
  perform app.exigir_vet(at.empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(at.empresa_id);
  if at.status <> 'aberto' then
    raise exception 'Este atendimento já foi finalizado ou cancelado.';
  end if;
  if at.veterinario_id <> v_vet.id then
    raise exception 'Só o veterinário que abriu o atendimento pode finalizá-lo.';
  end if;
  if coalesce(at.relato, at.anamnese, at.exame_fisico, at.procedimentos, at.diagnostico_presuntivo, at.estado_geral) is null
     and not exists (select 1 from public.vet_vacinacoes where atendimento_id = at.id and cancelada_em is null) then
    raise exception 'Preencha o atendimento (relato, exame, diagnóstico, procedimentos ou vacina aplicada) antes de finalizar.';
  end if;
  update public.vet_atendimentos set status = 'finalizado', finalizado_em = now(), finalizado_por = auth.uid() where id = at.id;
  if at.agendamento_id is not null then
    update public.vet_agenda set status = 'concluido' where id = at.agendamento_id and status = 'em_atendimento';
  end if;
end;
$$;

create or replace function public.vet_atendimento_cancelar(p_atendimento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  v_vet public.vet_veterinarios;
begin
  select * into at from public.vet_atendimentos where id = p_atendimento_id for update;
  if at.id is null then
    raise exception 'Atendimento não encontrado.';
  end if;
  perform app.exigir_vet(at.empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(at.empresa_id);
  if at.status <> 'aberto' then
    raise exception 'Só um atendimento aberto pode ser cancelado. Registre um adendo no finalizado.';
  end if;
  if at.veterinario_id <> v_vet.id then
    raise exception 'Só o veterinário que abriu o atendimento pode cancelá-lo.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  if exists (select 1 from public.vet_vacinacoes where atendimento_id = at.id and cancelada_em is null)
     or exists (select 1 from public.vet_receitas where atendimento_id = at.id and cancelada_em is null)
     or exists (select 1 from public.vet_documentos where atendimento_id = at.id and cancelado_em is null) then
    raise exception 'Este atendimento tem vacina, receita ou documento: finalize-o (ou cancele esses registros antes).';
  end if;
  update public.vet_atendimentos set status = 'cancelado', cancelado_motivo = left(trim(p_motivo), 300) where id = at.id;
  if at.agendamento_id is not null then
    update public.vet_agenda set status = 'chegou', atendimento_id = null where id = at.agendamento_id and status = 'em_atendimento';
  end if;
end;
$$;

create or replace function public.vet_adendo_registrar(p_atendimento_id uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  v_vet public.vet_veterinarios;
  v_id uuid;
begin
  select * into at from public.vet_atendimentos where id = p_atendimento_id;
  if at.id is null then
    raise exception 'Atendimento não encontrado.';
  end if;
  perform app.exigir_vet(at.empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(at.empresa_id);
  if at.status <> 'finalizado' then
    raise exception 'O adendo é para atendimento finalizado. Este ainda pode ser editado.';
  end if;
  if length(trim(coalesce(p_texto, ''))) < 3 then
    raise exception 'Escreva o adendo.';
  end if;
  insert into public.vet_adendos (empresa_id, atendimento_id, veterinario_id, texto)
  values (at.empresa_id, at.id, v_vet.id, left(trim(p_texto), 5000))
  returning id into v_id;
  return v_id;
end;
$$;

-- Anexos: 1ª etapa registra e devolve o caminho; 2ª confirma depois que o arquivo chegou
create or replace function public.vet_anexo_iniciar(p_atendimento_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  v_mime text := lower(trim(coalesce(p_dados ->> 'mime', '')));
  v_tamanho bigint;
  v_nome text := left(trim(coalesce(p_dados ->> 'nome', '')), 200);
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_caminho text;
begin
  select * into at from public.vet_atendimentos where id = p_atendimento_id;
  if at.id is null then
    raise exception 'Atendimento não encontrado.';
  end if;
  perform app.exigir_vet(at.empresa_id, 'gestao.vender');
  if at.status = 'cancelado' then
    raise exception 'Este atendimento foi cancelado.';
  end if;
  v_ext := case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' end;
  if v_ext is null then
    raise exception 'Envie um PDF ou uma imagem (JPG, PNG ou WEBP).';
  end if;
  begin
    v_tamanho := (p_dados ->> 'tamanho')::bigint;
  exception when others then
    v_tamanho := null;
  end;
  if v_tamanho is null or v_tamanho <= 0 or v_tamanho > 15728640 then
    raise exception 'O arquivo precisa ter até 15 MB.';
  end if;
  if v_nome = '' then
    v_nome := 'anexo.' || v_ext;
  end if;
  if (select count(*) from public.vet_anexos where atendimento_id = at.id) >= 30 then
    raise exception 'Este atendimento já tem 30 anexos.';
  end if;
  v_caminho := at.empresa_id::text || '/' || at.id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.vet_anexos (id, empresa_id, atendimento_id, caminho, nome, descricao, mime, tamanho)
  values (v_id, at.empresa_id, at.id, v_caminho, v_nome, app.vet_texto(p_dados, 'descricao', 200), v_mime, v_tamanho);
  return jsonb_build_object('id', v_id, 'caminho', v_caminho);
end;
$$;

create or replace function public.vet_anexo_confirmar(p_anexo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vet_anexos;
  v_obj jsonb;
begin
  select * into v from public.vet_anexos where id = p_anexo_id for update;
  if v.id is null then
    raise exception 'Anexo não encontrado.';
  end if;
  perform app.exigir_vet(v.empresa_id, 'gestao.vender');
  if v.confirmado_em is not null then
    return;
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'vet-anexos' and o.name = v.caminho;
  if v_obj is null then
    raise exception 'O arquivo não chegou. Envie de novo.';
  end if;
  update public.vet_anexos set confirmado_em = now() where id = v.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 18. Receitas (veterinário)
-- -----------------------------------------------------------------------------
create or replace function public.vet_receita_emitir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vet public.vet_veterinarios;
  p public.vet_pacientes;
  t public.vet_tutores;
  at public.vet_atendimentos;
  v_tipo text := coalesce(nullif(p_dados ->> 'tipo', ''), 'simples');
  v_continuo boolean := coalesce((p_dados ->> 'uso_continuo')::boolean, false);
  v_itens jsonb := coalesce(p_dados -> 'itens', '[]'::jsonb);
  v_item jsonb;
  v_ordem int := 0;
  v_id uuid;
  v_controle text;
  v_seq int;
  v_validade date;
  v_hoje date := app.hoje();
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(p_empresa_id);
  if v_tipo not in ('simples', 'antimicrobiano', 'magistral_controlada') then
    raise exception 'Escolha o tipo de receita.';
  end if;
  if nullif(p_dados ->> 'atendimento_id', '') is not null then
    select * into at from public.vet_atendimentos where id = (p_dados ->> 'atendimento_id')::uuid and empresa_id = p_empresa_id;
    if at.id is null or at.status = 'cancelado' then
      raise exception 'Atendimento não encontrado.';
    end if;
  end if;
  select * into p from public.vet_pacientes where id = coalesce(at.paciente_id, nullif(p_dados ->> 'paciente_id', '')::uuid) and empresa_id = p_empresa_id;
  if p.id is null then
    raise exception 'Escolha o animal.';
  end if;
  select * into t from public.vet_tutores where id = p.tutor_id;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then
    raise exception 'Inclua pelo menos um medicamento.';
  end if;
  if jsonb_array_length(v_itens) > 30 then
    raise exception 'Uma receita pode ter até 30 itens.';
  end if;

  -- Validade: antimicrobiano 10 dias (90 em uso contínuo); magistral controlada 30 dias (180 em uso contínuo)
  v_validade := case v_tipo
    when 'antimicrobiano' then v_hoje + case when v_continuo then 90 else 10 end
    when 'magistral_controlada' then v_hoje + case when v_continuo then 180 else 30 end
  end;
  if v_tipo = 'magistral_controlada' then
    if v_vet.cadastro_mapa is null then
      raise exception 'Para a receita magistral sujeita a controle especial, informe o seu número de cadastro no MAPA nas configurações da clínica.';
    end if;
    if t.logradouro is null or t.cidade is null then
      raise exception 'A receita magistral controlada precisa do endereço do responsável: complete o cadastro do tutor.';
    end if;
    update public.vet_veterinarios set proximo_numero_magistral = proximo_numero_magistral + 1 where id = v_vet.id
      returning proximo_numero_magistral - 1 into v_seq;
    v_controle := v_vet.cadastro_mapa || '-' || lpad(v_seq::text, 4, '0') || '-' || to_char(v_hoje, 'YY');
  end if;

  insert into public.vet_receitas (empresa_id, numero, tipo, paciente_id, tutor_id, veterinario_id, atendimento_id, numero_controle, uso_continuo, validade, observacoes)
  values (p_empresa_id, app.vet_proximo_numero(p_empresa_id, 'receita'), v_tipo, p.id, p.tutor_id, v_vet.id, at.id, v_controle, v_continuo, v_validade,
          app.vet_texto(p_dados, 'observacoes', 2000))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    v_ordem := v_ordem + 1;
    if app.vet_texto(v_item, 'medicamento', 300) is null or app.vet_texto(v_item, 'quantidade', 80) is null or app.vet_texto(v_item, 'posologia', 1000) is null then
      raise exception 'Item %: informe o medicamento, a quantidade e a posologia (modo de usar).', v_ordem;
    end if;
    if v_tipo = 'magistral_controlada' and (app.vet_texto(v_item, 'concentracao', 120) is null or app.vet_texto(v_item, 'forma_farmaceutica', 80) is null) then
      raise exception 'Item %: na receita magistral, informe as substâncias com as concentrações e a forma farmacêutica.', v_ordem;
    end if;
    begin
      insert into public.vet_receita_itens (empresa_id, receita_id, ordem, medicamento, concentracao, forma_farmaceutica, quantidade, via, posologia, duracao, uso)
      values (p_empresa_id, v_id, v_ordem, app.vet_texto(v_item, 'medicamento', 300), app.vet_texto(v_item, 'concentracao', 120),
              app.vet_texto(v_item, 'forma_farmaceutica', 80), app.vet_texto(v_item, 'quantidade', 80), coalesce(nullif(v_item ->> 'via', ''), 'oral'),
              app.vet_texto(v_item, 'posologia', 1000), app.vet_texto(v_item, 'duracao', 80),
              case v_tipo when 'magistral_controlada' then 'manipulado' when 'antimicrobiano' then 'humano'
                          else coalesce(nullif(v_item ->> 'uso', ''), 'veterinario') end);
    exception when check_violation then
      raise exception 'Item %: confira a via de administração e a farmácia.', v_ordem;
    end;
  end loop;
  return v_id;
end;
$$;

create or replace function public.vet_receita_cancelar(p_receita_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.vet_receitas;
  v_vet uuid;
begin
  select * into r from public.vet_receitas where id = p_receita_id for update;
  if r.id is null then
    raise exception 'Receita não encontrada.';
  end if;
  perform app.exigir_vet(r.empresa_id, 'gestao.vender');
  select id into v_vet from public.vet_veterinarios where empresa_id = r.empresa_id and perfil_id = auth.uid() and ativo;
  if v_vet is distinct from r.veterinario_id and not app.pode(r.empresa_id, 'gestao.gerenciar') then
    raise exception 'Só quem emitiu a receita (ou o responsável pela clínica) pode cancelá-la.';
  end if;
  if r.cancelada_em is not null then
    raise exception 'Esta receita já foi cancelada.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.vet_receitas set cancelada_em = now(), cancelada_motivo = left(trim(p_motivo), 300) where id = r.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 19. Vacinas aplicadas (carteira) e lembretes
-- -----------------------------------------------------------------------------
create or replace function public.vet_vacinacao_registrar(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vet public.vet_veterinarios;
  p public.vet_pacientes;
  vc public.vet_vacinas;
  at public.vet_atendimentos;
  v_origem text := coalesce(nullif(p_dados ->> 'origem', ''), 'clinica');
  v_dose text := coalesce(nullif(p_dados ->> 'dose', ''), 'unica');
  v_aplicada date := coalesce(nullif(p_dados ->> 'aplicada_em', '')::date, app.hoje());
  v_validade date := nullif(p_dados ->> 'validade', '')::date;
  v_fabricacao date := nullif(p_dados ->> 'fabricacao', '')::date;
  v_proxima date := nullif(p_dados ->> 'proxima_dose_em', '')::date;
  v_nome text;
  v_id uuid;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  if v_origem not in ('clinica', 'externa') then
    raise exception 'Origem inválida.';
  end if;
  if v_origem = 'clinica' then
    v_vet := app.vet_veterinario_do_usuario(p_empresa_id);
  end if;
  if nullif(p_dados ->> 'atendimento_id', '') is not null then
    select * into at from public.vet_atendimentos where id = (p_dados ->> 'atendimento_id')::uuid and empresa_id = p_empresa_id;
    if at.id is null or at.status <> 'aberto' then
      raise exception 'A vacina entra num atendimento aberto.';
    end if;
  end if;
  select * into p from public.vet_pacientes where id = coalesce(at.paciente_id, nullif(p_dados ->> 'paciente_id', '')::uuid) and empresa_id = p_empresa_id;
  if p.id is null then
    raise exception 'Escolha o animal.';
  end if;
  if nullif(p_dados ->> 'vacina_id', '') is not null then
    select * into vc from public.vet_vacinas where id = (p_dados ->> 'vacina_id')::uuid and empresa_id = p_empresa_id;
    if vc.id is null then
      raise exception 'Vacina não encontrada no catálogo.';
    end if;
  end if;
  v_nome := coalesce(vc.nome, app.vet_texto(p_dados, 'vacina_nome', 80));
  if v_nome is null then
    raise exception 'Escolha a vacina.';
  end if;
  if v_aplicada > app.hoje() then
    raise exception 'A data da aplicação não pode ser no futuro.';
  end if;
  if v_origem = 'clinica' then
    if app.vet_texto(p_dados, 'fabricante', 80) is null and vc.fabricante is null or app.vet_texto(p_dados, 'partida', 40) is null
       or v_fabricacao is null or v_validade is null then
      raise exception 'Informe o fabricante, a partida (lote), a fabricação e a validade da vacina (Res. CFMV nº 1.321/2020).';
    end if;
    if v_validade < v_aplicada then
      raise exception 'A vacina estava vencida na data da aplicação. Confira a validade.';
    end if;
  end if;
  -- Próxima dose: do esquema inicial ou do reforço, pelo catálogo (a pessoa pode mudar)
  if v_proxima is null and vc.id is not null then
    v_proxima := case
      when v_dose ~ '^[0-9]$' and v_dose::int < vc.doses_iniciais then v_aplicada + vc.intervalo_doses_dias
      when vc.reforco_dias is not null then v_aplicada + vc.reforco_dias
    end;
  end if;
  begin
    insert into public.vet_vacinacoes (
      empresa_id, paciente_id, vacina_id, vacina_nome, fabricante, partida, fabricacao, validade, dose, aplicada_em, origem,
      veterinario_id, veterinario_externo, atendimento_id, proxima_dose_em, observacao
    ) values (
      p_empresa_id, p.id, vc.id, v_nome, coalesce(app.vet_texto(p_dados, 'fabricante', 80), vc.fabricante), app.vet_texto(p_dados, 'partida', 40),
      v_fabricacao, v_validade, v_dose, v_aplicada, v_origem, v_vet.id,
      case when v_origem = 'externa' then app.vet_texto(p_dados, 'veterinario_externo', 160) end,
      at.id, v_proxima, app.vet_texto(p_dados, 'observacao', 300)
    ) returning id into v_id;
  exception when check_violation then
    raise exception 'Confira a dose, as datas (validade depois da fabricação; próxima dose depois da aplicação) e os dados da vacina.';
  end;
  return v_id;
end;
$$;

create or replace function public.vet_vacinacao_cancelar(p_vacinacao_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vet_vacinacoes;
  v_vet uuid;
begin
  select * into v from public.vet_vacinacoes where id = p_vacinacao_id for update;
  if v.id is null then
    raise exception 'Registro de vacina não encontrado.';
  end if;
  perform app.exigir_vet(v.empresa_id, 'gestao.vender');
  if v.origem = 'clinica' then
    select id into v_vet from public.vet_veterinarios where empresa_id = v.empresa_id and perfil_id = auth.uid() and ativo;
    if v_vet is distinct from v.veterinario_id and not app.pode(v.empresa_id, 'gestao.gerenciar') then
      raise exception 'Só quem aplicou a vacina (ou o responsável pela clínica) pode cancelar o registro.';
    end if;
  end if;
  if v.cancelada_em is not null then
    raise exception 'Este registro já foi cancelado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.vet_vacinacoes set cancelada_em = now(), cancelada_motivo = left(trim(p_motivo), 300) where id = v.id;
end;
$$;

-- Lembretes pendentes: a última dose de cada vacina do animal (sem outra aplicação depois) e os retornos marcados
create or replace function public.vet_lembretes_pendentes(p_empresa_id uuid, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoje date := app.hoje();
  v jsonb;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  with ultimas as (
    select distinct on (vv.paciente_id, coalesce(vv.vacina_id::text, lower(vv.vacina_nome))) vv.*
      from public.vet_vacinacoes vv
     where vv.empresa_id = p_empresa_id and vv.cancelada_em is null
     order by vv.paciente_id, coalesce(vv.vacina_id::text, lower(vv.vacina_nome)), vv.aplicada_em desc, vv.created_at desc
  ), vacinas as (
    select 'vacina' as tipo, u.id as referencia_id, u.proxima_dose_em as data_alvo, u.vacina_nome as descricao, u.paciente_id
      from ultimas u
     where u.proxima_dose_em is not null and u.proxima_dose_em between v_hoje - 90 and p_ate
  ), retornos as (
    select 'retorno' as tipo, a.id as referencia_id, a.retorno_em as data_alvo, coalesce(a.retorno_motivo, 'Retorno') as descricao, a.paciente_id
      from public.vet_atendimentos a
     where a.empresa_id = p_empresa_id and a.status = 'finalizado' and a.retorno_em between v_hoje - 30 and p_ate
       and not exists (select 1 from public.vet_atendimentos b where b.paciente_id = a.paciente_id and b.data_hora > a.data_hora and b.status <> 'cancelado')
  ), todos as (
    select * from vacinas union all select * from retornos
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', x.tipo, 'referencia_id', x.referencia_id, 'data_alvo', x.data_alvo, 'descricao', x.descricao,
           'paciente_id', p.id, 'paciente', p.nome, 'especie', p.especie,
           'tutor_id', t.id, 'tutor', t.nome, 'telefone', t.telefone, 'email', t.email,
           'aceita_whatsapp', t.aceita_whatsapp, 'aceita_email', t.aceita_email,
           'agendado', exists (select 1 from public.vet_agenda g where g.paciente_id = p.id and g.inicio >= now() and g.status in ('agendado', 'confirmado')),
           'avisos', coalesce((select jsonb_agg(jsonb_build_object('canal', av.canal, 'em', av.created_at) order by av.created_at desc)
                                 from public.vet_avisos av where av.referencia_id = x.referencia_id and av.data_alvo = x.data_alvo), '[]'::jsonb)
         ) order by x.data_alvo, p.nome), '[]'::jsonb)
    into v
    from todos x
    join public.vet_pacientes p on p.id = x.paciente_id and p.ativo and p.obito_em is null
    join public.vet_tutores t on t.id = p.tutor_id;
  return v;
end;
$$;

-- A recepção registra que avisou o tutor (WhatsApp da clínica ou telefone)
create or replace function public.vet_aviso_registrar(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text := p_dados ->> 'tipo';
  v_ref uuid := nullif(p_dados ->> 'referencia_id', '')::uuid;
  v_canal text := coalesce(nullif(p_dados ->> 'canal', ''), 'whatsapp');
  v_paciente uuid;
  v_data date;
  v_tutor uuid;
  v_id uuid;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  if v_canal not in ('whatsapp', 'telefone') then
    raise exception 'Canal inválido.';
  end if;
  if v_tipo = 'vacina' then
    select paciente_id, proxima_dose_em into v_paciente, v_data from public.vet_vacinacoes where id = v_ref and empresa_id = p_empresa_id and cancelada_em is null;
  elsif v_tipo = 'retorno' then
    select paciente_id, retorno_em into v_paciente, v_data from public.vet_atendimentos where id = v_ref and empresa_id = p_empresa_id and status = 'finalizado';
  end if;
  if v_paciente is null or v_data is null then
    raise exception 'Lembrete não encontrado.';
  end if;
  select tutor_id into v_tutor from public.vet_pacientes where id = v_paciente;
  insert into public.vet_avisos (empresa_id, tipo, referencia_id, paciente_id, tutor_id, data_alvo, canal)
  values (p_empresa_id, v_tipo, v_ref, v_paciente, v_tutor, v_data, v_canal)
  returning id into v_id;
  return v_id;
end;
$$;

-- Texto do lembrete com os campos da clínica, do tutor e do animal
create or replace function app.vet_mensagem(p_modelo text, p_clinica text, p_tutor text, p_animal text, p_vacina text, p_data date)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(coalesce(p_modelo, ''),
    '{clinica}', coalesce(p_clinica, '')), '{tutor}', split_part(coalesce(p_tutor, ''), ' ', 1)), '{animal}', coalesce(p_animal, '')),
    '{vacina}', coalesce(p_vacina, '')), '{data}', to_char(p_data, 'DD/MM/YYYY'));
$$;

-- E-mails automáticos (rotina diária): vacina e retorno a N dias, para os tutores que autorizaram
create or replace function app.vet_lembretes_email()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  l record;
  v_envio uuid;
  v_total int := 0;
  v_hoje date := app.hoje();
begin
  for c in
    select vc.*, coalesce(vc.nome_clinica, e.nome_fantasia, e.razao_social) as nome
      from public.vet_config vc
      join public.gestao_config g on g.empresa_id = vc.empresa_id and g.ativa and g.modalidade = 'veterinaria'
      join public.empresas e on e.id = vc.empresa_id and e.ativa
     where vc.lembrete_email
  loop
    for l in
      with ultimas as (
        select distinct on (vv.paciente_id, coalesce(vv.vacina_id::text, lower(vv.vacina_nome))) vv.*
          from public.vet_vacinacoes vv
         where vv.empresa_id = c.empresa_id and vv.cancelada_em is null
         order by vv.paciente_id, coalesce(vv.vacina_id::text, lower(vv.vacina_nome)), vv.aplicada_em desc, vv.created_at desc
      )
      select 'vacina' as tipo, u.id as referencia_id, u.proxima_dose_em as data_alvo, u.vacina_nome as descricao, u.paciente_id
        from ultimas u
       where u.proxima_dose_em between v_hoje and v_hoje + c.lembrete_dias_antes
      union all
      select 'retorno', a.id, a.retorno_em, coalesce(a.retorno_motivo, 'Retorno'), a.paciente_id
        from public.vet_atendimentos a
       where a.empresa_id = c.empresa_id and a.status = 'finalizado' and a.retorno_em between v_hoje and v_hoje + c.lembrete_dias_antes
         and not exists (select 1 from public.vet_atendimentos b where b.paciente_id = a.paciente_id and b.data_hora > a.data_hora and b.status <> 'cancelado')
    loop
      continue when exists (select 1 from public.vet_avisos av where av.referencia_id = l.referencia_id and av.data_alvo = l.data_alvo and av.canal = 'email');
      declare
        p public.vet_pacientes;
        t public.vet_tutores;
        v_texto text;
      begin
        select * into p from public.vet_pacientes where id = l.paciente_id;
        select * into t from public.vet_tutores where id = p.tutor_id;
        continue when not p.ativo or p.obito_em is not null or not t.aceita_email or t.email is null;
        v_texto := app.vet_mensagem(case l.tipo when 'vacina' then c.mensagem_vacina else c.mensagem_retorno end, c.nome, t.nome, p.nome, l.descricao, l.data_alvo);
        insert into public.envios (empresa_id, canal, destinatario, assunto, conteudo, tipo, referencia_tipo, referencia_id)
        values (c.empresa_id, 'email', t.email,
                left(c.nome || ': ' || case l.tipo when 'vacina' then 'vacina do(a) ' || p.nome else 'retorno do(a) ' || p.nome end || ' em ' || to_char(l.data_alvo, 'DD/MM/YYYY'), 200),
                v_texto, 'lembrete_veterinario', 'vet_aviso', l.referencia_id::text)
        returning id into v_envio;
        insert into public.vet_avisos (empresa_id, tipo, referencia_id, paciente_id, tutor_id, data_alvo, canal, envio_id, criado_por)
        values (c.empresa_id, l.tipo, l.referencia_id, p.id, t.id, l.data_alvo, 'email', v_envio, null);
        perform app.enfileirar('enviar_envio', jsonb_build_object('envio_id', v_envio), c.empresa_id, 'envio:' || v_envio::text, now(), 80);
        v_total := v_total + 1;
      end;
    end loop;
  end loop;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 20. Atestados e termos (veterinário)
-- -----------------------------------------------------------------------------
create or replace function public.vet_documento_emitir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vet public.vet_veterinarios;
  p public.vet_pacientes;
  at public.vet_atendimentos;
  v_tipo text := p_dados ->> 'tipo';
  v_in jsonb := coalesce(p_dados -> 'dados', '{}'::jsonb);
  v_dados jsonb := '{}'::jsonb;
  v_vacinas uuid[];
  v_obito timestamptz;
  v_id uuid;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  v_vet := app.vet_veterinario_do_usuario(p_empresa_id);
  if v_tipo is null or v_tipo not in (
    'atestado_sanitario', 'atestado_vacinacao', 'atestado_obito', 'termo_exames', 'termo_procedimento_risco', 'termo_retirada_corpo',
    'termo_cirurgia', 'termo_internacao', 'termo_anestesia', 'termo_eutanasia', 'termo_retirada_sem_alta', 'termo_doacao_corpo'
  ) then
    raise exception 'Escolha o documento.';
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    raise exception 'Dados do documento inválidos.';
  end if;
  if nullif(p_dados ->> 'atendimento_id', '') is not null then
    select * into at from public.vet_atendimentos where id = (p_dados ->> 'atendimento_id')::uuid and empresa_id = p_empresa_id;
    if at.id is null or at.status = 'cancelado' then
      raise exception 'Atendimento não encontrado.';
    end if;
  end if;
  select * into p from public.vet_pacientes where id = coalesce(at.paciente_id, nullif(p_dados ->> 'paciente_id', '')::uuid) and empresa_id = p_empresa_id;
  if p.id is null then
    raise exception 'Escolha o animal.';
  end if;
  if p.obito_em is not null and v_tipo not in ('atestado_obito', 'termo_retirada_corpo', 'termo_doacao_corpo') then
    raise exception 'Este animal tem óbito registrado.';
  end if;

  -- Campos comuns: observações do veterinário e do responsável
  v_dados := jsonb_strip_nulls(jsonb_build_object(
    'observacoes_veterinario', app.vet_texto(v_in, 'observacoes_veterinario', 2000),
    'observacoes_responsavel', app.vet_texto(v_in, 'observacoes_responsavel', 2000)
  ));

  if v_tipo = 'atestado_sanitario' then
    if app.vet_texto(v_in, 'estado_saude', 1000) is null then
      raise exception 'Descreva o estado de saúde do animal.';
    end if;
    v_dados := v_dados || jsonb_strip_nulls(jsonb_build_object(
      'estado_saude', app.vet_texto(v_in, 'estado_saude', 1000),
      'finalidade', app.vet_texto(v_in, 'finalidade', 200)
    ));
  elsif v_tipo = 'atestado_vacinacao' then
    select coalesce(array_agg(x::uuid), '{}') into v_vacinas
      from jsonb_array_elements_text(case when jsonb_typeof(v_in -> 'vacinacoes') = 'array' then v_in -> 'vacinacoes' else '[]'::jsonb end) x;
    if cardinality(v_vacinas) = 0 then
      raise exception 'Escolha as vacinas do atestado.';
    end if;
    if exists (
      select 1 from unnest(v_vacinas) u
       where not exists (select 1 from public.vet_vacinacoes vv where vv.id = u and vv.paciente_id = p.id and vv.origem = 'clinica' and vv.cancelada_em is null)
    ) then
      raise exception 'O atestado só traz vacinas aplicadas na clínica neste animal.';
    end if;
    v_dados := v_dados || jsonb_build_object('vacinacoes', to_jsonb(v_vacinas));
  elsif v_tipo = 'atestado_obito' then
    v_obito := nullif(v_in ->> 'data_hora', '')::timestamptz;
    if v_obito is null or v_obito > now() + interval '5 minutes' then
      raise exception 'Informe o dia e a hora do óbito.';
    end if;
    if app.vet_texto(v_in, 'causa', 500) is null or app.vet_texto(v_in, 'local', 200) is null or app.vet_texto(v_in, 'cidade_uf', 120) is null
       or app.vet_texto(v_in, 'destinacao', 1000) is null then
      raise exception 'Informe a provável causa, o local, a cidade/UF e a orientação para a destinação do corpo.';
    end if;
    v_dados := v_dados || jsonb_strip_nulls(jsonb_build_object(
      'data_hora', v_obito, 'causa', app.vet_texto(v_in, 'causa', 500), 'local', app.vet_texto(v_in, 'local', 200),
      'cidade_uf', app.vet_texto(v_in, 'cidade_uf', 120), 'destinacao', app.vet_texto(v_in, 'destinacao', 1000),
      'complementares', app.vet_texto(v_in, 'complementares', 1000)
    ));
  elsif v_tipo in ('termo_exames', 'termo_procedimento_risco', 'termo_cirurgia', 'termo_internacao', 'termo_anestesia', 'termo_eutanasia') then
    if app.vet_texto(v_in, 'procedimento', 1000) is null then
      raise exception 'Descreva o que será feito (exame, procedimento, cirurgia, internação, anestesia ou eutanásia).';
    end if;
    v_dados := v_dados || jsonb_strip_nulls(jsonb_build_object(
      'procedimento', app.vet_texto(v_in, 'procedimento', 1000),
      'riscos', app.vet_texto(v_in, 'riscos', 2000),
      'valor_estimado', app.vet_texto(v_in, 'valor_estimado', 60)
    ));
  elsif v_tipo = 'termo_retirada_corpo' then
    v_dados := v_dados || jsonb_strip_nulls(jsonb_build_object('destinacao', app.vet_texto(v_in, 'destinacao', 1000)));
  elsif v_tipo = 'termo_retirada_sem_alta' then
    if app.vet_texto(v_in, 'quadro', 2000) is null then
      raise exception 'Descreva o quadro do animal e os riscos da retirada sem alta.';
    end if;
    v_dados := v_dados || jsonb_strip_nulls(jsonb_build_object('quadro', app.vet_texto(v_in, 'quadro', 2000)));
  elsif v_tipo = 'termo_doacao_corpo' then
    if app.vet_texto(v_in, 'instituicao', 200) is null then
      raise exception 'Informe a instituição de ensino e pesquisa.';
    end if;
    v_dados := v_dados || jsonb_strip_nulls(jsonb_build_object('instituicao', app.vet_texto(v_in, 'instituicao', 200)));
  end if;

  insert into public.vet_documentos (empresa_id, numero, tipo, paciente_id, tutor_id, veterinario_id, atendimento_id, dados)
  values (p_empresa_id, app.vet_proximo_numero(p_empresa_id, 'documento'), v_tipo, p.id, p.tutor_id, v_vet.id, at.id, v_dados)
  returning id into v_id;

  -- Óbito: registrado no animal (o prontuário guarda a causa)
  if v_tipo = 'atestado_obito' then
    update public.vet_pacientes set obito_em = v_obito, obito_causa = app.vet_texto(v_in, 'causa', 500) where id = p.id;
    update public.vet_agenda set status = 'cancelado', observacoes = left(coalesce(observacoes || ' — ', '') || 'Óbito registrado', 500)
     where paciente_id = p.id and inicio > now() and status in ('agendado', 'confirmado');
  end if;
  return v_id;
end;
$$;

create or replace function public.vet_documento_cancelar(p_documento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.vet_documentos;
  v_vet uuid;
begin
  select * into d from public.vet_documentos where id = p_documento_id for update;
  if d.id is null then
    raise exception 'Documento não encontrado.';
  end if;
  perform app.exigir_vet(d.empresa_id, 'gestao.vender');
  select id into v_vet from public.vet_veterinarios where empresa_id = d.empresa_id and perfil_id = auth.uid() and ativo;
  if v_vet is distinct from d.veterinario_id and not app.pode(d.empresa_id, 'gestao.gerenciar') then
    raise exception 'Só quem emitiu o documento (ou o responsável pela clínica) pode cancelá-lo.';
  end if;
  if d.cancelado_em is not null then
    raise exception 'Este documento já foi cancelado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.vet_documentos set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300) where id = d.id;
  -- Atestado de óbito emitido por engano: o animal volta a ficar ativo
  if d.tipo = 'atestado_obito' and not exists (
    select 1 from public.vet_documentos o where o.paciente_id = d.paciente_id and o.tipo = 'atestado_obito' and o.cancelado_em is null and o.id <> d.id
  ) then
    update public.vet_pacientes set obito_em = null, obito_causa = null where id = d.paciente_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 21. Contas da clínica e pagamentos (recepção) → Financeiro e caixa
-- -----------------------------------------------------------------------------
create or replace function public.vet_conta_resumo(p_conta_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'itens', coalesce((select sum(total) from public.vet_conta_itens where conta_id = c.id and cancelado_em is null), 0),
    'desconto', c.desconto,
    'total', greatest(coalesce((select sum(total) from public.vet_conta_itens where conta_id = c.id and cancelado_em is null), 0) - c.desconto, 0),
    'pago', coalesce((select sum(valor) from public.vet_pagamentos where conta_id = c.id and cancelado_em is null), 0),
    'saldo', greatest(coalesce((select sum(total) from public.vet_conta_itens where conta_id = c.id and cancelado_em is null), 0) - c.desconto, 0)
             - coalesce((select sum(valor) from public.vet_pagamentos where conta_id = c.id and cancelado_em is null), 0)
  )
  from public.vet_contas c
  where c.id = p_conta_id and app.pode(c.empresa_id, 'gestao.vender');
$$;

create or replace function public.vet_conta_abrir(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  at public.vet_atendimentos;
  p public.vet_pacientes;
  v_tutor uuid := nullif(p_dados ->> 'tutor_id', '')::uuid;
  v_id uuid;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.vender');
  if nullif(p_dados ->> 'atendimento_id', '') is not null then
    select * into at from public.vet_atendimentos where id = (p_dados ->> 'atendimento_id')::uuid and empresa_id = p_empresa_id;
    if at.id is null or at.status = 'cancelado' then
      raise exception 'Atendimento não encontrado.';
    end if;
    select id into v_id from public.vet_contas where atendimento_id = at.id and status <> 'cancelada';
    if v_id is not null then
      return v_id;
    end if;
  end if;
  if coalesce(at.paciente_id, nullif(p_dados ->> 'paciente_id', '')::uuid) is not null then
    select * into p from public.vet_pacientes where id = coalesce(at.paciente_id, (p_dados ->> 'paciente_id')::uuid) and empresa_id = p_empresa_id;
    if p.id is null then
      raise exception 'Animal não encontrado.';
    end if;
    v_tutor := coalesce(at.tutor_id, p.tutor_id);
  end if;
  if v_tutor is null or not exists (select 1 from public.vet_tutores where id = v_tutor and empresa_id = p_empresa_id) then
    raise exception 'Escolha o tutor.';
  end if;
  insert into public.vet_contas (empresa_id, numero, tutor_id, paciente_id, atendimento_id, observacao)
  values (p_empresa_id, app.vet_proximo_numero(p_empresa_id, 'conta'), v_tutor, p.id, at.id, app.vet_texto(p_dados, 'observacao', 300))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.vet_conta_item_lancar(p_conta_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.vet_contas;
  s public.vet_servicos;
  v_qtd numeric := coalesce(app.vet_numero(p_dados, 'quantidade', 'quantidade'), 1);
  v_valor numeric := app.vet_numero(p_dados, 'valor_unitario', 'valor');
  v_desc text;
  v_id uuid;
begin
  select * into c from public.vet_contas where id = p_conta_id for update;
  if c.id is null then
    raise exception 'Conta não encontrada.';
  end if;
  perform app.exigir_vet(c.empresa_id, 'gestao.vender');
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada ou cancelada.';
  end if;
  if nullif(p_dados ->> 'servico_id', '') is not null then
    select * into s from public.vet_servicos where id = (p_dados ->> 'servico_id')::uuid and empresa_id = c.empresa_id and ativo;
    if s.id is null then
      raise exception 'Serviço não encontrado.';
    end if;
  end if;
  v_desc := coalesce(app.vet_texto(p_dados, 'descricao', 120), s.nome);
  v_valor := coalesce(v_valor, s.preco);
  if v_desc is null or v_valor is null or v_valor < 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Escolha o serviço ou escreva a descrição e o valor.';
  end if;
  if v_qtd <= 0 or v_qtd > 9999 then
    raise exception 'Quantidade inválida.';
  end if;
  insert into public.vet_conta_itens (empresa_id, conta_id, servico_id, descricao, quantidade, valor_unitario, total)
  values (c.empresa_id, c.id, s.id, v_desc, v_qtd, v_valor, round(v_qtd * v_valor, 2))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.vet_conta_item_cancelar(p_item_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.vet_conta_itens;
  c public.vet_contas;
begin
  select * into i from public.vet_conta_itens where id = p_item_id for update;
  if i.id is null then
    raise exception 'Item não encontrado.';
  end if;
  select * into c from public.vet_contas where id = i.conta_id for update;
  perform app.exigir_vet(c.empresa_id, 'gestao.vender');
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada ou cancelada.';
  end if;
  if i.cancelado_em is not null then
    raise exception 'Este item já foi cancelado.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.vet_conta_itens set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300) where id = i.id;
  if ((public.vet_conta_resumo(c.id)) ->> 'saldo')::numeric < 0 then
    raise exception 'Sem este item, o que já foi pago passa do total da conta. Estorne um pagamento antes.';
  end if;
end;
$$;

create or replace function public.vet_conta_desconto(p_conta_id uuid, p_desconto numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.vet_contas;
  v_itens numeric;
  v_max numeric;
begin
  select * into c from public.vet_contas where id = p_conta_id for update;
  if c.id is null then
    raise exception 'Conta não encontrada.';
  end if;
  perform app.exigir_vet(c.empresa_id, 'gestao.vender');
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada ou cancelada.';
  end if;
  if p_desconto is null or p_desconto < 0 or p_desconto <> round(p_desconto, 2) then
    raise exception 'Desconto inválido.';
  end if;
  select coalesce(sum(total), 0) into v_itens from public.vet_conta_itens where conta_id = c.id and cancelado_em is null;
  if p_desconto > v_itens then
    raise exception 'O desconto não pode passar do total dos serviços.';
  end if;
  if not app.pode(c.empresa_id, 'gestao.gerenciar') then
    select desconto_maximo_operador into v_max from public.gestao_config where empresa_id = c.empresa_id;
    if v_max is null or p_desconto > round(v_itens * v_max / 100, 2) then
      raise exception 'Desconto acima do permitido para a recepção. Peça ao responsável.';
    end if;
  end if;
  update public.vet_contas set desconto = p_desconto where id = c.id;
  if ((public.vet_conta_resumo(c.id)) ->> 'saldo')::numeric < 0 then
    raise exception 'Com este desconto, o que já foi pago passa do total da conta.';
  end if;
end;
$$;

create or replace function public.vet_pagamento_registrar(p_conta_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.vet_contas;
  v_cfg public.gestao_config;
  v_forma text := p_dados ->> 'forma';
  v_valor numeric := app.vet_numero(p_dados, 'valor', 'valor');
  v_venc date := nullif(p_dados ->> 'vencimento', '')::date;
  v_hoje date := app.hoje();
  v_saldo numeric;
  v_sessao uuid;
  v_cat uuid;
  v_conta uuid;
  v_lanc uuid;
  v_id uuid;
  v_desc text;
  v_tutor text;
  v_animal text;
begin
  select * into c from public.vet_contas where id = p_conta_id for update;
  if c.id is null then
    raise exception 'Conta não encontrada.';
  end if;
  perform app.exigir_vet(c.empresa_id, 'gestao.vender');
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada ou cancelada.';
  end if;
  if v_forma is null or v_forma not in ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'transferencia', 'a_receber', 'outro') then
    raise exception 'Escolha a forma de pagamento.';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
    raise exception 'Informe o valor recebido.';
  end if;
  v_saldo := ((public.vet_conta_resumo(c.id)) ->> 'saldo')::numeric;
  if v_valor > v_saldo then
    raise exception 'O valor passa do que falta pagar (%).', to_char(v_saldo, 'FM999G999G990D00');
  end if;
  select * into v_cfg from public.gestao_config where empresa_id = c.empresa_id;
  select nome into v_tutor from public.vet_tutores where id = c.tutor_id;
  select nome into v_animal from public.vet_pacientes where id = c.paciente_id;
  v_cat := app.categoria_sistema(c.empresa_id, 'SERVICOS');
  if v_cat is null then
    perform app.criar_plano_contas_padrao(c.empresa_id);
    v_cat := app.categoria_sistema(c.empresa_id, 'SERVICOS');
  end if;
  v_desc := 'Clínica — conta nº ' || c.numero || ' — ' || v_tutor || coalesce(' (' || v_animal || ')', '');
  select id into v_sessao from public.caixa_sessoes
   where empresa_id = c.empresa_id and operador_id = auth.uid() and status = 'aberto' limit 1;

  if v_forma = 'a_receber' then
    if v_venc is null or v_venc < v_hoje then
      raise exception 'Informe o vencimento combinado (hoje ou depois).';
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto, origem, origem_referencia, numero_documento
    ) values (
      c.empresa_id, 'receber', v_desc || ' (a receber)', v_cat, v_hoje, v_venc, v_valor, 'veterinaria', c.id::text, 'CLIN ' || c.numero
    ) returning id into v_lanc;
    v_sessao := null;
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
      raise exception 'Configure a conta que recebe este pagamento na Gestão da loja (contas do caixa, do PIX e da maquininha).';
    end if;
    insert into public.lancamentos (
      empresa_id, tipo, descricao, categoria_id, conta_financeira_id, data_competencia, data_vencimento, valor_previsto, origem, origem_referencia, numero_documento
    ) values (
      c.empresa_id, 'receber', v_desc, v_cat, v_conta, v_hoje, v_hoje, v_valor, 'veterinaria', c.id::text, 'CLIN ' || c.numero
    ) returning id into v_lanc;
    insert into public.baixas (empresa_id, lancamento_id, tipo, data_pagamento, conta_financeira_id, valor_principal, forma_pagamento, origem, observacao)
    values (c.empresa_id, v_lanc, 'receber', v_hoje, v_conta, v_valor, case v_forma when 'outro' then 'outro' else v_forma end, 'veterinaria', v_desc);
  end if;

  insert into public.vet_pagamentos (empresa_id, conta_id, data, forma, valor, vencimento, sessao_id, lancamento_id, observacao)
  values (c.empresa_id, c.id, v_hoje, v_forma, v_valor, v_venc, v_sessao, v_lanc, app.vet_texto(p_dados, 'observacao', 300))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.vet_pagamento_estornar(p_pagamento_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pg public.vet_pagamentos;
  c public.vet_contas;
  v_sessao text;
begin
  select * into pg from public.vet_pagamentos where id = p_pagamento_id for update;
  if pg.id is null then
    raise exception 'Pagamento não encontrado.';
  end if;
  select * into c from public.vet_contas where id = pg.conta_id for update;
  perform app.exigir_vet(pg.empresa_id, 'gestao.gerenciar');
  if pg.cancelado_em is not null then
    raise exception 'Este pagamento já foi estornado.';
  end if;
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada. Faça a devolução pelo Financeiro.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do estorno.';
  end if;
  if pg.sessao_id is not null then
    select status into v_sessao from public.caixa_sessoes where id = pg.sessao_id;
    if v_sessao <> 'aberto' and pg.forma = 'dinheiro' then
      raise exception 'O caixa deste pagamento já foi fechado. Faça a devolução pelo Financeiro.';
    end if;
  end if;
  if pg.lancamento_id is not null then
    if exists (select 1 from public.baixas b where b.lancamento_id = pg.lancamento_id and b.origem <> 'veterinaria') then
      raise exception 'Este recebimento já foi conciliado ou baixado no Financeiro. Desfaça antes de estornar.';
    end if;
    delete from public.baixas where lancamento_id = pg.lancamento_id and origem = 'veterinaria';
    update public.lancamentos
       set situacao = 'cancelado', motivo_cancelamento = left('Pagamento da conta nº ' || c.numero || ' da clínica estornado: ' || trim(p_motivo), 500)
     where id = pg.lancamento_id and situacao <> 'cancelado';
  end if;
  update public.vet_pagamentos set cancelado_em = now(), cancelado_motivo = left(trim(p_motivo), 300) where id = pg.id;
end;
$$;

create or replace function public.vet_conta_fechar(p_conta_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.vet_contas;
  v_saldo numeric;
begin
  select * into c from public.vet_contas where id = p_conta_id for update;
  if c.id is null then
    raise exception 'Conta não encontrada.';
  end if;
  perform app.exigir_vet(c.empresa_id, 'gestao.vender');
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada ou cancelada.';
  end if;
  v_saldo := ((public.vet_conta_resumo(c.id)) ->> 'saldo')::numeric;
  if v_saldo <> 0 then
    raise exception 'Ainda falta receber % para fechar a conta.', to_char(v_saldo, 'FM999G999G990D00');
  end if;
  update public.vet_contas set status = 'fechada', fechada_em = now(), fechada_por = auth.uid() where id = c.id;
end;
$$;

create or replace function public.vet_conta_cancelar(p_conta_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.vet_contas;
begin
  select * into c from public.vet_contas where id = p_conta_id for update;
  if c.id is null then
    raise exception 'Conta não encontrada.';
  end if;
  perform app.exigir_vet(c.empresa_id, 'gestao.vender');
  if c.status <> 'aberta' then
    raise exception 'Esta conta já foi fechada ou cancelada.';
  end if;
  if exists (select 1 from public.vet_pagamentos where conta_id = c.id and cancelado_em is null) then
    raise exception 'A conta tem pagamentos: estorne-os antes de cancelar.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;
  update public.vet_contas set status = 'cancelada', cancelada_motivo = left(trim(p_motivo), 300) where id = c.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 22. Caixa: os recebimentos da clínica feitos com o caixa aberto entram na conferência
-- -----------------------------------------------------------------------------
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
  ), h as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from public.hotel_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
     group by forma
  ), cl as (
    select forma, sum(valor) as valor, count(*) as quantidade
      from public.vet_pagamentos where sessao_id = p_sessao_id and cancelado_em is null
     group by forma
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
    'hotel_quantidade', (select coalesce(sum(quantidade), 0) from h),
    'hotel_total', (select coalesce(sum(valor), 0) from h),
    'hotel_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from h), '{}'::jsonb),
    'clinica_quantidade', (select coalesce(sum(quantidade), 0) from cl),
    'clinica_total', (select coalesce(sum(valor), 0) from cl),
    'clinica_por_forma', coalesce((select jsonb_object_agg(forma, jsonb_build_object('valor', valor, 'quantidade', quantidade)) from cl), '{}'::jsonb),
    'sangrias', m.sangrias,
    'suprimentos', m.suprimentos,
    'qtd_sangrias', m.qtd_sangrias,
    'qtd_suprimentos', m.qtd_suprimentos,
    'dinheiro_esperado', s.valor_abertura + coalesce((select valor from pg where forma = 'dinheiro'), 0)
      + coalesce((select valor from h where forma = 'dinheiro'), 0) + coalesce((select valor from cl where forma = 'dinheiro'), 0)
      + m.suprimentos - m.sangrias
  )
  from s, m;
$$;

-- -----------------------------------------------------------------------------
-- 23. Rotina diária: e-mails de lembrete da clínica (uma falha não derruba a rotina)
-- -----------------------------------------------------------------------------
create or replace function public.rotina_diaria()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
  v_check int := 0;
  v_rec int := 0;
  v_lem int := 0;
  v_vet int := 0;
  v_limpos int := 0;
  v_comp date := app.competencia_de(app.hoje());
begin
  for e in select id from public.empresas where ativa
  loop
    v_check := v_check + app.gerar_checklist(e.id, v_comp);
    -- Competência anterior também (prazos costumam cair no mês seguinte)
    v_check := v_check + app.gerar_checklist(e.id, (v_comp - interval '1 month')::date);
  end loop;
  v_rec := app.gerar_recorrencias(null, null);
  v_lem := app.gerar_lembretes_automaticos();
  begin
    v_vet := app.vet_lembretes_email();
  exception when others then
    raise warning 'Lembretes da clínica veterinária: %', sqlerrm;
  end;

  -- Envios iniciados e não concluídos há mais de 24h
  with antigos as (
    select d.id, dv.storage_path
      from public.documentos d
      join public.documento_versoes dv on dv.documento_id = d.id
     where d.upload_status = 'pendente' and d.created_at < now() - interval '24 hours'
  )
  select count(distinct id) into v_limpos from antigos;
  perform app.enfileirar('remover_arquivos',
    jsonb_build_object('caminhos', coalesce((
      select jsonb_agg(dv.storage_path) from public.documentos d
        join public.documento_versoes dv on dv.documento_id = d.id
       where d.upload_status = 'pendente' and d.created_at < now() - interval '24 hours'), '[]'::jsonb)),
    null, 'limpeza:' || app.hoje()::text, now(), 200);
  delete from public.documentos where upload_status = 'pendente' and created_at < now() - interval '24 hours';
  -- Versões substitutas não concluídas
  delete from public.documento_versoes where upload_concluido_em is null and criado_em < now() - interval '24 hours' and versao > 1;

  return jsonb_build_object('itens_checklist_criados', v_check, 'lancamentos_recorrentes', v_rec,
                            'lembretes', v_lem, 'lembretes_clinica', v_vet, 'envios_incompletos_removidos', v_limpos);
end;
$$;

-- -----------------------------------------------------------------------------
-- 24. Acesso: leitura por quem usa a gestão da própria empresa; escrita só pelas funções
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['vet_config', 'vet_veterinarios', 'vet_tutores', 'vet_pacientes', 'vet_agenda', 'vet_atendimentos', 'vet_adendos',
                           'vet_anexos', 'vet_receitas', 'vet_receita_itens', 'vet_vacinas', 'vet_vacinacoes', 'vet_avisos', 'vet_documentos',
                           'vet_servicos', 'vet_contas', 'vet_conta_itens', 'vet_pagamentos'] loop
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

revoke execute on function app.exigir_vet(uuid, text), app.vet_cfg(uuid), app.vet_veterinario_do_usuario(uuid), app.vet_proximo_numero(uuid, text),
  app.vet_lembretes_email(), app.vet_mensagem(text, text, text, text, text, date), app.vet_texto(jsonb, text, int), app.vet_digitos(jsonb, text),
  app.vet_numero(jsonb, text, text),
  app.tg_vet_atendimento_imutavel(), app.tg_vet_somente_insercao(), app.tg_vet_receita_imutavel(), app.tg_vet_documento_imutavel()
  from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.vet_configurar(uuid, jsonb)', 'public.vet_veterinario_salvar(uuid, uuid, jsonb)', 'public.vet_vacina_salvar(uuid, uuid, jsonb)',
    'public.vet_servico_salvar(uuid, uuid, jsonb)', 'public.vet_tutor_salvar(uuid, uuid, jsonb)', 'public.vet_tutor_excluir(uuid)',
    'public.vet_paciente_salvar(uuid, uuid, jsonb)', 'public.vet_paciente_excluir(uuid)', 'public.vet_agenda_salvar(uuid, uuid, jsonb)',
    'public.vet_agenda_status(uuid, text)', 'public.vet_atendimento_abrir(uuid, jsonb)', 'public.vet_atendimento_salvar(uuid, jsonb)',
    'public.vet_atendimento_finalizar(uuid)', 'public.vet_atendimento_cancelar(uuid, text)', 'public.vet_adendo_registrar(uuid, text)',
    'public.vet_anexo_iniciar(uuid, jsonb)', 'public.vet_anexo_confirmar(uuid)', 'public.vet_receita_emitir(uuid, jsonb)',
    'public.vet_receita_cancelar(uuid, text)', 'public.vet_vacinacao_registrar(uuid, jsonb)', 'public.vet_vacinacao_cancelar(uuid, text)',
    'public.vet_lembretes_pendentes(uuid, date)', 'public.vet_aviso_registrar(uuid, jsonb)', 'public.vet_documento_emitir(uuid, jsonb)',
    'public.vet_documento_cancelar(uuid, text)', 'public.vet_conta_resumo(uuid)', 'public.vet_conta_abrir(uuid, jsonb)',
    'public.vet_conta_item_lancar(uuid, jsonb)', 'public.vet_conta_item_cancelar(uuid, text)', 'public.vet_conta_desconto(uuid, numeric)',
    'public.vet_pagamento_registrar(uuid, jsonb)', 'public.vet_pagamento_estornar(uuid, text)', 'public.vet_conta_fechar(uuid)',
    'public.vet_conta_cancelar(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
