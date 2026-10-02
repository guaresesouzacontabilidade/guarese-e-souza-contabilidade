-- Critérios: cada empresa só vê os próprios contratos e vendas das maquininhas;
-- a venda é conferida com a taxa do contrato (a da bandeira vale mais que a de
-- todas); a mesma venda não duplica; o formato aprendido pelo cliente vale só
-- para a empresa dele (o da equipe, para o escritório); só o processador grava
-- as vendas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(39);

\ir 00_setup.sql.inc

create or replace function pg_temp.enviar(p_empresa uuid, p_nome text, p_hash text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.criar_documento(p_empresa, '2026-09-01', 'relatorio_maquininha', p_nome, 'text/csv', 1000, p_hash);
  insert into storage.objects (bucket_id, name, metadata) values ('documentos', r ->> 'storage_path', '{"size": 1000, "mimetype": "text/csv"}');
  perform public.confirmar_upload((r ->> 'versao_id')::uuid);
  return (r ->> 'documento_id')::uuid;
end $$;

-- ------------------------------------------------------------ contratos (cliente titular)
select ok((select permissoes @> array['maquininhas.ver', 'maquininhas.gerenciar'] from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'),
          'o titular recebe as permissões das maquininhas');

-- Contrato da empresa B (cadastrado pelo administrador)
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
with x as (
  insert into public.maquininha_contratos (empresa_id, adquirente_codigo, adquirente_nome, tipo, vigencia_inicio)
  values (current_setting('testes.empresa_b')::uuid, 'stone', 'Stone', 'cartao', '2026-01-01') returning id)
select set_config('testes.contrato_b', x.id::text, true) from x;
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
with x as (
  insert into public.maquininha_contratos (empresa_id, adquirente_codigo, adquirente_nome, tipo, vigencia_inicio)
  values (current_setting('testes.empresa_a')::uuid, 'cielo', 'Cielo', 'cartao', '2026-01-01') returning id)
select set_config('testes.contrato', x.id::text, true) from x;
insert into public.maquininha_taxas (contrato_id, empresa_id, bandeira, modalidade, parcelas_de, parcelas_ate, taxa_percentual) values
  (current_setting('testes.contrato')::uuid, current_setting('testes.empresa_a')::uuid, null, 'credito_vista', 1, 1, 3.00),
  (current_setting('testes.contrato')::uuid, current_setting('testes.empresa_a')::uuid, 'VISA', 'credito_vista', 1, 1, 2.50),
  (current_setting('testes.contrato')::uuid, current_setting('testes.empresa_a')::uuid, null, 'debito', 1, 1, 1.00),
  (current_setting('testes.contrato')::uuid, current_setting('testes.empresa_a')::uuid, null, 'credito_parcelado', 2, 6, 4.00);
select is((select count(*)::int from public.maquininha_taxas where contrato_id = current_setting('testes.contrato')::uuid), 4,
  'titular cadastra o contrato e as taxas');
select throws_ok(
  format($$insert into public.maquininha_contratos (empresa_id, adquirente_codigo, adquirente_nome, tipo, vigencia_inicio)
           values (%L, 'rede', 'Rede', 'cartao', '2026-01-01')$$, current_setting('testes.empresa_b')),
  '42501', null, 'cliente A não cadastra contrato na empresa B');
select throws_ok(
  format($$insert into public.maquininha_taxas (contrato_id, empresa_id, modalidade, taxa_percentual) values (%L, %L, 'debito', 0.1)$$,
         current_setting('testes.contrato_b'), current_setting('testes.empresa_a')),
  '42501', null, 'cliente A não inclui taxa no contrato da empresa B (a empresa vem do contrato)');
select is((select count(*)::int from public.maquininha_contratos), 1, 'cliente A vê só o contrato da própria empresa');
select is((select count(*)::int from public.maquininha_adquirentes where tipo in ('frota', 'beneficio', 'convenio')) > 20, true,
  'catálogo traz adquirentes de frota, benefícios e convênios');

-- ------------------------------------------------------------ relatório em formato novo
reset role;
select set_config('testes.doc', pg_temp.enviar(current_setting('testes.empresa_a')::uuid, 'vendas-cielo-setembro.csv', repeat('c', 64))::text, true);
select set_config('request.jwt.claims', '', true);
select set_config('testes.imp', (public.maquininha_registrar_relatorio(current_setting('testes.doc')::uuid, 1, 'vendas-cielo-setembro.csv',
  'data da venda|bandeira|valor bruto|valor liquido|nsu', '["Data da venda","Bandeira","Valor bruto","Valor líquido","NSU"]'::jsonb,
  '[["05/09/2026","Visa","100,00","97,50","1"]]'::jsonb, 6) ->> 'importacao_id'), true);
select is((select situacao from public.maquininha_importacoes where id = current_setting('testes.imp')::uuid), 'aguardando_mapeamento',
  'formato desconhecido aguarda a conferência das colunas');
select ok(exists (select 1 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'maquininha_relatorio'),
  'a equipe é avisada do formato novo');

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.maquininha_importacoes), 0, 'colaborador sem permissão não vê os relatórios');
select throws_ok($$select public.maquininha_resumo(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')$$, '42501', null,
  'colaborador sem permissão não vê a conferência');
select throws_ok($$select public.maquininha_confirmar_mapeamento(current_setting('testes.imp')::uuid, '{"data":0,"bruto":2,"liquido":3}'::jsonb, 'cielo')$$,
  '42501', null, 'colaborador sem permissão não confere colunas');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.maquininha_confirmar_mapeamento(current_setting('testes.imp')::uuid, '{"data":0}'::jsonb, 'cielo')$$,
  'P0001', 'Escolha ao menos as colunas da data, do valor da venda e do valor líquido ou da taxa.', 'exige data, valor e líquido (ou taxa)');
select lives_ok($$select public.maquininha_confirmar_mapeamento(current_setting('testes.imp')::uuid,
  '{"linhaCabecalho":0,"data":0,"bandeira":1,"bruto":2,"liquido":3,"nsu":4}'::jsonb, 'cielo')$$, 'titular confere as colunas');
reset role;
select is((select situacao || ':' || adquirente_chave from public.maquininha_importacoes where id = current_setting('testes.imp')::uuid), 'na_fila:cielo',
  'relatório vai para a fila com a adquirente');
select is((select count(*)::int from public.jobs where tipo = 'importar_maquininha' and payload ->> 'importacao_id' = current_setting('testes.imp')), 1,
  'importação agendada');
select is((select count(*)::int from public.maquininha_layouts where empresa_id = current_setting('testes.empresa_a')::uuid), 1,
  'o formato ensinado pelo cliente fica só para a empresa dele');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.maquininha_confirmar_mapeamento(current_setting('testes.imp')::uuid,
  '{"linhaCabecalho":0,"data":0,"bandeira":1,"bruto":2,"liquido":3,"nsu":4}'::jsonb, 'cielo')$$,
  'P0001', 'Este relatório já está sendo importado.', 'não importa de novo enquanto a importação está na fila');
reset role;
update public.jobs set status = 'falhou' where tipo = 'importar_maquininha' and payload ->> 'importacao_id' = current_setting('testes.imp');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$select public.maquininha_confirmar_mapeamento(current_setting('testes.imp')::uuid,
  '{"linhaCabecalho":0,"data":0,"bandeira":1,"bruto":2,"liquido":3,"nsu":4}'::jsonb, 'cielo')$$,
  'se a tarefa de importação morreu, dá para importar de novo');
reset role;
select is((select count(*)::int from public.jobs where tipo = 'importar_maquininha' and status = 'pendente'
            and payload ->> 'importacao_id' = current_setting('testes.imp')), 1, 'nova tarefa de importação agendada');

-- ------------------------------------------------------------ vendas gravadas pelo processador e conferidas
select set_config('request.jwt.claims', '', true);
select is(public.maquininha_gravar_vendas(current_setting('testes.imp')::uuid, '[
  {"data_venda":"2026-09-05","bandeira":"VISA","modalidade":"credito_vista","parcelas":1,"valor_bruto":100,"valor_taxa":2.50,"valor_liquido":97.50,"nsu":"1","situacao":"aprovada","linha":2,"chave_unica":"2026-09-05|N:1|100.00|1"},
  {"data_venda":"2026-09-05","bandeira":"MASTERCARD","modalidade":"credito_vista","parcelas":1,"valor_bruto":100,"valor_taxa":3.50,"valor_liquido":96.50,"nsu":"2","situacao":"aprovada","linha":3,"chave_unica":"2026-09-05|N:2|100.00|1"},
  {"data_venda":"2026-09-06","bandeira":"ELO","modalidade":"credito_parcelado","parcelas":3,"valor_bruto":300,"valor_taxa":12.00,"valor_liquido":288,"nsu":"3","situacao":"aprovada","linha":4,"chave_unica":"2026-09-06|N:3|300.00|1"},
  {"data_venda":"2026-09-06","bandeira":"VISA","modalidade":"debito","parcelas":1,"valor_bruto":50,"valor_taxa":0.30,"valor_liquido":49.70,"nsu":"4","situacao":"aprovada","linha":5,"chave_unica":"2026-09-06|N:4|50.00|1"},
  {"data_venda":"2026-09-07","bandeira":null,"modalidade":"pix","parcelas":1,"valor_bruto":10,"valor_taxa":0.10,"valor_liquido":9.90,"nsu":"5","situacao":"aprovada","linha":6,"chave_unica":"2026-09-07|N:5|10.00|1"},
  {"data_venda":"2026-09-07","bandeira":"VISA","modalidade":"credito_vista","parcelas":1,"valor_bruto":80,"valor_taxa":2.52,"valor_liquido":77.48,"nsu":"6","situacao":"cancelada","linha":7,"chave_unica":"2026-09-07|N:6|80.00|1"}
]'::jsonb), '{"novas": 6, "atualizadas": 0}'::jsonb, 'grava as vendas do relatório');
select is((public.maquininha_concluir_importacao(current_setting('testes.imp')::uuid,
  '{"periodo_inicio":"2026-09-05","periodo_fim":"2026-09-07","vendas":5,"duplicadas":0,"canceladas":1,"invalidas":0,"total_bruto":"560.00","total_taxas":"18.40"}'::jsonb) ->> 'acima')::numeric,
  0.50, 'conclusão confere as vendas: R$ 0,50 acima do contrato');
select is((select string_agg(nsu || '=' || conferencia, ',' order by nsu) from public.maquininha_vendas where importacao_id = current_setting('testes.imp')::uuid),
  '1=ok,2=acima,3=ok,4=abaixo,5=sem_taxa,6=cancelada', 'cada venda conferida (a taxa da Visa vale mais que a de todas as bandeiras)');
select is((select taxa_contratada from public.maquininha_vendas where importacao_id = current_setting('testes.imp')::uuid and nsu = '1'), 2.5000::numeric(7,4),
  'a venda Visa usa a taxa específica da bandeira');
select ok(exists (select 1 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'maquininha_taxa'),
  'o cliente é avisado da taxa acima do contrato');
select is(public.maquininha_gravar_vendas(current_setting('testes.imp')::uuid, '[
  {"data_venda":"2026-09-05","bandeira":"MASTERCARD","modalidade":"credito_vista","parcelas":1,"valor_bruto":100,"valor_taxa":3.50,"valor_liquido":96.50,"nsu":"2","situacao":"cancelada","linha":3,"chave_unica":"2026-09-05|N:2|100.00|1"}
]'::jsonb), '{"novas": 0, "atualizadas": 1}'::jsonb, 'a mesma venda em outro relatório não duplica (fica a leitura mais recente)');

-- ------------------------------------------------------------ formato aprendido
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.doc2', pg_temp.enviar(current_setting('testes.empresa_a')::uuid, 'vendas-cielo-outubro.csv', repeat('d', 64))::text, true);
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
select set_config('testes.doc_b', pg_temp.enviar(current_setting('testes.empresa_b')::uuid, 'vendas-b.csv', repeat('e', 64))::text, true);
set local role authenticated;
select is((select count(*)::int from public.maquininha_vendas), 0, 'cliente B não vê as vendas da empresa A');
select throws_ok($$select public.maquininha_resumo(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')$$, '42501', null,
  'cliente B não vê a conferência da empresa A');
reset role;
select set_config('request.jwt.claims', '', true);
select is(public.maquininha_registrar_relatorio(current_setting('testes.doc2')::uuid, 1, 'vendas-cielo-outubro.csv',
  'data da venda|bandeira|valor bruto|valor liquido|nsu', '[]'::jsonb, '[]'::jsonb, 10) ->> 'situacao', 'na_fila',
  'o próximo relatório no mesmo formato entra sozinho');
select is(public.maquininha_registrar_relatorio(current_setting('testes.doc_b')::uuid, 1, 'vendas-b.csv',
  'data da venda|bandeira|valor bruto|valor liquido|nsu', '[]'::jsonb, '[]'::jsonb, 10) ->> 'situacao', 'aguardando_mapeamento',
  'o formato ensinado pelo cliente A não vale para a empresa B');

-- ------------------------------------------------------------ resumo, carteira e reconferência
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((public.maquininha_resumo(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30') -> 'totais' ->> 'sem_taxa')::int, 1,
  'resumo do mês conta a venda sem taxa cadastrada');
select throws_ok($$select public.maquininha_carteira('2026-09-01', '2026-09-30')$$, '42501', null, 'cliente não vê a carteira do escritório');
insert into public.maquininha_taxas (contrato_id, empresa_id, modalidade, taxa_percentual)
values (current_setting('testes.contrato')::uuid, current_setting('testes.empresa_a')::uuid, 'pix', 1.00);
select is(public.maquininha_reconferir(current_setting('testes.empresa_a')::uuid), 6, 'reconfere as vendas depois de mudar as taxas');
select is((select conferencia from public.maquininha_vendas where nsu = '5'), 'ok', 'a venda no Pix passa a ter taxa para conferir');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(public.maquininha_carteira('2026-09-01', '2026-09-30')) e
            where e ->> 'empresa_id' = current_setting('testes.empresa_a')), 1, 'a equipe vê a empresa na carteira');
reset role;

-- A equipe ensina o formato para o escritório todo
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.maquininha_confirmar_mapeamento(
  (select id from public.maquininha_importacoes where documento_id = current_setting('testes.doc_b')::uuid),
  '{"linhaCabecalho":0,"data":0,"bandeira":1,"bruto":2,"liquido":3,"nsu":4}'::jsonb, 'stone')$$, 'administrador confere as colunas');
reset role;
select is((select count(*)::int from public.maquininha_layouts
            where empresa_id is null and assinatura = 'data da venda|bandeira|valor bruto|valor liquido|nsu'), 1,
  'formato ensinado pela equipe vale para o escritório');

-- Só o processador grava vendas
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.maquininha_gravar_vendas(current_setting('testes.imp')::uuid, '[]'::jsonb)$$, '42501', null,
  'usuário não grava vendas direto');
select lives_ok($$select public.maquininha_excluir_importacao(current_setting('testes.imp')::uuid)$$, 'titular tira um relatório da conferência');
reset role;
select is((select count(*)::int from public.maquininha_vendas where importacao_id = current_setting('testes.imp')::uuid), 0,
  'as vendas do relatório saem junto');

select * from finish();
rollback;
