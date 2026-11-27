-- Busca do portal: texto normalizado (sem acento, minúsculo, pontuação vira
-- espaço), campo "busca" de cada tabela calculado da própria linha (sem
-- privilégio extra: quem não vê a linha não acha nada por ela) e a coluna de
-- busca dos produtos liberada para leitura. Dados fictícios.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

\ir 00_setup.sql.inc

select is(app.busca_normalizar('João da SILVA-ME'), 'joao da silva me', 'sem acento, minúsculo e pontuação vira espaço');
select is(app.busca_normalizar('Ação & Çedilha / Pão'), 'acao cedilha pao', 'ç, til e símbolos');
select is(app.busca_normalizar(null), '', 'vazio quando não há texto');

-- Nenhum campo de busca roda com privilégio de dono (todos respeitam a RLS de quem pesquisa)
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'busca' and p.prosecdef), 0, 'campos de busca não são security definer');
select ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'busca') = 17,
  'campo de busca nas tabelas pesquisadas');
select ok(not has_function_privilege('anon', 'app.busca_normalizar(text)', 'execute'), 'visitante sem login não usa a busca');

-- Mesmo nome nas duas empresas: cada cliente só acha o próprio cadastro
insert into public.contrapartes (empresa_id, nome, documento, telefone, papeis)
values (current_setting('testes.empresa_a')::uuid, 'José Ávila Madeiras', '52998224725', '63999990000', array['cliente']),
       (current_setting('testes.empresa_b')::uuid, 'JOSE AVILA DA OUTRA EMPRESA', '11144477735', '63988880000', array['cliente']);
select is((select c.busca from public.contrapartes c where c.documento = '52998224725'), 'jose avila madeiras 52998224725 63999990000',
  'busca do cadastro: nome, CPF e telefone normalizados');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.contrapartes c where c.busca like '%avila%' and c.busca like '%jose%'), 1,
  'cliente da empresa A acha "avila jose" em qualquer ordem e só o da própria empresa');
select is((select string_agg(c.nome, ',') from public.contrapartes c where c.busca like '%avila%'), 'José Ávila Madeiras', 'não vê o cadastro da empresa B');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.contrapartes c where c.busca like '%52998224725%'), 0, 'cliente da empresa B não acha o CPF cadastrado na empresa A');
reset role;

-- Produtos: a coluna de busca é gerada e liberada (sem abrir as colunas de custo)
insert into public.nfe_produtos (empresa_id, codigo, descricao, ncm, unidade, grupo)
values (current_setting('testes.empresa_a')::uuid, 'TAB-30', 'Tábua de Pinus 2,5 x 30 cm', '44071100', 'UN', 'Madeira serrada');
select is((select busca from public.nfe_produtos where codigo = 'TAB-30'), 'tabua de pinus 2 5 x 30 cm tab30 madeira serrada', 'busca do produto: nome, código e grupo');
select ok(has_column_privilege('authenticated', 'public.nfe_produtos', 'busca', 'select'), 'a coluna de busca do produto pode ser lida');

select * from finish();
rollback;
