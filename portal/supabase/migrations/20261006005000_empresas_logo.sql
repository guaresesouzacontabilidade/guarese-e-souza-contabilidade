-- Logo de cada empresa (usada nas declarações e nos documentos com a cara do
-- escritório). Fica num armazenamento privado: só quem vê a empresa vê a logo;
-- só quem edita o cadastro troca. O arquivo fica na pasta da própria empresa.

alter table public.empresas
  add column logo_path text,
  add column logo_atualizado_em timestamptz,
  add constraint empresas_logo_na_pasta check (logo_path is null or logo_path like id::text || '/%');

-- O cadastro é alterado coluna a coluna (permissões por coluna): a logo entra na lista
grant update (logo_path, logo_atualizado_em) on public.empresas to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('empresas-logos', 'empresas-logos', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Empresa dona do arquivo, pela primeira pasta do caminho ("<empresa_id>/logo-...")
create or replace function app.empresa_do_objeto(p_nome text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(p_nome, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_nome, '/', 1)::uuid end;
$$;

create policy empresas_logos_leitura on storage.objects for select to authenticated
  using (bucket_id = 'empresas-logos' and app.pode(app.empresa_do_objeto(name), 'empresa.ver'));
create policy empresas_logos_insercao on storage.objects for insert to authenticated
  with check (bucket_id = 'empresas-logos' and app.pode(app.empresa_do_objeto(name), 'empresa.editar'));
create policy empresas_logos_alteracao on storage.objects for update to authenticated
  using (bucket_id = 'empresas-logos' and app.pode(app.empresa_do_objeto(name), 'empresa.editar'))
  with check (bucket_id = 'empresas-logos' and app.pode(app.empresa_do_objeto(name), 'empresa.editar'));
create policy empresas_logos_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'empresas-logos' and app.pode(app.empresa_do_objeto(name), 'empresa.editar'));

grant execute on function app.empresa_do_objeto(text) to authenticated, service_role;
