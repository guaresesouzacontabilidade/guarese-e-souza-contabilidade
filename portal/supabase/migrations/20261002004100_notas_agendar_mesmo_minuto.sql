-- =============================================================================
-- Notas automáticas: nova busca agendada mesmo dentro do mesmo minuto
--
-- A tarefa da busca usa uma chave por minuto para não duplicar agendamentos.
-- Quando a busca daquele minuto já tinha terminado ou sido cancelada (ex.: o
-- certificado foi removido e cadastrado de novo logo em seguida, ou "Buscar
-- agora" logo depois de uma busca), a nova busca era descartada em silêncio e
-- só voltava na rotina diária. Agora ela recebe uma chave própria. A consulta
-- da NF-e continua respeitando o intervalo exigido pela SEFAZ no processador.
-- =============================================================================
create or replace function app.agendar_notas_automaticas(p_empresa_id uuid, p_quando timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quando timestamptz := greatest(coalesce(p_quando, now()), now());
  v_chave text := 'notas:' || p_empresa_id::text || ':' || to_char(v_quando at time zone 'UTC', 'YYYYMMDDHH24MI');
begin
  if exists (select 1 from public.jobs where tipo = 'notas_automaticas' and empresa_id = p_empresa_id and status = 'pendente'
                and executar_apos <= v_quando + interval '1 minute') then
    return;
  end if;
  -- Chave do minuto já usada por uma busca que terminou, falhou ou foi cancelada
  if exists (select 1 from public.jobs where chave_idempotencia = v_chave and status <> 'pendente') then
    v_chave := v_chave || ':' || to_char(clock_timestamp() at time zone 'UTC', 'SSUS');
  end if;
  perform app.enfileirar('notas_automaticas', jsonb_build_object('empresa_id', p_empresa_id), p_empresa_id, v_chave, v_quando, 150);
end;
$$;
