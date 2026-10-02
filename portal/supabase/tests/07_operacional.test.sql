-- Critérios: camada operacional interna. Regimes com histórico (inclui Lucro
-- Arbitrado); prazos só a partir de regra validada com fonte, com feriados
-- nacionais e municipais e datas diferentes por local; atualização normativa
-- só depois de validada; transição por vigência (PIS/COFINS → CBS) sem apagar
-- o histórico; tarefas por competência sem duplicidade, com etapas separadas,
-- comprovantes do portal e revisão; e nenhum acesso do cliente.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(79);

\ir 00_setup.sql.inc

create or replace function pg_temp.obr(p_codigo text) returns uuid language sql as $$
  select id from public.obrigacoes where codigo = p_codigo;
$$;
create or replace function pg_temp.tarefa(p_empresa text, p_codigo text, p_comp date, p_etapa text) returns uuid language sql as $$
  select id from public.tarefas
   where empresa_id = current_setting(p_empresa)::uuid and obrigacao_id = pg_temp.obr(p_codigo)
     and competencia = p_comp and etapa = p_etapa;
$$;
create or replace function pg_temp.qtd_tarefas(p_empresa text, p_codigo text, p_comp date) returns int language sql as $$
  select count(*)::int from public.tarefas
   where empresa_id = current_setting(p_empresa)::uuid and obrigacao_id = pg_temp.obr(p_codigo) and competencia = p_comp;
$$;
-- Documento enviado e confirmado (arquivo simulado no armazenamento)
create or replace function pg_temp.documento(p_usuario uuid, p_empresa text, p_comp date, p_categoria text, p_nome text, p_valor numeric default null)
returns uuid language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.como(p_usuario);
  set local role authenticated;
  v := public.criar_documento(current_setting(p_empresa)::uuid, p_comp, p_categoria, p_nome, 'application/pdf', 2048,
                              encode(extensions.digest(p_nome || p_empresa, 'sha256'), 'hex'), null, null, 'upload', false, null, null, p_valor);
  reset role;
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('documentos', v ->> 'storage_path', p_usuario, jsonb_build_object('size', 2048, 'mimetype', 'application/pdf'));
  perform pg_temp.como(p_usuario);
  set local role authenticated;
  perform public.confirmar_upload((v ->> 'versao_id')::uuid);
  reset role;
  return (v ->> 'documento_id')::uuid;
end;
$$;

-- Feriados usados nos testes (podem já existir no calendário oficial)
insert into public.feriados (data, nome, abrangencia, tipo, fonte)
values ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', 'feriado', 'Lei nº 14.759/2023')
on conflict do nothing;
insert into public.feriados (data, nome, abrangencia, municipio_ibge, tipo, fonte)
values ('2026-11-10', 'Feriado municipal fictício (teste)', 'municipal', '1718204', 'feriado', 'Teste automatizado')
on conflict do nothing;

-- Empresa A em Porto Nacional/TO e Empresa B em Palmas/TO; equipe 2 também atende a Empresa A
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.empresas set cidade = 'Porto Nacional', uf = 'TO', contribuinte_iss = true where id = current_setting('testes.empresa_a')::uuid;
update public.empresas set municipio_ibge = '1721000', contribuinte_iss = false where id = current_setting('testes.empresa_b')::uuid;
select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000a3', 'equipe');
reset role;

select is((select municipio_ibge from public.empresas where id = current_setting('testes.empresa_a')::uuid), '1718204',
          'cidade e UF informadas viram o código IBGE do município');
select is((select cidade || '/' || uf from public.empresas where id = current_setting('testes.empresa_b')::uuid), 'Palmas/TO',
          'município do IBGE preenche cidade e UF');

-- -------------------------------------------------------------- regimes
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
update public.empresa_regimes set inicio = '2026-01-01' where empresa_id = current_setting('testes.empresa_b')::uuid;
select lives_ok(format($$insert into public.empresa_regimes (empresa_id, regime, inicio, fim) values (%L, 'lucro_arbitrado', '2025-01-01', '2025-12-01')$$,
                       current_setting('testes.empresa_b')), 'histórico aceita Lucro Arbitrado com vigência');
select throws_like(format($$insert into public.empresa_regimes (empresa_id, regime, inicio) values (%L, 'lucro_real', '2025-06-01')$$,
                          current_setting('testes.empresa_b')), '%Já existe um regime%', 'períodos de regime não se sobrepõem');
update public.empresas set regime_tributario = 'lucro_real' where id = current_setting('testes.empresa_b')::uuid;
reset role;
select is(app.regime_em(current_setting('testes.empresa_b')::uuid, '2025-06-01'), 'lucro_arbitrado', 'regime de uma competência antiga vem do histórico');
select is(app.regime_em(current_setting('testes.empresa_b')::uuid, '2026-02-01'), 'lucro_presumido', 'período anterior à mudança preservado');
select is(app.regime_em(current_setting('testes.empresa_b')::uuid, app.competencia_de(app.hoje())), 'lucro_real',
          'mudança no cadastro vale a partir da competência atual');
select is((select count(*)::int from public.empresa_regimes where empresa_id = current_setting('testes.empresa_b')::uuid), 3,
          'mudança de regime fecha o período anterior e abre um novo');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok(format($$update public.empresas set regime_tributario = 'lucro_arbitrado' where id = %L$$, current_setting('testes.empresa_b')),
                'cadastro da empresa aceita Lucro Arbitrado');
reset role;

-- Cliente com permissão de editar a empresa não muda regime nem dados fiscais
update public.empresa_membros set permissoes = array_append(permissoes, 'empresa.editar')
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(format($$update public.empresas set regime_tributario = 'lucro_real' where id = %L$$, current_setting('testes.empresa_a')),
                 '42501', null, 'cliente não altera o regime tributário');
select throws_ok(format($$update public.empresas set contribuinte_icms = true where id = %L$$, current_setting('testes.empresa_a')),
                 '42501', null, 'cliente não altera dados fiscais');
select lives_ok(format($$update public.empresas set telefone = '63999990000' where id = %L$$, current_setting('testes.empresa_a')),
                'cliente com permissão ainda atualiza o contato');
reset role;

-- -------------------------------------------------------------- catálogo (somente administrador)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$insert into public.obrigacoes (codigo, nome, esfera, area, etapas, periodicidade) values ('T_X', 'X', 'federal', 'fiscal', '{pagamento}', 'mensal')$$,
                 '42501', null, 'equipe não altera o catálogo de obrigações');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
insert into public.obrigacoes (codigo, nome, esfera, area, tributos, etapas, periodicidade, categorias_documento) values
  ('T_DAS', 'DAS (teste)', 'federal', 'fiscal', '{SIMPLES}', '{apuracao,entrega,pagamento}', 'mensal', '{esc_guia}'),
  ('T_ISS', 'ISS (teste)', 'municipal', 'fiscal', '{ISS}', '{apuracao,pagamento}', 'mensal', '{}'),
  ('T_IRPJ', 'IRPJ trimestral (teste)', 'federal', 'fiscal', '{IRPJ,CSLL}', '{apuracao,pagamento}', 'trimestral', '{}'),
  ('T_PIS', 'PIS/COFINS (teste)', 'federal', 'fiscal', '{PIS,COFINS}', '{apuracao,pagamento}', 'mensal', '{}'),
  ('T_CBS', 'CBS (teste)', 'federal', 'fiscal', '{CBS}', '{apuracao,pagamento}', 'mensal', '{}');
reset role;
select is((select count(*)::int from public.obrigacoes where codigo like 'T\_%'), 5, 'administrador cadastra obrigações no catálogo');

-- -------------------------------------------------------------- proposta → validação → aplicação
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.propor_regra(%L, 'DAS', null, '{"vigencia_inicio": "2026-01-01", "regimes": ["simples_nacional"], "prazo_pagamento": {"tipo": "dia_fixo", "dia": 20}}',
                                 'Resolução CGSN nº 140/2018', null, null, '2026-10-02')$$, pg_temp.obr('T_DAS')),
                   '%inválida%', 'regra de prazo incompleta é recusada');
select throws_like(format($$select public.propor_regra(%L, 'DAS', null, '{"vigencia_inicio": "2026-01-01", "regimes": ["simples_nacional"]}', '', null, null, null)$$, pg_temp.obr('T_DAS')),
                   '%fonte oficial%', 'proposta sem fonte oficial é recusada');
select set_config('t.prop_das', public.propor_regra(pg_temp.obr('T_DAS'), 'DAS — vencimento no dia 20', 'Dia 20 do mês seguinte; se não houver expediente, próximo dia útil.',
  '{"vigencia_inicio": "2026-01-01", "regimes": ["simples_nacional"],
    "prazo_entrega": {"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "postergar"},
    "prazo_pagamento": {"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "postergar", "calendario": "expediente_bancario"},
    "prazo_interno_dias_uteis": 2}',
  'Resolução CGSN nº 140/2018, art. 40', 'https://normas.receita.fazenda.gov.br/', null, '2026-10-02')::text, true);
select is((select situacao from public.calendario_empresa(current_setting('testes.empresa_a')::uuid, '2026-10-01') where codigo = 'T_DAS'),
          'aguardando_validacao', 'regra proposta não gera prazo: aparece como aguardando validação');
select is(public.gerar_tarefas('2026-10-01', current_setting('testes.empresa_a')::uuid), 0, 'sem regra validada nenhuma tarefa é criada');
select throws_ok(format($$select public.validar_atualizacao_normativa(%L)$$, current_setting('t.prop_das')), '42501', null,
                 'equipe não valida atualização normativa');
select throws_ok(format($$select public.aplicar_atualizacao_normativa(%L)$$, current_setting('t.prop_das')), '42501', null,
                 'equipe não aplica atualização normativa');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like(format($$select public.aplicar_atualizacao_normativa(%L)$$, current_setting('t.prop_das')), '%Valide%',
                   'aplicação exige validação prévia');
select lives_ok(format($$select public.validar_atualizacao_normativa(%L, 'Fonte conferida.')$$, current_setting('t.prop_das')), 'administrador valida a fonte');
select is(public.gerar_tarefas('2026-10-01', current_setting('testes.empresa_a')::uuid), 0, 'validada mas ainda não aplicada: nada muda');
select lives_ok(format($$select public.aplicar_atualizacao_normativa(%L)$$, current_setting('t.prop_das')), 'administrador aplica');
reset role;
select is((select status from public.atualizacoes_normativas where id = current_setting('t.prop_das')::uuid), 'aplicada', 'atualização registrada como aplicada');
select is((select r.status from public.obrigacao_regras r join public.atualizacoes_normativas a on a.regra_proposta_id = r.id
            where a.id = current_setting('t.prop_das')::uuid), 'validada', 'regra passa a valer somente após a aplicação');

-- -------------------------------------------------------------- tarefas e prazos
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.gerar_tarefas('2026-10-01', current_setting('testes.empresa_a')::uuid);
select is(public.gerar_tarefas('2026-10-01', current_setting('testes.empresa_a')::uuid), 0, 'gerar de novo não duplica tarefas');
reset role;
select is(pg_temp.qtd_tarefas('testes.empresa_a', 'T_DAS', '2026-10-01'), 3, 'apuração, entrega e pagamento são tarefas separadas');
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'pagamento')), '2026-11-23'::date,
          'vencimento em feriado nacional (20/11) passa para o próximo dia útil');
select is((select prazo_interno from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'pagamento')), '2026-11-18'::date,
          'prazo interno: 2 dias úteis antes do vencimento, pulando o feriado');
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'apuracao')), null::date,
          'apuração não tem prazo legal próprio, só prazo interno');
select is((select responsavel_id from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'pagamento')),
          '00000000-0000-0000-0000-0000000000a2'::uuid, 'responsável padrão é o contador da empresa');

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gerar_tarefas('2026-10-01', current_setting('testes.empresa_b')::uuid);
reset role;
select is(pg_temp.qtd_tarefas('testes.empresa_b', 'T_DAS', '2026-10-01'), 0, 'empresa de outro regime não recebe a obrigação');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select situacao from public.calendario_empresa(current_setting('testes.empresa_b')::uuid, '2026-10-01') where codigo = 'T_DAS'),
          'nao_aplica', 'calendário explica que não se aplica ao regime');
select is((select situacao from public.calendario_empresa(current_setting('testes.empresa_a')::uuid, '2026-10-01') where codigo = 'T_ISS'),
          'sem_regra', 'obrigação municipal sem regra validada não ganha data presumida');
reset role;

-- Regras municipais: datas diferentes por município e feriado local
insert into public.obrigacao_regras (obrigacao_id, vigencia_inicio, regimes, municipios, exige_iss, prazo_pagamento, fonte_titulo, fonte_consultada_em, status)
values (pg_temp.obr('T_ISS'), '2026-01-01', app.regimes_validos(), '{1718204}', true,
        '{"tipo": "dia_fixo", "dia": 10, "meses_apos": 1, "ajuste": "postergar"}', 'Código Tributário de Porto Nacional (teste)', '2026-10-02', 'validada'),
       (pg_temp.obr('T_ISS'), '2026-01-01', app.regimes_validos(), '{1721000}', true,
        '{"tipo": "dia_fixo", "dia": 15, "meses_apos": 1, "ajuste": "postergar"}', 'Código Tributário de Palmas (teste)', '2026-10-02', 'validada');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select situacao from public.calendario_empresa(current_setting('testes.empresa_b')::uuid, '2026-10-01') where codigo = 'T_ISS'),
          'nao_aplica', 'empresa que não é contribuinte do ISS não recebe a obrigação');
update public.empresas set contribuinte_iss = true where id = current_setting('testes.empresa_b')::uuid;
select public.gerar_tarefas('2026-10-01', null);
reset role;
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_ISS', '2026-10-01', 'pagamento')), '2026-11-11'::date,
          'Porto Nacional: dia 10 é feriado municipal, vence no dia útil seguinte');
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_b', 'T_ISS', '2026-10-01', 'pagamento')), '2026-11-16'::date,
          'Palmas: regra própria (dia 15, domingo) → dia útil seguinte; datas diferentes por empresa');

-- Periodicidade trimestral
insert into public.obrigacao_regras (obrigacao_id, vigencia_inicio, regimes, prazo_pagamento, fonte_titulo, fonte_consultada_em, status)
values (pg_temp.obr('T_IRPJ'), '2025-01-01', '{lucro_presumido,lucro_real,lucro_arbitrado}',
        '{"tipo": "ultimo_dia_util", "meses_apos": 1}', 'Lei nº 9.430/1996, art. 5º (teste)', '2026-10-02', 'validada');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gerar_tarefas('2026-08-01', current_setting('testes.empresa_b')::uuid);
select public.gerar_tarefas('2026-09-01', current_setting('testes.empresa_b')::uuid);
reset role;
select is(pg_temp.qtd_tarefas('testes.empresa_b', 'T_IRPJ', '2026-08-01'), 0, 'trimestral: sem tarefa fora do fim do trimestre');
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_b', 'T_IRPJ', '2026-09-01', 'pagamento')), '2026-10-30'::date,
          'trimestral: último dia útil do mês seguinte ao trimestre');

-- -------------------------------------------------------------- transição da reforma por vigência
insert into public.obrigacao_regras (obrigacao_id, vigencia_inicio, vigencia_fim, regimes, prazo_pagamento, fonte_titulo, fonte_consultada_em, status)
values (pg_temp.obr('T_PIS'), '2025-01-01', '2026-12-01', '{lucro_presumido,lucro_real,lucro_arbitrado}',
        '{"tipo": "dia_fixo", "dia": 25, "meses_apos": 1, "ajuste": "antecipar"}', 'Lei nº 10.637/2002 (teste)', '2026-10-02', 'validada'),
       (pg_temp.obr('T_CBS'), '2027-01-01', null, '{lucro_presumido,lucro_real,lucro_arbitrado}',
        '{"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "antecipar"}', 'LC nº 214/2025 (teste)', '2026-10-02', 'validada');
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select string_agg(codigo || ':' || situacao, ',' order by codigo) from public.calendario_empresa(current_setting('testes.empresa_b')::uuid, '2026-12-01')
            where codigo in ('T_PIS', 'T_CBS')), 'T_CBS:fora_da_vigencia,T_PIS:aplica', 'dezembro/2026: PIS/COFINS vale, CBS ainda não');
select is((select string_agg(codigo || ':' || situacao, ',' order by codigo) from public.calendario_empresa(current_setting('testes.empresa_b')::uuid, '2027-01-01')
            where codigo in ('T_PIS', 'T_CBS')), 'T_CBS:aplica,T_PIS:fora_da_vigencia', 'janeiro/2027: CBS passa a valer, PIS/COFINS sai do calendário');
select public.gerar_tarefas('2026-12-01', current_setting('testes.empresa_b')::uuid);
select public.gerar_tarefas('2027-01-01', current_setting('testes.empresa_b')::uuid);
reset role;
select is(pg_temp.qtd_tarefas('testes.empresa_b', 'T_PIS', '2026-12-01') || '/' || pg_temp.qtd_tarefas('testes.empresa_b', 'T_CBS', '2026-12-01')
          || '/' || pg_temp.qtd_tarefas('testes.empresa_b', 'T_PIS', '2027-01-01') || '/' || pg_temp.qtd_tarefas('testes.empresa_b', 'T_CBS', '2027-01-01'),
          '2/0/0/2', 'tarefas seguem a vigência de cada tributo e o histórico de PIS/COFINS permanece');

-- -------------------------------------------------------------- comprovantes e revisão
select set_config('t.doc_b', pg_temp.documento('00000000-0000-0000-0000-0000000000c1', 'testes.empresa_b', '2026-10-01', 'comprovante', 'comprovante-b.pdf')::text, true);
select set_config('t.comprovante', pg_temp.documento('00000000-0000-0000-0000-0000000000b1', 'testes.empresa_a', '2026-11-01', 'comprovante', 'pagamento-das.pdf')::text, true);
select set_config('t.recibo', pg_temp.documento('00000000-0000-0000-0000-0000000000a2', 'testes.empresa_a', '2026-10-01', 'esc_protocolo', 'recibo-pgdas.pdf')::text, true);
select set_config('t.pag', pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'pagamento')::text, true);
select set_config('t.ent', pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'entrega')::text, true);
select set_config('t.apu', pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'apuracao')::text, true);

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.atualizar_tarefa(%L, 'concluida')$$, current_setting('t.pag')), '%comprovante de pagamento%',
                   'não marca como pago sem comprovante');
select throws_like(format($$select public.atualizar_tarefa(%L, 'concluida')$$, current_setting('t.ent')), '%recibo ou protocolo%',
                   'não marca como transmitido sem recibo');
select throws_like(format($$select public.atualizar_tarefa(%L, 'concluida', null, %L)$$, current_setting('t.pag'), current_setting('t.doc_b')),
                   '%documento recebido desta empresa%', 'comprovante de outra empresa é recusado');
select lives_ok(format($$select public.atualizar_tarefa(%L, 'concluida', 'Recibo anexado', %L, null, '12345678901234567890')$$, current_setting('t.ent'), current_setting('t.recibo')),
                'entrega concluída com o recibo publicado no portal');
select lives_ok(format($$select public.atualizar_tarefa(%L, p_revisor_id => '00000000-0000-0000-0000-0000000000a3')$$, current_setting('t.pag')),
                'revisor definido para o pagamento');
select throws_like(format($$select public.atualizar_tarefa(%L, 'concluida', null, %L)$$, current_setting('t.pag'), current_setting('t.comprovante')),
                   '%revisor%', 'com revisor, quem executa não conclui sozinho');
select lives_ok(format($$select public.atualizar_tarefa(%L, 'em_revisao', 'Comprovante do cliente conferido', %L)$$, current_setting('t.pag'), current_setting('t.comprovante')),
                'tarefa enviada para revisão com o comprovante enviado pelo cliente');
select throws_like(format($$select public.atualizar_tarefa(%L, 'dispensada')$$, current_setting('t.apu')), '%Explique%', 'dispensa exige motivo');
select lives_ok(format($$select public.atualizar_tarefa(%L, 'dispensada', null, null, null, null, null, 'Sem movimento no mês')$$, current_setting('t.apu')),
                'dispensa com motivo');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select lives_ok(format($$select public.atualizar_tarefa(%L, 'concluida', 'Revisado')$$, current_setting('t.pag')), 'revisor conclui');
reset role;
select is((select status || '/' || concluida_por::text || '/' || (revisada_em is not null)::text from public.tarefas where id = current_setting('t.pag')::uuid),
          'concluida/00000000-0000-0000-0000-0000000000a3/true', 'conclusão registra quem revisou');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.atualizar_tarefa(%L, 'pendente')$$, current_setting('t.pag')), '%Só quem concluiu%',
                   'outra pessoa da equipe não reabre a tarefa concluída');
reset role;
select ok((select count(*) >= 3 from public.tarefa_historico where tarefa_id = current_setting('t.pag')::uuid), 'histórico da tarefa registrado');

-- Guia publicada pelo escritório é ligada à tarefa de pagamento (sem marcar como paga)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.gerar_tarefas('2026-11-01', current_setting('testes.empresa_a')::uuid);
reset role;
select set_config('t.guia', pg_temp.documento('00000000-0000-0000-0000-0000000000a2', 'testes.empresa_a', '2026-11-01', 'esc_guia', 'das-novembro.pdf', 99.90)::text, true);
select is((select guia_documento_id::text || '/' || valor::text || '/' || status from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-11-01', 'pagamento')),
          current_setting('t.guia') || '/99.90/pendente', 'guia publicada no portal entra na tarefa, que continua pendente');

-- -------------------------------------------------------------- calendário por empresa e vigência
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok(format($$insert into public.empresa_obrigacoes (empresa_id, obrigacao_id, modo, vigencia_inicio, vigencia_fim) values (%L, %L, 'excluida', '2027-01-01', '2027-01-01')$$,
                        current_setting('testes.empresa_a'), pg_temp.obr('T_DAS')), '23514', null, 'exclusão sem motivo é recusada');
select lives_ok(format($$insert into public.empresa_obrigacoes (empresa_id, obrigacao_id, modo, vigencia_inicio, vigencia_fim, motivo) values (%L, %L, 'excluida', '2027-01-01', '2027-01-01', 'Parcelamento especial (teste)')$$,
                       current_setting('testes.empresa_a'), pg_temp.obr('T_DAS')), 'exclusão com motivo e vigência');
select throws_ok(format($$insert into public.empresa_obrigacoes (empresa_id, obrigacao_id, modo, vigencia_inicio, motivo) values (%L, %L, 'incluida', '2027-01-01', 'Inclusão (teste)')$$,
                        current_setting('testes.empresa_b'), pg_temp.obr('T_DAS')), '42501', null, 'equipe não configura empresa que não atende');
select public.gerar_tarefas('2027-01-01', current_setting('testes.empresa_a')::uuid);
select public.gerar_tarefas('2027-02-01', current_setting('testes.empresa_a')::uuid);
select is((select situacao from public.calendario_empresa(current_setting('testes.empresa_a')::uuid, '2027-01-01') where codigo = 'T_DAS'), 'excluida',
          'calendário mostra a exclusão na competência');
reset role;
select is(pg_temp.qtd_tarefas('testes.empresa_a', 'T_DAS', '2027-01-01') || '/' || pg_temp.qtd_tarefas('testes.empresa_a', 'T_DAS', '2027-02-01'), '0/3',
          'exclusão vale só na vigência configurada');
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2027-02-01', 'pagamento')), '2027-03-22'::date,
          'dia 20 num sábado → próximo dia útil');

-- -------------------------------------------------------------- mudança normativa e revogação
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('t.regra_das', (select regra_proposta_id::text from public.atualizacoes_normativas where id = current_setting('t.prop_das')::uuid), true);
select set_config('t.alt_das', public.propor_regra(pg_temp.obr('T_DAS'), 'DAS — novo vencimento (teste)', null,
  '{"vigencia_inicio": "2027-02-01", "regimes": ["simples_nacional"],
    "prazo_entrega": {"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "postergar"},
    "prazo_pagamento": {"tipo": "dia_fixo", "dia": 18, "meses_apos": 1, "ajuste": "antecipar"}}',
  'Norma fictícia de teste', null, '2026-12-15', '2026-12-16', current_setting('t.regra_das')::uuid)::text, true);
select set_config('t.regra_iss_palmas', (select id::text from public.obrigacao_regras where obrigacao_id = pg_temp.obr('T_ISS') and municipios = '{1721000}'), true);
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gerar_tarefas('2027-01-01', current_setting('testes.empresa_b')::uuid);
select public.validar_atualizacao_normativa(current_setting('t.alt_das')::uuid);
select ok((public.aplicar_atualizacao_normativa(current_setting('t.alt_das')::uuid) ->> 'tarefas_recalculadas')::int >= 1, 'tarefas abertas recalculadas pela nova regra');
select set_config('t.rev_iss', public.propor_revogacao(current_setting('t.regra_iss_palmas')::uuid, 'ISS de Palmas — regra encerrada (teste)', null, '2027-01-01',
                                                        'Lei municipal fictícia (teste)', null, null, '2026-12-16')::text, true);
select public.validar_atualizacao_normativa(current_setting('t.rev_iss')::uuid);
select public.aplicar_atualizacao_normativa(current_setting('t.rev_iss')::uuid);
reset role;
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2027-02-01', 'pagamento')), '2027-03-18'::date,
          'tarefa aberta da nova vigência ganhou o novo vencimento');
select is((select prazo_legal from public.tarefas where id = pg_temp.tarefa('testes.empresa_a', 'T_DAS', '2026-10-01', 'pagamento')), '2026-11-23'::date,
          'competências anteriores à mudança ficam como estavam');
select is((select vigencia_fim from public.obrigacao_regras where id = current_setting('t.regra_das')::uuid), '2027-01-01'::date,
          'regra anterior encerrada no mês anterior à nova vigência');
select is((select status from public.tarefas where id = pg_temp.tarefa('testes.empresa_b', 'T_ISS', '2027-01-01', 'pagamento')), 'dispensada',
          'revogação dispensa as tarefas abertas a partir da vigência, com motivo');
select is((select status from public.tarefas where id = pg_temp.tarefa('testes.empresa_b', 'T_ISS', '2026-10-01', 'pagamento')), 'pendente',
          'tarefas anteriores à revogação continuam no histórico');
select throws_like(format($$update public.obrigacao_regras set prazo_pagamento = '{"tipo": "ultimo_dia_util", "meses_apos": 1}' where id = %L$$, current_setting('t.regra_das')),
                   '%Regra validada não pode ser alterada%', 'regra validada só muda por atualização normativa');

-- -------------------------------------------------------------- visões e simulação
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select string_agg(razao_social, ',') from public.operacional_empresas()), 'Empresa A Comércio Ltda', 'equipe vê só as empresas que atende');
select is((select prazo_pagamento from public.simular_regra('{"prazo_pagamento": {"tipo": "dia_fixo", "dia": 20, "meses_apos": 1, "ajuste": "postergar"}}', 'mensal',
            '2026-11-01', 1, null, 'TO', '1718204')), '2026-12-21'::date, 'simulação calcula a regra antes de propor');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from public.operacional_empresas()), 2, 'administrador vê todas as empresas');
reset role;

-- -------------------------------------------------------------- cliente não acessa a camada operacional
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.tarefas) + (select count(*)::int from public.obrigacoes) + (select count(*)::int from public.obrigacao_regras)
          + (select count(*)::int from public.empresa_regimes) + (select count(*)::int from public.tarefa_historico)
          + (select count(*)::int from public.atualizacoes_normativas) + (select count(*)::int from public.empresa_obrigacoes)
          + (select count(*)::int from public.feriados), 0, 'cliente não enxerga tarefas, catálogo, regras, regimes ou feriados');
select is((select count(*)::int from public.operacional_empresas()), 0, 'cliente não vê a tabela operacional');
select throws_ok(format($$select * from public.calendario_empresa(%L, '2026-10-01')$$, current_setting('testes.empresa_a')), '42501', null,
                 'cliente não consulta o calendário de obrigações');
select throws_ok($$select public.gerar_tarefas('2026-10-01')$$, '42501', null, 'cliente não gera tarefas');
select throws_ok(format($$select public.atualizar_tarefa(%L, 'concluida')$$, current_setting('t.pag')), '42501', null, 'cliente não altera tarefas');
select throws_ok($$select public.rotina_operacional()$$, '42501', null, 'rotina diária só pelo servidor');
reset role;

select * from finish();
rollback;
