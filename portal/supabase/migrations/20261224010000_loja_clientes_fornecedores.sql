-- =============================================================================
-- Loja: cadastro de clientes e de fornecedores pela própria loja.
--
--  * O cadastro é o mesmo do Financeiro (public.contrapartes): sem duas listas
--    nem cliente repetido. Cada empresa só vê e mexe nos próprios cadastros
--    (regras abaixo e funções com a empresa conferida).
--  * O cadastro ganha endereço, inscrição estadual, contato e prazo de
--    pagamento. Cliente com CPF/CNPJ e endereço completo vira (ou atualiza) o
--    destinatário da NF-e: a nota da venda já sai com o endereço. O endereço
--    digitado na NF-e volta para o cadastro quando ele ainda não tem.
--  * Quem gerencia a loja cadastra e altera clientes e fornecedores e vê os
--    fornecedores; quem só vende vê os clientes e cadastra cliente novo.
--  * Valores de compra (notas do fornecedor, contas a pagar) só para quem tem
--    "Ver custos e margens" ou o Financeiro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Endereço, inscrição estadual, contato e prazo no cadastro
-- -----------------------------------------------------------------------------
alter table public.contrapartes
  add column cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  add column logradouro text check (logradouro is null or length(trim(logradouro)) between 2 and 60),
  add column numero text check (numero is null or length(trim(numero)) between 1 and 60),
  add column complemento text check (complemento is null or length(complemento) <= 60),
  add column bairro text check (bairro is null or length(trim(bairro)) between 1 and 60),
  add column municipio_ibge text references public.municipios(ibge),
  add column inscricao_estadual text check (inscricao_estadual is null or inscricao_estadual ~ '^[0-9]{2,14}$'),
  add column contato text check (contato is null or length(contato) <= 80),
  add column prazo_pagamento_dias smallint check (prazo_pagamento_dias is null or prazo_pagamento_dias between 0 and 365);

-- Quem gerencia a loja vê os fornecedores da empresa (os clientes já eram vistos pelo caixa)
create policy contrapartes_gestao_fornecedores on public.contrapartes for select to authenticated
  using ('fornecedor' = any(papeis) and empresa_id = any ((select app.empresas_com('gestao.gerenciar'))::uuid[]));

-- Endereço já cadastrado como destinatário da NF-e entra no cadastro
update public.contrapartes c
   set logradouro = left(d.logradouro, 60), numero = left(d.numero, 60), complemento = left(d.complemento, 60),
       bairro = left(d.bairro, 60), municipio_ibge = d.municipio_ibge, cep = coalesce(d.cep, c.cep),
       inscricao_estadual = coalesce(c.inscricao_estadual, d.inscricao_estadual),
       telefone = coalesce(c.telefone, d.telefone), email = coalesce(c.email, d.email)
  from public.nfe_destinatarios d
 where d.empresa_id = c.empresa_id and d.documento = c.documento and d.tipo in ('cpf', 'cnpj')
   and c.logradouro is null and d.municipio_ibge is not null;

-- -----------------------------------------------------------------------------
-- 2. Destinatário da NF-e a partir do cadastro (e o caminho de volta)
-- -----------------------------------------------------------------------------
create or replace function app.contraparte_para_destinatario(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.contrapartes;
begin
  select * into c from public.contrapartes where id = p_id;
  if c.id is null or c.documento is null or c.logradouro is null or c.numero is null or c.bairro is null or c.municipio_ibge is null then
    return;
  end if;
  insert into public.nfe_destinatarios (empresa_id, tipo, documento, nome, indicador_ie, inscricao_estadual, logradouro, numero, complemento,
                                        bairro, municipio_ibge, cep, telefone, email)
  values (c.empresa_id, case length(c.documento) when 11 then 'cpf' else 'cnpj' end, c.documento, left(trim(c.nome), 60),
          case when c.inscricao_estadual is not null then 1 else 9 end, c.inscricao_estadual,
          c.logradouro, c.numero, c.complemento, c.bairro, c.municipio_ibge, c.cep,
          case when c.telefone ~ '^[0-9]{6,14}$' then c.telefone end,
          case when length(c.email) <= 60 and c.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then c.email end)
  on conflict (empresa_id, tipo, documento) where documento is not null
  do update set nome = excluded.nome, indicador_ie = excluded.indicador_ie, inscricao_estadual = excluded.inscricao_estadual,
                logradouro = excluded.logradouro, numero = excluded.numero, complemento = excluded.complemento,
                bairro = excluded.bairro, municipio_ibge = excluded.municipio_ibge, cep = excluded.cep,
                telefone = coalesce(excluded.telefone, public.nfe_destinatarios.telefone),
                email = coalesce(excluded.email, public.nfe_destinatarios.email);
end;
$$;

-- Endereço digitado na NF-e completa o cadastro que ainda não tem endereço
create or replace function app.tg_destinatario_para_cadastro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.documento is not null and new.tipo in ('cpf', 'cnpj') and new.municipio_ibge is not null then
      update public.contrapartes c
         set logradouro = left(new.logradouro, 60), numero = left(new.numero, 60), complemento = left(new.complemento, 60),
             bairro = left(new.bairro, 60), municipio_ibge = new.municipio_ibge, cep = coalesce(new.cep, c.cep),
             inscricao_estadual = coalesce(c.inscricao_estadual, new.inscricao_estadual),
             telefone = coalesce(c.telefone, new.telefone), email = coalesce(c.email, new.email)
       where c.empresa_id = new.empresa_id and c.documento = new.documento and c.logradouro is null;
    end if;
  exception when others then
    raise warning 'Cadastro: não foi possível copiar o endereço do destinatário %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
create trigger nfe_destinatarios_cadastro after insert or update on public.nfe_destinatarios
  for each row execute function app.tg_destinatario_para_cadastro();

-- -----------------------------------------------------------------------------
-- 3. Salvar cliente ou fornecedor pela loja
-- -----------------------------------------------------------------------------
create or replace function public.gestao_contraparte_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel text := p_dados ->> 'papel';
  v_nome text := nullif(trim(p_dados ->> 'nome'), '');
  v_doc text := nullif(regexp_replace(coalesce(p_dados ->> 'documento', ''), '\D', '', 'g'), '');
  v_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(trim(p_dados ->> 'email')), '');
  v_cep text := nullif(regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'), '');
  v_log text := nullif(trim(p_dados ->> 'logradouro'), '');
  v_num text := nullif(trim(p_dados ->> 'numero'), '');
  v_comp text := nullif(trim(p_dados ->> 'complemento'), '');
  v_bairro text := nullif(trim(p_dados ->> 'bairro'), '');
  v_mun text := nullif(trim(p_dados ->> 'municipio_ibge'), '');
  v_ie text := nullif(regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'), '');
  v_contato text := nullif(trim(p_dados ->> 'contato'), '');
  v_obs text := nullif(trim(p_dados ->> 'observacoes'), '');
  v_prazo smallint;
  v_ativo boolean;
  v_gerencia boolean;
  v_atual public.contrapartes;
  v_outro public.contrapartes;
  v_id uuid;
begin
  if v_papel is null or v_papel not in ('cliente', 'fornecedor') then
    raise exception 'Cadastro inválido.';
  end if;
  -- Fornecedor e alteração de cadastro: quem gerencia a loja. Cliente novo: também o caixa.
  if v_papel = 'fornecedor' or p_id is not null then
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  end if;
  v_gerencia := app.pode(p_empresa_id, 'gestao.gerenciar');

  if v_nome is null or length(v_nome) < 2 or length(v_nome) > 120 then
    raise exception 'Informe o nome (2 a 120 letras).';
  end if;
  if v_doc is not null then
    if length(v_doc) = 11 and not app.cpf_valido(v_doc) then
      raise exception 'CPF inválido. Confira os números.';
    elsif length(v_doc) = 14 and not app.cnpj_valido(v_doc) then
      raise exception 'CNPJ inválido. Confira os números.';
    elsif length(v_doc) not in (11, 14) then
      raise exception 'Informe o CPF (11 números) ou o CNPJ (14 números).';
    end if;
  end if;
  if v_tel is not null and (length(v_tel) < 8 or length(v_tel) > 14) then
    raise exception 'Telefone inválido. Informe o DDD e o número.';
  end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'E-mail inválido.';
  end if;
  if v_cep is not null and length(v_cep) <> 8 then
    raise exception 'CEP inválido (8 números).';
  end if;
  if v_mun is not null and not exists (select 1 from public.municipios where ibge = v_mun) then
    raise exception 'Município não encontrado.';
  end if;
  if v_ie is not null and (length(v_ie) < 2 or length(v_ie) > 14) then
    raise exception 'Inscrição estadual inválida (só números, até 14).';
  end if;
  if length(v_log) > 60 or length(v_num) > 60 or length(v_comp) > 60 or length(v_bairro) > 60 then
    raise exception 'Endereço muito longo: cada campo aceita até 60 letras.';
  end if;
  if length(v_contato) > 80 or length(v_obs) > 1000 then
    raise exception 'Contato (até 80 letras) ou observações (até 1000) muito longos.';
  end if;
  begin
    v_prazo := nullif(p_dados ->> 'prazo_pagamento_dias', '')::smallint;
  exception when others then
    raise exception 'Prazo de pagamento inválido (dias, de 0 a 365).';
  end;
  if v_prazo is not null and (v_prazo < 0 or v_prazo > 365) then
    raise exception 'Prazo de pagamento inválido (dias, de 0 a 365).';
  end if;
  v_ativo := coalesce((p_dados ->> 'ativo')::boolean, true);

  if p_id is not null then
    select * into v_atual from public.contrapartes where id = p_id and empresa_id = p_empresa_id for update;
    if v_atual.id is null then
      raise exception 'Cadastro não encontrado.';
    end if;
  end if;
  -- O mesmo CPF/CNPJ não se repete na empresa
  if v_doc is not null then
    select * into v_outro from public.contrapartes
     where empresa_id = p_empresa_id and documento = v_doc and id is distinct from p_id;
  end if;

  if p_id is not null then
    if v_outro.id is not null then
      raise exception 'Já existe um cadastro com este CPF/CNPJ: %.', v_outro.nome;
    end if;
    update public.contrapartes
       set nome = v_nome, documento = v_doc, tipo_pessoa = case length(v_doc) when 11 then 'PF' when 14 then 'PJ' end,
           telefone = v_tel, email = v_email, observacoes = v_obs, cep = v_cep, logradouro = v_log, numero = v_num,
           complemento = v_comp, bairro = v_bairro, municipio_ibge = v_mun, inscricao_estadual = v_ie, contato = v_contato,
           prazo_pagamento_dias = v_prazo, ativo = v_ativo,
           papeis = case when v_papel = any(papeis) then papeis else array_append(papeis, v_papel) end
     where id = p_id;
    v_id := p_id;
  elsif v_outro.id is not null then
    -- Já cadastrado (ex.: como fornecedor no Financeiro): ganha o papel e os dados que faltavam.
    -- Quem só vende não troca o que já estava preenchido.
    update public.contrapartes c
       set papeis = case when v_papel = any(c.papeis) then c.papeis else array_append(c.papeis, v_papel) end,
           ativo = true,
           nome = case when v_gerencia then v_nome else c.nome end,
           telefone = case when v_gerencia then coalesce(v_tel, c.telefone) else coalesce(c.telefone, v_tel) end,
           email = case when v_gerencia then coalesce(v_email, c.email) else coalesce(c.email, v_email) end,
           observacoes = coalesce(c.observacoes, v_obs),
           cep = case when v_gerencia then coalesce(v_cep, c.cep) else coalesce(c.cep, v_cep) end,
           logradouro = case when v_gerencia then coalesce(v_log, c.logradouro) else coalesce(c.logradouro, v_log) end,
           numero = case when v_gerencia then coalesce(v_num, c.numero) else coalesce(c.numero, v_num) end,
           complemento = case when v_gerencia then coalesce(v_comp, c.complemento) else coalesce(c.complemento, v_comp) end,
           bairro = case when v_gerencia then coalesce(v_bairro, c.bairro) else coalesce(c.bairro, v_bairro) end,
           municipio_ibge = case when v_gerencia then coalesce(v_mun, c.municipio_ibge) else coalesce(c.municipio_ibge, v_mun) end,
           inscricao_estadual = case when v_gerencia then coalesce(v_ie, c.inscricao_estadual) else coalesce(c.inscricao_estadual, v_ie) end,
           contato = coalesce(v_contato, c.contato),
           prazo_pagamento_dias = coalesce(v_prazo, c.prazo_pagamento_dias)
     where c.id = v_outro.id;
    v_id := v_outro.id;
  else
    insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis, telefone, email, observacoes, cep, logradouro, numero,
                                     complemento, bairro, municipio_ibge, inscricao_estadual, contato, prazo_pagamento_dias, ativo)
    values (p_empresa_id, v_nome, v_doc, case length(v_doc) when 11 then 'PF' when 14 then 'PJ' end, array[v_papel], v_tel, v_email, v_obs,
            v_cep, v_log, v_num, v_comp, v_bairro, v_mun, v_ie, v_contato, v_prazo, v_ativo)
    returning id into v_id;
  end if;

  if v_papel = 'cliente' then
    perform app.contraparte_para_destinatario(v_id);
  end if;
  return v_id;
end;
$$;

-- Ativar ou desativar (cadastro com histórico não é apagado)
create or replace function public.gestao_contraparte_ativar(p_empresa_id uuid, p_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  update public.contrapartes set ativo = coalesce(p_ativo, true)
   where id = p_id and empresa_id = p_empresa_id and papeis && array['cliente', 'fornecedor'];
  if not found then
    raise exception 'Cadastro não encontrado.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Fornecedores das notas de compra
-- -----------------------------------------------------------------------------
-- Cadastra (ou marca como fornecedor) quem emitiu a nota de compra
create or replace function app.fornecedor_da_nota(p_empresa_id uuid, p_documento text, p_nome text, p_ie text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc text := nullif(regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'), '');
  v_ie text := nullif(regexp_replace(coalesce(p_ie, ''), '\D', '', 'g'), '');
  v_id uuid;
begin
  if v_doc is null or length(v_doc) not in (11, 14)
     or v_doc = (select regexp_replace(coalesce(e.documento, ''), '\D', '', 'g') from public.empresas e where e.id = p_empresa_id) then
    return null;
  end if;
  if v_ie is not null and (length(v_ie) < 2 or length(v_ie) > 14) then
    v_ie := null;
  end if;
  insert into public.contrapartes (empresa_id, nome, documento, tipo_pessoa, papeis, inscricao_estadual)
  values (p_empresa_id, left(coalesce(nullif(trim(p_nome), ''), 'Fornecedor ' || v_doc), 120), v_doc,
          case length(v_doc) when 11 then 'PF' else 'PJ' end, array['fornecedor'], v_ie)
  on conflict (empresa_id, documento) where documento is not null do nothing
  returning id into v_id;
  if v_id is null then
    update public.contrapartes
       set papeis = case when 'fornecedor' = any(papeis) then papeis else array_append(papeis, 'fornecedor') end,
           inscricao_estadual = coalesce(inscricao_estadual, v_ie)
     where empresa_id = p_empresa_id and documento = v_doc
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Traz para o cadastro os fornecedores das notas de compra já recebidas
create or replace function public.gestao_fornecedores_das_notas(p_empresa_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_antes int;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  select count(*) into v_antes from public.contrapartes where empresa_id = p_empresa_id and 'fornecedor' = any(papeis);
  for r in
    select distinct on (doc) doc, nome, ie from (
      select regexp_replace(coalesce(f.emitente_documento, ''), '\D', '', 'g') as doc, f.emitente_nome as nome, f.emitente_ie as ie, f.data_emissao as quando
        from public.documentos_fiscais f
       where f.empresa_id = p_empresa_id and f.operacao = 'entrada' and f.modelo in ('55', '65')
      union all
      select regexp_replace(p.emitente_documento, '\D', '', 'g'), p.emitente_nome, null, p.data_emissao::timestamptz
        from public.estoque_notas_pdf p
       where p.empresa_id = p_empresa_id
    ) x
    where doc ~ '^([0-9]{11}|[0-9]{14})$'
    order by doc, quando desc nulls last
  loop
    perform app.fornecedor_da_nota(p_empresa_id, r.doc, r.nome, r.ie);
  end loop;
  return (select count(*) from public.contrapartes where empresa_id = p_empresa_id and 'fornecedor' = any(papeis)) - v_antes;
end;
$$;

-- Ao dar entrada numa nota de compra, o fornecedor entra no cadastro
create or replace function app.tg_nota_entrada_fornecedor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if tg_table_name = 'documentos_fiscais' then
      if new.operacao = 'entrada' and new.modelo in ('55', '65') and app.gestao_ativa(new.empresa_id) then
        perform app.fornecedor_da_nota(new.empresa_id, new.emitente_documento, new.emitente_nome, new.emitente_ie);
      end if;
    else
      perform app.fornecedor_da_nota(new.empresa_id, new.emitente_documento, new.emitente_nome, null);
    end if;
  exception when others then
    raise warning 'Cadastro: não foi possível registrar o fornecedor da nota %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
create trigger documentos_fiscais_fornecedor after insert on public.documentos_fiscais
  for each row execute function app.tg_nota_entrada_fornecedor();
create trigger estoque_notas_pdf_fornecedor after insert on public.estoque_notas_pdf
  for each row execute function app.tg_nota_entrada_fornecedor();

-- -----------------------------------------------------------------------------
-- 5. Ficha do cliente ou do fornecedor
-- -----------------------------------------------------------------------------
create or replace function public.gestao_contraparte_ficha(p_empresa_id uuid, p_id uuid, p_papel text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.contrapartes;
  v_valores boolean;
  v_resumo jsonb;
  v_lista jsonb;
  v_produtos jsonb := '[]'::jsonb;
  v_contas jsonb;
  v_mun text;
begin
  if p_papel not in ('cliente', 'fornecedor') then
    raise exception 'Cadastro inválido.';
  end if;
  perform app.exigir_gestao(p_empresa_id, case p_papel when 'fornecedor' then 'gestao.gerenciar' else 'gestao.vender' end);
  select * into c from public.contrapartes where id = p_id and empresa_id = p_empresa_id and p_papel = any(papeis);
  if c.id is null then
    raise exception 'Cadastro não encontrado.';
  end if;
  select m.nome || ' / ' || m.uf into v_mun from public.municipios m where m.ibge = c.municipio_ibge;

  if p_papel = 'cliente' then
    select jsonb_build_object(
             'compras', count(*) filter (where v.tipo = 'venda' and v.status = 'concluida'),
             'total_comprado', coalesce(sum(v.total) filter (where v.tipo = 'venda' and v.status = 'concluida'), 0),
             'ultima_compra', max(v.data) filter (where v.tipo = 'venda' and v.status = 'concluida'),
             'orcamentos_abertos', count(*) filter (where v.tipo = 'orcamento' and v.status = 'aberto'))
      into v_resumo
      from public.vendas v
     where v.empresa_id = p_empresa_id and (v.cliente_id = c.id or (c.documento is not null and v.cliente_documento = c.documento));
    select coalesce(jsonb_agg(x order by x.data desc, x.numero desc), '[]'::jsonb) into v_lista from (
      select v.id, v.tipo, v.numero, v.status, v.data, v.total
        from public.vendas v
       where v.empresa_id = p_empresa_id and (v.cliente_id = c.id or (c.documento is not null and v.cliente_documento = c.documento))
       order by v.data desc, v.numero desc limit 30
    ) x;
    v_valores := true;
    select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(l.valor_previsto - coalesce(l.valor_baixado, 0)), 0),
                              'vencidas', count(*) filter (where l.data_vencimento < app.hoje()))
      into v_contas
      from public.lancamentos l
     where l.empresa_id = p_empresa_id and l.contraparte_id = c.id and l.tipo = 'receber' and l.situacao = 'aberto'
       and l.status_revisao = 'confirmado';
  else
    v_valores := app.pode(p_empresa_id, 'gestao.custos') or app.pode(p_empresa_id, 'financeiro.ver');
    select jsonb_build_object('notas', count(*), 'total_compras', case when v_valores then coalesce(sum(n.valor_total), 0) end,
                              'ultima_nota', max(n.data_emissao))
      into v_resumo
      from (
        select f.id, f.numero, f.serie, f.data_emissao::date as data_emissao, f.valor_total, f.chave_acesso
          from public.documentos_fiscais f
         where f.empresa_id = p_empresa_id and f.operacao = 'entrada' and f.modelo in ('55', '65') and c.documento is not null
           and regexp_replace(coalesce(f.emitente_documento, ''), '\D', '', 'g') = c.documento
        union all
        select p.id, p.numero, p.serie, p.data_emissao, p.valor_total, p.chave
          from public.estoque_notas_pdf p
         where p.empresa_id = p_empresa_id and c.documento is not null
           and regexp_replace(p.emitente_documento, '\D', '', 'g') = c.documento
           and not exists (select 1 from public.documentos_fiscais f2 where f2.empresa_id = p_empresa_id and f2.chave_acesso = p.chave)
      ) n;
    select coalesce(jsonb_agg(x order by x.data_emissao desc nulls last), '[]'::jsonb) into v_lista from (
      select n.numero, n.serie, n.data_emissao, case when v_valores then n.valor_total end as valor_total
        from (
          select f.numero, f.serie, f.data_emissao::date as data_emissao, f.valor_total, f.chave_acesso as chave
            from public.documentos_fiscais f
           where f.empresa_id = p_empresa_id and f.operacao = 'entrada' and f.modelo in ('55', '65') and c.documento is not null
             and regexp_replace(coalesce(f.emitente_documento, ''), '\D', '', 'g') = c.documento
          union all
          select p.numero, p.serie, p.data_emissao, p.valor_total, p.chave
            from public.estoque_notas_pdf p
           where p.empresa_id = p_empresa_id and c.documento is not null
             and regexp_replace(p.emitente_documento, '\D', '', 'g') = c.documento
             and not exists (select 1 from public.documentos_fiscais f2 where f2.empresa_id = p_empresa_id and f2.chave_acesso = p.chave)
        ) n
       order by n.data_emissao desc nulls last limit 30
    ) x;
    -- Produtos que vêm deste fornecedor (sem custo)
    select coalesce(jsonb_agg(x order by x.descricao), '[]'::jsonb) into v_produtos from (
      select distinct p.id, p.descricao, p.codigo
        from public.estoque_vinculos ev
        join public.nfe_produtos p on p.id = ev.produto_id
       where ev.empresa_id = p_empresa_id and c.documento is not null
         and regexp_replace(ev.fornecedor_documento, '\D', '', 'g') = c.documento
       limit 100
    ) x;
    select case when v_valores then
             jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(l.valor_previsto - coalesce(l.valor_baixado, 0)), 0),
                                'vencidas', count(*) filter (where l.data_vencimento < app.hoje()))
           else jsonb_build_object('quantidade', count(*), 'vencidas', count(*) filter (where l.data_vencimento < app.hoje())) end
      into v_contas
      from public.lancamentos l
     where l.empresa_id = p_empresa_id and l.contraparte_id = c.id and l.tipo = 'pagar' and l.situacao = 'aberto'
       and l.status_revisao = 'confirmado';
  end if;

  return jsonb_build_object(
    'cadastro', jsonb_build_object(
      'id', c.id, 'nome', c.nome, 'documento', c.documento, 'papeis', c.papeis, 'telefone', c.telefone, 'email', c.email,
      'observacoes', c.observacoes, 'cep', c.cep, 'logradouro', c.logradouro, 'numero', c.numero, 'complemento', c.complemento,
      'bairro', c.bairro, 'municipio_ibge', c.municipio_ibge, 'municipio', v_mun, 'inscricao_estadual', c.inscricao_estadual,
      'contato', c.contato, 'prazo_pagamento_dias', c.prazo_pagamento_dias, 'ativo', c.ativo, 'criado_em', c.created_at),
    'resumo', v_resumo,
    'lista', v_lista,
    'produtos', v_produtos,
    'contas', v_contas,
    'mostra_valores', v_valores);
end;
$$;

revoke all on function app.contraparte_para_destinatario(uuid), app.fornecedor_da_nota(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.gestao_contraparte_salvar(uuid, uuid, jsonb), public.gestao_contraparte_ativar(uuid, uuid, boolean),
  public.gestao_fornecedores_das_notas(uuid), public.gestao_contraparte_ficha(uuid, uuid, text) from public, anon;
grant execute on function public.gestao_contraparte_salvar(uuid, uuid, jsonb), public.gestao_contraparte_ativar(uuid, uuid, boolean),
  public.gestao_fornecedores_das_notas(uuid), public.gestao_contraparte_ficha(uuid, uuid, text) to authenticated;
