-- Certificado digital do produtor rural pessoa física (e-CPF)
-- O produtor rural emite NF-e com o CPF e a inscrição estadual de cada
-- propriedade, assinando com o e-CPF. O cadastro do certificado passa a
-- aceitar o CPF (11 números) quando a empresa do portal é pessoa física; a
-- conferência continua no servidor e no banco: e-CNPJ com a mesma raiz do CNPJ
-- da empresa, ou e-CPF com o mesmo CPF do produtor.

alter table public.certificados_digitais drop constraint certificados_digitais_documento_check;
alter table public.certificados_digitais add constraint certificados_digitais_documento_check
  check (documento is null or documento ~ '^([0-9A-Z]{12}[0-9]{2}|[0-9]{11})$');

create or replace function public.registrar_certificado(
  p_empresa_id uuid,
  p_titular text,
  p_documento text,
  p_emissor text,
  p_numero_serie text,
  p_impressao_digital text,
  p_valido_de timestamptz,
  p_valido_ate timestamptz,
  p_autorizacao_texto text,
  p_conteudo_cifrado text,
  p_buscar_desde date default null,
  p_sem_limite boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp public.empresas;
  v_equipe boolean;
  v_anterior public.certificados_digitais;
  v_id uuid;
  v_venc uuid;
  v_doc_emp text;
  v_existia boolean;
  v_escolheu boolean := p_buscar_desde is not null or coalesce(p_sem_limite, false);
  v_desde date := case when coalesce(p_sem_limite, false) then null
                       else coalesce(p_buscar_desde, (date_trunc('month', (now() at time zone 'America/Araguaina')::date) - interval '1 month')::date) end;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  v_equipe := p_empresa_id = any(app.empresas_equipe());
  if p_valido_ate <= now() then
    raise exception 'Este certificado está vencido.';
  end if;
  -- Empresa: e-CNPJ com a mesma raiz (8 caracteres); produtor rural pessoa física: e-CPF do mesmo CPF
  v_doc_emp := upper(regexp_replace(coalesce(v_emp.documento, ''), '[^0-9A-Za-z]', '', 'g'));
  if p_documento is null
     or not ((length(v_doc_emp) = 14 and length(p_documento) = 14 and left(p_documento, 8) = left(v_doc_emp, 8))
             or (length(v_doc_emp) = 11 and p_documento = v_doc_emp)) then
    raise exception 'O certificado não é desta empresa (CNPJ ou CPF diferente).';
  end if;
  perform app.validar_mes_inicial(p_buscar_desde);

  -- Substitui o certificado anterior (o conteúdo cifrado dele é apagado)
  select * into v_anterior from public.certificados_digitais where empresa_id = p_empresa_id and revogado_em is null;
  if found then
    update public.certificados_digitais
       set revogado_em = now(), revogado_por = auth.uid(), motivo_revogacao = 'Substituído por um novo certificado.'
     where id = v_anterior.id;
    delete from public.certificados_segredos where certificado_id = v_anterior.id;
    if v_anterior.vencimento_id is not null then
      update public.vencimentos set situacao = 'arquivado' where id = v_anterior.vencimento_id;
    end if;
  end if;

  -- Validade do certificado também entra em Vencimentos (avisos de renovação)
  insert into public.vencimentos (empresa_id, tipo, descricao, numero, orgao, emissao, validade, responsavel, observacao)
  values (p_empresa_id, 'certificado_digital', 'Certificado digital A1 (notas automáticas)', left(p_numero_serie, 80), left(p_emissor, 120),
          (p_valido_de at time zone 'America/Araguaina')::date, (p_valido_ate at time zone 'America/Araguaina')::date, 'cliente',
          'Cadastrado no portal para a busca automática de notas. Ao renovar, cadastre o novo certificado em Notas automáticas.')
  returning id into v_venc;

  insert into public.certificados_digitais (empresa_id, titular, documento, emissor, numero_serie, impressao_digital, valido_de, valido_ate,
                                            autorizacao, autorizacao_texto, vencimento_id)
  values (p_empresa_id, left(p_titular, 300), p_documento, left(p_emissor, 300), p_numero_serie, upper(p_impressao_digital), p_valido_de, p_valido_ate,
          case when v_equipe then 'autorizacao_escrita' else 'cliente_no_portal' end, p_autorizacao_texto, v_venc)
  returning id into v_id;
  insert into public.certificados_segredos (certificado_id, conteudo_cifrado) values (v_id, p_conteudo_cifrado);

  v_existia := exists (select 1 from public.notas_automaticas where empresa_id = p_empresa_id);
  if v_existia and v_escolheu and v_anterior.id is null then
    perform app.aplicar_mes_inicial(p_empresa_id, v_desde);
  end if;
  insert into public.notas_automaticas (empresa_id, certificado_valido_ate, nfe_proxima, nfse_proxima, atualizado_por, buscar_desde)
  values (p_empresa_id, p_valido_ate, now(), now(), auth.uid(), v_desde)
  on conflict (empresa_id) do update
     set certificado_valido_ate = p_valido_ate,
         nfe_proxima = least(coalesce(public.notas_automaticas.nfe_proxima, now()), now() + interval '1 hour'),
         nfse_proxima = now(), ultimo_erro = null, erros_seguidos = 0, atualizado_por = auth.uid();
  perform app.agendar_notas_automaticas(p_empresa_id, now());

  perform app.registrar_auditoria('certificado_cadastrado', 'certificados_digitais', v_id::text, p_empresa_id,
    jsonb_build_object('titular', left(p_titular, 300), 'valido_ate', p_valido_ate, 'impressao_digital', upper(p_impressao_digital),
                       'autorizacao', case when v_equipe then 'autorizacao_escrita' else 'cliente_no_portal' end,
                       'buscar_desde', (select buscar_desde from public.notas_automaticas where empresa_id = p_empresa_id)));
  if v_equipe then
    perform app.notificar_clientes(p_empresa_id, 'certificado.gerenciar', 'certificado',
      'Certificado digital cadastrado pelo escritório',
      'O escritório cadastrou o certificado digital da empresa para buscar as notas fiscais automaticamente. Você pode revogar a qualquer momento.',
      '/e/' || p_empresa_id::text || '/notas-automaticas', true);
  else
    perform app.notificar_equipe(p_empresa_id, 'certificado', 'Certificado digital cadastrado pelo cliente',
      'A busca automática de notas foi ativada para a empresa.', '/e/' || p_empresa_id::text || '/notas-automaticas', false);
  end if;
  return v_id;
end;
$$;
