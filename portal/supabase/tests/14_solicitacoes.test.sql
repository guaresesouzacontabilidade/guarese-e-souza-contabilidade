-- Critérios: o cliente abre solicitações da própria empresa (com conversa e
-- aviso à equipe); só o escritório conduz o andamento; o cliente só cancela ou
-- devolve depois de enviar o que foi pedido; cada mudança avisa o outro lado;
-- outras empresas não veem nem alteram.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(21);

\ir 00_setup.sql.inc

create or replace function pg_temp.avisos(p_usuario uuid, p_tipo text)
returns int
language sql
as $$
  select count(*)::int from public.notificacoes where user_id = p_usuario and tipo = p_tipo;
$$;

-- 1. Cliente abre
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.abrir_solicitacao(current_setting('testes.empresa_a')::uuid, 'nao_existe', 'Teste')$$,
                 'P0001', null, 'serviço fora do catálogo é recusado');
select set_config('testes.sol', public.abrir_solicitacao(current_setting('testes.empresa_a')::uuid, 'alteracao_contratual',
  'Mudança de endereço', 'Vamos mudar para a Rua Nova, 50.', 'urgente')::text, true);
select ok(current_setting('testes.sol') <> '', 'cliente abre a solicitação');
select is((select status from public.solicitacoes where id = current_setting('testes.sol')::uuid), 'aberta', 'começa aberta');
select ok((select conversa_id is not null and prazo = app.hoje() + 30 from public.solicitacoes where id = current_setting('testes.sol')::uuid),
          'conversa criada e prazo pelo catálogo');
select throws_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'concluida')$$,
                 '42501', null, 'cliente não conclui (só o escritório)');
reset role;
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a2', 'solicitacao_nova'), 1, 'equipe é avisada da nova solicitação');

-- 2. Outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.solicitacoes where id = current_setting('testes.sol')::uuid), 0, 'outra empresa não vê');
select throws_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'cancelada', 'teste')$$,
                 '42501', null, 'outra empresa não altera');
reset role;

-- 3. Escritório conduz
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'aguardando_cliente')$$,
                 'P0001', null, 'pedir algo ao cliente exige explicar o quê');
select lives_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'aguardando_cliente',
                  'Envie o contrato de locação do novo endereço.', '00000000-0000-0000-0000-0000000000a2', app.hoje() + 20)$$,
                'escritório pede documento, assume e define o prazo');
reset role;
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1', 'solicitacao_atualizada'), 1, 'cliente é avisado da mudança');
select is((select count(*)::int from public.solicitacao_eventos where solicitacao_id = current_setting('testes.sol')::uuid), 4,
          'histórico: criada, situação, responsável e prazo');

-- 3b. Comentário sem mudar a situação (a tela reenvia responsável e prazo atuais)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select lives_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'aguardando_cliente',
                  'Pode ser foto do contrato.', '00000000-0000-0000-0000-0000000000a2', app.hoje() + 20)$$,
                'escritório comenta sem mudar a situação');
reset role;
select is((select comentario from public.solicitacao_eventos
            where solicitacao_id = current_setting('testes.sol')::uuid and tipo = 'comentario'),
          'Pode ser foto do contrato.', 'comentário entra no histórico');
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000b1', 'solicitacao_atualizada'), 2, 'cliente é avisado do comentário');

-- 4. Cliente devolve depois de enviar
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'em_andamento', 'Contrato enviado na conversa.')$$,
                'cliente avisa que enviou o que faltava');
reset role;
select is(pg_temp.avisos('00000000-0000-0000-0000-0000000000a2', 'solicitacao_atualizada'), 1, 'equipe é avisada da resposta');

-- 5. Conclusão
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'concluida', 'Alteração registrada na Junta.');
reset role;
select ok((select concluida_em is not null from public.solicitacoes where id = current_setting('testes.sol')::uuid), 'data de conclusão registrada');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, 'cancelada', 'Mudei de ideia')$$,
                 'P0001', null, 'solicitação encerrada não volta pelo cliente');
select throws_ok($$select public.atualizar_solicitacao(current_setting('testes.sol')::uuid, null, 'Mais uma coisa')$$,
                 'P0001', null, 'nem recebe comentário do cliente depois de encerrada');
reset role;

-- 6. Colaborador do cliente (com mensagens) também acompanha
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.solicitacoes where id = current_setting('testes.sol')::uuid), 1, 'colaborador do cliente acompanha');
reset role;

select * from finish();
rollback;
