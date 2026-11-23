-- NF-e com GTA (Guia de Trânsito Animal): a operação "Venda de gado" só emite com
-- o número da GTA; formato, repetição e estado conferidos no banco; a regra
-- própria do produto também exige; operação comum continua sem GTA.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

\ir 00_setup.sql.inc

insert into public.nfe_emitentes (id, empresa_id, nome, inscricao_estadual, logradouro, numero, bairro, municipio_ibge, cep, serie)
values ('0f000000-0000-0000-0000-00000000007a', current_setting('testes.empresa_a')::uuid, 'Fazenda Boa Vista', '290000000', 'Rodovia TO-050', 'km 10', 'Zona rural', '1718204', '77500000', 1);

-- Equipe: operação de gado (exige GTA) e venda comum
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": false, "crt": 1, "presenca": 9}'::jsonb)$$,
  'equipe configura a emissão');
select set_config('testes.op_gado', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda de gado — dentro do Tocantins",
  "natureza": "VENDA DE GADO BOVINO", "destino": "interna", "cfop": "5101", "icms_cst": "400", "pis_cst": "49", "cofins_cst": "49",
  "incide_funrural": true, "exige_gta": true}'::jsonb)::text, true);
select is((select exige_gta from public.nfe_operacoes where id = current_setting('testes.op_gado')::uuid), true, 'a operação guarda que exige a GTA');
select set_config('testes.op_comum', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda de milho",
  "natureza": "VENDA DE PRODUCAO", "destino": "interna", "cfop": "5101", "icms_cst": "400", "pis_cst": "49", "cofins_cst": "49"}'::jsonb)::text, true);
select is((select exige_gta from public.nfe_operacoes where id = current_setting('testes.op_comum')::uuid), false, 'sem marcar, a operação não exige GTA');
select set_config('testes.boi', public.nfe_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "BOI", "descricao": "Bovino vivo para abate", "ncm": "01022990", "unidade": "CB"}'::jsonb)::text, true);
select set_config('testes.milho', public.nfe_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "MILHO", "descricao": "Milho em grãos", "ncm": "10059010", "unidade": "SC"}'::jsonb)::text, true);
select set_config('testes.frigo', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cpf", "documento": "529.982.247-25",
  "nome": "Comprador de Porto Nacional", "indicador_ie": 9, "logradouro": "Rua B", "numero": "10", "bairro": "Centro", "municipio_ibge": "1718204"}'::jsonb)::text, true);
reset role;

-- Empresário (titular) emite
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.pedido', jsonb_build_object(
  'emitente_id', '0f000000-0000-0000-0000-00000000007a', 'operacao_id', current_setting('testes.op_gado'), 'destinatario_id', current_setting('testes.frigo'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.boi'), 'quantidade', '20', 'valor_unitario', '3150')),
  'transporte', jsonb_build_object('modalidade', 1), 'pagamento', jsonb_build_object('forma', '17'))::text, true);

select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.pedido')),
  '%Informe o número da GTA%', 'venda de gado sem GTA: a nota não sai');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || '{"gtas": [{"numero": "  ", "serie": "A"}]}'),
  '%Informe o número da GTA%', 'linha de GTA vazia não conta como GTA');
select is(public.nfe_previa(current_setting('testes.empresa_a')::uuid,
  current_setting('testes.pedido')::jsonb || '{"gtas": [{"numero": "123.456-7", "serie": "b"}, {"numero": "998877", "uf": "go"}]}') -> 'gtas',
  '[{"uf": "TO", "serie": "B", "numero": "1234567"}, {"uf": "GO", "serie": null, "numero": "998877"}]'::jsonb,
  'GTAs limpas (sem pontos e traços), série em maiúscula e o estado de quem emite quando não vem outro');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || '{"gtas": [{"numero": "123456"}, {"numero": "123.456"}]}'),
  '%GTA 123456 foi informada duas vezes%', 'a mesma GTA duas vezes é recusada');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || '{"gtas": [{"numero": "12#45"}]}'),
  '%Número da GTA inválido%', 'número com caractere estranho é recusado');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || '{"gtas": [{"numero": "123456", "serie": "ABCDEFG"}]}'),
  '%Série da GTA 123456 inválida%', 'série comprida demais é recusada');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || '{"gtas": [{"numero": "123456", "uf": "XX"}]}'),
  '%Estado da GTA 123456 inválido%', 'estado que não existe é recusado');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || jsonb_build_object('gtas', (select jsonb_agg(jsonb_build_object('numero', n::text)) from generate_series(1, 11) n))),
  '%no máximo 10 GTAs%', 'no máximo 10 GTAs por nota');
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'),
  current_setting('testes.pedido')::jsonb || '{"gtas": "123456"}'),
  '%GTAs em lista%', 'GTA fora de lista é recusada');

-- Operação comum: sem GTA tudo bem; com GTA, ela vai junto
select set_config('testes.pedido_milho', (current_setting('testes.pedido')::jsonb || jsonb_build_object('operacao_id', current_setting('testes.op_comum'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.milho'), 'quantidade', '100', 'valor_unitario', '62.5'))))::text, true);
select is(public.nfe_previa(current_setting('testes.empresa_a')::uuid, current_setting('testes.pedido_milho')::jsonb) -> 'gtas', '[]'::jsonb,
  'operação que não exige: a nota sai sem GTA');
reset role;

-- Regra própria do produto exige GTA: numa nota com a operação comum, o boi pede a GTA
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.nfe_produtos_definir_operacao(%L, %L, array[%L::uuid])$$,
  current_setting('testes.empresa_a'), current_setting('testes.op_gado'), current_setting('testes.boi')), 'o boi passa a usar a operação de gado como regra própria');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.nfe_previa(%L, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.pedido_milho')::jsonb
  || jsonb_build_object('itens', jsonb_build_array(
       jsonb_build_object('produto_id', current_setting('testes.milho'), 'quantidade', '100', 'valor_unitario', '62.5'),
       jsonb_build_object('produto_id', current_setting('testes.boi'), 'quantidade', '1', 'valor_unitario', '3150')))),
  '%Informe o número da GTA%', 'produto com regra própria que exige GTA: a nota mista também pede');
-- O empresário não muda a operação (só a equipe configura)
select throws_ok(format($$select public.nfe_operacao_salvar(%L, %L, '{"nome": "Venda de gado", "natureza": "VENDA DE GADO BOVINO", "destino": "interna",
  "cfop": "5101", "icms_cst": "400", "pis_cst": "49", "cofins_cst": "49", "exige_gta": false}')$$, current_setting('testes.empresa_a'), current_setting('testes.op_gado')),
  '42501', null, 'o empresário não tira a exigência da GTA');
reset role;

select * from finish();
rollback;
