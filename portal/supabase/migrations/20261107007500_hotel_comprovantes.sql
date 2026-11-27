-- =============================================================================
-- Hotel: comprovantes dos recebimentos (foto do PIX, comprovante do cartão,
-- transferência) para conferir no fechamento do caixa.
--
-- O arquivo fica num armazenamento privado, na pasta da empresa
-- ("<empresa>/<recebimento>/<comprovante>.<ext>"), e só quem usa a recepção ou a
-- gerência do hotel da própria empresa vê. O envio vai direto do navegador ao
-- armazenamento por uma URL temporária que o servidor cria depois que o banco
-- valida o pedido (formato, tamanho, permissão e o recebimento).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hotel-comprovantes', 'hotel-comprovantes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create policy hotel_comprovantes_leitura on storage.objects for select to authenticated
  using (bucket_id = 'hotel-comprovantes' and app.pode(app.empresa_do_objeto(name), 'gestao.vender'));

alter table public.hotel_pagamentos add constraint hotel_pagamentos_empresa_id_unico unique (empresa_id, id);

create table public.hotel_pagamento_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  pagamento_id uuid not null,
  caminho text not null unique,
  nome text not null check (length(trim(nome)) between 1 and 200),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')),
  tamanho bigint not null check (tamanho > 0 and tamanho <= 10485760),
  -- Foto tirada na hora (câmera) ou arquivo escolhido
  origem text not null default 'arquivo' check (origem in ('camera', 'arquivo')),
  enviado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  -- Preenchido quando o arquivo chegou ao armazenamento
  confirmado_em timestamptz,
  constraint hotel_pagamento_anexos_na_pasta check (caminho like empresa_id::text || '/' || pagamento_id::text || '/%'),
  foreign key (empresa_id, pagamento_id) references public.hotel_pagamentos (empresa_id, id) on delete cascade
);
create index hotel_pagamento_anexos_pagamento_idx on public.hotel_pagamento_anexos (pagamento_id);
create trigger auditoria_hotel_pagamento_anexos after insert or update or delete on public.hotel_pagamento_anexos
  for each row execute function app.tg_auditoria();

alter table public.hotel_pagamento_anexos enable row level security;
create policy hotel_pagamento_anexos_leitura on public.hotel_pagamento_anexos for select to authenticated
  using (empresa_id = any ((select app.empresas_com('gestao.vender'))::uuid[]));
grant select on public.hotel_pagamento_anexos to authenticated;
grant select, insert, update, delete on public.hotel_pagamento_anexos to service_role;

-- 1ª etapa: registra o comprovante e devolve o caminho onde o arquivo deve ser gravado
create or replace function public.hotel_comprovante_iniciar(p_pagamento_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pag public.hotel_pagamentos;
  v_mime text := lower(trim(coalesce(p_dados ->> 'mime', '')));
  v_tamanho bigint;
  v_nome text := left(trim(coalesce(p_dados ->> 'nome', '')), 200);
  v_origem text := coalesce(nullif(p_dados ->> 'origem', ''), 'arquivo');
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_caminho text;
begin
  select * into v_pag from public.hotel_pagamentos where id = p_pagamento_id;
  if not found then
    raise exception 'Recebimento não encontrado.';
  end if;
  perform app.exigir_hotel(v_pag.empresa_id, 'gestao.vender');
  if v_pag.cancelado_em is not null then
    raise exception 'Este recebimento foi estornado.';
  end if;
  v_ext := case v_mime
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
  if v_ext is null then
    raise exception 'Envie uma foto (JPG, PNG, WEBP ou HEIC) ou um PDF.';
  end if;
  begin
    v_tamanho := (p_dados ->> 'tamanho')::bigint;
  exception when others then
    v_tamanho := null;
  end;
  if v_tamanho is null or v_tamanho <= 0 then
    raise exception 'Arquivo vazio.';
  end if;
  if v_tamanho > 10485760 then
    raise exception 'O comprovante pode ter até 10 MB.';
  end if;
  if v_origem not in ('camera', 'arquivo') then
    v_origem := 'arquivo';
  end if;
  if v_nome = '' then
    v_nome := 'comprovante.' || v_ext;
  end if;
  -- Envios que não terminaram há mais de uma hora não contam
  if (select count(*) from public.hotel_pagamento_anexos
       where pagamento_id = p_pagamento_id and (confirmado_em is not null or created_at > now() - interval '1 hour')) >= 5 then
    raise exception 'Cada recebimento aceita até 5 comprovantes.';
  end if;
  v_caminho := v_pag.empresa_id::text || '/' || p_pagamento_id::text || '/' || v_id::text || '.' || v_ext;
  insert into public.hotel_pagamento_anexos (id, empresa_id, pagamento_id, caminho, nome, mime, tamanho, origem)
  values (v_id, v_pag.empresa_id, p_pagamento_id, v_caminho, v_nome, v_mime, v_tamanho, v_origem);
  return jsonb_build_object('anexo_id', v_id, 'caminho', v_caminho);
end;
$$;

-- 2ª etapa: confere que o arquivo chegou ao armazenamento
create or replace function public.hotel_comprovante_confirmar(p_anexo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.hotel_pagamento_anexos;
  v_obj jsonb;
begin
  select * into v from public.hotel_pagamento_anexos where id = p_anexo_id;
  if not found then
    raise exception 'Comprovante não encontrado.';
  end if;
  perform app.exigir_hotel(v.empresa_id, 'gestao.vender');
  if v.enviado_por is distinct from auth.uid() then
    raise exception 'Somente quem iniciou o envio pode confirmá-lo.';
  end if;
  if v.confirmado_em is not null then
    return;
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'hotel-comprovantes' and o.name = v.caminho;
  if not found then
    raise exception 'O arquivo não chegou ao armazenamento. Tente enviar novamente.';
  end if;
  update public.hotel_pagamento_anexos
     set confirmado_em = now(), tamanho = coalesce(nullif(v_obj ->> 'size', '')::bigint, tamanho)
   where id = p_anexo_id;
end;
$$;

-- Exclui o comprovante (quem enviou, enquanto o caixa do recebimento estiver aberto, ou o gerente).
-- Devolve o caminho para o servidor apagar o arquivo.
create or replace function public.hotel_comprovante_excluir(p_anexo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.hotel_pagamento_anexos;
  v_gerente boolean;
begin
  select * into v from public.hotel_pagamento_anexos where id = p_anexo_id;
  if not found then
    raise exception 'Comprovante não encontrado.';
  end if;
  perform app.exigir_hotel(v.empresa_id, 'gestao.vender');
  v_gerente := app.pode(v.empresa_id, 'gestao.gerenciar');
  if not v_gerente then
    if v.enviado_por is distinct from auth.uid() then
      raise exception 'Só quem enviou o comprovante ou o gerente pode excluí-lo.';
    end if;
    if exists (select 1 from public.hotel_pagamentos p join public.caixa_sessoes s on s.id = p.sessao_id
                where p.id = v.pagamento_id and s.status = 'fechado') then
      raise exception 'O caixa deste recebimento já foi fechado. Peça ao gerente para excluir o comprovante.';
    end if;
  end if;
  delete from public.hotel_pagamento_anexos where id = p_anexo_id;
  return v.caminho;
end;
$$;

revoke execute on function public.hotel_comprovante_iniciar(uuid, jsonb), public.hotel_comprovante_confirmar(uuid),
  public.hotel_comprovante_excluir(uuid) from public, anon;
grant execute on function public.hotel_comprovante_iniciar(uuid, jsonb), public.hotel_comprovante_confirmar(uuid),
  public.hotel_comprovante_excluir(uuid) to authenticated;
