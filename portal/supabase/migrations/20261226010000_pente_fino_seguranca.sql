-- Pente fino de segurança (novembro/2026)
--
-- 1. Limite de tentativas guardado no banco (vale para todos os servidores do
--    portal): "Esqueci a senha" e entrada com senha. As chaves chegam com o
--    e-mail e o IP já embaralhados (hash) pelo servidor; nada legível fica aqui.
-- 2. O código secreto do aviso de Pix do banco não é lido pelo navegador
--    (só o servidor do portal usa).
-- 3. O custo do produto usado no atendimento da veterinária segue a permissão
--    "Ver custos e margens", como no resto da loja.

-- 1. Limite de tentativas ---------------------------------------------------
create table app.limites_taxa (
  chave text primary key check (length(chave) between 3 and 200),
  janela_inicio timestamptz not null default now(),
  janela_segundos int not null check (janela_segundos between 1 and 86400),
  contagem int not null default 0
);
alter table app.limites_taxa enable row level security;
revoke all on app.limites_taxa from public, anon, authenticated;

-- Soma uma tentativa e diz se ainda está dentro do limite.
create or replace function public.limite_consumir(p_chave text, p_maximo int, p_janela_segundos int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contagem int;
begin
  if p_chave is null or length(p_chave) not between 3 and 200 or p_maximo < 1 or p_janela_segundos not between 1 and 86400 then
    raise exception 'Limite inválido.' using errcode = '22023';
  end if;
  delete from app.limites_taxa where janela_inicio < now() - interval '2 days';
  insert into app.limites_taxa as l (chave, janela_inicio, janela_segundos, contagem)
  values (p_chave, now(), p_janela_segundos, 1)
  on conflict (chave) do update
    set contagem = case when l.janela_inicio + make_interval(secs => l.janela_segundos) < now() then 1 else l.contagem + 1 end,
        janela_inicio = case when l.janela_inicio + make_interval(secs => l.janela_segundos) < now() then now() else l.janela_inicio end,
        janela_segundos = excluded.janela_segundos
  returning contagem into v_contagem;
  return v_contagem <= p_maximo;
end;
$$;

-- Diz se o limite já foi atingido (sem somar tentativa).
create or replace function public.limite_estourado(p_chave text, p_maximo int)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.limites_taxa l
     where l.chave = p_chave
       and l.contagem >= p_maximo
       and l.janela_inicio + make_interval(secs => l.janela_segundos) >= now()
  );
$$;

-- Zera a contagem (ex.: entrou com a senha certa).
create or replace function public.limite_zerar(p_chave text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from app.limites_taxa where chave = p_chave;
$$;

revoke all on function public.limite_consumir(text, int, int), public.limite_estourado(text, int), public.limite_zerar(text)
  from public, anon, authenticated;
grant execute on function public.limite_consumir(text, int, int), public.limite_estourado(text, int), public.limite_zerar(text)
  to service_role;

-- 2 e 3. Colunas que o navegador não lê -------------------------------------
-- (o servidor do portal continua lendo; novas colunas destas tabelas precisam
-- ser liberadas aqui de novo)
create or replace function app.fechar_colunas(p_tabela text, p_ocultas text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_colunas text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_colunas
    from pg_attribute a
   where a.attrelid = ('public.' || p_tabela)::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname <> all (p_ocultas);
  execute format('revoke select on public.%I from anon, authenticated', p_tabela);
  execute format('revoke select (%s) on public.%I from anon, authenticated',
    (select string_agg(quote_ident(c), ', ') from unnest(p_ocultas) c), p_tabela);
  execute format('grant select (%s) on public.%I to authenticated', v_colunas, p_tabela);
end;
$$;
revoke all on function app.fechar_colunas(text, text[]) from public, anon, authenticated;

select app.fechar_colunas('honorarios_config', array['banco_webhook_segredo']);
select app.fechar_colunas('vet_usos', array['custo_unitario']);
