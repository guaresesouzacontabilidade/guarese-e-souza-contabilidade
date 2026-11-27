-- Critérios: só a equipe emite a declaração de faturamento (um valor de zero
-- para cima para cada mês do período, total calculado no banco) e a cancela;
-- o empresário vê e envia a versão assinada da própria empresa; o colaborador e
-- outra empresa não veem; o PDF assinado e a logo ficam na pasta da empresa, com
-- leitura só para quem vê a empresa e troca só para quem edita o cadastro.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

create or replace function pg_temp.dados(p_meses int default 12, p_valor numeric default 1000) returns jsonb language sql as $$
  select jsonb_build_object(
    'periodo_inicio', '2025-10-01', 'periodo_fim', (date '2025-10-01' + make_interval(months => p_meses - 1))::date,
    'meses', (select jsonb_agg(jsonb_build_object('competencia', (date '2025-10-01' + make_interval(months => i))::date, 'valor', p_valor + i, 'origem', 'notas'))
                from generate_series(0, p_meses - 1) i),
    'cidade', 'Porto Nacional', 'uf', 'TO', 'data_declaracao', '2026-10-06',
    'representante_nome', 'Maria Teste', 'representante_cpf', '529.982.247-25', 'representante_cargo', 'Sócia administradora',
    'contador_nome', 'Contador Teste', 'contador_crc', 'TO-000000/O-0');
$$;

-- 1. Faturamento sugerido e emissão: só a equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.faturamento_mensal(current_setting('testes.empresa_a')::uuid, '2025-10-01', '2026-09-01')$$, '42501', null,
                 'empresário não consulta o faturamento para declaração');
select throws_ok($$select public.emitir_declaracao_faturamento(current_setting('testes.empresa_a')::uuid, pg_temp.dados())$$, '42501', null,
                 'empresário não emite a declaração');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(jsonb_array_length(public.faturamento_mensal(current_setting('testes.empresa_a')::uuid, '2025-10-01', '2026-09-01')), 12,
          'equipe recebe os 12 meses do período');
select throws_ok($$select public.faturamento_mensal(current_setting('testes.empresa_a')::uuid, '2023-01-01', '2026-09-01')$$, '22023', null,
                 'período acima de 36 meses é recusado');
select set_config('testes.dec', public.emitir_declaracao_faturamento(current_setting('testes.empresa_a')::uuid, pg_temp.dados())::text, true);
select ok(current_setting('testes.dec') <> '', 'equipe emite a declaração de 12 meses');
select throws_ok($$select public.emitir_declaracao_faturamento(current_setting('testes.empresa_a')::uuid,
                     jsonb_set(pg_temp.dados(), '{meses}', (pg_temp.dados() -> 'meses') - 0))$$, '22023', null, 'falta de um mês é recusada');
select throws_ok($$select public.emitir_declaracao_faturamento(current_setting('testes.empresa_a')::uuid, pg_temp.dados(12, -5))$$, '22023', null,
                 'valor negativo é recusado');
select throws_ok($$select public.emitir_declaracao_faturamento(current_setting('testes.empresa_a')::uuid,
                     pg_temp.dados() || '{"representante_cpf": "111.111.111-11"}')$$, '22023', null, 'CPF inválido é recusado');
reset role;
select is((select total from public.declaracoes_faturamento where id = current_setting('testes.dec')::uuid), 12066.00::numeric(15,2),
          'total calculado no banco (soma dos meses)');
select is((select representante_cpf from public.declaracoes_faturamento where id = current_setting('testes.dec')::uuid), '52998224725',
          'CPF guardado só com números');
select ok(exists (select 1 from public.auditoria where acao = 'declaracao_faturamento_emitida' and entidade_id = current_setting('testes.dec')),
          'emissão fica na auditoria');

-- 2. Quem vê
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.declaracoes_faturamento), 1, 'empresário vê a declaração da própria empresa');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.declaracoes_faturamento), 0, 'colaborador sem acesso aos relatórios não vê');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.declaracoes_faturamento), 0, 'cliente de outra empresa não vê');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('declaracoes', '%s/%s/assinada-1.pdf')$$,
                        current_setting('testes.empresa_a'), current_setting('testes.dec')), '42501', null,
                 'cliente de outra empresa não grava na pasta da empresa');
reset role;

-- 3. Versão assinada: o empresário envia; caminho fora da pasta é recusado
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('declaracoes', '%s/%s/assinada-1.pdf')$$,
                       current_setting('testes.empresa_a'), current_setting('testes.dec')), 'empresário grava o PDF na pasta da declaração');
select throws_ok(format($$select public.registrar_declaracao_assinada('%s', '%s/outra/assinada.pdf', true)$$,
                        current_setting('testes.dec'), current_setting('testes.empresa_a')), '22023', null, 'arquivo fora da pasta da declaração é recusado');
select lives_ok(format($$select public.registrar_declaracao_assinada('%s', '%s/%s/assinada-1.pdf', true)$$,
                       current_setting('testes.dec'), current_setting('testes.empresa_a'), current_setting('testes.dec')), 'empresário registra a versão assinada');
select throws_ok(format($$select public.cancelar_declaracao_faturamento('%s', 'Valor errado em março')$$, current_setting('testes.dec')), '42501', null,
                 'empresário não cancela a declaração');
reset role;
select is((select situacao from public.declaracoes_faturamento where id = current_setting('testes.dec')::uuid), 'assinada', 'declaração marcada como assinada');

-- 4. Cancelamento pela equipe; depois disso não recebe nova versão assinada
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.cancelar_declaracao_faturamento('%s', 'Valor errado em março')$$, current_setting('testes.dec')),
                'equipe cancela com motivo');
select throws_ok(format($$select public.registrar_declaracao_assinada('%s', '%s/%s/assinada-2.pdf', false)$$,
                        current_setting('testes.dec'), current_setting('testes.empresa_a'), current_setting('testes.dec')), '22023', null,
                 'declaração cancelada não recebe nova versão assinada');
reset role;

-- 5. Logo da empresa: troca só quem edita o cadastro, sempre na pasta da própria empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('empresas-logos', '%s/logo-1.png')$$, current_setting('testes.empresa_a')),
                 '42501', null, 'empresário sem permissão de editar o cadastro não troca a logo');
reset role;
select throws_ok(format($$update public.empresas set logo_path = '%s/logo.png' where id = '%s'$$, current_setting('testes.empresa_b'), current_setting('testes.empresa_a')),
                 '23514', null, 'a logo precisa estar na pasta da própria empresa');

select * from finish();
rollback;
