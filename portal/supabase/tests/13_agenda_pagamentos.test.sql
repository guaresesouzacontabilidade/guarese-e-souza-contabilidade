-- Critérios: o cliente informa o pagamento só de guias publicadas da própria
-- empresa, com data válida; o escritório é avisado e a tarefa de pagamento
-- recebe o registro no histórico (sem ser concluída automaticamente); dá
-- para desfazer; outras empresas não conseguem.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

\ir 00_setup.sql.inc

-- Guia publicada pelo escritório (com vencimento e valor) e uma tarefa de pagamento ligada a ela
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.guia', (public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-01', 'esc_guia', 'das-09-2026.pdf',
  'application/pdf', 2048, md5('das') || md5('das'), p_titulo => 'DAS 09/2026', p_vencimento => '2026-10-20', p_valor => 3619.47) ->> 'documento_id'), true);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
select 'documentos', dv.storage_path, '00000000-0000-0000-0000-0000000000a2', jsonb_build_object('size', 2048, 'mimetype', 'application/pdf')
  from public.documento_versoes dv where dv.documento_id = current_setting('testes.guia')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.confirmar_upload((select id from public.documento_versoes where documento_id = current_setting('testes.guia')::uuid));
reset role;
insert into public.tarefas (id, empresa_id, obrigacao_id, competencia, etapa, prazo_legal, prazo_interno, guia_documento_id)
values ('00000000-0000-0000-0000-00000000d001', current_setting('testes.empresa_a')::uuid,
        (select id from public.obrigacoes where codigo = 'SN_DAS'), '2026-09-01', 'pagamento', '2026-10-20', '2026-10-16',
        current_setting('testes.guia')::uuid)
on conflict (empresa_id, obrigacao_id, competencia, etapa) do update set guia_documento_id = excluded.guia_documento_id;

-- 1. Cliente de outra empresa não informa
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok($$select public.informar_pagamento_guia(current_setting('testes.guia')::uuid, app.hoje(), 3619.47)$$,
                 '42501', null, 'cliente de outra empresa não informa pagamento');
select is((select count(*)::int from public.guia_pagamentos where guia_documento_id = current_setting('testes.guia')::uuid), 0,
          'cliente de outra empresa não vê pagamentos');
reset role;

-- 2. Cliente da empresa informa
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.informar_pagamento_guia(current_setting('testes.guia')::uuid, app.hoje() + 1, 3619.47)$$,
                 'P0001', null, 'data futura é recusada');
select throws_ok($$select public.informar_pagamento_guia(current_setting('testes.guia')::uuid, app.hoje(), -5)$$,
                 'P0001', null, 'valor inválido é recusado');
select lives_ok($$select public.informar_pagamento_guia(current_setting('testes.guia')::uuid, app.hoje(), 3619.47, null, 'Pago pelo app do banco')$$,
                'cliente informa o pagamento da guia');
select is((select count(*)::int from public.guia_pagamentos where guia_documento_id = current_setting('testes.guia')::uuid), 1,
          'cliente vê o pagamento informado');
reset role;

select is((select count(*)::int from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'pagamento_informado'), 1,
          'equipe é avisada do pagamento');
select is((select count(*)::int from public.tarefa_historico where tarefa_id = '00000000-0000-0000-0000-00000000d001' and acao = 'pagamento_informado'), 1,
          'registro entra no histórico da tarefa de pagamento');
select isnt((select status from public.tarefas where id = '00000000-0000-0000-0000-00000000d001'), 'concluida',
            'a tarefa não é concluída automaticamente (a equipe conclui com o comprovante)');
select is((select count(*)::int from public.auditoria where acao = 'pagamento_guia_informado' and entidade_id = current_setting('testes.guia')), 1,
          'pagamento registrado na auditoria');

-- 3. Só guias publicadas pelo escritório
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.informar_pagamento_guia(gen_random_uuid(), app.hoje(), 10)$$, 'P0001', null, 'documento que não é guia é recusado');
-- 4. Desfazer
select public.desfazer_pagamento_guia(current_setting('testes.guia')::uuid);
select is((select count(*)::int from public.guia_pagamentos where guia_documento_id = current_setting('testes.guia')::uuid), 0, 'pagamento desfeito');
reset role;

select * from finish();
rollback;
