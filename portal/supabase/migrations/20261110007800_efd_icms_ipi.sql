-- =============================================================================
-- Gerador da EFD ICMS/IPI (SPED Fiscal)
--
-- O portal monta o arquivo da EFD do mês a partir dos XML guardados (NF-e,
-- NFC-e e CT-e de entrada e de saída) e da apuração do ICMS conferida pelo
-- escritório (destinação das entradas, lançamentos e saldo credor). O arquivo
-- é baixado pela equipe, validado e assinado no PVA da Receita e transmitido
-- pelo escritório: o portal não transmite nada à SEFAZ.
--
--  1. complemento das notas: endereço e município (IBGE) do emitente e do
--     destinatário, modalidade do frete, indicador de pagamento, data de saída e
--     os dados do CT-e (municípios de início e fim, CST, base e alíquota) —
--     exigidos nos registros 0150, C100 e D100. Gravado na leitura do XML.
--  2. CPF, e-mail e telefone do contador (registro 0100), visíveis só para a
--     equipe do escritório.
--  3. código de ajuste da apuração (tabela 5.1.1 do estado) nos lançamentos do
--     ICMS, para o registro E111.
--  4. configuração da EFD por empresa (perfil e código de receita do ICMS). O
--     PIS e a Cofins ficam vazios: as empresas do regime normal entregam a
--     EFD-Contribuições, que os dispensa na EFD ICMS/IPI.
--  5. histórico dos arquivos gerados (o arquivo fica no armazenamento privado
--     "efd", que só a equipe da empresa lê).
--  6. dados do mês para o gerador (somente a equipe com "calculos.gerenciar").
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Complemento da leitura das notas
-- -----------------------------------------------------------------------------
alter table public.documentos_fiscais
  add column complemento jsonb check (complemento is null or (jsonb_typeof(complemento) = 'object' and pg_column_size(complemento) <= 20000));

-- Mesma função, agora gravando o complemento (leitura 5)
create or replace function public.atualizar_leitura_xml_fiscal(p_documento_fiscal_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_dados ->> 'tipo' is distinct from 'nota' then
    raise exception 'Somente notas fiscais.';
  end if;
  update public.documentos_fiscais
     set crt_emitente = nullif(p_dados ->> 'crt_emitente', ''),
         consumidor_final = (p_dados ->> 'consumidor_final')::boolean,
         id_destino = nullif(p_dados ->> 'id_destino', ''),
         ind_ie_dest = nullif(p_dados ->> 'ind_ie_dest', ''),
         tributos = coalesce(p_dados -> 'tributos', tributos),
         complemento = case when jsonb_typeof(p_dados -> 'complemento') = 'object' then p_dados -> 'complemento' else complemento end,
         leitura_versao = coalesce((p_dados ->> 'leitura_versao')::smallint, 2)
   where id = p_documento_fiscal_id;
  if not found then
    raise exception 'Nota não encontrada.';
  end if;
  update public.documento_fiscal_itens i
     set gtin = x.gtin,
         cest = x.cest,
         ex_tipi = x.ex_tipi,
         ncm = coalesce(x.ncm, i.ncm),
         cfop = coalesce(x.cfop, i.cfop),
         tributos = coalesce(x.tributos, i.tributos)
    from jsonb_to_recordset(coalesce(p_dados -> 'itens', '[]'::jsonb))
         as x(numero_item int, gtin text, cest text, ex_tipi text, ncm text, cfop text, tributos jsonb)
   where i.documento_fiscal_id = p_documento_fiscal_id
     and i.numero_item = x.numero_item;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Contador responsável: nome e CRC continuam no cadastro do escritório (as
--    declarações já usam); CPF e contatos ficam numa tabela só da equipe.
-- -----------------------------------------------------------------------------
-- O formulário do escritório grava nome e CRC do contador: faltava a permissão
grant update (contador_nome, contador_crc) on public.escritorio to authenticated;

create table public.escritorio_contador (
  id smallint primary key default 1 check (id = 1),
  cpf text check (cpf is null or app.cpf_valido(cpf)),
  email text check (email is null or (length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.perfis(id) on delete set null
);
create trigger escritorio_contador_updated_at before update on public.escritorio_contador
  for each row execute function app.tg_updated_at();
create trigger auditoria_escritorio_contador after insert or update or delete on public.escritorio_contador
  for each row execute function app.tg_auditoria();
insert into public.escritorio_contador (id) values (1) on conflict do nothing;

alter table public.escritorio_contador enable row level security;
create policy escritorio_contador_leitura on public.escritorio_contador for select to authenticated
  using ((select app.is_equipe()));
create policy escritorio_contador_alteracao on public.escritorio_contador for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select on public.escritorio_contador to authenticated;
grant update (cpf, email, telefone, updated_by) on public.escritorio_contador to authenticated;
grant select, insert, update on public.escritorio_contador to service_role;

-- -----------------------------------------------------------------------------
-- 3. Código de ajuste da apuração nos lançamentos do ICMS (registro E111)
--    Formato da tabela 5.1.1: UF + "0" (ICMS próprio) + tipo + 4 dígitos.
--    O tipo (4º caractere) acompanha o lançamento: 0 outros débitos,
--    1 estorno de crédito, 2 outros créditos, 3 estorno de débito, 4 dedução.
-- -----------------------------------------------------------------------------
alter table public.icms_lancamentos
  add column codigo_ajuste text check (codigo_ajuste is null or codigo_ajuste ~ '^[A-Z]{2}0[0-5][0-9]{4}$');
grant insert (codigo_ajuste) on public.icms_lancamentos to authenticated;

create or replace function app.icms_tipo_do_codigo_ajuste(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_tipo
    when 'outro_debito' then '0'
    when 'estorno_credito' then '1'
    when 'outro_credito' then '2'
    when 'estorno_debito' then '3'
    when 'deducao' then '4'
  end;
$$;

-- O código precisa ser do estado da empresa e do mesmo tipo do lançamento
create or replace function app.tg_icms_lancamento_codigo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uf text;
begin
  if new.codigo_ajuste is null then
    return new;
  end if;
  new.codigo_ajuste := upper(new.codigo_ajuste);
  if new.tipo = 'guia_extra' then
    raise exception 'Guias à parte não entram na apuração da EFD: deixe o código de ajuste vazio.';
  end if;
  select upper(e.uf) into v_uf from public.empresas e where e.id = new.empresa_id;
  if left(new.codigo_ajuste, 2) is distinct from v_uf then
    raise exception 'O código de ajuste deve começar pela UF da empresa (%).', coalesce(v_uf, '?');
  end if;
  if substr(new.codigo_ajuste, 4, 1) is distinct from app.icms_tipo_do_codigo_ajuste(new.tipo) then
    raise exception 'O 4º caractere do código (%) não corresponde ao tipo do lançamento (esperado: %).',
      substr(new.codigo_ajuste, 4, 1), app.icms_tipo_do_codigo_ajuste(new.tipo);
  end if;
  return new;
end;
$$;
create trigger icms_lancamentos_codigo before insert or update of codigo_ajuste on public.icms_lancamentos
  for each row execute function app.tg_icms_lancamento_codigo();

-- Informar ou trocar o código de um lançamento já feito (não muda valores:
-- vale mesmo com o mês conferido)
create or replace function public.icms_definir_codigo_ajuste(p_lancamento_id uuid, p_codigo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lanc public.icms_lancamentos;
begin
  select * into v_lanc from public.icms_lancamentos where id = p_lancamento_id;
  if not found then
    raise exception 'Lançamento não encontrado.';
  end if;
  perform app.exigir(v_lanc.empresa_id, 'calculos.gerenciar');
  update public.icms_lancamentos
     set codigo_ajuste = nullif(upper(trim(coalesce(p_codigo, ''))), '')
   where id = p_lancamento_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Configuração da EFD por empresa
-- -----------------------------------------------------------------------------
create table public.efd_configuracoes (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  -- Perfil definido pela SEFAZ (Mato Grosso: perfil A para todos)
  perfil char(1) not null default 'A' check (perfil in ('A', 'B', 'C')),
  -- Código de receita do ICMS normal no estado (registro E116)
  codigo_receita text check (codigo_receita is null or codigo_receita ~ '^[0-9A-Za-z.\-]{1,20}$'),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger efd_configuracoes_updated_at before update on public.efd_configuracoes
  for each row execute function app.tg_updated_at();
create trigger auditoria_efd_configuracoes after insert or update or delete on public.efd_configuracoes
  for each row execute function app.tg_auditoria();
alter table public.efd_configuracoes enable row level security;
create policy efd_configuracoes_leitura on public.efd_configuracoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('calculos.gerenciar'))::uuid[]));
grant select on public.efd_configuracoes to authenticated;
grant select, insert, update, delete on public.efd_configuracoes to service_role;

create or replace function public.efd_salvar_configuracao(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil text := upper(coalesce(nullif(trim(p_dados ->> 'perfil'), ''), 'A'));
  v_codigo text := nullif(trim(coalesce(p_dados ->> 'codigo_receita', '')), '');
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  if v_perfil not in ('A', 'B', 'C') then
    raise exception 'Perfil inválido.';
  end if;
  if v_codigo is not null and v_codigo !~ '^[0-9A-Za-z.\-]{1,20}$' then
    raise exception 'Código de receita inválido.';
  end if;
  insert into public.efd_configuracoes as c (empresa_id, perfil, codigo_receita, atualizado_por)
  values (p_empresa_id, v_perfil, v_codigo, auth.uid())
  on conflict (empresa_id) do update
     set perfil = excluded.perfil,
         codigo_receita = excluded.codigo_receita,
         atualizado_por = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Arquivos gerados
-- -----------------------------------------------------------------------------
create table public.efd_geracoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  -- 0 original; 1 substituto (retificadora)
  finalidade smallint not null default 0 check (finalidade in (0, 1)),
  nome_arquivo text not null check (length(nome_arquivo) between 5 and 200),
  storage_path text not null check (length(storage_path) between 5 and 500),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tamanho int not null check (tamanho > 0),
  linhas int not null check (linhas > 0),
  -- Totais do arquivo (notas, E110) e avisos mostrados na geração
  resumo jsonb not null default '{}'::jsonb check (jsonb_typeof(resumo) = 'object' and pg_column_size(resumo) <= 100000),
  avisos jsonb not null default '[]'::jsonb check (jsonb_typeof(avisos) = 'array' and pg_column_size(avisos) <= 100000),
  gerado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index efd_geracoes_empresa_idx on public.efd_geracoes (empresa_id, competencia, created_at desc);
create trigger auditoria_efd_geracoes after insert or update or delete on public.efd_geracoes
  for each row execute function app.tg_auditoria();
alter table public.efd_geracoes enable row level security;
create policy efd_geracoes_leitura on public.efd_geracoes for select to authenticated
  using (empresa_id = any ((select app.empresas_com('calculos.gerenciar'))::uuid[]));
grant select on public.efd_geracoes to authenticated;
-- Gravado pelo servidor do portal depois de conferir a permissão e guardar o arquivo
grant select, insert, delete on public.efd_geracoes to service_role;

-- Registro da geração por quem gerou (permissão conferida aqui); o servidor
-- grava o arquivo no caminho devolvido.
create or replace function public.efd_registrar_geracao(p_empresa_id uuid, p_competencia date, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_comp date := date_trunc('month', p_competencia)::date;
  v_caminho text;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  v_caminho := format('%s/%s/%s.txt', p_empresa_id, to_char(v_comp, 'YYYY-MM'), v_id);
  insert into public.efd_geracoes (id, empresa_id, competencia, finalidade, nome_arquivo, storage_path, sha256, tamanho, linhas, resumo, avisos, gerado_por)
  values (v_id, p_empresa_id, v_comp, coalesce((p_dados ->> 'finalidade')::smallint, 0), p_dados ->> 'nome_arquivo', v_caminho,
          p_dados ->> 'sha256', (p_dados ->> 'tamanho')::int, (p_dados ->> 'linhas')::int,
          coalesce(p_dados -> 'resumo', '{}'::jsonb), coalesce(p_dados -> 'avisos', '[]'::jsonb), auth.uid());
  return jsonb_build_object('id', v_id, 'caminho', v_caminho);
end;
$$;

-- Arquivo gerado: armazenamento privado, na pasta da empresa ("<empresa>/<mês>/<geração>.txt").
-- Só a equipe que gerencia os cálculos da empresa baixa; quem grava é o servidor do portal.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('efd', 'efd', false, 104857600, array['text/plain'])
on conflict (id) do nothing;
create policy efd_storage_leitura on storage.objects for select to authenticated
  using (bucket_id = 'efd' and app.pode(app.empresa_do_objeto(name), 'calculos.gerenciar'));

-- -----------------------------------------------------------------------------
-- 6. Releitura das notas do mês para a EFD (inclui os CT-e)
-- -----------------------------------------------------------------------------
create or replace function public.efd_reler_notas(p_empresa_id uuid, p_competencia date, p_versao_leitura int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_total int;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  select count(*) into v_total
    from public.documentos_fiscais df
   where df.empresa_id = p_empresa_id and df.competencia = v_comp and df.modelo in ('55', '65', '57')
     and df.leitura_versao < p_versao_leitura;
  if v_total > 0 then
    perform app.enfileirar('reler_notas_mes', jsonb_build_object('empresa_id', p_empresa_id, 'competencia', v_comp), p_empresa_id,
                           format('reler:%s:%s:%s', p_empresa_id, to_char(v_comp, 'YYYY-MM'), to_char(now(), 'YYYYMMDDHH24MI')), now(), 70);
  end if;
  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Dados do mês para o gerador (equipe)
--    Todas as NF-e, NFC-e e CT-e do mês em que a empresa é emitente,
--    destinatária ou tomadora, com os itens, as canceladas (as próprias entram
--    como canceladas no arquivo) e os vínculos dos itens com os produtos da
--    empresa (código próprio do item no registro 0200).
-- -----------------------------------------------------------------------------
create or replace function public.dados_efd_icms_ipi(p_empresa_id uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_emp public.empresas;
  v_esc public.escritorio;
  v_cont public.escritorio_contador;
  v_dados jsonb;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  select * into v_esc from public.escritorio where id = 1;
  select * into v_cont from public.escritorio_contador where id = 1;

  with notas as (
    select df.*,
           df.cancelada_evento or df.avisos::text ilike '%registro de cancelamento%' as cancelada
      from public.documentos_fiscais df
      join public.documentos d on d.id = df.documento_id and d.empresa_id = df.empresa_id
     where df.empresa_id = p_empresa_id
       and df.competencia = v_comp
       and df.relacionado_empresa
       and df.modelo in ('55', '65', '57')
       and df.operacao in ('entrada', 'saida')
       and df.situacao_arquivo <> 'protocolo_nao_autorizado_no_arquivo'
       and d.excluido_em is null
       and coalesce(d.verificacao_status, '') <> 'bloqueado'
  )
  select jsonb_build_object(
    'notas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id,
               'modelo', n.modelo,
               'chave', n.chave_acesso,
               'numero', n.numero,
               'serie', n.serie,
               'data_emissao', n.data_emissao,
               'operacao', n.operacao,
               'tp_nf', n.tp_nf,
               'finalidade', n.finalidade,
               'natureza', n.natureza_operacao,
               'emitente_documento', n.emitente_documento,
               'emitente_nome', n.emitente_nome,
               'emitente_uf', n.emitente_uf,
               'emitente_ie', n.emitente_ie,
               'destinatario_documento', n.destinatario_documento,
               'destinatario_nome', n.destinatario_nome,
               'destinatario_uf', n.destinatario_uf,
               'valor_total', n.valor_total,
               'valor_produtos', n.valor_produtos,
               'valor_desconto', n.valor_desconto,
               'valor_frete', n.valor_frete,
               'valor_outros', n.valor_outros,
               'tributos', n.tributos,
               'cfops', n.cfops,
               'cancelada', n.cancelada,
               'duplicatas', jsonb_array_length(coalesce(n.duplicatas, '[]'::jsonb)),
               'pagamentos', coalesce(n.pagamentos, '[]'::jsonb),
               'complemento', n.complemento,
               'leitura', n.leitura_versao,
               'itens', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'n', i.numero_item,
                          'codigo', i.codigo,
                          'descricao', left(i.descricao, 200),
                          'ncm', i.ncm,
                          'cfop', i.cfop,
                          'unidade', i.unidade,
                          'quantidade', i.quantidade,
                          'valor', i.valor_total,
                          'desconto', i.valor_desconto,
                          'tributos', i.tributos,
                          'gtin', i.gtin,
                          'cest', i.cest,
                          'ex_tipi', i.ex_tipi,
                          'produto', (
                            select jsonb_build_object('codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                                                      'ncm', p.ncm, 'gtin', p.gtin, 'cest', p.cest, 'fator', v.fator)
                              from public.estoque_vinculos v
                              join public.nfe_produtos p on p.id = v.produto_id
                             where v.empresa_id = p_empresa_id
                               and v.fornecedor_documento = n.emitente_documento
                               and v.codigo_fornecedor = i.codigo
                             limit 1)
                        ) order by i.numero_item)
                   from public.documento_fiscal_itens i
                  where i.documento_fiscal_id = n.id
               ), '[]'::jsonb)
             ) order by n.data_emissao, n.numero)
        from notas n
    ), '[]'::jsonb),
    -- NF-e recebidas só em resumo (sem o XML completo): faltam no arquivo
    'sem_xml', coalesce((
      select jsonb_agg(jsonb_build_object('chave', r.chave, 'emitente', r.emitente_nome, 'emitente_documento', r.emitente_documento,
                                          'data', r.data_emissao, 'valor', r.valor) order by r.data_emissao)
        from public.nfe_resumos r
       where r.empresa_id = p_empresa_id
         and r.situacao = 'autorizada'
         and r.documento_id is null
         and date_trunc('month', r.data_emissao at time zone 'America/Araguaina')::date = v_comp
         and not exists (select 1 from public.documentos_fiscais df where df.empresa_id = p_empresa_id and df.chave_acesso = r.chave)
    ), '[]'::jsonb),
    'icms_por_operacao', exists (select 1 from public.nfe_operacoes o where o.empresa_id = p_empresa_id and o.ativa and o.icms_por_operacao)
  )
  into v_dados
  from (select 1) x;

  return v_dados || jsonb_build_object(
    'competencia', v_comp,
    'empresa', jsonb_build_object(
      'razao_social', v_emp.razao_social,
      'nome_fantasia', v_emp.nome_fantasia,
      'tipo_pessoa', v_emp.tipo_pessoa,
      'documento', v_emp.documento,
      'inscricao_estadual', v_emp.inscricao_estadual,
      'inscricao_municipal', v_emp.inscricao_municipal,
      'uf', upper(v_emp.uf),
      'municipio_ibge', v_emp.municipio_ibge,
      'logradouro', v_emp.logradouro,
      'numero', v_emp.numero,
      'complemento', v_emp.complemento,
      'bairro', v_emp.bairro,
      'cep', v_emp.cep,
      'telefone', v_emp.telefone,
      'email', v_emp.email,
      'cnae', v_emp.cnae,
      'regime', app.regime_em(p_empresa_id, v_comp),
      'contribuinte_icms', v_emp.contribuinte_icms,
      'demonstracao', v_emp.demonstracao
    ),
    'contador', jsonb_build_object(
      'nome', v_esc.contador_nome,
      'crc', v_esc.contador_crc,
      'cpf', v_cont.cpf,
      'email', coalesce(v_cont.email, v_esc.email),
      'telefone', coalesce(v_cont.telefone, v_esc.telefone),
      'cnpj', v_esc.cnpj,
      'cep', v_esc.cep,
      'logradouro', v_esc.logradouro,
      'numero', v_esc.numero,
      'complemento', v_esc.complemento,
      'bairro', v_esc.bairro,
      'municipio_ibge', (select m.ibge from public.municipios m
                          where m.uf = upper(v_esc.uf) and app.normalizar(m.nome) = app.normalizar(trim(coalesce(v_esc.cidade, '')))
                          limit 1)
    ),
    'config', (
      select jsonb_build_object('perfil', c.perfil, 'codigo_receita', c.codigo_receita)
        from public.efd_configuracoes c where c.empresa_id = p_empresa_id
    ),
    'lancamentos_codigos', coalesce((
      select jsonb_object_agg(l.id, l.codigo_ajuste)
        from public.icms_lancamentos l
       where l.empresa_id = p_empresa_id and l.competencia = v_comp and l.codigo_ajuste is not null
    ), '{}'::jsonb),
    'municipios', coalesce((
      select jsonb_object_agg(m.ibge, m.uf)
        from public.municipios m
       where m.ibge in (
         select x from (
           select n.complemento #>> '{emitente,cmun}' as x from public.documentos_fiscais n where n.empresa_id = p_empresa_id and n.competencia = v_comp
           union select n.complemento #>> '{destinatario,cmun}' from public.documentos_fiscais n where n.empresa_id = p_empresa_id and n.competencia = v_comp
           union select n.complemento #>> '{cte,cmun_ini}' from public.documentos_fiscais n where n.empresa_id = p_empresa_id and n.competencia = v_comp
           union select n.complemento #>> '{cte,cmun_fim}' from public.documentos_fiscais n where n.empresa_id = p_empresa_id and n.competencia = v_comp
         ) t where x is not null)
    ), '{}'::jsonb),
    'geracoes', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'nome', g.nome_arquivo, 'finalidade', g.finalidade, 'linhas', g.linhas,
                                          'tamanho', g.tamanho, 'resumo', g.resumo, 'criado_em', g.created_at,
                                          'gerado_por', (select p.nome from public.perfis p where p.id = g.gerado_por))
                       order by g.created_at desc)
        from public.efd_geracoes g
       where g.empresa_id = p_empresa_id and g.competencia = v_comp
    ), '[]'::jsonb),
    'releitura_pendente', exists (
      select 1 from public.jobs j
       where j.tipo = 'reler_notas_mes' and j.empresa_id = p_empresa_id and j.status in ('pendente', 'executando')
         and j.payload ->> 'competencia' = to_char(v_comp, 'YYYY-MM-DD')
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões das funções
-- -----------------------------------------------------------------------------
revoke execute on function public.icms_definir_codigo_ajuste(uuid, text), public.efd_salvar_configuracao(uuid, jsonb),
  public.efd_registrar_geracao(uuid, date, jsonb), public.efd_reler_notas(uuid, date, int), public.dados_efd_icms_ipi(uuid, date) from public, anon;
grant execute on function public.icms_definir_codigo_ajuste(uuid, text), public.efd_salvar_configuracao(uuid, jsonb),
  public.efd_registrar_geracao(uuid, date, jsonb), public.efd_reler_notas(uuid, date, int), public.dados_efd_icms_ipi(uuid, date) to authenticated;
revoke execute on function app.icms_tipo_do_codigo_ajuste(text), app.tg_icms_lancamento_codigo() from public, anon, authenticated;
