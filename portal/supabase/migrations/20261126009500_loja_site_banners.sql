-- =============================================================================
-- Site da loja: banners de campanha
--
--  * Quem gerencia a loja cadastra banners (Dia das Mães, Black Friday...) com
--    imagem para computador e para celular, link para uma página do site,
--    ordem e período. O site mostra só os banners ligados e dentro do período,
--    no lugar da abertura da página inicial; fora do período, a abertura volta.
--  * As imagens ficam no mesmo armazenamento público das fotos (loja-site), na
--    pasta da empresa: <empresa>/b/<banner>/<imagem>.
-- =============================================================================

create table public.loja_site_banners (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  -- Nome do banner (aparece no portal e é o texto alternativo da imagem no site)
  titulo text not null check (length(trim(titulo)) between 2 and 100),
  imagem_computador text,
  imagem_celular text,
  -- Página do site aberta ao tocar no banner (/c/..., /p/... ou /busca?q=...)
  link text check (link is null or (length(link) <= 300 and link ~ '^/(c/[a-z0-9-]+|p/[0-9a-f-]{36}(/[a-z0-9-]*)?|busca\?q=[^[:space:]]+)$')),
  inicio timestamptz,
  fim timestamptz,
  ordem int not null default 0 check (ordem between 0 and 1000),
  ativo boolean not null default true,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loja_site_banners_periodo check (inicio is null or fim is null or fim > inicio),
  constraint loja_site_banners_imagens check (
    (imagem_computador is null or imagem_computador like empresa_id::text || '/b/' || id::text || '/%')
    and (imagem_celular is null or imagem_celular like empresa_id::text || '/b/' || id::text || '/%')
  )
);
create index loja_site_banners_empresa_idx on public.loja_site_banners (empresa_id, ordem);
create trigger loja_site_banners_updated_at before update on public.loja_site_banners for each row execute function app.tg_updated_at();
create trigger auditoria_loja_site_banners after insert or update or delete on public.loja_site_banners for each row execute function app.tg_auditoria();

alter table public.loja_site_banners enable row level security;
create policy loja_site_banners_leitura on public.loja_site_banners for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
revoke all on public.loja_site_banners from anon, authenticated;
grant select on public.loja_site_banners to authenticated;
grant select, insert, update, delete on public.loja_site_banners to service_role;

-- Dados do banner (as imagens têm função própria)
create or replace function public.loja_site_banner_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir_site(p_empresa_id);
  begin
    if p_id is null then
      insert into public.loja_site_banners (empresa_id, titulo, link, inicio, fim, ordem, ativo, atualizado_por)
      values (
        p_empresa_id, trim(p_dados ->> 'titulo'), nullif(trim(coalesce(p_dados ->> 'link', '')), ''),
        nullif(p_dados ->> 'inicio', '')::timestamptz, nullif(p_dados ->> 'fim', '')::timestamptz,
        coalesce(nullif(p_dados ->> 'ordem', '')::int, 0), coalesce((p_dados ->> 'ativo')::boolean, true), auth.uid()
      ) returning id into v_id;
    else
      update public.loja_site_banners
         set titulo = trim(p_dados ->> 'titulo'), link = nullif(trim(coalesce(p_dados ->> 'link', '')), ''),
             inicio = nullif(p_dados ->> 'inicio', '')::timestamptz, fim = nullif(p_dados ->> 'fim', '')::timestamptz,
             ordem = coalesce(nullif(p_dados ->> 'ordem', '')::int, 0), ativo = coalesce((p_dados ->> 'ativo')::boolean, true),
             atualizado_por = auth.uid()
       where id = p_id and empresa_id = p_empresa_id
      returning id into v_id;
      if v_id is null then
        raise exception 'Banner não encontrado.';
      end if;
    end if;
  exception
    when check_violation or not_null_violation then
      raise exception 'Confira o banner: nome de 2 a 100 letras, link para uma página do site e o fim depois do início.';
  end;
  return v_id;
end;
$$;

-- Imagens do banner: grava os caminhos novos e devolve os que saíram (para apagar do armazenamento)
create or replace function public.loja_site_banner_imagens(p_empresa_id uuid, p_id uuid, p_computador text, p_celular text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.loja_site_banners;
  v_prefixo text := p_empresa_id::text || '/b/' || p_id::text || '/';
begin
  perform app.exigir_site(p_empresa_id);
  select * into b from public.loja_site_banners where id = p_id and empresa_id = p_empresa_id for update;
  if b.id is null then
    raise exception 'Banner não encontrado.';
  end if;
  if (p_computador is not null and (left(p_computador, length(v_prefixo)) <> v_prefixo or substr(p_computador, length(v_prefixo) + 1) !~ '^[a-z0-9-]{8,64}$'))
     or (p_celular is not null and (left(p_celular, length(v_prefixo)) <> v_prefixo or substr(p_celular, length(v_prefixo) + 1) !~ '^[a-z0-9-]{8,64}$')) then
    raise exception 'Imagem inválida.';
  end if;
  update public.loja_site_banners set imagem_computador = p_computador, imagem_celular = p_celular, atualizado_por = auth.uid() where id = p_id;
  return array_remove(array[
    case when b.imagem_computador is distinct from p_computador then b.imagem_computador end,
    case when b.imagem_celular is distinct from p_celular then b.imagem_celular end
  ], null);
end;
$$;

-- Excluir o banner: devolve as imagens para apagar do armazenamento
create or replace function public.loja_site_banner_excluir(p_empresa_id uuid, p_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.loja_site_banners;
begin
  perform app.exigir_site(p_empresa_id);
  delete from public.loja_site_banners where id = p_id and empresa_id = p_empresa_id returning * into b;
  if b.id is null then
    raise exception 'Banner não encontrado.';
  end if;
  return array_remove(array[b.imagem_computador, b.imagem_celular], null);
end;
$$;

-- Banners no ar agora (ligados, com imagem e dentro do período), para a vitrine
create or replace function app.loja_site_banners_no_ar(p_empresa_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'titulo', b.titulo, 'computador', b.imagem_computador,
           'celular', coalesce(b.imagem_celular, b.imagem_computador), 'link', b.link
         ) order by b.ordem, b.created_at), '[]'::jsonb)
    from public.loja_site_banners b
   where b.empresa_id = p_empresa_id and b.ativo and b.imagem_computador is not null
     and (b.inicio is null or b.inicio <= now()) and (b.fim is null or b.fim > now());
$$;

-- A vitrine passa a levar os banners no ar
create or replace function public.loja_site_vitrine(p_slug text, p_chave_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.loja_sites;
begin
  s := app.loja_site_pela_chave(p_slug, p_chave_hash);
  if s.empresa_id is null then
    return null;
  end if;
  if not s.ativo or not app.gestao_ativa(s.empresa_id) then
    return jsonb_build_object('aberta', false, 'loja', app.loja_site_dados_publicos(s));
  end if;
  return jsonb_build_object(
    'aberta', true,
    'loja', app.loja_site_dados_publicos(s),
    'banners', app.loja_site_banners_no_ar(s.empresa_id),
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'pai_id', c.pai_id, 'nome', c.nome, 'slug', c.slug, 'ordem', c.ordem)
                       order by c.ordem, c.nome)
        from public.loja_site_categorias c
       where c.empresa_id = s.empresa_id and c.ativa
         and (c.pai_id is null or exists (select 1 from public.loja_site_categorias pai where pai.id = c.pai_id and pai.ativa))
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nome', coalesce(sp.nome, p.descricao), 'preco', round(p.valor_unitario, 2),
               'preco_de', case when sp.preco_de > round(p.valor_unitario, 2) then sp.preco_de end,
               'categoria_id', sp.categoria_id, 'fotos', to_jsonb(sp.fotos[1:2]), 'destaque', sp.destaque,
               'disponivel', (not p.controla_estoque or p.estoque_atual >= 1),
               'ultimas', (p.controla_estoque and p.estoque_atual >= 1 and p.estoque_atual <= 3),
               'opcoes', cardinality(sp.variacoes), 'publicado_em', sp.publicado_em
             ) order by sp.publicado_em desc, p.id)
        from public.loja_site_produtos sp
        join public.nfe_produtos p on p.id = sp.produto_id and p.ativo and p.valor_unitario is not null
       where sp.empresa_id = s.empresa_id and sp.visivel
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function
  public.loja_site_banner_salvar(uuid, uuid, jsonb), public.loja_site_banner_imagens(uuid, uuid, text, text),
  public.loja_site_banner_excluir(uuid, uuid), app.loja_site_banners_no_ar(uuid), public.loja_site_vitrine(text, text)
  from public, anon, authenticated;
grant execute on function
  public.loja_site_banner_salvar(uuid, uuid, jsonb), public.loja_site_banner_imagens(uuid, uuid, text, text),
  public.loja_site_banner_excluir(uuid, uuid)
  to authenticated;
grant execute on function public.loja_site_vitrine(text, text) to service_role;
