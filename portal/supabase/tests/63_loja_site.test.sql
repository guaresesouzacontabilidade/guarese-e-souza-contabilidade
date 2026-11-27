-- Site da loja: configuração só por quem gerencia a loja da própria empresa;
-- a chave do site nunca é lida pelo navegador; o catálogo e o pedido só pelo
-- servidor (service_role) com a chave certa; preço, frete e estoque vêm do
-- portal; variação obrigatória; o pedido vira orçamento "site" e avisa quem
-- vende; a venda feita a partir dele continua "site"; importação sem duplicar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(35);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
select public.gestao_configurar(current_setting('testes.empresa_b')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
-- O escritório libera o site da loja para as duas empresas (65_loja_site_liberacao testa a trava)
select public.loja_site_liberar(current_setting('testes.empresa_a')::uuid, true);
select public.loja_site_liberar(current_setting('testes.empresa_b')::uuid, true);
reset role;

-- Quem só vende não configura o site
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_a'),
  '{"slug": "loja-a", "nome": "Loja A", "pagamentos": ["pix"]}'), '42501', null, 'quem só vende não configura o site');
reset role;

-- Outra empresa não configura
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_a'),
  '{"slug": "loja-a", "nome": "Loja A", "pagamentos": ["pix"]}'), '42501', null, 'cliente de outra empresa não configura');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_a'),
  '{"ativo": true, "slug": "loja-a", "nome": "Loja A", "pagamentos": ["pix"]}'), '%WhatsApp da loja%',
  'não liga o site sem WhatsApp e entrega');
select lives_ok(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_a'), jsonb_build_object(
  'ativo', true, 'slug', 'Loja-A', 'nome', 'Loja A', 'whatsapp', '(63) 99999-0000', 'endereco_site', 'https://lojaa.com.br/',
  'pagamentos', jsonb_build_array('pix', 'dinheiro', 'boleto'),
  'entregas', jsonb_build_array(
    jsonb_build_object('nome', 'Entrega em Palmas', 'valor', 25, 'endereco', true, 'detalhe', 'Até 14h, no mesmo dia'),
    jsonb_build_object('nome', 'Retirada na loja', 'valor', 0),
    jsonb_build_object('nome', 'Outras cidades', 'endereco', true)))),
  'o titular configura e liga o site');
reset role;
select is((select slug || ' ' || whatsapp || ' ' || endereco_site from public.loja_sites where empresa_id = current_setting('testes.empresa_a')::uuid),
  'loja-a 5563999990000 https://lojaa.com.br', 'endereço curto em minúsculas, WhatsApp com 55 e site sem barra no fim');
select is((select pagamentos from public.loja_sites where empresa_id = current_setting('testes.empresa_a')::uuid),
  array['dinheiro', 'pix'], 'formas de pagamento desconhecidas ficam de fora');
select is((select string_agg(e ->> 'id', ',') from public.loja_sites s, jsonb_array_elements(s.entregas) e where s.empresa_id = current_setting('testes.empresa_a')::uuid),
  'entrega-em-palmas,retirada-na-loja,outras-cidades', 'cada entrega ganha um identificador pelo nome');

-- Endereço curto é único entre as lojas
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_like(format('select public.loja_site_configurar(%L, %L)', current_setting('testes.empresa_b'),
  '{"slug": "loja-a", "nome": "Loja B", "pagamentos": ["pix"]}'), '%já é usado por outra loja%', 'endereço curto repetido é recusado');
reset role;

-- Produtos da loja A: base com tons (5 em estoque), brinco (1 em estoque) e um escondido do site
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.base', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "BASE-1", "descricao": "BASE LIQUIDA MATTE", "ncm": "33049910", "unidade": "UN", "valor_unitario": 69.9, "preco_custo": 30}')::text, true);
select set_config('testes.brinco', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "BRINCO-1", "descricao": "BRINCO PRATA 925", "ncm": "71131100", "unidade": "UN", "valor_unitario": 120}')::text, true);
select set_config('testes.oculto', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"codigo": "OCULTO-1", "descricao": "PRODUTO ESCONDIDO", "ncm": "33049910", "unidade": "UN", "valor_unitario": 10}')::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.base'), 'quantidade', 5, 'custo_unitario', 30));
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.brinco'), 'quantidade', 1, 'custo_unitario', 50));
select set_config('testes.cat', public.loja_site_categoria_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "Maquiagens"}')::text, true);
select set_config('testes.sub', public.loja_site_categoria_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('nome', 'Bases', 'pai_id', current_setting('testes.cat')))::text, true);
select throws_like(format('select public.loja_site_categoria_salvar(%L, null, %L)', current_setting('testes.empresa_a'),
  jsonb_build_object('nome', 'Neta', 'pai_id', current_setting('testes.sub'))), '%dois níveis%', 'categorias têm só dois níveis');
select public.loja_site_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.base')::uuid, jsonb_build_object(
  'nome', 'Base Líquida Matte', 'descricao', 'Cobertura média.', 'categoria_id', current_setting('testes.sub'),
  'rotulo_variacao', 'Tom', 'variacoes', jsonb_build_array('020', ' 030 ', '030', '')));
select public.loja_site_visibilidade(current_setting('testes.empresa_a')::uuid,
  array[current_setting('testes.brinco')::uuid, current_setting('testes.oculto')::uuid], true);
select public.loja_site_produto_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.oculto')::uuid, '{"visivel": false}');
select throws_like(format('select public.loja_site_produto_fotos(%L, %L, %L)', current_setting('testes.empresa_a'), current_setting('testes.base'),
  array[current_setting('testes.empresa_b') || '/p/' || current_setting('testes.base') || '/abcdef12']), '%Foto inválida%',
  'foto fora da pasta do produto é recusada');
select is(public.loja_site_produto_fotos(current_setting('testes.empresa_a')::uuid, current_setting('testes.base')::uuid,
  array[current_setting('testes.empresa_a') || '/p/' || current_setting('testes.base') || '/foto0001', current_setting('testes.empresa_a') || '/p/' || current_setting('testes.base') || '/foto0002']),
  '{}'::text[], 'primeiras fotos gravadas');
select is(public.loja_site_produto_fotos(current_setting('testes.empresa_a')::uuid, current_setting('testes.base')::uuid,
  array[current_setting('testes.empresa_a') || '/p/' || current_setting('testes.base') || '/foto0002']),
  array[current_setting('testes.empresa_a') || '/p/' || current_setting('testes.base') || '/foto0001'], 'devolve a foto que saiu, para apagar');
select public.loja_site_definir_chave(current_setting('testes.empresa_a')::uuid, encode(extensions.digest('chave-certa', 'sha256'), 'hex'), 'lj_cert');
reset role;
select is((select variacoes from public.loja_site_produtos where produto_id = current_setting('testes.base')::uuid), array['020', '030'],
  'variações sem espaços, vazias ou repetidas');

-- O navegador nunca lê a chave nem chama a vitrine
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok('select chave_hash from public.loja_sites', '42501', null, 'o hash da chave não é lido pelo navegador');
select is((select chave_inicio from public.loja_sites where empresa_id = current_setting('testes.empresa_a')::uuid), 'lj_cert', 'mas o início da chave aparece para reconhecer');
select throws_ok(format('select public.loja_site_vitrine(%L, %L)', 'loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex')), '42501', null,
  'usuário do portal não chama a vitrine direto');
reset role;
set local role anon;
select throws_ok(format('select public.loja_site_pedido(%L, %L, %L)', 'loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex'), '{}'), '42501', null,
  'visitante anônimo não cria pedido direto no banco');
reset role;

-- Vitrine pelo servidor do portal
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(public.loja_site_vitrine('loja-a', encode(extensions.digest('chave-errada', 'sha256'), 'hex')), null, 'chave errada não vê nada');
select set_config('testes.vitrine', public.loja_site_vitrine('LOJA-A', encode(extensions.digest('chave-certa', 'sha256'), 'hex'))::text, true);
reset role;
select is(jsonb_array_length(current_setting('testes.vitrine')::jsonb -> 'produtos'), 2, 'vitrine mostra os 2 produtos visíveis (o escondido fica de fora)');
select ok(current_setting('testes.vitrine') not like '%custo%' and current_setting('testes.vitrine') not like '%estoque%', 'sem custo nem estoque exato na vitrine');
select is(current_setting('testes.vitrine')::jsonb #>> '{loja,cnpj}', '11444777000161', 'CNPJ da empresa aparece para o rodapé da loja');
select is((select (p ->> 'preco')::numeric from jsonb_array_elements(current_setting('testes.vitrine')::jsonb -> 'produtos') p where p ->> 'id' = current_setting('testes.base')),
  69.90::numeric, 'preço do cadastro');

-- Pedido: preço, frete e estoque do portal; tom obrigatório
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select throws_like(format('select public.loja_site_pedido(%L, %L, %L)', 'loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex'), jsonb_build_object(
  'nome', 'Maria', 'telefone', '63 98888-7777', 'entrega', 'retirada-na-loja', 'pagamento', 'pix',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.base'), 'quantidade', 1)))), '%Escolha uma opção (tom)%',
  'sem o tom escolhido, o pedido não entra');
select throws_like(format('select public.loja_site_pedido(%L, %L, %L)', 'loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex'), jsonb_build_object(
  'nome', 'Maria', 'telefone', '63 98888-7777', 'entrega', 'retirada-na-loja', 'pagamento', 'pix',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.brinco'), 'quantidade', 2)))), '%Temos só 1%',
  'mais do que o estoque é recusado');
select throws_like(format('select public.loja_site_pedido(%L, %L, %L)', 'loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex'), jsonb_build_object(
  'nome', 'Maria', 'telefone', '63 98888-7777', 'entrega', 'retirada-na-loja', 'pagamento', 'pix',
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.oculto'), 'quantidade', 1)))), '%saiu do site%',
  'produto escondido do site não entra no pedido');
select throws_ok(format('select public.loja_site_pedido(%L, %L, %L)', 'loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex'), jsonb_build_object(
  'nome', 'Maria', 'telefone', '63 98888-7777', 'entrega', 'entrega-em-palmas', 'endereco', 'Rua 10, 123, Centro', 'pagamento', 'pix',
  'total_visto', 100,
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.base'), 'quantidade', 2, 'variacao', '030', 'preco', 1)))), 'P0002', null,
  'total diferente do que a pessoa viu: pede para conferir (o preço mandado pelo navegador é ignorado)');
select set_config('testes.pedido', public.loja_site_pedido('loja-a', encode(extensions.digest('chave-certa', 'sha256'), 'hex'), jsonb_build_object(
  'nome', 'Maria', 'telefone', '+55 (63) 98888-7777', 'entrega', 'entrega-em-palmas', 'endereco', 'Rua 10, 123, Centro', 'pagamento', 'pix',
  'total_visto', 164.80,
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.base'), 'quantidade', 2, 'variacao', '030', 'preco', 1))))::text, true);
reset role;
select is((current_setting('testes.pedido')::jsonb ->> 'total')::numeric, 164.80::numeric, 'total = 2 × 69,90 + 25,00 de entrega');
select is((select tipo || ' ' || status || ' ' || origem || ' ' || cliente_telefone from public.vendas
            where empresa_id = current_setting('testes.empresa_a')::uuid and numero = (current_setting('testes.pedido')::jsonb ->> 'numero')::bigint and tipo = 'orcamento'),
  'orcamento aberto site 63988887777', 'o pedido vira orçamento "site" com o telefone sem o 55');
select is((select variacao from public.venda_itens i join public.vendas v on v.id = i.venda_id
            where v.empresa_id = current_setting('testes.empresa_a')::uuid and v.origem = 'site'), '030', 'o tom escolhido fica no item');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'pedido_site'), 1,
  'quem vende na loja recebe o aviso do pedido');

-- No caixa, o pedido vira venda e continua marcado como "site"
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 0)::text, true);
select public.gestao_venda_finalizar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'sessao_id', current_setting('testes.caixa'),
  'orcamento_id', (select id from public.vendas where empresa_id = current_setting('testes.empresa_a')::uuid and origem = 'site' and tipo = 'orcamento'),
  'itens', jsonb_build_array(jsonb_build_object('produto_id', current_setting('testes.base'), 'quantidade', 2)),
  'frete', 25,
  'pagamentos', jsonb_build_array(jsonb_build_object('forma', 'pix', 'valor', 164.80))));
reset role;
select is((select origem from public.vendas where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'venda'), 'site',
  'a venda feita a partir do pedido do site fica marcada como "site"');

-- Importação de outra plataforma: cria produto, categorias e estoque; de novo, só atualiza
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(jsonb_array_length(public.loja_site_importar(current_setting('testes.empresa_a')::uuid, jsonb_build_array(
  jsonb_build_object('externo', 'facilzap:111', 'codigo', 'FZ111', 'descricao', 'GLOSS LABIAL', 'nome', 'Gloss Labial', 'ncm', '33041000',
    'preco', 31.9, 'estoque', 7, 'categoria', 'Maquiagens', 'subcategoria', 'Gloss', 'variacoes', jsonb_build_array('Rosa', 'Nude')),
  jsonb_build_object('externo', 'facilzap:222', 'codigo', 'FZ222', 'descricao', 'ANEL PRATA 925', 'nome', 'Anel Prata 925', 'ncm', '71131100',
    'preco', 89.9, 'estoque', 0, 'categoria', 'Prata 925', 'subcategoria', 'Anel')))), 2, 'importa dois produtos');
select public.loja_site_importar(current_setting('testes.empresa_a')::uuid, jsonb_build_array(
  jsonb_build_object('externo', 'facilzap:111', 'codigo', 'FZ111', 'descricao', 'GLOSS LABIAL', 'nome', 'Gloss Labial', 'ncm', '33041000',
    'preco', 34.9, 'estoque', 4, 'categoria', 'MAQUIAGENS', 'subcategoria', 'gloss')));
reset role;
select is((select count(*)::int from public.loja_site_produtos where empresa_id = current_setting('testes.empresa_a')::uuid and origem_externa like 'facilzap:%'), 2,
  'importar de novo não duplica o produto');
select is((select p.valor_unitario::numeric(15, 2) || ' ' || p.estoque_atual::int from public.nfe_produtos p where p.empresa_id = current_setting('testes.empresa_a')::uuid and p.codigo = 'FZ111'),
  '34.90 4', 'na segunda vez, preço e estoque atualizados');
select is((select count(*)::int from public.loja_site_categorias where empresa_id = current_setting('testes.empresa_a')::uuid), 5,
  'categorias achadas pelo nome sem diferenciar maiúsculas (Maquiagens, Bases, Gloss, Prata 925, Anel)');

select * from finish();
rollback;
