-- Pix pelo banco: com a ligação ativa, enviar agenda a criação no banco e
-- cancelar agenda a remoção; a baixa pela confirmação do banco lança na DRE e
-- só o servidor chama; o servidor emite o recibo; ligar exige teste.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

\ir 00_setup.sql.inc

-- Ligar sem teste é recusado
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like($$select public.honorarios_banco_configurar('{"banco_ativo": true}')$$, '%Teste a conexão%', 'não liga sem testar a conexão');
select throws_ok($$select public.honorarios_banco_baixar(gen_random_uuid(), 10, current_date, 'E1')$$, '42501', null, 'o navegador não dá baixa pelo banco');
select public.honorarios_acesso_definir('00000000-0000-0000-0000-0000000000a2', true);
reset role;

-- Ligação testada e ligada (como faria o servidor)
update public.honorarios_config set banco_pix = 'sicredi', banco_teste_ok = true, banco_ativo = true, pix_chave = '11444777000161', pix_nome = 'ESCRITORIO', pix_cidade = 'PALMAS' where id = 1;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.cob', public.honorarios_cobranca_salvar(null, jsonb_build_object(
  'empresa_id', current_setting('testes.empresa_a'), 'descricao', 'Abertura de filial', 'vencimento', (current_date + 10)::text,
  'itens', jsonb_build_array(jsonb_build_object('descricao', 'Abertura de filial', 'quantidade', 1, 'valor_unitario', 500,
    'categoria_id', (select id from public.escritorio_categorias where chave = 'SERV_SOCIETARIO')))))::text, true);
select public.honorarios_cobrancas_aprovar(array[current_setting('testes.cob')::uuid]);
reset role;

select is((select count(*) from public.jobs where tipo = 'pix_banco' and payload ->> 'acao' = 'criar' and payload ->> 'cobranca_id' = current_setting('testes.cob'))::int, 1,
  'enviar a cobrança agenda a criação no banco');

-- O servidor registra a cobrança criada no banco e o Pix dinâmico
select public.honorarios_banco_registrar_cobranca(current_setting('testes.cob')::uuid, 'HON2026000001ABCDEF12345678', '000201dinamico', 'ativa', null);
select is((select banco_situacao || '|' || banco_pix from public.honorarios_cobrancas where id = current_setting('testes.cob')::uuid), 'ativa|000201dinamico', 'Pix do banco guardado');

-- Pagamento confirmado pelo banco com 3 dias de atraso e encargos
update public.honorarios_cobrancas set vencimento = current_date - 3 where id = current_setting('testes.cob')::uuid;
select is((public.honorarios_banco_baixar(current_setting('testes.cob')::uuid, 512.00, current_date, 'E2E123') ->> 'multa')::numeric, 10.00, 'separa a multa (2% de 500)');
select results_eq(
  format($$select situacao, forma_pagamento, banco_situacao, banco_e2e from public.honorarios_cobrancas where id = '%s'$$, current_setting('testes.cob')),
  $$values ('paga'::text, 'pix'::text, 'concluida'::text, 'E2E123'::text)$$, 'paga pelo banco, com o identificador do Pix');
select results_eq(
  format($$select c.chave, l.valor from public.escritorio_lancamentos l join public.escritorio_categorias c on c.id = l.categoria_id where l.cobranca_id = '%s' order by c.codigo$$, current_setting('testes.cob')),
  $$values ('SERV_SOCIETARIO'::text, 500.00::numeric), ('JUROS_MULTA', 12.00)$$, 'serviço e encargos na DRE');
select is((public.honorarios_banco_baixar(current_setting('testes.cob')::uuid, 512.00, current_date, 'E2E123') ->> 'ignorada')::boolean, true, 'a mesma confirmação não dá baixa duas vezes');

-- O servidor emite o recibo da baixa automática
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select ok((select id from public.recibo_emitir(jsonb_build_object('empresa_id', current_setting('testes.empresa_a'), 'valor', '512.00', 'data_recibo', current_date::text))) is not null,
  'o servidor emite o recibo');

-- Cancelar uma cobrança criada no banco agenda a remoção
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.cob2', public.honorarios_cobranca_salvar(null, jsonb_build_object(
  'empresa_id', current_setting('testes.empresa_a'), 'descricao', 'Certidão', 'vencimento', (current_date + 5)::text,
  'itens', jsonb_build_array(jsonb_build_object('descricao', 'Certidão', 'quantidade', 1, 'valor_unitario', 80,
    'categoria_id', (select id from public.escritorio_categorias where chave = 'SERV_AVULSO')))))::text, true);
select public.honorarios_cobrancas_aprovar(array[current_setting('testes.cob2')::uuid]);
reset role;
select public.honorarios_banco_registrar_cobranca(current_setting('testes.cob2')::uuid, 'HON2026000002ABCDEF12345678', '000201dinamico2', 'ativa', null);
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.honorarios_cobranca_cancelar(current_setting('testes.cob2')::uuid, 'Cliente desistiu');
reset role;
select is((select count(*) from public.jobs where tipo = 'pix_banco' and payload ->> 'acao' = 'remover' and payload ->> 'txid' = 'HON2026000002ABCDEF12345678')::int, 1,
  'cancelar agenda a remoção no banco');

-- O navegador não lê as credenciais
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$select * from public.honorarios_banco_segredo$$, '42501', null, 'credenciais do banco não são lidas pelo navegador');
reset role;

select * from finish();
rollback;
