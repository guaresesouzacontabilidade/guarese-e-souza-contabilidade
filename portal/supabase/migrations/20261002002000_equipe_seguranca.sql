-- =============================================================================
-- Equipe e permissões: situação de segurança de cada usuário (somente o
-- administrador consulta) — verificação em duas etapas e sessões abertas.
-- =============================================================================

create or replace function public.seguranca_usuarios()
returns table (user_id uuid, tem_2fa boolean, sessoes int, ultima_atividade timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return query
    select p.id,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
           (select count(*)::int from auth.sessions s where s.user_id = p.id and (s.not_after is null or s.not_after > now())),
           (select max(coalesce(s.refreshed_at::timestamptz, s.updated_at)) from auth.sessions s where s.user_id = p.id)
      from public.perfis p;
end;
$$;

-- Ao desativar um usuário, convites ainda não aceitos deixam de valer; ao
-- reativar quem nunca entrou, o último convite volta a ficar pendente.
create or replace function app.tg_cancelar_convites_inativo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.ativo and not new.ativo then
    update public.convites set status = 'cancelado' where user_id = new.id and status = 'pendente';
  elsif not old.ativo and new.ativo and new.ultimo_acesso_em is null and new.anonimizado_em is null then
    update public.convites set status = 'pendente'
     where id = (select c.id from public.convites c where c.user_id = new.id and c.status = 'cancelado' order by c.created_at desc limit 1);
  end if;
  return new;
end;
$$;

drop trigger if exists perfis_cancelar_convites on public.perfis;
create trigger perfis_cancelar_convites after update of ativo on public.perfis
  for each row execute function app.tg_cancelar_convites_inativo();

revoke execute on function public.seguranca_usuarios() from public, anon;
grant execute on function public.seguranca_usuarios() to authenticated, service_role;
