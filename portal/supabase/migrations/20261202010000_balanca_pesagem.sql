-- =============================================================================
-- Pesagem no caixa (restaurante por quilo, açougue, hortifrúti)
--
--  * Produto vendido por quilo (unidade KG) pode ter o peso do prato ou da
--    embalagem (tara), descontado do peso lido na balança.
--  * A loja diz como é a etiqueta impressa pela balança (código de barras que
--    começa com 2): com o preço total ou com o peso, e quantos dígitos tem o
--    código do produto. Sem etiqueta configurada, o leitor segue igual.
--  * A leitura da balança ligada ao computador acontece no navegador do caixa
--    (as opções da porta ficam guardadas naquele computador).
-- =============================================================================

alter table public.nfe_produtos
  add column tara_kg numeric(8, 3) check (tara_kg is null or (tara_kg >= 0 and tara_kg < 10));

alter table public.gestao_config
  add column balanca_etiqueta text check (balanca_etiqueta is null or balanca_etiqueta in ('preco', 'peso')),
  add column balanca_digitos_codigo smallint not null default 4 check (balanca_digitos_codigo between 4 and 6);

-- Peso do prato/embalagem do produto (só para produto vendido por quilo)
create or replace function public.gestao_produto_tara(p_empresa_id uuid, p_produto_id uuid, p_tara_kg numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unidade text;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  select unidade into v_unidade from public.nfe_produtos where id = p_produto_id and empresa_id = p_empresa_id;
  if v_unidade is null then
    raise exception 'Produto não encontrado.';
  end if;
  if p_tara_kg is not null and p_tara_kg > 0 and v_unidade <> 'KG' then
    raise exception 'O peso do prato só vale para produto vendido por quilo (unidade KG).';
  end if;
  if p_tara_kg is not null and (p_tara_kg < 0 or p_tara_kg >= 10) then
    raise exception 'Peso do prato inválido (entre 0 e 9,999 kg).';
  end if;
  update public.nfe_produtos set tara_kg = nullif(p_tara_kg, 0) where id = p_produto_id and empresa_id = p_empresa_id;
end;
$$;

-- Como é a etiqueta da balança (preço ou peso) e quantos dígitos tem o código
create or replace function public.gestao_balanca_configurar(p_empresa_id uuid, p_etiqueta text, p_digitos_codigo smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.e_equipe_da_empresa(p_empresa_id) then
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  end if;
  if p_etiqueta is not null and p_etiqueta not in ('preco', 'peso') then
    raise exception 'Escolha se a etiqueta traz o preço total ou o peso.';
  end if;
  if p_digitos_codigo is null or p_digitos_codigo not between 4 and 6 then
    raise exception 'O código do produto na etiqueta tem de 4 a 6 dígitos.';
  end if;
  update public.gestao_config
     set balanca_etiqueta = nullif(p_etiqueta, ''), balanca_digitos_codigo = p_digitos_codigo, atualizado_por = auth.uid()
   where empresa_id = p_empresa_id;
  if not found then
    raise exception 'A gestão da loja não está ligada para esta empresa. Fale com o escritório.';
  end if;
end;
$$;

revoke execute on function public.gestao_produto_tara(uuid, uuid, numeric) from public, anon;
revoke execute on function public.gestao_balanca_configurar(uuid, text, smallint) from public, anon;
grant execute on function public.gestao_produto_tara(uuid, uuid, numeric) to authenticated;
grant execute on function public.gestao_balanca_configurar(uuid, text, smallint) to authenticated;
