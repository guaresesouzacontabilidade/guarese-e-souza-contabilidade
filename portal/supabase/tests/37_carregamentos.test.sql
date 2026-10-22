-- Critérios: a gestão pode ser ligada na modalidade "notas e transporte" (sem
-- caixa nem contas da loja) e só a equipe escolhe a modalidade; a ordem de
-- carregamento numera em sequência por empresa, copia o produto, o comprador
-- e o transportador do cadastro da NF-e e confere placa e CPF; a pesagem
-- calcula o peso líquido; a NF-e emitida fica ligada à ordem, que deixa de ser
-- alterada ou cancelada enquanto a nota valer; cada empresa só vê as próprias
-- ordens e ninguém grava direto na tabela.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(25);

\ir 00_setup.sql.inc

-- Cadastros da NF-e (feitos pelo escritório)
insert into public.nfe_emitentes (id, empresa_id, nome, inscricao_estadual, logradouro, numero, bairro, municipio_ibge, cep, serie)
values ('0f000000-0000-0000-0000-00000000000a', current_setting('testes.empresa_a')::uuid, 'Armazém A', '131234567', 'Rodovia MT-130', 'KM 5', 'Zona Rural', '5107925', '78740000', 1);
insert into public.nfe_produtos (id, empresa_id, codigo, descricao, ncm, unidade, peso_kg)
values ('0d000000-0000-0000-0000-00000000000a', current_setting('testes.empresa_a')::uuid, 'SOJA', 'Soja em grãos', '12019000', 'SC', 60),
       ('0d000000-0000-0000-0000-00000000000b', current_setting('testes.empresa_b')::uuid, 'MILHO', 'Milho em grãos', '10059010', 'KG', 1);
insert into public.nfe_destinatarios (id, empresa_id, tipo, documento, nome, indicador_ie, logradouro, numero, bairro, municipio_ibge, cep)
values ('0c000000-0000-0000-0000-00000000000a', current_setting('testes.empresa_a')::uuid, 'cnpj', '12345678000195', 'Trading Exemplo', 9, 'Av. Porto', '1', 'Centro', '5107925', '78740000');
insert into public.nfe_transportadores (id, empresa_id, tipo, documento, nome, placa, placa_uf, rntc)
values ('0b000000-0000-0000-0000-00000000000a', current_setting('testes.empresa_a')::uuid, 'cnpj', '11444777000161', 'Transportes Exemplo', 'QBC1D23', 'MT', '012345678');

-- 1. Sem a gestão ligada, a ordem não é criada
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.carregamento_salvar(%L, null, '{"produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 600, "destinatario_nome": "X Y"}')$$,
  current_setting('testes.empresa_a')), '%não está ligada%', 'sem a gestão ligada não há ordem de carregamento');
reset role;

-- 2. O escritório liga na modalidade "notas": sem as contas da loja
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "notas"}');
select throws_like(format($$select public.gestao_configurar(%L, '{"modalidade": "posto"}')$$, current_setting('testes.empresa_a')),
  '%modalidade%', 'modalidade desconhecida é recusada');
reset role;
select ok((select ativa and modalidade = 'notas' and conta_dinheiro_id is null and conta_pix_id is null
             from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid),
  'gestão ligada na modalidade notas, sem caixa, banco e maquininha da loja');

-- 3. O cliente ajusta preferências, mas não muda a modalidade
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"modalidade": "loja", "mensagem_comprovante": "Obrigado"}');
reset role;
select is((select modalidade from public.gestao_config where empresa_id = current_setting('testes.empresa_a')::uuid), 'notas',
  'só o escritório muda a modalidade');

-- 4. Ordens numeradas, com cópia dos cadastros
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.ordem1', (public.carregamento_salvar(current_setting('testes.empresa_a')::uuid, null, '{
  "produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 600, "destinatario_id": "0c000000-0000-0000-0000-00000000000a",
  "emitente_id": "0f000000-0000-0000-0000-00000000000a", "transportador_id": "0b000000-0000-0000-0000-00000000000a", "frete_por_conta": 1,
  "motorista_nome": "João Motorista", "motorista_cpf": "529.982.247-25", "placas_reboque": ["rst-4e56", " "], "contrato": "CT-2026/15"}') ->> 'id'), true);
select set_config('testes.ordem2', (public.carregamento_salvar(current_setting('testes.empresa_a')::uuid, null, '{
  "produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 300, "destinatario_nome": "Cerealista Avulsa", "placa": "abc-1234"}') ->> 'id'), true);
reset role;
select is((select array_agg(numero order by numero) from public.ordens_carregamento where empresa_id = current_setting('testes.empresa_a')::uuid),
  array[1, 2]::bigint[], 'as ordens são numeradas em sequência');
select is((select (destinatario_nome, destinatario_documento, produto_descricao, unidade, peso_previsto_kg, status)::text
             from public.ordens_carregamento where id = current_setting('testes.ordem1')::uuid),
  '("Trading Exemplo",12345678000195,"Soja em grãos",SC,36000.000,aberta)', 'comprador e produto copiados; peso previsto pelas sacas de 60 kg');
select is((select (transportador_nome, rntrc, placa, placa_uf, placas_reboque, motorista_cpf)::text
             from public.ordens_carregamento where id = current_setting('testes.ordem1')::uuid),
  '("Transportes Exemplo",012345678,QBC1D23,MT,{RST4E56},52998224725)', 'transportador, placa da carreta e CPF limpos');
select is((select placa from public.ordens_carregamento where id = current_setting('testes.ordem2')::uuid), 'ABC1234', 'placa digitada fica em maiúsculas, sem traço');

-- 5. Conferências
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.carregamento_salvar(%L, null, '{"produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 10, "destinatario_nome": "X Y", "placa": "AB12345"}')$$,
  current_setting('testes.empresa_a')), '%Placa inválida%', 'placa fora do padrão é recusada');
select throws_like(format($$select public.carregamento_salvar(%L, null, '{"produto_id": "0d000000-0000-0000-0000-00000000000b", "quantidade": 10, "destinatario_nome": "X Y"}')$$,
  current_setting('testes.empresa_a')), '%Escolha o produto%', 'produto de outra empresa é recusado');
select throws_like(format($$select public.carregamento_salvar(%L, null, '{"produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 10, "destinatario_nome": "X Y", "motorista_cpf": "123"}')$$,
  current_setting('testes.empresa_a')), '%11 números%', 'CPF do motorista incompleto é recusado');
select throws_like(format($$select public.carregamento_pesagem(%L, '{"peso_bruto_kg": 15000, "tara_kg": 15000}')$$, current_setting('testes.ordem1')),
  '%maior que a tara%', 'bruto igual à tara é recusado');
reset role;

-- 6. Colaborador sem permissão de NF-e não mexe nas ordens
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.carregamento_pesagem(%L, '{"peso_bruto_kg": 51020, "tara_kg": 15000}')$$, current_setting('testes.ordem1')),
  '42501', null, 'colaborador sem a permissão de NF-e não registra a pesagem');
reset role;

-- 7. Pesagem
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.carregamento_pesagem(current_setting('testes.ordem1')::uuid, '{"peso_bruto_kg": 51020, "tara_kg": 15000, "umidade": 13.5, "impureza": 0.8, "ticket_balanca": "4512"}'),
  36020.000::numeric, 'peso líquido = bruto − tara');
reset role;
select is((select (status, peso_liquido_kg, umidade, ticket_balanca, carregado_em is not null)::text from public.ordens_carregamento where id = current_setting('testes.ordem1')::uuid),
  '(carregada,36020.000,13.50,4512,t)', 'ordem fica carregada com a pesagem e a classificação');

-- 8. NF-e ligada à ordem
insert into public.nfe_emissoes (id, empresa_id, emitente_id, ambiente, serie, numero, codigo_numerico, pedido, dados, natureza, destinatario_nome, valor_total)
values ('0a000000-0000-0000-0000-000000000001', current_setting('testes.empresa_a')::uuid, '0f000000-0000-0000-0000-00000000000a', 'homologacao', 1, 1, '12345678', '{}', '{}', 'Venda', 'Trading Exemplo', 1000),
       ('0a000000-0000-0000-0000-000000000002', current_setting('testes.empresa_a')::uuid, '0f000000-0000-0000-0000-00000000000a', 'homologacao', 1, 2, '12345679', '{}', '{}', 'Venda', 'Trading Exemplo', 1000);
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.carregamento_vincular_nfe(current_setting('testes.ordem1')::uuid, '0a000000-0000-0000-0000-000000000001');
select throws_like(format($$select public.carregamento_salvar(%L, %L, '{"produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 600, "destinatario_nome": "Outro"}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.ordem1')), '%já tem NF-e%', 'ordem com nota não muda');
select throws_like(format($$select public.carregamento_cancelar(%L, 'desistiu')$$, current_setting('testes.ordem1')),
  '%Cancele a nota%', 'ordem com nota não é cancelada');
select throws_like(format($$select public.carregamento_vincular_nfe(%L, '0a000000-0000-0000-0000-000000000002')$$, current_setting('testes.ordem1')),
  '%já tem NF-e%', 'não liga uma segunda nota enquanto a primeira vale');
reset role;
select is((select status from public.ordens_carregamento where id = current_setting('testes.ordem1')::uuid), 'faturada', 'a ordem fica faturada');

-- 9. Nota descartada: a ordem volta a aguardar a NF-e e pode ser corrigida
update public.nfe_emissoes set situacao = 'descartada' where id = '0a000000-0000-0000-0000-000000000001';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.carregamento_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.ordem1')::uuid,
  '{"produto_id": "0d000000-0000-0000-0000-00000000000a", "quantidade": 600, "destinatario_id": "0c000000-0000-0000-0000-00000000000a", "placa": "QBC1D24"}');
reset role;
select is((select (status, nfe_emissao_id is null, placa, peso_liquido_kg)::text from public.ordens_carregamento where id = current_setting('testes.ordem1')::uuid),
  '(carregada,t,QBC1D24,36020.000)', 'com a nota descartada a ordem é corrigida e mantém a pesagem');

-- 10. Cancelamento com motivo
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.carregamento_cancelar(%L, '')$$, current_setting('testes.ordem2')), '%motivo%', 'cancelar exige o motivo');
select public.carregamento_cancelar(current_setting('testes.ordem2')::uuid, 'Comprador desistiu');
reset role;
select is((select (status, motivo_cancelamento, cancelada_por)::text from public.ordens_carregamento where id = current_setting('testes.ordem2')::uuid),
  '(cancelada,"Comprador desistiu",00000000-0000-0000-0000-0000000000b1)', 'ordem cancelada com motivo e responsável');

-- 11. Isolamento e gravação direta
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.ordens_carregamento), 0, 'cliente de outra empresa não vê as ordens');
select throws_ok(format($$select public.carregamento_pesagem(%L, '{"peso_bruto_kg": 2, "tara_kg": 1}')$$, current_setting('testes.ordem1')),
  '42501', null, 'cliente de outra empresa não mexe na ordem');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format($$update public.ordens_carregamento set status = 'aberta' where id = %L$$, current_setting('testes.ordem2')),
  '42501', null, 'ninguém altera a tabela direto (só pelas funções)');
reset role;

select * from finish();
rollback;
