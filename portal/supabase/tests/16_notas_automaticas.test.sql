-- Critérios: o certificado só é cadastrado por quem tem a permissão, da
-- própria empresa (mesmo CNPJ) e dentro da validade; o conteúdo cifrado nunca é
-- lido pelos usuários; trocar ou remover apaga o conteúdo anterior; o outro
-- lado é avisado; a validade entra em Vencimentos; outras empresas não veem.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(29);

\ir 00_setup.sql.inc

create or replace function pg_temp.cadastrar(p_documento text, p_ate timestamptz default now() + interval '300 days')
returns uuid
language sql
as $$
  select public.registrar_certificado(current_setting('testes.empresa_a')::uuid, 'EMPRESA A COMERCIO LTDA:' || p_documento, p_documento,
    'AC TESTE', '0A1B', repeat('C', 64), now() - interval '1 day', p_ate, 'Autorização de teste do cliente para o portal.', 'v1:QUJDRA==');
$$;

-- 1. Titular cadastra (autorização dada no portal)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select pg_temp.cadastrar('99888777000166')$$, 'P0001', 'O certificado não é desta empresa (CNPJ diferente).', 'certificado de outro CNPJ é recusado');
select throws_ok($$select pg_temp.cadastrar('11444777000161', now() - interval '1 day')$$, 'P0001', 'Este certificado está vencido.', 'certificado vencido é recusado');
select set_config('testes.cert1', pg_temp.cadastrar('11444777000161')::text, true);
select ok(current_setting('testes.cert1') <> '', 'titular cadastra o certificado da própria empresa');
select is((select autorizacao from public.certificados_digitais where id = current_setting('testes.cert1')::uuid), 'cliente_no_portal',
          'autorização registrada como dada pelo cliente no portal');
select throws_ok($$select count(*) from public.certificados_segredos$$, '42501', null, 'conteúdo cifrado não é legível nem pelo titular');
select is((select count(*)::int from public.certificados_digitais where empresa_id = current_setting('testes.empresa_a')::uuid), 1, 'titular vê os dados do certificado');
select is((select certificado_valido_ate is not null from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid), true,
          'busca fica ativa com a validade do certificado');
select throws_ok($$select public.notas_reservar(current_setting('testes.empresa_a')::uuid)$$, '42501', null, 'usuário não reserva a busca (só o processador)');
select throws_ok($$update public.notas_automaticas set nfe_ult_nsu = '000000000000999'$$, '42501', null, 'usuário não altera o controle da busca diretamente');
reset role;
select is((select count(*)::int from public.certificados_segredos where certificado_id = current_setting('testes.cert1')::uuid), 1, 'conteúdo cifrado guardado');
select is((select count(*)::int from public.jobs where tipo = 'notas_automaticas' and empresa_id = current_setting('testes.empresa_a')::uuid and status = 'pendente'), 1,
          'primeira busca agendada na fila');
select is((select count(*)::int from public.vencimentos where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'certificado_digital' and situacao = 'ativo'), 1,
          'validade do certificado entra em Vencimentos');
select ok((select count(*) > 0 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000a2' and tipo = 'certificado'), 'equipe é avisada do cadastro pelo cliente');

-- 2. Colaborador do cliente (sem a permissão) e outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select pg_temp.cadastrar('11444777000161')$$, '42501', null, 'colaborador sem a permissão não cadastra');
select is((select count(*)::int from public.certificados_digitais), 0, 'colaborador não vê os dados do certificado');
select is((select count(*)::int from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid), 1,
          'colaborador com acesso aos documentos vê a situação da busca');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.certificados_digitais), 0, 'outra empresa não vê o certificado');
select is((select count(*)::int from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid), 0, 'outra empresa não vê a busca');
select throws_ok($$select public.revogar_certificado(current_setting('testes.empresa_a')::uuid)$$, '42501', null, 'outra empresa não remove');
reset role;

-- 3. Equipe troca o certificado (autorização escrita declarada)
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.cert2', pg_temp.cadastrar('11444777000242')::text, true);
select is((select autorizacao from public.certificados_digitais where id = current_setting('testes.cert2')::uuid), 'autorizacao_escrita',
          'equipe cadastra declarando a autorização escrita');
select lives_ok($$select public.salvar_notas_automaticas(current_setting('testes.empresa_a')::uuid, true, false, true, false)$$, 'equipe ajusta as preferências');
reset role;
select ok((select revogado_em is not null from public.certificados_digitais where id = current_setting('testes.cert1')::uuid), 'certificado anterior substituído');
select is((select count(*)::int from public.certificados_segredos where certificado_id = current_setting('testes.cert1')::uuid), 0, 'conteúdo do anterior apagado');
select is((select count(*)::int from public.vencimentos where empresa_id = current_setting('testes.empresa_a')::uuid and tipo = 'certificado_digital' and situacao = 'ativo'), 1,
          'vencimento do anterior arquivado (fica só o novo)');
select ok((select count(*) > 0 from public.notificacoes where user_id = '00000000-0000-0000-0000-0000000000b1' and tipo = 'certificado'), 'cliente é avisado do cadastro pelo escritório');
select ok((select ciencia_automatica and not nfse_ativa from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid),
          'preferências salvas (ciência automática registrada na auditoria)');

-- 4. Titular remove: conteúdo apagado, busca desligada
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$select public.revogar_certificado(current_setting('testes.empresa_a')::uuid, 'Não quero mais')$$, 'titular remove o certificado');
reset role;
select ok((select count(*) = 0 from public.certificados_segredos s join public.certificados_digitais c on c.id = s.certificado_id
            where c.empresa_id = current_setting('testes.empresa_a')::uuid)
          and (select certificado_valido_ate is null from public.notas_automaticas where empresa_id = current_setting('testes.empresa_a')::uuid)
          and not exists (select 1 from public.jobs where tipo = 'notas_automaticas' and empresa_id = current_setting('testes.empresa_a')::uuid and status = 'pendente'),
          'nada fica guardado e nenhuma busca fica agendada');

-- 5. Cadastro de novo logo em seguida (mesmo minuto da busca cancelada): a busca volta para a fila
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select pg_temp.cadastrar('11444777000161');
reset role;
select is((select count(*)::int from public.jobs where tipo = 'notas_automaticas' and empresa_id = current_setting('testes.empresa_a')::uuid and status = 'pendente'), 1,
          'certificado cadastrado de novo no mesmo minuto agenda uma nova busca');

select * from finish();
rollback;
