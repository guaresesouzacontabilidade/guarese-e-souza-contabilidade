-- =============================================================================
-- Recibos de honorários emitidos pelo escritório
--
-- O escritório emite, pelo portal, o recibo de pagamento dos honorários de um
-- cliente (da carteira ou avulso), com o timbre do escritório, numeração
-- própria por ano (ex.: 007/2026), valor por extenso e assinatura. O PDF pode
-- ser publicado em "Recibos", nos documentos da empresa cliente.
--
--  * Só a equipe do escritório emite, vê e cancela (regra no banco).
--  * Os dados do escritório e do contador ficam copiados no recibo: mudar o
--    cadastro depois não altera os recibos já emitidos.
--  * Recibo cancelado não some (fica com o motivo) e a numeração não se repete.
--  * O recibo comprova o pagamento; não substitui a nota fiscal de serviço.
-- =============================================================================

create table public.recibos_honorarios (
  id uuid primary key default gen_random_uuid(),
  ano int not null check (ano between 2000 and 2100),
  numero int not null check (numero between 1 and 999999),
  empresa_id uuid references public.empresas(id) on delete set null,
  pagador_nome text not null check (length(trim(pagador_nome)) between 2 and 200),
  pagador_documento text check (pagador_documento is null or pagador_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  valor numeric(12, 2) not null check (valor > 0 and valor < 10000000),
  referencia text not null default 'Honorários contábeis' check (length(trim(referencia)) between 3 and 120),
  competencia date check (competencia is null or extract(day from competencia) = 1),
  -- Texto do "referente a" (sem ele, o PDF usa o padrão dos honorários da competência)
  descricao text check (descricao is null or length(descricao) <= 500),
  data_recibo date not null,
  cidade text not null check (length(trim(cidade)) between 2 and 80),
  uf char(2) check (uf is null or uf ~ '^[A-Z]{2}$'),
  forma_pagamento text check (forma_pagamento is null or forma_pagamento in ('pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'cheque')),
  nfse_numero text check (nfse_numero is null or length(nfse_numero) between 1 and 30),
  observacao text check (observacao is null or length(observacao) <= 500),
  -- Recebedor (escritório) e contador no dia da emissão
  emitente jsonb not null check (jsonb_typeof(emitente) = 'object' and pg_column_size(emitente) < 8000),
  documento_id uuid references public.documentos(id) on delete set null,
  situacao text not null default 'emitido' check (situacao in ('emitido', 'cancelado')),
  cancelado_em timestamptz,
  cancelado_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 300),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (ano, numero),
  constraint recibos_cancelamento check ((situacao = 'cancelado') = (cancelado_em is not null and motivo_cancelamento is not null))
);
create index recibos_honorarios_empresa_idx on public.recibos_honorarios (empresa_id, data_recibo desc);
create index recibos_honorarios_data_idx on public.recibos_honorarios (data_recibo desc);
create trigger auditoria_recibos_honorarios after insert or update or delete on public.recibos_honorarios
  for each row execute function app.tg_auditoria();

alter table public.recibos_honorarios enable row level security;
create policy recibos_honorarios_leitura on public.recibos_honorarios for select to authenticated using ((select app.is_equipe()));
-- Escrita só pelas funções abaixo
revoke insert, update, delete on public.recibos_honorarios from anon, authenticated;
grant select on public.recibos_honorarios to authenticated;

-- -----------------------------------------------------------------------------
-- Emitir: confere a equipe, completa o pagador pela empresa, copia o
-- escritório e reserva o próximo número do ano (um de cada vez).
-- -----------------------------------------------------------------------------
create or replace function public.recibo_emitir(p_dados jsonb)
returns table (id uuid, ano int, numero int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_data date := coalesce(nullif(p_dados ->> 'data_recibo', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  v_ano int := extract(year from v_data)::int;
  v_empresa uuid := nullif(p_dados ->> 'empresa_id', '')::uuid;
  v_emp public.empresas;
  v_esc public.escritorio;
  v_nome text := nullif(trim(p_dados ->> 'pagador_nome'), '');
  v_doc text := nullif(regexp_replace(coalesce(p_dados ->> 'pagador_documento', ''), '\D', '', 'g'), '');
  v_numero int;
  v_id uuid;
  v_endereco text;
begin
  if not app.is_equipe() then
    raise exception 'Só a equipe do escritório emite recibos de honorários.' using errcode = '42501';
  end if;
  if v_empresa is not null then
    select * into v_emp from public.empresas e where e.id = v_empresa;
    if v_emp.id is null then
      raise exception 'Empresa não encontrada.' using errcode = 'P0001';
    end if;
    v_nome := coalesce(v_nome, v_emp.razao_social);
    v_doc := coalesce(v_doc, nullif(regexp_replace(coalesce(v_emp.documento, ''), '\D', '', 'g'), ''));
  end if;
  if v_nome is null then
    raise exception 'Informe quem pagou (empresa da carteira ou nome do pagador).' using errcode = 'P0001';
  end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date + 1 then
    raise exception 'A data do recibo não pode ser no futuro.' using errcode = 'P0001';
  end if;

  select * into v_esc from public.escritorio where escritorio.id = 1;
  v_endereco := concat_ws(', ',
    nullif(concat_ws(', ', v_esc.logradouro, case when v_esc.numero is not null then 'nº ' || v_esc.numero end), ''),
    v_esc.bairro,
    nullif(concat_ws('/', v_esc.cidade, v_esc.uf), ''));

  perform pg_advisory_xact_lock(hashtextextended('recibos_honorarios:' || v_ano, 0));
  select coalesce(max(r.numero), 0) + 1 into v_numero from public.recibos_honorarios r where r.ano = v_ano;

  insert into public.recibos_honorarios (
    ano, numero, empresa_id, pagador_nome, pagador_documento, valor, referencia, competencia, descricao, data_recibo,
    cidade, uf, forma_pagamento, nfse_numero, observacao, emitente
  ) values (
    v_ano, v_numero, v_empresa, v_nome, v_doc,
    (p_dados ->> 'valor')::numeric,
    coalesce(nullif(trim(p_dados ->> 'referencia'), ''), 'Honorários contábeis'),
    nullif(p_dados ->> 'competencia', '')::date,
    nullif(trim(p_dados ->> 'descricao'), ''),
    v_data,
    coalesce(nullif(trim(p_dados ->> 'cidade'), ''), v_esc.cidade, 'Porto Nacional'),
    coalesce(nullif(upper(trim(p_dados ->> 'uf')), ''), v_esc.uf),
    nullif(p_dados ->> 'forma_pagamento', ''),
    nullif(trim(p_dados ->> 'nfse_numero'), ''),
    nullif(trim(p_dados ->> 'observacao'), ''),
    jsonb_build_object(
      'razao_social', v_esc.razao_social,
      'nome_fantasia', v_esc.nome_fantasia,
      'cnpj', v_esc.cnpj,
      'endereco', v_endereco,
      'cep', v_esc.cep,
      'telefone', v_esc.telefone,
      'email', v_esc.email,
      'contador_nome', v_esc.contador_nome,
      'contador_crc', v_esc.contador_crc,
      'cidade', v_esc.cidade,
      'uf', v_esc.uf
    )
  )
  returning recibos_honorarios.id into v_id;
  return query select v_id, v_ano, v_numero;
end;
$$;

-- Liga o recibo ao PDF publicado nos documentos da empresa.
create or replace function public.recibo_vincular_documento(p_recibo_id uuid, p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_equipe() then
    raise exception 'Só a equipe do escritório altera recibos.' using errcode = '42501';
  end if;
  update public.recibos_honorarios set documento_id = p_documento_id where id = p_recibo_id;
end;
$$;

-- Cancela (com motivo). O número não volta para a fila.
create or replace function public.recibo_cancelar(p_recibo_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid;
begin
  if not app.is_equipe() then
    raise exception 'Só a equipe do escritório cancela recibos.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001';
  end if;
  update public.recibos_honorarios
     set situacao = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 300)
   where id = p_recibo_id and situacao = 'emitido'
  returning documento_id into v_doc;
  if not found then
    raise exception 'Recibo não encontrado ou já cancelado.' using errcode = 'P0001';
  end if;
  return v_doc;
end;
$$;

revoke execute on function public.recibo_emitir(jsonb) from public, anon;
revoke execute on function public.recibo_vincular_documento(uuid, uuid) from public, anon;
revoke execute on function public.recibo_cancelar(uuid, text) from public, anon;
grant execute on function public.recibo_emitir(jsonb) to authenticated;
grant execute on function public.recibo_vincular_documento(uuid, uuid) to authenticated;
grant execute on function public.recibo_cancelar(uuid, text) to authenticated;
