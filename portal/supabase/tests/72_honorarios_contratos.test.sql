-- Contratos: só o financeiro do escritório monta e envia; só o sócio titular
-- assina, com código válido e o mesmo arquivo; o cliente de outra empresa não
-- vê; contrato assinado não é cancelado (distrato); o aceite não é chamado
-- pelo navegador.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(18);

\ir 00_setup.sql.inc

select set_config('testes.hash', repeat('ab', 32), true);

-- 1. Equipe sem autorização não monta contrato
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok(format($$select public.honorarios_contrato_salvar(null, '{"empresa_id": "%s", "titulo": "Contrato", "conteudo": {}, "clausulas": []}')$$,
  current_setting('testes.empresa_a')), '42501', null, 'equipe sem autorização não monta contrato');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.honorarios_acesso_definir('00000000-0000-0000-0000-0000000000a2', true);
reset role;

-- 2. Rascunho, PDF e envio
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.contrato', public.honorarios_contrato_salvar(null, jsonb_build_object(
  'empresa_id', current_setting('testes.empresa_a'), 'titulo', 'Contrato de prestação de serviços contábeis',
  'conteudo', jsonb_build_object('valor', 800), 'clausulas', jsonb_build_array(jsonb_build_object('titulo', 'Objeto', 'paragrafos', jsonb_build_array('Texto')))))::text, true);
select is((select numero from public.honorarios_contratos where id = current_setting('testes.contrato')::uuid), 1, 'primeiro contrato do ano é o nº 1');
select throws_like(format($$select public.honorarios_contrato_salvar(null, '{"empresa_id": "%s", "tipo": "aditivo", "contrato_origem_id": "%s", "titulo": "Aditivo", "conteudo": {}, "clausulas": []}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.contrato')), '%contrato assinado%', 'aditivo só parte de contrato assinado');
select throws_like(format($$select public.honorarios_contrato_enviar('%s')$$, current_setting('testes.contrato')), '%Gere o PDF%', 'sem PDF não envia');
select lives_ok(format($$select public.honorarios_contrato_registrar_arquivo('%s', 'teste/contrato.pdf', '%s', true)$$,
  current_setting('testes.contrato'), current_setting('testes.hash')), 'guarda o PDF com o resumo');
select is(public.honorarios_contrato_enviar(current_setting('testes.contrato')::uuid), 1, 'envia e avisa o sócio titular');
select throws_like(format($$select public.honorarios_contrato_salvar('%s', '{"titulo": "Outro", "conteudo": {}, "clausulas": []}')$$, current_setting('testes.contrato')),
  '%aditivo%', 'contrato enviado não muda (só por aditivo)');
reset role;

select is((select count(*) from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'contrato')::int, 1, 'o titular recebeu o aviso');

-- 3. Quem vê
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*) from public.honorarios_contratos)::int, 1, 'o sócio titular vê o contrato da empresa');
select throws_ok(format($$select public.honorarios_contrato_aceitar('%s', '00000000-0000-0000-0000-0000000000b1', null, 'Fulano de Tal', '52998224725', '1.1.1.1', 'x', '%s')$$,
  current_setting('testes.contrato'), current_setting('testes.hash')), '42501', null, 'o navegador não grava o aceite direto');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*) from public.honorarios_contratos)::int, 0, 'cliente de outra empresa não vê');
reset role;

-- 4. Aceite pelo servidor (com código)
select throws_ok(format($$select public.honorarios_contrato_registrar_codigo('%s', '00000000-0000-0000-0000-0000000000b2', '123456')$$, current_setting('testes.contrato')),
  '42501', null, 'colaborador (não titular) não assina');
select lives_ok(format($$select public.honorarios_contrato_registrar_codigo('%s', '00000000-0000-0000-0000-0000000000b1', '123456')$$, current_setting('testes.contrato')),
  'gera o código para o titular');
select throws_like(format($$select public.honorarios_contrato_aceitar('%s', '00000000-0000-0000-0000-0000000000b1', '123456', 'Fulano de Tal', '52998224725', '1.1.1.1', 'x', '%s')$$,
  current_setting('testes.contrato'), repeat('cd', 32)), '%arquivo mudou%', 'arquivo diferente do enviado é recusado');
select throws_like(format($$select public.honorarios_contrato_aceitar('%s', '00000000-0000-0000-0000-0000000000b1', '000000', 'Fulano de Tal', '52998224725', '1.1.1.1', 'x', '%s')$$,
  current_setting('testes.contrato'), current_setting('testes.hash')), '%incorreto%', 'código errado é recusado');
select lives_ok(format($$select public.honorarios_contrato_aceitar('%s', '00000000-0000-0000-0000-0000000000b1', '123456', 'Fulano de Tal', '52998224725', '1.1.1.1', 'Navegador', '%s')$$,
  current_setting('testes.contrato'), current_setting('testes.hash')), 'código certo assina');
select results_eq(format($$select situacao, aceite_metodo, aceite_cpf from public.honorarios_contratos where id = '%s'$$, current_setting('testes.contrato')),
  $$values ('assinado'::text, 'codigo_email'::text, '52998224725'::text)$$, 'assinado com código, CPF guardado');

-- 5. Assinado não é cancelado: distrato
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.honorarios_contrato_cancelar('%s', 'Cliente saiu do escritório')$$, current_setting('testes.contrato')),
  '%distrato%', 'contrato assinado não é cancelado');
reset role;

select * from finish();
rollback;
