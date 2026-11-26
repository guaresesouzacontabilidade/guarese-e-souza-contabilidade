-- Data de início do contas a pagar no portal, por empresa.
--
-- Quem começa a usar o portal com um sistema antigo não quer as contas antigas
-- (que já foram pagas lá) aparecendo como em aberto. Com a data definida, as
-- contas a pagar com vencimento ANTES dela não são criadas automaticamente:
-- nem das notas fiscais de compra (NF-e, NFS-e tomada, CT-e) nem da importação
-- de relatórios e planilhas. As notas continuam guardadas para a contabilidade
-- e o lançamento manual continua livre. Sem data, nada muda.

create table public.financeiro_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  pagar_desde date,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);
create trigger auditoria_financeiro_config after insert or update or delete on public.financeiro_config
  for each row execute function app.tg_auditoria();
alter table public.financeiro_config enable row level security;
create policy financeiro_config_leitura on public.financeiro_config for select to authenticated
  using (empresa_id = any ((select app.empresas_com('financeiro.ver'))::uuid[]));
revoke all on public.financeiro_config from anon, authenticated;
grant select on public.financeiro_config to authenticated;

-- Definir (ou tirar, com null) a data de início
create or replace function public.financeiro_definir_pagar_desde(p_empresa_id uuid, p_data date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.exigir(p_empresa_id, 'financeiro.editar');
  if p_data is not null and (p_data < date '2000-01-01' or p_data > (now() at time zone 'America/Araguaina')::date + 366) then
    raise exception 'Data de início inválida.';
  end if;
  insert into public.financeiro_config (empresa_id, pagar_desde)
  values (p_empresa_id, p_data)
  on conflict (empresa_id) do update set pagar_desde = excluded.pagar_desde, atualizado_por = auth.uid(), updated_at = now();
end;
$$;
revoke all on function public.financeiro_definir_pagar_desde(uuid, date) from public, anon;
grant execute on function public.financeiro_definir_pagar_desde(uuid, date) to authenticated;

-- Contas a pagar automáticas (notas e importações) antes da data não são criadas
create or replace function app.tg_lancamento_pagar_desde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desde date;
begin
  if new.tipo = 'pagar' and new.origem in ('nfe', 'nfse', 'cte', 'importacao', 'ocr') then
    select pagar_desde into v_desde from public.financeiro_config where empresa_id = new.empresa_id;
    if v_desde is not null and coalesce(new.data_vencimento, new.data_competencia) < v_desde then
      return null;
    end if;
  end if;
  return new;
end;
$$;
create trigger lancamento_pagar_desde before insert on public.lancamentos
  for each row execute function app.tg_lancamento_pagar_desde();
