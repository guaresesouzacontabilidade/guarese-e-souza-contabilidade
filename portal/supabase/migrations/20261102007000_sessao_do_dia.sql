-- Verificação em duas etapas uma vez por dia (por aparelho): depois do código,
-- a pessoa pode manter a sessão até o fim do dia. Ao fechar o portal, essa
-- sessão fica TRAVADA — o banco não entrega nada a ela — e só volta com a
-- senha. No dia seguinte (ou sem a opção marcada), fechar o portal encerra a
-- sessão como antes, e o próximo acesso pede senha e código.

create table public.sessoes_portal (
  -- Sessão do login (auth.sessions); sem chave estrangeira para não depender do esquema interno
  session_id uuid primary key,
  user_id uuid not null references public.perfis(id) on delete cascade,
  manter_ate timestamptz not null,
  bloqueada_em timestamptz,
  tentativas smallint not null default 0 check (tentativas between 0 and 100),
  created_at timestamptz not null default now()
);
create index sessoes_portal_user_idx on public.sessoes_portal (user_id);
alter table public.sessoes_portal enable row level security;
-- Sem políticas: só as funções abaixo e o servidor (desbloqueio com a senha) mexem aqui
revoke all on public.sessoes_portal from anon, authenticated;

-- Sessão travada (portal fechado) não vale até a senha ser conferida
create or replace function app.sessao_valida()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when app.try_uuid(auth.jwt() ->> 'session_id') is null then false
    else exists (
      select 1
        from auth.sessions s
       where s.id = app.try_uuid(auth.jwt() ->> 'session_id')
         and s.user_id = auth.uid()
         and (s.not_after is null or s.not_after > now())
    ) and not exists (
      select 1
        from public.sessoes_portal p
       where p.session_id = app.try_uuid(auth.jwt() ->> 'session_id')
         and p.bloqueada_em is not null
    )
  end;
$$;

-- Fim do dia de hoje no fuso do escritório
create or replace function app.fim_do_dia()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (((now() at time zone 'America/Araguaina')::date + 1)::timestamp) at time zone 'America/Araguaina';
$$;

-- Logo depois do código: mantém esta sessão até o fim do dia neste aparelho
create or replace function public.sessao_manter_hoje()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessao uuid := app.try_uuid(auth.jwt() ->> 'session_id');
  v_ate timestamptz := app.fim_do_dia();
begin
  if auth.uid() is null or v_sessao is null or not app.sessao_valida() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Confirme o código da verificação em duas etapas antes.' using errcode = '42501';
  end if;
  -- Limpa sessões antigas da própria pessoa
  delete from public.sessoes_portal where user_id = auth.uid() and manter_ate < now();
  insert into public.sessoes_portal (session_id, user_id, manter_ate)
  values (v_sessao, auth.uid(), v_ate)
  on conflict (session_id) do update set manter_ate = excluded.manter_ate, bloqueada_em = null, tentativas = 0;
  perform app.registrar_auditoria('sessao_manter_dia', 'sessoes', v_sessao::text, null, jsonb_build_object('ate', v_ate));
  return v_ate;
end;
$$;

-- O portal foi fechado: trava a sessão mantida no dia (volta com a senha) ou
-- avisa que ela deve ser encerrada. Responde 'bloqueada' ou 'encerrar'.
create or replace function public.sessao_portal_fechado()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessao uuid := app.try_uuid(auth.jwt() ->> 'session_id');
begin
  if auth.uid() is null or v_sessao is null then
    return 'encerrar';
  end if;
  update public.sessoes_portal p
     set bloqueada_em = coalesce(p.bloqueada_em, now())
   where p.session_id = v_sessao
     and p.user_id = auth.uid()
     and p.manter_ate > now()
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (select 1 from auth.sessions s where s.id = v_sessao and s.user_id = auth.uid() and s.aal::text = 'aal2'
                   and (s.not_after is null or s.not_after > now()));
  if found then
    return 'bloqueada';
  end if;
  delete from public.sessoes_portal where session_id = v_sessao;
  return 'encerrar';
end;
$$;

-- Desbloqueio: o servidor confere a senha e registra aqui (só o servidor chama).
-- Devolve as tentativas erradas acumuladas (0 quando liberou).
create or replace function public.sessao_desbloqueio(p_session_id uuid, p_user_id uuid, p_senha_ok boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tentativas int;
begin
  if p_senha_ok then
    update public.sessoes_portal set bloqueada_em = null, tentativas = 0
     where session_id = p_session_id and user_id = p_user_id and bloqueada_em is not null and manter_ate > now();
    if not found then
      raise exception 'Esta sessão não está travada (ou o dia já acabou). Entre novamente.';
    end if;
    perform app.registrar_auditoria('sessao_desbloqueada', 'sessoes', p_session_id::text, null, '{}'::jsonb);
    return 0;
  end if;
  update public.sessoes_portal set tentativas = tentativas + 1
   where session_id = p_session_id and user_id = p_user_id
  returning tentativas into v_tentativas;
  return coalesce(v_tentativas, 0);
end;
$$;

-- Estado do acesso: informa quando a sessão está travada (a tela pede a senha)
create or replace function public.estado_acesso()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_perfil public.perfis;
  v_esc public.escritorio;
  v_tem_fator boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('autenticado', false);
  end if;
  select * into v_perfil from public.perfis where id = auth.uid();
  select * into v_esc from public.escritorio where id = 1;
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified') into v_tem_fator;
  return jsonb_build_object(
    'autenticado', true,
    'perfil_existe', v_perfil.id is not null,
    'ativo', coalesce(v_perfil.ativo, false),
    'tipo', v_perfil.tipo,
    'sessao_valida', app.sessao_valida(),
    'sessao_bloqueada', exists (select 1 from public.sessoes_portal p
                                 where p.session_id = app.try_uuid(auth.jwt() ->> 'session_id') and p.bloqueada_em is not null),
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'tem_fator_verificado', v_tem_fator,
    'exige_2fa', case when v_perfil.tipo in ('admin', 'equipe') then v_esc.exigir_2fa_equipe else v_esc.exigir_2fa_clientes end,
    'aceite_termos_versao', v_perfil.aceite_termos_versao,
    'valido', app.usuario_valido()
  );
end;
$$;

revoke all on function public.sessao_manter_hoje(), public.sessao_portal_fechado(), public.sessao_desbloqueio(uuid, uuid, boolean),
  app.fim_do_dia() from public, anon;
grant execute on function public.sessao_manter_hoje(), public.sessao_portal_fechado() to authenticated;
revoke all on function public.sessao_desbloqueio(uuid, uuid, boolean) from authenticated;
grant execute on function public.sessao_desbloqueio(uuid, uuid, boolean) to service_role;
grant execute on function app.fim_do_dia() to authenticated, service_role;
