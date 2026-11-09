-- DARE da SEFAZ-TO pelo robô: acesso do escritório (só o administrador cadastra; o
-- segredo cifrado ninguém lê), teste de conexão, dados da tela e emissões do Tocantins.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(20);

\ir 00_setup.sql.inc

-- Administrador cadastra o acesso (o servidor manda o conteúdo já cifrado)
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.dare_to_salvar_acesso('***.456.789-**', 'v1:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=')$$, 'administrador cadastra o acesso');
select is((select situacao || '|' || login_mascarado from public.dare_to_acesso), 'nao_testado|***.456.789-**', 'acesso fica "não testado" com o login mascarado');
select throws_ok($$select * from public.dare_to_acesso_segredo$$, '42501', null, 'nem o administrador lê o segredo cifrado');
reset role;

-- Equipe: vê a situação, não cadastra; registra o resultado de um teste
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.dare_to_acesso), 1, 'a equipe vê se o acesso está cadastrado');
select throws_ok($$select public.dare_to_salvar_acesso('x@y.com', 'v1:QUJD')$$, '42501', null, 'a equipe não cadastra o acesso');
select throws_ok($$select public.dare_to_remover_acesso()$$, '42501', null, 'a equipe não remove o acesso');
select lives_ok($$select public.dare_to_registrar_teste(true, 'Entrou e achou o formulário.', '{"formularios": [{"campos": ["dare[receita]"]}]}'::jsonb)$$,
  'registra o resultado do teste');
select is((select situacao from public.dare_to_acesso), 'conectado', 'teste bom deixa o acesso "conectado"');
select is((select count(*)::int from public.dare_to_testes), 0, 'a equipe não vê a estrutura guardada dos testes');
select is((public.dados_dare_to(current_setting('testes.empresa_a')::uuid, '2026-10-01') #>> '{acesso,situacao}'), 'conectado',
  'dados da tela trazem a situação do acesso');

-- Emissão do DARE do Tocantins (receita 105, origem apuração) e a mesma numeração em outro estado
select lives_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'TO', 'receita', '105', 'numero', '202611090000012345678', 'principal', '200.00', 'total', '200.00',
  'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'apuracao'))$$, 'grava o DARE do Tocantins com origem "apuração"');
select lives_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'MT', 'receita', '1112', 'numero', '202611090000012345678', 'principal', '10.00', 'total', '10.00',
  'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'informado'))$$, 'o mesmo número em outro estado não conflita');
select throws_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'TO', 'receita', '105', 'numero', '202611090000012345678', 'principal', '200.00', 'total', '200.00',
  'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'apuracao'))$$, '23505', null, 'o mesmo DARE não é gravado duas vezes');
select is((jsonb_array_length(public.dados_dare_to(current_setting('testes.empresa_a')::uuid, '2026-10-01') -> 'emissoes')), 1,
  'a tela mostra só os DARE do Tocantins do mês');
select is((select count(*)::int from public.dare_to_emitidos_mes('2026-10-01')), 1, 'a carteira vê o DARE emitido da empresa');
reset role;

-- Cliente: não vê o acesso, não registra teste, não abre os dados nem os DARE de outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.dare_to_acesso), 0, 'cliente não vê o acesso do escritório');
select throws_ok($$select public.dare_to_registrar_teste(false, 'x')$$, '42501', null, 'cliente não registra teste');
select is((select count(*)::int from public.dare_to_emitidos_mes('2026-10-01')), 0, 'cliente de outra empresa não vê os DARE');
reset role;

-- Administrador vê a estrutura dos testes e remove o acesso (o segredo vai junto)
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from public.dare_to_testes), 1, 'o administrador vê a estrutura do último teste');
select public.dare_to_remover_acesso();
reset role;
select is((select count(*)::int from public.dare_to_acesso) + (select count(*)::int from public.dare_to_acesso_segredo), 0,
  'remover apaga o acesso e o segredo');

select * from finish();
rollback;
