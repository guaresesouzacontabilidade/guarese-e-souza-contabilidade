-- Confirmação da operação (evento 210200 da manifestação do destinatário) pedida
-- por uma pessoa, nota a nota: libera na SEFAZ o XML completo das NF-e cuja
-- ciência não é mais aceita (prazo de 10 dias). É uma declaração da empresa de
-- que a operação aconteceu; só quem gerencia o certificado pede, com o texto da
-- declaração guardado na auditoria. O envio sai pela fila, com o certificado da
-- empresa, na busca seguinte (nada é enviado na demonstração).

alter table public.nfe_resumos
  add column confirmacao_pedida_em timestamptz,
  add column confirmacao_pedida_por uuid references public.perfis(id) on delete set null,
  add column confirmacao_em timestamptz,
  add column confirmacao_retorno text check (confirmacao_retorno is null or length(confirmacao_retorno) <= 300);

create index nfe_resumos_confirmacao_pendente_idx on public.nfe_resumos (empresa_id)
  where confirmacao_pedida_em is not null and confirmacao_em is null and confirmacao_retorno is null;

alter table public.notas_automaticas_execucoes drop constraint notas_automaticas_execucoes_servico_check;
alter table public.notas_automaticas_execucoes add constraint notas_automaticas_execucoes_servico_check
  check (servico in ('nfe', 'nfse', 'ciencia', 'confirmacao'));

-- Pedido de confirmação: notas autorizadas, sem o XML no portal, ainda não confirmadas
-- (um pedido recusado pela SEFAZ pode ser refeito). Devolve quantas notas entraram.
create or replace function public.confirmar_operacoes_nfe(p_empresa_id uuid, p_chaves text[], p_declaracao text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qtd integer;
begin
  perform app.exigir(p_empresa_id, 'certificado.gerenciar');
  if coalesce(cardinality(p_chaves), 0) = 0 or cardinality(p_chaves) > 200 then
    raise exception 'Escolha de 1 a 200 notas.' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_declaracao)), 0) < 20 then
    raise exception 'Marque a declaração de que a operação aconteceu.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.certificados_digitais
                  where empresa_id = p_empresa_id and revogado_em is null and valido_ate > now()) then
    raise exception 'Cadastre um certificado digital válido da empresa: a confirmação é registrada na SEFAZ com ele.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.notas_automaticas where empresa_id = p_empresa_id and nfe_ativa and not pausada) then
    raise exception 'A busca da NF-e está pausada ou desligada nesta empresa: ligue em “O que buscar” para a SEFAZ entregar o XML depois da confirmação.'
      using errcode = '22023';
  end if;
  update public.nfe_resumos
     set confirmacao_pedida_em = now(), confirmacao_pedida_por = auth.uid(), confirmacao_retorno = null
   where empresa_id = p_empresa_id
     and chave = any (p_chaves)
     and situacao = 'autorizada'
     and documento_id is null
     and confirmacao_em is null
     and (confirmacao_pedida_em is null or confirmacao_retorno is not null);
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then
    raise exception 'Nenhuma dessas notas pode ser confirmada: já têm o XML, já foram confirmadas ou estão canceladas.' using errcode = '22023';
  end if;
  perform app.registrar_auditoria('nfe_confirmar_operacao', 'nfe_resumos', p_empresa_id::text, p_empresa_id,
    jsonb_build_object('quantidade', v_qtd, 'chaves', to_jsonb(p_chaves), 'declaracao', left(p_declaracao, 1000)));
  perform app.agendar_notas_automaticas(p_empresa_id, now());
  return v_qtd;
end;
$$;

revoke execute on function public.confirmar_operacoes_nfe(uuid, text[], text) from public, anon;
grant execute on function public.confirmar_operacoes_nfe(uuid, text[], text) to authenticated;
