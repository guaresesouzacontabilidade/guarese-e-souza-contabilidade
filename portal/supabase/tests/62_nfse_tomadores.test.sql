-- Tomadores salvos da NFS-e: quem emite salva CPF/CNPJ para as próximas notas;
-- validações, atualização pelo mesmo documento, exclusão e isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(20);

\ir 00_setup.sql.inc

-- Empresário (emite notas por padrão) salva um CPF e um CNPJ
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.tom_cpf', public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'cpf', 'documento', '529.982.247-25', 'nome', 'Fulano de Tal', 'email', 'FULANO@Exemplo.com', 'telefone', '(63) 99999-0000'))::text, true);
select isnt(current_setting('testes.tom_cpf'), '', 'salva o tomador com CPF');
select is((select documento || '|' || email || '|' || telefone from public.nfse_tomadores where id = current_setting('testes.tom_cpf')::uuid),
  '52998224725|fulano@exemplo.com|63999990000', 'guarda só os números do CPF e do telefone, e-mail em minúsculas');
select set_config('testes.tom_cnpj', public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'cnpj', 'documento', '11.222.333/0001-81', 'nome', 'Cliente Exemplo LTDA', 'usado', true,
  'endereco', jsonb_build_object('logradouro', 'Rua A', 'numero', '10', 'codigo_municipio', '1718204', 'municipio', 'Porto Nacional',
    'uf', 'to', 'cep', '77500-000', 'invasor', 'não fica')))::text, true);
select is((select endereco ->> 'uf' || '|' || (endereco ->> 'cep') || '|' || (endereco ? 'invasor')::text
             from public.nfse_tomadores where id = current_setting('testes.tom_cnpj')::uuid),
  'TO|77500000|false', 'CNPJ com o endereço da Receita, só com os campos do endereço');
select ok((select ultimo_uso_em is not null from public.nfse_tomadores where id = current_setting('testes.tom_cnpj')::uuid),
  'usado numa nota: marca a data do último uso');

-- Mesmo CPF de novo: atualiza (não duplica)
select is(public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'cpf', 'documento', '52998224725', 'nome', 'Fulano de Tal Silva'))::text, current_setting('testes.tom_cpf'),
  'o mesmo CPF atualiza o tomador salvo');
select is((select count(*)::int || '|' || max(nome) from public.nfse_tomadores where documento = '52998224725'), '1|Fulano de Tal Silva',
  'sem duplicar e com o nome novo');

-- Validações
select throws_like($$select public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid,
  '{"tipo": "cpf", "documento": "11111111111", "nome": "X Y"}'::jsonb)$$, '%CPF do tomador inválido%', 'CPF conferido');
select throws_like($$select public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid,
  '{"tipo": "cnpj", "documento": "11222333000181", "nome": "Sem endereço"}'::jsonb)$$, '%Receita%', 'CNPJ precisa do endereço da Receita');
select throws_like($$select public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid,
  '{"tipo": "cnpj", "documento": "11444777000161", "nome": "Eu", "endereco": {"codigo_municipio": "1718204"}}'::jsonb)$$,
  '%própria empresa%', 'tomador não pode ser a própria empresa');
select throws_like($$select public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid,
  '{"tipo": "cpf", "documento": "52998224725", "nome": "Fulano", "email": "sem-arroba"}'::jsonb)$$, '%E-mail%', 'e-mail conferido');
select throws_ok($$insert into public.nfse_tomadores (empresa_id, tipo, documento, nome)
  values (current_setting('testes.empresa_a')::uuid, 'cpf', '52998224725', 'Direto')$$, '42501', null, 'gravar direto na tabela é proibido');
reset role;

-- Equipe do escritório vê os tomadores da empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.nfse_tomadores where empresa_id = current_setting('testes.empresa_a')::uuid), 2,
  'a equipe vê os tomadores salvos da empresa');
reset role;

-- Colaborador sem a permissão de emitir: não vê nem salva
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.nfse_tomadores), 0, 'colaborador sem a permissão não vê os tomadores');
select throws_ok($$select public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid,
  '{"tipo": "cpf", "documento": "52998224725", "nome": "Fulano"}'::jsonb)$$, '42501', null, 'nem salva');
reset role;

-- Cliente de outra empresa: não vê, não salva e não exclui
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.nfse_tomadores), 0, 'cliente de outra empresa não vê os tomadores');
select throws_ok($$select public.nfse_tomador_salvar(current_setting('testes.empresa_a')::uuid,
  '{"tipo": "cpf", "documento": "52998224725", "nome": "Fulano"}'::jsonb)$$, '42501', null, 'nem salva na empresa dos outros');
select throws_ok($$select public.nfse_tomador_excluir(current_setting('testes.empresa_a')::uuid, current_setting('testes.tom_cpf')::uuid)$$,
  '42501', null, 'nem exclui');
select throws_like($$select public.nfse_tomador_excluir(current_setting('testes.empresa_b')::uuid, current_setting('testes.tom_cpf')::uuid)$$,
  '%não encontrado%', 'nem pela própria empresa com o id de um tomador dos outros');
reset role;

-- Empresário exclui
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$select public.nfse_tomador_excluir(current_setting('testes.empresa_a')::uuid, current_setting('testes.tom_cpf')::uuid)$$,
  'o empresário exclui um tomador salvo');
select is((select count(*)::int from public.nfse_tomadores), 1, 'fica só o outro');
reset role;

select * from finish();
rollback;
