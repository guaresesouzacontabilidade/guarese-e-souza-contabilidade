-- Recibos de honorários: só a equipe emite e vê, numeração por ano sem repetir,
-- pagador completado pela empresa, dados do escritório copiados e cancelamento.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

\ir 00_setup.sql.inc

update public.escritorio set contador_nome = 'Contador Teste', contador_crc = 'CRC TO 000000-O' where id = 1;

-- Equipe emite para uma empresa da carteira: pagador vem do cadastro
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select numero from public.recibo_emitir(jsonb_build_object('empresa_id', current_setting('testes.empresa_a'), 'valor', '810.00',
  'competencia', '2026-11-01', 'data_recibo', '2026-11-15'))), 1, 'primeiro recibo de 2026 é o nº 1');
select is((select pagador_nome from public.recibos_honorarios where ano = 2026 and numero = 1), 'Empresa A Comércio Ltda', 'pagador vem da razão social da empresa');
select is((select pagador_documento from public.recibos_honorarios where ano = 2026 and numero = 1), '11444777000161', 'CNPJ do pagador só com números');
select is((select emitente ->> 'contador_crc' from public.recibos_honorarios where ano = 2026 and numero = 1), 'CRC TO 000000-O', 'CRC do contador copiado no recibo');
select is((select numero from public.recibo_emitir(jsonb_build_object('pagador_nome', 'Fulano Avulso', 'pagador_documento', '529.982.247-25', 'valor', '150',
  'data_recibo', '2026-11-16'))), 2, 'recibo avulso de 2026 recebe o nº 2');
select is((select numero from public.recibo_emitir(jsonb_build_object('pagador_nome', 'Ano Anterior', 'valor', '90', 'data_recibo', '2025-12-30'))), 1,
  'a numeração recomeça em cada ano');
select throws_like($$select * from public.recibo_emitir(jsonb_build_object('valor', '10'))$$, '%Informe quem pagou%', 'sem pagador não emite');
select throws_ok($$select * from public.recibo_emitir(jsonb_build_object('pagador_nome', 'Zero', 'valor', '0'))$$, '23514', null, 'valor zero é recusado');
select throws_ok($$insert into public.recibos_honorarios (ano, numero, pagador_nome, valor, data_recibo, cidade, emitente) values (2026, 99, 'Direto', 1, '2026-11-01', 'X', '{}')$$,
  '42501', null, 'ninguém grava direto na tabela (só pelas funções)');
reset role;

-- Cliente não vê nem emite
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.recibos_honorarios), 0, 'cliente não vê os recibos do escritório');
select throws_ok($$select * from public.recibo_emitir(jsonb_build_object('pagador_nome', 'Eu mesmo', 'valor', '1'))$$, '42501', null, 'cliente não emite recibo');
reset role;

-- Cancelamento
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like($$select public.recibo_cancelar((select id from public.recibos_honorarios where ano = 2026 and numero = 2), 'x')$$, '%motivo%', 'cancelar exige motivo');
select lives_ok($$select public.recibo_cancelar((select id from public.recibos_honorarios where ano = 2026 and numero = 2), 'Valor lançado errado')$$, 'equipe cancela com motivo');
select is((select numero from public.recibo_emitir(jsonb_build_object('pagador_nome', 'Depois do cancelado', 'valor', '20', 'data_recibo', '2026-11-17'))), 3,
  'o número cancelado não volta: o próximo é o nº 3');
reset role;

select * from finish();
rollback;
