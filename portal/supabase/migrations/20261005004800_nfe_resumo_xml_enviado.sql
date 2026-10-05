-- NF-e recebida só em resumo cujo XML completo chega por outro caminho — enviado
-- em Documentos pelo cliente ou pela equipe, por exemplo quando a SEFAZ recusa a
-- ciência da emissão depois do prazo de 10 dias: o resumo passa a apontar para o
-- documento, como já acontece quando o XML vem pela busca automática. Assim a
-- nota deixa de contar como "só resumo" nas telas, na planilha e no XML em lote.

create or replace function app.tg_ligar_resumo_nfe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.chave_acesso is not null and new.modelo = '55' then
    update public.nfe_resumos
       set documento_id = new.documento_id
     where empresa_id = new.empresa_id
       and chave = new.chave_acesso
       and documento_id is null;
  end if;
  return null;
end;
$$;

revoke execute on function app.tg_ligar_resumo_nfe() from public, anon;

create trigger documentos_fiscais_liga_resumo_nfe
  after insert or update of chave_acesso, documento_id on public.documentos_fiscais
  for each row execute function app.tg_ligar_resumo_nfe();

-- XML enviados antes desta mudança
update public.nfe_resumos r
   set documento_id = f.documento_id
  from public.documentos_fiscais f
  join public.documentos d on d.empresa_id = f.empresa_id and d.id = f.documento_id
 where r.documento_id is null
   and f.empresa_id = r.empresa_id
   and f.chave_acesso = r.chave
   and f.modelo = '55'
   and d.excluido_em is null;
