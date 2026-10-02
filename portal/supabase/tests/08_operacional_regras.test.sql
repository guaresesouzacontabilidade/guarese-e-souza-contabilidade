-- Critérios: Lucro Real trimestral ou anual; folha com pró-labore; feriados
-- considerados por regra (nacionais, estaduais, municipais); prazo interno no
-- calendário do escritório; regra em vigor sem prazo ("a regulamentar");
-- rejeição e correção de propostas; mudança de regime por competência;
-- sincronização das tarefas da empresa; vínculo automático só de guias.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

\ir 00_setup.sql.inc

-- Isola o teste do catálogo e dos dados de demonstração
update public.obrigacoes set ativa = false;
update public.escritorio set cidade = 'Porto Nacional', uf = 'TO' where id = 1;

create or replace function pg_temp.obr(p_codigo text) returns uuid language sql as $$
  select id from public.obrigacoes where codigo = p_codigo;
$$;
create or replace function pg_temp.situacao(p_empresa text, p_codigo text, p_comp date) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como('00000000-0000-0000-0000-0000000000a1');
  set local role authenticated;
  select c.situacao into v from public.calendario_empresa(current_setting(p_empresa)::uuid, p_comp) c where c.codigo = p_codigo;
  reset role;
  return v;
end;
$$;
create or replace function pg_temp.regra(p_codigo text, p_extra jsonb, p_status text default 'validada') returns uuid language plpgsql as $$
declare
  r public.obrigacao_regras;
begin
  r := app.preencher_regra(r, jsonb_build_object('vigencia_inicio', '2025-01-01', 'regimes', to_jsonb(app.regimes_validos())) || p_extra);
  insert into public.obrigacao_regras (obrigacao_id, vigencia_inicio, vigencia_fim, regimes, ufs, municipios, exige_empregados, exige_folha,
                                       exige_icms, exige_iss, lucro_real_apuracao, servico, prazo_entrega, prazo_pagamento, prazo_apuracao,
                                       prazo_interno_dias_uteis, fonte_titulo, fonte_consultada_em, observacao, status)
  values (pg_temp.obr(p_codigo), r.vigencia_inicio, r.vigencia_fim, r.regimes, r.ufs, r.municipios, r.exige_empregados, r.exige_folha,
          r.exige_icms, r.exige_iss, r.lucro_real_apuracao, r.servico, r.prazo_entrega, r.prazo_pagamento, r.prazo_apuracao,
          r.prazo_interno_dias_uteis, 'Norma de teste', '2026-10-02', r.observacao, p_status)
  returning id into r.id;
  return r.id;
end;
$$;

insert into public.obrigacoes (codigo, nome, esfera, area, tributos, etapas, periodicidade, categorias_documento) values
  ('U_IRPJ_TRIM', 'IRPJ trimestral (teste)', 'federal', 'contabil', '{IRPJ}', '{apuracao,pagamento}', 'trimestral', '{}'),
  ('U_IRPJ_EST', 'IRPJ estimativa (teste)', 'federal', 'contabil', '{IRPJ}', '{apuracao,pagamento}', 'mensal', '{}'),
  ('U_INSS', 'INSS (teste)', 'federal', 'pessoal', '{INSS}', '{pagamento}', 'mensal', '{}'),
  ('U_CBS', 'CBS (teste)', 'federal', 'fiscal', '{CBS}', '{apuracao,pagamento}', 'mensal', '{}'),
  ('U_REJ', 'Obrigação rejeitada (teste)', 'municipal', 'fiscal', '{ISS}', '{pagamento}', 'mensal', '{}'),
  ('U_GUIA', 'Guia (teste)', 'federal', 'fiscal', '{SIMPLES}', '{entrega,pagamento}', 'mensal', '{esc_guia,esc_protocolo}');

select pg_temp.regra('U_IRPJ_TRIM', '{"regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "lucro_real_apuracao": "trimestral", "prazo_pagamento": {"tipo": "ultimo_dia_util", "meses_apos": 1, "feriados": "nacional"}}');
select pg_temp.regra('U_IRPJ_EST', '{"regimes": ["lucro_real"], "lucro_real_apuracao": "anual", "prazo_pagamento": {"tipo": "ultimo_dia_util", "meses_apos": 1, "feriados": "nacional"}}');
select pg_temp.regra('U_INSS', '{"exige_folha": true, "prazo_pagamento": {"tipo": "dia_fixo", "dia": 15, "meses_apos": 1, "ajuste": "postergar", "feriados": "nacional"}, "prazo_interno_dias_uteis": 1}');
select pg_temp.regra('U_CBS', '{"observacao": "Prazo a ser fixado em regulamento."}');
select pg_temp.regra('U_GUIA', '{"prazo_entrega": {"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "postergar"}, "prazo_pagamento": {"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "postergar"}}');

-- Empresa A em Porto Nacional (sem folha); Empresa B em Palmas
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.empresas set cidade = 'Porto Nacional', uf = 'TO', tem_empregados = false, tem_pro_labore = false where id = current_setting('testes.empresa_a')::uuid;
update public.empresas set cidade = 'Palmas', uf = 'TO' where id = current_setting('testes.empresa_b')::uuid;
reset role;

-- -------------------------------------------------------------- Lucro Real trimestral ou anual
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like(format($$select public.registrar_regime(%L, 'lucro_real', '2030-01-01')$$, current_setting('testes.empresa_b')),
                   '%trimestral ou anual%', 'Lucro Real exige a forma de apuração');
select lives_ok(format($$select public.registrar_regime(%L, 'lucro_real', '2030-01-01', 'trimestral', 'Opção de teste')$$, current_setting('testes.empresa_b')),
                'mudança para Lucro Real trimestral a partir de uma competência');
select throws_like(format($$select public.registrar_regime(%L, 'lucro_presumido', '2029-06-01')$$, current_setting('testes.empresa_b')),
                   '%depois desta competência%', 'não registra mudança antes de um período já cadastrado');
reset role;
select is(app.regime_em(current_setting('testes.empresa_b')::uuid, '2029-12-01') || '/' || app.regime_em(current_setting('testes.empresa_b')::uuid, '2030-01-01'),
          'lucro_presumido/lucro_real', 'período anterior encerrado no mês anterior à mudança');
select is(pg_temp.situacao('testes.empresa_b', 'U_IRPJ_TRIM', '2030-03-01') || '/' || pg_temp.situacao('testes.empresa_b', 'U_IRPJ_EST', '2030-03-01'),
          'aplica/nao_aplica', 'Lucro Real trimestral: só a obrigação trimestral');
select is(pg_temp.situacao('testes.empresa_b', 'U_IRPJ_TRIM', '2029-12-01'), 'aplica', 'competência anterior segue o Lucro Presumido');
update public.empresa_regimes set lucro_real_apuracao = null where empresa_id = current_setting('testes.empresa_b')::uuid and regime = 'lucro_real';
select is(pg_temp.situacao('testes.empresa_b', 'U_IRPJ_EST', '2030-03-01'), 'falta_cadastro', 'sem a forma de apuração, o calendário pede o cadastro');
update public.empresa_regimes set lucro_real_apuracao = 'anual' where empresa_id = current_setting('testes.empresa_b')::uuid and regime = 'lucro_real';
select is(pg_temp.situacao('testes.empresa_b', 'U_IRPJ_TRIM', '2030-03-01') || '/' || pg_temp.situacao('testes.empresa_b', 'U_IRPJ_EST', '2030-03-01'),
          'nao_aplica/aplica', 'Lucro Real anual: estimativa mensal, sem a trimestral');

-- -------------------------------------------------------------- folha (empregados ou pró-labore)
select is(pg_temp.situacao('testes.empresa_a', 'U_INSS', '2030-03-01'), 'nao_aplica', 'sem empregados nem pró-labore, sem obrigação da folha');
update public.empresas set tem_pro_labore = true where id = current_setting('testes.empresa_a')::uuid;
select is(pg_temp.situacao('testes.empresa_a', 'U_INSS', '2030-03-01'), 'aplica', 'pró-labore basta para obrigações da folha');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
update public.empresa_membros set permissoes = array_append(permissoes, 'empresa.editar')
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select throws_ok(format($$update public.empresas set tem_pro_labore = false where id = %L$$, current_setting('testes.empresa_a')), '42501', null,
                 'cliente não altera pró-labore/empregados');
reset role;

-- -------------------------------------------------------------- feriados por regra e prazo interno do escritório
insert into public.feriados (data, nome, abrangencia, municipio_ibge, tipo, fonte) values
  ('2030-04-15', 'Feriado municipal (teste)', 'municipal', '1718204', 'feriado', 'Teste'),
  ('2030-04-12', 'Feriado municipal anterior (teste)', 'municipal', '1718204', 'feriado', 'Teste')
on conflict do nothing;
insert into public.feriados (data, nome, abrangencia, uf, tipo, fonte) values ('2030-05-15', 'Feriado estadual (teste)', 'estadual', 'TO', 'feriado', 'Teste')
on conflict do nothing;
select is(app.calcular_prazo('{"tipo": "dia_fixo", "dia": 15, "meses_apos": 1, "ajuste": "postergar", "feriados": "nacional"}', '2030-03-01', 'TO', '1718204'),
          '2030-04-15'::date, 'regra federal ignora feriado municipal');
select is(app.calcular_prazo('{"tipo": "dia_fixo", "dia": 15, "meses_apos": 1, "ajuste": "postergar", "feriados": "municipal"}', '2030-03-01', 'TO', '1718204'),
          '2030-04-16'::date, 'regra local considera feriado municipal');
select is(app.calcular_prazo('{"tipo": "dia_fixo", "dia": 15, "meses_apos": 1, "ajuste": "postergar", "feriados": "estadual"}', '2030-04-01', 'TO', '1721000'),
          '2030-05-16'::date, 'regra estadual considera feriado do estado');
select is(app.calcular_prazo('{"tipo": "dia_fixo", "dia": 15, "meses_apos": 1, "ajuste": "postergar", "feriados": "estadual"}', '2030-03-01', 'TO', '1718204'),
          '2030-04-15'::date, 'regra estadual ignora feriado municipal');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.empresas set tem_pro_labore = true where id = current_setting('testes.empresa_b')::uuid;
select public.gerar_tarefas('2030-03-01', current_setting('testes.empresa_b')::uuid);
reset role;
select is((select prazo_legal || '/' || prazo_interno from public.tarefas
            where empresa_id = current_setting('testes.empresa_b')::uuid and obrigacao_id = pg_temp.obr('U_INSS') and competencia = '2030-03-01'),
          '2030-04-15/2030-04-10', 'empresa em Palmas: prazo legal federal; prazo interno conta os dias úteis do escritório (Porto Nacional)');

-- -------------------------------------------------------------- regra em vigor sem prazo
select is(pg_temp.situacao('testes.empresa_a', 'U_CBS', '2030-03-01'), 'sem_prazo', 'regra em vigor sem prazo aparece como "a regulamentar"');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gerar_tarefas('2030-03-01', current_setting('testes.empresa_a')::uuid);
reset role;
select is((select count(*)::int from public.tarefas where obrigacao_id = pg_temp.obr('U_CBS')), 0, 'sem prazo regulamentado, nenhuma tarefa com data presumida');

-- -------------------------------------------------------------- proposta: correção e rejeição
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('t.prop', public.propor_regra(pg_temp.obr('U_REJ'), 'Regra a rejeitar', null,
  '{"vigencia_inicio": "2025-01-01", "regimes": ["simples_nacional"], "municipios": ["1718204"], "prazo_pagamento": {"tipo": "dia_fixo", "dia": 10, "meses_apos": 1, "ajuste": "postergar", "feriados": "municipal"}}',
  'Norma de teste', null, null, '2026-10-02')::text, true);
select lives_ok(format($$select public.editar_proposta_regra(%L, 'Regra corrigida', null,
  '{"vigencia_inicio": "2025-01-01", "regimes": ["simples_nacional"], "municipios": ["1718204"], "prazo_pagamento": {"tipo": "dia_fixo", "dia": 12, "meses_apos": 1, "ajuste": "postergar", "feriados": "municipal"}}',
  'Norma de teste (corrigida)', null, null, '2026-10-02')$$, current_setting('t.prop')), 'proposta pode ser corrigida antes da validação');
reset role;
select is((select (r.prazo_pagamento ->> 'dia') || '/' || a.titulo from public.atualizacoes_normativas a join public.obrigacao_regras r on r.id = a.regra_proposta_id
            where a.id = current_setting('t.prop')::uuid), '12/Regra corrigida', 'correção altera a regra proposta e o título');
select is(pg_temp.situacao('testes.empresa_a', 'U_REJ', '2030-03-01'), 'aguardando_validacao', 'proposta pendente aparece no calendário');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok(format($$select public.rejeitar_atualizacao_normativa(%L, 'Fonte não confere com o texto oficial')$$, current_setting('t.prop')), 'administrador rejeita');
reset role;
select is((select r.status from public.atualizacoes_normativas a join public.obrigacao_regras r on r.id = a.regra_proposta_id where a.id = current_setting('t.prop')::uuid),
          'revogada', 'regra rejeitada deixa de contar');
select is(pg_temp.situacao('testes.empresa_a', 'U_REJ', '2030-03-01'), 'nao_aplica', 'depois da rejeição, não fica "aguardando validação"');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.editar_proposta_regra(%L, 'X', null, '{"vigencia_inicio": "2025-01-01", "regimes": ["mei"]}', 'Norma', null, null, '2026-10-02')$$, current_setting('t.prop')),
                   '%Somente propostas%', 'proposta rejeitada não é mais editada');
select throws_ok($$select public.recalcular_tarefas_abertas('teste')$$, '42501', null, 'recálculo geral só pelo administrador');
reset role;

-- -------------------------------------------------------------- sincronização após exclusão no calendário
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into public.empresa_obrigacoes (empresa_id, obrigacao_id, modo, vigencia_inicio, vigencia_fim, motivo)
values (current_setting('testes.empresa_b')::uuid, pg_temp.obr('U_INSS'), 'excluida', '2030-03-01', '2030-03-01', 'Sem folha neste mês (teste)');
select public.sincronizar_tarefas_empresa(current_setting('testes.empresa_b')::uuid, 'Teste');
reset role;
select is((select status || '/' || (dispensa_motivo like '%Sem folha neste mês%')::text from public.tarefas
            where empresa_id = current_setting('testes.empresa_b')::uuid and obrigacao_id = pg_temp.obr('U_INSS') and competencia = '2030-03-01'),
          'dispensada/true', 'exclusão por vigência dispensa a tarefa aberta, com o motivo');

-- -------------------------------------------------------------- vínculo automático: só guias
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gerar_tarefas(app.competencia_de(app.hoje()), current_setting('testes.empresa_a')::uuid);
select set_config('t.recibo', (public.criar_documento(current_setting('testes.empresa_a')::uuid, app.hoje(), 'esc_protocolo', 'recibo.pdf', 'application/pdf', 100, repeat('a', 64)) ->> 'versao_id'), true);
select set_config('t.guia', (public.criar_documento(current_setting('testes.empresa_a')::uuid, app.hoje(), 'esc_guia', 'guia.pdf', 'application/pdf', 100, repeat('b', 64)) ->> 'versao_id'), true);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
select 'documentos', v.storage_path, '00000000-0000-0000-0000-0000000000a1', jsonb_build_object('size', 100, 'mimetype', 'application/pdf')
  from public.documento_versoes v where v.id in (current_setting('t.recibo')::uuid, current_setting('t.guia')::uuid);
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.confirmar_upload(current_setting('t.recibo')::uuid);
reset role;
select is((select guia_documento_id from public.tarefas where empresa_id = current_setting('testes.empresa_a')::uuid and obrigacao_id = pg_temp.obr('U_GUIA') and etapa = 'pagamento'
              and competencia = app.competencia_de(app.hoje())),
          null::uuid, 'recibo de entrega não é ligado como guia');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.confirmar_upload(current_setting('t.guia')::uuid);
reset role;
select is((select d.nome_original from public.tarefas t join public.documentos d on d.id = t.guia_documento_id
            where t.empresa_id = current_setting('testes.empresa_a')::uuid and t.obrigacao_id = pg_temp.obr('U_GUIA') and t.etapa = 'pagamento'
              and t.competencia = app.competencia_de(app.hoje())),
          'guia.pdf', 'guia publicada é ligada à tarefa de pagamento');

select * from finish();
rollback;
