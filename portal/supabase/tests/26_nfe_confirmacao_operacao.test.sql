-- Critérios: só quem gerencia o certificado pede a confirmação da operação, com
-- a declaração; vale para notas autorizadas sem XML e da própria empresa; um
-- pedido em andamento não é duplicado, mas um pedido recusado pela SEFAZ pode
-- ser refeito; precisa de certificado válido e da busca da NF-e ligada; fica na
-- auditoria e agenda a busca (que envia o evento à SEFAZ).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

\ir 00_setup.sql.inc

-- Certificado da empresa A (cadastrado pelo titular) e resumos de NF-e
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.registrar_certificado(current_setting('testes.empresa_a')::uuid, 'EMPRESA A COMERCIO LTDA:11444777000161', '11444777000161',
  'AC TESTE', '0A1B', repeat('C', 64), now() - interval '1 day', now() + interval '300 days', 'Autorização de teste do cliente para o portal.', 'v1:QUJDRA==');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.nfe_resumos (empresa_id, chave, emitente_nome, data_emissao, valor, situacao, ciencia_retorno)
values
  (current_setting('testes.empresa_a')::uuid, '17260955566677000188550010000091011000091010', 'FORNECEDOR', now() - interval '20 days', 100, 'autorizada',
   '596 - Rejeicao: Evento apresentado apos o prazo permitido para o evento: [10 dias]'),
  (current_setting('testes.empresa_a')::uuid, '17260955566677000188550010000091021000091020', 'FORNECEDOR', now() - interval '20 days', 200, 'cancelada', null),
  (current_setting('testes.empresa_b')::uuid, '17260955566677000188550010000091031000091030', 'FORNECEDOR', now() - interval '20 days', 300, 'autorizada', null);
delete from public.jobs where tipo = 'notas_automaticas' and empresa_id = current_setting('testes.empresa_a')::uuid;

create or replace function pg_temp.confirmar(p_chave text, p_declaracao text default 'Declaro que a empresa recebeu as mercadorias desta nota.')
returns integer language sql as $$
  select public.confirmar_operacoes_nfe(current_setting('testes.empresa_a')::uuid, array[p_chave], p_declaracao);
$$;

-- 1. Colaborador sem a permissão não confirma
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select pg_temp.confirmar('17260955566677000188550010000091011000091010')$$, '42501', null, 'colaborador sem a permissão não confirma');
reset role;

-- 2. Titular confirma, com a declaração
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select pg_temp.confirmar('17260955566677000188550010000091011000091010', 'ok')$$, '22023', null, 'sem a declaração não confirma');
select is(pg_temp.confirmar('17260955566677000188550010000091011000091010'), 1, 'titular pede a confirmação da nota');
select throws_ok($$select pg_temp.confirmar('17260955566677000188550010000091011000091010')$$, '22023', null, 'pedido em andamento não é duplicado');
select throws_ok($$select pg_temp.confirmar('17260955566677000188550010000091021000091020')$$, '22023', null, 'nota cancelada não é confirmada');
select throws_ok($$select pg_temp.confirmar('17260955566677000188550010000091031000091030')$$, '22023', null, 'nota de outra empresa não entra');
reset role;
select ok((select confirmacao_pedida_em is not null and confirmacao_pedida_por = '00000000-0000-0000-0000-0000000000b1'
             from public.nfe_resumos where chave = '17260955566677000188550010000091011000091010'), 'pedido registrado com quem pediu');
select ok(exists (select 1 from public.auditoria where acao = 'nfe_confirmar_operacao' and empresa_id = current_setting('testes.empresa_a')::uuid
                  and detalhes ->> 'quantidade' = '1' and detalhes ->> 'declaracao' like 'Declaro que a empresa%'), 'declaração fica na auditoria');
select ok(exists (select 1 from public.jobs where tipo = 'notas_automaticas' and empresa_id = current_setting('testes.empresa_a')::uuid),
          'busca agendada para enviar à SEFAZ');
select is((select confirmacao_pedida_em from public.nfe_resumos where chave = '17260955566677000188550010000091031000091030'), null,
          'a nota da outra empresa não mudou');

-- 3. Recusada pela SEFAZ: a equipe pode pedir de novo (com a autorização do cliente)
update public.nfe_resumos set confirmacao_retorno = '999 - Rejeicao de teste' where chave = '17260955566677000188550010000091011000091010';
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is(pg_temp.confirmar('17260955566677000188550010000091011000091010', 'O cliente confirmou ao escritório que recebeu as mercadorias desta nota.'), 1,
          'pedido recusado pode ser refeito pela equipe');
reset role;
select is((select confirmacao_retorno from public.nfe_resumos where chave = '17260955566677000188550010000091011000091010'), null,
          'o novo pedido limpa a recusa anterior');

-- 4. Busca da NF-e pausada: o XML não viria, então o pedido é recusado com explicação
update public.nfe_resumos set confirmacao_retorno = '999 - Rejeicao de teste' where chave = '17260955566677000188550010000091011000091010';
update public.notas_automaticas set pausada = true where empresa_id = current_setting('testes.empresa_a')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok($$select pg_temp.confirmar('17260955566677000188550010000091011000091010')$$, '22023', null, 'com a busca pausada o pedido é recusado');
reset role;

select * from finish();
rollback;
