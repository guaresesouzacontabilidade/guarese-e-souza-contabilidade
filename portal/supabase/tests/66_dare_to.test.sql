-- DARE da SEFAZ-TO pelo robô (DARE avulso público, sem login): dados da tela da
-- apuração e emissões do Tocantins, com o isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

\ir 00_setup.sql.inc

select is((select count(*)::int from information_schema.tables where table_schema = 'public' and table_name like 'dare_to_acesso%'), 0,
  'não há cadastro de login da SEFAZ-TO (o DARE avulso é público)');

-- Equipe: dados da tela e emissão do DARE do Tocantins (receita 105, origem apuração)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select ok((public.dados_dare_to(current_setting('testes.empresa_a')::uuid, '2026-10-01') -> 'empresa') ? 'municipio_ibge',
  'dados da tela trazem o município da empresa (município da receita)');
select lives_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'TO', 'receita', '105', 'numero', '202611090000012345678', 'principal', '200.00', 'total', '200.00',
  'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'apuracao'))$$, 'grava o DARE do Tocantins com origem "apuração"');
select lives_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'MT', 'receita', '1112', 'numero', '202611090000012345678', 'principal', '10.00', 'total', '10.00',
  'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'informado'))$$, 'o mesmo número em outro estado não conflita');
select throws_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'TO', 'receita', '105', 'numero', '202611090000012345678', 'principal', '200.00', 'total', '200.00',
  'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'apuracao'))$$, '23505', null, 'o mesmo DARE não é gravado duas vezes');
select lives_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-10-01', 'uf', 'TO', 'receita', '105', 'numero', '858100000021000003850002261109000093870000000004',
  'principal', '5.00', 'total', '5.00', 'vencimento_imposto', '2026-11-09', 'vencimento', '2026-11-09', 'origem', 'apuracao'))$$,
  'aceita a linha digitável (48 dígitos) como número quando o PDF não traz o nosso número');
select is((jsonb_array_length(public.dados_dare_to(current_setting('testes.empresa_a')::uuid, '2026-10-01') -> 'emissoes')), 2,
  'a tela mostra só os DARE do Tocantins do mês');
select is((select count(*)::int from public.dare_to_emitidos_mes('2026-10-01')), 1, 'a carteira vê o último DARE emitido da empresa');
reset role;

-- Cliente de outra empresa: não abre os dados nem vê os DARE
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.dados_dare_to(current_setting('testes.empresa_a')::uuid, '2026-10-01')$$, null, null, 'cliente de outra empresa não abre os dados do DARE');
select is((select count(*)::int from public.dare_to_emitidos_mes('2026-10-01')), 0, 'cliente de outra empresa não vê os DARE');
reset role;

select * from finish();
rollback;
