-- Plano de contas editável pelo gestor: grupos próprios, estrutura em dois
-- níveis, exclusão movendo lançamentos e recorrências, meses fechados
-- protegidos, contas do sistema protegidas e isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(27);

\ir 00_setup.sql.inc

-- Gestor (titular) da Empresa A
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

select set_config('testes.grupo_desp', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4'), true);
select set_config('testes.grupo_rec', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '1'), true);

-- Grupo próprio e contas dentro dele
select lives_ok(format($$insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, sintetica)
  values (%L, '9', '  Despesas com pessoal ', 'despesa_operacional', true)$$, current_setting('testes.empresa_a')), 'gestor cria um grupo próprio');
select set_config('testes.grupo_pessoal', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '9'), true);
select is((select nome from public.categorias_financeiras where id = current_setting('testes.grupo_pessoal')::uuid), 'Despesas com pessoal', 'nome sem espaços sobrando');
select lives_ok(format($$insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, pai_id)
  values (%L, '9.01', 'Festas e confraternizações', 'despesa_operacional', %L)$$, current_setting('testes.empresa_a'), current_setting('testes.grupo_pessoal')),
  'gestor cria conta dentro do grupo próprio');
select set_config('testes.festas', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '9.01'), true);
select set_config('testes.aluguel', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.04'), true);

-- Estrutura em dois níveis
select throws_ok(format($$insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, sintetica, pai_id)
  values (%L, '9.90', 'Subgrupo', 'despesa_operacional', true, %L)$$, current_setting('testes.empresa_a'), current_setting('testes.grupo_pessoal')),
  'P0001', 'Um grupo não pode ficar dentro de outro grupo.', 'grupo não fica dentro de outro grupo');
select throws_ok(format($$insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, pai_id)
  values (%L, '9.02', 'Conta dentro de conta', 'despesa_operacional', %L)$$, current_setting('testes.empresa_a'), current_setting('testes.festas')),
  'P0001', 'Escolha um grupo do plano de contas.', 'conta só fica dentro de grupo');

-- Lançamento e recorrência na conta própria
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Confraternização de fim de ano', current_setting('testes.festas')::uuid, '2026-12-10', '2026-12-10', 850);
insert into public.recorrencias (empresa_id, tipo, descricao, categoria_id, valor, data_inicio)
values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Café da equipe', current_setting('testes.festas')::uuid, 120, '2026-12-01');

select is(public.categoria_financeira_uso(current_setting('testes.festas')::uuid) - 'meses_fechados',
  jsonb_build_object('lancamentos', 1, 'recorrencias', 1, 'ajustes', 0, 'contas_no_grupo', 0, 'sistema', false, 'grupo', false), 'uso da conta: lançamento e recorrência');
select throws_ok(format($$update public.categorias_financeiras set sintetica = true where id = %L$$, current_setting('testes.festas')),
  'P0001', null, 'conta com lançamentos não vira grupo');
select throws_ok(format($$update public.categorias_financeiras set sintetica = false where id = %L$$, current_setting('testes.grupo_pessoal')),
  'P0001', null, 'grupo com contas não vira conta');

-- Exclusão exige destino e valida o destino
select throws_like(format($$select public.excluir_categoria_financeira(%L)$$, current_setting('testes.festas')),
  '%2 lançamento(s). Escolha a conta que vai recebê-los.', 'conta com lançamentos pede a conta de destino');
select throws_ok(format($$select public.excluir_categoria_financeira(%L, %L)$$, current_setting('testes.festas'),
  (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '1.03')),
  'P0001', 'Escolha uma conta de despesa, como a conta que será excluída.', 'destino precisa ser da mesma natureza');
select throws_ok(format($$select public.excluir_categoria_financeira(%L, %L)$$, current_setting('testes.festas'), current_setting('testes.grupo_desp')),
  'P0001', 'Escolha uma conta (não um grupo) para receber os lançamentos.', 'destino não pode ser grupo');
select throws_ok(format($$select public.excluir_categoria_financeira(%L, %L)$$, current_setting('testes.festas'), current_setting('testes.festas')),
  'P0001', 'Escolha outra conta para receber os lançamentos.', 'destino não pode ser a própria conta');
select throws_like(format($$select public.excluir_categoria_financeira(%L)$$,
  (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo_sistema = 'TARIFAS_BANCARIAS')),
  '%usada automaticamente pelo sistema%', 'conta do sistema não é excluída');
reset role;

-- Outras pessoas não excluem
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.excluir_categoria_financeira(%L, %L)$$, current_setting('testes.festas'), current_setting('testes.aluguel')),
  'P0002', 'Conta não encontrada.', 'colaborador sem acesso ao financeiro não exclui');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.excluir_categoria_financeira(%L, %L)$$, current_setting('testes.festas'), current_setting('testes.aluguel')),
  'P0002', 'Conta não encontrada.', 'gestor de outra empresa não exclui');
select throws_ok(format($$select public.categoria_financeira_uso(%L)$$, current_setting('testes.festas')),
  'P0002', 'Conta não encontrada.', 'gestor de outra empresa não vê o uso da conta');
reset role;

-- Exclusão movendo tudo para a conta escolhida
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.excluir_categoria_financeira(current_setting('testes.festas')::uuid, current_setting('testes.aluguel')::uuid),
  jsonb_build_object('contas_movidas', 0, 'lancamentos_movidos', 1, 'recorrencias_movidas', 1, 'ajustes_movidos', 0), 'move lançamento e recorrência e exclui');
select is((select categoria_id from public.lancamentos where descricao = 'Confraternização de fim de ano'), current_setting('testes.aluguel')::uuid,
  'lançamento passou para a conta escolhida');
select is((select categoria_id from public.recorrencias where descricao = 'Café da equipe'), current_setting('testes.aluguel')::uuid,
  'recorrência passou para a conta escolhida');
select ok(not exists (select 1 from public.categorias_financeiras where id = current_setting('testes.festas')::uuid), 'conta excluída');
reset role;
select ok(exists (select 1 from public.auditoria where entidade = 'categorias_financeiras' and dados_depois is null
                  and entidade_id = current_setting('testes.festas')), 'exclusão registrada no histórico');

-- Conta sem lançamentos: exclui direto
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, pai_id)
values (current_setting('testes.empresa_a')::uuid, '9.02', 'Conta sem uso', 'despesa_operacional', current_setting('testes.grupo_pessoal')::uuid);
select is(public.excluir_categoria_financeira((select id from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '9.02')) ->> 'lancamentos_movidos', '0', 'conta sem lançamentos é excluída direto');

-- Grupo: contas vão para outro grupo
insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, pai_id)
values (current_setting('testes.empresa_a')::uuid, '9.03', 'Treinamentos', 'despesa_operacional', current_setting('testes.grupo_pessoal')::uuid);
select is(public.excluir_categoria_financeira(current_setting('testes.grupo_pessoal')::uuid, current_setting('testes.grupo_desp')::uuid) ->> 'contas_movidas', '1',
  'grupo excluído e as contas vão para o grupo escolhido');
select is((select pai_id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '9.03'),
  current_setting('testes.grupo_desp')::uuid, 'conta agora está no grupo escolhido');

-- Mês fechado pelo escritório: não exclui
insert into public.categorias_financeiras (empresa_id, codigo, nome, tipo, pai_id)
values (current_setting('testes.empresa_a')::uuid, '4.50', 'Brindes', 'despesa_operacional', current_setting('testes.grupo_desp')::uuid);
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Brindes de agosto',
        (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.50'), '2026-08-10', '2026-08-10', 90);
reset role;
insert into public.competencias (empresa_id, competencia, status) values (current_setting('testes.empresa_a')::uuid, '2026-08-01', 'fechada')
on conflict (empresa_id, competencia) do update set status = 'fechada';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.categoria_financeira_uso((select id from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.50')) -> 'meses_fechados', '["2026-08"]'::jsonb, 'uso mostra o mês fechado');
select throws_like(format($$select public.excluir_categoria_financeira(%L, %L)$$,
  (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.50'), current_setting('testes.aluguel')),
  '%meses já fechados pelo escritório (a partir de 08/2026)%', 'conta com lançamento em mês fechado não é excluída');
select is((select categoria_id from public.lancamentos where descricao = 'Brindes de agosto'),
  (select id from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '4.50'), 'lançamento do mês fechado não mudou');
reset role;

select * from finish();
rollback;
