-- Critérios: a lista de produtos fora da ST no Estado traz as exclusões do
-- Tocantins (bebidas frias, tintas e vernizes, higiene) com a condição da
-- indústria do Estado e a data de início; é interna do escritório (o cliente
-- não lê), a equipe lê e só o administrador altera; CEST inválido é recusado.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

\ir 00_setup.sql.inc

select is((select vigencia_inicio from public.auditor_st_exclusoes where uf = 'TO' and segmento = 'bebidas_frias'), '2025-07-01'::date,
  'bebidas frias do Tocantins fora da ST desde 01/07/2025 (efeito retroativo)');
select is((select cest_prefixo from public.auditor_st_exclusoes where uf = 'TO' and segmento = 'tintas_vernizes'), '2400100',
  'tintas e vernizes (CEST 24.001.00) na lista');
select is((select count(*)::int from public.auditor_st_exclusoes where uf = 'TO' and segmento = 'higiene_cosmeticos'), 10,
  'higiene: os itens 16.1 a 16.8 e 16.10 a 16.12 (fraldas num prefixo só)');
select ok((select bool_and(somente_fabricante_uf and confianca = 'conferir') from public.auditor_st_exclusoes where uf = 'TO'),
  'todas valem só para a indústria do Estado e ficam marcadas "conferir"');
select throws_ok($$insert into public.auditor_st_exclusoes (uf, item, segmento, cest_prefixo, descricao, fonte_titulo, vigencia_inicio)
                   values ('TO', '1', 'tintas_vernizes', '24.001.00', 'Teste', 'Fonte de teste', '2026-01-01')$$,
  '23514', null, 'CEST com pontos é recusado (só dígitos)');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.auditor_st_exclusoes), 0, 'cliente não lê a lista interna');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select ok((select count(*) from public.auditor_st_exclusoes) >= 12, 'equipe lê a lista');
update public.auditor_st_exclusoes set ativo = false where segmento = 'tintas_vernizes';
reset role;
select is((select ativo from public.auditor_st_exclusoes where segmento = 'tintas_vernizes'), true, 'equipe não altera a lista');

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.auditor_st_exclusoes set ativo = false where segmento = 'tintas_vernizes';
reset role;
select is((select ativo from public.auditor_st_exclusoes where segmento = 'tintas_vernizes'), false, 'administrador desativa uma linha');

select * from finish();
rollback;
