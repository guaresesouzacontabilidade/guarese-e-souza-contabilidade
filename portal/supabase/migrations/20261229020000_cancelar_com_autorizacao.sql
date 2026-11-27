-- Cancelar venda ou orçamento só com a senha de quem pode autorizar.
--
-- * Permissão nova "gestao.cancelar" (Cancelar vendas e orçamentos): vem ligada
--   para o dono (cliente titular); ele pode dar a um gerente.
-- * Quem está no caixa pede o cancelamento; quem autoriza escolhe o próprio
--   nome e digita a senha do login do portal. O servidor confere a senha pelo
--   provedor de login (nada de senha em tabela nossa) e grava uma autorização
--   de uso único, válida por 2 minutos, para aquela venda e aquele pedido.
-- * gestao_venda_cancelar só cancela com uma autorização válida (o banco
--   recusa mesmo vindo direto, sem passar pela tela) e guarda quem autorizou.

create function pg_temp.trocar_no_corpo(p_funcao regprocedure, p_de text, p_para text)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_funcao);
begin
  if position(p_de in v_def) = 0 then
    raise exception 'Trecho não encontrado em %: %', p_funcao, p_de;
  end if;
  execute replace(v_def, p_de, p_para);
end;
$$;

-- 1. Permissão ---------------------------------------------------------------
select pg_temp.trocar_no_corpo('app.permissoes_validas()',
$a$    'gestao.custos',$a$,
$a$    'gestao.custos',
    'gestao.cancelar',$a$);
-- Só o dono vem com a permissão (o escritório e os colaboradores, não)
select pg_temp.trocar_no_corpo('app.permissoes_padrao(text)',
$a$      'nfe.emitir',
      'gestao.vender', 'gestao.gerenciar', 'gestao.custos',$a$,
$a$      'nfe.emitir',
      'gestao.vender', 'gestao.gerenciar', 'gestao.custos', 'gestao.cancelar',$a$);
-- Autorizar cancelamento implica poder vender
select pg_temp.trocar_no_corpo('app.tg_validar_membro()',
$a$  if 'gestao.gerenciar' = any(new.permissoes) and not ('gestao.vender' = any(new.permissoes)) then$a$,
$a$  if 'gestao.cancelar' = any(new.permissoes) and not ('gestao.vender' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'gestao.vender');
  end if;
  if 'gestao.gerenciar' = any(new.permissoes) and not ('gestao.vender' = any(new.permissoes)) then$a$);

update public.empresa_membros
   set permissoes = array(select distinct unnest(permissoes || array['gestao.cancelar']))
 where papel = 'cliente_titular' and 'gestao.gerenciar' = any(permissoes) and not ('gestao.cancelar' = any(permissoes));
update public.convites
   set permissoes = array(select distinct unnest(permissoes || array['gestao.cancelar']))
 where status = 'pendente' and papel = 'cliente_titular' and 'gestao.gerenciar' = any(permissoes) and not ('gestao.cancelar' = any(permissoes));

-- 2. Autorizações de uso único ------------------------------------------------
create table public.venda_cancelamento_autorizacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  venda_id uuid not null,
  autorizado_por uuid not null references public.perfis (id) on delete cascade,
  solicitado_por uuid not null references public.perfis (id) on delete cascade,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '2 minutes',
  usada_em timestamptz,
  foreign key (empresa_id, venda_id) references public.vendas (empresa_id, id) on delete cascade
);
create index venda_cancelamento_autorizacoes_venda_idx on public.venda_cancelamento_autorizacoes (venda_id, criada_em desc);
-- Ninguém do navegador lê nem grava: só o servidor do portal, depois de conferir a senha
alter table public.venda_cancelamento_autorizacoes enable row level security;
revoke all on public.venda_cancelamento_autorizacoes from public, anon, authenticated;

alter table public.vendas add column cancelamento_autorizado_por uuid references public.perfis (id) on delete set null;

-- Quem pode autorizar (nome para escolher na tela), sem e-mail nem outros dados
create function public.loja_autorizadores_cancelamento(p_empresa_id uuid)
returns table (id uuid, nome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.exigir_gestao(p_empresa_id, 'gestao.vender');
  return query
    select p.id, coalesce(nullif(trim(p.nome), ''), 'Sem nome')
      from public.empresa_membros m
      join public.perfis p on p.id = m.user_id
     where m.empresa_id = p_empresa_id and m.ativo and 'gestao.cancelar' = any(m.permissoes)
       and m.papel like 'cliente%'
     order by lower(p.nome);
end;
$$;
revoke all on function public.loja_autorizadores_cancelamento(uuid) from public, anon;
grant execute on function public.loja_autorizadores_cancelamento(uuid) to authenticated;

-- 3. Cancelar exige a autorização ---------------------------------------------
create or replace function public.gestao_venda_cancelar(p_venda_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vendas;
  v_sessao text;
  v_lancs uuid[];
  it public.venda_itens;
  v_aut public.venda_cancelamento_autorizacoes;
begin
  select * into v from public.vendas where id = p_venda_id for update;
  if v.id is null then
    raise exception 'Venda não encontrada.';
  end if;
  perform app.exigir_gestao(v.empresa_id, 'gestao.vender');
  if v.tipo = 'orcamento' and v.status <> 'aberto' then
    raise exception 'Só orçamentos em aberto podem ser cancelados.';
  end if;
  if v.tipo = 'venda' and v.status <> 'concluida' then
    raise exception 'Esta venda já está cancelada.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Explique o motivo do cancelamento.';
  end if;

  -- Autorização de quem pode cancelar (conferida pela senha, de uso único)
  select * into v_aut from public.venda_cancelamento_autorizacoes a
   where a.venda_id = v.id and a.solicitado_por = auth.uid() and a.usada_em is null and a.expira_em > now()
   order by a.criada_em desc
   limit 1
   for update;
  if v_aut.id is null then
    raise exception 'O cancelamento precisa da senha de quem pode autorizar (permissão Cancelar vendas e orçamentos).'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.empresa_membros m
     where m.empresa_id = v.empresa_id and m.user_id = v_aut.autorizado_por and m.ativo and 'gestao.cancelar' = any(m.permissoes)
  ) then
    raise exception 'Quem autorizou não tem mais a permissão para cancelar.' using errcode = '42501';
  end if;
  update public.venda_cancelamento_autorizacoes set usada_em = now() where id = v_aut.id;

  if v.tipo = 'orcamento' then
    update public.vendas set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(),
      cancelamento_autorizado_por = v_aut.autorizado_por, motivo_cancelamento = left(trim(p_motivo), 500)
     where id = v.id;
    return;
  end if;

  select status into v_sessao from public.caixa_sessoes where id = v.sessao_id;
  if v_sessao <> 'aberto' then
    raise exception 'O caixa desta venda já foi fechado. Faça a devolução pelo Financeiro e um ajuste de estoque.';
  end if;
  if v.nfe_emissao_id is not null and exists (
    select 1 from public.nfe_emissoes where id = v.nfe_emissao_id and situacao in ('na_fila', 'enviando', 'aguardando', 'autorizada', 'cancelando', 'falha')
  ) then
    raise exception 'Esta venda tem NF-e. Cancele a nota antes de cancelar a venda.';
  end if;
  select coalesce(array_agg(l), '{}') into v_lancs from public.venda_pagamentos p, unnest(p.lancamentos) l where p.venda_id = v.id;
  if exists (select 1 from public.baixas b where b.lancamento_id = any(v_lancs) and b.origem <> 'venda') then
    raise exception 'Uma parcela desta venda já foi recebida. Estorne o recebimento no Financeiro antes de cancelar.';
  end if;
  delete from public.baixas where lancamento_id = any(v_lancs) and origem = 'venda';
  update public.lancamentos
     set situacao = 'cancelado', motivo_cancelamento = left('Venda nº ' || v.numero || ' cancelada: ' || trim(p_motivo), 500)
   where id = any(v_lancs) and situacao <> 'cancelado';
  for it in select * from public.venda_itens where venda_id = v.id order by ordem loop
    perform app.estoque_movimentar(v.empresa_id, it.produto_id, 'cancelamento_venda', it.quantidade, null, v.id, null,
      'Cancelamento da venda nº ' || v.numero, true);
  end loop;
  update public.vendas
     set status = 'cancelada', cancelada_em = now(), cancelada_por = auth.uid(),
         cancelamento_autorizado_por = v_aut.autorizado_por, motivo_cancelamento = left(trim(p_motivo), 500)
   where id = v.id;
end;
$$;
