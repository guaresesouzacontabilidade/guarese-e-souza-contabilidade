-- =============================================================================
-- Dispositivos conectados: o login é feito pelo servidor do portal, então o
-- auth.sessions guarda o IP/navegador do servidor. O navegador e o IP reais
-- vêm do registro de login que o próprio portal grava na auditoria.
-- =============================================================================

create or replace function public.minhas_sessoes()
returns table (id uuid, criada_em timestamptz, atualizada_em timestamptz, user_agent text, ip text, aal text, atual boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.created_at, coalesce(s.refreshed_at::timestamptz, s.updated_at),
         coalesce(l.user_agent, s.user_agent), coalesce(l.ip, host(s.ip)), s.aal::text,
         s.id = app.try_uuid(auth.jwt() ->> 'session_id')
    from auth.sessions s
    left join lateral (
      select a.user_agent, a.ip
        from public.auditoria a
       where a.entidade = 'sessoes'
         and a.entidade_id = s.id::text
         and a.acao = 'login'
         and a.user_id = s.user_id
       order by a.ocorrido_em desc
       limit 1
    ) l on true
   where s.user_id = auth.uid()
   order by coalesce(s.refreshed_at::timestamptz, s.updated_at) desc nulls last;
$$;
