-- =============================================================================
-- Loja: importar clientes ou fornecedores de outro sistema (planilha).
--
--  * Quem gerencia a loja importa; os cadastros entram só na empresa escolhida.
--  * Já cadastrado (mesmo CPF/CNPJ, ou mesmo nome quando a linha não tem
--    documento): ganha o papel (cliente/fornecedor) e só completa o que estiver
--    vazio. Nada que já estava preenchido é trocado.
--  * CPF/CNPJ inválido, município inexistente ou campo fora do tamanho: o dado
--    fica em branco e o resto da linha entra.
--  * Lote de até 500 linhas, tudo de uma vez (se algo inesperado falhar, nada
--    do lote muda).
-- =============================================================================

create or replace function public.gestao_importar_contrapartes(p_empresa_id uuid, p_papel text, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l jsonb;
  v_nome text;
  v_doc text;
  v_tel text;
  v_email text;
  v_cep text;
  v_mun text;
  v_ie text;
  v_prazo smallint;
  v_id uuid;
  v_novos int := 0;
  v_atualizados int := 0;
  v_ignorados int := 0;
  v_txt text;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if p_papel is null or p_papel not in ('cliente', 'fornecedor') then
    raise exception 'Cadastro inválido.';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Nenhuma linha para importar.';
  end if;
  if jsonb_array_length(p_linhas) > 500 then
    raise exception 'Envie até 500 linhas por vez.';
  end if;

  for l in select value from jsonb_array_elements(p_linhas) loop
    v_nome := left(nullif(trim(l ->> 'nome'), ''), 120);
    if v_nome is null or length(v_nome) < 2 then
      v_ignorados := v_ignorados + 1;
      continue;
    end if;
    v_doc := nullif(regexp_replace(coalesce(l ->> 'documento', ''), '\D', '', 'g'), '');
    if v_doc is not null and not ((length(v_doc) = 11 and app.cpf_valido(v_doc)) or (length(v_doc) = 14 and app.cnpj_valido(v_doc))) then
      v_doc := null;
    end if;
    v_tel := nullif(regexp_replace(coalesce(l ->> 'telefone', ''), '\D', '', 'g'), '');
    if v_tel is not null and (length(v_tel) < 8 or length(v_tel) > 14) then v_tel := null; end if;
    v_email := nullif(lower(trim(l ->> 'email')), '');
    if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then v_email := null; end if;
    v_cep := nullif(regexp_replace(coalesce(l ->> 'cep', ''), '\D', '', 'g'), '');
    if v_cep is not null and length(v_cep) <> 8 then v_cep := null; end if;
    v_mun := nullif(trim(l ->> 'municipio_ibge'), '');
    if v_mun is not null and not exists (select 1 from public.municipios where ibge = v_mun) then v_mun := null; end if;
    v_ie := nullif(regexp_replace(coalesce(l ->> 'inscricao_estadual', ''), '\D', '', 'g'), '');
    if v_ie is not null and (length(v_ie) < 2 or length(v_ie) > 14) then v_ie := null; end if;
    v_prazo := null;
    v_txt := l ->> 'prazo_pagamento_dias';
    if p_papel = 'fornecedor' and v_txt ~ '^\d{1,3}$' and v_txt::int <= 365 then v_prazo := v_txt::smallint; end if;

    -- Quem já existe: pelo CPF/CNPJ; sem documento, pelo nome (sem diferenciar maiúsculas)
    v_id := null;
    if v_doc is not null then
      select id into v_id from public.contrapartes where empresa_id = p_empresa_id and documento = v_doc;
    else
      select id into v_id from public.contrapartes
       where empresa_id = p_empresa_id and documento is null and lower(trim(nome)) = lower(v_nome)
       order by created_at limit 1;
    end if;

    if v_id is not null then
      update public.contrapartes c
         set papeis = case when p_papel = any(c.papeis) then c.papeis else array_append(c.papeis, p_papel) end,
             telefone = coalesce(c.telefone, v_tel),
             email = coalesce(c.email, v_email),
             cep = coalesce(c.cep, v_cep),
             logradouro = coalesce(c.logradouro, left(nullif(trim(l ->> 'logradouro'), ''), 60)),
             numero = coalesce(c.numero, left(nullif(trim(l ->> 'numero'), ''), 60)),
             complemento = coalesce(c.complemento, left(nullif(trim(l ->> 'complemento'), ''), 60)),
             bairro = coalesce(c.bairro, left(nullif(trim(l ->> 'bairro'), ''), 60)),
             municipio_ibge = coalesce(c.municipio_ibge, v_mun),
             inscricao_estadual = coalesce(c.inscricao_estadual, v_ie),
             contato = coalesce(c.contato, left(nullif(trim(l ->> 'contato'), ''), 80)),
             prazo_pagamento_dias = coalesce(c.prazo_pagamento_dias, v_prazo),
             observacoes = coalesce(c.observacoes, left(nullif(trim(l ->> 'observacoes'), ''), 1000))
       where c.id = v_id;
      v_atualizados := v_atualizados + 1;
    else
      insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis, telefone, email, cep, logradouro, numero, complemento,
                                       bairro, municipio_ibge, inscricao_estadual, contato, prazo_pagamento_dias, observacoes, ativo)
      values (p_empresa_id, v_nome, v_doc, case length(v_doc) when 11 then 'PF' when 14 then 'PJ' end, array[p_papel], v_tel, v_email, v_cep,
              left(nullif(trim(l ->> 'logradouro'), ''), 60), left(nullif(trim(l ->> 'numero'), ''), 60),
              left(nullif(trim(l ->> 'complemento'), ''), 60), left(nullif(trim(l ->> 'bairro'), ''), 60), v_mun, v_ie,
              left(nullif(trim(l ->> 'contato'), ''), 80), v_prazo, left(nullif(trim(l ->> 'observacoes'), ''), 1000),
              coalesce((l ->> 'ativo')::boolean, true))
      returning id into v_id;
      v_novos := v_novos + 1;
    end if;
    if p_papel = 'cliente' then
      perform app.contraparte_para_destinatario(v_id);
    end if;
  end loop;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atualizados, 'ignorados', v_ignorados);
end;
$$;

revoke all on function public.gestao_importar_contrapartes(uuid, text, jsonb) from public, anon;
grant execute on function public.gestao_importar_contrapartes(uuid, text, jsonb) to authenticated;
