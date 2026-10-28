-- =============================================================================
-- DAR-1/AUT da SEFAZ-MT gerado pelo robô do portal (ICMS do mês)
--
-- O servidor do portal preenche o formulário público da SEFAZ-MT (Emissão de
-- DAR → Pessoa Jurídica Inscrita) com o ICMS apurado, a multa e os juros de
-- atraso, baixa o PDF oficial e publica como guia da empresa (agenda de
-- pagamentos do cliente, com o "paguei").
--
--  * dar_emissoes: cada DAR registrado na SEFAZ (número, valores, PDF publicado).
--  * dados_dar_icms: o que a tela precisa (EFD gerada do mês, vencimento em
--    dia útil, último dia útil do mês para pagar, DAR já emitidos).
--  * dar_registrar_emissao / dar_vincular_documento: gravados pelo servidor
--    depois da emissão, com a permissão de quem pediu.
-- =============================================================================

create table public.dar_emissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  uf text not null default 'MT' check (uf ~ '^[A-Z]{2}$'),
  receita text not null check (receita ~ '^[0-9]{3,6}$'),
  numero text not null unique check (numero ~ '^[0-9]{6,20}$'),
  principal numeric(15, 2) not null check (principal > 0),
  multa numeric(15, 2) not null default 0 check (multa >= 0),
  juros numeric(15, 2) not null default 0 check (juros >= 0),
  total numeric(15, 2) not null check (total = principal + multa + juros),
  -- Vencimento do imposto (já em dia útil) e validade do DAR (pagar até)
  vencimento_imposto date not null,
  vencimento date not null,
  dias_atraso int not null default 0 check (dias_atraso >= 0),
  multa_percentual numeric(7, 3) not null default 0,
  juros_percentual numeric(7, 4) not null default 0,
  meses_selic text[] not null default '{}',
  linha_digitavel text check (linha_digitavel is null or linha_digitavel ~ '^[0-9 -]{48,60}$'),
  -- De onde veio o valor: EFD gerada no portal ou informado pela equipe
  origem text not null check (origem in ('efd', 'informado')),
  efd_geracao_id uuid references public.efd_geracoes(id) on delete set null,
  documento_id uuid,
  gerado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint dar_emissoes_documento_fk foreign key (empresa_id, documento_id)
    references public.documentos (empresa_id, id) on delete set null (documento_id)
);
create index dar_emissoes_empresa_idx on public.dar_emissoes (empresa_id, competencia, created_at desc);
create trigger auditoria_dar_emissoes after insert or update or delete on public.dar_emissoes
  for each row execute function app.tg_auditoria();
alter table public.dar_emissoes enable row level security;
create policy dar_emissoes_leitura on public.dar_emissoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('calculos.gerenciar'))::uuid[]));
grant select on public.dar_emissoes to authenticated;

-- -----------------------------------------------------------------------------
-- Dados da tela
-- -----------------------------------------------------------------------------
create or replace function public.dados_dar_icms(p_empresa_id uuid, p_competencia date, p_vencimento date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_emp public.empresas;
  v_ajuste text;
  v_efd jsonb;
  v_venc date;
  v_hoje date := app.hoje();
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  select coalesce(u.vencimento_ajuste, 'postergar') into v_ajuste from public.icms_uf u where u.uf = upper(v_emp.uf);

  select jsonb_build_object(
           'id', g.id,
           'finalidade', g.finalidade,
           'a_recolher', g.resumo #>> '{apuracao,a_recolher}',
           'vencimento', g.resumo ->> 'vencimento',
           'created_at', g.created_at)
    into v_efd
    from public.efd_geracoes g
   where g.empresa_id = p_empresa_id and g.competencia = v_comp
   order by g.created_at desc
   limit 1;

  v_venc := coalesce(p_vencimento, nullif(v_efd ->> 'vencimento', '')::date);

  return jsonb_build_object(
    'empresa', jsonb_build_object(
      'uf', upper(v_emp.uf),
      'inscricao_estadual', v_emp.inscricao_estadual,
      'municipio_ibge', v_emp.municipio_ibge,
      'demonstracao', v_emp.demonstracao,
      'regime', v_emp.regime_tributario,
      'contribuinte_icms', v_emp.contribuinte_icms),
    'efd', v_efd,
    'vencimento_informado', v_venc,
    'vencimento_util', case when v_venc is not null
                            then app.ajustar_dia_util(v_venc, coalesce(v_ajuste, 'postergar'), upper(v_emp.uf), v_emp.municipio_ibge, true) end,
    'hoje', v_hoje,
    'ultimo_dia_util', app.ajustar_dia_util((date_trunc('month', v_hoje) + interval '1 month - 1 day')::date, 'antecipar', upper(v_emp.uf), v_emp.municipio_ibge, true),
    'emissoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'numero', d.numero,
               'principal', d.principal,
               'multa', d.multa,
               'juros', d.juros,
               'total', d.total,
               'vencimento', d.vencimento,
               'linha_digitavel', d.linha_digitavel,
               'documento_id', d.documento_id,
               'origem', d.origem,
               'gerado_por', p.nome,
               'created_at', d.created_at) order by d.created_at desc)
        from public.dar_emissoes d
        left join public.perfis p on p.id = d.gerado_por
       where d.empresa_id = p_empresa_id and d.competencia = v_comp
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Gravação (pelo servidor, depois de o robô emitir o DAR)
-- -----------------------------------------------------------------------------
create or replace function public.dar_registrar_emissao(p_empresa_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_comp date := date_trunc('month', (p_dados ->> 'competencia')::date)::date;
  v_efd uuid := nullif(p_dados ->> 'efd_geracao_id', '')::uuid;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if v_efd is not null and not exists (
    select 1 from public.efd_geracoes g where g.id = v_efd and g.empresa_id = p_empresa_id and g.competencia = v_comp) then
    raise exception 'EFD do mês não encontrada.';
  end if;
  insert into public.dar_emissoes (
    empresa_id, competencia, uf, receita, numero, principal, multa, juros, total,
    vencimento_imposto, vencimento, dias_atraso, multa_percentual, juros_percentual, meses_selic,
    linha_digitavel, origem, efd_geracao_id)
  values (
    p_empresa_id, v_comp, upper(coalesce(p_dados ->> 'uf', 'MT')), p_dados ->> 'receita', p_dados ->> 'numero',
    (p_dados ->> 'principal')::numeric, coalesce((p_dados ->> 'multa')::numeric, 0), coalesce((p_dados ->> 'juros')::numeric, 0),
    (p_dados ->> 'total')::numeric, (p_dados ->> 'vencimento_imposto')::date, (p_dados ->> 'vencimento')::date,
    coalesce((p_dados ->> 'dias_atraso')::int, 0), coalesce((p_dados ->> 'multa_percentual')::numeric, 0),
    coalesce((p_dados ->> 'juros_percentual')::numeric, 0),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_dados -> 'meses_selic', '[]'::jsonb))), '{}'),
    nullif(p_dados ->> 'linha_digitavel', ''), p_dados ->> 'origem', v_efd)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.dar_vincular_documento(p_id uuid, p_documento_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.dar_emissoes where id = p_id;
  if v_empresa is null then
    raise exception 'DAR não encontrado.';
  end if;
  perform app.exigir(v_empresa, 'calculos.gerenciar');
  if not exists (
    select 1 from public.documentos d
     where d.id = p_documento_id and d.empresa_id = v_empresa and d.categoria_codigo = 'esc_guia' and d.excluido_em is null) then
    raise exception 'Guia não encontrada.';
  end if;
  update public.dar_emissoes set documento_id = p_documento_id where id = p_id;
end;
$$;

revoke execute on function public.dados_dar_icms(uuid, date, date), public.dar_registrar_emissao(uuid, jsonb), public.dar_vincular_documento(uuid, uuid) from public, anon;
grant execute on function public.dados_dar_icms(uuid, date, date), public.dar_registrar_emissao(uuid, jsonb), public.dar_vincular_documento(uuid, uuid) to authenticated;
