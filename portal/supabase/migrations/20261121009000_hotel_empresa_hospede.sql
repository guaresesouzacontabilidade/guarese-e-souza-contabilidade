-- =============================================================================
-- Hotel: reserva no nome de uma EMPRESA (ela manda um funcionário).
--  - O hóspede da reserva pode ser uma pessoa jurídica (CNPJ). A empresa
--    entra também nos clientes do Financeiro e a reserva fica "faturada para"
--    ela sozinha, para a conta poder ser faturada no check-out.
--  - Quem se hospedou pela empresa (a pessoa, com CPF ou documento) é
--    informado na reserva — de preferência no check-in, para a ficha de
--    registro — e é obrigatório para fechar a conta no check-out.
-- =============================================================================

alter table public.hotel_hospedes
  add column tipo_pessoa text not null default 'PF' check (tipo_pessoa in ('PF', 'PJ')),
  add column cnpj text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  add constraint hotel_hospedes_pessoa_juridica check (tipo_pessoa = 'PF' or (cnpj is not null and cpf is null and documento is null));
create unique index hotel_hospedes_cnpj_uk on public.hotel_hospedes (empresa_id, cnpj) where cnpj is not null;

-- Quem se hospedou pela empresa (uma pessoa do cadastro de hóspedes)
alter table public.hotel_reservas add column ocupante_id uuid;
alter table public.hotel_reservas
  add constraint hotel_reservas_ocupante_fk foreign key (empresa_id, ocupante_id) references public.hotel_hospedes (empresa_id, id);
create index hotel_reservas_ocupante_idx on public.hotel_reservas (ocupante_id) where ocupante_id is not null;

-- A empresa hóspede nos clientes do Financeiro (pelo CNPJ), para faturar a conta
create or replace function app.hotel_cliente_da_empresa(p_hospede_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.hotel_hospedes;
  v_id uuid;
begin
  select * into h from public.hotel_hospedes where id = p_hospede_id;
  if h.id is null or h.tipo_pessoa <> 'PJ' then
    return null;
  end if;
  select id into v_id from public.contrapartes where empresa_id = h.empresa_id and documento = h.cnpj limit 1;
  if v_id is null then
    insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis, email, telefone)
    values (h.empresa_id, h.nome, h.cnpj, 'PJ', array['cliente'], h.email, h.telefone)
    returning id into v_id;
  else
    update public.contrapartes
       set papeis = case when 'cliente' = any(papeis) then papeis else array_append(papeis, 'cliente') end, ativo = true
     where id = v_id;
  end if;
  return v_id;
end;
$$;

-- Reserva de empresa: fatura para ela sozinha; quem se hospedou é sempre uma pessoa
create or replace function app.hotel_tg_reserva_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.empresa_faturar_id is null and exists (select 1 from public.hotel_hospedes where id = new.hospede_id and tipo_pessoa = 'PJ') then
    new.empresa_faturar_id := app.hotel_cliente_da_empresa(new.hospede_id);
  end if;
  if new.ocupante_id is not null and exists (select 1 from public.hotel_hospedes where id = new.ocupante_id and tipo_pessoa = 'PJ') then
    raise exception 'Quem se hospeda é uma pessoa: escolha o funcionário, não a empresa.';
  end if;
  return new;
end;
$$;
create trigger hotel_reservas_empresa before insert or update of hospede_id, empresa_faturar_id, ocupante_id on public.hotel_reservas
  for each row execute function app.hotel_tg_reserva_empresa();

-- -----------------------------------------------------------------------------
-- Cadastro do hóspede: pessoa física (CPF/documento) ou empresa (CNPJ)
-- -----------------------------------------------------------------------------
create or replace function public.hotel_hospede_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_pj boolean := coalesce(p_dados ->> 'tipo_pessoa', 'PF') = 'PJ';
  v_cnpj text := nullif(regexp_replace(coalesce(p_dados ->> 'cnpj', ''), '\D', '', 'g'), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_dados ->> 'cpf', ''), '\D', '', 'g'), '');
  v_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), '');
  v_cep text := nullif(regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'), '');
  v_doc_tipo text := nullif(p_dados ->> 'documento_tipo', '');
  v_doc text := nullif(trim(p_dados ->> 'documento'), '');
  v_nasc date := nullif(p_dados ->> 'nascimento', '')::date;
  v_outro uuid;
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.vender');
  if v_pj then
    if v_cnpj is null or not app.cnpj_valido(v_cnpj) then
      raise exception 'CNPJ inválido. Confira os números.';
    end if;
    -- Empresa não tem CPF, documento pessoal, nascimento nem gênero
    v_cpf := null;
    v_doc := null;
    v_doc_tipo := null;
    v_nasc := null;
    select id into v_outro from public.hotel_hospedes where empresa_id = p_empresa_id and cnpj = v_cnpj and id is distinct from p_id;
  else
    v_cnpj := null;
    if v_cpf is not null and not app.cpf_valido(v_cpf) then
      raise exception 'CPF inválido. Confira os números.';
    end if;
    if v_doc is null then
      v_doc_tipo := null;
    elsif v_doc_tipo is null then
      v_doc_tipo := 'outro';
    end if;
    if v_nasc is not null and (v_nasc > app.hoje() or v_nasc < date '1900-01-01') then
      raise exception 'Data de nascimento inválida.';
    end if;
    if v_cpf is not null then
      select id into v_outro from public.hotel_hospedes where empresa_id = p_empresa_id and cpf = v_cpf and id is distinct from p_id;
    end if;
  end if;
  if v_outro is not null then
    if p_id is not null then
      raise exception 'Já existe outro cadastro com este %.', case when v_pj then 'CNPJ' else 'CPF' end;
    end if;
    v_id := v_outro; -- cadastro já existente: atualiza os dados
  end if;
  if p_id is not null and exists (select 1 from public.hotel_hospedes where id = p_id and tipo_pessoa <> case when v_pj then 'PJ' else 'PF' end)
     and (exists (select 1 from public.hotel_reservas where hospede_id = p_id or ocupante_id = p_id)
          or exists (select 1 from public.hotel_reserva_hospedes where hospede_id = p_id)) then
    raise exception 'Este cadastro já tem reservas: não dá para trocar entre pessoa e empresa. Faça um cadastro novo.';
  end if;
  begin
    if v_id is null then
      insert into public.hotel_hospedes (
        empresa_id, tipo_pessoa, cnpj, nome, cpf, documento_tipo, documento, nascimento, genero, nacionalidade, profissao, telefone, email,
        cep, endereco, cidade, uf, pais, observacoes
      ) values (
        p_empresa_id, case when v_pj then 'PJ' else 'PF' end, v_cnpj, trim(p_dados ->> 'nome'), v_cpf, v_doc_tipo, v_doc, v_nasc,
        case when v_pj then null else nullif(p_dados ->> 'genero', '') end,
        case when v_pj then null else coalesce(nullif(trim(p_dados ->> 'nacionalidade'), ''), 'Brasileira') end,
        case when v_pj then null else nullif(trim(p_dados ->> 'profissao'), '') end, v_tel,
        nullif(lower(trim(p_dados ->> 'email')), ''), v_cep, nullif(trim(p_dados ->> 'endereco'), ''), nullif(trim(p_dados ->> 'cidade'), ''),
        nullif(upper(trim(p_dados ->> 'uf')), ''), coalesce(nullif(trim(p_dados ->> 'pais'), ''), 'Brasil'), nullif(trim(p_dados ->> 'observacoes'), '')
      ) returning id into v_id;
    else
      update public.hotel_hospedes
         set tipo_pessoa = case when v_pj then 'PJ' else 'PF' end,
             cnpj = v_cnpj,
             nome = trim(p_dados ->> 'nome'),
             cpf = v_cpf,
             documento_tipo = v_doc_tipo,
             documento = v_doc,
             nascimento = v_nasc,
             genero = case when v_pj then null else nullif(p_dados ->> 'genero', '') end,
             nacionalidade = case when v_pj then null else coalesce(nullif(trim(p_dados ->> 'nacionalidade'), ''), nacionalidade) end,
             profissao = case when v_pj then null else nullif(trim(p_dados ->> 'profissao'), '') end,
             telefone = v_tel,
             email = nullif(lower(trim(p_dados ->> 'email')), ''),
             cep = v_cep,
             endereco = nullif(trim(p_dados ->> 'endereco'), ''),
             cidade = nullif(trim(p_dados ->> 'cidade'), ''),
             uf = nullif(upper(trim(p_dados ->> 'uf')), ''),
             pais = coalesce(nullif(trim(p_dados ->> 'pais'), ''), pais),
             observacoes = nullif(trim(p_dados ->> 'observacoes'), '')
       where id = v_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Hóspede não encontrado.';
      end if;
    end if;
  exception
    when check_violation or not_null_violation then
      raise exception 'Confira o cadastro: nome (2 a 120 letras), telefone com DDD (só números), e-mail válido, CEP com 8 números e UF com 2 letras.';
  end;
  if v_pj then
    perform app.hotel_cliente_da_empresa(v_id);
  end if;
  return v_id;
end;
$$;

create or replace function public.hotel_hospede_excluir(p_hospede_id uuid)
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
  perform app.exigir_hotel(v_empresa, 'gestao.gerenciar');
  if exists (select 1 from public.hotel_reservas where hospede_id = p_hospede_id or ocupante_id = p_hospede_id)
     or exists (select 1 from public.hotel_reserva_hospedes where hospede_id = p_hospede_id) then
    raise exception 'Este hóspede tem reservas ou hospedagens registradas: o cadastro fica guardado junto com elas.';
  end if;
  delete from public.hotel_hospedes where id = p_hospede_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Quem se hospedou pela empresa (a recepção informa a qualquer momento antes do check-out)
-- -----------------------------------------------------------------------------
create or replace function public.hotel_reserva_ocupante(p_reserva_id uuid, p_hospede_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  o public.hotel_hospedes;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status not in ('pre_reserva', 'confirmada', 'hospedado') then
    raise exception 'Esta reserva já foi encerrada ou cancelada.';
  end if;
  if not exists (select 1 from public.hotel_hospedes where id = r.hospede_id and tipo_pessoa = 'PJ') then
    raise exception 'Esta reserva está no nome de uma pessoa: quem se hospeda é o próprio hóspede.';
  end if;
  select * into o from public.hotel_hospedes where id = p_hospede_id and empresa_id = r.empresa_id;
  if o.id is null then
    raise exception 'Escolha quem se hospedou (ou cadastre a pessoa).';
  end if;
  if o.tipo_pessoa <> 'PF' then
    raise exception 'Quem se hospeda é uma pessoa: escolha o funcionário, não a empresa.';
  end if;
  if o.cpf is null and o.documento is null then
    raise exception 'Complete o cadastro de % com o CPF ou outro documento (ficha de registro).', o.nome;
  end if;
  update public.hotel_reservas set ocupante_id = o.id where id = r.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Check-in: a ficha é de quem dorme (o hóspede ou, na reserva de empresa, quem
-- se hospedou por ela — que pode ser informado depois, até o check-out)
-- -----------------------------------------------------------------------------
create or replace function public.hotel_checkin(p_reserva_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  q public.hotel_quartos;
  h public.hotel_hospedes;
  v_hoje date := app.hoje();
  v_ocupante bigint;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status not in ('pre_reserva', 'confirmada') then
    raise exception 'Esta reserva não está aguardando check-in.';
  end if;
  if r.entrada > v_hoje then
    raise exception 'A entrada desta reserva é %. Para fazer o check-in hoje, altere a data de entrada.', to_char(r.entrada, 'DD/MM/YYYY');
  end if;
  if r.saida <= v_hoje then
    raise exception 'A saída desta reserva já passou. Altere as datas antes do check-in.';
  end if;
  select * into q from public.hotel_quartos where id = r.quarto_id for update;
  if q.limpeza = 'manutencao' then
    raise exception 'O quarto % está em manutenção (%). Troque o quarto da reserva.', q.numero, q.motivo_manutencao;
  end if;
  if q.limpeza <> 'limpo' then
    raise exception 'O quarto % ainda não foi liberado pela governança (situação: %). Marque como limpo ou troque o quarto.',
      q.numero, case q.limpeza when 'sujo' then 'sujo' else 'em limpeza' end;
  end if;
  select numero into v_ocupante from public.hotel_reservas where quarto_id = q.id and status = 'hospedado';
  if v_ocupante is not null then
    raise exception 'O quarto % ainda está ocupado (reserva nº %). Faça o check-out dela ou troque o quarto.', q.numero, v_ocupante;
  end if;
  select * into h from public.hotel_hospedes where id = coalesce(r.ocupante_id, r.hospede_id);
  if h.tipo_pessoa = 'PF' and h.cpf is null and h.documento is null then
    raise exception 'Complete o cadastro de % com o CPF ou outro documento antes do check-in (ficha de registro).', h.nome;
  end if;
  begin
    update public.hotel_reservas
       set status = 'hospedado', checkin_em = now(), checkin_por = auth.uid(),
           motivo_viagem = coalesce(nullif(p_dados ->> 'motivo_viagem', ''), motivo_viagem),
           meio_transporte = coalesce(nullif(p_dados ->> 'meio_transporte', ''), meio_transporte),
           placa_veiculo = coalesce(nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa_veiculo', ''), '[^A-Za-z0-9]', '', 'g')), ''), placa_veiculo),
           procedencia = coalesce(nullif(trim(p_dados ->> 'procedencia'), ''), procedencia),
           destino = coalesce(nullif(trim(p_dados ->> 'destino'), ''), destino)
     where id = r.id;
  exception
    when check_violation then
      raise exception 'Confira o motivo da viagem, o meio de transporte e a placa do veículo (ex.: ABC1D23).';
  end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Check-out: na reserva de empresa, só fecha com quem se hospedou informado
-- -----------------------------------------------------------------------------
create or replace function public.hotel_checkout(p_reserva_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.hotel_reservas;
  v_cfg public.hotel_config;
  v_hoje date := app.hoje();
  v_fim date;
  n record;
  v_numero text;
  v_consumo numeric;
  v_resumo jsonb;
  v_saldo numeric;
  v_conflito public.hotel_reservas;
begin
  select * into r from public.hotel_reservas where id = p_reserva_id for update;
  if r.id is null then
    raise exception 'Reserva não encontrada.';
  end if;
  perform app.exigir_hotel(r.empresa_id, 'gestao.vender');
  if r.status <> 'hospedado' then
    raise exception 'Esta reserva não está hospedada.';
  end if;
  if r.ocupante_id is null and exists (select 1 from public.hotel_hospedes where id = r.hospede_id and tipo_pessoa = 'PJ') then
    raise exception 'Reserva no nome da empresa: informe quem se hospedou (nome e CPF ou documento) antes do check-out.';
  end if;
  v_cfg := app.hotel_cfg(r.empresa_id);
  v_fim := greatest(v_hoje, r.entrada + 1);
  if v_fim > r.saida then
    -- Ficou além do previsto: as noites a mais precisam estar livres no quarto
    v_conflito := app.hotel_conflito(r.quarto_id, r.saida, v_fim, r.id);
    if v_conflito.id is not null then
      raise exception 'O quarto tem a reserva nº % a partir de %. Troque o quarto dela antes de fechar esta conta.',
        v_conflito.numero, to_char(v_conflito.entrada, 'DD/MM/YYYY');
    end if;
  end if;
  select numero into v_numero from public.hotel_quartos where id = r.quarto_id;
  update public.hotel_reservas set saida = v_fim where id = r.id;
  for n in select * from app.hotel_noites(r.id, v_fim) loop
    insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, data, descricao, quantidade, valor_unitario, total)
    values (r.empresa_id, r.id, 'diaria', n.data, 'Diária de ' || to_char(n.data, 'DD/MM') || ' — quarto ' || v_numero, 1, n.valor, n.valor);
  end loop;
  select coalesce(sum(total), 0) into v_consumo from public.hotel_conta_itens where reserva_id = r.id and tipo = 'consumo' and cancelado_em is null;
  if coalesce(v_cfg.taxa_servico, 0) > 0 and v_consumo > 0 then
    insert into public.hotel_conta_itens (empresa_id, reserva_id, tipo, descricao, quantidade, valor_unitario, total)
    values (r.empresa_id, r.id, 'taxa_servico', 'Taxa de serviço (' || app.gestao_qtd(v_cfg.taxa_servico) || '% do consumo)', 1,
            round(v_consumo * v_cfg.taxa_servico / 100, 2), round(v_consumo * v_cfg.taxa_servico / 100, 2));
  end if;
  update public.hotel_reservas
     set status = 'encerrada', checkout_em = now(), checkout_por = auth.uid()
   where id = r.id;
  v_resumo := app.hotel_resumo(r.id);
  v_saldo := (v_resumo ->> 'saldo')::numeric;
  if v_saldo > 0 then
    raise exception 'Falta receber % para fechar a conta. Registre o pagamento (ou fature para a empresa) e faça o check-out de novo.', app.hotel_moeda(v_saldo);
  end if;
  if v_saldo < 0 then
    raise exception 'Os pagamentos passam do total da conta em %. Estorne o pagamento a mais (ou lance o que faltou) antes do check-out.', app.hotel_moeda(-v_saldo);
  end if;
  update public.hotel_quartos set limpeza = 'sujo', limpeza_atualizada_em = now(), limpeza_por = auth.uid() where id = r.quarto_id;
  return v_resumo;
end;
$$;

revoke execute on function app.hotel_cliente_da_empresa(uuid), app.hotel_tg_reserva_empresa() from public, anon, authenticated;
revoke execute on function public.hotel_reserva_ocupante(uuid, uuid) from public, anon;
grant execute on function public.hotel_reserva_ocupante(uuid, uuid) to authenticated;
