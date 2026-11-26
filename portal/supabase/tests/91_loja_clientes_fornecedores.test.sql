-- Cadastro de clientes e fornecedores pela loja: quem gerencia cadastra e altera
-- os dois; quem só vende cadastra cliente novo e não vê fornecedores; o mesmo
-- CPF/CNPJ não se repete; cliente com endereço vira destinatário da NF-e (e o
-- endereço da NF-e volta ao cadastro); fornecedor da nota de compra entra no
-- cadastro; valores de compra só com "Ver custos e margens"; isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(30);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
select public.gestao_configurar(current_setting('testes.empresa_b')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;
-- Colaborador da empresa A: só vende
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';

-- Titular da empresa A (gerencia a loja)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.forn', public.gestao_contraparte_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'papel', 'fornecedor', 'nome', 'Serraria Boa Madeira', 'documento', '11.222.333/0001-81', 'telefone', '(63) 3215-0000',
  'contato', 'Carlos (vendas)', 'prazo_pagamento_dias', '28', 'inscricao_estadual', '290000017'))::text, true);
select is((select array[papeis::text, contato, prazo_pagamento_dias::text] from public.contrapartes where id = current_setting('testes.forn')::uuid),
  array['{fornecedor}', 'Carlos (vendas)', '28'], 'titular cadastra fornecedor com contato e prazo');
select set_config('testes.cli', public.gestao_contraparte_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'papel', 'cliente', 'nome', 'Maria Cliente', 'documento', '529.982.247-25', 'telefone', '63 99999-0000', 'email', 'Maria@Exemplo.com',
  'cep', '77000-000', 'logradouro', 'Rua 1', 'numero', '10', 'bairro', 'Centro', 'municipio_ibge', '1721000'))::text, true);
select is((select array[documento, email, logradouro, municipio_ibge] from public.contrapartes where id = current_setting('testes.cli')::uuid),
  array['52998224725', 'maria@exemplo.com', 'Rua 1', '1721000'], 'titular cadastra cliente com endereço');
select is((select array[nome, logradouro, indicador_ie::text] from public.nfe_destinatarios
            where empresa_id = current_setting('testes.empresa_a')::uuid and documento = '52998224725'),
  array['Maria Cliente', 'Rua 1', '9'], 'cliente com endereço completo vira destinatário da NF-e');
select throws_ok(format($$select public.gestao_contraparte_salvar(%L, null, '{"papel": "cliente", "nome": "Fulano", "documento": "123.456.789-00"}')$$,
  current_setting('testes.empresa_a')), 'P0001', 'CPF inválido. Confira os números.', 'CPF inválido é recusado');
select throws_ok(format($$select public.gestao_contraparte_salvar(%L, %L, '{"papel": "cliente", "nome": "Maria Cliente", "documento": "11222333000181"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.cli')), 'P0001', null, 'o mesmo CPF/CNPJ não se repete na empresa');
-- O fornecedor também compra: ganha o papel de cliente no mesmo cadastro
select is(public.gestao_contraparte_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'papel', 'cliente', 'nome', 'Serraria Boa Madeira', 'documento', '11222333000181'))::text, current_setting('testes.forn'),
  'mesmo CNPJ como cliente usa o cadastro que já existe');
select is((select papeis from public.contrapartes where id = current_setting('testes.forn')::uuid), array['fornecedor', 'cliente'],
  'o cadastro fica com os dois papéis');
select is((public.gestao_contraparte_ficha(current_setting('testes.empresa_a')::uuid, current_setting('testes.cli')::uuid, 'cliente') -> 'cadastro' ->> 'municipio'),
  'Palmas / TO', 'ficha do cliente traz o cadastro com o município');
select is((public.gestao_contraparte_ficha(current_setting('testes.empresa_a')::uuid, current_setting('testes.forn')::uuid, 'fornecedor') ->> 'mostra_valores')::boolean,
  true, 'titular (vê custos) vê os valores de compra na ficha do fornecedor');
-- Cliente sem endereço (o endereço vem depois, pela NF-e)
select set_config('testes.cli2', public.gestao_contraparte_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'papel', 'cliente', 'nome', 'João Sem Endereço', 'documento', '111.444.777-35'))::text, true);
reset role;

-- Endereço digitado na NF-e completa o cadastro
insert into public.nfe_destinatarios (empresa_id, tipo, documento, nome, indicador_ie, logradouro, numero, bairro, municipio_ibge, cep)
values (current_setting('testes.empresa_a')::uuid, 'cpf', '11144477735', 'João Sem Endereço', 9, 'Avenida JK', '200', 'Plano Diretor', '1721000', '77001000');
select is((select array[logradouro, numero, cep] from public.contrapartes where id = current_setting('testes.cli2')::uuid),
  array['Avenida JK', '200', '77001000'], 'endereço da NF-e entra no cadastro que não tinha');

-- Nota de compra (PDF) de um fornecedor novo: entra no cadastro como fornecedor
insert into public.estoque_notas_pdf (empresa_id, chave, numero, emitente_documento, emitente_nome, data_emissao, valor_total)
values (current_setting('testes.empresa_a')::uuid, repeat('1', 44), '123', '45997418000153', 'Ferragens Exemplo', current_date, 500);
select is((select papeis from public.contrapartes where empresa_id = current_setting('testes.empresa_a')::uuid and documento = '45997418000153'),
  array['fornecedor'], 'fornecedor da nota de compra entra no cadastro');

-- Colaborador que só vende
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select ok(public.gestao_contraparte_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'papel', 'cliente', 'nome', 'Cliente do Balcão', 'telefone', '63988887777')) is not null, 'quem vende cadastra cliente novo');
select throws_ok(format($$select public.gestao_contraparte_salvar(%L, null, '{"papel": "fornecedor", "nome": "Outro fornecedor"}')$$,
  current_setting('testes.empresa_a')), '42501', null, 'quem só vende não cadastra fornecedor');
select throws_ok(format($$select public.gestao_contraparte_salvar(%L, %L, '{"papel": "cliente", "nome": "Nome trocado"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.cli')), '42501', null, 'quem só vende não altera cadastro existente');
-- Mesmo CPF digitado no caixa: não troca o que já estava preenchido
select public.gestao_contraparte_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'papel', 'cliente', 'nome', 'Outro Nome', 'documento', '52998224725', 'telefone', '63911112222'));
select is((select array[nome, telefone] from public.contrapartes where id = current_setting('testes.cli')::uuid),
  array['Maria Cliente', '63999990000'], 'cadastro existente não é trocado por quem só vende');
select is((select count(*)::int from public.contrapartes where empresa_id = current_setting('testes.empresa_a')::uuid and 'cliente' = any(papeis)), 4,
  'quem vende vê os clientes');
select is((select count(*)::int from public.contrapartes where empresa_id = current_setting('testes.empresa_a')::uuid and not ('cliente' = any(papeis))), 0,
  'quem só vende não vê os fornecedores');
select throws_ok(format($$select public.gestao_contraparte_ficha(%L, %L, 'fornecedor')$$,
  current_setting('testes.empresa_a'), current_setting('testes.forn')), '42501', null, 'quem só vende não abre a ficha do fornecedor');
reset role;

-- Colaborador que gerencia a loja sem ver custos: ficha do fornecedor sem valores
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender', 'gestao.gerenciar']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((public.gestao_contraparte_ficha(current_setting('testes.empresa_a')::uuid, current_setting('testes.forn')::uuid, 'fornecedor') -> 'resumo' ->> 'total_compras'),
  null, 'sem "Ver custos e margens", a ficha do fornecedor não mostra o valor das compras');
select lives_ok(format($$select public.gestao_contraparte_ativar(%L, %L, false)$$, current_setting('testes.empresa_a'), current_setting('testes.cli2')),
  'quem gerencia desativa um cliente');
reset role;
select is((select ativo from public.contrapartes where id = current_setting('testes.cli2')::uuid), false, 'cliente fica inativo (não é apagado)');

-- Importação de planilha: quem gerencia importa; existente só completa o vazio
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.gestao_importar_contrapartes(current_setting('testes.empresa_a')::uuid, 'cliente', jsonb_build_array(
  jsonb_build_object('nome', 'Importado Novo', 'documento', '048.286.990-90', 'telefone', '63988880000', 'municipio_ibge', '1721000',
                     'logradouro', 'Rua Importada', 'numero', '5', 'bairro', 'Centro'),
  jsonb_build_object('nome', 'Maria Cliente', 'documento', '52998224725', 'telefone', '63900000000', 'observacoes', 'Veio da planilha'),
  jsonb_build_object('nome', 'Sem Documento', 'documento', '123.456.789-00', 'email', 'nao-e-email'),
  jsonb_build_object('nome', 'X'))),
  '{"novos": 2, "ignorados": 1, "atualizados": 1}'::jsonb, 'importa novos, completa existentes e ignora linha sem nome');
select is((select array[telefone, observacoes] from public.contrapartes where id = current_setting('testes.cli')::uuid),
  array['63999990000', 'Veio da planilha'], 'cadastro existente: telefone mantido, observação vazia completada');
select is((select array[documento, email] from public.contrapartes where empresa_id = current_setting('testes.empresa_a')::uuid and nome = 'Sem Documento'),
  array[null, null]::text[], 'CPF e e-mail inválidos ficam em branco, o resto entra');
select is((select logradouro from public.nfe_destinatarios where empresa_id = current_setting('testes.empresa_a')::uuid and documento = '04828699090'),
  'Rua Importada', 'cliente importado com endereço completo vira destinatário da NF-e');
select is((public.gestao_importar_contrapartes(current_setting('testes.empresa_a')::uuid, 'cliente', jsonb_build_array(
  jsonb_build_object('nome', 'Sem Documento'))) ->> 'atualizados')::int, 1, 'importar de novo não duplica (mesmo nome sem documento)');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.gestao_importar_contrapartes(%L, 'cliente', '[{"nome": "Intruso"}]')$$,
  current_setting('testes.empresa_a')), '42501', null, 'outra empresa não importa na empresa A');
reset role;

-- Outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.contrapartes where empresa_id = current_setting('testes.empresa_a')::uuid), 0,
  'outra empresa não vê os clientes nem os fornecedores');
select throws_ok(format($$select public.gestao_contraparte_salvar(%L, null, '{"papel": "cliente", "nome": "Intruso"}')$$,
  current_setting('testes.empresa_a')), '42501', null, 'outra empresa não cadastra na empresa A');
select throws_ok(format($$select public.gestao_contraparte_ficha(%L, %L, 'cliente')$$,
  current_setting('testes.empresa_b'), current_setting('testes.cli')), 'P0001', 'Cadastro não encontrado.', 'a ficha de um cadastro de outra empresa não abre');
reset role;

select * from finish();
rollback;
