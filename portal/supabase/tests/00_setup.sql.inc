-- Trecho comum incluído no início de cada teste (copiado pelo script de testes).
-- Cria usuários e empresas fictícias dentro da transação do teste.

create or replace function pg_temp.novo_usuario(p_id uuid, p_email text, p_tipo text)
returns uuid
language plpgsql
as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          extensions.crypt('Senha#Teste123', extensions.gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', array['email'], 'tipo', p_tipo),
          jsonb_build_object('nome', split_part(p_email, '@', 1)), now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (p_id, p_id, now(), now(), 'aal1');
  return p_id;
end;
$$;

-- Simula o JWT de um usuário (a sessão tem o mesmo id do usuário nos testes).
create or replace function pg_temp.como(p_id uuid, p_aal text default 'aal1')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'session_id', p_id, 'aal', p_aal)::text, true);
end;
$$;

select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000a1', 'admin@teste.local', 'admin');
select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000a2', 'equipe1@teste.local', 'equipe');
select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000a3', 'equipe2@teste.local', 'equipe');
select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000b1', 'cliente.a@teste.local', 'cliente');
select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000b2', 'colab.a@teste.local', 'cliente');
select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000b3', 'novo.colab.a@teste.local', 'cliente');
select pg_temp.novo_usuario('00000000-0000-0000-0000-0000000000c1', 'cliente.b@teste.local', 'cliente');

-- Empresas criadas pelo administrador (RPC com plano de contas e checklist padrão)
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select set_config('testes.empresa_a', public.criar_empresa(jsonb_build_object(
  'razao_social', 'Empresa A Comércio Ltda', 'nome_fantasia', 'Empresa A', 'tipo_pessoa', 'PJ',
  'documento', '11.222.333/0001-81', 'regime_tributario', 'simples_nacional',
  'servicos', jsonb_build_array('contabil', 'fiscal', 'folha'), 'controla_estoque', true,
  'contador_responsavel_id', '00000000-0000-0000-0000-0000000000a2'))::text, true);
select set_config('testes.empresa_b', public.criar_empresa(jsonb_build_object(
  'razao_social', 'Empresa B Serviços Ltda', 'tipo_pessoa', 'PJ',
  'documento', '12345678000195', 'regime_tributario', 'lucro_presumido'))::text, true);
select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b1', 'cliente_titular');
select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b2', 'cliente_colaborador');
select public.vincular_membro(current_setting('testes.empresa_b')::uuid, '00000000-0000-0000-0000-0000000000c1', 'cliente_titular');
reset role;
