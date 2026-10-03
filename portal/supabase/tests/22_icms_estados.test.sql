-- Critérios: a tabela de ICMS por estado traz os 27 estados com a fonte de cada
-- dado e nenhum prazo sem fonte; a alíquota interestadual segue as Resoluções do
-- Senado nº 22/1989 e nº 13/2012; qualquer usuário ativo lê (é referência, não
-- dado de cliente); só o administrador altera, e só os campos de conteúdo; a
-- equipe transforma um prazo conferido em proposta de regra (sem duplicar e
-- nunca a partir de prazo "a conferir"), que aguarda a validação.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(36);

\ir 00_setup.sql.inc

-- Conteúdo
select is((select count(*)::int from public.icms_uf), 27, 'os 27 estados');
select is((select count(*)::int from public.icms_uf
            where aliquota_situacao <> 'a_conferir' and (aliquota_interna is null or aliquota_base_legal is null)), 0,
          'alíquota conferida ou informada sempre com a lei');
select is((select count(*)::int from public.icms_uf
            where vencimento_situacao = 'conferido' and (vencimento_dia is null or vencimento_ajuste is null or vencimento_base_legal is null)), 0,
          'prazo conferido sempre com dia, ajuste e fonte');
select is((select count(*)::int from public.icms_uf where vencimento_situacao <> 'conferido' and vencimento_dia is not null), 0,
          'nenhum dia de vencimento sem conferência');
select is((select aliquota_interna from public.icms_uf where uf = 'TO'), 20.00::numeric, 'Tocantins: 20%');
select is((select vencimento_situacao from public.icms_uf where uf = 'TO'), 'a_conferir', 'Tocantins: prazo a conferir (sem data inventada)');
select is((select vencimento_dia from public.icms_uf where uf = 'BA'), 9::smallint, 'Bahia: dia 9 (RICMS/BA, art. 332, I, "a")');
select is((select vencimento_situacao from public.icms_uf where uf = 'MS'), 'calendario', 'Mato Grosso do Sul: datas do calendário fiscal');

-- Alíquotas interestaduais
select is(app.icms_aliquota_interestadual('SP', 'TO'), 7::numeric, 'SP para TO: 7%');
select is(app.icms_aliquota_interestadual('TO', 'SP'), 12::numeric, 'TO para SP: 12%');
select is(app.icms_aliquota_interestadual('SP', 'ES'), 7::numeric, 'SP para ES: 7%');
select is(app.icms_aliquota_interestadual('ES', 'SP'), 12::numeric, 'ES para SP: 12% (o ES não sai a 7%)');
select is(app.icms_aliquota_interestadual('MG', 'RJ'), 12::numeric, 'entre estados do Sul e do Sudeste: 12%');
select is(app.icms_aliquota_interestadual('TO', 'SP', true), 4::numeric, 'mercadoria importada: 4%');
select is(app.icms_aliquota_interestadual('TO', 'TO'), null::numeric, 'operação interna: sem alíquota interestadual');

-- Propostas da migração: todo estado com prazo conferido tem regra; os demais, não
select is((select count(*)::int from public.icms_uf u
            where u.vencimento_situacao = 'conferido'
              and not exists (select 1 from public.obrigacao_regras r join public.obrigacoes o on o.id = r.obrigacao_id
                               where o.codigo = 'ICMS' and r.empresa_id is null and u.uf = any(r.ufs) and r.status in ('rascunho', 'validada'))), 0,
          'todo prazo conferido virou regra (proposta ou validada)');
select is((select count(*)::int from public.obrigacao_regras r join public.obrigacoes o on o.id = r.obrigacao_id
            where o.codigo = 'ICMS' and r.empresa_id is null and r.ufs && array(select uf from public.icms_uf where vencimento_situacao <> 'conferido')), 0,
          'prazo não conferido não vira regra');

-- Cliente: lê a referência, não altera nem propõe
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.icms_uf), 27, 'cliente lê a tabela de referência');
select is_empty($$ update public.icms_uf set aliquota_observacao = 'alterado' where uf = 'SP' returning uf $$, 'cliente não altera');
select throws_ok($$ select public.icms_uf_propor_regra('SP') $$, '42501', 'Acesso negado.', 'cliente não propõe regra');
reset role;

-- Equipe: não altera; não propõe prazo a conferir nem duplica proposta
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is_empty($$ update public.icms_uf set aliquota_observacao = 'alterado' where uf = 'SP' returning uf $$, 'equipe não altera (só o administrador)');
select throws_ok($$ select public.icms_uf_propor_regra('TO') $$, 'P0001',
  'Confira o prazo do ICMS de TO na legislação antes de propor a regra.', 'prazo a conferir não vira regra');
select throws_ok($$ select public.icms_uf_propor_regra('AM') $$, 'P0001',
  'Já existe uma proposta de regra do ICMS para este estado aguardando validação.', 'não duplica proposta pendente');
reset role;

-- Administrador completa o Tocantins (dado de teste, desfeito no fim)
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_ok($$ update public.icms_uf set uf = 'XX' where uf = 'TO' $$, '42501', null, 'a sigla do estado não pode ser alterada');
select throws_ok($$ update public.icms_uf set vencimento_situacao = 'conferido' where uf = 'TO' $$, '23514', null,
  'prazo conferido exige dia, ajuste e fonte');
select lives_ok($$ update public.icms_uf set vencimento_situacao = 'conferido', vencimento_dia = 10, vencimento_ajuste = 'postergar',
                    vencimento_base_legal = 'RICMS/TO (teste), art. 1º', conferido_em = current_date where uf = 'TO' $$,
  'administrador completa o prazo com a fonte');
select is((select atualizado_por from public.icms_uf where uf = 'TO'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'registra quem alterou');
reset role;

-- Equipe propõe a regra do Tocantins
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select isnt(public.icms_uf_propor_regra('TO'), null, 'equipe propõe a regra do estado');
reset role;
select is((select r.prazo_pagamento from public.obrigacao_regras r join public.obrigacoes o on o.id = r.obrigacao_id
            where o.codigo = 'ICMS' and 'TO' = any(r.ufs) and r.status = 'rascunho'),
          '{"tipo": "dia_fixo", "meses_apos": 1, "dia": 10, "ajuste": "postergar", "calendario": "expediente_bancario", "feriados": "municipal"}'::jsonb,
          'regra com o dia, o ajuste e o expediente bancário (feriados do estado e do município)');
select is((select r.regimes || array[r.exige_icms::text] from public.obrigacao_regras r join public.obrigacoes o on o.id = r.obrigacao_id
            where o.codigo = 'ICMS' and 'TO' = any(r.ufs) and r.status = 'rascunho'),
          array['lucro_presumido', 'lucro_real', 'lucro_arbitrado', 'true'], 'vale para o regime normal e só para contribuintes do ICMS');
select is((select a.status || '/' || a.tipo from public.atualizacoes_normativas a join public.obrigacao_regras r on r.id = a.regra_proposta_id
            where 'TO' = any(r.ufs) and r.status = 'rascunho'), 'proposta/nova_regra', 'aguarda validação em Atualizações normativas');

-- Estado com regra validada: proposta igual é recusada; prazo mudado vira alteração da regra
create or replace function pg_temp.proposta_de(p_uf text) returns uuid language sql as $$
  select a.id from public.atualizacoes_normativas a join public.obrigacao_regras r on r.id = a.regra_proposta_id
   where p_uf = any(r.ufs) and a.status = 'proposta' order by a.proposta_em desc limit 1;
$$;
select set_config('testes.proposta_ba', pg_temp.proposta_de('BA')::text, true);
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$ select public.validar_atualizacao_normativa(current_setting('testes.proposta_ba')::uuid);
                   select public.aplicar_atualizacao_normativa(current_setting('testes.proposta_ba')::uuid) $$,
  'administrador valida e aplica a regra da Bahia');
reset role;
select set_config('testes.regra_ba', (select r.id::text from public.obrigacao_regras r join public.obrigacoes o on o.id = r.obrigacao_id
                                       where o.codigo = 'ICMS' and r.ufs = array['BA'] and r.status = 'validada'), true);
select isnt(current_setting('testes.regra_ba'), '', 'regra da Bahia validada');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$ select public.icms_uf_propor_regra('BA') $$, 'P0001', 'A regra validada deste estado já tem este prazo.',
  'não propõe de novo o mesmo prazo já validado');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.icms_uf set vencimento_dia = 10, conferido_em = current_date where uf = 'BA';
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select isnt(public.icms_uf_propor_regra('BA'), null, 'prazo mudado: equipe propõe a alteração');
reset role;
select is((select a.tipo || '/' || (a.regra_anterior_id::text = current_setting('testes.regra_ba'))::text
             from public.atualizacoes_normativas a where a.id = pg_temp.proposta_de('BA')),
          'alteracao_regra/true', 'a proposta substitui a regra validada (sem duplicar tarefas)');

select * from finish();
rollback;
