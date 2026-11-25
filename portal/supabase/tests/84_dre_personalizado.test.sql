-- DRE personalizado por empresa e ajustes no resultado: modelo copiado do
-- padrão, linhas e subtotais próprios, ordem (resultado líquido por último),
-- conta levada para outra linha, voltar ao padrão, ajustes só de competência
-- com motivo, mês fechado protegido e isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(33);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

-- Modelo
select is(public.personalizar_dre(current_setting('testes.empresa_a')::uuid), 14, 'personalizar copia as 14 linhas do padrão');
select is(public.personalizar_dre(current_setting('testes.empresa_a')::uuid), 14, 'personalizar de novo não duplica');
select is((select chave_padrao from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid order by ordem desc limit 1),
  'resultado_liquido', 'resultado líquido é a última linha');

select set_config('testes.linha_pessoal', public.inserir_linha_dre(current_setting('testes.empresa_a')::uuid, 'grupo', '(−) Despesas com pessoal',
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'lucro_bruto'))::text, true);
select is((select ordem from public.dre_modelo_linhas where id = current_setting('testes.linha_pessoal')::uuid), 6, 'linha nova logo abaixo da escolhida');
select is((select ordem from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'despesas_operacionais'), 7,
  'linhas de baixo descem uma posição');
select set_config('testes.margem', public.inserir_linha_dre(current_setting('testes.empresa_a')::uuid, 'total', 'Margem depois do pessoal',
  current_setting('testes.linha_pessoal')::uuid)::text, true);
select is((select count(*)::int from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid), 16, 'linha e subtotal criados');
select throws_ok(format($$select public.inserir_linha_dre(%L, 'grupo', 'Depois do resultado', %L)$$, current_setting('testes.empresa_a'),
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'resultado_liquido')),
  'P0001', 'Escolha uma linha acima do resultado líquido.', 'nada fica abaixo do resultado líquido');

-- Ordem
select lives_ok(format($$select public.mover_linha_dre(%L, -1)$$, current_setting('testes.margem')), 'sobe uma linha');
select is((select ordem from public.dre_modelo_linhas where id = current_setting('testes.margem')::uuid), 6, 'subtotal subiu');
select throws_ok(format($$select public.mover_linha_dre(%L, -1)$$,
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'resultado_liquido')),
  'P0001', 'O resultado líquido fica sempre na última linha.', 'resultado líquido não se move');
select lives_ok(format($$select public.mover_linha_dre(%L, 1)$$,
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'impostos_lucro')),
  'descer a linha logo acima do resultado não faz nada');
select is((select chave_padrao from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid order by ordem desc limit 1),
  'resultado_liquido', 'resultado líquido continua por último');

-- Renomear, recolher e esconder
select lives_ok(format($$update public.dre_modelo_linhas set rotulo = ' Lucro antes do pessoal ', oculta = true where id = %L$$,
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'lucro_bruto')), 'renomeia e esconde subtotal');
select is((select rotulo from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'lucro_bruto'),
  'Lucro antes do pessoal', 'rótulo sem espaços sobrando');
select throws_ok(format($$update public.dre_modelo_linhas set oculta = true where id = %L$$,
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'resultado_liquido')),
  '23514', null, 'resultado líquido não se esconde');
select throws_ok(format($$update public.dre_modelo_linhas set tipos = '{}' where id = %L$$,
  (select id from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'custos')),
  '42501', null, 'tipos automáticos das linhas do padrão não mudam');

-- Conta levada para a linha nova
select lives_ok(format($$update public.categorias_financeiras set dre_linha_id = %L where empresa_id = %L and codigo = '4.01'$$,
  current_setting('testes.linha_pessoal'), current_setting('testes.empresa_a')), 'conta levada para a linha nova');
select throws_ok(format($$update public.categorias_financeiras set dre_linha_id = %L where empresa_id = %L and codigo = '4.02'$$,
  current_setting('testes.margem'), current_setting('testes.empresa_a')), 'P0001', 'Escolha uma linha de contas do DRE (não um subtotal).', 'conta não vai para subtotal');
select throws_like(format($$update public.categorias_financeiras set dre_linha_id = %L where empresa_id = %L and codigo = '8.01'$$,
  current_setting('testes.linha_pessoal'), current_setting('testes.empresa_a')), '%fora do resultado%', 'conta fora do resultado não vai para o DRE');

-- Linhas do padrão só saem com "voltar ao padrão"; linha própria sai
delete from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'custos';
select is((select count(*)::int from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid and chave_padrao = 'custos'), 1,
  'linha do padrão não é excluída');

-- Ajustes no resultado
select lives_ok(format($$insert into public.dre_ajustes (empresa_id, categoria_id, competencia, valor, motivo)
  values (%L, (select id from public.categorias_financeiras where empresa_id = %L and codigo = '4.09'), '2026-11-20', 300, 'Depreciação de novembro')$$,
  current_setting('testes.empresa_a'), current_setting('testes.empresa_a')), 'ajuste lançado');
select is((select competencia from public.dre_ajustes where motivo = 'Depreciação de novembro'), '2026-11-01'::date, 'competência no 1º dia do mês');
select is((select valor::numeric from public.relatorio_dre_linhas(current_setting('testes.empresa_a')::uuid, '2026-11-01', '2026-11-30') where origem = 'ajuste_resultado'),
  300::numeric, 'ajuste entra no DRE');
select ok(not exists (select 1 from public.relatorio_dre_linhas(current_setting('testes.empresa_a')::uuid, '2026-11-01', '2026-11-30',
  gen_random_uuid()) where origem = 'ajuste_resultado'), 'ajuste não entra quando filtra centro de custo');
select is((select count(*)::int from public.relatorio_dre_composicao(current_setting('testes.empresa_a')::uuid, '2026-11-01', '2026-11-30',
  array['despesa_operacional']) where origem = 'ajuste_resultado'), 1, 'ajuste aparece na composição');
select throws_ok(format($$insert into public.dre_ajustes (empresa_id, categoria_id, competencia, valor, motivo)
  values (%L, (select id from public.categorias_financeiras where empresa_id = %L and codigo = '4.09'), '2026-11-20', 10, 'oi')$$,
  current_setting('testes.empresa_a'), current_setting('testes.empresa_a')), '23514', null, 'motivo obrigatório');
select throws_ok($$update public.dre_ajustes set valor = 1 where motivo = 'Depreciação de novembro'$$, '42501', null, 'valor do ajuste não se altera');

-- Excluir conta move também os ajustes
insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, pai_id)
values (current_setting('testes.empresa_a')::uuid, '4.60', 'Depreciação', 'despesa_operacional',
        (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4'));
insert into public.dre_ajustes (empresa_id, categoria_id, competencia, valor, motivo)
values (current_setting('testes.empresa_a')::uuid, (select id from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.60'), '2026-12-01', 120, 'Depreciação de dezembro');
select is(public.excluir_categoria_financeira((select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.60'),
  (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.09')) ->> 'ajustes_movidos', '1',
  'excluir conta move o ajuste');
select is((select c.codigo from public.dre_ajustes a join public.categorias_financeiras c on c.id = a.categoria_id where a.motivo = 'Depreciação de dezembro'), '4.09',
  'ajuste agora está na conta escolhida');
reset role;

-- Outra empresa não vê nem mexe
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.dre_modelo_linhas where empresa_id = current_setting('testes.empresa_a')::uuid)
        + (select count(*)::int from public.dre_ajustes where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'outra empresa não vê modelo nem ajustes');
select throws_ok(format($$select public.personalizar_dre(%L)$$, current_setting('testes.empresa_a')), '42501', null, 'outra empresa não personaliza');
reset role;

-- Mês fechado e voltar ao padrão
insert into public.competencias (empresa_id, competencia, status) values (current_setting('testes.empresa_a')::uuid, '2026-11-01', 'fechada')
on conflict (empresa_id, competencia) do update set status = 'fechada';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$delete from public.dre_ajustes where motivo = 'Depreciação de novembro'$$), '%fechada%', 'ajuste de mês fechado não sai');
select is(public.restaurar_dre_padrao(current_setting('testes.empresa_a')::uuid), 16, 'voltar ao padrão apaga o modelo');
reset role;

select * from finish();
rollback;
