-- Rentabilidade da frota (transportadoras): veículos com os custos fixos do
-- mês, viagens (frete de cada CT-e, com ICMS, quebra e comissão do motorista)
-- e despesas (combustível com litros e km, Arla, pneus, manutenção, pedágio,
-- impostos). O km do hodômetro é conferido no lançamento: não pode voltar
-- nem dar um salto impossível (o erro de digitação que estraga média e custo
-- por km). Quem vê: financeiro.ver; quem lança: financeiro.editar.

create table public.frota_veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  placa text not null check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  descricao text not null check (length(trim(descricao)) between 2 and 120),
  tipo text not null default 'cavalo' check (tipo in ('cavalo', 'truck', 'toco', 'carreta', 'utilitario', 'outro')),
  -- Km do hodômetro quando o veículo foi cadastrado (primeira leitura)
  km_inicial numeric(12, 0) check (km_inicial is null or km_inicial >= 0),
  -- Custos fixos do mês (entram no lucro mesmo sem viagem)
  custo_motorista_mensal numeric(14, 2) not null default 0 check (custo_motorista_mensal >= 0),
  depreciacao_mensal numeric(14, 2) not null default 0 check (depreciacao_mensal >= 0),
  financiamento_mensal numeric(14, 2) not null default 0 check (financiamento_mensal >= 0),
  seguro_mensal numeric(14, 2) not null default 0 check (seguro_mensal >= 0),
  outros_fixos_mensal numeric(14, 2) not null default 0 check (outros_fixos_mensal >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint frota_veiculos_placa_uk unique (empresa_id, placa)
);
create trigger frota_veiculos_updated_at before update on public.frota_veiculos for each row execute function app.tg_updated_at();

create table public.frota_viagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  data date not null,
  cte_numero text check (cte_numero is null or length(cte_numero) <= 20),
  remetente text check (remetente is null or length(remetente) <= 120),
  origem text check (origem is null or length(origem) <= 80),
  destinatario text check (destinatario is null or length(destinatario) <= 120),
  destino text check (destino is null or length(destino) <= 80),
  mercadoria text check (mercadoria is null or length(mercadoria) <= 80),
  motorista text check (motorista is null or length(motorista) <= 120),
  peso_kg numeric(14, 3) check (peso_kg is null or peso_kg >= 0),
  valor_frete numeric(14, 2) not null check (valor_frete >= 0),
  icms numeric(14, 2) not null default 0 check (icms >= 0),
  comissao_motorista numeric(14, 2) not null default 0 check (comissao_motorista >= 0),
  quebra numeric(14, 2) not null default 0 check (quebra >= 0),
  -- Carga/descarga e outros descontos do frete
  outras_deducoes numeric(14, 2) not null default 0 check (outras_deducoes >= 0),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index frota_viagens_veiculo_idx on public.frota_viagens (veiculo_id, data);
create index frota_viagens_empresa_idx on public.frota_viagens (empresa_id, data);

create table public.frota_despesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  data date not null,
  grupo text not null check (grupo in ('combustivel', 'arla', 'pneus', 'manutencao', 'pedagio', 'impostos', 'outros')),
  fornecedor text check (fornecedor is null or length(fornecedor) <= 120),
  documento text check (documento is null or length(documento) <= 30),
  descricao text not null check (length(trim(descricao)) between 2 and 120),
  litros numeric(12, 3) check (litros is null or litros > 0),
  -- Hodômetro no abastecimento (conferido pelo gatilho abaixo)
  km numeric(12, 0) check (km is null or km >= 0),
  valor numeric(14, 2) not null check (valor >= 0),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index frota_despesas_veiculo_idx on public.frota_despesas (veiculo_id, data);
create index frota_despesas_empresa_idx on public.frota_despesas (empresa_id, data);

-- O veículo da viagem/despesa é da mesma empresa
create or replace function app.frota_conferir_veiculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.frota_veiculos v where v.id = new.veiculo_id and v.empresa_id = new.empresa_id) then
    raise exception 'Veículo não encontrado nesta empresa.';
  end if;
  return new;
end;
$$;
create trigger frota_viagens_veiculo before insert or update on public.frota_viagens for each row execute function app.frota_conferir_veiculo();
create trigger frota_despesas_veiculo before insert or update on public.frota_despesas for each row execute function app.frota_conferir_veiculo();

-- Conferência do hodômetro: não volta e não salta além do que um caminhão roda
-- (1.300 km por dia + 500 de folga desde a leitura anterior)
create or replace function app.frota_conferir_km()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ant record;
  v_dep record;
  v_inicial numeric;
  v_dias int;
  v_limite numeric;
begin
  if new.km is null then
    return new;
  end if;
  select d.km, d.data into v_ant from public.frota_despesas d
   where d.veiculo_id = new.veiculo_id and d.km is not null and d.id <> new.id and d.data <= new.data
   order by d.data desc, d.km desc limit 1;
  select d.km, d.data into v_dep from public.frota_despesas d
   where d.veiculo_id = new.veiculo_id and d.km is not null and d.id <> new.id and d.data > new.data
   order by d.data, d.km limit 1;
  select v.km_inicial into v_inicial from public.frota_veiculos v where v.id = new.veiculo_id;
  if v_ant.km is null and v_inicial is not null and new.km < v_inicial then
    raise exception 'O km informado (%) é menor que o km do veículo no cadastro (%). Confira o hodômetro.',
      replace(to_char(new.km, 'FM999,999,999'), ',', '.'), replace(to_char(v_inicial, 'FM999,999,999'), ',', '.');
  end if;
  if v_ant.km is not null then
    if new.km < v_ant.km then
      raise exception 'O km informado (%) é menor que o do lançamento de % (%). O hodômetro não volta: confira o número.',
        replace(to_char(new.km, 'FM999,999,999'), ',', '.'), to_char(v_ant.data, 'DD/MM'), replace(to_char(v_ant.km, 'FM999,999,999'), ',', '.');
    end if;
    v_dias := greatest(new.data - v_ant.data, 1);
    v_limite := 1300 * v_dias + 500;
    if new.km - v_ant.km > v_limite then
      raise exception 'O km informado (%) está % km acima do lançamento de % (%): mais do que um caminhão roda em % dia(s). Confira se não sobrou um número.',
        replace(to_char(new.km, 'FM999,999,999'), ',', '.'), replace(to_char(new.km - v_ant.km, 'FM999,999,999'), ',', '.'), to_char(v_ant.data, 'DD/MM'),
        replace(to_char(v_ant.km, 'FM999,999,999'), ',', '.'), v_dias;
    end if;
  end if;
  if v_dep.km is not null and new.km > v_dep.km then
    raise exception 'O km informado (%) é maior que o de um lançamento posterior (% em %). Confira o número.',
      replace(to_char(new.km, 'FM999,999,999'), ',', '.'), replace(to_char(v_dep.km, 'FM999,999,999'), ',', '.'), to_char(v_dep.data, 'DD/MM');
  end if;
  return new;
end;
$$;
create trigger frota_despesas_km before insert or update of km, data on public.frota_despesas for each row execute function app.frota_conferir_km();

-- Permissões: vê com financeiro.ver; lança com financeiro.editar
alter table public.frota_veiculos enable row level security;
alter table public.frota_viagens enable row level security;
alter table public.frota_despesas enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['frota_veiculos', 'frota_viagens', 'frota_despesas'] loop
    execute format('create policy %1$s_leitura on public.%1$s for select to authenticated using (empresa_id = any ((select app.empresas_com(''financeiro.ver''))::uuid[]))', t);
    execute format('create policy %1$s_inclusao on public.%1$s for insert to authenticated with check (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[]))', t);
    execute format('create policy %1$s_alteracao on public.%1$s for update to authenticated using (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[])) with check (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[]))', t);
    execute format('create policy %1$s_exclusao on public.%1$s for delete to authenticated using (empresa_id = any ((select app.empresas_com(''financeiro.editar''))::uuid[]))', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated', t);
  end loop;
end;
$$;
revoke all on function app.frota_conferir_veiculo(), app.frota_conferir_km() from public, anon, authenticated;
