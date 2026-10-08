-- Critérios: a apuração do ICMS lê só as notas da própria empresa e só para
-- quem vê os cálculos; a destinação das entradas, os lançamentos, o saldo
-- anterior e a conferência são da equipe (calculos.gerenciar); o mês conferido
-- fica travado até ser reaberto com motivo (e o mês seguinte conferido trava a
-- reabertura do anterior); o saldo credor conferido passa para o mês seguinte.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(32);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

create or replace function pg_temp.documento(p_empresa uuid, p_nome text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, mime, tamanho, sha256,
                                 versao_atual, storage_path, upload_status, status, origem, verificacao_status)
  values (v_id, p_empresa, 'cliente', '2026-09-01', 'nfe_entrada_xml', p_nome, 'xml', 'application/xml', 1000, md5(p_nome) || md5(p_nome),
          1, p_empresa::text || '/2026-09/' || v_id::text || '/v1-' || p_nome, 'concluido', 'recebido', 'upload', 'ok');
  return v_id;
end $$;

create or replace function pg_temp.nota(p_empresa uuid, p_operacao text, p_uf text, p_ident text, p_icms numeric) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.documentos_fiscais (id, empresa_id, documento_id, modelo, tipo_documento, identificador, competencia, operacao,
                                         situacao_arquivo, relacionado_empresa, emitente_documento, emitente_nome, emitente_uf,
                                         valor_total, valor_produtos, tributos, leitura_versao)
  values (v_id, p_empresa, pg_temp.documento(p_empresa, p_ident || '.xml'), '55', 'NF-e', p_ident, '2026-09-01', p_operacao,
          'protocolo_autorizacao_no_arquivo', true, '55666777000181', 'FORNECEDOR TESTE', p_uf, 1000, 1000,
          jsonb_build_object('icms', p_icms::text), 3);
  insert into public.documento_fiscal_itens (documento_fiscal_id, empresa_id, numero_item, cfop, valor_total, tributos)
  values (v_id, p_empresa, 1, case when p_operacao = 'saida' then '5102' else '6102' end, 1000,
          jsonb_build_object('icms', p_icms::text, 'cst_icms', '00', 'orig', '0', 'p_icms', '12.00'));
  return v_id;
end $$;

select set_config('testes.nota_a', pg_temp.nota(current_setting('testes.empresa_a')::uuid, 'entrada', 'GO', 'ent-a', 120)::text, true);
select set_config('testes.nota_b', pg_temp.nota(current_setting('testes.empresa_b')::uuid, 'entrada', 'GO', 'ent-b', 120)::text, true);
select pg_temp.nota(current_setting('testes.empresa_b')::uuid, 'saida', 'TO', 'sai-b', 200);

-- 1. Leitura dos dados
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(jsonb_array_length(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') -> 'entradas'), 1,
          'equipe recebe a nota de entrada do mês');
select is(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{entradas,0,itens,0,icms}', '120',
          'itens com o ICMS destacado');
select is((public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') ->> 'leitura_antiga')::int, 1,
          'conta as notas lidas antes da leitura atual');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{entradas,0,emitente}', 'FORNECEDOR TESTE',
          'empresário (vê os cálculos e os documentos) recebe a própria apuração');
select is((public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') ->> 'gerenciar')::boolean, false,
          'empresário não gerencia a apuração');
select throws_ok($$select public.dados_apuracao_icms(current_setting('testes.empresa_b')::uuid, '2026-09-01')$$, '42501', null,
                 'empresário não lê a apuração de outra empresa');
select throws_ok($$select public.icms_definir_destinacao(current_setting('testes.empresa_a')::uuid, current_setting('testes.nota_a')::uuid, null, null, 'uso_consumo')$$,
                 '42501', null, 'empresário não muda a destinação');
select throws_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor)
                   values (current_setting('testes.empresa_a')::uuid, '2026-09-01', 'guia_extra', 'Teste', 10)$$, '42501', null,
                 'empresário não lança valores na apuração');
select throws_ok($$select public.icms_conferir(current_setting('testes.empresa_a')::uuid, '2026-09-01',
                   '{"a_recolher": "0", "saldo_credor_transportar": "0", "total_guias": "0", "linhas": []}'::jsonb)$$, '42501', null,
                 'empresário não confere a apuração');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01')$$, '42501', null,
                 'colaborador sem acesso aos cálculos não lê');
reset role;

-- 2. Destinação das entradas (equipe)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.icms_definir_destinacao(current_setting('testes.empresa_a')::uuid, current_setting('testes.nota_a')::uuid, null, null, 'uso_consumo')$$,
                'equipe marca a nota como uso e consumo');
select lives_ok($$select public.icms_definir_destinacao(current_setting('testes.empresa_a')::uuid, current_setting('testes.nota_a')::uuid, 1, null, 'revenda')$$,
                'equipe marca um item');
select lives_ok($$select public.icms_definir_destinacao(current_setting('testes.empresa_a')::uuid, null, null, '55.666.777/0001-81', 'ativo')$$,
                'equipe define a destinação do fornecedor');
select is(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{entradas,0,destinacao}', 'uso_consumo',
          'destinação da nota volta nos dados');
select is(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') #>> '{fornecedores,55666777000181}', 'ativo',
          'destinação do fornecedor volta nos dados');
select throws_ok($$select public.icms_definir_destinacao(current_setting('testes.empresa_a')::uuid, current_setting('testes.nota_b')::uuid, null, null, 'revenda')$$,
                 '22023', null, 'nota de outra empresa é recusada');
select throws_ok($$select public.icms_definir_destinacao(current_setting('testes.empresa_a')::uuid, current_setting('testes.nota_a')::uuid, null, null, 'outra')$$,
                 '22023', null, 'destinação inválida é recusada');
select lives_ok($$select public.icms_definir_destinacao_padrao(current_setting('testes.empresa_a')::uuid, 'uso_consumo')$$, 'equipe muda a destinação padrão');
select is(public.dados_apuracao_icms(current_setting('testes.empresa_a')::uuid, '2026-09-01') ->> 'destinacao_padrao', 'uso_consumo',
          'destinação padrão guardada nos parâmetros');

-- 3. Lançamento, saldo anterior e conferência (empresa B: administrador)
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((public.dados_apuracao_icms(current_setting('testes.empresa_b')::uuid, '2026-09-01') #>> '{saidas,0,icms}')::numeric, 200::numeric,
          'saídas somadas por CFOP');
select lives_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor)
                  values (current_setting('testes.empresa_b')::uuid, '2026-09-01', 'outro_credito', 'CIAP 1/48', 25)$$, 'equipe lança outros créditos');
select lives_ok($$select public.icms_informar_saldo_anterior(current_setting('testes.empresa_b')::uuid, '2026-09-01', 40, 'Saldo da EFD de agosto')$$,
                'equipe informa o saldo credor anterior');
select lives_ok($$select public.icms_conferir(current_setting('testes.empresa_b')::uuid, '2026-09-01',
                  '{"a_recolher": "135.00", "saldo_credor_transportar": "0.00", "total_guias": "135.00", "linhas": []}'::jsonb)$$,
                'equipe confere setembro');
select throws_ok($$insert into public.icms_lancamentos (empresa_id, competencia, tipo, descricao, valor)
                   values (current_setting('testes.empresa_b')::uuid, '2026-09-01', 'outro_debito', 'Depois da conferência', 5)$$, '42501', null,
                 'mês conferido não aceita lançamentos');
select throws_ok($$select public.icms_informar_saldo_anterior(current_setting('testes.empresa_b')::uuid, '2026-09-01', 0)$$, '22023', null,
                 'mês conferido não aceita mudar o saldo anterior');
select lives_ok($$select public.icms_conferir(current_setting('testes.empresa_b')::uuid, '2026-10-01',
                  '{"a_recolher": "0.00", "saldo_credor_transportar": "15.50", "total_guias": "0.00", "linhas": []}'::jsonb)$$,
                'equipe confere outubro');
select is(public.dados_apuracao_icms(current_setting('testes.empresa_b')::uuid, '2026-11-01') #>> '{anterior,saldo_credor_transportar}', '15.50',
          'saldo credor conferido de outubro chega a novembro');
select throws_ok($$select public.icms_reabrir(current_setting('testes.empresa_b')::uuid, '2026-09-01', 'Nota recebida depois')$$, '22023', null,
                 'não reabre setembro com outubro conferido');
select lives_ok($$select public.icms_reabrir(current_setting('testes.empresa_b')::uuid, '2026-10-01', 'Nota recebida depois')$$, 'equipe reabre outubro');
reset role;
select ok(exists (select 1 from public.auditoria where acao = 'icms_apuracao_reaberta' and empresa_id = current_setting('testes.empresa_b')::uuid),
          'reabertura fica na auditoria');

-- 4. Releitura em fila
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(public.icms_reler_notas(current_setting('testes.empresa_a')::uuid, '2026-09-01', 4), 1, 'pede a releitura da nota antiga');
reset role;
select ok(exists (select 1 from public.jobs where tipo = 'reler_notas_mes' and empresa_id = current_setting('testes.empresa_a')::uuid),
          'tarefa de releitura na fila');

select * from finish();
rollback;
