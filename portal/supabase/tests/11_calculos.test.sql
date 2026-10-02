-- Critérios: a previsão e os colaboradores só aparecem para quem tem acesso
-- aos cálculos da empresa; só a equipe configura os parâmetros; clientes de
-- outra empresa não veem nada; a função da previsão soma corretamente as
-- notas (vendas, ST, devoluções, serviços com ISS retido) e o checklist.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

-- 1. Permissões padrão
select ok((select 'calculos.ver' = any(permissoes) and 'colaboradores.gerenciar' = any(permissoes) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'),
          'empresário titular vê os cálculos e cadastra colaboradores');
select ok((select not ('calculos.ver' = any(permissoes)) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2'),
          'colaborador do cliente não vê os cálculos por padrão');
select ok((select 'calculos.gerenciar' = any(permissoes) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000a2'),
          'equipe configura os cálculos');
select throws_ok($$update public.empresa_membros set permissoes = permissoes || array['calculos.gerenciar']
                    where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'$$,
                 'P0001', null, 'configurar os cálculos é exclusivo da equipe');
insert into public.empresa_membros (empresa_id, user_id, papel, permissoes)
values (current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b3', 'cliente_colaborador', array['colaboradores.gerenciar']);
select ok((select 'calculos.ver' = any(permissoes) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b3'),
          'quem cadastra colaboradores também vê os cálculos');

-- 2. Colaboradores: titular cadastra; colaborador e outra empresa não
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$insert into public.colaboradores (empresa_id, nome, admissao, salario)
                  values (current_setting('testes.empresa_a')::uuid, 'Maria Teste', '2024-02-01', 3000)$$,
                'titular cadastra colaborador');
select is((select count(*)::int from public.colaboradores where empresa_id = current_setting('testes.empresa_a')::uuid), 1, 'titular vê o colaborador');
select throws_ok($$insert into public.calculo_parametros (empresa_id) values (current_setting('testes.empresa_a')::uuid)$$,
                 '42501', null, 'cliente não configura os parâmetros');
select lives_ok($$select public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$, 'titular consulta a previsão');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.colaboradores where empresa_id = current_setting('testes.empresa_a')::uuid), 0,
          'colaborador do cliente (sem acesso aos cálculos) não vê salários');
select throws_ok($$insert into public.colaboradores (empresa_id, nome, admissao, salario)
                   values (current_setting('testes.empresa_a')::uuid, 'Intruso', '2024-02-01', 1000)$$,
                 '42501', null, 'colaborador do cliente não cadastra');
select throws_ok($$select public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$,
                 '42501', null, 'colaborador do cliente não consulta a previsão');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.colaboradores where empresa_id = current_setting('testes.empresa_a')::uuid), 0,
          'cliente de outra empresa não vê os colaboradores');
select throws_ok($$select public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$,
                 '42501', null, 'cliente de outra empresa não consulta a previsão');
reset role;

-- 3. Equipe configura parâmetros, receita informada e ajustes
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$insert into public.calculo_parametros (empresa_id, anexo_mercadorias, anexo_servicos)
                  values (current_setting('testes.empresa_a')::uuid, 'I', 'III')$$, 'equipe salva os parâmetros');
select lives_ok($$insert into public.calculo_meses (empresa_id, competencia, receita_mercadorias, receita_servicos)
                  values (current_setting('testes.empresa_a')::uuid, '2026-08-01', 25000, 0)$$, 'equipe informa a receita de um mês');
select lives_ok($$insert into public.calculo_ajustes (empresa_id, competencia, descricao, valor)
                  values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'ICMS-ST', 120.50)$$, 'equipe lança um ajuste');
select throws_ok($$insert into public.calculo_meses (empresa_id, competencia) values (current_setting('testes.empresa_a')::uuid, '2026-07-01')$$,
                 '23514', null, 'mês informado precisa de algum valor');

-- 4. Totais das notas do mês
select set_config('testes.doc', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-10', 'esc_outros', 'notas.zip',
  'application/pdf', 1024, md5('notas') || md5('notas')) ->> 'documento_id'), true);
reset role;
insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                       situacao_arquivo, relacionado_empresa, tributos, valor_servicos)
values
  ('00000000-0000-0000-0000-00000000f001', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'T1', '2026-09-01',
   'saida', 'protocolo_autorizacao_no_arquivo', true, '{"icms": "180.00"}', null),
  ('00000000-0000-0000-0000-00000000f002', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'T2', '2026-09-01',
   'entrada', 'protocolo_autorizacao_no_arquivo', true, '{"icms": "18.00"}', null),
  ('00000000-0000-0000-0000-00000000f003', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, 'nfse_nacional', 'NFS-e', 'T3', '2026-09-01',
   'saida', 'nao_aplicavel', true, '{"iss": "60.00", "iss_retido": "sim"}', 2000),
  ('00000000-0000-0000-0000-00000000f004', current_setting('testes.empresa_a')::uuid, current_setting('testes.doc')::uuid, '55', 'NF-e', 'T4', '2026-09-01',
   'saida', 'protocolo_autorizacao_no_arquivo', true, '{}', null);
update public.documentos_fiscais set cancelada_evento = true where id = '00000000-0000-0000-0000-00000000f004';
insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, cfop, valor_total, tributos)
values
  ('00000000-0000-0000-0000-00000000f001', current_setting('testes.empresa_a')::uuid, 1, '5102', 1000, '{"icms": "180.00"}'),
  ('00000000-0000-0000-0000-00000000f001', current_setting('testes.empresa_a')::uuid, 2, '5405', 500, '{}'),
  ('00000000-0000-0000-0000-00000000f001', current_setting('testes.empresa_a')::uuid, 3, '5949', 300, '{}'),
  ('00000000-0000-0000-0000-00000000f002', current_setting('testes.empresa_a')::uuid, 1, '1202', 100, '{"icms": "18.00"}'),
  ('00000000-0000-0000-0000-00000000f004', current_setting('testes.empresa_a')::uuid, 1, '5102', 9999, '{}');
insert into public.checklist_itens (empresa_id, competencia, categoria_codigo, titulo, prazo, obrigatorio, status)
values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'esc_outros', 'Extrato bancário', '2026-10-10', true, 'pendente');

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.prev', public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-09-15')::text, true);
reset role;
create temp table prev as
  select m from jsonb_array_elements(current_setting('testes.prev')::jsonb -> 'meses') m where m ->> 'competencia' = '2026-09-01';
select is((select (m ->> 'vendas')::numeric from prev), 1500::numeric, 'vendas: só CFOP de venda e sem a nota cancelada');
select is((select (m ->> 'vendas_st')::numeric from prev), 500::numeric, 'vendas com ICMS-ST separadas');
select is((select (m ->> 'devolucoes')::numeric from prev), 100::numeric, 'devolução de venda reduz a receita');
select is((select (m ->> 'servicos_retido')::numeric from prev), 2000::numeric, 'serviços com ISS retido identificados');
select is((select jsonb_array_length(current_setting('testes.prev')::jsonb -> 'checklist' -> 'faltantes')), 1, 'documento obrigatório faltando aparece');
select is((select (m -> 'informado' ->> 'receita_mercadorias')::numeric from jsonb_array_elements(current_setting('testes.prev')::jsonb -> 'meses') m
             where m ->> 'competencia' = '2026-08-01'), 25000::numeric,
          'receita informada do mês anterior vem junto (histórico)');

select * from finish();
rollback;
