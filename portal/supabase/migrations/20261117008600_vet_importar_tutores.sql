-- Clínica veterinária: importação de tutores e animais por planilha (cadastro
-- vindo de outro sistema). O portal lê a planilha e mostra a prévia; esta
-- função grava um lote de tutores com os animais de cada um, de uma vez (se
-- uma linha falhar, nada do lote muda), e decide de novo o que já existe:
--  * tutor já cadastrado = mesmo CPF, ou mesmo nome e um telefone igual: o
--    cadastro dele fica como está e só recebe os animais novos;
--  * animal já cadastrado = mesmo tutor e mesmo nome, ou o mesmo microchip:
--    fica como está.
-- Assim, importar a mesma planilha duas vezes não duplica nada. Só o
-- responsável pela clínica (gestao.gerenciar) importa.

-- Procura do tutor pelo telefone (importação e busca)
create index if not exists vet_tutores_telefone_idx on public.vet_tutores (empresa_id, telefone) where telefone is not null;
create index if not exists vet_tutores_telefone2_idx on public.vet_tutores (empresa_id, telefone2) where telefone2 is not null;

create or replace function app.vet_nome_chave(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(trim(app.normalizar(p_nome)), '\s+', ' ', 'g');
$$;

create or replace function public.vet_importar_tutores(p_empresa_id uuid, p_tutores jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t jsonb;
  a jsonb;
  v_tutor uuid;
  v_cpf text;
  v_tel text;
  v_tel2 text;
  v_nome text;
  v_nasc date;
  v_origem text;
  v_tutores_novos int := 0;
  v_tutores_existentes int := 0;
  v_animais_novos int := 0;
  v_animais_existentes int := 0;
begin
  perform app.exigir_vet(p_empresa_id, 'gestao.gerenciar');
  if jsonb_typeof(p_tutores) <> 'array' or jsonb_array_length(p_tutores) = 0 then
    raise exception 'Nenhum tutor para importar.';
  end if;
  if jsonb_array_length(p_tutores) > 1000 then
    raise exception 'Envie até 1.000 tutores por vez.';
  end if;

  for t in select * from jsonb_array_elements(p_tutores) loop
    v_origem := coalesce(app.vet_texto(t, 'origem', 200), 'planilha');
    v_nome := app.vet_texto(t, 'nome', 120);
    if v_nome is null or length(v_nome) < 2 then
      raise exception '%: informe o nome do tutor.', v_origem;
    end if;
    v_cpf := app.vet_digitos(t, 'cpf');
    if v_cpf is not null and not app.cpf_valido(v_cpf) then
      raise exception '%: CPF inválido.', v_origem;
    end if;
    v_tel := app.vet_digitos(t, 'telefone');
    v_tel2 := app.vet_digitos(t, 'telefone2');

    v_tutor := null;
    if v_cpf is not null then
      select id into v_tutor from public.vet_tutores where empresa_id = p_empresa_id and cpf = v_cpf;
    end if;
    if v_tutor is null and coalesce(v_tel, v_tel2) is not null then
      select id into v_tutor from public.vet_tutores
       where empresa_id = p_empresa_id
         and app.vet_nome_chave(nome) = app.vet_nome_chave(v_nome)
         and (telefone in (v_tel, v_tel2) or telefone2 in (v_tel, v_tel2))
       order by created_at
       limit 1;
    end if;

    if v_tutor is not null then
      v_tutores_existentes := v_tutores_existentes + 1;
    else
      begin
        insert into public.vet_tutores (
          empresa_id, nome, cpf, telefone, telefone2, email, cep, logradouro, numero, complemento, bairro, cidade, uf, observacoes
        ) values (
          p_empresa_id, v_nome, v_cpf, v_tel, v_tel2, lower(app.vet_texto(t, 'email', 200)), app.vet_digitos(t, 'cep'),
          app.vet_texto(t, 'logradouro', 150), app.vet_texto(t, 'numero', 20), app.vet_texto(t, 'complemento', 80), app.vet_texto(t, 'bairro', 80),
          app.vet_texto(t, 'cidade', 80), upper(app.vet_texto(t, 'uf', 2)), app.vet_texto(t, 'observacoes', 1000)
        ) returning id into v_tutor;
      exception when check_violation then
        raise exception '%: confira o telefone (com DDD), o e-mail, o CEP e a UF do tutor %.', v_origem, v_nome;
      end;
      v_tutores_novos := v_tutores_novos + 1;
    end if;

    for a in select * from jsonb_array_elements(coalesce(t -> 'animais', '[]'::jsonb)) loop
      v_origem := coalesce(app.vet_texto(a, 'origem', 200), v_origem);
      v_nome := app.vet_texto(a, 'nome', 80);
      if v_nome is null then
        raise exception '%: informe o nome do animal.', v_origem;
      end if;
      if exists (select 1 from public.vet_pacientes where tutor_id = v_tutor and app.vet_nome_chave(nome) = app.vet_nome_chave(v_nome))
         or (app.vet_texto(a, 'microchip', 23) is not null
             and exists (select 1 from public.vet_pacientes where empresa_id = p_empresa_id and upper(microchip) = upper(app.vet_texto(a, 'microchip', 23)))) then
        v_animais_existentes := v_animais_existentes + 1;
        continue;
      end if;
      v_nasc := nullif(a ->> 'nascimento', '')::date;
      if v_nasc is not null and v_nasc > app.hoje() then
        raise exception '%: a data de nascimento do animal % está no futuro.', v_origem, v_nome;
      end if;
      begin
        insert into public.vet_pacientes (
          empresa_id, tutor_id, nome, especie, especie_outra, raca, sexo, castrado, nascimento, nascimento_estimado, pelagem, porte,
          peso_kg, microchip, alergias, observacoes, ativo
        ) values (
          p_empresa_id, v_tutor, v_nome, nullif(a ->> 'especie', ''), app.vet_texto(a, 'especie_outra', 60), app.vet_texto(a, 'raca', 80),
          coalesce(nullif(a ->> 'sexo', ''), 'indefinido'), coalesce((a ->> 'castrado')::boolean, false), v_nasc,
          coalesce((a ->> 'nascimento_estimado')::boolean, false), app.vet_texto(a, 'pelagem', 80), nullif(a ->> 'porte', ''),
          app.vet_numero(a, 'peso_kg', 'peso'), upper(app.vet_texto(a, 'microchip', 23)), app.vet_texto(a, 'alergias', 500),
          app.vet_texto(a, 'observacoes', 1000), coalesce((a ->> 'ativo')::boolean, true)
        );
      exception
        when check_violation or not_null_violation then
          raise exception '%: confira a espécie, o sexo, o porte, o peso e o microchip do animal %.', v_origem, v_nome;
        when unique_violation then
          raise exception '%: o microchip do animal % já está em outro animal.', v_origem, v_nome;
      end;
      v_animais_novos := v_animais_novos + 1;
    end loop;
  end loop;

  return jsonb_build_object('tutores_novos', v_tutores_novos, 'tutores_existentes', v_tutores_existentes,
                            'animais_novos', v_animais_novos, 'animais_existentes', v_animais_existentes);
end;
$$;

revoke execute on function app.vet_nome_chave(text) from public, anon, authenticated;
revoke execute on function public.vet_importar_tutores(uuid, jsonb) from public, anon;
grant execute on function public.vet_importar_tutores(uuid, jsonb) to authenticated;
