-- Plano de contas editável pelo gestor da empresa (quem pode editar o
-- financeiro): grupos próprios, regras de estrutura (grupo → conta, dois
-- níveis) e exclusão de conta movendo os lançamentos e as recorrências para
-- outra conta da mesma natureza. Meses já fechados pelo escritório não mudam:
-- a conta com lançamentos nesses meses só pode ser desativada. Contas usadas
-- automaticamente pelo sistema (juros, tarifas, taxas) continuam sem exclusão.

-- -----------------------------------------------------------------------------
-- Estrutura: conta dentro de grupo; grupo não fica dentro de outro grupo; conta
-- com lançamentos não vira grupo; grupo com contas não vira conta.
-- -----------------------------------------------------------------------------
create or replace function app.tg_categorias_estrutura()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pai public.categorias_financeiras;
begin
  new.nome := trim(new.nome);
  new.codigo := trim(new.codigo);
  if new.pai_id is not null
     and (tg_op = 'INSERT' or new.pai_id is distinct from old.pai_id or new.sintetica is distinct from old.sintetica) then
    if new.pai_id = new.id then
      raise exception 'Uma conta não pode ser grupo dela mesma.';
    end if;
    select * into v_pai from public.categorias_financeiras where id = new.pai_id and empresa_id = new.empresa_id;
    if not found or not v_pai.sintetica then
      raise exception 'Escolha um grupo do plano de contas.';
    end if;
    if new.sintetica then
      raise exception 'Um grupo não pode ficar dentro de outro grupo.';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.sintetica <> old.sintetica then
    if new.sintetica and (exists (select 1 from public.lancamentos where categoria_id = old.id)
                          or exists (select 1 from public.recorrencias where categoria_id = old.id)) then
      raise exception 'A conta "%" tem lançamentos e não pode virar grupo.', old.nome;
    end if;
    if not new.sintetica and exists (select 1 from public.categorias_financeiras where pai_id = old.id) then
      raise exception 'O grupo "%" tem contas dentro e não pode virar conta.', old.nome;
    end if;
  end if;
  return new;
end;
$$;
create trigger categorias_estrutura before insert or update on public.categorias_financeiras
  for each row execute function app.tg_categorias_estrutura();

-- -----------------------------------------------------------------------------
-- Uso de uma conta (para a tela de exclusão): quantos lançamentos e
-- recorrências, meses fechados e contas dentro do grupo.
-- -----------------------------------------------------------------------------
create or replace function public.categoria_financeira_uso(p_categoria_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v public.categorias_financeiras;
begin
  select * into v from public.categorias_financeiras where id = p_categoria_id;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'lancamentos', (select count(*) from public.lancamentos where categoria_id = v.id),
    'recorrencias', (select count(*) from public.recorrencias where categoria_id = v.id),
    'meses_fechados', coalesce((
      select jsonb_agg(m order by m) from (
        select distinct to_char(l.data_competencia, 'YYYY-MM') as m
          from public.lancamentos l
         where l.categoria_id = v.id and app.competencia_fechada(l.empresa_id, l.data_competencia)
      ) x), '[]'::jsonb),
    'contas_no_grupo', (select count(*) from public.categorias_financeiras where pai_id = v.id),
    'sistema', v.codigo_sistema is not null,
    'grupo', v.sintetica
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Excluir conta ou grupo.
--  * Conta sem lançamentos: exclui.
--  * Conta com lançamentos/recorrências: move tudo para p_destino_id (conta
--    ativa, não agrupadora, da mesma natureza) e exclui. Recusa se houver
--    lançamento em mês fechado.
--  * Grupo: as contas de dentro passam para o grupo p_destino_id (ou ficam
--    sem grupo) e o grupo é excluído.
-- Roda com as permissões de quem chama (RLS e gatilhos de cada tabela valem).
-- -----------------------------------------------------------------------------
create or replace function public.excluir_categoria_financeira(p_categoria_id uuid, p_destino_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.categorias_financeiras;
  d public.categorias_financeiras;
  v_lanc int;
  v_rec int;
  v_filhos int;
  v_mes text;
begin
  select * into v from public.categorias_financeiras where id = p_categoria_id;
  if not found then
    raise exception 'Conta não encontrada.' using errcode = 'P0002';
  end if;
  if not (v.empresa_id = any ((select app.empresas_com('financeiro.editar'))::uuid[])) then
    raise exception 'Você não tem permissão para editar o plano de contas desta empresa.' using errcode = '42501';
  end if;
  if v.codigo_sistema is not null then
    raise exception 'A conta "%" é usada automaticamente pelo sistema. Você pode renomeá-la ou desativá-la, mas não excluí-la.', v.nome;
  end if;
  if p_destino_id = p_categoria_id then
    raise exception 'Escolha outra conta para receber os lançamentos.';
  end if;

  if v.sintetica then
    if p_destino_id is not null then
      select * into d from public.categorias_financeiras where id = p_destino_id and empresa_id = v.empresa_id;
      if not found or not d.sintetica then
        raise exception 'Escolha um grupo para receber as contas.';
      end if;
    end if;
    update public.categorias_financeiras set pai_id = p_destino_id where pai_id = v.id and empresa_id = v.empresa_id;
    get diagnostics v_filhos = row_count;
    delete from public.categorias_financeiras where id = v.id;
    return jsonb_build_object('contas_movidas', v_filhos, 'lancamentos_movidos', 0, 'recorrencias_movidas', 0);
  end if;

  select count(*) into v_lanc from public.lancamentos where categoria_id = v.id;
  select count(*) into v_rec from public.recorrencias where categoria_id = v.id;
  if v_lanc + v_rec > 0 then
    if p_destino_id is null then
      raise exception 'A conta "%" tem % lançamento(s). Escolha a conta que vai recebê-los.', v.nome, v_lanc + v_rec;
    end if;
    select * into d from public.categorias_financeiras where id = p_destino_id and empresa_id = v.empresa_id;
    if not found or d.sintetica then
      raise exception 'Escolha uma conta (não um grupo) para receber os lançamentos.';
    end if;
    if not d.ativa then
      raise exception 'A conta "%" está desativada. Escolha uma conta ativa.', d.nome;
    end if;
    if d.natureza <> v.natureza then
      raise exception 'Escolha uma conta de %, como a conta que será excluída.', v.natureza;
    end if;
    select to_char(min(l.data_competencia), 'MM/YYYY') into v_mes
      from public.lancamentos l
     where l.categoria_id = v.id and app.competencia_fechada(l.empresa_id, l.data_competencia);
    if v_mes is not null then
      raise exception 'A conta "%" tem lançamentos em meses já fechados pelo escritório (a partir de %). Ela não pode ser excluída; desative-a para não aparecer nos próximos lançamentos.', v.nome, v_mes;
    end if;
    update public.lancamentos set categoria_id = d.id where categoria_id = v.id and empresa_id = v.empresa_id;
    update public.recorrencias set categoria_id = d.id where categoria_id = v.id and empresa_id = v.empresa_id;
  end if;
  delete from public.categorias_financeiras where id = v.id;
  return jsonb_build_object('contas_movidas', 0, 'lancamentos_movidos', v_lanc, 'recorrencias_movidas', v_rec);
end;
$$;

revoke all on function public.categoria_financeira_uso(uuid) from public, anon;
revoke all on function public.excluir_categoria_financeira(uuid, uuid) from public, anon;
grant execute on function public.categoria_financeira_uso(uuid) to authenticated;
grant execute on function public.excluir_categoria_financeira(uuid, uuid) to authenticated;
