-- Declaração de faturamento: o escritório escolhe o período (por exemplo, os
-- últimos 12 meses), confere e ajusta o faturamento de cada mês (sugerido a
-- partir das notas do portal) e emite um PDF com a identidade do escritório e
-- as logos do escritório e do cliente, para o representante legal e o contador
-- assinarem (certificado digital, gov.br ou à mão). A versão assinada volta ao
-- portal. A declaração emitida não muda: para corrigir, emite-se outra.

-- Contador responsável pelas declarações (nome e CRC)
alter table public.escritorio
  add column contador_nome text check (contador_nome is null or length(contador_nome) <= 200),
  add column contador_crc text check (contador_crc is null or length(contador_crc) <= 40);

-- -----------------------------------------------------------------------------
-- Faturamento por mês a partir das notas do portal (mesmas regras da previsão
-- de impostos): vendas e serviços em NF-e/NFC-e pelo CFOP, NFS-e e CT-e
-- prestados, devoluções de vendas recebidas e a receita informada nos Cálculos.
-- -----------------------------------------------------------------------------
create or replace function public.faturamento_mensal(p_empresa_id uuid, p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inicio date := date_trunc('month', p_inicio)::date;
  v_fim date := date_trunc('month', p_fim)::date;
  v_meses jsonb;
begin
  perform app.exigir(p_empresa_id, 'relatorios.publicar');
  if v_fim < v_inicio or v_fim >= (v_inicio + interval '36 months')::date then
    raise exception 'Escolha um período de 1 a 36 meses.' using errcode = '22023';
  end if;

  with notas as (
    select df.*
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
     where df.empresa_id = p_empresa_id
       and df.competencia between v_inicio and v_fim
       and df.relacionado_empresa
       and not df.cancelada_evento
       and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
       and d.excluido_em is null
       and coalesce(d.verificacao_status, '') <> 'bloqueado'
       and not (df.avisos::text ilike '%registro de cancelamento%')
  ),
  itens as (
    select n.competencia, n.operacao, i.cfop, coalesce(i.valor_total, 0) - coalesce(i.valor_desconto, 0) as valor
      from notas n
      join public.documento_fiscal_itens i on i.documento_fiscal_id = n.id
     where n.modelo in ('55', '65')
  ),
  servicos as (
    select n.competencia, coalesce(n.valor_servicos, n.valor_total, 0) as valor
      from notas n
     where n.operacao = 'saida' and n.modelo in ('nfse_nacional', 'nfse_abrasf', '57')
  ),
  meses as (
    select g::date as competencia from generate_series(v_inicio, v_fim, interval '1 month') g
  )
  select jsonb_agg(jsonb_build_object(
           'competencia', m.competencia,
           'vendas', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_venda(i.cfop)),
           'servicos_nfe', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'saida' and app.cfop_servico(i.cfop)),
           'servicos', (select coalesce(sum(valor), 0) from servicos s where s.competencia = m.competencia),
           'devolucoes', (select coalesce(sum(valor), 0) from itens i where i.competencia = m.competencia and i.operacao = 'entrada' and app.cfop_devolucao_venda(i.cfop)),
           'notas_saida', (select count(*) from notas n where n.competencia = m.competencia and n.operacao = 'saida'),
           'informado', (select case when cm.receita_mercadorias is null and cm.receita_servicos is null then null
                                     else coalesce(cm.receita_mercadorias, 0) + coalesce(cm.receita_servicos, 0) end
                           from public.calculo_meses cm where cm.empresa_id = p_empresa_id and cm.competencia = m.competencia)
         ) order by m.competencia)
    into v_meses
    from meses m;
  return coalesce(v_meses, '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Declarações emitidas
-- -----------------------------------------------------------------------------
create table public.declaracoes_faturamento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  periodo_inicio date not null check (extract(day from periodo_inicio) = 1),
  periodo_fim date not null check (extract(day from periodo_fim) = 1),
  -- [{ competencia: "AAAA-MM-01", valor: 1234.56, origem: "notas" | "informado" | "digitado" }]
  meses jsonb not null check (jsonb_typeof(meses) = 'array'),
  total numeric(15,2) not null check (total >= 0),
  finalidade text check (finalidade is null or length(finalidade) <= 300),
  observacao text check (observacao is null or length(observacao) <= 1000),
  cidade text not null check (length(trim(cidade)) between 2 and 100),
  uf char(2),
  data_declaracao date not null,
  representante_nome text not null check (length(trim(representante_nome)) between 3 and 200),
  representante_cpf text check (representante_cpf is null or representante_cpf ~ '^[0-9]{11}$'),
  representante_cargo text check (representante_cargo is null or length(representante_cargo) <= 100),
  contador_nome text not null check (length(trim(contador_nome)) between 3 and 200),
  contador_crc text not null check (length(trim(contador_crc)) between 3 and 40),
  situacao text not null default 'emitida' check (situacao in ('emitida', 'assinada', 'cancelada')),
  assinada_path text,
  assinada_em timestamptz,
  assinada_por uuid references public.perfis(id) on delete set null,
  -- O PDF enviado tem assinatura digital embutida (presença; a validade se confere no verificador do ITI)
  assinatura_digital boolean,
  cancelada_em timestamptz,
  cancelada_por uuid references public.perfis(id) on delete set null,
  motivo_cancelamento text check (motivo_cancelamento is null or length(motivo_cancelamento) <= 500),
  criado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now(),
  constraint declaracoes_periodo check (periodo_fim >= periodo_inicio and periodo_fim < (periodo_inicio + interval '36 months')::date),
  constraint declaracoes_assinada_na_pasta check (assinada_path is null or assinada_path like empresa_id::text || '/' || id::text || '/%')
);
create index declaracoes_empresa_idx on public.declaracoes_faturamento (empresa_id, criado_em desc);

alter table public.declaracoes_faturamento enable row level security;
-- Leitura: quem vê os relatórios da empresa (equipe e empresário). Escrita só pelas funções abaixo.
create policy declaracoes_leitura on public.declaracoes_faturamento for select to authenticated
  using (empresa_id = any ((select app.empresas_com('relatorios.ver'))::uuid[]));
grant select on public.declaracoes_faturamento to authenticated;

-- Emissão (equipe): um valor de zero para cima para cada mês do período; o total é calculado aqui.
create or replace function public.emitir_declaracao_faturamento(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_inicio date;
  v_fim date;
  v_esperados int;
  v_ok boolean;
  v_meses jsonb;
  v_total numeric(15,2);
  v_cpf text := nullif(regexp_replace(coalesce(p_dados ->> 'representante_cpf', ''), '\D', '', 'g'), '');
begin
  perform app.exigir(p_empresa_id, 'relatorios.publicar');
  begin
    v_inicio := (p_dados ->> 'periodo_inicio')::date;
    v_fim := (p_dados ->> 'periodo_fim')::date;
  exception when others then
    raise exception 'Período inválido.' using errcode = '22023';
  end;
  if v_inicio is null or v_fim is null or extract(day from v_inicio) <> 1 or extract(day from v_fim) <> 1
     or v_fim < v_inicio or v_fim >= (v_inicio + interval '36 months')::date then
    raise exception 'Período inválido: escolha de 1 a 36 meses.' using errcode = '22023';
  end if;
  if v_cpf is not null and not app.cpf_valido(v_cpf) then
    raise exception 'CPF do representante inválido.' using errcode = '22023';
  end if;
  v_esperados := ((extract(year from v_fim) - extract(year from v_inicio)) * 12 + extract(month from v_fim) - extract(month from v_inicio))::int + 1;

  begin
    with m as (
      select (e ->> 'competencia')::date as competencia,
             round((e ->> 'valor')::numeric, 2) as valor,
             case when e ->> 'origem' in ('notas', 'informado', 'digitado') then e ->> 'origem' else 'digitado' end as origem
        from jsonb_array_elements(coalesce(p_dados -> 'meses', '[]'::jsonb)) e
    )
    select count(*) = v_esperados
           and count(distinct competencia) = v_esperados
           and min(competencia) = v_inicio and max(competencia) = v_fim
           and bool_and(extract(day from competencia) = 1)
           and bool_and(valor is not null and valor >= 0 and valor < 10000000000000),
           jsonb_agg(jsonb_build_object('competencia', competencia, 'valor', valor, 'origem', origem) order by competencia),
           coalesce(sum(valor), 0)
      into v_ok, v_meses, v_total
      from m;
  exception when others then
    raise exception 'Informe o faturamento de cada mês do período (valores de zero para cima).' using errcode = '22023';
  end;
  if not coalesce(v_ok, false) then
    raise exception 'Informe o faturamento de cada mês do período (valores de zero para cima).' using errcode = '22023';
  end if;

  insert into public.declaracoes_faturamento (
    empresa_id, periodo_inicio, periodo_fim, meses, total, finalidade, observacao, cidade, uf, data_declaracao,
    representante_nome, representante_cpf, representante_cargo, contador_nome, contador_crc
  ) values (
    p_empresa_id, v_inicio, v_fim, v_meses, v_total,
    nullif(trim(p_dados ->> 'finalidade'), ''), nullif(trim(p_dados ->> 'observacao'), ''),
    trim(coalesce(p_dados ->> 'cidade', '')), nullif(upper(trim(p_dados ->> 'uf')), ''),
    coalesce((p_dados ->> 'data_declaracao')::date, app.hoje()),
    trim(coalesce(p_dados ->> 'representante_nome', '')), v_cpf, nullif(trim(p_dados ->> 'representante_cargo'), ''),
    trim(coalesce(p_dados ->> 'contador_nome', '')), trim(coalesce(p_dados ->> 'contador_crc', ''))
  )
  returning id into v_id;

  perform app.registrar_auditoria('declaracao_faturamento_emitida', 'declaracoes_faturamento', v_id::text, p_empresa_id,
    jsonb_build_object('periodo_inicio', v_inicio, 'periodo_fim', v_fim, 'total', v_total));
  return v_id;
end;
$$;

-- Versão assinada (PDF) enviada pela equipe ou pelo empresário
create or replace function public.registrar_declaracao_assinada(p_id uuid, p_path text, p_assinatura_digital boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.declaracoes_faturamento;
begin
  select * into v from public.declaracoes_faturamento where id = p_id;
  if v.id is null then
    raise exception 'Declaração não encontrada.' using errcode = '22023';
  end if;
  if not (app.pode(v.empresa_id, 'relatorios.publicar') or (app.pode(v.empresa_id, 'relatorios.ver') and app.pode(v.empresa_id, 'documentos.enviar'))) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v.situacao = 'cancelada' then
    raise exception 'Esta declaração foi cancelada.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like v.empresa_id::text || '/' || v.id::text || '/%' then
    raise exception 'Arquivo inválido.' using errcode = '22023';
  end if;
  update public.declaracoes_faturamento
     set assinada_path = p_path, assinada_em = now(), assinada_por = auth.uid(), assinatura_digital = coalesce(p_assinatura_digital, false), situacao = 'assinada'
   where id = p_id;
  perform app.registrar_auditoria('declaracao_faturamento_assinada', 'declaracoes_faturamento', p_id::text, v.empresa_id,
    jsonb_build_object('assinatura_digital', coalesce(p_assinatura_digital, false)));
end;
$$;

-- Cancelamento (equipe), com motivo
create or replace function public.cancelar_declaracao_faturamento(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.declaracoes_faturamento;
begin
  select * into v from public.declaracoes_faturamento where id = p_id;
  if v.id is null then
    raise exception 'Declaração não encontrada.' using errcode = '22023';
  end if;
  perform app.exigir(v.empresa_id, 'relatorios.publicar');
  if coalesce(length(trim(p_motivo)), 0) < 5 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = '22023';
  end if;
  update public.declaracoes_faturamento
     set situacao = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancelamento = left(trim(p_motivo), 500)
   where id = p_id;
  perform app.registrar_auditoria('declaracao_faturamento_cancelada', 'declaracoes_faturamento', p_id::text, v.empresa_id,
    jsonb_build_object('motivo', left(trim(p_motivo), 500)));
end;
$$;

revoke execute on function public.faturamento_mensal(uuid, date, date), public.emitir_declaracao_faturamento(uuid, jsonb),
  public.registrar_declaracao_assinada(uuid, text, boolean), public.cancelar_declaracao_faturamento(uuid, text) from public, anon;
grant execute on function public.faturamento_mensal(uuid, date, date), public.emitir_declaracao_faturamento(uuid, jsonb),
  public.registrar_declaracao_assinada(uuid, text, boolean), public.cancelar_declaracao_faturamento(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- PDFs assinados: armazenamento privado, na pasta da empresa e da declaração
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('declaracoes', 'declaracoes', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy declaracoes_storage_leitura on storage.objects for select to authenticated
  using (bucket_id = 'declaracoes' and app.pode(app.empresa_do_objeto(name), 'relatorios.ver'));
create policy declaracoes_storage_insercao on storage.objects for insert to authenticated
  with check (bucket_id = 'declaracoes' and (app.pode(app.empresa_do_objeto(name), 'relatorios.publicar')
              or (app.pode(app.empresa_do_objeto(name), 'relatorios.ver') and app.pode(app.empresa_do_objeto(name), 'documentos.enviar'))));
create policy declaracoes_storage_exclusao on storage.objects for delete to authenticated
  using (bucket_id = 'declaracoes' and (app.pode(app.empresa_do_objeto(name), 'relatorios.publicar')
         or (app.pode(app.empresa_do_objeto(name), 'relatorios.ver') and app.pode(app.empresa_do_objeto(name), 'documentos.enviar'))));
