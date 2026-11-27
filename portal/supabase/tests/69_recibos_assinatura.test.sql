-- Certificado do escritório para assinar os recibos: só o administrador
-- cadastra (do CNPJ do escritório ou do CPF do contador), a chave cifrada não
-- é lida por ninguém pelo portal, a equipe vê só quem assina, e o recibo
-- guarda o arquivo assinado.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

\ir 00_setup.sql.inc

update public.escritorio set cnpj = '62935399000150' where id = 1;
update public.escritorio_contador set cpf = '52998224725' where id = 1;

-- Equipe (não administrador) não cadastra
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.escritorio_certificado_definir('X:62935399000150', '62935399000150', 'AC', 'AB', repeat('A', 64), now() - interval '1 day', now() + interval '1 year', 'v1:QUJD')$$,
  '42501', null, 'equipe não cadastra o certificado do escritório');
reset role;

-- Administrador cadastra
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like($$select public.escritorio_certificado_definir('OUTRA:11444777000161', '11444777000161', 'AC', 'AB', repeat('A', 64), now() - interval '1 day', now() + interval '1 year', 'v1:QUJD')$$,
  '%não é do escritório%', 'certificado de outro CNPJ é recusado');
select throws_like($$select public.escritorio_certificado_definir('X:62935399000150', '62935399000150', 'AC', 'AB', repeat('A', 64), now() - interval '2 year', now() - interval '1 day', 'v1:QUJD')$$,
  '%venceu%', 'certificado vencido é recusado');
select lives_ok($$select public.escritorio_certificado_definir('CONTADOR:52998224725', '52998224725', 'AC', 'AB', repeat('A', 64), now() - interval '1 day', now() + interval '1 year', 'v1:QUJD')$$,
  'e-CPF do contador é aceito');
select lives_ok($$select public.escritorio_certificado_definir('ESCRITORIO:62935399000150', '62935399000150', 'AC', 'CD', repeat('B', 64), now() - interval '1 day', now() + interval '1 year', 'v1:REVG')$$,
  'e-CNPJ do escritório é aceito e substitui o anterior');
select is((select titular from public.escritorio_certificado), 'ESCRITORIO:62935399000150', 'fica um certificado só (o mais recente)');
select throws_ok($$select conteudo_cifrado from public.escritorio_certificado_segredo$$, '42501', null, 'nem o administrador lê a chave cifrada pelo portal');
reset role;
select is((select conteudo_cifrado from public.escritorio_certificado_segredo), 'v1:REVG', 'a chave cifrada é a do último cadastro');

-- Equipe vê quem assina; cliente não
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select documento from public.escritorio_certificado), '62935399000150', 'equipe vê quem assina e a validade');
select is((select numero from public.recibo_emitir(jsonb_build_object('pagador_nome', 'Fulano', 'valor', '100', 'data_recibo', '2026-11-10'))), 1, 'recibo emitido');
select lives_ok($$select public.recibo_registrar_assinatura((select id from public.recibos_honorarios where numero = 1 and ano = 2026),
  '2026/' || (select id from public.recibos_honorarios where numero = 1 and ano = 2026) || '.pdf', 'ESCRITORIO:62935399000150', '62935399000150')$$,
  'equipe registra o arquivo assinado do recibo');
select ok((select assinado_em is not null from public.recibos_honorarios where numero = 1 and ano = 2026), 'recibo marcado como assinado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.escritorio_certificado), 0, 'cliente não vê o certificado do escritório');
reset role;

-- Remover
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.escritorio_certificado_remover();
reset role;
select is((select count(*)::int from public.escritorio_certificado_segredo), 0, 'remover apaga também a chave cifrada');

select * from finish();
rollback;
