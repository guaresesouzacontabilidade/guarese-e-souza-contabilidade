-- Critérios: o DAR do ICMS gerado pelo robô (SEFAZ-MT) é registrado e lido só
-- pela equipe que gerencia os cálculos da empresa; o total é a soma de
-- principal, multa e juros; a guia ligada é da mesma empresa; a tela recebe o
-- vencimento em dia útil (fim de semana passa para o dia seguinte) e o último
-- dia útil do mês para pagar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

\ir 00_setup.sql.inc
select set_config('request.jwt.claims', '', true);

update public.empresas set uf = 'MT', regime_tributario = 'lucro_real', contribuinte_icms = true, inscricao_estadual = '131234567'
 where id = current_setting('testes.empresa_a')::uuid;

-- 1. Dados da tela: só a equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
-- 20/09/2026 é domingo: o vencimento passa para segunda, 21/09
select is(public.dados_dar_icms(current_setting('testes.empresa_a')::uuid, '2026-08-01', '2026-09-20') ->> 'vencimento_util', '2026-09-21', 'vencimento no domingo passa para o dia útil seguinte');
select is(public.dados_dar_icms(current_setting('testes.empresa_a')::uuid, '2026-08-01') #>> '{empresa,inscricao_estadual}', '131234567', 'a tela recebe a inscrição estadual');
select ok((public.dados_dar_icms(current_setting('testes.empresa_a')::uuid, '2026-08-01') ->> 'ultimo_dia_util')::date
          between date_trunc('month', app.hoje())::date and (date_trunc('month', app.hoje()) + interval '1 month - 1 day')::date, 'último dia útil é deste mês');
select set_config('testes.dar', public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-07-01', 'receita', '1112', 'numero', '300000000017', 'principal', '691.20', 'multa', '138.24', 'juros', '14.38',
  'total', '843.82', 'vencimento_imposto', '2026-08-20', 'vencimento', '2026-10-30', 'dias_atraso', 71, 'multa_percentual', '20',
  'juros_percentual', '2.08', 'meses_selic', jsonb_build_array('2026-09'), 'origem', 'informado'))::text, true);
select is(jsonb_array_length(public.dados_dar_icms(current_setting('testes.empresa_a')::uuid, '2026-07-01') -> 'emissoes'), 1, 'equipe registra e vê o DAR do mês');
select is((select meses_selic from public.dar_emissoes where id = current_setting('testes.dar')::uuid), array['2026-09'], 'com os meses de SELIC usados nos juros');
select throws_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-07-01', 'receita', '1112', 'numero', '300000000018', 'principal', '100', 'multa', '1', 'juros', '1',
  'total', '150', 'vencimento_imposto', '2026-08-20', 'vencimento', '2026-10-30', 'origem', 'informado'))$$, '23514', null, 'total diferente de principal + multa + juros é recusado');
select throws_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'competencia', '2026-07-01', 'receita', '1112', 'numero', '300000000017', 'principal', '691.20', 'total', '691.20',
  'vencimento_imposto', '2026-08-20', 'vencimento', '2026-10-30', 'origem', 'informado'))$$, '23505', null, 'o mesmo número de DAR não entra duas vezes');
reset role;

-- Guia de outra empresa não se liga ao DAR
insert into public.documentos (id, empresa_id, direcao, competencia, categoria_codigo, nome_original, extensao, mime, tamanho, sha256,
                               versao_atual, storage_path, upload_status, status, origem, verificacao_status)
values ('00000000-0000-0000-0000-00000000d001', current_setting('testes.empresa_b')::uuid, 'escritorio', '2026-07-01', 'esc_guia', 'dar.pdf', 'pdf',
        'application/pdf', 1000, md5('dar-b') || md5('dar-b'), 1, current_setting('testes.empresa_b') || '/2026-07/d001/v1-dar.pdf', 'concluido', null, 'upload', 'ok'),
       ('00000000-0000-0000-0000-00000000d002', current_setting('testes.empresa_a')::uuid, 'escritorio', '2026-07-01', 'esc_guia', 'dar.pdf', 'pdf',
        'application/pdf', 1000, md5('dar-a') || md5('dar-a'), 1, current_setting('testes.empresa_a') || '/2026-07/d002/v1-dar.pdf', 'concluido', null, 'upload', 'ok');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.dar_vincular_documento(current_setting('testes.dar')::uuid, '00000000-0000-0000-0000-00000000d001')$$, 'P0001', 'Guia não encontrada.', 'guia de outra empresa é recusada');
select lives_ok($$select public.dar_vincular_documento(current_setting('testes.dar')::uuid, '00000000-0000-0000-0000-00000000d002')$$, 'guia da empresa é ligada ao DAR');
reset role;

-- 2. Cliente não lê nem grava
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.dados_dar_icms(current_setting('testes.empresa_a')::uuid, '2026-07-01')$$, '42501', null, 'cliente não abre os dados do DAR');
select throws_ok($$select public.dar_registrar_emissao(current_setting('testes.empresa_a')::uuid, '{}')$$, '42501', null, 'cliente não registra DAR');
select is((select count(*)::int from public.dar_emissoes), 0, 'cliente não lê o histórico de DAR');
reset role;

select * from finish();
rollback;
