-- =============================================================================
-- DARE da SEFAZ-TO pelo robô do portal (complementação de alíquota do Simples)
--
-- O sistema de DARE do Tocantins (dare.sefaz.to.gov.br) exige entrar com o
-- login do governo do Tocantins (TOauth: CPF ou e-mail e senha). O escritório
-- cadastra esse acesso uma vez; o servidor do portal entra com ele, preenche o
-- DARE da receita da complementação com o valor da apuração do ICMS e o
-- vencimento do dia 9, baixa o PDF oficial e publica como guia da empresa.
--
--  * dare_to_acesso: login mascarado e situação do acesso (o que a tela mostra).
--  * dare_to_acesso_segredo: login e senha cifrados no servidor (AES-256-GCM,
--    chave só no servidor); nenhum usuário lê esta tabela, nem o administrador.
--  * dare_to_testes: resultado de cada "Testar conexão" com a estrutura do
--    formulário encontrado (nomes dos campos), para ajustar o robô se a SEFAZ
--    mudar a tela. Não guarda senha nem página inteira.
--  * dar_emissoes passa a aceitar o DARE do Tocantins (origem "apuracao").
-- =============================================================================

create table public.dare_to_acesso (
  id smallint primary key default 1 check (id = 1),
  login_mascarado text not null check (length(login_mascarado) between 3 and 80),
  situacao text not null default 'nao_testado' check (situacao in ('nao_testado', 'conectado', 'erro')),
  ultimo_teste_em timestamptz,
  ultima_mensagem text check (ultima_mensagem is null or length(ultima_mensagem) <= 500),
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger dare_to_acesso_updated before update on public.dare_to_acesso
  for each row execute function app.tg_updated_at();
create trigger auditoria_dare_to_acesso after insert or update or delete on public.dare_to_acesso
  for each row execute function app.tg_auditoria();

create table public.dare_to_acesso_segredo (
  id smallint primary key default 1 check (id = 1) references public.dare_to_acesso(id) on delete cascade,
  conteudo_cifrado text not null check (conteudo_cifrado ~ '^v[0-9]+:[A-Za-z0-9+/=]+$' and length(conteudo_cifrado) <= 4000),
  created_at timestamptz not null default now()
);

create table public.dare_to_testes (
  id uuid primary key default gen_random_uuid(),
  ok boolean not null,
  mensagem text check (mensagem is null or length(mensagem) <= 500),
  mapeamento jsonb check (mapeamento is null or pg_column_size(mapeamento) <= 100000),
  feito_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index dare_to_testes_data_idx on public.dare_to_testes (created_at desc);

alter table public.dare_to_acesso enable row level security;
alter table public.dare_to_acesso_segredo enable row level security;
alter table public.dare_to_testes enable row level security;

-- A equipe vê se o acesso está ligado (para o botão de emitir); o segredo não tem política: só o servidor lê
create policy dare_to_acesso_leitura on public.dare_to_acesso for select to authenticated using ((select app.is_equipe()));
create policy dare_to_testes_leitura on public.dare_to_testes for select to authenticated using ((select app.is_admin()));
grant select on public.dare_to_acesso, public.dare_to_testes to authenticated;
grant select, insert, update, delete on public.dare_to_acesso, public.dare_to_acesso_segredo, public.dare_to_testes to service_role;

-- DARE do Tocantins na tabela de guias emitidas pelo robô
alter table public.dar_emissoes drop constraint if exists dar_emissoes_origem_check;
alter table public.dar_emissoes add constraint dar_emissoes_origem_check check (origem in ('efd', 'informado', 'apuracao'));
alter table public.dar_emissoes drop constraint if exists dar_emissoes_numero_check;
alter table public.dar_emissoes add constraint dar_emissoes_numero_check check (numero ~ '^[0-9]{4,60}$');
alter table public.dar_emissoes drop constraint if exists dar_emissoes_numero_key;
alter table public.dar_emissoes add constraint dar_emissoes_uf_numero_key unique (uf, numero);

-- -----------------------------------------------------------------------------
-- Acesso (só o administrador do escritório cadastra, testa ou remove)
-- -----------------------------------------------------------------------------
create or replace function public.dare_to_salvar_acesso(p_login_mascarado text, p_conteudo_cifrado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório cadastra o acesso à SEFAZ-TO.' using errcode = '42501';
  end if;
  insert into public.dare_to_acesso (id, login_mascarado, situacao, ultimo_teste_em, ultima_mensagem, atualizado_por)
  values (1, p_login_mascarado, 'nao_testado', null, null, auth.uid())
  on conflict (id) do update
    set login_mascarado = excluded.login_mascarado, situacao = 'nao_testado', ultimo_teste_em = null,
        ultima_mensagem = null, atualizado_por = auth.uid();
  insert into public.dare_to_acesso_segredo (id, conteudo_cifrado) values (1, p_conteudo_cifrado)
  on conflict (id) do update set conteudo_cifrado = excluded.conteudo_cifrado, created_at = now();
end;
$$;

create or replace function public.dare_to_remover_acesso()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Só o administrador do escritório remove o acesso à SEFAZ-TO.' using errcode = '42501';
  end if;
  delete from public.dare_to_acesso where id = 1;
end;
$$;

-- Resultado de um teste de conexão (ou de uma emissão que não conseguiu entrar)
create or replace function public.dare_to_registrar_teste(p_ok boolean, p_mensagem text, p_mapeamento jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_equipe() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dare_to_acesso where id = 1) then
    raise exception 'O acesso à SEFAZ-TO não está cadastrado.';
  end if;
  update public.dare_to_acesso
     set situacao = case when p_ok then 'conectado' else 'erro' end,
         ultimo_teste_em = now(),
         ultima_mensagem = left(p_mensagem, 500)
   where id = 1;
  if p_mapeamento is not null then
    insert into public.dare_to_testes (ok, mensagem, mapeamento) values (p_ok, left(p_mensagem, 500), p_mapeamento);
    -- Guarda só os 20 testes mais recentes
    delete from public.dare_to_testes where id in (select id from public.dare_to_testes order by created_at desc offset 20);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Dados da tela da apuração (DARE da complementação da empresa no mês)
-- -----------------------------------------------------------------------------
create or replace function public.dados_dare_to(p_empresa_id uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_emp public.empresas;
begin
  perform app.exigir(p_empresa_id, 'calculos.gerenciar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  return jsonb_build_object(
    'empresa', jsonb_build_object(
      'uf', upper(v_emp.uf),
      'inscricao_estadual', v_emp.inscricao_estadual,
      'documento', v_emp.documento,
      'demonstracao', v_emp.demonstracao,
      'regime', v_emp.regime_tributario,
      'contribuinte_icms', v_emp.contribuinte_icms),
    'acesso', (select jsonb_build_object('situacao', a.situacao, 'login_mascarado', a.login_mascarado, 'ultimo_teste_em', a.ultimo_teste_em, 'ultima_mensagem', a.ultima_mensagem)
                 from public.dare_to_acesso a where a.id = 1),
    'hoje', app.hoje(),
    'emissoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'numero', d.numero,
               'receita', d.receita,
               'total', d.total,
               'vencimento', d.vencimento,
               'linha_digitavel', d.linha_digitavel,
               'documento_id', d.documento_id,
               'gerado_por', p.nome,
               'created_at', d.created_at) order by d.created_at desc)
        from public.dar_emissoes d
        left join public.perfis p on p.id = d.gerado_por
       where d.empresa_id = p_empresa_id and d.competencia = v_comp and d.uf = 'TO'
    ), '[]'::jsonb)
  );
end;
$$;

-- DARE do Tocantins já emitidos no mês, de todas as empresas que a pessoa gerencia (tela da carteira)
create or replace function public.dare_to_emitidos_mes(p_competencia date)
returns table (empresa_id uuid, numero text, total numeric, vencimento date, documento_id uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (d.empresa_id) d.empresa_id, d.numero, d.total, d.vencimento, d.documento_id, d.created_at
    from public.dar_emissoes d
   where d.competencia = date_trunc('month', p_competencia)::date
     and d.uf = 'TO'
     and d.empresa_id = any ((select app.empresas_com('calculos.gerenciar'))::uuid[])
   order by d.empresa_id, d.created_at desc;
$$;

revoke execute on function public.dare_to_salvar_acesso(text, text), public.dare_to_remover_acesso(), public.dare_to_registrar_teste(boolean, text, jsonb),
  public.dados_dare_to(uuid, date), public.dare_to_emitidos_mes(date) from public, anon;
grant execute on function public.dare_to_salvar_acesso(text, text), public.dare_to_remover_acesso(), public.dare_to_registrar_teste(boolean, text, jsonb),
  public.dados_dare_to(uuid, date), public.dare_to_emitidos_mes(date) to authenticated;
