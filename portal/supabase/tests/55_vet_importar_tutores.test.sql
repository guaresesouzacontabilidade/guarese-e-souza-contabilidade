-- Importação de tutores e animais por planilha: grava o lote de uma vez, o
-- tutor já cadastrado (mesmo CPF, ou mesmo nome e telefone) só recebe os
-- animais novos, o animal já cadastrado (mesmo tutor e nome, ou microchip)
-- fica como está, importar de novo não duplica, uma linha com erro desfaz o
-- lote e só o responsável da clínica importa.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "veterinaria"}');
reset role;

-- Já no portal: a tutora Ana, com o Rex
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.ana', public.vet_tutor_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Ana Souza", "cpf": "52998224725", "telefone": "63999990001"}')::text, true);
select public.vet_paciente_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('tutor_id', current_setting('testes.ana'), 'nome', 'Rex', 'especie', 'canina'));
select public.vet_tutor_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "José  Lima", "telefone": "63988887777"}');
reset role;

select set_config('testes.lote', jsonb_build_array(
  -- Mesmo CPF da Ana: só a Mel entra (o Rex já existe, mesmo com acento e maiúscula diferentes)
  jsonb_build_object('origem', 'planilha.xlsx, linha 2', 'nome', 'ANA SOUZA', 'cpf', '529.982.247-25', 'animais', jsonb_build_array(
    jsonb_build_object('origem', 'planilha.xlsx, linha 2', 'nome', 'REX', 'especie', 'canina'),
    jsonb_build_object('origem', 'planilha.xlsx, linha 3', 'nome', 'Mel', 'especie', 'felina', 'sexo', 'femea', 'castrado', true,
                       'nascimento', '2021-05-10', 'microchip', '982000123456789', 'peso_kg', '4.2'))),
  -- Mesmo nome (sem acento e espaço a mais) e telefone do José: já cadastrado
  jsonb_build_object('origem', 'planilha.xlsx, linha 4', 'nome', 'Jose Lima', 'telefone', '63988887777', 'animais', jsonb_build_array(
    jsonb_build_object('origem', 'planilha.xlsx, linha 4', 'nome', 'Tico', 'especie', 'ave'))),
  -- Tutor novo, com um animal inativo (falecido no sistema antigo) e um de espécie "outra"
  jsonb_build_object('origem', 'planilha.xlsx, linha 5', 'nome', 'Carla Dias', 'telefone', '63977776666', 'email', 'CARLA@EXEMPLO.TEST',
                     'cidade', 'Porto Nacional', 'uf', 'TO', 'animais', jsonb_build_array(
    jsonb_build_object('origem', 'planilha.xlsx, linha 5', 'nome', 'Bidu', 'especie', 'canina', 'ativo', false),
    jsonb_build_object('origem', 'planilha.xlsx, linha 6', 'nome', 'Furão', 'especie', 'outra', 'especie_outra', 'Furão'))),
  -- Só o tutor (sem animais)
  jsonb_build_object('origem', 'planilha.xlsx, linha 7', 'nome', 'Davi Rocha', 'telefone', '6333334444')
)::text, true);

-- A recepção não importa
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format('select public.vet_importar_tutores(%L, %L)', current_setting('testes.empresa_a'), current_setting('testes.lote')), '42501', null,
  'a recepção não importa a planilha');
reset role;

-- Outra empresa não importa na clínica
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format('select public.vet_importar_tutores(%L, %L)', current_setting('testes.empresa_a'), current_setting('testes.lote')), '42501', null,
  'cliente de outra empresa não importa');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.vet_importar_tutores(current_setting('testes.empresa_a')::uuid, current_setting('testes.lote')::jsonb),
  '{"tutores_novos": 2, "tutores_existentes": 2, "animais_novos": 4, "animais_existentes": 1}'::jsonb,
  'importa: 2 tutores novos, 2 já cadastrados, 4 animais novos e o Rex já existia');
reset role;
select is((select count(*)::int from public.vet_tutores where empresa_id = current_setting('testes.empresa_a')::uuid), 4, 'sem tutor repetido');
select is((select string_agg(p.nome, ', ' order by p.nome) from public.vet_pacientes p where p.tutor_id = current_setting('testes.ana')::uuid),
  'Mel, Rex', 'a Ana recebeu só a Mel');
select is((select concat_ws('|', especie, sexo, castrado, nascimento, microchip, peso_kg) from public.vet_pacientes where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Mel'),
  'felina|femea|t|2021-05-10|982000123456789|4.200', 'dados do animal gravados');
select is((select ativo from public.vet_pacientes where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Bidu'), false, 'animal falecido no sistema antigo entra inativo');
select is((select email || '|' || uf from public.vet_tutores where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Carla Dias'), 'carla@exemplo.test|TO', 'e-mail em minúsculas e UF');
select ok(exists (select 1 from public.vet_tutores where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Davi Rocha'), 'tutor sem animais também entra');

-- Importar de novo não duplica nada
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.vet_importar_tutores(current_setting('testes.empresa_a')::uuid, current_setting('testes.lote')::jsonb),
  '{"tutores_novos": 0, "tutores_existentes": 4, "animais_novos": 0, "animais_existentes": 5}'::jsonb, 'a mesma planilha de novo não duplica');

-- Uma linha com erro desfaz o lote inteiro (e diz qual linha)
select throws_like(format('select public.vet_importar_tutores(%L, %L)', current_setting('testes.empresa_a'), jsonb_build_array(
  jsonb_build_object('origem', 'nova.xlsx, linha 2', 'nome', 'Eva Nunes', 'telefone', '63911112222'),
  jsonb_build_object('origem', 'nova.xlsx, linha 3', 'nome', 'Fábio Reis', 'telefone', '63922223333', 'animais', jsonb_build_array(
    jsonb_build_object('origem', 'nova.xlsx, linha 3', 'nome', 'Thor', 'especie', 'dinossauro'))))),
  'nova.xlsx, linha 3: confira a espécie%', 'erro aponta a linha da planilha');
select throws_ok(format('insert into public.vet_tutores (empresa_id, nome) values (%L, %L)', current_setting('testes.empresa_a'), 'Direto'), '42501', null,
  'ninguém grava direto na tabela');
reset role;
select ok(not exists (select 1 from public.vet_tutores where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Eva Nunes'), 'com erro, nada do lote é gravado');

select * from finish();
rollback;
