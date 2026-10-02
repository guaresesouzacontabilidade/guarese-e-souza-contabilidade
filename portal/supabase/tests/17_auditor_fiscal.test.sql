-- Critérios: os achados são gravados só pelo processador; a equipe vê e revisa;
-- o cliente só vê o que foi publicado da própria empresa e pode pedir ajuda
-- (vira solicitação); descartar exige motivo e publicar exige a mensagem; uma
-- nova análise mantém a revisão e marca valores alterados; o catálogo de NCM é
-- da equipe; a permissão de conduzir o auditor é exclusiva da equipe.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(32);

\ir 00_setup.sql.inc

-- 0. Permissões
select ok('auditor.ver' = any(app.permissoes_padrao('cliente_titular')), 'empresário titular vê as oportunidades publicadas');
select ok(not ('auditor.ver' = any(app.permissoes_padrao('cliente_colaborador'))), 'colaborador do cliente não vê por padrão');
select ok('auditor.gerenciar' = any(app.permissoes_exclusivas_equipe()), 'conduzir o auditor é exclusivo da equipe');
select throws_ok(
  $$update public.empresa_membros set permissoes = permissoes || array['auditor.gerenciar']
     where user_id = '00000000-0000-0000-0000-0000000000b1' and empresa_id = current_setting('testes.empresa_a')::uuid$$,
  'P0001', 'Permissões exclusivas da equipe não podem ser concedidas a clientes.', 'cliente não recebe a permissão de conduzir o auditor');

-- 1. Catálogo de NCM monofásico
select ok((select count(*) from public.auditor_ncm_monofasico where ncm_prefixo = '3004' and not excecao) = 1, 'catálogo traz os medicamentos (posição 30.04)');
select ok((select count(*) from public.auditor_ncm_monofasico where ncm_prefixo = '30049046' and excecao) = 1, 'catálogo traz a exceção 3004.90.46');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.auditor_ncm_monofasico), 0, 'cliente não lê o catálogo interno');
update public.auditor_ncm_monofasico set ativo = false where ncm_prefixo = '3003';
select throws_ok($$select public.atualizar_leitura_xml_fiscal(gen_random_uuid(), '{"tipo":"nota"}')$$, '42501', null, 'usuário não grava a leitura das notas (só o processador)');
reset role;
select is((select ativo from public.auditor_ncm_monofasico where ncm_prefixo = '3003'), true, 'cliente não altera o catálogo');
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select ok((select count(*) from public.auditor_ncm_monofasico) > 100, 'equipe lê o catálogo');
update public.auditor_ncm_monofasico set ativo = false where ncm_prefixo = '3001';
select is((select ativo from public.auditor_ncm_monofasico where ncm_prefixo = '3001'), true, 'só o administrador altera o catálogo');
select throws_ok($$select public.auditor_registrar_resultado(gen_random_uuid(), '[]', '{}')$$, '42501', null, 'equipe não grava achados direto (só o processador)');
reset role;

-- 2. Processador grava uma análise com dois achados (sem usuário: como o processador)
select set_config('request.jwt.claims', '{}', true);
insert into public.auditor_execucoes (id, empresa_id, origem, situacao)
values ('00000000-0000-0000-0000-00000000e001', current_setting('testes.empresa_a')::uuid, 'automatica', 'processando');
select public.auditor_registrar_resultado('00000000-0000-0000-0000-00000000e001', $$[
  {"regra":"monofasico_simples","chave":"monofasico_simples:2026-09","competencia":"2026-09-01","tipo":"oportunidade","confianca":"alta",
   "titulo":"PIS/Cofins monofásico possivelmente pago no DAS — 09/2026","resumo":"Resumo de teste.","valor_base":"500.00","valor_estimado":"5.21",
   "memoria":[{"rotulo":"Receita","valor":"R$ 500,00"}],"referencias":[],"fontes":[{"titulo":"LC 123/2006"}]},
  {"regra":"ncm_invalido","chave":"ncm_invalido:2026-09","competencia":"2026-09-01","tipo":"risco","confianca":"alta",
   "titulo":"Produtos vendidos com NCM ausente ou inválido — 09/2026","resumo":"Resumo de teste.","valor_base":"100.00","valor_estimado":null,
   "memoria":[],"referencias":[],"fontes":[]}
]$$::jsonb, '{"notas": 3, "itens": 7, "periodo_inicio": "2021-09-01", "periodo_fim": "2026-10-01"}'::jsonb);
select is((select situacao from public.auditor_execucoes where id = '00000000-0000-0000-0000-00000000e001'), 'concluida', 'análise registrada como concluída');
select ok((select count(*) > 0 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'auditor_fiscal'), 'equipe é avisada dos achados novos');

-- 3. Visibilidade antes da publicação
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.auditor_achados), 0, 'cliente não vê achados ainda não publicados');
select throws_ok($$select public.auditor_revisar((select id from public.auditor_achados limit 1), 'publicar', null, 'Mensagem de teste para o cliente.')$$,
  'P0001', 'Achado não encontrado.', 'cliente não revisa achados');
select throws_ok($$select public.auditor_analisar(current_setting('testes.empresa_a')::uuid)$$, '42501', null, 'cliente não inicia a análise');
reset role;

-- 4. Revisão pela equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.auditor_achados where empresa_id = current_setting('testes.empresa_a')::uuid), 2, 'equipe vê os achados da empresa');
select set_config('testes.achado', (select id::text from public.auditor_achados where chave = 'monofasico_simples:2026-09'), true);
select set_config('testes.risco', (select id::text from public.auditor_achados where chave = 'ncm_invalido:2026-09'), true);
select throws_ok($$select public.auditor_revisar(current_setting('testes.risco')::uuid, 'descartar', null, null)$$,
  'P0001', 'Explique em poucas palavras por que o achado foi descartado.', 'descartar exige o motivo');
select throws_ok($$select public.auditor_revisar(current_setting('testes.achado')::uuid, 'publicar', null, 'curta')$$,
  'P0001', 'Escreva a mensagem que o cliente vai ler (ao menos 10 caracteres).', 'publicar exige a mensagem ao cliente');
select lives_ok($$select public.auditor_revisar(current_setting('testes.achado')::uuid, 'publicar', null,
  'Encontramos PIS e Cofins pagos a mais em setembro. Podemos pedir a restituição.')$$, 'equipe publica ao cliente');
select ok(public.auditor_analisar(current_setting('testes.empresa_a')::uuid) is not null, 'equipe pede uma nova análise');
reset role;
select is((select count(*)::int from public.jobs where tipo = 'auditor_fiscal' and empresa_id = current_setting('testes.empresa_a')::uuid and chave_idempotencia like 'auditor:manual:%'), 1,
  'análise pedida entra na fila');
select ok((select count(*) > 0 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'auditor_fiscal_publicado'), 'cliente é avisado da publicação');

-- 5. Cliente vê só o publicado e pede ajuda; colaborador e outra empresa não veem
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.auditor_achados), 1, 'cliente vê só o achado publicado');
select set_config('testes.solicitacao', public.auditor_pedir_ajuda(current_setting('testes.achado')::uuid)::text, true);
select is((select servico_codigo from public.solicitacoes where id = current_setting('testes.solicitacao')::uuid), 'recuperacao_tributos', 'pedido vira solicitação de recuperação');
select is(public.auditor_pedir_ajuda(current_setting('testes.achado')::uuid)::text, current_setting('testes.solicitacao'), 'pedir de novo não duplica a solicitação');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.auditor_achados), 0, 'colaborador sem a permissão não vê');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.auditor_achados), 0, 'outra empresa não vê');
reset role;

-- 6. Nova análise: mantém a revisão, marca valores alterados e remove achado novo que sumiu
select set_config('request.jwt.claims', '{}', true);
insert into public.auditor_execucoes (id, empresa_id, origem, situacao)
values ('00000000-0000-0000-0000-00000000e002', current_setting('testes.empresa_a')::uuid, 'mensal', 'processando');
select public.auditor_registrar_resultado('00000000-0000-0000-0000-00000000e002', $$[
  {"regra":"monofasico_simples","chave":"monofasico_simples:2026-09","competencia":"2026-09-01","tipo":"oportunidade","confianca":"alta",
   "titulo":"PIS/Cofins monofásico possivelmente pago no DAS — 09/2026","resumo":"Resumo novo.","valor_base":"800.00","valor_estimado":"8.34",
   "memoria":[],"referencias":[],"fontes":[]}
]$$::jsonb, '{"notas": 4, "itens": 9}'::jsonb);
select is((select situacao from public.auditor_achados where id = current_setting('testes.achado')::uuid), 'publicado', 'nova análise mantém a publicação');
select ok((select valores_alterados_em is not null from public.auditor_achados where id = current_setting('testes.achado')::uuid), 'valores alterados depois da revisão ficam marcados');
select is((select count(*)::int from public.auditor_achados where id = current_setting('testes.risco')::uuid), 0, 'achado novo que deixou de aparecer sai da lista');

select * from finish();
rollback;
