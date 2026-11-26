-- Gestão de RH e quadro de tarefas recorrentes: cargo com modelos, funcionário
-- ligado ao acesso do portal, geração sem duplicar, pátio só com foto, área e
-- semana, conferência do estoque, fechamento do caixa (só a tarefa do dia,
-- reprocessar não muda nada), sugestão confirmada por uma pessoa, conciliação
-- só com todos os movimentos e depois do envio do extrato, dependências sem
-- ciclo, a semana seguinte sem mexer na anterior e isolamento.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(40);

\ir 00_setup.sql.inc

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

-- Permissões: titular gerencia; colaborador faz as próprias tarefas
select ok((select permissoes @> array['rh.gerenciar', 'rh.tarefas'] from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'), 'titular gerencia a equipe e as tarefas');
select ok((select 'rh.tarefas' = any(permissoes) and not ('rh.gerenciar' = any(permissoes)) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2'), 'colaborador faz só as próprias tarefas');

-- Gestor: cargo, funcionário ligado ao acesso do colaborador e modelos
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.cargo', public.rh_cargo_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Auxiliar de pátio", "descricao": "Cuida do pátio e da conferência do estoque."}')::text, true);
insert into public.escala_funcionarios (empresa_id, nome, cargo_id, usuario_id)
values (current_setting('testes.empresa_a')::uuid, 'Fulano Fictício', current_setting('testes.cargo')::uuid, '00000000-0000-0000-0000-0000000000b2');
select set_config('testes.func', (select id::text from public.escala_funcionarios where nome = 'Fulano Fictício'), true);
select is((select cargo from public.escala_funcionarios where id = current_setting('testes.func')::uuid), 'Auxiliar de pátio', 'o nome do cargo vai para o cadastro (a escala continua igual)');
select throws_like($$insert into public.escala_funcionarios (empresa_id, nome, usuario_id) values (current_setting('testes.empresa_a')::uuid, 'Outro', '00000000-0000-0000-0000-0000000000c1')$$,
  '%não é de alguém que entra nesta empresa%', 'acesso de quem não é da empresa é recusado');

select set_config('testes.patio', public.rh_modelo_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Organização do pátio', 'periodicidade', 'semanal', 'dia_semana', 6, 'hora_limite', '12:00',
  'exige_foto', true, 'exige_area', true, 'exige_semana', true))::text, true);
-- O gestor liga o modelo ao cargo pela tela do cargo
select public.rh_cargo_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.cargo')::uuid,
  jsonb_build_object('nome', 'Auxiliar de pátio', 'descricao', 'Cuida do pátio.', 'modelos', jsonb_build_array(current_setting('testes.patio'))));
select is((select cargo_id::text from public.rh_tarefa_modelos where id = current_setting('testes.patio')::uuid), current_setting('testes.cargo'), 'modelo ligado ao cargo');
select is((select count(*)::int from public.rh_tarefas where modelo_id = current_setting('testes.patio')::uuid), 1, 'a tarefa da semana foi criada');
select set_config('testes.t_patio', (select id::text from public.rh_tarefas where modelo_id = current_setting('testes.patio')::uuid), true);
-- Ainda sem responsável (o funcionário entrou no cargo depois do modelo): o gestor atribui
select public.rh_tarefa_atribuir(current_setting('testes.t_patio')::uuid, current_setting('testes.func')::uuid);
select is((select responsavel_id::text from public.rh_tarefas where id = current_setting('testes.t_patio')::uuid), current_setting('testes.func'), 'gestor atribui a tarefa ao funcionário');
reset role;

-- Geração sem duplicar (a rotina pode rodar mais de uma vez)
select is(app.rh_gerar(current_setting('testes.patio')::uuid, app.hoje())::text, current_setting('testes.t_patio'), 'gerar de novo devolve a mesma tarefa');
select public.rotina_rh_tarefas();
select public.rotina_rh_tarefas();
select is((select count(*)::int from public.rh_tarefas where modelo_id = current_setting('testes.patio')::uuid), 1, 'rotina diária rodada duas vezes: nenhuma duplicata');

-- Funcionário vê a própria tarefa; outra empresa não vê nada
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.rh_tarefas where id = current_setting('testes.t_patio')::uuid), 1, 'funcionário vê a tarefa atribuída a ele');
select throws_ok(format($$select public.rh_modelo_salvar(%L, null, '{"titulo": "X", "periodicidade": "diaria", "dias_semana": [1]}')$$, current_setting('testes.empresa_a')),
  '42501', null, 'funcionário não cria modelos');
-- Pátio: só conclui com foto, área e semana
select throws_like(format($$select public.rh_tarefa_concluir(%L, '{"area": "Pátio dos fundos", "semana": "%s"}')$$, current_setting('testes.t_patio'), app.hoje()),
  '%Anexe uma foto%', 'sem foto não conclui');
reset role;
insert into public.rh_tarefa_evidencias (empresa_id, tarefa_id, caminho, mime, tamanho, enviado_por, confirmado_em)
values (current_setting('testes.empresa_a')::uuid, current_setting('testes.t_patio')::uuid,
        current_setting('testes.empresa_a') || '/' || current_setting('testes.t_patio') || '/foto.jpg', 'image/jpeg', 1000, '00000000-0000-0000-0000-0000000000b2', now());
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.rh_tarefa_concluir(%L, '{"semana": "%s"}')$$, current_setting('testes.t_patio'), app.hoje()),
  '%Informe a área%', 'sem área não conclui');
select throws_like(format($$select public.rh_tarefa_concluir(%L, '{"area": "Pátio dos fundos"}')$$, current_setting('testes.t_patio')),
  '%semana de referência%', 'sem semana não conclui');
select throws_like(format($$select public.rh_tarefa_concluir(%L, '{"area": "Pátio dos fundos", "semana": "%s"}')$$, current_setting('testes.t_patio'), app.hoje() - 14),
  '%não é a desta tarefa%', 'semana errada não conclui');
select lives_ok(format($$select public.rh_tarefa_concluir(%L, '{"area": "Pátio dos fundos", "semana": "%s"}')$$, current_setting('testes.t_patio'), app.hoje()),
  'com foto, área e semana conclui');
reset role;
select is((select (status, origem_conclusao, concluida_por::text, area, semana_referencia = app.rh_semana(app.hoje()))::text from public.rh_tarefas where id = current_setting('testes.t_patio')::uuid),
  '(concluida,manual,00000000-0000-0000-0000-0000000000b2,"Pátio dos fundos",t)', 'registro: manual, quem concluiu, área e semana');
select ok((select concluida_em is not null from public.rh_tarefas where id = current_setting('testes.t_patio')::uuid), 'data e hora da conclusão registradas');
-- A semana seguinte nasce sem mexer na anterior
select set_config('testes.concluida_em', (select concluida_em::text from public.rh_tarefas where id = current_setting('testes.t_patio')::uuid), true);
select is((select (periodo_inicio, status)::text from public.rh_tarefas where modelo_id = current_setting('testes.patio')::uuid and periodo_inicio > app.hoje() - 7 and id <> current_setting('testes.t_patio')::uuid),
  format('(%s,a_fazer)', app.rh_semana(app.hoje()) + 7), 'a próxima semana foi criada (A fazer)');
select public.rotina_rh_tarefas();
select is((select (status, concluida_em::text)::text from public.rh_tarefas where id = current_setting('testes.t_patio')::uuid),
  format('(concluida,"%s")', current_setting('testes.concluida_em')), 'a conclusão da semana anterior não mudou');
select is((select count(*)::int from public.rh_tarefas where modelo_id = current_setting('testes.patio')::uuid), 2, 'duas semanas, sem duplicata');

-- Conferência do estoque: o funcionário confirma; o histórico mostra quem e quando
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.conf', public.rh_modelo_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Conferência de estoque', 'periodicidade', 'semanal', 'regra', 'conferencia_estoque', 'responsavel_id', current_setting('testes.func')))::text, true);
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is(public.rh_confirmar_conferencia_estoque(current_setting('testes.empresa_a')::uuid, 'Prateleiras A e B') ->> 'situacao', 'concluida', 'funcionário confirma a conferência');
reset role;
select is((select (t.status, t.origem_conclusao)::text from public.rh_tarefas t where t.modelo_id = current_setting('testes.conf')::uuid and t.periodo_inicio = app.rh_semana(app.hoje())),
  '(concluida,automatica)', 'tarefa da semana concluída pela conferência');
select is((select (c.conferido_por::text, c.tarefa_id is not null)::text from public.estoque_conferencias c where c.empresa_id = current_setting('testes.empresa_a')::uuid),
  '(00000000-0000-0000-0000-0000000000b2,t)', 'conferência registrada com quem conferiu e ligada à tarefa');
select ok((select count(*) = 1 from public.rh_tarefa_eventos e join public.rh_tarefas t on t.id = e.tarefa_id
            where t.modelo_id = current_setting('testes.conf')::uuid and e.tipo = 'concluida' and e.origem = 'automatica'
              and e.usuario = '00000000-0000-0000-0000-0000000000b2' and e.em is not null), 'histórico: conclusão automática, quem e quando');

-- Fechamento do caixa: conclui só a tarefa do dia do caixa; reprocessar não muda nada
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.cx', public.rh_modelo_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Fechamento do caixa', 'periodicidade', 'diaria', 'regra', 'fechamento_caixa', 'dias_semana', jsonb_build_array(1, 2, 3, 4, 5, 6, 7)))::text, true);
-- Modelo sem o dia de hoje: o fechamento de hoje vira sugestão para a tarefa aberta de ontem
select set_config('testes.cx2', public.rh_modelo_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'titulo', 'Fechamento do caixa 2', 'periodicidade', 'diaria', 'regra', 'fechamento_caixa',
  'dias_semana', (select jsonb_agg(d) from generate_series(1, 7) d where d <> extract(isodow from app.hoje())::int)))::text, true);
reset role;
select set_config('testes.t_ontem', app.rh_gerar(current_setting('testes.cx')::uuid, app.hoje() - 1)::text, true);
select set_config('testes.t2_ontem', app.rh_gerar(current_setting('testes.cx2')::uuid, app.hoje() - 1)::text, true);
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.sessao', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 100)::text, true);
select public.gestao_caixa_fechar(current_setting('testes.sessao')::uuid, 100, null);
reset role;
select is((select (status, origem_conclusao)::text from public.rh_tarefas where modelo_id = current_setting('testes.cx')::uuid and periodo_inicio = app.hoje()),
  '(concluida,automatica)', 'caixa fechado conclui a tarefa do dia');
select is((select status from public.rh_tarefas where id = current_setting('testes.t_ontem')::uuid), 'a_fazer', 'a tarefa de outro dia não muda');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.rh_reprocessar_caixa(current_setting('testes.sessao')::uuid);
reset role;
select app.rh_avaliar_caixa(current_setting('testes.empresa_a')::uuid, app.hoje());
select is((select count(*)::int from public.rh_tarefa_vinculos v join public.rh_tarefas t on t.id = v.tarefa_id
            where t.modelo_id = current_setting('testes.cx')::uuid and v.registro_id = current_setting('testes.sessao')::uuid), 1, 'processado de novo: um vínculo só');
select is((select count(*)::int from public.rh_tarefa_eventos e join public.rh_tarefas t on t.id = e.tarefa_id
            where t.modelo_id = current_setting('testes.cx')::uuid and t.periodo_inicio = app.hoje() and e.tipo = 'concluida'), 1, 'processado de novo: uma conclusão só');
-- Sugestão: não conclui sozinha; uma pessoa confirma
select is((select (t.status, v.situacao)::text from public.rh_tarefa_vinculos v join public.rh_tarefas t on t.id = v.tarefa_id
            where t.id = current_setting('testes.t2_ontem')::uuid), '(a_fazer,sugerido)', 'registro duvidoso fica como sugestão (não conclui)');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.rh_vinculo_confirmar((select v.id from public.rh_tarefa_vinculos v where v.tarefa_id = current_setting('testes.t2_ontem')::uuid));
reset role;
select is((select (status, origem_conclusao)::text from public.rh_tarefas where id = current_setting('testes.t2_ontem')::uuid), '(concluida,automatica)', 'confirmada por uma pessoa, conclui');

-- Conciliação: só com todos os movimentos da semana e depois do envio do extrato
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.rh_criar_rotinas_iniciais(current_setting('testes.empresa_a')::uuid, array['envio_extrato', 'conciliacao_semanal']);
reset role;
select set_config('testes.t_envio', (select t.id::text from public.rh_tarefas t join public.rh_tarefa_modelos m on m.id = t.modelo_id
  where m.empresa_id = current_setting('testes.empresa_a')::uuid and m.chave_rotina = 'envio_extrato' and t.periodo_inicio = app.rh_semana(app.hoje())), true);
select set_config('testes.t_conc', (select t.id::text from public.rh_tarefas t join public.rh_tarefa_modelos m on m.id = t.modelo_id
  where m.empresa_id = current_setting('testes.empresa_a')::uuid and m.chave_rotina = 'conciliacao_semanal' and t.periodo_inicio = app.rh_semana(app.hoje())), true);
select is((select count(*)::int from public.rh_tarefa_dependencias where tarefa_id = current_setting('testes.t_conc')::uuid and depende_de_id = current_setting('testes.t_envio')::uuid), 1,
  'conciliação da semana depende do envio do extrato da mesma semana');
insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial_data) values (current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'Banco fictício', '2026-01-01');
insert into public.movimentos_bancarios (empresa_id, conta_financeira_id, data, valor, descricao, chave_dedupe)
select current_setting('testes.empresa_a')::uuid, (select id from public.contas_financeiras where nome = 'Banco fictício'), app.rh_semana(app.hoje()) + d, 10 * (d + 1), 'MOV ' || d, 'rh-teste-' || d
  from generate_series(0, 1) d;
update public.movimentos_bancarios set status_conciliacao = 'conciliado' where chave_dedupe = 'rh-teste-0';
select is((select status from public.rh_tarefas where id = current_setting('testes.t_conc')::uuid), 'a_fazer', 'um de dois movimentos conciliado: não conclui');
update public.movimentos_bancarios set status_conciliacao = 'conciliado' where chave_dedupe = 'rh-teste-1';
select is((select (status, conclusao_pendente)::text from public.rh_tarefas where id = current_setting('testes.t_conc')::uuid), '(em_andamento,t)',
  'todos conciliados, mas o envio do extrato não foi confirmado: aguarda');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.rh_tarefa_concluir(current_setting('testes.t_envio')::uuid, jsonb_build_object('semana', app.hoje()));
reset role;
select is((select (status, semana_referencia = app.rh_semana(app.hoje()), concluida_por::text)::text from public.rh_tarefas where id = current_setting('testes.t_envio')::uuid),
  '(concluida,t,00000000-0000-0000-0000-0000000000b1)', 'envio do extrato: quem confirmou e a semana de referência');
select is((select (status, origem_conclusao)::text from public.rh_tarefas where id = current_setting('testes.t_conc')::uuid), '(concluida,automatica)',
  'depois do envio, a conciliação conclui sozinha (etapas separadas)');

-- Dependência manual sem ciclo
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.rh_tarefa_dependencia(%L, %L, true)$$,
  (select id from public.rh_tarefas where modelo_id = current_setting('testes.cx')::uuid and periodo_inicio = app.hoje() + 1),
  (select id from public.rh_tarefas where modelo_id = current_setting('testes.cx')::uuid and periodo_inicio = app.hoje() + 1)), '%dela mesma%', 'tarefa não depende dela mesma');
reset role;

-- Isolamento
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.rh_tarefas where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'outra empresa não vê as tarefas');
select is((select count(*)::int from public.rh_tarefa_evidencias where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'outra empresa não vê as evidências');
select throws_ok(format($$select public.rh_tarefa_concluir(%L, '{}')$$, current_setting('testes.t_ontem')), '42501', null, 'outra empresa não conclui tarefa');
reset role;

select * from finish();
rollback;
