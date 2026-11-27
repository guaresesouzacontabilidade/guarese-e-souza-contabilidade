-- Critérios: relatórios publicados ficam preservados em versões, saem como
-- "preliminar" antes do fechamento e "revisado" depois; rascunhos não aparecem
-- para o cliente; o resumo financeiro da carteira respeita o acesso de cada um.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

\ir 00_setup.sql.inc

create or replace function pg_temp.cat(p_empresa text, p_codigo text) returns uuid language sql as $$
  select id from public.categorias_financeiras where empresa_id = current_setting(p_empresa)::uuid and codigo = p_codigo;
$$;

insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'receber', 'Vendas de setembro', pg_temp.cat('testes.empresa_a', '1.01'), '2026-09-10', '2026-09-10', 1000),
       (current_setting('testes.empresa_a')::uuid, 'pagar', 'Aluguel de setembro', pg_temp.cat('testes.empresa_a', '4.04'), '2026-09-05', '2026-09-05', 300),
       (current_setting('testes.empresa_b')::uuid, 'receber', 'Serviços de setembro', pg_temp.cat('testes.empresa_b', '1.02'), '2026-09-12', '2026-09-12', 500);

-- -------------------------------------------------------------- resumo da carteira
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select receita || ' ' || resultado from public.resumo_financeiro_carteira('2026-09-01', '2026-09-30')
            where empresa_id = current_setting('testes.empresa_a')::uuid), '1000.00 700.00',
          'resumo da carteira traz receita e resultado do mês (mesma regra da DRE)');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.resumo_financeiro_carteira('2026-09-01', '2026-09-30')
            where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'cliente de outra empresa não vê a empresa A no resumo');
select is((select receita from public.resumo_financeiro_carteira('2026-09-01', '2026-09-30')
            where empresa_id = current_setting('testes.empresa_b')::uuid), 500.00::numeric, 'cliente vê o resumo da própria empresa');
reset role;

-- -------------------------------------------------------------- publicação
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.rel1', public.salvar_rascunho_relatorio(null, current_setting('testes.empresa_a')::uuid, 'pacote_mensal',
  'Pacote de setembro', '2026-09-01', '2026-09-01', '2026-09-30', '{"formato": 1}', 'Resumo', null, '[]')::text, true);
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.relatorios_publicados where id = current_setting('testes.rel1')::uuid), 0,
          'cliente não vê rascunhos');
select throws_ok($$select public.publicar_relatorio(current_setting('testes.rel1')::uuid)$$, '42501', null, 'cliente não publica relatórios');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(public.publicar_relatorio(current_setting('testes.rel1')::uuid) ->> 'situacao', 'preliminar', 'publicado antes do fechamento: preliminar');
select throws_ok($$select public.salvar_rascunho_relatorio(current_setting('testes.rel1')::uuid, current_setting('testes.empresa_a')::uuid,
                   'pacote_mensal', 'Alterado', '2026-09-01', '2026-09-01', '2026-09-30', null, 'x', null, null)$$, null, null,
                 'relatório publicado não pode ser alterado');
-- fecha o mês e publica nova versão
select public.iniciar_fechamento(current_setting('testes.empresa_a')::uuid, '2026-09-01');
select public.atualizar_etapa_fechamento(e.id, 'concluida') from public.fechamento_etapas e
  join public.competencias c on c.id = e.competencia_id
 where c.empresa_id = current_setting('testes.empresa_a')::uuid and c.competencia = '2026-09-01' and e.etapa <> 'publicacao';
select public.fechar_competencia(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'ok');
select set_config('testes.rel2', public.salvar_rascunho_relatorio(null, current_setting('testes.empresa_a')::uuid, 'pacote_mensal',
  'Pacote de setembro (revisado)', '2026-09-01', '2026-09-01', '2026-09-30', '{"formato": 1}', 'Resumo final', null, '[]')::text, true);
select is(public.publicar_relatorio(current_setting('testes.rel2')::uuid)::jsonb, '{"versao": 2, "situacao": "revisado"}'::jsonb,
          'depois do fechamento: versão 2, revisado');
select is((select status from public.relatorios_publicados where id = current_setting('testes.rel1')::uuid), 'substituido',
          'versão anterior fica guardada como substituída');
select is((select e.status from public.fechamento_etapas e join public.competencias c on c.id = e.competencia_id
            where c.empresa_id = current_setting('testes.empresa_a')::uuid and c.competencia = '2026-09-01' and e.etapa = 'publicacao'),
          'concluida', 'publicar o pacote revisado conclui a etapa de publicação');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.relatorios_publicados where empresa_id = current_setting('testes.empresa_a')::uuid), 2,
          'cliente vê as duas versões publicadas');
select ok(exists (select 1 from public.notificacoes where tipo = 'relatorio_publicado'), 'cliente recebe aviso de relatório publicado');
reset role;

select * from finish();
rollback;
