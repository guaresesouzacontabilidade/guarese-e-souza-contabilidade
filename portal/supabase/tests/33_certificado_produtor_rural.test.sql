-- Critérios: o produtor rural pessoa física cadastra o certificado e-CPF do
-- próprio CPF (para emitir NF-e e buscar as notas); e-CPF de outro CPF, e-CNPJ
-- em produtor pessoa física e e-CPF em empresa são recusados; a empresa
-- continua aceitando o e-CNPJ com a mesma raiz.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('testes.produtor', public.criar_empresa(jsonb_build_object(
  'razao_social', 'Produtor Rural Teste', 'tipo_pessoa', 'PF', 'documento', '529.982.247-25',
  'regime_tributario', 'produtor_rural', 'servicos', jsonb_build_array('fiscal')))::text, true);

create or replace function pg_temp.cadastrar(p_empresa text, p_documento text)
returns uuid
language sql
as $$
  select public.registrar_certificado(current_setting(p_empresa)::uuid, 'FULANO DE TAL:' || p_documento, p_documento,
    'AC TESTE', '0A1C', repeat('D', 64), now() - interval '1 day', now() + interval '300 days', 'Autorização de teste do produtor para o portal.', 'v1:QUJDRA==');
$$;

select throws_ok($$select pg_temp.cadastrar('testes.produtor', '52998224726')$$, 'P0001', 'O certificado não é desta empresa (CNPJ ou CPF diferente).', 'e-CPF de outro CPF é recusado');
select throws_ok($$select pg_temp.cadastrar('testes.produtor', '52998224000195')$$, 'P0001', 'O certificado não é desta empresa (CNPJ ou CPF diferente).', 'e-CNPJ em produtor pessoa física é recusado');
select throws_ok($$select pg_temp.cadastrar('testes.empresa_a', '52998224725')$$, 'P0001', 'O certificado não é desta empresa (CNPJ ou CPF diferente).', 'e-CPF em empresa (CNPJ) é recusado');
select lives_ok($$select pg_temp.cadastrar('testes.produtor', '52998224725')$$, 'e-CPF do próprio produtor é aceito');
select lives_ok($$select pg_temp.cadastrar('testes.empresa_b', '12345678000276')$$, 'e-CNPJ com a mesma raiz continua aceito');
reset role;

select is((select documento from public.certificados_digitais where empresa_id = current_setting('testes.produtor')::uuid and revogado_em is null),
          '52998224725', 'o CPF do certificado fica guardado');
select throws_ok($$insert into public.certificados_digitais (empresa_id, titular, documento, impressao_digital, valido_de, valido_ate, autorizacao, autorizacao_texto)
                   values (current_setting('testes.produtor')::uuid, 'X', '5299822472', repeat('E', 64), now(), now() + interval '1 day', 'autorizacao_escrita', 'Autorização de teste.')$$,
                 '23514', null, 'documento com tamanho inválido é recusado');

select * from finish();
rollback;
