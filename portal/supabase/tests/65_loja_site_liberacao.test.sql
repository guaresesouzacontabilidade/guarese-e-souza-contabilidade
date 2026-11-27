-- Liberação do site da loja por empresa: só o escritório libera; sem
-- liberação, a loja não configura o site, não envia fotos e o catálogo e os
-- pedidos respondem como loja inexistente; desligar tira o site do ar sem
-- apagar o cadastro.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

-- Sem liberação, quem gerencia a loja não configura o site
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_a'),
  jsonb_build_object('ativo', true, 'slug', 'loja-a', 'nome', 'Loja A', 'whatsapp', '63999990000', 'pagamentos', jsonb_build_array('pix'),
    'entregas', jsonb_build_array(jsonb_build_object('nome', 'Retirada na loja', 'valor', 0)))),
  '42501', 'O site da loja ainda não foi liberado para esta empresa. Fale com o escritório.', 'sem liberação, a loja não configura o site');
select throws_ok(format('select public.loja_site_liberar(%L, true)', current_setting('testes.empresa_a')), '42501', null,
  'a própria loja não se libera');
select is((select count(*)::int from public.loja_site_liberacoes), 0, 'e vê que a empresa não está liberada');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('loja-site', %L, auth.uid())$$,
  current_setting('testes.empresa_a') || '/p/' || gen_random_uuid() || '/foto1234'), '42501', null, 'sem liberação, não envia fotos do site');
reset role;

-- O escritório libera
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok(format('select public.loja_site_liberar(%L, true)', current_setting('testes.empresa_a')), 'o escritório libera o site da empresa');
select lives_ok(format('select public.loja_site_liberar(%L, true)', current_setting('testes.empresa_a')), 'liberar de novo não dá erro');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_a'),
  jsonb_build_object('ativo', true, 'slug', 'loja-a', 'nome', 'Loja A', 'whatsapp', '63999990000', 'pagamentos', jsonb_build_array('pix'),
    'entregas', jsonb_build_array(jsonb_build_object('nome', 'Retirada na loja', 'valor', 0)))), 'liberada, a loja configura o site');
select public.loja_site_definir_chave(current_setting('testes.empresa_a')::uuid, encode(extensions.digest('chave-a', 'sha256'), 'hex'), 'lj_a');
reset role;

-- Outra empresa não vê a liberação de A
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.loja_site_liberacoes), 0, 'cliente de outra empresa não vê a liberação');
reset role;

-- Catálogo no ar com a liberação; desligada, some (sem apagar o cadastro)
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select ok(public.loja_site_vitrine('loja-a', encode(extensions.digest('chave-a', 'sha256'), 'hex')) ->> 'aberta' = 'true', 'liberada, o catálogo responde');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.loja_site_liberar(current_setting('testes.empresa_a')::uuid, false);
reset role;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(public.loja_site_vitrine('loja-a', encode(extensions.digest('chave-a', 'sha256'), 'hex')), null, 'desligada, o catálogo responde como loja inexistente');
select throws_ok(format('select public.loja_site_pedido(%L, %L, %L)', 'loja-a', encode(extensions.digest('chave-a', 'sha256'), 'hex'), '{}'),
  '42501', 'Loja não encontrada.', 'e os pedidos também');
reset role;
select is((select count(*)::int from public.loja_sites where slug = 'loja-a'), 1, 'o cadastro do site continua guardado');

select * from finish();
rollback;
