-- =============================================================================
-- Suporte 24h do portal
--
-- O botão de ajuda responde às dúvidas com os trechos do Guia de uso e os
-- atalhos das telas que a pessoa pode abrir (busca feita no servidor do portal,
-- sem serviço externo). Se o administrador do escritório ligar, a resposta é
-- escrita pelo assistente de IA (Claude, da Anthropic) com a mesma chave das
-- escalas: vai só a pergunta, os trechos do guia e os nomes das telas.
--  * escritorio_ia.suporte_ativo / suporte_limite_usuario: liga o assistente no
--    suporte e limita as perguntas por pessoa por dia.
--  * suporte_ia_usos: cada pergunta respondida pela IA (quem, quando, modelo e
--    tokens), SEM o texto da pergunta nem da resposta.
-- =============================================================================

alter table public.escritorio_ia
  add column suporte_ativo boolean not null default false,
  add column suporte_limite_usuario int not null default 30 check (suporte_limite_usuario between 1 and 500);

-- O administrador liga ou desliga o assistente no suporte
create or replace function public.escritorio_ia_suporte(p_ativo boolean, p_limite_usuario int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório configura o assistente de IA.' using errcode = '42501';
  end if;
  if p_ativo and not exists (select 1 from public.escritorio_ia_segredo where id = 1) then
    raise exception 'Cadastre a chave da Anthropic antes de ligar o assistente no suporte.' using errcode = 'P0001';
  end if;
  if p_limite_usuario is null or p_limite_usuario not between 1 and 500 then
    raise exception 'Limite entre 1 e 500 perguntas por pessoa por dia.';
  end if;
  update public.escritorio_ia set suporte_ativo = p_ativo, suporte_limite_usuario = p_limite_usuario, atualizado_por = auth.uid() where id = 1;
end;
$$;

create table public.suporte_ia_usos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.perfis(id) on delete cascade default auth.uid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  modelo text not null,
  ok boolean,
  tokens_entrada int check (tokens_entrada is null or tokens_entrada >= 0),
  tokens_saida int check (tokens_saida is null or tokens_saida >= 0),
  erro text check (erro is null or length(erro) <= 300),
  created_at timestamptz not null default now()
);
create index suporte_ia_usos_usuario_idx on public.suporte_ia_usos (user_id, created_at desc);

-- Reserva uma pergunta à IA (assistente ligado no suporte, chave cadastrada e dentro do limite)
create or replace function public.suporte_ia_reservar(p_empresa_id uuid)
returns table (uso_id bigint, modelo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.escritorio_ia;
  v_usados int;
  v_id bigint;
begin
  if auth.uid() is null or not app.usuario_valido() then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if p_empresa_id is not null and not (app.pode(p_empresa_id, 'empresa.ver') or app.is_equipe()) then
    raise exception 'Empresa fora do seu acesso.' using errcode = '42501';
  end if;
  select * into v_cfg from public.escritorio_ia where id = 1;
  if v_cfg.id is null or not v_cfg.suporte_ativo or not exists (select 1 from public.escritorio_ia_segredo where id = 1) then
    raise exception 'O assistente de IA do suporte está desconectado.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('suporte_ia:' || auth.uid()::text, 0));
  select count(*) into v_usados
    from public.suporte_ia_usos u
   where u.user_id = auth.uid()
     and u.created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_usados >= v_cfg.suporte_limite_usuario then
    raise exception 'Limite de % perguntas por dia ao assistente atingido. As respostas continuam pela busca no guia.', v_cfg.suporte_limite_usuario
      using errcode = 'P0001';
  end if;
  insert into public.suporte_ia_usos (user_id, empresa_id, modelo) values (auth.uid(), p_empresa_id, v_cfg.modelo)
  returning id into v_id;
  return query select v_id, v_cfg.modelo;
end;
$$;

-- Fecha o registro do uso (só quem reservou)
create or replace function public.suporte_ia_concluir(p_uso_id bigint, p_ok boolean, p_tokens_entrada int, p_tokens_saida int, p_erro text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.suporte_ia_usos
     set ok = p_ok, tokens_entrada = greatest(coalesce(p_tokens_entrada, 0), 0), tokens_saida = greatest(coalesce(p_tokens_saida, 0), 0),
         erro = case when p_ok then null else left(p_erro, 300) end
   where id = p_uso_id and user_id = auth.uid() and ok is null;
end;
$$;

alter table public.suporte_ia_usos enable row level security;
create policy suporte_ia_usos_leitura on public.suporte_ia_usos for select to authenticated
  using ((select app.is_admin()) or user_id = (select auth.uid()));
grant select on public.suporte_ia_usos to authenticated;
grant select, insert, update, delete on public.suporte_ia_usos to service_role;

revoke execute on function public.escritorio_ia_suporte(boolean, int), public.suporte_ia_reservar(uuid),
  public.suporte_ia_concluir(bigint, boolean, int, int, text) from public, anon;
grant execute on function public.escritorio_ia_suporte(boolean, int), public.suporte_ia_reservar(uuid),
  public.suporte_ia_concluir(bigint, boolean, int, int, text) to authenticated;
