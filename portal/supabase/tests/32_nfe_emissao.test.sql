-- Emissão de NF-e pelo portal: permissões, cadastros do escritório (inscrição/série,
-- operações com as regras fiscais, produtos), clientes, pedido com numeração,
-- regras copiadas da operação, correção de rejeitada, eventos, guias e isolamento.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(30);

\ir 00_setup.sql.inc

-- Titular emite por padrão; configurar é só da equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select ok(app.pode(current_setting('testes.empresa_a')::uuid, 'nfe.emitir'), 'o empresário emite NF-e por padrão');
select ok(not app.pode(current_setting('testes.empresa_a')::uuid, 'nfe.configurar'), 'o empresário não configura a emissão de NF-e');
select throws_ok($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{}'::jsonb)$$, '42501', null,
  'cliente não cadastra operações (regras fiscais)');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like($$select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b3',
  'cliente_colaborador', array['empresa.ver', 'nfe.configurar'])$$, '%exclusivas da equipe%', 'configurar a NF-e não pode ser dado a cliente');
reset role;

-- Equipe: regime normal, inscrição com série, operação e produto
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": false, "crt": 3, "presenca": 9}'::jsonb)$$,
  'equipe configura a emissão (desligada)');
select throws_like($$select public.nfe_emitente_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Matriz", "inscricao_estadual": "131234567",
  "logradouro": "Rodovia BR-158", "numero": "KM 10", "bairro": "Zona Rural", "municipio_ibge": "5100201", "cep": "78635000", "serie": 920}'::jsonb)$$,
  '%Série da NF-e inválida%', 'empresa (CNPJ) não usa a série do produtor pessoa física');
select set_config('testes.emitente', public.nfe_emitente_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Matriz", "inscricao_estadual": "13.123.456-7",
  "logradouro": "Rodovia BR-158", "numero": "KM 10", "bairro": "Zona Rural", "municipio_ibge": "5100201", "cep": "78635-000", "serie": 1}'::jsonb)::text, true);
select throws_like($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda", "natureza": "Venda", "destino": "interestadual",
  "cfop": "6102", "icms_cst": "00", "icms_aliquota": 12, "pis_cst": "08", "cofins_cst": "08"}'::jsonb)$$, '%classificação do IBS/CBS%',
  'regime normal exige a classificação do IBS/CBS');
select throws_like($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda", "natureza": "Venda", "destino": "interestadual",
  "cfop": "6102", "icms_cst": "102", "pis_cst": "08", "cofins_cst": "08", "ibscbs_cclass_trib": "200036"}'::jsonb)$$, '%usa CST%',
  'regime normal não usa CSOSN');
select throws_ok($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda", "natureza": "Venda", "destino": "interestadual",
  "cfop": "5102", "icms_cst": "00", "icms_aliquota": 12, "pis_cst": "08", "cofins_cst": "08", "ibscbs_cclass_trib": "200036"}'::jsonb)$$, '23514', null,
  'CFOP precisa combinar com o destino (6.xxx para outro estado)');
select set_config('testes.operacao', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda de milho para outro estado",
  "natureza": "Venda de mercadoria", "destino": "interestadual", "cfop": "6102", "icms_cst": "00", "icms_aliquota": 12, "pis_cst": "01", "pis_aliquota": 1.65,
  "cofins_cst": "01", "cofins_aliquota": 7.6, "ibscbs_cclass_trib": "200036", "icms_por_operacao": true, "frete_icms_retido": true, "frete_aliquota": 12,
  "frete_cfop": "6360", "contribuicoes": [{"nome": "FETHAB", "tipo": "upf_por_tonelada", "valor": 10, "valorUpf": 250.5, "ncms": ["1005"]}]}'::jsonb)::text, true);
select throws_like($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "X", "natureza": "X", "destino": "interna",
  "cfop": "5102", "icms_cst": "00", "icms_aliquota": 17, "pis_cst": "08", "cofins_cst": "08", "ibscbs_cclass_trib": "000001",
  "contribuicoes": [{"nome": "FETHAB", "tipo": "upf_por_tonelada", "valor": 10}]}'::jsonb)$$, '%valor da UPF%', 'contribuição por UPF exige o valor da UPF');
select set_config('testes.produto', public.nfe_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "MILHO", "descricao": "Milho em grãos", "ncm": "1005.90.10", "unidade": "kg", "peso_kg": 1}'::jsonb)::text, true);
reset role;

-- Cliente cadastra o comprador
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like($$select public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cnpj", "documento": "12.345.678/0001-95",
  "nome": "Granja Exemplo", "indicador_ie": 1, "logradouro": "Av. Presidente Vargas", "numero": "100", "bairro": "Centro", "municipio_ibge": "5218805"}'::jsonb)$$,
  '%inscrição estadual do cliente%', 'contribuinte do ICMS exige a inscrição estadual');
select set_config('testes.cliente_go', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cnpj", "documento": "12.345.678/0001-95",
  "nome": "Granja Exemplo", "indicador_ie": 1, "inscricao_estadual": "10.123.456-7", "logradouro": "Av. Presidente Vargas", "numero": "100", "bairro": "Centro",
  "municipio_ibge": "5218805", "cep": "75901-000", "email": "compras@granja.test"}'::jsonb)::text, true);
select set_config('testes.cliente_mt', public.nfe_destinatario_salvar(current_setting('testes.empresa_a')::uuid, null, '{"tipo": "cpf", "documento": "529.982.247-25",
  "nome": "Produtor Vizinho", "indicador_ie": 9, "logradouro": "Estrada Vicinal", "numero": "SN", "bairro": "Zona Rural", "municipio_ibge": "5103403"}'::jsonb)::text, true);
select throws_like($$select public.nfe_emitir(current_setting('testes.empresa_a')::uuid, '{}'::jsonb)$$, '%ainda não foi ligada%',
  'sem a emissão ligada, a nota não é aceita');
reset role;

-- Liga a emissão: exige certificado e a autorização do cliente
insert into public.certificados_digitais (empresa_id, titular, documento, impressao_digital, valido_de, valido_ate, autorizacao, autorizacao_texto)
values (current_setting('testes.empresa_a')::uuid, 'EMPRESA A COMERCIO LTDA', '11444777000161', repeat('CD', 32),
        now() - interval '1 day', now() + interval '300 days', 'autorizacao_escrita', 'Autorização escrita do sócio (teste)');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like($$select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "crt": 3}'::jsonb)$$, '%autorizou o portal%',
  'sem a autorização do cliente a emissão não liga');
select lives_ok($$select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "crt": 3, "ambiente": "homologacao",
  "autorizacao_texto": "Autorização do sócio por e-mail em 20/10/2026"}'::jsonb)$$, 'com certificado, inscrição, operação e autorização a emissão liga');
reset role;

-- Pedido do empresário: as regras fiscais vêm da operação (não do pedido) e o número é reservado
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.nota1', (public.nfe_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'emitente_id', current_setting('testes.emitente'), 'operacao_id', current_setting('testes.operacao'), 'destinatario_id', current_setting('testes.cliente_go'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.produto'), 'quantidade', '30000', 'valor_unitario', '1.15',
                                                'icms', jsonb_build_object('cst', '40'))),
  'transporte', jsonb_build_object('modalidade', 0, 'frete_servico', '4500', 'placa', 'abc-1d23', 'placa_uf', 'MT'),
  'pagamento', jsonb_build_object('forma', '15', 'a_prazo', true, 'parcelas', jsonb_build_array(jsonb_build_object('vencimento', '2026-11-20', 'valor', '34500.00')))
)) ->> 'id'), true);
select is((select numero::int from public.nfe_emissoes where id = current_setting('testes.nota1')::uuid), 1, 'primeiro número da série');
select is((select dados #>> '{itens,0,icms,cst}' || '/' || (dados #>> '{itens,0,icms,aliquota}')::numeric::int || '/' || (dados #>> '{itens,0,ibscbs,classificacao}')
  from public.nfe_emissoes where id = current_setting('testes.nota1')::uuid), '00/12/200036', 'CST, alíquota e classificação vêm da operação, não do pedido');
select is((select valor_total from public.nfe_emissoes where id = current_setting('testes.nota1')::uuid), 34500.00::numeric, 'total da nota');
select is((select dados #>> '{transporte,veiculo,placa}' || '|' || (dados #>> '{transporte,icmsFrete,valorServico}') || '|' || (dados #>> '{itens,0,quantidade}')
  from public.nfe_emissoes where id = current_setting('testes.nota1')::uuid), 'ABC1D23|4500|30000', 'placa, frete contratado e quantidade normalizados');
select throws_ok($$select public.nfe_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'emitente_id', current_setting('testes.emitente'), 'operacao_id', current_setting('testes.operacao'), 'destinatario_id', current_setting('testes.cliente_go'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.produto'), 'quantidade', '30000', 'valor_unitario', '1.15')),
  'transporte', jsonb_build_object('modalidade', 0, 'frete_servico', '4500')))$$, 'P0002', null, 'nota repetida por engano é barrada');
select throws_like($$select public.nfe_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'emitente_id', current_setting('testes.emitente'), 'operacao_id', current_setting('testes.operacao'), 'destinatario_id', current_setting('testes.cliente_mt'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.produto'), 'quantidade', '10', 'valor_unitario', '1')),
  'transporte', jsonb_build_object('modalidade', 0, 'frete_servico', '10')))$$, '%para outro estado, mas o cliente é de MT%',
  'operação para outro estado com cliente do mesmo estado é recusada');
select throws_like($$select public.nfe_cancelar(current_setting('testes.nota1')::uuid, 'Venda desfeita pelo cliente')$$, '%autorizada%',
  'só nota autorizada pode ser cancelada');
select throws_like($$select public.nfe_carta_correcao(current_setting('testes.nota1')::uuid, 'Placa correta do veículo ABC1D23')$$, '%autorizada%',
  'carta de correção só para nota autorizada');
reset role;
select is((select count(*)::int from public.jobs where tipo = 'emitir_nfe' and empresa_id = current_setting('testes.empresa_a')::uuid), 1,
  'a nota vira uma tarefa de emissão');

-- Rejeitada: corrigida e enviada de novo com o mesmo número
update public.nfe_emissoes set situacao = 'rejeitada', chave = '51261011444777000161550010000000011482137650' where id = current_setting('testes.nota1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.nfe_emitir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'emitente_id', current_setting('testes.emitente'), 'operacao_id', current_setting('testes.operacao'), 'destinatario_id', current_setting('testes.cliente_go'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.produto'), 'quantidade', '29000', 'valor_unitario', '1.15')),
  'transporte', jsonb_build_object('modalidade', 0, 'frete_servico', '4500')), current_setting('testes.nota1')::uuid) ->> 'numero')::int, 1,
  'a correção da rejeitada mantém o número');
select is((select situacao || '/' || coalesce(chave, 'sem chave') || '/' || valor_total from public.nfe_emissoes where id = current_setting('testes.nota1')::uuid),
  'na_fila/sem chave/33350.00', 'volta para a fila com os dados novos');
reset role;

-- Guias: só o escritório anexa ou dispensa
insert into public.nfe_guias (emissao_id, empresa_id, tipo, descricao, uf, valor, vencimento)
values (current_setting('testes.nota1')::uuid, current_setting('testes.empresa_a')::uuid, 'icms_operacao', 'ICMS da operação', 'MT', 4002, current_date);
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.nfe_guia_atualizar((select id from public.nfe_guias limit 1), 'dispensada', null, 'Regime especial')$$, '42501', null,
  'cliente não altera a guia');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like($$select public.nfe_guia_atualizar((select id from public.nfe_guias limit 1), 'gerada', null, null)$$, '%PDF da guia%',
  'guia gerada exige o PDF anexado');
reset role;

-- Colaborador sem a permissão e cliente de outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select public.nfe_emitir(current_setting('testes.empresa_a')::uuid, '{}'::jsonb)$$, '42501', null, 'colaborador sem permissão não emite');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.nfe_emissoes) + (select count(*)::int from public.nfe_operacoes) + (select count(*)::int from public.nfe_produtos)
  + (select count(*)::int from public.nfe_destinatarios) + (select count(*)::int from public.nfe_guias), 0,
  'cliente de outra empresa não vê notas, operações, produtos, clientes nem guias');
select ok((select count(*) from public.nfe_cclass_trib) > 100, 'a tabela oficial do IBS/CBS é pública para quem entra no portal');
reset role;

select * from finish();
rollback;
