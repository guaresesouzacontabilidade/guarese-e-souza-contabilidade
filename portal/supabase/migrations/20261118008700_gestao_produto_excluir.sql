-- Loja: excluir produto. O responsável pela loja (gestao.gerenciar) apaga o
-- produto que não tem histórico: nunca vendido, comprado por nota, usado em
-- NF-e emitida, no hotel, na clínica ou em ordem de carregamento. Os lançamentos
-- de estoque feitos à mão (entrada, saída, inventário e a importação da
-- planilha) saem junto. Produto com histórico não pode sumir, porque as
-- vendas, as notas e a EFD dependem dele: é desativado (some das listas, do
-- caixa e das notas e pode ser reativado em "Inativos").

create or replace function public.gestao_produto_excluir(p_empresa_id uuid, p_produto_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_produtos;
  v_historico boolean;
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.gerenciar');
  select * into v from public.nfe_produtos where id = p_produto_id and empresa_id = p_empresa_id for update;
  if v.id is null then
    raise exception 'Produto não encontrado.';
  end if;
  v_historico :=
       exists (select 1 from public.venda_itens where produto_id = v.id)
    or exists (select 1 from public.ordens_carregamento where produto_id = v.id)
    or exists (select 1 from public.hotel_conta_itens where produto_id = v.id)
    or exists (select 1 from public.vet_usos where produto_id = v.id)
    or exists (select 1 from public.estoque_movimentos where produto_id = v.id
                and (tipo not in ('entrada_manual', 'saida_manual', 'inventario') or documento_fiscal_id is not null or venda_id is not null))
    or exists (select 1 from public.nfe_emissoes where empresa_id = p_empresa_id
                and dados -> 'itens' @> jsonb_build_array(jsonb_build_object('codigo', v.codigo)));
  if v_historico then
    update public.nfe_produtos set ativo = false where id = v.id;
    return 'desativado';
  end if;
  delete from public.estoque_movimentos where produto_id = v.id;
  delete from public.nfe_produtos where id = v.id;
  return 'excluido';
end;
$$;

revoke execute on function public.gestao_produto_excluir(uuid, uuid) from public, anon;
grant execute on function public.gestao_produto_excluir(uuid, uuid) to authenticated;
