-- =============================================================================
-- Migração 1500: diagnóstico do estado de acesso do usuário atual
-- Usado pela aplicação para direcionar o usuário (2FA obrigatório, sessão
-- encerrada, usuário desativado) sem expor dados de outras pessoas.
-- =============================================================================
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
    'aal', coalesce(auth.jwt() ->> 'aal', 'aal1'),
    'tem_fator_verificado', v_tem_fator,
    'exige_2fa', case when v_perfil.tipo in ('admin', 'equipe') then v_esc.exigir_2fa_equipe else v_esc.exigir_2fa_clientes end,
    'aceite_termos_versao', v_perfil.aceite_termos_versao,
    'valido', app.usuario_valido()
  );
end;
$$;

revoke execute on function public.estado_acesso() from public, anon;
grant execute on function public.estado_acesso() to authenticated;
