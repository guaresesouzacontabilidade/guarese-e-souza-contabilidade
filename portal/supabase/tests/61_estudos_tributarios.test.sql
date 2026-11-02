-- Critérios: o robô de planejamento tributário guarda um estudo por empresa e
-- tipo, avisa a equipe só quando aparece oportunidade nova ou o valor muda
-- muito, e pede o auditor quando falta análise; a equipe que atende a empresa
-- roda, revisa (aprovar, descartar com motivo, apresentar, reabrir) e guarda as
-- premissas; o cliente e a equipe que não atende a empresa não veem nem mexem;
-- as funções do servidor não são chamadas pelo navegador.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(53);

\ir 00_setup.sql.inc

-- ---------------------------------------------------------------- 1. Funções só do servidor
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like(format($$select public.estudo_dados(%L, '2026-10-01')$$, current_setting('testes.empresa_a')),
  '%permission denied%', 'nem o administrador lê os dados do robô pelo navegador');
select throws_like(format($$select public.estudo_registrar(%L, null, 'manual', '[]'::jsonb)$$, current_setting('testes.empresa_a')),
  '%permission denied%', 'ninguém grava resultado do robô pelo navegador');
select throws_like(format($$select public.estudo_falhou(%L, null, 'manual', 'x')$$, current_setting('testes.empresa_a')),
  '%permission denied%', 'ninguém registra erro do robô pelo navegador');
select throws_like($$select public.rotina_estudos()$$, '%permission denied%', 'a rotina da noite não é chamada pelo navegador');
select throws_like(format($$select app.dados_previsao(%L, '2026-10-01')$$, current_setting('testes.empresa_a')),
  '%permission denied%', 'os dados da previsão sem checagem ficam só no servidor');
reset role;

-- A previsão do navegador continua pedindo permissão
select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select throws_like(format($$select public.dados_previsao_impostos(%L, '2026-10-01')$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'a previsão de impostos continua exigindo acesso à empresa');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select public.dados_previsao_impostos(current_setting('testes.empresa_a')::uuid, '2026-10-01') -> 'empresa' ->> 'nome'),
  'Empresa A', 'o contador da empresa continua vendo a previsão');
reset role;

-- ---------------------------------------------------------------- 2. Dados para o robô (servidor)
-- O servidor roda sem usuário logado
create function pg_temp.servidor() returns void language sql as $$ select set_config('request.jwt.claims', '', true) $$;
select pg_temp.servidor();
insert into public.auditor_achados (empresa_id, regra, chave, competencia, tipo, confianca, titulo, resumo, valor_estimado, situacao) values
  (current_setting('testes.empresa_a')::uuid, 'monofasico_pis', 'monofasico_pis:2026-08', '2026-08-01', 'oportunidade', 'alta',
   'PIS/Cofins monofásico no DAS', 'Produto monofásico tributado no DAS.', 1500, 'novo'),
  (current_setting('testes.empresa_a')::uuid, 'monofasico_pis', 'monofasico_pis:2026-07', '2026-07-01', 'oportunidade', 'alta',
   'PIS/Cofins monofásico no DAS', 'Descartado pela equipe.', 900, 'descartado'),
  (current_setting('testes.empresa_a')::uuid, 'st_duplicada', 'st_duplicada:2026-06', '2026-06-01', 'risco', 'media',
   'Risco qualquer', 'Não é oportunidade.', 700, 'novo');
select count(*) from (select set_config('t.dados', public.estudo_dados(current_setting('testes.empresa_a')::uuid, '2026-10-01')::text, true)) x;
select is(jsonb_array_length(current_setting('t.dados')::jsonb -> 'previsao' -> 'meses'), 25,
  'o robô recebe os 24 meses anteriores e o mês estudado');
select is((select format('%s|%s|%s', jsonb_array_length(d -> 'achados'), d -> 'achados' -> 0 ->> 'valor', d ->> 'ultima_execucao')
             from (select current_setting('t.dados')::jsonb -> 'auditor' d) x),
  '1|1500.00|', 'só entram os achados de imposto pago a mais ainda válidos');
select throws_like($$select public.estudo_dados('00000000-0000-0000-0000-00000000dead', '2026-10-01')$$,
  '%Empresa não encontrada%', 'empresa que não existe');

-- ---------------------------------------------------------------- 3. Gravar o resultado
create function pg_temp.estudos(p_fator numeric, p_estado_fator text default 'oportunidade')
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('tipo', 'regime', 'estado', 'nada_a_fazer', 'titulo', 'O regime atual é o mais barato',
                       'resumo', 'Comparamos os regimes.', 'economia_anual', null, 'valor_unico', null,
                       'detalhes', jsonb_build_object('passos', '[]'::jsonb), 'faltando', '[]'::jsonb),
    jsonb_build_object('tipo', 'fator_r', 'estado', p_estado_fator, 'titulo', 'Fator R',
                       'resumo', 'Aumentar o pró-labore.', 'economia_anual', p_fator::text, 'valor_unico', null,
                       'detalhes', jsonb_build_object('passos', '[]'::jsonb), 'faltando', '[]'::jsonb),
    jsonb_build_object('tipo', 'imposto_pago_a_mais', 'estado', 'faltam_dados', 'titulo', 'Falta a análise do auditor',
                       'resumo', 'O auditor ainda não analisou as notas.', 'economia_anual', null, 'valor_unico', null,
                       'detalhes', '{}'::jsonb, 'faltando', jsonb_build_array('Análise do auditor fiscal')),
    jsonb_build_object('tipo', 'limite_simples', 'estado', 'alerta', 'titulo', 'Perto do sublimite',
                       'resumo', 'Projeção do ano.', 'economia_anual', null, 'valor_unico', null,
                       'detalhes', '{}'::jsonb, 'faltando', '[]'::jsonb)
  )
$$;

select is(public.estudo_registrar(current_setting('testes.empresa_a')::uuid, null, 'noite', pg_temp.estudos(5000), true)
            - 'execucao_id',
  '{"novas": 2, "mudaram": 0}'::jsonb, 'primeira análise: 2 novidades (oportunidade e alerta)');
select is((select count(*)::int from public.estudo_oportunidades where empresa_id = current_setting('testes.empresa_a')::uuid),
  4, 'um estudo por tipo');
select is((select format('%s|%s', faltando[1], situacao) from public.estudo_oportunidades
            where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'imposto_pago_a_mais'),
  'Análise do auditor fiscal|nova', 'guarda o que falta para estudar');
select is((select format('%s|%s|%s', origem, situacao, resumo ->> 'novas') from public.estudo_execucoes
            where empresa_id = current_setting('testes.empresa_a')::uuid),
  'noite|concluida|2', 'registra a execução da noite');
select is((select count(*)::int from public.jobs where tipo = 'auditor_fiscal'
            and chave_idempotencia = 'auditor:estudo:' || current_setting('testes.empresa_a') || ':' || to_char(app.hoje(), 'YYYY-MM')),
  1, 'pede o auditor quando falta análise');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2'
            and tipo = 'estudo_tributario'),
  1, 'o contador da empresa recebe o aviso no sino');
select matches((select titulo || ' ' || corpo from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2'
                 and tipo = 'estudo_tributario'),
  '2 oportunidades novas — Empresa A Economia estimada de R\$ 5\.000,00', 'o aviso diz quantas e quanto');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1'
            and tipo = 'estudo_tributario'),
  0, 'o cliente não recebe aviso do robô');

-- Mesma análise de novo: sem aviso
select is(public.estudo_registrar(current_setting('testes.empresa_a')::uuid, null, 'noite', pg_temp.estudos(5300)) - 'execucao_id',
  '{"novas": 0, "mudaram": 0}'::jsonb, 'valor quase igual não é novidade');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2'
            and tipo = 'estudo_tributario'),
  1, 'sem novidade, sem aviso');
-- Valor mudou bastante (mais de 20%)
select is(public.estudo_registrar(current_setting('testes.empresa_a')::uuid, null, 'noite', pg_temp.estudos(9000)) - 'execucao_id',
  '{"novas": 0, "mudaram": 1}'::jsonb, 'valor mudou bastante: avisa');
select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2'
            and tipo = 'estudo_tributario'),
  2, 'aviso da mudança de valor');

select set_config('t.fator', (select id::text from public.estudo_oportunidades
                               where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'fator_r'), true);
select set_config('t.regime', (select id::text from public.estudo_oportunidades
                                where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'regime'), true);

-- ---------------------------------------------------------------- 4. Quem vê
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.estudo_oportunidades), 0, 'o cliente não vê os estudos');
select is((select count(*)::int from public.estudo_execucoes), 0, 'o cliente não vê as execuções do robô');
select throws_like(format($$select public.estudo_revisar(%L, 'aprovar')$$, current_setting('t.fator')),
  '%Estudo não encontrado%', 'o cliente não revisa estudo');
select throws_like($$select public.estudo_rodar()$$, '%Acesso negado%', 'o cliente não roda o robô');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*)::int from public.estudo_oportunidades
            where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'equipe que não atende a empresa não vê os estudos');
select throws_like(format($$select public.estudo_rodar(%L)$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'equipe que não atende a empresa não roda o robô nela');
select throws_like(format($$select public.estudo_premissas_salvar(%L, 20, 12)$$, current_setting('testes.empresa_a')),
  '%Acesso negado%', 'equipe que não atende a empresa não muda as premissas');
reset role;

-- ---------------------------------------------------------------- 5. Revisão da equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.estudo_oportunidades
            where empresa_id = current_setting('testes.empresa_a')::uuid), 4, 'o contador da empresa vê os 4 estudos');
select throws_like(format($$select public.estudo_revisar(%L, 'aprovar')$$, current_setting('t.regime')),
  '%Só oportunidades e alertas%', 'estudo sem ganho não é revisado');
select throws_like(format($$select public.estudo_revisar(%L, 'apresentar')$$, current_setting('t.fator')),
  '%Aprove o estudo antes%', 'só apresenta ao cliente depois de aprovar');
select throws_like(format($$select public.estudo_revisar(%L, 'descartar', 'não')$$, current_setting('t.fator')),
  '%Explique por que%', 'descartar exige o motivo');
select throws_like(format($$select public.estudo_revisar(%L, 'apagar')$$, current_setting('t.fator')),
  '%Ação inválida%', 'ação desconhecida');
select lives_ok(format($$select public.estudo_revisar(%L, 'aprovar')$$, current_setting('t.fator')), 'aprova a oportunidade');
reset role;
select is((select format('%s|%s|%s', situacao, valor_na_revisao, revisado_por) from public.estudo_oportunidades
            where id = current_setting('t.fator')::uuid),
  'aprovada|9000.00|00000000-0000-0000-0000-0000000000a2', 'guarda quem aprovou e o valor da época');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok(format($$select public.estudo_revisar(%L, 'apresentar')$$, current_setting('t.fator')), 'marca como apresentada ao cliente');
select lives_ok(format($$select public.estudo_revisar(%L, 'descartar', 'O cliente vai mudar de atividade')$$, current_setting('t.fator')),
  'descarta com motivo');
reset role;
select is((select format('%s|%s', situacao, motivo) from public.estudo_oportunidades where id = current_setting('t.fator')::uuid),
  'descartada|O cliente vai mudar de atividade', 'o motivo do descarte fica guardado');

-- Rodar de novo não desfaz a revisão; deixar de ser oportunidade e voltar recomeça
select pg_temp.servidor();
select count(*) from (select public.estudo_registrar(current_setting('testes.empresa_a')::uuid, null, 'noite', pg_temp.estudos(9100))) x;
select is((select situacao from public.estudo_oportunidades where id = current_setting('t.fator')::uuid),
  'descartada', 'nova análise com o mesmo resultado mantém o descarte');
select count(*) from (select public.estudo_registrar(current_setting('testes.empresa_a')::uuid, null, 'noite', pg_temp.estudos(0, 'nada_a_fazer'))) x;
select is((public.estudo_registrar(current_setting('testes.empresa_a')::uuid, null, 'noite', pg_temp.estudos(7000)) ->> 'novas')::int,
  1, 'oportunidade que some e volta conta como nova');
select is((select situacao from public.estudo_oportunidades where id = current_setting('t.fator')::uuid),
  'nova', 'e volta para a revisão da equipe');

-- ---------------------------------------------------------------- 6. Rodar agora
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(public.estudo_rodar(current_setting('testes.empresa_a')::uuid), 1, 'o contador pede o robô na empresa');
select is(public.estudo_rodar(current_setting('testes.empresa_a')::uuid), 0, 'pedido repetido em seguida não duplica');
reset role;
select is((select format('%s|%s', x.origem, x.pedido_por) from public.estudo_execucoes x
            where x.empresa_id = current_setting('testes.empresa_a')::uuid and x.situacao = 'na_fila'),
  'manual|00000000-0000-0000-0000-0000000000a2', 'a execução manual fica na fila com quem pediu');
select is((select count(*)::int from public.jobs j join public.estudo_execucoes x on x.id = (j.payload ->> 'execucao_id')::bigint
            where j.tipo = 'estudo_tributario' and x.situacao = 'na_fila'
              and j.empresa_id = current_setting('testes.empresa_a')::uuid),
  1, 'o pedido vai para a fila de tarefas');
select pg_temp.servidor();
select public.estudo_falhou(current_setting('testes.empresa_a')::uuid,
  (select id from public.estudo_execucoes where empresa_id = current_setting('testes.empresa_a')::uuid and situacao = 'na_fila'),
  'manual', 'Sem dados');
select is((select count(*)::int from public.estudo_execucoes
            where empresa_id = current_setting('testes.empresa_a')::uuid and situacao = 'erro' and erro = 'Sem dados'),
  1, 'erro do robô fica registrado');

-- Rotina da noite: todas as empresas ativas, uma vez por dia
select ok((public.rotina_estudos() ->> 'agendados')::int >= 2, 'a rotina da noite agenda as empresas ativas');
select is((select count(*)::int from public.jobs where tipo = 'estudo_tributario'
            and chave_idempotencia = 'estudo:noite:' || current_setting('testes.empresa_a') || ':' || to_char(app.hoje(), 'YYYY-MM-DD')),
  1, 'uma tarefa por empresa por dia');

-- ---------------------------------------------------------------- 7. Premissas
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.estudo_premissas_salvar(%L, 20, 12)$$, current_setting('testes.empresa_a')),
  '%Configure os cálculos%', 'sem configuração dos cálculos, pede para configurar');
reset role;
insert into public.calculo_parametros (empresa_id) values (current_setting('testes.empresa_a')::uuid);
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like(format($$select public.estudo_premissas_salvar(%L, 150, 12)$$, current_setting('testes.empresa_a')),
  '%margem de lucro%', 'margem fora do intervalo');
select lives_ok(format($$select public.estudo_premissas_salvar(%L, 18.5, 12)$$, current_setting('testes.empresa_a')),
  'guarda a margem e o ICMS médio');
reset role;
select is((select format('%s|%s', margem_lucro, aliquota_icms_media) from public.calculo_parametros
            where empresa_id = current_setting('testes.empresa_a')::uuid),
  '18.50|12.00', 'as premissas ficam na configuração da empresa');

select * from finish();
rollback;
