-- =============================================================================
-- Orçamento avulso da loja (ex.: balcão da madeireira, no tablet)
--
--  * O orçamento já aceitava cliente sem cadastro (só o nome). Agora o CPF/CNPJ
--    e o telefone de quem não tem cadastro são conferidos com mensagem clara
--    (antes um número errado dava erro técnico).
--  * Cada orçamento ganha um código aleatório para o link que a loja manda ao
--    cliente pelo WhatsApp (/orcamento/<código>, sem login). O link mostra só o
--    que está no papel do orçamento — loja, itens, valores, validade e o
--    primeiro nome do cliente —, sem CPF, telefone nem endereço de entrega.
--    Orçamento cancelado ou com mais de um ano deixa de abrir pelo link.
--  * Fazer orçamento não exige caixa aberto (gestao_orcamento_salvar já não
--    usa o caixa); a tela "Novo orçamento" usa isso.
-- =============================================================================

alter table public.vendas
  add column codigo_publico text unique check (codigo_publico is null or codigo_publico ~ '^[a-z0-9]{16}$');

create or replace function app.codigo_publico_orcamento()
returns text
language sql
volatile
set search_path = ''
as $$
  select substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789abcdefghijklmnopqrstuvwxyz0123'), 1, 16);
$$;

-- Código do link no orçamento novo e conferência dos dados do cliente sem cadastro
create or replace function app.tg_vendas_orcamento_avulso()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'orcamento' then
      new.codigo_publico := coalesce(new.codigo_publico, app.codigo_publico_orcamento());
    else
      new.codigo_publico := null;
    end if;
  end if;
  if new.cliente_id is null then
    if new.cliente_documento is not null and not (app.cpf_valido(new.cliente_documento) or app.cnpj_valido(new.cliente_documento)) then
      raise exception 'CPF ou CNPJ do cliente inválido. Confira os números ou deixe em branco.';
    end if;
    if new.cliente_telefone is not null and new.cliente_telefone !~ '^[0-9]{10,13}$' then
      raise exception 'Telefone do cliente inválido. Informe o DDD e o número (ex.: 63 99999-1234) ou deixe em branco.';
    end if;
  end if;
  return new;
end;
$$;
create trigger vendas_orcamento_avulso before insert or update of cliente_id, cliente_documento, cliente_telefone on public.vendas
  for each row execute function app.tg_vendas_orcamento_avulso();

-- Orçamentos que já existem também ganham o link
update public.vendas set codigo_publico = app.codigo_publico_orcamento() where tipo = 'orcamento' and codigo_publico is null;

-- O cliente abre o orçamento pelo link (sem login): só o que está no papel, sem CPF, telefone nem endereço
create or replace function public.gestao_orcamento_publico(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'numero', v.numero,
    'data', v.data,
    'validade', v.validade,
    'situacao', case when v.status = 'convertido' then 'convertido'
                     when v.validade is not null and v.validade < app.hoje() then 'vencido'
                     else 'aberto' end,
    'cliente', nullif(split_part(trim(coalesce(v.cliente_nome, '')), ' ', 1), ''),
    'loja', coalesce(e.nome_fantasia, e.razao_social),
    'razao_social', e.razao_social,
    'cnpj', e.documento,
    'endereco', nullif(concat_ws(' · ', nullif(concat_ws(', ', e.logradouro, e.numero), ''), e.bairro, nullif(concat_ws('/', e.cidade, e.uf), '')), ''),
    'telefone', e.telefone,
    'demonstracao', e.demonstracao,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'descricao', i.descricao, 'unidade', i.unidade, 'pecas', i.pecas, 'comprimento_m', i.comprimento_m,
               'quantidade', i.quantidade, 'preco_unitario', i.preco_unitario, 'desconto', i.desconto, 'total', i.total
             ) order by i.ordem)
        from public.venda_itens i where i.venda_id = v.id), '[]'::jsonb),
    'subtotal', v.subtotal,
    'desconto', v.desconto,
    'frete', v.frete,
    'total', v.total,
    'observacao', v.observacao,
    'mensagem', g.mensagem_comprovante
  )
    from public.vendas v
    join public.empresas e on e.id = v.empresa_id
    join public.gestao_config g on g.empresa_id = v.empresa_id and g.ativa
   where p_codigo ~ '^[a-z0-9]{16}$'
     and v.codigo_publico = p_codigo
     and v.tipo = 'orcamento'
     and v.status in ('aberto', 'convertido')
     and v.data > app.hoje() - 365;
$$;

revoke execute on function app.codigo_publico_orcamento(), app.tg_vendas_orcamento_avulso() from public, anon, authenticated;
revoke execute on function public.gestao_orcamento_publico(text) from public;
grant execute on function public.gestao_orcamento_publico(text) to anon, authenticated;
