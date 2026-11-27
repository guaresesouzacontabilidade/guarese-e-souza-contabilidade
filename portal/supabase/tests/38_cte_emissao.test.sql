-- Emissão de CT-e pelo portal: permissões (emitir: titular; configurar: só a
-- equipe), configuração (certificado, estabelecimento, RNTRC, operação e
-- autorização do cliente), operações do frete, montagem dos dados com as
-- regras da operação (não do pedido), numeração, pedido repetido, cancelamento
-- e carta de correção (só autorizado), cadastro compartilhado com a NF-e e
-- isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(28);

\ir 00_setup.sql.inc

-- 1. Permissões padrão
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select ok(app.pode(current_setting('testes.empresa_a')::uuid, 'cte.emitir'), 'o empresário emite CT-e por padrão');
select ok(not app.pode(current_setting('testes.empresa_a')::uuid, 'cte.configurar'), 'o empresário não configura a emissão de CT-e');
select throws_ok($$select public.cte_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": false}'::jsonb)$$, '42501', null,
  'cliente não configura a emissão de CT-e');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like($$select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b3',
  'cliente_colaborador', array['empresa.ver', 'cte.configurar'])$$, '%exclusivas da equipe%', 'configurar o CT-e não pode ser dado a cliente');
reset role;

-- 2. Escritório: estabelecimento (cadastro da NF-e), operações e configuração
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.emitente', public.nfe_emitente_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Matriz", "inscricao_estadual": "13.123.456-7",
  "logradouro": "Rodovia BR-163", "numero": "KM 740", "bairro": "Distrito Industrial", "municipio_ibge": "5107925", "cep": "78890-000", "serie": 1}'::jsonb)::text, true);
select lives_ok($$select public.cte_configurar(current_setting('testes.empresa_a')::uuid, jsonb_build_object('ativa', false, 'crt', 3,
  'emitente_id', current_setting('testes.emitente'), 'serie', 1, 'rntrc', '1234567'))$$, 'equipe configura o CT-e (desligado)');
select is((select rntrc from public.cte_config where empresa_id = current_setting('testes.empresa_a')::uuid), '01234567', 'RNTRC com 8 números');
select throws_like($$select public.cte_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Frete", "natureza": "Prestação de serviço de transporte",
  "destino": "interestadual", "cfop": "6353", "icms_cst": "00", "icms_aliquota": 12}'::jsonb)$$, '%classificação do IBS/CBS%',
  'a operação do frete exige a classificação do IBS/CBS');
select throws_like($$select public.cte_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Frete", "natureza": "Prestação de serviço de transporte",
  "destino": "interestadual", "cfop": "6353", "icms_cst": "sn", "ibscbs_cclass_trib": "000001"}'::jsonb)$$, '%fora do Simples%',
  'regime normal não usa o ICMS do Simples');
select throws_ok($$select public.cte_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Frete", "natureza": "Prestação de serviço de transporte",
  "destino": "interestadual", "cfop": "5353", "icms_cst": "00", "icms_aliquota": 12, "ibscbs_cclass_trib": "000001"}'::jsonb)$$, '23514', null,
  'CFOP precisa combinar com o destino (6.xxx para outro estado)');
select set_config('testes.op_inter', public.cte_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Frete de grãos para outro estado",
  "natureza": "Prestação de serviço de transporte", "destino": "interestadual", "cfop": "6353", "icms_cst": "90", "icms_aliquota": 12,
  "icms_credito_presumido": 20, "ibscbs_cclass_trib": "000001"}'::jsonb)::text, true);
select set_config('testes.op_interna', public.cte_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Frete dentro de MT",
  "natureza": "Prestação de serviço de transporte", "destino": "interna", "cfop": "5353", "icms_cst": "00", "icms_aliquota": 12,
  "ibscbs_cclass_trib": "000001"}'::jsonb)::text, true);
select throws_like($$select public.cte_configurar(current_setting('testes.empresa_a')::uuid, jsonb_build_object('ativa', true, 'crt', 3,
  'emitente_id', current_setting('testes.emitente'), 'rntrc', '01234567', 'autorizacao_texto', 'Autorização do sócio por e-mail'))$$, '%certificado digital%',
  'sem certificado a emissão não liga');
reset role;

-- 3. Clientes do frete (cadastro compartilhado): o titular cadastra
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.rem', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cnpj", "documento": "12.345.678/0001-95",
  "nome": "Comercial de Grãos Exemplo", "indicador_ie": 1, "inscricao_estadual": "13.999.999-0", "logradouro": "Rodovia MT-242", "numero": "KM 5",
  "bairro": "Zona Rural", "municipio_ibge": "5107925", "cep": "78890-000"}'::jsonb)::text, true);
select set_config('testes.dest_go', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cnpj", "documento": "11.222.333/0001-81",
  "nome": "Trading Exemplo", "indicador_ie": 1, "inscricao_estadual": "10.123.456-7", "logradouro": "Av. Presidente Vargas", "numero": "100",
  "bairro": "Centro", "municipio_ibge": "5218805", "cep": "75901-000"}'::jsonb)::text, true);
select set_config('testes.dest_mt', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cpf", "documento": "529.982.247-25",
  "nome": "Produtor Vizinho", "indicador_ie": 9, "logradouro": "Estrada Vicinal", "numero": "SN", "bairro": "Zona Rural", "municipio_ibge": "5103403"}'::jsonb)::text, true);
select throws_like($$select public.cte_emitir(current_setting('testes.empresa_a')::uuid, '{}'::jsonb)$$, '%ainda não foi ligada%',
  'sem a emissão ligada, o CT-e não é aceito');
reset role;

-- 4. Liga a emissão (certificado + autorização do cliente)
insert into public.certificados_digitais (empresa_id, titular, documento, impressao_digital, valido_de, valido_ate, autorizacao, autorizacao_texto)
values (current_setting('testes.empresa_a')::uuid, 'EMPRESA A COMERCIO LTDA', '11444777000161', repeat('EF', 32),
        now() - interval '1 day', now() + interval '300 days', 'autorizacao_escrita', 'Autorização escrita do sócio (teste)');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.cte_configurar(current_setting('testes.empresa_a')::uuid, jsonb_build_object('ativa', true, 'crt', 3, 'ambiente', 'homologacao',
  'emitente_id', current_setting('testes.emitente'), 'serie', 1, 'rntrc', '01234567', 'autorizacao_texto', 'Autorização do sócio por e-mail em 22/10/2026'))$$,
  'com certificado, estabelecimento, RNTRC, operação e autorização a emissão liga');
reset role;

-- 5. Pedido do empresário: regras da operação, número reservado e resumo
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.cte1', (public.cte_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'operacao_id', current_setting('testes.op_inter'), 'tomador', 'remetente', 'remetente_id', current_setting('testes.rem'), 'destinatario_id', current_setting('testes.dest_go'),
  'valor_prestacao', '4500', 'componentes', jsonb_build_array(jsonb_build_object('nome', 'frete peso', 'valor', '4000'), jsonb_build_object('nome', 'pedagio', 'valor', '500')),
  'icms', jsonb_build_object('cst', '40'),
  'carga', jsonb_build_object('produto', 'SOJA EM GRAOS', 'peso_kg', '36020', 'valor', '77142.83'),
  'nfes', jsonb_build_array('51261055777088000144550010000000011234567890'),
  'origem', jsonb_build_object('ordem_numero', 1)
)) ->> 'id'), true);
select is((select numero::int from public.cte_emissoes where id = current_setting('testes.cte1')::uuid), 1, 'primeiro número da série do CT-e');
select is((select dados #>> '{icms,cst}' || '/' || (dados #>> '{icms,aliquota}')::numeric::int || '/' || (dados #>> '{icms,creditoPresumido}')::numeric::int
  || '/' || (dados #>> '{ibscbs,classificacao}') from public.cte_emissoes where id = current_setting('testes.cte1')::uuid), '90/12/20/000001',
  'ICMS e IBS/CBS vêm da operação, não do pedido');
select is((select (tomador_nome, uf_inicio, uf_fim, valor_total, peso_kg, nfe_chaves[1], dados #>> '{tomador,papel}', dados ->> 'rntrc')::text
  from public.cte_emissoes where id = current_setting('testes.cte1')::uuid),
  '("Comercial de Grãos Exemplo",MT,GO,4500.00,36020.0000,51261055777088000144550010000000011234567890,0,01234567)',
  'resumo: tomador remetente, frete de MT para GO, valor, peso, NF-e e RNTRC');
select is((select dados #>> '{componentes,0,nome}' from public.cte_emissoes where id = current_setting('testes.cte1')::uuid), 'FRETE PESO', 'componentes em maiúsculas');
select throws_ok($$select public.cte_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'operacao_id', current_setting('testes.op_inter'), 'tomador', 'destinatario', 'remetente_id', current_setting('testes.rem'), 'destinatario_id', current_setting('testes.dest_go'),
  'valor_prestacao', '4500', 'carga', jsonb_build_object('produto', 'SOJA', 'peso_kg', '36020'),
  'nfes', jsonb_build_array('51261055777088000144550010000000011234567890')))$$, 'P0002', null, 'CT-e repetido para a mesma NF-e é barrado');
select throws_like($$select public.cte_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'operacao_id', current_setting('testes.op_inter'), 'tomador', 'remetente', 'remetente_id', current_setting('testes.rem'), 'destinatario_id', current_setting('testes.dest_go'),
  'valor_prestacao', '4500', 'componentes', jsonb_build_array(jsonb_build_object('nome', 'frete', 'valor', '4000')),
  'carga', jsonb_build_object('produto', 'SOJA', 'peso_kg', '1'), 'nfes', jsonb_build_array('51261055777088000144550010000000021234567891')))$$,
  '%soma dos componentes%', 'componentes precisam somar o valor do frete');
select throws_like($$select public.cte_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'operacao_id', current_setting('testes.op_inter'), 'tomador', 'remetente', 'remetente_id', current_setting('testes.rem'), 'destinatario_id', current_setting('testes.dest_mt'),
  'valor_prestacao', '100', 'carga', jsonb_build_object('produto', 'MILHO', 'peso_kg', '1000'), 'nfes', jsonb_build_array('51261055777088000144550010000000031234567892')))$$,
  '%para outro estado, mas o frete começa e termina em MT%', 'operação para outro estado com frete dentro de MT é recusada');
select throws_like($$select public.cte_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'operacao_id', current_setting('testes.op_interna'), 'tomador', 'remetente', 'remetente_id', current_setting('testes.rem'), 'destinatario_id', current_setting('testes.dest_mt'),
  'valor_prestacao', '100', 'carga', jsonb_build_object('produto', 'MILHO', 'peso_kg', '1000'), 'nfes', jsonb_build_array('12345')))$$,
  '%Chave de NF-e inválida%', 'chave de NF-e precisa de 44 números (modelo 55)');
select throws_like($$select public.cte_cancelar(current_setting('testes.cte1')::uuid, 'Frete desfeito pelo tomador do serviço')$$, '%autorizado%',
  'só CT-e autorizado pode ser cancelado');
select throws_like($$select public.cte_carta_correcao(current_setting('testes.cte1')::uuid, '[{"grupo": "compl", "campo": "xObs", "valor": "Placa ABC1D23"}]'::jsonb)$$,
  '%autorizado%', 'carta de correção só para CT-e autorizado');
reset role;

-- 6. Carta de correção não mexe em valores nem no tomador (CT-e autorizado simulado)
update public.cte_emissoes set situacao = 'autorizada', chave = '51261011444777000161570010000000011' || codigo_numerico || '0',
       protocolo = '151260000000001', xml_autorizado = '<cteProc/>' where id = current_setting('testes.cte1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like($$select public.cte_carta_correcao(current_setting('testes.cte1')::uuid, '[{"grupo": "vPrest", "campo": "vTPrest", "valor": "100"}]'::jsonb)$$,
  '%não pode ser corrigido%', 'valor do frete não se corrige por carta');
select lives_ok($$select public.cte_carta_correcao(current_setting('testes.cte1')::uuid, '[{"grupo": "compl", "campo": "xObs", "valor": "Placa do caminhão QBA1C23"}]'::jsonb)$$,
  'observação corrigida por carta de correção');
reset role;

-- 7. Quem já emitia CT-e em outro programa continua a numeração (que só anda para a frente)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.cte_configurar(current_setting('testes.empresa_a')::uuid, jsonb_build_object('ativa', true, 'crt', 3, 'ambiente', 'homologacao',
  'emitente_id', current_setting('testes.emitente'), 'serie', 1, 'rntrc', '01234567', 'proximo_numero_homologacao', 1500, 'proximo_numero_producao', 820));
select is((select proximo_numero_homologacao || '/' || proximo_numero_producao from public.cte_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  '1500/820', 'o escritório informa o próximo número de cada ambiente');
select public.cte_configurar(current_setting('testes.empresa_a')::uuid, jsonb_build_object('ativa', true, 'crt', 3, 'ambiente', 'homologacao',
  'emitente_id', current_setting('testes.emitente'), 'serie', 1, 'rntrc', '01234567', 'proximo_numero_homologacao', 2, 'proximo_numero_producao', 1));
select is((select proximo_numero_homologacao || '/' || proximo_numero_producao from public.cte_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  '1500/820', 'número já passado não volta');
reset role;

-- 8. Isolamento
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.cte_emissoes) + (select count(*)::int from public.cte_operacoes) + (select count(*)::int from public.cte_config), 0,
  'cliente de outra empresa não vê CT-e, operações nem configuração');
select throws_ok(format($$select public.cte_cancelar(%L, 'Tentativa de outra empresa qualquer')$$, current_setting('testes.cte1')), '42501', null,
  'cliente de outra empresa não cancela o CT-e');
reset role;

select * from finish();
rollback;
