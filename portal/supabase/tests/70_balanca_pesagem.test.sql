-- Pesagem no caixa: peso do prato só em produto por quilo, só o gerente
-- altera; etiqueta da balança configurada pela loja ou pelo escritório; o
-- colaborador que só vende não muda nada; outra empresa não mexe.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

\ir 00_setup.sql.inc

update public.empresa_membros set permissoes = permissoes || array['gestao.vender']
 where user_id = '00000000-0000-0000-0000-0000000000b2';

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prato', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Refeição por quilo', 'ncm', '21069090', 'unidade', 'kg', 'valor_unitario', 69.90, 'controla_estoque', false))::text, true);
select set_config('testes.refri', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Refrigerante lata', 'ncm', '22021000', 'unidade', 'UN', 'valor_unitario', 6))::text, true);
select lives_ok(format($$select public.gestao_produto_tara(%L, %L, 0.350)$$, current_setting('testes.empresa_a'), current_setting('testes.prato')),
  'gerente define o peso do prato do produto por quilo');
select throws_like(format($$select public.gestao_produto_tara(%L, %L, 0.1)$$, current_setting('testes.empresa_a'), current_setting('testes.refri')),
  '%só vale para produto vendido por quilo%', 'produto por unidade não tem peso do prato');
select throws_like(format($$select public.gestao_produto_tara(%L, %L, 12)$$, current_setting('testes.empresa_a'), current_setting('testes.prato')),
  '%inválido%', 'peso do prato fora do limite é recusado');
select lives_ok(format($$select public.gestao_balanca_configurar(%L, 'preco', 5::smallint)$$, current_setting('testes.empresa_a')),
  'gerente configura a etiqueta da balança');
reset role;

select is((select tara_kg::text from public.nfe_produtos where id = current_setting('testes.prato')::uuid), '0.350', 'peso do prato guardado');
select is((select balanca_etiqueta || '/' || balanca_digitos_codigo from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'preco/5', 'etiqueta com preço e código de 5 dígitos');

-- Colaborador que só vende não altera
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.gestao_produto_tara(%L, %L, 0.2)$$, current_setting('testes.empresa_a'), current_setting('testes.prato')),
  '42501', null, 'quem só vende não muda o peso do prato');
reset role;

-- Outra empresa não mexe
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.gestao_balanca_configurar(%L, 'peso', 4::smallint)$$, current_setting('testes.empresa_a')),
  '42501', null, 'cliente de outra empresa não configura a balança');
reset role;

-- O escritório desliga a etiqueta
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.gestao_balanca_configurar(%L, null, 4::smallint)$$, current_setting('testes.empresa_a')),
  'a equipe do escritório desliga a etiqueta da balança');
reset role;

select * from finish();
rollback;
