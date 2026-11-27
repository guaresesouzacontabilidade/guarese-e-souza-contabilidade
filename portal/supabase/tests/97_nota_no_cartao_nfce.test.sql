-- Nota fiscal na venda: operações para NF-e e/ou cupom (NFC-e), a regra do
-- escritório "exigir nota no cartão" (só o escritório muda; o banco recusa a
-- venda no cartão sem nota), o cupom ligado pelo escritório com série e
-- numeração próprias e a emissão da nota da venda por quem vende no caixa
-- (sem acesso às outras notas). Dados fictícios.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(33);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio", "permitir_estoque_negativo": true}');
reset role;
-- b2: só vende no caixa (sem emitir notas pela tela de notas)
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
insert into public.certificados_digitais (empresa_id, titular, documento, impressao_digital, valido_de, valido_ate, autorizacao, autorizacao_texto)
values (current_setting('testes.empresa_a')::uuid, 'EMPRESA A COMERCIO LTDA', '11444777000161', repeat('EF', 32),
        now() - interval '1 day', now() + interval '300 days', 'autorizacao_escrita', 'Autorização escrita do sócio (teste)');

-- Escritório: Simples Nacional, inscrição, operação da NF-e e operação do cupom
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": false, "crt": 1, "presenca": 1}'::jsonb);
select set_config('testes.emitente', public.nfe_emitente_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Loja", "inscricao_estadual": "13.123.456-7",
  "logradouro": "Avenida Central", "numero": "100", "bairro": "Centro", "municipio_ibge": "5100201", "cep": "78635-000", "serie": 1}'::jsonb)::text, true);
select set_config('testes.op_nfe', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda no balcão (NF-e)",
  "natureza": "Venda de mercadoria", "destino": "interna", "consumidor_final": true, "cfop": "5102", "icms_cst": "102", "pis_cst": "49", "cofins_cst": "49"}'::jsonb)::text, true);
select is((select modelos::text from public.nfe_operacoes where id = current_setting('testes.op_nfe')::uuid), '{nfe}', 'operação nova serve para Nota fiscal (NF-e)');
select throws_like($$select public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda para outro estado", "natureza": "Venda",
  "destino": "interestadual", "cfop": "6102", "icms_cst": "102", "pis_cst": "49", "cofins_cst": "49", "modelos": ["nfce"]}'::jsonb)$$,
  '%só para venda dentro do estado%', 'cupom fiscal não serve para venda a outro estado');
select set_config('testes.op_nfce', public.nfe_operacao_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Venda no balcão (cupom)",
  "natureza": "Venda de mercadoria", "destino": "interna", "consumidor_final": true, "cfop": "5102", "icms_cst": "102", "pis_cst": "49", "cofins_cst": "49",
  "modelos": ["nfce"]}'::jsonb)::text, true);
select is((select modelos::text from public.nfe_operacoes where id = current_setting('testes.op_nfce')::uuid), '{nfce}', 'operação do cupom fiscal');
select public.nfe_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "crt": 1, "ambiente": "homologacao",
  "autorizacao_texto": "Autorização do sócio por e-mail em 20/10/2026"}'::jsonb);
reset role;

-- O dono da loja escolhe a operação do cupom, mas não mexe na regra do cartão
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prod', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "CAFE-1", "descricao": "Café torrado 500 g", "ncm": "09012100", "unidade": "UN", "valor_unitario": 80}')::text, true);
select throws_like(format($$select public.gestao_configurar(%L, jsonb_build_object('nfce_operacao_id', %L))$$,
  current_setting('testes.empresa_a'), current_setting('testes.op_nfe')), '%não serve para Cupom fiscal%', 'operação só de NF-e não vira operação do cupom');
select lives_ok(format($$select public.gestao_configurar(%L, jsonb_build_object('nfce_operacao_id', %L, 'nfe_operacao_id', %L, 'documento_padrao', 'nfce',
  'nota_obrigatoria_formas', '[]'::jsonb))$$, current_setting('testes.empresa_a'), current_setting('testes.op_nfce'), current_setting('testes.op_nfe')),
  'o dono escolhe as operações e o documento padrão');
select throws_ok(format($$select public.gestao_configurar(%L, '{"nota_obrigatoria_formas": ["cartao_credito"]}'::jsonb)$$, current_setting('testes.empresa_a')),
  '42501', null, 'o dono não liga a regra da nota no cartão');
select throws_ok(format($$select public.nfce_configurar(%L, '{"ativa": true}'::jsonb)$$, current_setting('testes.empresa_a')),
  '42501', null, 'o dono não liga o cupom fiscal');
reset role;

-- O escritório liga a regra (crédito e débito)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.gestao_configurar(%L, '{"nota_obrigatoria_formas": ["pix"]}'::jsonb)$$, current_setting('testes.empresa_a')),
  '%só para cartão%', 'a regra vale só para cartão');
select lives_ok(format($$select public.gestao_configurar(%L, '{"nota_obrigatoria_formas": ["cartao_debito", "cartao_credito"]}'::jsonb)$$, current_setting('testes.empresa_a')),
  'o escritório liga a regra no crédito e no débito');
reset role;
select is((select nota_obrigatoria_formas::text from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  '{cartao_credito,cartao_debito}', 'regra gravada');

-- Caixa: sem o cupom ligado, venda no cartão precisa da NF-e; dinheiro vende sem nota
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 0)::text, true);
select is(public.gestao_documentos_fiscais(current_setting('testes.empresa_a')::uuid) #>> '{nfce,motivo}',
  'O cupom fiscal (NFC-e) desta empresa ainda não foi ligado pelo escritório.', 'o caixa sabe que o cupom ainda está desligado e por quê');
select set_config('testes.venda_base', jsonb_build_object('sessao_id', current_setting('testes.caixa'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.prod'), 'quantidade', 1)))::text, true);
select throws_like(format($$select public.gestao_venda_finalizar(%L, %L::jsonb || '{"pagamentos": [{"forma": "cartao_credito", "valor": 80}]}'::jsonb)$$,
  current_setting('testes.empresa_a'), current_setting('testes.venda_base')), '%sai com nota fiscal%', 'cartão sem nota é recusado');
select lives_ok(format($$select public.gestao_venda_finalizar(%L, %L::jsonb || '{"pagamentos": [{"forma": "dinheiro", "valor": 80}]}'::jsonb)$$,
  current_setting('testes.empresa_a'), current_setting('testes.venda_base')), 'dinheiro vende sem nota');
select throws_like(format($$select public.gestao_venda_finalizar(%L, %L::jsonb || '{"documento_fiscal": "nfce", "pagamentos": [{"forma": "cartao_debito", "valor": 80}]}'::jsonb)$$,
  current_setting('testes.empresa_a'), current_setting('testes.venda_base')), '%ainda não foi ligado%', 'cupom desligado não é aceito');
select throws_like(format($$select public.gestao_venda_finalizar(%L, %L::jsonb || '{"documento_fiscal": "nfe", "pagamentos": [{"forma": "cartao_debito", "valor": 80}]}'::jsonb)$$,
  current_setting('testes.empresa_a'), current_setting('testes.venda_base')), '%cliente com CPF ou CNPJ%', 'NF-e pede o cliente cadastrado');
reset role;

-- O escritório liga o cupom: precisa da série do cupom na inscrição
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.nfce_configurar(%L, '{"ativa": true}'::jsonb)$$, current_setting('testes.empresa_a')),
  '%série do cupom%', 'sem a série do cupom, ele não liga');
select public.nfe_emitente_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.emitente')::uuid, '{"nome": "Loja", "inscricao_estadual": "131234567",
  "logradouro": "Avenida Central", "numero": "100", "bairro": "Centro", "municipio_ibge": "5100201", "cep": "78635000", "serie": 1, "nfce_serie": 1}'::jsonb);
select lives_ok(format($$select public.nfce_configurar(%L, '{"ativa": true, "ambiente": "homologacao"}'::jsonb)$$, current_setting('testes.empresa_a')),
  'com a série, o escritório liga o cupom (em homologação)');
select throws_like(format($$select public.nfe_operacao_salvar(%L, %L, '{"nome": "Venda no balcão (cupom)", "natureza": "Venda de mercadoria", "destino": "interna",
  "consumidor_final": true, "cfop": "5102", "icms_cst": "102", "pis_cst": "49", "cofins_cst": "49", "modelos": ["nfe"]}'::jsonb)$$,
  current_setting('testes.empresa_a'), current_setting('testes.op_nfce')), '%operação do cupom fiscal nas configurações da loja%',
  'a operação escolhida na loja não perde a opção Cupom fiscal');
reset role;

-- Venda no cartão com cupom e a nota dela emitida por quem está no caixa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select ok((public.gestao_documentos_fiscais(current_setting('testes.empresa_a')::uuid) #>> '{nfce,disponivel}')::boolean, 'agora o cupom está disponível no caixa');
select throws_like(format($$select public.gestao_venda_finalizar(%L, %L::jsonb || '{"documento_fiscal": "nfce", "frete": 10, "pagamentos": [{"forma": "cartao_debito", "valor": 90}]}'::jsonb)$$,
  current_setting('testes.empresa_a'), current_setting('testes.venda_base')), '%frete não sai em cupom%', 'cupom não leva frete');
select set_config('testes.venda', (public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, current_setting('testes.venda_base')::jsonb
  || '{"documento_fiscal": "nfce", "cliente_documento": "529.982.247-25", "cliente_nome": "Consumidor Exemplo",
       "pagamentos": [{"forma": "cartao_credito", "valor": 50}, {"forma": "dinheiro", "valor": 30, "valor_recebido": 50}]}'::jsonb) ->> 'id'), true);
select is((select documento_fiscal from public.vendas where id = current_setting('testes.venda')::uuid), 'nfce', 'a venda guarda o documento pedido');
select set_config('testes.nota', public.gestao_venda_emitir_nota(current_setting('testes.venda')::uuid, 'nfce')::text, true);
select is((current_setting('testes.nota')::jsonb ->> 'modelo') || '/' || (current_setting('testes.nota')::jsonb ->> 'serie') || '/' || (current_setting('testes.nota')::jsonb ->> 'numero'),
  '65/1/1', 'cupom modelo 65, série do cupom, número 1');
select throws_like(format($$select public.gestao_venda_emitir_nota(%L, 'nfce')$$, current_setting('testes.venda')), '%a caminho da SEFAZ%',
  'a mesma venda não gera dois cupons');
select is((select count(*)::int from public.nfe_emissoes), 0, 'quem só vende não vê a lista de notas da empresa');
select is(public.gestao_venda_nota(current_setting('testes.venda')::uuid) ->> 'situacao', 'na_fila', 'mas acompanha a nota da própria venda');
reset role;
select is((select dados ->> 'presenca' || '|' || (dados #>> '{consumidor,documento}') || '|' || (dados #>> '{pagamentos,0,forma}') || ':' || (dados #>> '{pagamentos,0,valor}')
               || '|' || (dados #>> '{pagamentos,1,forma}') || ':' || (dados #>> '{pagamentos,1,valor}') || '|' || (dados ->> 'troco')
          from public.nfe_emissoes where id = (current_setting('testes.nota')::jsonb ->> 'id')::uuid),
  '1|52998224725|03:50.00|01:50.00|20.00', 'presencial, CPF do consumidor, cartão e dinheiro recebido com o troco');
select is((select proximo_numero_homologacao::text || '/' || nfce_proximo_numero_homologacao::text from public.nfe_emitentes where id = current_setting('testes.emitente')::uuid),
  '1/2', 'a numeração da NF-e não anda com o cupom');
select is((select nfe_emissao_id::text from public.vendas where id = current_setting('testes.venda')::uuid), current_setting('testes.nota')::jsonb ->> 'id',
  'a venda fica ligada ao cupom');

-- Recusado pela SEFAZ: vai de novo com o mesmo número
update public.nfe_emissoes set situacao = 'rejeitada' where id = (current_setting('testes.nota')::jsonb ->> 'id')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is(public.gestao_venda_emitir_nota(current_setting('testes.venda')::uuid, 'nfce') ->> 'numero', '1', 'cupom recusado volta com o mesmo número');
select throws_like(format($$select public.gestao_venda_emitir_nota(%L, 'nfe')$$, current_setting('testes.venda')), '%a caminho da SEFAZ%',
  'enquanto o cupom está na fila, não sai NF-e da mesma venda');
reset role;

-- Cupom não tem carta de correção
update public.nfe_emissoes set situacao = 'autorizada', chave = '51261111444777000161650010000000011482137650', protocolo = '151260000000001',
       xml_autorizado = '<nfeProc/>' where id = (current_setting('testes.nota')::jsonb ->> 'id')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.nfe_carta_correcao(%L, 'Correção do nome do consumidor no cupom')$$, current_setting('testes.nota')::jsonb ->> 'id'),
  '%não tem carta de correção%', 'cupom fiscal não tem carta de correção');
reset role;

-- Outra empresa não vê nem emite
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.gestao_documentos_fiscais(%L)$$, current_setting('testes.empresa_a')), '42501', null,
  'outra empresa não vê os documentos da loja');
select throws_ok(format($$select public.gestao_venda_emitir_nota(%L, 'nfce')$$, current_setting('testes.venda')), '42501', null,
  'outra empresa não emite nota da venda');
reset role;

select * from finish();
rollback;
