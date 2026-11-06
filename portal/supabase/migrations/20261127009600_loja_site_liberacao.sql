-- =============================================================================
-- Site da loja: liberação por empresa
--
--  * O site da loja só funciona nas empresas que o escritório liberar (a mesma
--    equipe que liga a gestão da loja). Nas outras, a aba "Site da loja" não
--    aparece e as funções do site recusam: configurar, categorias, produtos,
--    fotos, importação, banners, catálogo e pedidos do site.
--  * Desligar a liberação tira o site do ar na hora (o catálogo e os pedidos
--    respondem como loja inexistente) sem apagar o que foi cadastrado.
-- =============================================================================

create table public.loja_site_liberacoes (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  liberado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger auditoria_loja_site_liberacoes after insert or update or delete on public.loja_site_liberacoes for each row execute function app.tg_auditoria();

alter table public.loja_site_liberacoes enable row level security;
create policy loja_site_liberacoes_leitura on public.loja_site_liberacoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]) or app.e_equipe_da_empresa(empresa_id));
revoke all on public.loja_site_liberacoes from anon, authenticated;
grant select on public.loja_site_liberacoes to authenticated;
grant select, insert, update, delete on public.loja_site_liberacoes to service_role;

create or replace function app.loja_site_liberado(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.loja_site_liberacoes where empresa_id = p_empresa_id);
$$;

-- Liberar ou desligar o site da loja de uma empresa (só a equipe do escritório)
create or replace function public.loja_site_liberar(p_empresa_id uuid, p_liberar boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.e_equipe_da_empresa(p_empresa_id) then
    raise exception 'Só o escritório libera o site da loja.' using errcode = '42501';
  end if;
  if p_liberar then
    insert into public.loja_site_liberacoes (empresa_id, liberado_por) values (p_empresa_id, auth.uid()) on conflict (empresa_id) do nothing;
  else
    delete from public.loja_site_liberacoes where empresa_id = p_empresa_id;
  end if;
end;
$$;

-- Todas as funções de quem gerencia o site passam por aqui: agora exigem a liberação
create or replace function app.exigir_site(p_empresa_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  if (select modalidade from public.gestao_config where empresa_id = p_empresa_id) = 'notas' then
    raise exception 'O site da loja não faz parte da modalidade "Notas e transporte".';
  end if;
  if not app.loja_site_liberado(p_empresa_id) then
    raise exception 'O site da loja ainda não foi liberado para esta empresa. Fale com o escritório.' using errcode = '42501';
  end if;
end;
$$;

-- Catálogo, produto e pedidos do site: empresa sem liberação responde como loja inexistente
create or replace function app.loja_site_pela_chave(p_slug text, p_chave_hash text)
returns public.loja_sites
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.loja_sites s
   where s.slug = lower(p_slug) and s.chave_hash is not null and s.chave_hash = p_chave_hash
     and app.loja_site_liberado(s.empresa_id);
$$;

-- Fotos e imagens dos banners: só envia quem tem o site liberado
drop policy loja_site_fotos_insercao on storage.objects;
create policy loja_site_fotos_insercao on storage.objects for insert to authenticated
  with check (
    bucket_id = 'loja-site' and app.pode(app.empresa_do_objeto(name), 'gestao.gerenciar')
    and app.gestao_ativa(app.empresa_do_objeto(name)) and app.loja_site_liberado(app.empresa_do_objeto(name))
  );

revoke execute on function app.loja_site_liberado(uuid), public.loja_site_liberar(uuid, boolean), app.exigir_site(uuid), app.loja_site_pela_chave(text, text)
  from public, anon, authenticated;
-- app.loja_site_liberado entra na regra das fotos (avaliada como quem envia)
grant execute on function app.loja_site_liberado(uuid), public.loja_site_liberar(uuid, boolean) to authenticated;
