-- Critérios: o que é usado no atendimento sai do estoque em fração (2,5 mL de
-- um produto controlado em mL), com o custo médio guardado; a recepção também
-- lança; cobrar põe o valor (quantidade × preço) na conta do atendimento;
-- cancelar devolve ao estoque e tira da conta; o ato clínico não é barrado
-- pelo estoque (fica negativo); a vacina do catálogo ligada a um produto tira
-- 1 dose a cada aplicação na clínica e devolve quando o registro é cancelado;
-- só o responsável liga a vacina ao produto; outra empresa não vê nem lança.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(15);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);

-- Clínica ligada, veterinária, tutor, animal e atendimento aberto
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "veterinaria"}');
reset role;
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.vet_veterinario_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'nome', 'Dra. Teste', 'crmv', '1234', 'crmv_uf', 'TO', 'perfil_id', '00000000-0000-0000-0000-0000000000b1'));
select set_config('testes.tutor', public.vet_tutor_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Ana Tutora", "cpf": "529.982.247-25"}')::text, true);
select set_config('testes.rex', public.vet_paciente_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'tutor_id', current_setting('testes.tutor'), 'nome', 'Rex', 'especie', 'canina'))::text, true);
select set_config('testes.atend', public.vet_atendimento_abrir(current_setting('testes.empresa_a')::uuid,
  jsonb_build_object('paciente_id', current_setting('testes.rex')))::text, true);
-- Produtos: medicamento controlado em mL (frasco de 50 mL = 50 mL no estoque) e a vacina por dose
select set_config('testes.dipirona', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Dipirona injetável 50 mL', 'ncm', '30049099', 'unidade', 'MLT', 'valor_unitario', 1.2))::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.dipirona'), 'quantidade', 100, 'custo_unitario', 0.3));
select set_config('testes.v10', public.gestao_produto_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'descricao', 'Vacina V10 (dose)', 'ncm', '30024200', 'unidade', 'DOSE', 'valor_unitario', 95))::text, true);
select public.gestao_estoque_lancar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'tipo', 'entrada_manual', 'produto_id', current_setting('testes.v10'), 'quantidade', 10, 'custo_unitario', 38));
reset role;

-- 1. Uso fracionado no atendimento
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.uso', public.vet_uso_registrar(current_setting('testes.atend')::uuid, jsonb_build_object(
  'produto_id', current_setting('testes.dipirona'), 'quantidade', '2,5'))::text, true);
reset role;
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.dipirona')::uuid), 97.5::numeric,
  '2,5 mL saem do estoque (100 → 97,5)');
select ok((select quantidade = -2.5 and observacao like 'Atendimento nº%Rex%' from public.estoque_movimentos
            where produto_id = current_setting('testes.dipirona')::uuid and tipo = 'uso_clinica'), 'o movimento fica como uso na clínica, com o atendimento');
select ok((select custo_unitario = 0.3 and conta_item_id is null and unidade = 'MLT' from public.vet_usos where id = current_setting('testes.uso')::uuid),
  'o uso guarda o custo médio e não cobra quando não pedido');

-- 2. A recepção lança e cobra na conta do tutor (quantidade × preço)
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.uso2', public.vet_uso_registrar(current_setting('testes.atend')::uuid, jsonb_build_object(
  'produto_id', current_setting('testes.dipirona'), 'quantidade', '3', 'cobrar', true))::text, true);
reset role;
select ok((select i.total = 3.60 and i.descricao like 'Dipirona injetável 50 mL — 3 mlt' from public.vet_usos u join public.vet_conta_itens i on i.id = u.conta_item_id
            where u.id = current_setting('testes.uso2')::uuid), 'cobrado na conta do atendimento: 3 × R$ 1,20 = R$ 3,60');
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.dipirona')::uuid), 94.5::numeric, 'e sai do estoque');

-- 3. Cancelar devolve ao estoque e tira da conta
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.vet_uso_cancelar(%L, '')$$, current_setting('testes.uso2')), '%motivo%', 'cancelar pede o motivo');
select public.vet_uso_cancelar(current_setting('testes.uso2')::uuid, 'Lançado em dobro');
reset role;
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.dipirona')::uuid), 97.5::numeric, 'cancelado: volta ao estoque');
select ok((select i.cancelado_em is not null from public.vet_usos u join public.vet_conta_itens i on i.id = u.conta_item_id
            where u.id = current_setting('testes.uso2')::uuid), 'e sai da conta do tutor');

-- 4. O ato clínico não é barrado pelo estoque
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.vet_uso_registrar(current_setting('testes.atend')::uuid, jsonb_build_object(
  'produto_id', current_setting('testes.dipirona'), 'quantidade', '100'));
reset role;
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.dipirona')::uuid), -2.5::numeric,
  'sem saldo, o uso entra e o estoque fica negativo para conferir');

-- 5. Vacina ligada ao produto: 1 dose por aplicação, volta ao cancelar
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.vet_vacina_produto_definir(%L, %L)$$,
  (select id from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid and nome like 'Polivalente canina%'),
  current_setting('testes.v10')), '%ermiss%', 'só o responsável liga a vacina ao produto');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.vet_vacina_produto_definir(
  (select id from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid and nome like 'Polivalente canina%'),
  current_setting('testes.v10')::uuid);
select set_config('testes.vac', public.vet_vacinacao_registrar(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'atendimento_id', current_setting('testes.atend'),
  'vacina_id', (select id from public.vet_vacinas where empresa_id = current_setting('testes.empresa_a')::uuid and nome like 'Polivalente canina%'),
  'dose', '1', 'fabricante', 'Lab X', 'partida', 'L1', 'fabricacao', (current_setting('testes.hoje')::date - 60)::text,
  'validade', (current_setting('testes.hoje')::date + 300)::text))::text, true);
reset role;
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.v10')::uuid), 9::numeric, 'a vacina aplicada tira 1 dose do estoque');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.vet_uso_cancelar(%L, 'teste')$$, (select id from public.vet_usos where vacinacao_id = current_setting('testes.vac')::uuid)),
  '%cancele o registro da vacina%', 'a baixa da vacina só volta cancelando a vacina');
select public.vet_vacinacao_cancelar(current_setting('testes.vac')::uuid, 'Registrada no animal errado');
reset role;
select is((select estoque_atual from public.nfe_produtos where id = current_setting('testes.v10')::uuid), 10::numeric, 'vacina cancelada: a dose volta ao estoque');

-- 6. Outra empresa não vê nem lança
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.vet_usos), 0, 'cliente de outra empresa não vê os usos');
select throws_like(format($$select public.vet_uso_registrar(%L, %L)$$, current_setting('testes.atend'), jsonb_build_object(
  'produto_id', current_setting('testes.dipirona'), 'quantidade', 1)), '%Acesso negado%', 'nem lança no atendimento dos outros');
reset role;

select * from finish();
rollback;
