-- =============================================================================
-- Hotel:
--  1. Serviços extras com preço fixo (refeições e marmitas, lavanderia, aluguel
--     de carro...): o gerente cadastra o preço e a unidade; a recepção lança na
--     conta do hóspede a quantidade (refeições, usos, peças, dias). A natureza
--     (alimentação, lavanderia, locação) separa a receita para a contabilidade.
--  2. Observações sobre o hóspede, que a recepção atualiza na reserva e no check-in.
--  3. Documentos com a cara do hotel (ficha, confirmação, extrato e recibo):
--     modelo, cor e os dados do hotel que saem no cabeçalho.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Serviços extras
-- -----------------------------------------------------------------------------
create table public.hotel_extras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  -- alimentação (refeições, marmitas), lavanderia, locação (aluguel de carro, bicicleta) ou outro serviço
  natureza text not null check (natureza in ('alimentacao', 'lavanderia', 'locacao', 'outro')),
  -- Como se conta: por refeição, marmita, peça, kg, uso, dia, hora ou unidade
  unidade text not null check (unidade in ('refeicao', 'marmita', 'unidade', 'peca', 'kg', 'uso', 'dia', 'hora')),
  preco numeric(12, 2) not null check (preco >= 0),
  ativo boolean not null default true,
  ordem int not null default 0,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hotel_extras_empresa_id_unico unique (empresa_id, id)
);
create unique index hotel_extras_nome_uk on public.hotel_extras (empresa_id, lower(trim(nome)));
create trigger hotel_extras_updated_at before update on public.hotel_extras for each row execute function app.tg_updated_at();
create trigger auditoria_hotel_extras after insert or update or delete on public.hotel_extras for each row execute function app.tg_auditoria();

alter table public.hotel_extras enable row level security;
create policy hotel_extras_leitura on public.hotel_extras for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
grant select on public.hotel_extras to authenticated;
grant select, insert, update, delete on public.hotel_extras to service_role;

-- A conta do hóspede passa a separar a alimentação e a locação dos demais serviços
alter table public.hotel_conta_itens drop constraint hotel_conta_itens_setor_check;
alter table public.hotel_conta_itens add constraint hotel_conta_itens_setor_check
  check (setor is null or setor in ('restaurante', 'bar', 'frigobar', 'lavanderia', 'recepcao', 'alimentacao', 'locacao', 'outro'));
alter table public.hotel_conta_itens add column extra_id uuid references public.hotel_extras(id) on delete set null;

-- Cadastro do serviço extra (gerente)
create or replace function public.hotel_extra_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_nome text := trim(coalesce(p_dados ->> 'nome', ''));
  v_natureza text := coalesce(p_dados ->> 'natureza', '');
  v_unidade text := coalesce(p_dados ->> 'unidade', '');
  v_preco numeric;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  if length(v_nome) < 2 or length(v_nome) > 80 then
    raise exception 'Dê um nome ao serviço (2 a 80 letras).';
  end if;
  if v_natureza not in ('alimentacao', 'lavanderia', 'locacao', 'outro') then
    raise exception 'Escolha o tipo do serviço.';
  end if;
  if v_unidade not in ('refeicao', 'marmita', 'unidade', 'peca', 'kg', 'uso', 'dia', 'hora') then
    raise exception 'Escolha como o serviço é contado.';
  end if;
  begin
    v_preco := (p_dados ->> 'preco')::numeric;
  exception when others then
    v_preco := null;
  end;
  if v_preco is null or v_preco < 0 or v_preco > 999999 or v_preco <> round(v_preco, 2) then
    raise exception 'Informe o preço.';
  end if;
  begin
    if p_id is null then
      insert into public.hotel_extras (empresa_id, nome, natureza, unidade, preco, ativo, ordem)
      values (p_empresa_id, v_nome, v_natureza, v_unidade, v_preco, coalesce((p_dados ->> 'ativo')::boolean, true), coalesce(nullif(p_dados ->> 'ordem', '')::int, 0))
      returning id into v_id;
    else
      update public.hotel_extras
         set nome = v_nome, natureza = v_natureza, unidade = v_unidade, preco = v_preco,
             ativo = coalesce((p_dados ->> 'ativo')::boolean, ativo),
             ordem = coalesce(nullif(p_dados ->> 'ordem', '')::int, ordem),
             atualizado_por = auth.uid()
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Serviço não encontrado.';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'Já existe o serviço %.', v_nome;
  end;
  return v_id;
end;
$$;

-- Lança na conta do hóspede: quantidade × preço de cada serviço (o preço diferente do cadastro só com o gerente)
create or replace function public.hotel_extras_lancar(p_reserva_id uuid, p_dados jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  e public.hotel_extras;
  v_item jsonb;
  v_qtd numeric;
  v_preco numeric;
  v_gerente boolean;
  v_data date;
  v_n int := 0;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status <> 'hospedado' then
    raise exception 'Os serviços extras são lançados na conta de quem está hospedado.';
  end if;
  v_gerente := app.pode(r.empresa_id, 'gestao.gerenciar');
  begin
    v_data := coalesce(nullif(p_dados ->> 'data', '')::date, app.hoje());
  exception when others then
    raise exception 'Data inválida.';
  end;
  if v_data > app.hoje() or v_data < r.entrada then
    raise exception 'A data do serviço precisa estar dentro da hospedagem (da entrada até hoje).';
  end if;
  if jsonb_typeof(p_dados -> 'itens') is distinct from 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Escolha ao menos um serviço.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 30 then
    raise exception 'Lance até 30 serviços de cada vez.';
  end if;
  for v_item in select * from jsonb_array_elements(p_dados -> 'itens') loop
    select * into e from public.hotel_extras
     where id = nullif(v_item ->> 'extra_id', '')::uuid and empresa_id = r.empresa_id;
    if not found or not e.ativo then
      raise exception 'Serviço extra não encontrado ou fora de uso.';
    end if;
    begin
      v_qtd := (v_item ->> 'quantidade')::numeric;
      v_preco := coalesce(nullif(v_item ->> 'valor_unitario', '')::numeric, e.preco);
    exception when others then
      raise exception 'Quantidade ou preço inválido em %.', e.nome;
    end;
    if v_qtd is null or v_qtd <= 0 or v_qtd > 9999 or v_qtd <> round(v_qtd, 3) then
      raise exception 'Quantidade inválida em %.', e.nome;
    end if;
    if v_preco < 0 or v_preco > 999999 or v_preco <> round(v_preco, 2) then
      raise exception 'Preço inválido em %.', e.nome;
    end if;
    if v_preco <> e.preco and not v_gerente then
      raise exception 'Só o gerente lança % com preço diferente do cadastro.', e.nome;
    end if;
    insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, data, descricao, setor, quantidade, valor_unitario, total, extra_id)
    values (r.empresa_id, r.id, 'servico', v_data, left(e.nome, 160),
            case e.natureza when 'alimentacao' then 'alimentacao' when 'lavanderia' then 'lavanderia' when 'locacao' then 'locacao' else 'outro' end,
            v_qtd, v_preco, round(v_qtd * v_preco, 2), e.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Observações sobre o hóspede (a recepção atualiza sem mexer no resto do cadastro)
-- -----------------------------------------------------------------------------
create or replace function public.hotel_hospede_observacoes(p_hospede_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.hotel_hospedes where id = p_hospede_id;
  if v_empresa is null then
    raise exception 'Hóspede não encontrado.';
  end if;
  perform app.exigir_hotel(v_empresa, 'gestao.vender');
  if length(coalesce(p_texto, '')) > 1000 then
    raise exception 'As observações podem ter até 1.000 letras.';
  end if;
  update public.hotel_hospedes set observacoes = nullif(trim(coalesce(p_texto, '')), '') where id = p_hospede_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Documentos do hotel: modelo, cor e os dados do cabeçalho (vazio = os do cadastro da empresa)
-- -----------------------------------------------------------------------------
alter table public.hotel_config
  add column doc_modelo text not null default 'classico' check (doc_modelo in ('classico', 'faixa', 'economico')),
  add column doc_cor text check (doc_cor is null or doc_cor ~ '^#[0-9a-fA-F]{6}$'),
  add column doc_nome text check (doc_nome is null or length(doc_nome) <= 120),
  add column doc_endereco text check (doc_endereco is null or length(doc_endereco) <= 300),
  add column doc_telefone text check (doc_telefone is null or length(doc_telefone) <= 40),
  add column doc_whatsapp text check (doc_whatsapp is null or length(doc_whatsapp) <= 40),
  add column doc_email text check (doc_email is null or length(doc_email) <= 200),
  add column doc_site text check (doc_site is null or length(doc_site) <= 200),
  add column doc_cadastur text check (doc_cadastur is null or length(doc_cadastur) <= 40);

create or replace function public.hotel_documentos_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modelo text := coalesce(nullif(p_dados ->> 'modelo', ''), 'classico');
  v_cor text := nullif(trim(coalesce(p_dados ->> 'cor', '')), '');
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  perform app.hotel_cfg(p_empresa_id);
  if v_modelo not in ('classico', 'faixa', 'economico') then
    raise exception 'Escolha o modelo dos documentos.';
  end if;
  if v_cor is not null and v_cor !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Cor inválida (use o seletor de cor).';
  end if;
  begin
    update public.hotel_config
       set doc_modelo = v_modelo,
           doc_cor = lower(v_cor),
           doc_nome = nullif(trim(coalesce(p_dados ->> 'nome', '')), ''),
           doc_endereco = nullif(trim(coalesce(p_dados ->> 'endereco', '')), ''),
           doc_telefone = nullif(trim(coalesce(p_dados ->> 'telefone', '')), ''),
           doc_whatsapp = nullif(trim(coalesce(p_dados ->> 'whatsapp', '')), ''),
           doc_email = nullif(trim(coalesce(p_dados ->> 'email', '')), ''),
           doc_site = nullif(trim(coalesce(p_dados ->> 'site', '')), ''),
           doc_cadastur = nullif(trim(coalesce(p_dados ->> 'cadastur', '')), ''),
           atualizado_por = auth.uid()
     where empresa_id = p_empresa_id;
  exception
    when check_violation then
      raise exception 'Algum dado ficou grande demais. Confira o nome (até 120 letras), o endereço (até 300) e os contatos.';
  end;
end;
$$;

revoke execute on function public.hotel_extra_salvar(uuid, uuid, jsonb), public.hotel_extras_lancar(uuid, jsonb),
  public.hotel_hospede_observacoes(uuid, text), public.hotel_documentos_configurar(uuid, jsonb) from public, anon;
grant execute on function public.hotel_extra_salvar(uuid, uuid, jsonb), public.hotel_extras_lancar(uuid, jsonb),
  public.hotel_hospede_observacoes(uuid, text), public.hotel_documentos_configurar(uuid, jsonb) to authenticated;
