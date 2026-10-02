-- =============================================================================
-- Mensagens em tempo real: a conversa e as listas atualizam sozinhas.
-- O Supabase Realtime entrega cada mudança só a quem pode vê-la (RLS): o
-- cliente nunca recebe as notas internas da equipe.
-- =============================================================================
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['mensagens', 'conversas'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
