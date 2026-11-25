-- =============================================================================
-- Suporte 24h: "Isso ajudou?" e as dúvidas que o guia não respondeu
--
-- Cada pergunta ao suporte fica registrada SEM o texto (tela, se o guia
-- achou resposta, os títulos dos trechos mostrados e se veio da IA), para o
-- escritório ver o que funciona. O TEXTO da dúvida só é guardado quando o guia
-- não encontrou resposta ou quando a pessoa marca "não ajudou" — com aviso no
-- painel, com os números longos mascarados (CPF, CNPJ, telefone, conta) e
-- apagado depois de 180 dias. Só a equipe do escritório lê; quem perguntou
-- não vê as dúvidas dos outros.
-- =============================================================================

create table public.suporte_perguntas (
  id bigint generated always as identity primary key,
  user_id uuid references public.perfis(id) on delete set null default auth.uid(),
  empresa_id uuid references public.empresas(id) on delete set null,
  -- Quem perguntou é da equipe do escritório?
  equipe boolean not null default false,
  -- Tela em que estava (sem os números da empresa e da OS)
  tela text check (tela is null or length(tela) <= 200),
  modo text not null check (modo in ('guia', 'ia')),
  -- O guia encontrou trechos que respondem?
  achou boolean not null,
  trechos text[] not null default '{}' check (cardinality(trechos) <= 6),
  atalhos smallint not null default 0 check (atalhos between 0 and 10),
  -- Texto da dúvida (só sem resposta ou com "não ajudou"), já mascarado
  pergunta text check (pergunta is null or length(pergunta) <= 500),
  util boolean,
  avaliada_em timestamptz,
  -- O escritório já tratou (ex.: completou o guia)
  tratada_em timestamptz,
  tratada_por uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now()
);
create index suporte_perguntas_data_idx on public.suporte_perguntas (created_at desc);
create index suporte_perguntas_pendentes_idx on public.suporte_perguntas (created_at desc) where pergunta is not null and tratada_em is null;

-- Números longos viram ••• (CPF, CNPJ, telefone, conta, cartão)
create or replace function app.suporte_mascarar(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(trim(regexp_replace(regexp_replace(coalesce(p_texto, ''), '\(?[0-9][0-9().\-/ ]{4,}[0-9]', '•••', 'g'), '\s+', ' ', 'g')), 500), '');
$$;

-- Registra a pergunta (o servidor chama depois de responder). Devolve o número do registro.
create or replace function public.suporte_registrar(p_dados jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid := nullif(p_dados ->> 'empresa_id', '')::uuid;
  v_achou boolean := coalesce((p_dados ->> 'achou')::boolean, false);
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Entre no portal para usar o suporte.';
  end if;
  if v_empresa is not null and not (app.pode(v_empresa, 'empresa.ver') or app.is_equipe()) then
    v_empresa := null;
  end if;
  insert into public.suporte_perguntas (empresa_id, equipe, tela, modo, achou, trechos, atalhos, pergunta)
  values (
    v_empresa,
    app.is_equipe(),
    left(regexp_replace(coalesce(p_dados ->> 'tela', ''), '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', ':id', 'gi'), 200),
    case when p_dados ->> 'modo' = 'ia' then 'ia' else 'guia' end,
    v_achou,
    coalesce((select array_agg(left(t, 200)) from (select jsonb_array_elements_text(coalesce(p_dados -> 'trechos', '[]'::jsonb)) t limit 6) x), '{}'),
    least(greatest(coalesce(nullif(p_dados ->> 'atalhos', '')::int, 0), 0), 10),
    case when not v_achou then app.suporte_mascarar(p_dados ->> 'pergunta') end
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- "Isso ajudou?": só quem perguntou avalia; no "não ajudou", a dúvida vai (mascarada) para o escritório
create or replace function public.suporte_avaliar(p_id bigint, p_util boolean, p_pergunta text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.suporte_perguntas;
begin
  select * into r from public.suporte_perguntas where id = p_id for update;
  if r.id is null or r.user_id is distinct from auth.uid() then
    raise exception 'Pergunta não encontrada.';
  end if;
  if r.created_at < now() - interval '1 day' then
    raise exception 'Esta resposta já não pode ser avaliada.';
  end if;
  update public.suporte_perguntas set
    util = p_util,
    avaliada_em = now(),
    pergunta = case when p_util then pergunta else coalesce(pergunta, app.suporte_mascarar(p_pergunta)) end
  where id = r.id;
end;
$$;

-- O escritório marca a dúvida como tratada (ex.: completou o guia) ou reabre
create or replace function public.suporte_tratar(p_id bigint, p_tratada boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_equipe() then
    raise exception 'Só a equipe do escritório trata as dúvidas do suporte.';
  end if;
  update public.suporte_perguntas
     set tratada_em = case when p_tratada then now() end, tratada_por = case when p_tratada then auth.uid() end
   where id = p_id;
end;
$$;

-- Limpeza diária (servidor): o texto e o registro não ficam mais de 180 dias
create or replace function public.rotina_suporte_limpeza()
returns int
language sql
security definer
set search_path = ''
as $$
  with apagadas as (
    delete from public.suporte_perguntas where created_at < now() - interval '180 days' returning 1
  )
  select count(*)::int from apagadas;
$$;

alter table public.suporte_perguntas enable row level security;
create policy suporte_perguntas_leitura on public.suporte_perguntas for select to authenticated
  using ((select app.is_equipe()));
grant select on public.suporte_perguntas to authenticated;
grant select, insert, update, delete on public.suporte_perguntas to service_role;

revoke execute on function public.suporte_registrar(jsonb), public.suporte_avaliar(bigint, boolean, text), public.suporte_tratar(bigint, boolean) from public, anon;
grant execute on function public.suporte_registrar(jsonb), public.suporte_avaliar(bigint, boolean, text), public.suporte_tratar(bigint, boolean) to authenticated;
revoke execute on function public.rotina_suporte_limpeza() from public, anon, authenticated;
grant execute on function public.rotina_suporte_limpeza() to service_role;
