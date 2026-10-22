-- =============================================================================
-- Gestão da loja: NF-e na hora da venda
--
-- A loja guarda a operação fiscal (regras da NF-e, cadastradas pelo escritório)
-- e a inscrição que emite a nota das vendas, e se a caixinha "Emitir NF-e" já
-- vem marcada no caixa. Ao concluir a venda com a caixinha marcada, o portal
-- monta a NF-e com os itens, o frete, o desconto e o pagamento da venda e a
-- envia à SEFAZ pela emissão de NF-e da empresa (que continua exigindo o
-- certificado digital e a emissão ligada pelo escritório).
-- =============================================================================

alter table public.gestao_config
  add column nfe_operacao_id uuid references public.nfe_operacoes(id) on delete set null,
  add column nfe_emitente_id uuid references public.nfe_emitentes(id) on delete set null,
  add column nfe_marcada_padrao boolean not null default false;

create or replace function public.gestao_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_equipe boolean := app.e_equipe_da_empresa(p_empresa_id);
  v_atual public.gestao_config;
  v_ativa boolean;
  v_perfil text;
  v_desc numeric := nullif(p_dados ->> 'desconto_maximo_operador', '')::numeric;
  v_dinheiro uuid := nullif(p_dados ->> 'conta_dinheiro_id', '')::uuid;
  v_pix uuid := nullif(p_dados ->> 'conta_pix_id', '')::uuid;
  v_cartao uuid := nullif(p_dados ->> 'conta_cartao_id', '')::uuid;
  v_nfe_op uuid;
  v_nfe_emit uuid;
begin
  select * into v_atual from public.gestao_config where empresa_id = p_empresa_id;
  if v_equipe then
    v_ativa := coalesce((p_dados ->> 'ativa')::boolean, v_atual.ativa, false);
    v_perfil := coalesce(nullif(p_dados ->> 'perfil_fiscal', ''), v_atual.perfil_fiscal, 'comercio');
  else
    perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
    v_ativa := v_atual.ativa;
    v_perfil := v_atual.perfil_fiscal;
  end if;

  if v_ativa then
    perform app.criar_plano_contas_padrao(p_empresa_id);
    v_dinheiro := coalesce(v_dinheiro, v_atual.conta_dinheiro_id, app.gestao_conta(p_empresa_id, 'caixa', 'Caixa da loja'));
    v_pix := coalesce(v_pix, v_atual.conta_pix_id, app.gestao_conta(p_empresa_id, 'conta_corrente', 'Banco (PIX e transferências)'));
    v_cartao := coalesce(v_cartao, v_atual.conta_cartao_id, app.gestao_conta(p_empresa_id, 'adquirente', 'Maquininha de cartão'));
  end if;
  -- NF-e na hora da venda: operação fiscal e inscrição que emite (da própria empresa)
  v_nfe_op := case when p_dados ? 'nfe_operacao_id' then nullif(p_dados ->> 'nfe_operacao_id', '')::uuid else v_atual.nfe_operacao_id end;
  v_nfe_emit := case when p_dados ? 'nfe_emitente_id' then nullif(p_dados ->> 'nfe_emitente_id', '')::uuid else v_atual.nfe_emitente_id end;
  if v_nfe_op is not null and not exists (select 1 from public.nfe_operacoes where id = v_nfe_op and empresa_id = p_empresa_id and ativa) then
    raise exception 'A operação da NF-e escolhida não é desta empresa ou está desativada.';
  end if;
  if v_nfe_emit is not null and not exists (select 1 from public.nfe_emitentes where id = v_nfe_emit and empresa_id = p_empresa_id and ativo) then
    raise exception 'A inscrição que emite a NF-e não é desta empresa ou está desativada.';
  end if;
  if (v_dinheiro is not null and v_dinheiro in (v_pix, v_cartao)) then
    raise exception 'A conta do dinheiro precisa ser diferente da conta do PIX e da maquininha.';
  end if;

  insert into public.gestao_config as g (
    empresa_id, ativa, perfil_fiscal, permitir_estoque_negativo, permitir_venda_prazo, desconto_maximo_operador,
    conta_dinheiro_id, conta_pix_id, conta_cartao_id, validade_orcamento_dias, mensagem_comprovante, ativada_por, ativada_em,
    nfe_operacao_id, nfe_emitente_id, nfe_marcada_padrao
  ) values (
    p_empresa_id, v_ativa, v_perfil,
    coalesce((p_dados ->> 'permitir_estoque_negativo')::boolean, v_atual.permitir_estoque_negativo, false),
    coalesce((p_dados ->> 'permitir_venda_prazo')::boolean, v_atual.permitir_venda_prazo, true),
    case when p_dados ? 'desconto_maximo_operador' then v_desc else v_atual.desconto_maximo_operador end,
    v_dinheiro, v_pix, v_cartao,
    coalesce((p_dados ->> 'validade_orcamento_dias')::int, v_atual.validade_orcamento_dias, 15),
    case when p_dados ? 'mensagem_comprovante' then nullif(trim(p_dados ->> 'mensagem_comprovante'), '') else v_atual.mensagem_comprovante end,
    case when v_ativa then auth.uid() end, case when v_ativa then now() end,
    v_nfe_op, v_nfe_emit, coalesce((p_dados ->> 'nfe_marcada_padrao')::boolean, v_atual.nfe_marcada_padrao, false)
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    perfil_fiscal = excluded.perfil_fiscal,
    permitir_estoque_negativo = excluded.permitir_estoque_negativo,
    permitir_venda_prazo = excluded.permitir_venda_prazo,
    desconto_maximo_operador = excluded.desconto_maximo_operador,
    conta_dinheiro_id = excluded.conta_dinheiro_id,
    conta_pix_id = excluded.conta_pix_id,
    conta_cartao_id = excluded.conta_cartao_id,
    validade_orcamento_dias = excluded.validade_orcamento_dias,
    mensagem_comprovante = excluded.mensagem_comprovante,
    ativada_por = case when excluded.ativa and not g.ativa then auth.uid() else g.ativada_por end,
    ativada_em = case when excluded.ativa and not g.ativa then now() else g.ativada_em end,
    nfe_operacao_id = excluded.nfe_operacao_id,
    nfe_emitente_id = excluded.nfe_emitente_id,
    nfe_marcada_padrao = excluded.nfe_marcada_padrao,
    atualizado_por = auth.uid();
end;
$$;
