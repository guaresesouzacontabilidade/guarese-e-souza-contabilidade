-- Banners de campanha do site da loja: só quem gerencia a loja da própria
-- empresa cadastra; a vitrine mostra só os ligados, com imagem e dentro do
-- período, na ordem; link só para páginas do site; imagens só na pasta do banner.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
select public.loja_site_liberar(current_setting('testes.empresa_a')::uuid, true);
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.loja_site_configurar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'ativo', true, 'slug', 'loja-a', 'nome', 'Loja A', 'whatsapp', '63999990000', 'pagamentos', jsonb_build_array('pix'),
  'entregas', jsonb_build_array(jsonb_build_object('nome', 'Retirada na loja', 'valor', 0))));
select public.loja_site_definir_chave(current_setting('testes.empresa_a')::uuid, encode(extensions.digest('chave-a', 'sha256'), 'hex'), 'lj_a');

-- No ar agora (ordem 2), no ar agora (ordem 1), agendado, encerrado, desligado e sem imagem
select set_config('testes.b_agora2', public.loja_site_banner_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Prata 925 para presentear', 'link', '/c/prata-925', 'ordem', 2, 'inicio', now() - interval '1 day', 'fim', now() + interval '7 days'))::text, true);
select set_config('testes.b_agora1', public.loja_site_banner_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Dia das Mães', 'ordem', 1))::text, true);
select set_config('testes.b_futuro', public.loja_site_banner_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Black Friday', 'inicio', now() + interval '10 days', 'fim', now() + interval '13 days'))::text, true);
select set_config('testes.b_fim', public.loja_site_banner_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Natal passado', 'inicio', now() - interval '40 days', 'fim', now() - interval '20 days'))::text, true);
select set_config('testes.b_off', public.loja_site_banner_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Desligado', 'ativo', false))::text, true);
select set_config('testes.b_sem', public.loja_site_banner_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Ainda sem imagem'))::text, true);
select public.loja_site_banner_imagens(current_setting('testes.empresa_a')::uuid, b::uuid,
         current_setting('testes.empresa_a') || '/b/' || b || '/computador1', null)
  from unnest(array[current_setting('testes.b_agora2'), current_setting('testes.b_agora1'), current_setting('testes.b_futuro'),
                    current_setting('testes.b_fim'), current_setting('testes.b_off')]) b;

select throws_like(format('select public.loja_site_banner_imagens(%L, %L, %L, null)', current_setting('testes.empresa_a'), current_setting('testes.b_agora1'),
  current_setting('testes.empresa_a') || '/b/' || current_setting('testes.b_futuro') || '/computador9'), '%Imagem inválida%',
  'imagem fora da pasta do banner é recusada');
select is(public.loja_site_banner_imagens(current_setting('testes.empresa_a')::uuid, current_setting('testes.b_agora1')::uuid,
  current_setting('testes.empresa_a') || '/b/' || current_setting('testes.b_agora1') || '/computador2',
  current_setting('testes.empresa_a') || '/b/' || current_setting('testes.b_agora1') || '/celular01'),
  array[current_setting('testes.empresa_a') || '/b/' || current_setting('testes.b_agora1') || '/computador1'],
  'trocar a imagem devolve a antiga, para apagar');
select throws_like(format('select public.loja_site_banner_salvar(%L, null, %L)', current_setting('testes.empresa_a'),
  '{"titulo": "Link de fora", "link": "https://outro-site.com"}'), '%link para uma página do site%', 'link para outro site é recusado');
select throws_like(format('select public.loja_site_banner_salvar(%L, null, %L)', current_setting('testes.empresa_a'),
  jsonb_build_object('titulo', 'Período ao contrário', 'inicio', now(), 'fim', now() - interval '1 day')), '%fim depois do início%',
  'fim antes do início é recusado');
reset role;

-- Quem só vende e quem é de outra empresa não mexem nos banners
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format('select public.loja_site_banner_salvar(%L, null, %L)', current_setting('testes.empresa_a'), '{"titulo": "Tentativa"}'), '42501', null,
  'quem só vende não cadastra banner');
select is((select count(*)::int from public.loja_site_banners), 6, 'mas vê os banners da loja');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format('select public.loja_site_banner_excluir(%L, %L)', current_setting('testes.empresa_a'), current_setting('testes.b_agora1')), '42501', null,
  'cliente de outra empresa não exclui banner');
select is((select count(*)::int from public.loja_site_banners), 0, 'nem vê os banners de outra empresa');
reset role;

-- Vitrine: só os no ar, na ordem, com o celular caindo para a imagem do computador
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select set_config('testes.vitrine', public.loja_site_vitrine('loja-a', encode(extensions.digest('chave-a', 'sha256'), 'hex'))::text, true);
reset role;
select is((select array_agg(b ->> 'titulo' order by ord) from jsonb_array_elements(current_setting('testes.vitrine')::jsonb -> 'banners') with ordinality as t(b, ord)),
  array['Dia das Mães', 'Prata 925 para presentear'], 'só os banners no ar, na ordem (agendado, encerrado, desligado e sem imagem ficam de fora)');
select is((current_setting('testes.vitrine')::jsonb -> 'banners' -> 1 ->> 'link'), '/c/prata-925', 'o link do banner vai junto');
select is((current_setting('testes.vitrine')::jsonb -> 'banners' -> 1 ->> 'celular'), current_setting('testes.vitrine')::jsonb -> 'banners' -> 1 ->> 'computador',
  'sem imagem de celular, usa a do computador');
select is((current_setting('testes.vitrine')::jsonb -> 'banners' -> 0 ->> 'celular'), current_setting('testes.empresa_a') || '/b/' || current_setting('testes.b_agora1') || '/celular01',
  'com imagem de celular, usa a dela');

-- Excluir devolve as imagens para apagar
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(cardinality(public.loja_site_banner_excluir(current_setting('testes.empresa_a')::uuid, current_setting('testes.b_agora1')::uuid)), 2,
  'excluir devolve as duas imagens do banner');
reset role;
select is((select count(*)::int from public.loja_site_banners where id = current_setting('testes.b_agora1')::uuid), 0, 'e o banner sai do cadastro');

select * from finish();
rollback;
