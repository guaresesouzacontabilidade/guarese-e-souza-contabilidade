-- Ferramentas de cada empresa: o escritório desliga as funções que a empresa
-- não usa (ex.: CT-e numa madeireira, maquininhas numa transportadora). A
-- ferramenta desligada some do menu, do painel e das telas da empresa, para o
-- cliente e para a equipe. Desligar não apaga nada: as configurações e os
-- dados continuam guardados e voltam ao religar. Só o escritório altera.

alter table public.empresas
  add column ferramentas_desligadas text[] not null default '{}'::text[],
  -- Quando o escritório mexeu nas ferramentas (a carga da demonstração não sobrescreve depois disso)
  add column ferramentas_alteradas_em timestamptz;

alter table public.empresas
  add constraint empresas_ferramentas_validas check (
    ferramentas_desligadas <@ array[
      'nfse', 'nfe', 'cte', 'notas_automaticas', 'agenda', 'vencimentos', 'financeiro', 'maquininhas',
      'conciliacao', 'fechamento', 'calculos', 'auditor', 'relatorios', 'declaracoes', 'solicitacoes'
    ]::text[]
  );

comment on column public.empresas.ferramentas_desligadas is
  'Funções do portal desligadas para a empresa (somem do menu, do painel e das telas). Só a equipe do escritório altera.';

-- O cliente pode editar o cadastro (empresa.editar), mas não as ferramentas
create or replace function app.tg_empresa_ferramentas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.is_equipe() and new.ferramentas_desligadas is distinct from old.ferramentas_desligadas then
    raise exception 'Somente o escritório liga e desliga as ferramentas da empresa.' using errcode = '42501';
  end if;
  -- Sem repetição e em ordem (a comparação fica estável)
  new.ferramentas_desligadas := array(select distinct f from unnest(new.ferramentas_desligadas) f order by f);
  new.ferramentas_alteradas_em := now();
  return new;
end;
$$;

create trigger empresas_ferramentas before update of ferramentas_desligadas on public.empresas
  for each row execute function app.tg_empresa_ferramentas();

revoke all on function app.tg_empresa_ferramentas() from public, anon;

-- Leitura por quem vê a empresa (o menu depende dela); escrita sujeita à RLS e ao gatilho acima
grant select (ferramentas_desligadas) on public.empresas to authenticated;
grant update (ferramentas_desligadas) on public.empresas to authenticated;
