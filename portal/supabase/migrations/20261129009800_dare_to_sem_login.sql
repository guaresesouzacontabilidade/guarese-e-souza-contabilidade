-- =============================================================================
-- DARE da SEFAZ-TO sem login: o robô usa o DARE avulso público
-- (sefaz.to.gov.br/dare: CNPJ → seleção da inscrição → formulário), como uma
-- pessoa no navegador. Sai o cadastro do acesso do escritório (nunca usado:
-- as tabelas estão vazias) e a tela passa a receber o município da empresa.
-- =============================================================================

drop function if exists public.dare_to_salvar_acesso(text, text);
drop function if exists public.dare_to_remover_acesso();
drop function if exists public.dare_to_registrar_teste(boolean, text, jsonb);
drop table if exists public.dare_to_testes;
drop table if exists public.dare_to_acesso_segredo;
drop table if exists public.dare_to_acesso;

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
      'municipio_ibge', v_emp.municipio_ibge,
      'demonstracao', v_emp.demonstracao,
      'regime', v_emp.regime_tributario,
      'contribuinte_icms', v_emp.contribuinte_icms),
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
