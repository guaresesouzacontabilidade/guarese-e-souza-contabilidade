-- Critérios: a ferramenta vem desligada e o escritório liga; o empresário
-- cadastra serviços com tempo por unidade e a equipe; a OS soma o tempo e o
-- valor dos serviços e recebe número, código de acompanhamento e previsão; a
-- esteira guarda o tempo de execução sem as pausas; a entrega registra quem
-- retirou; o cliente acompanha só com o código (sem dados pessoais); quem não
-- tem permissão e outra empresa não veem nem mexem.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

-- 1. Ferramenta desligada por padrão: nada funciona até o escritório ligar
select is((select 'os' = any(ferramentas_desligadas) from public.empresas where id = current_setting('testes.empresa_a')::uuid), true, 'OS vem desligada');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.os_servico_salvar(%L, null, '{"nome": "Corte", "minutos_por_unidade": 4}')$$, current_setting('testes.empresa_a')),
  '%não estão ligadas%', 'desligada: não cadastra serviço');
reset role;
-- O escritório liga a ferramenta na empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
update public.empresas set ferramentas_desligadas = array_remove(ferramentas_desligadas, 'os') where id = current_setting('testes.empresa_a')::uuid;
select is((select 'os.gerenciar' = any(permissoes) from public.empresa_membros
            where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b1'), true,
  'empresário titular gerencia as OS');

-- 2. Serviços com tempo por unidade e equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.corte', public.os_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Corte de MDF", "unidade": "chapa", "minutos_por_unidade": "4", "minutos_fixos": "10", "valor_unitario": "15.00", "setor": "Seccionadora"}')::text, true);
select set_config('testes.fita', public.os_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Fita de borda", "unidade": "m", "minutos_por_unidade": "1,5", "valor_unitario": "3.50"}')::text, true);
select throws_like(format($$select public.os_servico_salvar(%L, null, '{"nome": "Sem tempo"}')$$, current_setting('testes.empresa_a')),
  '%tempo estimado%', 'serviço sem tempo não salva');
select throws_like(format($$select public.os_servico_salvar(%L, null, '{"nome": "corte de mdf", "minutos_fixos": 1}')$$, current_setting('testes.empresa_a')),
  '%com este nome%', 'nome repetido não salva');
select set_config('testes.joao', public.os_equipe_salvar(current_setting('testes.empresa_a')::uuid, null, '{"nome": "João"}')::text, true);

-- 3. Abrir a OS: tempo e valor somados, número, código e previsão
select set_config('testes.os1', public.os_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'cliente_nome', 'Carlos Marceneiro da Silva', 'cliente_telefone', '(63) 99999-1234', 'prioridade', 'normal',
  'responsavel_id', current_setting('testes.joao'),
  'itens', jsonb_build_array(
    jsonb_build_object('servico_id', current_setting('testes.corte'), 'quantidade', 5),
    jsonb_build_object('servico_id', current_setting('testes.fita'), 'quantidade', 20),
    jsonb_build_object('descricao', 'Furação de dobradiças', 'quantidade', 8, 'unidade', 'furo', 'minutos', 16, 'valor_unitario', '2.00'))))::text, true);
select is((select minutos_estimados from public.os_ordens where id = current_setting('testes.os1')::uuid), 76.00::numeric(12,2),
  'tempo estimado: 10 + 4×5 + 1,5×20 + 16');
select is((select valor_total from public.os_ordens where id = current_setting('testes.os1')::uuid), 161.00::numeric(12,2),
  'valor: 15×5 + 3,50×20 + 2×8');
select is((select numero from public.os_ordens where id = current_setting('testes.os1')::uuid), 1::bigint, 'primeira OS é a nº 1');
select ok((select codigo_publico ~ '^[a-z0-9]{12}$' and previsao is not null and previsao > now() - interval '1 minute'
             from public.os_ordens where id = current_setting('testes.os1')::uuid), 'código de acompanhamento e previsão');
select is((select count(*)::int from public.os_itens where ordem_id = current_setting('testes.os1')::uuid), 3, 'três serviços na OS');
select throws_like(format($$select public.os_salvar(%L, null, '{"cliente_nome": "Sem serviço", "itens": []}')$$, current_setting('testes.empresa_a')),
  '%ao menos um serviço%', 'OS sem serviço não abre');

-- A segunda OS (urgente) fica com número 2 e previsão sem esperar a normal
select set_config('testes.os2', public.os_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'cliente_nome', 'Ana', 'prioridade', 'urgente',
  'itens', jsonb_build_array(jsonb_build_object('servico_id', current_setting('testes.corte'), 'quantidade', 1))))::text, true);
select ok((select o2.numero = 2 and o2.previsao <= o1.previsao from public.os_ordens o1, public.os_ordens o2
            where o1.id = current_setting('testes.os1')::uuid and o2.id = current_setting('testes.os2')::uuid),
  'urgente passa na frente da fila na previsão');

-- 4. Esteira: execução, pausa (não conta), pronta e entregue
select public.os_mover(current_setting('testes.os1')::uuid, 'execucao');
reset role;
-- 40 min trabalhando
update public.os_ordens set execucao_desde = now() - interval '40 minutes' where id = current_setting('testes.os1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.os_pausar(%L, '')$$, current_setting('testes.os1')), '%motivo%', 'pausa pede o motivo');
select public.os_pausar(current_setting('testes.os1')::uuid, 'Falta de fita branca');
reset role;
-- 25 min parado
update public.os_ordens set pausada_em = now() - interval '25 minutes' where id = current_setting('testes.os1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.os_retomar(current_setting('testes.os1')::uuid);
reset role;
-- mais 30 min trabalhando
update public.os_ordens set execucao_desde = now() - interval '30 minutes' where id = current_setting('testes.os1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.os_mover(current_setting('testes.os1')::uuid, 'pronta');
select is((select minutos_execucao || '/' || minutos_pausa from public.os_ordens where id = current_setting('testes.os1')::uuid), '70.00/25.00',
  'execução 70 min sem contar a pausa de 25');
select ok((select pronta_em is not null and iniciada_em is not null from public.os_ordens where id = current_setting('testes.os1')::uuid), 'pronta registrada');
select public.os_mover(current_setting('testes.os1')::uuid, 'entregue', null, 'Carlos');
select is((select etapa || ' ' || retirado_por from public.os_ordens where id = current_setting('testes.os1')::uuid), 'entregue Carlos', 'entregue com quem retirou');
select is((select string_agg(coalesce(para_etapa, tipo), ',' order by id) from public.os_eventos where ordem_id = current_setting('testes.os1')::uuid),
  'fila,execucao,pausa,retomada,pronta,entregue', 'histórico completo');
select throws_like(format($$select public.os_salvar(%L, %L, '{"cliente_nome": "X", "itens": [{"descricao": "Y", "quantidade": 1}]}')$$,
  current_setting('testes.empresa_a'), current_setting('testes.os1')), '%não muda%', 'OS entregue não muda');
reset role;

-- 5. Acompanhamento pelo cliente: só com o código, sem telefone nem valor
select set_config('testes.codigo', (select codigo_publico from public.os_ordens where id = current_setting('testes.os1')::uuid), true);
set local role anon;
select is((select (r ->> 'cliente') || ' ' || (r ->> 'etapa') || ' ' || (r ->> 'numero') from public.os_acompanhar(current_setting('testes.codigo')) r), 'Carlos entregue 1',
  'cliente vê só o primeiro nome e a etapa');
select ok(public.os_acompanhar('zzzzzzzzzzzz') is null and public.os_acompanhar('curto') is null, 'código errado não mostra nada');
select ok(not (public.os_acompanhar(current_setting('testes.codigo'))::text ~ '99999|161|cliente_telefone'),
  'sem telefone nem valor');
reset role;

-- 6. Colaborador sem permissão e outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.os_ordens), 0, 'colaborador sem permissão não vê as OS');
select throws_like(format($$select public.os_mover(%L, 'execucao')$$, current_setting('testes.os2')), '%permissão%', 'colaborador sem permissão não move');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.os_ordens) + (select count(*)::int from public.os_servicos), 0, 'outra empresa não vê nada');
reset role;

select * from finish();
rollback;
