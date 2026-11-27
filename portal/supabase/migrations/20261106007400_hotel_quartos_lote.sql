-- =============================================================================
-- Hotel: cadastrar vários quartos de uma vez (faixa de números)
-- Ex.: do 101 ao 120, categoria Standard casal, 1º andar, sem o 113.
-- Quartos que já existem ficam como estão e são informados na resposta.
-- =============================================================================

create or replace function public.hotel_quartos_lote(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat uuid := nullif(p_dados ->> 'categoria_id', '')::uuid;
  v_ini_txt text := trim(coalesce(p_dados ->> 'inicio', ''));
  v_fim_txt text := trim(coalesce(p_dados ->> 'fim', ''));
  v_ini int;
  v_fim int;
  v_largura int := 0;
  v_andar text := nullif(trim(coalesce(p_dados ->> 'andar', '')), '');
  v_camas text := nullif(trim(coalesce(p_dados ->> 'camas', '')), '');
  v_pular int[];
  v_numero text;
  v_criados text[] := '{}';
  v_existentes text[] := '{}';
begin
  perform app.exigir_hotel(p_empresa_id, 'gestao.gerenciar');
  if not exists (select 1 from public.hotel_categorias where id = v_cat and empresa_id = p_empresa_id) then
    raise exception 'Escolha a categoria dos quartos.';
  end if;
  if v_ini_txt !~ '^[0-9]{1,5}$' or v_fim_txt !~ '^[0-9]{1,5}$' then
    raise exception 'Informe o primeiro e o último número só com algarismos (ex.: 101 e 120).';
  end if;
  v_ini := v_ini_txt::int;
  v_fim := v_fim_txt::int;
  if v_fim < v_ini then
    raise exception 'O último número precisa ser maior ou igual ao primeiro.';
  end if;
  if v_fim - v_ini + 1 > 200 then
    raise exception 'Cadastre no máximo 200 quartos de cada vez.';
  end if;
  if v_andar is not null and length(v_andar) > 20 then
    raise exception 'O andar pode ter até 20 letras.';
  end if;
  if v_camas is not null and length(v_camas) > 120 then
    raise exception 'As camas podem ter até 120 letras.';
  end if;
  -- "01" a "12": mantém os zeros à esquerda do primeiro número
  if left(v_ini_txt, 1) = '0' and length(v_ini_txt) > 1 then
    v_largura := length(v_ini_txt);
  end if;
  -- Números que não existem no hotel (ex.: "113, 213")
  select coalesce(array_agg(m[1]::int), '{}') into v_pular
    from regexp_matches(coalesce(p_dados ->> 'pular', ''), '([0-9]{1,5})', 'g') as m;

  for n in v_ini..v_fim loop
    continue when n = any (v_pular);
    v_numero := case when v_largura > 0 then lpad(n::text, v_largura, '0') else n::text end;
    if exists (select 1 from public.hotel_quartos where empresa_id = p_empresa_id and upper(numero) = v_numero) then
      v_existentes := v_existentes || v_numero;
    else
      insert into public.hotel_quartos (empresa_id, categoria_id, numero, andar, camas)
      values (p_empresa_id, v_cat, v_numero, v_andar, v_camas);
      v_criados := v_criados || v_numero;
    end if;
  end loop;

  return jsonb_build_object('criados', to_jsonb(v_criados), 'existentes', to_jsonb(v_existentes));
end;
$$;

revoke execute on function public.hotel_quartos_lote(uuid, jsonb) from public, anon;
grant execute on function public.hotel_quartos_lote(uuid, jsonb) to authenticated;
