-- Critério de aceite: um cliente não acessa dados nem arquivos de outra empresa
-- sem autorização; o controle vale no banco, nas APIs (RPC) e nos arquivos.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(37);

\ir 00_setup.sql.inc

-- ------------------------------------------------------------------ estrutura
select ok((select count(*) from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_a')::uuid) >= 40,
          'plano de contas padrão criado para a empresa');
select ok((select count(*) from public.checklist_modelos where empresa_id = current_setting('testes.empresa_a')::uuid) >= 6,
          'checklist padrão criado conforme regime e serviços');
select is((select papel from public.empresa_membros where empresa_id = current_setting('testes.empresa_a')::uuid
            and user_id = '00000000-0000-0000-0000-0000000000a2'), 'equipe',
          'contador responsável da equipe vinculado automaticamente');

-- ------------------------------------------------------------------ cliente A
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

select is((select count(*)::int from public.empresas), 1, 'cliente A vê apenas a própria empresa');
select is((select count(*)::int from public.empresas where id = current_setting('testes.empresa_b')::uuid), 0,
          'cliente A não vê a empresa B');
select is((select count(*)::int from public.categorias_financeiras where empresa_id = current_setting('testes.empresa_b')::uuid), 0,
          'cliente A não vê o plano de contas da empresa B');

select throws_ok(
  format($$insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
           values (%L, 'receber', 'Invasão', null, current_date, current_date, 10)$$, current_setting('testes.empresa_b')),
  '42501', null, 'cliente A não consegue inserir lançamento na empresa B');

select throws_ok(
  format($$select public.criar_documento(%L::uuid, current_date, 'comprovante', 'x.pdf', 'application/pdf', 10, repeat('a', 64))$$,
         current_setting('testes.empresa_b')),
  '42501', null, 'cliente A não consegue enviar documento para a empresa B');

reset role;
select set_config('testes.cat_b', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_b')::uuid and codigo = '1.01'), true);
select set_config('testes.cat_a', (select id::text from public.categorias_financeiras
  where empresa_id = current_setting('testes.empresa_a')::uuid and codigo = '1.01'), true);
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;

select throws_ok(
  format($$insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
           values (%L, 'receber', 'Categoria de outra empresa', %L, current_date, current_date, 10)$$,
         current_setting('testes.empresa_a'), current_setting('testes.cat_b')),
  '23503', null, 'referência a cadastro de outra empresa é bloqueada pela chave composta');

select lives_ok(
  format($$insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
           values (%L, 'receber', 'Venda balcão', %L, current_date, current_date, 150.10)$$,
         current_setting('testes.empresa_a'), current_setting('testes.cat_a')),
  'cliente titular registra lançamento na própria empresa');

select throws_ok($$update public.perfis set tipo = 'admin' where id = auth.uid()$$, '42501', null,
                 'cliente não consegue se promover a administrador');

update public.escritorio set nome_fantasia = 'Hackeado' where id = 1;
select is((select nome_fantasia from public.escritorio), 'GUARESE''S ON CONTABILIDADE', 'cliente não altera os dados do escritório');
select is((select count(*)::int from public.auditoria), 0, 'cliente não lê o histórico de auditoria');

select throws_ok(
  format($$select public.vincular_membro(%L::uuid, '00000000-0000-0000-0000-0000000000b3', 'cliente_colaborador', array['documentos.ver','documentos.revisar'])$$,
         current_setting('testes.empresa_a')),
  null, null, 'cliente não concede permissão exclusiva da equipe');
select throws_ok(
  format($$select public.vincular_membro(%L::uuid, '00000000-0000-0000-0000-0000000000b3', 'cliente_titular')$$,
         current_setting('testes.empresa_a')),
  null, null, 'cliente não cria outro titular');
select lives_ok(
  format($$select public.vincular_membro(%L::uuid, '00000000-0000-0000-0000-0000000000b3', 'cliente_colaborador', array['documentos.ver','financeiro.ver'])$$,
         current_setting('testes.empresa_a')),
  'cliente titular convida colaborador com permissões que possui');
reset role;

-- ------------------------------------------------------------------ cliente B
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.lancamentos), 0, 'cliente B não vê lançamentos da empresa A');
select is((select count(*)::int from public.empresa_membros where empresa_id = current_setting('testes.empresa_a')::uuid), 0,
          'cliente B não vê usuários da empresa A');
reset role;

-- ------------------------------------------------------------------ colaborador A (sem financeiro)
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.lancamentos), 0, 'colaborador sem permissão financeira não vê lançamentos');
select is((select count(*)::int from public.empresas), 1, 'colaborador vê a empresa a que está vinculado');
select lives_ok(
  format($$select public.criar_documento(%L::uuid, current_date, 'comprovante', 'pix.pdf', 'application/pdf', 1024, repeat('b', 64))$$,
         current_setting('testes.empresa_a')),
  'colaborador com permissão de envio cria documento');
select throws_ok(
  format($$select public.vincular_membro(%L::uuid, '00000000-0000-0000-0000-0000000000b3', 'cliente_colaborador')$$,
         current_setting('testes.empresa_a')),
  '42501', null, 'colaborador sem gestão de usuários não convida ninguém');
reset role;

-- ------------------------------------------------------------------ equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select is((select count(*)::int from public.empresas), 1, 'equipe vê somente as empresas autorizadas');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a3');
set local role authenticated;
select is((select count(*)::int from public.empresas), 0, 'equipe sem vínculo não vê empresas');
create or replace function pg_temp.todas_empresas() returns setof uuid language sql security definer as $$ select id from public.empresas $$;
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select is((select count(*)::int from public.empresas), (select count(*)::int from pg_temp.todas_empresas()),
          'administrador vê todas as empresas');
reset role;

-- ------------------------------------------------------------------ arquivos (Storage)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.upload', public.criar_documento(current_setting('testes.empresa_a')::uuid, current_date,
  'extrato_bancario', 'extrato.ofx', 'application/x-ofx', 2048, repeat('c', 64))::text, true);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('documentos', current_setting('testes.upload')::jsonb ->> 'storage_path', '00000000-0000-0000-0000-0000000000b1',
        jsonb_build_object('size', 2048, 'mimetype', 'application/x-ofx'));
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.confirmar_upload(%L::uuid)$$, current_setting('testes.upload')::jsonb ->> 'versao_id'),
                'cliente confirma o recebimento do arquivo');
select ok(app.pode_baixar_objeto(current_setting('testes.upload')::jsonb ->> 'storage_path'), 'cliente A pode baixar o próprio arquivo');
select is((select count(*)::int from storage.objects where name = current_setting('testes.upload')::jsonb ->> 'storage_path'), 1,
          'política do Storage libera o objeto para o cliente A');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select ok(not app.pode_baixar_objeto(current_setting('testes.upload')::jsonb ->> 'storage_path'), 'cliente B não pode baixar arquivo da empresa A');
select is((select count(*)::int from storage.objects where bucket_id = 'documentos'), 0, 'política do Storage oculta arquivos de outra empresa');
select throws_ok(format($$select public.registrar_acesso_documento(%L::uuid, 'download')$$, current_setting('testes.upload')::jsonb ->> 'documento_id'),
                 '42501', null, 'cliente B não obtém link temporário de documento da empresa A');
reset role;

-- ------------------------------------------------------------------ sessão revogada, usuário inativo, 2FA
delete from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.empresas), 0, 'sessão encerrada perde o acesso imediatamente');
reset role;

update public.perfis set ativo = false where id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.empresas), 0, 'usuário desativado perde o acesso');
reset role;

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a2', 'App', 'totp', 'verified', now(), now());
select pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'aal1');
set local role authenticated;
select is((select count(*)::int from public.empresas), 0, 'usuário com 2FA cadastrado precisa concluir a verificação (aal2)');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000a2', 'aal2');
set local role authenticated;
select is((select count(*)::int from public.empresas), 1, 'com 2FA verificado (aal2) o acesso é liberado');
reset role;

-- Usuário anônimo
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select * from public.empresas$$, '42501', null, 'visitante anônimo não acessa tabelas');
select ok((public.escritorio_publico() ->> 'nome_sistema') = 'Portal Guarese''s ON', 'tela de login obtém os dados públicos do escritório');
reset role;

select * from finish();
rollback;
