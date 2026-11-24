-- Critérios: quem configura a NF-e guarda o acesso ao SIDAGO (o segredo
-- cifrado ninguém lê pela API); quem emite NF-e prepara o pedido de GTA
-- (animais por sexo e idade somados, placa e documentos conferidos, a nota
-- fiscal puxada da emissão); a conferência do robô registra o resultado e
-- muda a situação; a GTA emitida no SIDAGO é anotada e o pedido não muda nem
-- é apagado; quem não emite NF-e e outra empresa não veem nada.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(18);

\ir 00_setup.sql.inc

-- 1. O escritório (administrador) guarda o acesso ao SIDAGO da empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gta_sidago_salvar_acesso(current_setting('testes.empresa_a')::uuid, '042•••••168', 'v1:QUJDREVGR0g=');
select is((select situacao from public.gta_sidago_acesso where empresa_id = current_setting('testes.empresa_a')::uuid), 'nao_testado', 'acesso guardado, ainda não testado');
select throws_ok($$select count(*) from public.gta_sidago_segredo$$, '42501', null, 'ninguém lê o segredo pela API');
select throws_like(format($$select public.gta_sidago_salvar_acesso(%L, 'x@x', 'senha em texto')$$, current_setting('testes.empresa_a')), '%inválido%',
  'o segredo só entra cifrado');

-- 2. Pedido de GTA: animais somados por sexo e idade, total e conferências
select throws_like(format($$select public.gta_pedido_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'destino_nome', 'Matadouro Exemplo', 'finalidade', 'abate', 'data_saida', '2026-12-01', 'animais', '[]'::jsonb)), '%quantos animais%', 'sem animais não salva');
select throws_like(format($$select public.gta_pedido_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'destino_nome', 'Matadouro Exemplo', 'finalidade', 'abate', 'data_saida', '2026-12-01', 'placa', 'XX-1',
  'animais', jsonb_build_array(jsonb_build_object('sexo', 'macho', 'faixa', '25-36', 'quantidade', 10)))), '%Placa inválida%', 'placa conferida');
select throws_like(format($$select public.gta_pedido_salvar(%L, null, %L)$$, current_setting('testes.empresa_a'), jsonb_build_object(
  'destino_nome', 'Matadouro Exemplo', 'finalidade', 'abate', 'data_saida', '2026-12-01', 'destino_documento', '11.111.111/1111-11',
  'animais', jsonb_build_array(jsonb_build_object('sexo', 'macho', 'faixa', '25-36', 'quantidade', 10)))), '%CNPJ do destino inválido%', 'documento do destino conferido');
select set_config('testes.gta', public.gta_pedido_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'destino_nome', 'Matadouro Exemplo Ltda', 'destino_documento', '11.222.333/0001-81', 'finalidade', 'abate', 'data_saida', '2026-12-01',
  'placa', 'abc-1d23', 'placa_uf', 'go', 'nf_numero', '15', 'nf_serie', '920',
  'animais', jsonb_build_array(
    jsonb_build_object('sexo', 'macho', 'faixa', '25-36', 'quantidade', 10),
    jsonb_build_object('sexo', 'femea', 'faixa', '36+', 'quantidade', 4),
    jsonb_build_object('sexo', 'macho', 'faixa', '25-36', 'quantidade', 6))))::text, true);
select is((select total_animais from public.gta_pedidos where id = current_setting('testes.gta')::uuid), 20, 'total de animais somado');
select is((select jsonb_array_length(animais) from public.gta_pedidos where id = current_setting('testes.gta')::uuid), 2, 'linhas repetidas viram uma (sexo e idade)');
select is((select placa || '/' || placa_uf || '/' || nf_numero || '-' || nf_serie from public.gta_pedidos where id = current_setting('testes.gta')::uuid),
  'ABC1D23/GO/15-920', 'placa e nota fiscal guardadas no formato');

-- 3. Conferência do robô e GTA emitida no SIDAGO
select ok(public.gta_conferencia_registrar(current_setting('testes.gta')::uuid, true, 'Formulário da GTA encontrado (modo conferência: nada foi enviado).',
  '{"login": "ok", "campos": []}'::jsonb) is not null, 'conferência registrada');
select is((select status from public.gta_pedidos where id = current_setting('testes.gta')::uuid), 'conferido', 'pedido conferido');
select is((select situacao from public.gta_sidago_acesso where empresa_id = current_setting('testes.empresa_a')::uuid), 'conectado', 'acesso marcado como conectado');
select throws_like(format($$select public.gta_pedido_registrar_emissao(%L, 'GTA nº 12', null)$$, current_setting('testes.gta')), '%Número da GTA inválido%',
  'número da GTA conferido');
select public.gta_pedido_registrar_emissao(current_setting('testes.gta')::uuid, '123.456', 'a');
select is((select status || ' ' || gta_numero || ' ' || gta_serie from public.gta_pedidos where id = current_setting('testes.gta')::uuid), 'emitida 123456 A', 'GTA emitida anotada');
select throws_like(format($$select public.gta_pedido_excluir(%L)$$, current_setting('testes.gta')), '%não é apagada%', 'GTA emitida não é apagada');
reset role;

-- 4. Quem não emite NF-e e outra empresa não veem nem preparam GTA
update public.empresa_membros set permissoes = array['empresa.ver']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.gta_pedidos), 0, 'sem permissão de NF-e não vê os pedidos');
select throws_like(format($$select public.gta_pedido_salvar(%L, null, '{}')$$, current_setting('testes.empresa_a')), '%permissão%', 'sem permissão de NF-e não prepara GTA');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.gta_pedidos) + (select count(*)::int from public.gta_sidago_acesso), 0, 'outra empresa não vê nada');
reset role;

select * from finish();
rollback;
