-- Custo médio pelo custo de compra do cadastro.
--
-- O custo médio só era calculado nas entradas com custo (nota ou entrada
-- manual com custo). Produto que recebeu estoque por correção/inventário (sem
-- custo) ficava com custo médio zero, mesmo com o "custo de compra" preenchido
-- no cadastro — e a venda gravava custo zero (lucro errado). Agora:
--  * custo médio zerado e custo de compra preenchido: o custo médio passa a ser
--    o custo de compra;
--  * enquanto o produto não teve nenhuma entrada com custo, mudar o custo de
--    compra no cadastro também muda o custo médio (é a única informação).
-- Depois da primeira entrada com custo, o custo médio segue a média das
-- entradas, como antes.

create or replace function app.tg_produto_custo_medio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.preco_custo, 0) > 0 then
    if coalesce(new.custo_medio, 0) <= 0 then
      new.custo_medio := new.preco_custo;
    elsif tg_op = 'UPDATE' and new.preco_custo is distinct from old.preco_custo
          and new.custo_medio is not distinct from old.custo_medio
          and not exists (
            select 1 from public.estoque_movimentos m
             where m.produto_id = new.id and m.quantidade > 0 and coalesce(m.custo_unitario, 0) > 0
          ) then
      new.custo_medio := new.preco_custo;
    end if;
  end if;
  return new;
end;
$$;
create trigger produto_custo_medio before insert or update on public.nfe_produtos
  for each row execute function app.tg_produto_custo_medio();

-- Produtos que já estão com o custo médio zerado e o custo de compra preenchido
update public.nfe_produtos
   set custo_medio = preco_custo
 where coalesce(custo_medio, 0) <= 0 and coalesce(preco_custo, 0) > 0;
