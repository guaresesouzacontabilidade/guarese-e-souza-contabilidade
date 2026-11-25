-- Critérios: orçamento para cliente sem cadastro guarda nome, CPF e telefone
-- (conferidos, com mensagem clara) e não precisa de caixa aberto; cada
-- orçamento ganha um código aleatório para o link do WhatsApp (venda não); o
-- link sem login mostra os itens, os valores, a validade e só o primeiro nome
-- — sem CPF, telefone nem endereço de entrega; código errado, orçamento
-- cancelado ou loja desligada não abrem; o link só lê (não altera nada).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.tabua', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Tábua de pinus 2,5x30', 'ncm', '44071100', 'unidade', 'UN', 'valor_unitario', 42.5))::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.tabua'), 'quantidade', 20, 'custo_unitario', 25));

-- 1. Orçamento avulso sem caixa aberto, com nome, CPF e telefone
select ok(not exists (select 1 from public.caixa_sessoes where empresa_id = current_setting('testes.empresa_a')::uuid and status = 'aberto'),
  'nenhum caixa aberto');
select set_config('testes.orc', (public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'cliente_nome', 'João Carlos Teste', 'cliente_documento', '529.982.247-25', 'cliente_telefone', '(63) 99999-1234',
  'entrega', 'Rua das Palmeiras, 100', 'observacao', 'Retirar no balcão',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.tabua'), 'quantidade', 4)))) ->> 'id'), true);
select is((select cliente_nome || ' ' || cliente_documento || ' ' || cliente_telefone || ' ' || total from public.vendas where id = current_setting('testes.orc')::uuid),
  'João Carlos Teste 52998224725 63999991234 170.00', 'orçamento sem caixa guarda nome, CPF e telefone do cliente sem cadastro');
select ok((select codigo_publico ~ '^[a-z0-9]{16}$' from public.vendas where id = current_setting('testes.orc')::uuid), 'orçamento ganha código aleatório para o link');

-- 2. Conferência com mensagem clara
select throws_like(format($$select public.gestao_orcamento_salvar(%L, null, jsonb_build_object('cliente_nome', 'Ana', 'cliente_documento', '111.111.111-11',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1))))$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  '%CPF ou CNPJ do cliente inválido%', 'CPF errado é recusado com mensagem clara');
select throws_like(format($$select public.gestao_orcamento_salvar(%L, null, jsonb_build_object('cliente_nome', 'Ana', 'cliente_telefone', '9999-1234',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1))))$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  '%Telefone do cliente inválido%', 'telefone sem DDD é recusado com mensagem clara');
select lives_ok(format($$select public.gestao_orcamento_salvar(%L, null, jsonb_build_object('cliente_nome', 'Empresa Exemplo', 'cliente_documento', '11.222.333/0001-81',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', %L, 'quantidade', 1))))$$, current_setting('testes.empresa_a'), current_setting('testes.tabua')),
  'CNPJ válido é aceito');

-- 3. Editar o orçamento mantém o mesmo link
select set_config('testes.cod', (select codigo_publico from public.vendas where id = current_setting('testes.orc')::uuid), true);
select public.gestao_orcamento_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.orc')::uuid, jsonb_build_object(
  'cliente_nome', 'João Carlos Teste', 'cliente_documento', '52998224725', 'cliente_telefone', '63999991234',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.tabua'), 'quantidade', 6))));
select is((select codigo_publico from public.vendas where id = current_setting('testes.orc')::uuid), current_setting('testes.cod'), 'editar mantém o link');
reset role;

-- 4. O link (sem login) mostra só o que está no papel
select set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
set local role anon;
select is((select (r ->> 'cliente') || ' ' || (r ->> 'numero') || ' ' || (r ->> 'total') || ' ' || (r ->> 'situacao') || ' ' || jsonb_array_length(r -> 'itens')
             from public.gestao_orcamento_publico(current_setting('testes.cod')) r),
  'João 1 255.00 aberto 1', 'o cliente vê o primeiro nome, o número, o total e os itens');
select ok(not (public.gestao_orcamento_publico(current_setting('testes.cod'))::text ~ '52998224725|99999|Palmeiras|Carlos'),
  'o link não mostra CPF, telefone, endereço de entrega nem o sobrenome');
select is(public.gestao_orcamento_publico('aaaaaaaaaaaaaaaa'), null, 'código errado não abre nada');
select is(public.gestao_orcamento_publico(''' or 1=1 --'), null, 'código fora do formato não abre nada');
select throws_like($$select count(*) from public.vendas$$, '%permission denied%', 'visitante não lê a tabela de vendas');
reset role;

-- 5. Venda não ganha link; orçamento cancelado e loja desligada não abrem
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 0);
select set_config('testes.venda', (public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', (select id from public.caixa_sessoes where empresa_id = current_setting('testes.empresa_a')::uuid and status = 'aberto'),
  'cliente_nome', 'Pedro', 'cliente_telefone', '63988887777',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.tabua'), 'quantidade', 1)),
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 42.5)))) ->> 'id'), true);
reset role;
select is((select codigo_publico from public.vendas where id = current_setting('testes.venda')::uuid), null, 'venda não ganha link de orçamento');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.gestao_venda_cancelar(current_setting('testes.orc')::uuid, 'Cliente desistiu');
reset role;
select is(public.gestao_orcamento_publico(current_setting('testes.cod')), null, 'orçamento cancelado não abre pelo link');

select set_config('testes.orc2', (select id::text from public.vendas where empresa_id = current_setting('testes.empresa_a')::uuid
                                    and tipo = 'orcamento' and status = 'aberto' order by numero desc limit 1), true);
update public.gestao_config set ativa = false where empresa_id = current_setting('testes.empresa_a')::uuid;
select is(public.gestao_orcamento_publico((select codigo_publico from public.vendas where id = current_setting('testes.orc2')::uuid)), null,
  'com a loja desligada o link não abre');
update public.gestao_config set ativa = true where empresa_id = current_setting('testes.empresa_a')::uuid;
select isnt(public.gestao_orcamento_publico((select codigo_publico from public.vendas where id = current_setting('testes.orc2')::uuid)), null,
  'religada, o link volta a abrir');

select * from finish();
rollback;
