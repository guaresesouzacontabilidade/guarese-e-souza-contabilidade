-- =============================================================================
-- Emissão de NF-e (modelo 55) pelo portal — empresas e produtores rurais
--
--  * O escritório configura a emissão de cada empresa: quem emite (a empresa
--    com CNPJ ou o produtor rural com CPF, com uma ou mais inscrições
--    estaduais/propriedades), os produtos, os clientes, os transportadores e
--    as "operações" (natureza da operação com CFOP, CST/CSOSN, alíquotas,
--    IBS/CBS, DIFAL, ICMS do frete, FUNRURAL, FETHAB e demais contribuições).
--  * Quem emite (escritório ou cliente com permissão) escolhe a operação, o
--    comprador, os produtos, a quantidade e o preço. As regras fiscais são
--    copiadas aqui no banco, da operação cadastrada pelo escritório — o
--    pedido não traz alíquotas nem CST.
--  * O portal assina com o certificado A1 e envia ao autorizador do estado
--    (SEFAZ). Sem certificado, sem configuração ou com a emissão desligada, a
--    nota não é aceita: nada é simulado.
--  * Numeração: série por inscrição estadual (produtor pessoa física: séries
--    920 a 969); o número é reservado no pedido. Nota rejeitada pode ser
--    corrigida e enviada de novo com o mesmo número; se for descartada, o
--    número precisa ser inutilizado na SEFAZ.
--  * Guias: depois da autorização, o portal registra as guias da nota (ICMS
--    da operação, ICMS do frete, DIFAL, FETHAB...) com o valor calculado. A
--    guia oficial é gerada no site da SEFAZ (ou da GNRE) e o escritório anexa
--    o PDF, que entra na agenda de pagamentos do cliente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissões: nfe.emitir (equipe e titular) e nfe.configurar (só equipe)
-- -----------------------------------------------------------------------------
create or replace function app.permissoes_validas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'empresa.ver',
    'empresa.editar',
    'usuarios.gerenciar',
    'documentos.ver',
    'documentos.enviar',
    'documentos.baixar',
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'financeiro.ver',
    'financeiro.editar',
    'financeiro.importar',
    'conciliacao.executar',
    'relatorios.ver',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'mensagens.usar',
    'calculos.ver',
    'calculos.gerenciar',
    'colaboradores.gerenciar',
    'certificado.gerenciar',
    'auditor.ver',
    'auditor.gerenciar',
    'maquininhas.ver',
    'maquininhas.gerenciar',
    'nfse.emitir',
    'nfse.configurar',
    'nfe.emitir',
    'nfe.configurar'
  ]::text[];
$$;

create or replace function app.permissoes_exclusivas_equipe()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'documentos.revisar',
    'documentos.publicar',
    'checklist.gerenciar',
    'relatorios.publicar',
    'fechamento.gerenciar',
    'fechamento.reabrir',
    'calculos.gerenciar',
    'auditor.gerenciar',
    'nfse.configurar',
    'nfe.configurar'
  ]::text[];
$$;

create or replace function app.permissoes_padrao(p_papel text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'equipe' then array[
      'empresa.ver', 'empresa.editar', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar', 'documentos.revisar', 'documentos.publicar',
      'checklist.gerenciar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar', 'conciliacao.executar',
      'relatorios.ver', 'relatorios.publicar',
      'fechamento.gerenciar',
      'mensagens.usar',
      'calculos.ver', 'calculos.gerenciar', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver', 'auditor.gerenciar',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir', 'nfse.configurar',
      'nfe.emitir', 'nfe.configurar'
    ]
    when 'cliente_titular' then array[
      'empresa.ver', 'usuarios.gerenciar',
      'documentos.ver', 'documentos.enviar', 'documentos.baixar',
      'financeiro.ver', 'financeiro.editar', 'financeiro.importar',
      'relatorios.ver',
      'mensagens.usar',
      'calculos.ver', 'colaboradores.gerenciar',
      'certificado.gerenciar',
      'auditor.ver',
      'maquininhas.ver', 'maquininhas.gerenciar',
      'nfse.emitir',
      'nfe.emitir'
    ]
    when 'cliente_colaborador' then array[
      'empresa.ver',
      'documentos.ver', 'documentos.enviar',
      'mensagens.usar'
    ]
    else array[]::text[]
  end;
$$;

create or replace function app.tg_validar_membro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select tipo into v_tipo from public.perfis where id = new.user_id;
  if v_tipo is null then
    raise exception 'Usuário inexistente.';
  end if;
  if new.papel = 'equipe' and v_tipo not in ('admin', 'equipe') then
    raise exception 'Somente usuários da equipe do escritório podem ter o papel "equipe".';
  end if;
  if new.papel <> 'equipe' and v_tipo <> 'cliente' then
    raise exception 'Usuários da equipe não podem ser vinculados como clientes.';
  end if;
  if new.papel <> 'equipe' and new.permissoes && app.permissoes_exclusivas_equipe() then
    raise exception 'Permissões exclusivas da equipe não podem ser concedidas a clientes.';
  end if;
  -- Quem pode ver qualquer coisa precisa ao menos ver a empresa.
  if cardinality(new.permissoes) > 0 and not ('empresa.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'empresa.ver');
  end if;
  -- Baixar documentos implica ver documentos.
  if 'documentos.baixar' = any(new.permissoes) and not ('documentos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'documentos.ver');
  end if;
  if 'financeiro.editar' = any(new.permissoes) and not ('financeiro.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'financeiro.ver');
  end if;
  -- Configurar os cálculos ou cadastrar colaboradores implica ver os cálculos.
  if (new.permissoes && array['calculos.gerenciar', 'colaboradores.gerenciar']) and not ('calculos.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'calculos.ver');
  end if;
  -- Conduzir o auditor implica ver os achados.
  if 'auditor.gerenciar' = any(new.permissoes) and not ('auditor.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'auditor.ver');
  end if;
  -- Cadastrar contratos e importar relatórios implica ver a conferência das maquininhas.
  if 'maquininhas.gerenciar' = any(new.permissoes) and not ('maquininhas.ver' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'maquininhas.ver');
  end if;
  -- Configurar a emissão implica poder emitir.
  if 'nfse.configurar' = any(new.permissoes) and not ('nfse.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'nfse.emitir');
  end if;
  if 'nfe.configurar' = any(new.permissoes) and not ('nfe.emitir' = any(new.permissoes)) then
    new.permissoes := array_append(new.permissoes, 'nfe.emitir');
  end if;
  return new;
end;
$$;

update public.empresa_membros
   set permissoes = permissoes || array['nfe.emitir', 'nfe.configurar']
 where papel = 'equipe' and not (permissoes && array['nfe.emitir', 'nfe.configurar']);
update public.empresa_membros
   set permissoes = permissoes || array['nfe.emitir']
 where papel = 'cliente_titular' and not ('nfe.emitir' = any(permissoes));
update public.convites
   set permissoes = permissoes || array['nfe.emitir', 'nfe.configurar']
 where status = 'pendente' and papel = 'equipe' and cardinality(permissoes) > 0
   and not (permissoes && array['nfe.emitir', 'nfe.configurar']);
update public.convites
   set permissoes = permissoes || array['nfe.emitir']
 where status = 'pendente' and papel = 'cliente_titular' and cardinality(permissoes) > 0
   and not ('nfe.emitir' = any(permissoes));

-- -----------------------------------------------------------------------------
-- 2. Tabela oficial de classificação tributária do IBS/CBS (cClassTrib) para NF-e
--    (Portal Nacional da NF-e, "IT 2025.002 v1.70 - cClassTrib", aba de 01/09/2026)
-- -----------------------------------------------------------------------------
create table public.nfe_cclass_trib (
  cclass_trib text primary key check (cclass_trib ~ '^[0-9]{6}$'),
  cst text not null check (cst ~ '^[0-9]{3}$' and cst = left(cclass_trib, 3)),
  descricao_cst text not null,
  nome text not null,
  tipo_aliquota text,
  p_red_ibs numeric(7, 4) not null default 0 check (p_red_ibs between 0 and 100),
  p_red_cbs numeric(7, 4) not null default 0 check (p_red_cbs between 0 and 100),
  base_legal text,
  inicio_vigencia date,
  fim_vigencia date
);
insert into public.nfe_cclass_trib (cclass_trib, cst, descricao_cst, nome, tipo_aliquota, p_red_ibs, p_red_cbs, base_legal, inicio_vigencia, fim_vigencia) values
  ('000001', '000', 'Tributação integral', 'Situações tributadas integralmente pelo IBS e CBS.', 'Padrão', 0, 0, null, null, null),
  ('000003', '000', 'Tributação integral', 'Regime automotivo - projetos incentivados (art. 311)', 'Padrão', 0, 0, 'LC 214/2025, Art. 311', null, null),
  ('000004', '000', 'Tributação integral', 'Regime automotivo - projetos incentivados (art. 312)', 'Padrão', 0, 0, 'LC 214/2025, Art. 312', null, null),
  ('000005', '000', 'Tributação integral', 'Operação com EAC destinado à mistura com gasolina A, mas com saída do biocombustível com destinação diversa', 'Padrão', 0, 0, 'LC 214/2025, Art. 179, I', null, null),
  ('200002', '200', 'Alíquota zero', 'Fornecimento ou importação para produtor rural não contribuinte ou TAC', 'Padrão', 100, 100, 'LC 214/2025, Art. 110', null, null),
  ('200003', '200', 'Alíquota zero', 'Vendas de produtos destinados à alimentação humana (Anexo I)', 'Padrão', 100, 100, 'LC 214/2025, Art. 125', null, null),
  ('200004', '200', 'Alíquota zero', 'Fornecimento de dispositivos médicos (Anexo XII)', 'Padrão', 100, 100, 'LC 214/2025, Art. 144, I', null, null),
  ('200005', '200', 'Alíquota zero', 'Fornecimento de dispositivos médicos para órgãos da administração pública e entidades de saúde imunes (Anexo IV)', 'Padrão', 100, 100, 'LC 214/2025, Art. 144, II', null, null),
  ('200006', '200', 'Alíquota zero', 'Situação de emergência de saúde pública reconhecida pelo Poder público', 'Padrão', 100, 100, 'LC 214/2025, Art. 144, § 3º', null, null),
  ('200007', '200', 'Alíquota zero', 'Fornecimento dos dispositivos de acessibilidade próprios para pessoas com deficiência (Anexo XIII)', 'Padrão', 100, 100, 'LC 214/2025, Art. 145, I', null, null),
  ('200008', '200', 'Alíquota zero', 'Fornecimento dos dispositivos de acessibilidade próprios para pessoas com deficiência adquiridos por órgãos da administração pública (Anexo V)', 'Padrão', 100, 100, 'LC 214/2025, Art. 145, II', null, null),
  ('200009', '200', 'Alíquota zero', 'Fornecimento dos medicamentos registrados na Anvisa', 'Padrão', 100, 100, 'LC 214/2025, Art. 146', null, null),
  ('200010', '200', 'Alíquota zero', 'Fornecimento dos medicamentos registrados na Anvisa, adquiridos por órgãos da administração pública', 'Padrão', 100, 100, 'LC 214/2025, Art. 146, § 1º, I e II', null, null),
  ('200011', '200', 'Alíquota zero', 'Fornecimento das composições para nutrição enteral e parenteral quando adquiridas por órgãos da administração pública (Anexo VI)', 'Padrão', 100, 100, 'LC 214/2025, Art. 146, § 2º', null, null),
  ('200012', '200', 'Alíquota zero', 'Situação de emergência de saúde pública reconhecida pelo Poder público', 'Padrão', 100, 100, 'LC 214/2025, Art. 146, § 4º', null, null),
  ('200013', '200', 'Alíquota zero', 'Fornecimento de tampões higiênicos, absorventes higiênicos internos ou externos', 'Padrão', 100, 100, 'LC 214/2025, Art. 147', null, null),
  ('200014', '200', 'Alíquota zero', 'Fornecimento dos produtos hortícolas, frutas e ovos (Anexo XV)', 'Padrão', 100, 100, 'LC 214/2025, Art. 148', null, null),
  ('200015', '200', 'Alíquota zero', 'Venda de automóveis de passageiros de fabricação nacional adquiridos por motoristas profissionais ou pessoas com deficiência', 'Padrão', 100, 100, 'LC 214/2025, Art. 149', null, null),
  ('200020', '200', 'Alíquota zero', 'Operação praticada por sociedades cooperativas optantes por regime específico do IBS e CBS', 'Padrão', 100, 100, 'LC 214/2025, Art. 271', null, null),
  ('200022', '200', 'Alíquota zero', 'Operação originada fora da ZFM que destine bem material industrializado a contribuinte estabelecido na ZFM', 'Padrão', 100, 100, 'LC 214/2025, Art. 445', null, null),
  ('200023', '200', 'Alíquota zero', 'Operação realizada por indústria incentivada que destine bem material intermediário para outra indústria incentivada na ZFM', 'Padrão', 100, 100, 'LC 214/2025, Art. 448', null, null),
  ('200024', '200', 'Alíquota zero', 'Operação originada fora das Áreas de Livre Comércio destinadas a contribuinte estabelecido nas Áreas de Livre Comércio', 'Padrão', 100, 100, 'LC 214/2025, Art. 463', null, null),
  ('200030', '200', 'Alíquota reduzida em 60%', 'Venda dos dispositivos médicos (Anexo IV)', 'Padrão', 60, 60, 'LC 214/2025, Art. 131', null, null),
  ('200031', '200', 'Alíquota reduzida em 60%', 'Fornecimento dos dispositivos de acessibilidade próprios para pessoas com deficiência (Anexo V)', 'Padrão', 60, 60, 'LC 214/2025, Art. 132', null, null),
  ('200032', '200', 'Alíquota reduzida em 60%', 'Fornecimento dos medicamentos registrados na Anvisa ou produzidos por farmácias de manipulação, ressalvados os medicamentos sujeitos à alíquota zero', 'Padrão', 60, 60, 'LC 214/2025, Art. 133', null, null),
  ('200033', '200', 'Alíquota reduzida em 60%', 'Fornecimento das composições para nutrição enteral e parenteral (Anexo VI)', 'Padrão', 60, 60, 'LC 214/2025, Art. 133, § 1º', null, null),
  ('200034', '200', 'Alíquota reduzida em 60%', 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)', 'Padrão', 60, 60, 'LC 214/2025, Art. 135', null, null),
  ('200035', '200', 'Alíquota reduzida em 60%', 'Fornecimento dos produtos de higiene pessoal e limpeza (Anexo VIII)', 'Padrão', 60, 60, 'LC 214/2025, Art. 136', null, null),
  ('200036', '200', 'Alíquota reduzida em 60%', 'Fornecimento de produtos agropecuários, aquícolas, pesqueiros, florestais e extrativistas vegetais in natura', 'Padrão', 60, 60, 'LC 214/2025, Art. 137', null, null),
  ('200038', '200', 'Alíquota reduzida em 60%', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)', 'Padrão', 60, 60, 'LC 214/2025, Art. 138', null, null),
  ('200039', '200', 'Alíquota reduzida em 60%', 'Fornecimento dos bens e serviços relacionados com produções nacionais artísticas, culturais, de eventos, jornalísticas e audiovisuais (Anexo X)', 'Padrão', 60, 60, 'LC 214/2025, Art. 139', null, null),
  ('200043', '200', 'Alíquota reduzida em 60%', 'Fornecimento à administração pública dos serviços e dos bens relativos à soberania (Anexo XI)', 'Padrão', 60, 60, 'LC 214/2025, Art. 142, I', null, null),
  ('200047', '200', 'Alíquota reduzida em 40%', 'Bares e Restaurantes', 'Padrão', 40, 40, 'LC 214/2025, Art. 275', null, null),
  ('200053', '200', 'Alíquota zero', 'Fornecimento de medicamentos registrados na Anvisa, quando classificados como soros ou vacinas', 'Padrão', 100, 100, 'LC 214/2025, Art. 146, § 1º, III', null, null),
  ('200054', '200', 'Alíquota zero', 'Fornecimento de bem material pela cooperativa de produção agropecuária a associado não sujeito ao regime regular do IBS e da CBS', 'Padrão', 100, 100, 'LC 214/2025, Art. 271, § 1º, II', null, null),
  ('410001', '410', 'Imunidade e não incidência', 'Fornecimento de bonificações quando constem no documento fiscal e que não dependam de evento posterior', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 5º, § 1º, I', null, null),
  ('410002', '410', 'Imunidade e não incidência', 'Transferências entre estabelecimentos pertencentes ao mesmo contribuinte', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 6º, II', null, null),
  ('410003', '410', 'Imunidade e não incidência', 'Doações sem contraprestação em benefício do doador', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 6º, VIII', null, null),
  ('410004', '410', 'Imunidade e não incidência', 'Exportações de bens e serviços', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 8º', null, null),
  ('410005', '410', 'Imunidade e não incidência', 'Fornecimentos realizados pela União, pelos Estados, pelo Distrito Federal e pelos Municípios', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 9º, I e § 1º', null, null),
  ('410006', '410', 'Imunidade e não incidência', 'Fornecimentos realizados por entidades religiosas e templos de qualquer culto', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 9º, II', null, null),
  ('410007', '410', 'Imunidade e não incidência', 'Fornecimentos realizados por partidos políticos, entidades sindicais e instituições de educação e de assistência social', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 9º, III', null, null),
  ('410008', '410', 'Imunidade e não incidência', 'Fornecimentos de livros, jornais, periódicos e do papel destinado a sua impressão', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 9º, IV', null, null),
  ('410009', '410', 'Imunidade e não incidência', 'Fornecimentos de fonogramas e videofonogramas musicais produzidos no Brasil', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 9º, V', null, null),
  ('410012', '410', 'Imunidade e não incidência', 'Fornecimento de condomínio edilício não optante pelo regime regular', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 26, § 2º, II', null, null),
  ('410013', '410', 'Imunidade e não incidência', 'Exportações de combustíveis', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 98', null, null),
  ('410014', '410', 'Imunidade e não incidência', 'Fornecimento de produtor rural não contribuinte', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 164', null, null),
  ('410016', '410', 'Imunidade e não incidência', 'Fornecimento ou aquisição de resíduos sólidos', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 170', null, null),
  ('410017', '410', 'Imunidade e não incidência', 'Aquisição de bem móvel com crédito presumido sob condição de revenda realizada', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 171', null, null),
  ('410019', '410', 'Imunidade e não incidência', 'Exclusão da gorjeta na base de cálculo no fornecimento de alimentação', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 274, I', null, null),
  ('410020', '410', 'Imunidade e não incidência', 'Exclusão do valor de intermediação na base de cálculo no fornecimento de alimentação', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 274, II', null, null),
  ('410022', '410', 'Imunidade e não incidência', 'Consolidação da propriedade do bem pelo credor', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 200, I', null, null),
  ('410023', '410', 'Imunidade e não incidência', 'Alienação de bens móveis ou imóveis que tenham sido objeto de garantia em que o prestador da garantia não seja contribuinte', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 200, II, a', null, null),
  ('410024', '410', 'Imunidade e não incidência', 'Consolidação da propriedade do bem pelo grupo de consórcio', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 204, § 3º, I', null, null),
  ('410025', '410', 'Imunidade e não incidência', 'Alienação de bem que tenha sido objeto de garantia em que o prestador da garantia não seja contribuinte', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 204, § 3º II, a', null, null),
  ('410026', '410', 'Imunidade e não incidência', 'Doação com anulação de crédito', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 6º, § 2º II', null, null),
  ('410027', '410', 'Imunidade e não incidência', 'Exportação de serviço ou de bem imaterial', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 80 II', null, null),
  ('410029', '410', 'Imunidade e não incidência', 'Operações acobertadas somente pelo ICMS', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 4º', null, null),
  ('410030', '410', 'Imunidade e não incidência', 'Estorno de crédito por perecimento, deteriorização, roubo, furto ou extravio.', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 47, § 6º', null, null),
  ('410031', '410', 'Imunidade e não incidência', 'Fornecimento em período anterior ao início de vigência de incidências de CBS e IBS', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 544, VI', null, null),
  ('410035', '410', 'Imunidade e não incidência', 'Fornecimento realizado por nanoempreendedor', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 26, IV', null, null),
  ('410999', '410', 'Imunidade e não incidência', 'Operações não onerosas sem previsão de tributação, não especificadas anteriormente', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 4º, § 1º', null, null),
  ('510001', '510', 'Diferimento', 'Operações, sujeitas a diferimento, com energia elétrica, relativas à importação, geração, comercialização, distribuição e transmissão', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 28, § 1º', null, null),
  ('515001', '515', 'Diferimento com redução de alíquota', 'Operações, sujeitas a diferimento, com insumos agropecuários e aquícolas (Anexo IX)', 'Padrão', 60, 60, 'LC 214/2025, Art. 138, § 2º', null, null),
  ('550001', '550', 'Suspensão', 'Exportações de bens materiais', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 82', null, null),
  ('550003', '550', 'Suspensão', 'Regimes de Depósito (art. 85)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 85', null, null),
  ('550004', '550', 'Suspensão', 'Regimes de Depósito (art. 87)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 87', null, null),
  ('550005', '550', 'Suspensão', 'Regimes de Depósito (art. 87, Parágrafo único)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 87, parágrafo único', null, null),
  ('550006', '550', 'Suspensão', 'Regimes de Permanência Temporária com suspensão total', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 88', null, null),
  ('550007', '550', 'Suspensão', 'Regimes de Aperfeiçoamento (Recof)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 90', null, null),
  ('550008', '550', 'Suspensão', 'Importação de bens para o Regime de Repetro-Temporário', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 93, I', null, null),
  ('550009', '550', 'Suspensão', 'GNL-Temporário', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 93, II', null, null),
  ('550010', '550', 'Suspensão', 'Repetro-Permanente', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 93, III', null, null),
  ('550011', '550', 'Suspensão', 'Repetro-Industrialização', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 93, IV e Art. 93, § 4º', null, null),
  ('550012', '550', 'Suspensão', 'Repetro-Nacional', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 93, V', null, null),
  ('550013', '550', 'Suspensão', 'Repetro-Entreposto', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 93, VI', null, null),
  ('550014', '550', 'Suspensão', 'Zona de Processamento de Exportação', 'Sem alíquota', 0, 0, 'LC 214/2025, Arts. 99 e 100', null, null),
  ('550015', '550', 'Suspensão', 'Regime Tributário para Incentivo à Modernização e à Ampliação da Estrutura Portuária', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 105', null, null),
  ('550016', '550', 'Suspensão', 'Regime Especial de Incentivos para o Desenvolvimento da Infraestrutura', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 106', null, null),
  ('550017', '550', 'Suspensão', 'Regime Tributário para Incentivo à Atividade Naval - Renaval (Art. 107, I)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 107, I', null, null),
  ('550018', '550', 'Suspensão', 'Desoneração da aquisição de bens de capital', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 109', null, null),
  ('550019', '550', 'Suspensão', 'Importação de bem material por indústria incentivada para utilização na ZFM', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 443', null, null),
  ('550020', '550', 'Suspensão', 'Áreas de livre comércio', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 461', null, null),
  ('550021', '550', 'Suspensão', 'Industrialização destinada a exportações', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 82, § 11', null, null),
  ('550022', '550', 'Suspensão', 'Regime Especial de Incentivos para a Produção de Hidrogênio de Baixa Emissão de Carbono (Rehidro)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 106, § 7º', null, null),
  ('550023', '550', 'Suspensão', 'Operações com hidrocarbonetos líquidos derivados de petróleo não combustíveis ou de gás natural, inclusive nafta', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 172, § 2º', null, null),
  ('550026', '550', 'Suspensão', 'Regimes de admissão temporária com suspensão total do pagamento dos tributos (ZFM)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 89, § 3º, II', null, null),
  ('550027', '550', 'Suspensão', 'Regimes de Aperfeiçoamento (Drawback)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 90', null, null),
  ('550028', '550', 'Suspensão', 'Regimes de Aperfeiçoamento (Admissão temporária)', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 90', null, null),
  ('550029', '550', 'Suspensão', 'Zona de Processamento de Exportação', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 102', null, null),
  ('620001', '620', 'Tributação monofásica', 'Tributação monofásica sobre combustíveis', 'Uniforme setorial', 0, 0, 'LC 214/2025, Art. 172', null, null),
  ('620002', '620', 'Tributação monofásica', 'Tributação monofásica com responsabilidade pela retenção sobre combustíveis', 'Uniforme setorial', 0, 0, 'LC 214/2025, Art. 178', null, null),
  ('620003', '620', 'Tributação monofásica', 'Tributação monofásica com responsabilidade de retenção de tributos por terceiros', 'Uniforme setorial', 0, 0, 'LC 214/2025, Art. 178', null, null),
  ('620004', '620', 'Tributação monofásica', 'Tributação monofásica sobre mistura de EAC com gasolina A em percentual superior ao obrigatório', 'Uniforme setorial', 0, 0, 'LC 214/2025, Art. 179, II, a', null, null),
  ('620005', '620', 'Tributação monofásica', 'Tributação monofásica sobre mistura de EAC com gasolina A em percentual inferior ao obrigatório', 'Uniforme setorial', 0, 0, 'LC 214/2025, Art. 179, II, b', null, null),
  ('620006', '620', 'Tributação monofásica', 'Tributação monofásica sobre combustíveis cobrada anteriormente', 'Uniforme setorial', 0, 0, 'LC 214/2025, Art. 180', null, null),
  ('620007', '620', 'Tributação monofásica', 'Perecimento, deteriorização, roubo, furto ou extravio no regime monofásico', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 47, § 6º', null, null),
  ('800001', '800', 'Transferência de crédito', 'Fusão, cisão ou incorporação', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 55', null, null),
  ('800002', '800', 'Transferência de crédito', 'Transferência de crédito do associado, inclusive as cooperativas singulares', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 272', null, null),
  ('810001', '810', 'Ajuste de IBS na ZFM', 'Crédito presumido de IBS sobre o valor apurado nos fornecimentos a partir da ZFM', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 450, § 1º', null, null),
  ('811001', '811', 'Ajustes', 'Anulação de Crédito por Saídas Imunes/Isentas', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 51', null, null),
  ('811002', '811', 'Ajustes', 'Débitos de notas fiscais não processadas na apuração', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 45', null, null),
  ('811003', '811', 'Ajustes', 'Desenquadramento do Simples Nacional', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 41', null, null),
  ('830001', '830', 'Exclusão de base de cálculo', 'Documento com exclusão da BC da CBS e do IBS de energia elétrica fornecida pela distribuidora à UC', 'Sem alíquota', 0, 0, 'LC 214/2025, Art. 28, parágrafos 3° e 4°', null, null);

alter table public.nfe_cclass_trib enable row level security;
create policy nfe_cclass_trib_leitura on public.nfe_cclass_trib for select to authenticated using (true);
grant select on public.nfe_cclass_trib to authenticated;
grant select, insert, update, delete on public.nfe_cclass_trib to service_role;

-- -----------------------------------------------------------------------------
-- 3. Configuração e cadastros
-- -----------------------------------------------------------------------------
create table public.nfe_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativa boolean not null default false,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  -- 1 Simples Nacional; 2 Simples com excesso de sublimite; 3 regime normal; 4 MEI
  crt smallint not null default 3 check (crt in (1, 2, 3, 4)),
  -- Indicador de presença do comprador (0 não se aplica; 1 presencial; 2 internet; 3 teleatendimento; 4 entrega em domicílio; 5 presencial fora; 9 outros)
  presenca smallint not null default 9 check (presenca in (0, 1, 2, 3, 4, 5, 9)),
  -- FUNRURAL/SENAR do produtor rural (informado na nota)
  funrural_percentual numeric(5, 2) check (funrural_percentual is null or funrural_percentual between 0 and 10),
  funrural_modo text check (funrural_modo is null or funrural_modo in ('retido_adquirente', 'recolhido_produtor')),
  enviar_email_destinatario boolean not null default true,
  -- autXML: autoriza o escritório (CNPJ) a baixar o XML da nota na SEFAZ
  autorizar_escritorio_xml boolean not null default true,
  informacoes_padrao text check (informacoes_padrao is null or length(informacoes_padrao) <= 2000),
  -- Autorização do cliente para o portal emitir notas com o certificado da empresa
  autorizacao_texto text check (autorizacao_texto is null or length(autorizacao_texto) between 10 and 2000),
  autorizado_por uuid references public.perfis(id) on delete set null,
  autorizado_em timestamptz,
  atualizado_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_config_ativa_completa check (not ativa or (autorizacao_texto is not null and autorizado_em is not null)),
  constraint nfe_config_funrural check ((funrural_percentual is null) = (funrural_modo is null))
);
create trigger nfe_config_updated_at before update on public.nfe_config for each row execute function app.tg_updated_at();
create trigger auditoria_nfe_config after insert or update or delete on public.nfe_config for each row execute function app.tg_auditoria();

-- Quem emite: a inscrição estadual (estabelecimento da empresa ou propriedade do produtor), com série e numeração próprias
create table public.nfe_emitentes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  inscricao_estadual text not null check (inscricao_estadual ~ '^[0-9]{2,14}$'),
  logradouro text not null check (length(trim(logradouro)) between 2 and 60),
  numero text not null check (length(trim(numero)) between 1 and 60),
  complemento text check (complemento is null or length(complemento) <= 60),
  bairro text not null check (length(trim(bairro)) between 2 and 60),
  municipio_ibge text not null references public.municipios(ibge),
  cep text not null check (cep ~ '^[0-9]{8}$'),
  telefone text check (telefone is null or telefone ~ '^[0-9]{6,14}$'),
  serie int not null check (serie between 0 and 969),
  proximo_numero_homologacao bigint not null default 1 check (proximo_numero_homologacao between 1 and 999999999),
  proximo_numero_producao bigint not null default 1 check (proximo_numero_producao between 1 and 999999999),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_emitentes_serie_uk unique (empresa_id, serie)
);
create trigger nfe_emitentes_updated_at before update on public.nfe_emitentes for each row execute function app.tg_updated_at();
create trigger auditoria_nfe_emitentes after insert or update or delete on public.nfe_emitentes for each row execute function app.tg_auditoria();

create table public.nfe_produtos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null check (length(trim(codigo)) between 1 and 60),
  descricao text not null check (length(trim(descricao)) between 2 and 120),
  ncm text not null check (ncm ~ '^[0-9]{8}$'),
  cest text check (cest is null or cest ~ '^[0-9]{7}$'),
  gtin text check (gtin is null or gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  unidade text not null check (length(trim(unidade)) between 1 and 6),
  -- Peso de uma unidade em kg (volumes da nota e contribuições por tonelada, como o FETHAB)
  peso_kg numeric(15, 4) check (peso_kg is null or peso_kg > 0),
  valor_unitario numeric(21, 10) check (valor_unitario is null or valor_unitario >= 0),
  -- Origem da mercadoria (tabela A do CST): 0 nacional; 1, 2, 3 e 8 com importação...
  origem smallint not null default 0 check (origem between 0 and 8),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_produtos_codigo_uk unique (empresa_id, codigo)
);
create trigger nfe_produtos_updated_at before update on public.nfe_produtos for each row execute function app.tg_updated_at();

-- Operações (natureza da operação) com as regras fiscais, cadastradas pelo escritório
create table public.nfe_operacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 80),
  natureza text not null check (length(trim(natureza)) between 2 and 60),
  -- 1 normal; 2 complementar; 3 ajuste; 4 devolução
  finalidade smallint not null default 1 check (finalidade in (1, 2, 3, 4)),
  destino text not null check (destino in ('interna', 'interestadual', 'exterior')),
  consumidor_final boolean not null default false,
  cfop text not null check (cfop ~ '^[5-7][0-9]{3}$'),
  icms_cst text not null check (icms_cst in ('00', '20', '40', '41', '50', '51', '90', '101', '102', '103', '300', '400', '900')),
  icms_aliquota numeric(7, 4) check (icms_aliquota is null or icms_aliquota between 0 and 100),
  icms_reducao numeric(7, 4) check (icms_reducao is null or icms_reducao between 0 and 100),
  icms_diferimento numeric(7, 4) check (icms_diferimento is null or icms_diferimento between 0 and 100),
  icms_credito_sn numeric(7, 4) check (icms_credito_sn is null or icms_credito_sn between 0 and 100),
  icms_beneficio text check (icms_beneficio is null or icms_beneficio ~ '^([!-ÿ]{8}|[!-ÿ]{10}|SEM CBENEF)$'),
  pis_cst text not null check (pis_cst ~ '^[0-9]{2}$'),
  pis_aliquota numeric(7, 4) check (pis_aliquota is null or pis_aliquota between 0 and 100),
  cofins_cst text not null check (cofins_cst ~ '^[0-9]{2}$'),
  cofins_aliquota numeric(7, 4) check (cofins_aliquota is null or cofins_aliquota between 0 and 100),
  excluir_icms_pis_cofins boolean not null default true,
  -- IBS/CBS (obrigatórios no regime normal desde 03/08/2026)
  ibscbs_cclass_trib text references public.nfe_cclass_trib(cclass_trib),
  ibscbs_diferimento numeric(7, 4) check (ibscbs_diferimento is null or ibscbs_diferimento between 0 and 100),
  -- DIFAL na venda a não contribuinte de outro estado
  difal_metodo text check (difal_metodo is null or difal_metodo in ('base_unica', 'base_dupla')),
  difal_codigo_receita text check (difal_codigo_receita is null or length(difal_codigo_receita) <= 20),
  -- ICMS pago a cada operação, antes da saída (ex.: MT, RICMS art. 132), e não na apuração do mês
  icms_por_operacao boolean not null default false,
  icms_codigo_receita text check (icms_codigo_receita is null or length(icms_codigo_receita) <= 20),
  -- ICMS do frete retido pelo remetente (autônomo ou transportadora que não recolhe)
  frete_icms_retido boolean not null default false,
  frete_aliquota numeric(7, 4) check (frete_aliquota is null or frete_aliquota between 0 and 100),
  frete_reducao numeric(7, 4) check (frete_reducao is null or frete_reducao between 0 and 100),
  frete_cfop text check (frete_cfop is null or frete_cfop ~ '^[56](35[1-9]|360)$'),
  frete_codigo_receita text check (frete_codigo_receita is null or length(frete_codigo_receita) <= 20),
  incide_funrural boolean not null default false,
  -- [{nome, tipo: upf_por_tonelada|valor_por_tonelada|percentual_valor, valor, valorUpf, ncms[], codigoReceita}]
  contribuicoes jsonb not null default '[]'::jsonb check (jsonb_typeof(contribuicoes) = 'array' and jsonb_array_length(contribuicoes) <= 10),
  informacoes text check (informacoes is null or length(informacoes) <= 2000),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_operacoes_cfop_destino check (
    (destino = 'interna' and cfop like '5%') or (destino = 'interestadual' and cfop like '6%') or (destino = 'exterior' and cfop like '7%')
  ),
  constraint nfe_operacoes_icms check (
    (icms_cst not in ('00', '20', '51') or icms_aliquota is not null)
    and (icms_cst <> '20' or coalesce(icms_reducao, 0) > 0)
    and (icms_cst <> '101' or icms_credito_sn is not null)
  ),
  constraint nfe_operacoes_pis check (pis_cst not in ('01', '02') or pis_aliquota is not null),
  constraint nfe_operacoes_cofins check (cofins_cst not in ('01', '02') or cofins_aliquota is not null),
  constraint nfe_operacoes_frete check (not frete_icms_retido or (frete_aliquota is not null and frete_cfop is not null)),
  constraint nfe_operacoes_difal check (difal_metodo is null or destino = 'interestadual')
);
create trigger nfe_operacoes_updated_at before update on public.nfe_operacoes for each row execute function app.tg_updated_at();
create trigger auditoria_nfe_operacoes after insert or update or delete on public.nfe_operacoes for each row execute function app.tg_auditoria();

-- Clientes (compradores) da empresa
create table public.nfe_destinatarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cnpj', 'cpf', 'estrangeiro')),
  documento text check (documento is null or length(documento) <= 20),
  nome text not null check (length(trim(nome)) between 2 and 60),
  -- 1 contribuinte do ICMS; 2 contribuinte isento; 9 não contribuinte
  indicador_ie smallint not null check (indicador_ie in (1, 2, 9)),
  inscricao_estadual text check (inscricao_estadual is null or inscricao_estadual ~ '^[0-9]{2,14}$'),
  logradouro text not null check (length(trim(logradouro)) between 2 and 60),
  numero text not null check (length(trim(numero)) between 1 and 60),
  complemento text check (complemento is null or length(complemento) <= 60),
  bairro text not null check (length(trim(bairro)) between 1 and 60),
  municipio_ibge text references public.municipios(ibge),
  codigo_pais text check (codigo_pais is null or codigo_pais ~ '^[0-9]{1,4}$'),
  pais text check (pais is null or length(pais) <= 60),
  cidade_exterior text check (cidade_exterior is null or length(cidade_exterior) <= 60),
  cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  telefone text check (telefone is null or telefone ~ '^[0-9]{6,14}$'),
  email text check (email is null or (length(email) <= 60 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_destinatarios_documento check (
    (tipo = 'cpf' and documento ~ '^[0-9]{11}$')
    or (tipo = 'cnpj' and documento ~ '^[0-9A-Z]{12}[0-9]{2}$')
    or (tipo = 'estrangeiro' and indicador_ie = 9 and municipio_ibge is null and codigo_pais is not null and cidade_exterior is not null)
  ),
  constraint nfe_destinatarios_endereco check (tipo = 'estrangeiro' or municipio_ibge is not null),
  constraint nfe_destinatarios_ie check ((indicador_ie = 1) = (inscricao_estadual is not null))
);
create unique index nfe_destinatarios_documento_uk on public.nfe_destinatarios (empresa_id, tipo, documento) where documento is not null;
create trigger nfe_destinatarios_updated_at before update on public.nfe_destinatarios for each row execute function app.tg_updated_at();

create table public.nfe_transportadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cnpj', 'cpf')),
  documento text not null,
  nome text not null check (length(trim(nome)) between 2 and 60),
  inscricao_estadual text check (inscricao_estadual is null or inscricao_estadual ~ '^([0-9]{2,14}|ISENTO)$'),
  endereco text check (endereco is null or length(endereco) <= 60),
  municipio text check (municipio is null or length(municipio) <= 60),
  uf char(2) check (uf is null or uf ~ '^[A-Z]{2}$'),
  placa text check (placa is null or placa ~ '^([A-Z]{2,3}[0-9]{4}|[A-Z]{3,4}[0-9]{3}|[A-Z0-9]{7})$'),
  placa_uf char(2) check (placa_uf is null or placa_uf ~ '^[A-Z]{2}$'),
  rntc text check (rntc is null or length(rntc) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_transportadores_documento check ((tipo = 'cpf' and documento ~ '^[0-9]{11}$') or (tipo = 'cnpj' and documento ~ '^[0-9A-Z]{12}[0-9]{2}$')),
  constraint nfe_transportadores_uk unique (empresa_id, documento)
);
create trigger nfe_transportadores_updated_at before update on public.nfe_transportadores for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Notas, eventos e guias
-- -----------------------------------------------------------------------------
create table public.nfe_emissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  emitente_id uuid not null references public.nfe_emitentes(id) on delete restrict,
  operacao_id uuid references public.nfe_operacoes(id) on delete set null,
  destinatario_id uuid references public.nfe_destinatarios(id) on delete set null,
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  serie int not null check (serie between 0 and 969),
  numero bigint not null check (numero between 1 and 999999999),
  codigo_numerico text not null check (codigo_numerico ~ '^[0-9]{8}$'),
  -- na_fila → enviando → autorizada | rejeitada | denegada | falha (sem resposta: tenta de novo) | aguardando (recibo em processamento)
  -- autorizada → cancelando → cancelada; rejeitada → (corrigida) na_fila | descartada
  situacao text not null default 'na_fila'
    check (situacao in ('na_fila', 'enviando', 'aguardando', 'autorizada', 'rejeitada', 'denegada', 'falha', 'cancelando', 'cancelada', 'descartada')),
  -- Dados da nota com as regras fiscais da operação (montados pelo banco no pedido)
  dados jsonb not null check (jsonb_typeof(dados) = 'object' and pg_column_size(dados) <= 500000),
  natureza text not null,
  destinatario_nome text not null,
  destinatario_documento text,
  destinatario_uf char(2),
  valor_total numeric(15, 2) not null check (valor_total >= 0),
  -- Preenchidos no envio
  emitida_em timestamptz,
  chave text check (chave is null or chave ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'),
  recibo text check (recibo is null or recibo ~ '^[0-9]{15}$'),
  totais jsonb check (totais is null or jsonb_typeof(totais) = 'object'),
  xml_assinado text check (xml_assinado is null or length(xml_assinado) <= 1000000),
  -- Retorno da SEFAZ
  protocolo text check (protocolo is null or protocolo ~ '^[0-9]{15}$'),
  autorizada_em timestamptz,
  xml_autorizado text check (xml_autorizado is null or length(xml_autorizado) <= 1100000),
  documento_id uuid references public.documentos(id) on delete set null,
  mensagens jsonb check (mensagens is null or (jsonb_typeof(mensagens) = 'array' and pg_column_size(mensagens) <= 20000)),
  tentativas int not null default 0,
  ultimo_envio_em timestamptz,
  email_destinatario_enviado_em timestamptz,
  cancelada_em timestamptz,
  descartada_em timestamptz,
  pedido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_emissoes_numero_uk unique (empresa_id, ambiente, serie, numero),
  constraint nfe_emissoes_autorizada check (situacao not in ('autorizada', 'cancelando', 'cancelada') or (chave is not null and protocolo is not null and xml_autorizado is not null))
);
create unique index nfe_emissoes_chave_uk on public.nfe_emissoes (chave) where chave is not null and situacao not in ('rejeitada', 'descartada');
create index nfe_emissoes_empresa_idx on public.nfe_emissoes (empresa_id, created_at desc);
create index nfe_emissoes_pendentes_idx on public.nfe_emissoes (situacao) where situacao in ('na_fila', 'enviando', 'aguardando', 'falha', 'cancelando');
create trigger nfe_emissoes_updated_at before update on public.nfe_emissoes for each row execute function app.tg_updated_at();

create table public.nfe_eventos (
  id uuid primary key default gen_random_uuid(),
  emissao_id uuid not null references public.nfe_emissoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('cancelamento', 'carta_correcao')),
  sequencia smallint not null check (sequencia between 1 and 20),
  texto text not null check (length(trim(texto)) between 15 and 1000),
  situacao text not null default 'na_fila' check (situacao in ('na_fila', 'enviando', 'registrado', 'rejeitado', 'falha')),
  protocolo text check (protocolo is null or protocolo ~ '^[0-9]{15}$'),
  registrado_em timestamptz,
  xml text check (xml is null or length(xml) <= 200000),
  mensagens jsonb check (mensagens is null or (jsonb_typeof(mensagens) = 'array' and pg_column_size(mensagens) <= 20000)),
  tentativas int not null default 0,
  pedido_por uuid references public.perfis(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_eventos_seq_uk unique (emissao_id, tipo, sequencia)
);
create index nfe_eventos_emissao_idx on public.nfe_eventos (emissao_id, created_at);
create trigger nfe_eventos_updated_at before update on public.nfe_eventos for each row execute function app.tg_updated_at();

create table public.nfe_guias (
  id uuid primary key default gen_random_uuid(),
  emissao_id uuid not null references public.nfe_emissoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('icms_operacao', 'icms_frete', 'difal', 'fcp_difal', 'contribuicao')),
  descricao text not null check (length(descricao) <= 200),
  uf char(2) not null check (uf ~ '^[A-Z]{2}$'),
  codigo_receita text check (codigo_receita is null or length(codigo_receita) <= 20),
  valor numeric(15, 2) not null check (valor > 0),
  vencimento date not null,
  -- a_gerar: o escritório (ou o cliente) gera a guia no site oficial; gerada: PDF anexado (vai para a agenda); dispensada: não se aplica
  situacao text not null default 'a_gerar' check (situacao in ('a_gerar', 'gerada', 'dispensada')),
  documento_id uuid,
  observacao text check (observacao is null or length(observacao) <= 500),
  atualizado_por uuid references public.perfis(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nfe_guias_documento_fk foreign key (empresa_id, documento_id) references public.documentos (empresa_id, id) on delete set null (documento_id),
  constraint nfe_guias_tipo_uk unique (emissao_id, tipo, descricao)
);
create index nfe_guias_empresa_idx on public.nfe_guias (empresa_id, situacao, vencimento);
create trigger nfe_guias_updated_at before update on public.nfe_guias for each row execute function app.tg_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Acesso: leitura por quem emite ou configura; escrita só pelas funções
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['nfe_config', 'nfe_emitentes', 'nfe_produtos', 'nfe_operacoes', 'nfe_destinatarios', 'nfe_transportadores', 'nfe_emissoes', 'nfe_eventos', 'nfe_guias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.pode(empresa_id, ''nfe.emitir'')) or (select app.pode(empresa_id, ''nfe.configurar'')))',
      t || '_leitura', t
    );
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Funções do escritório: configuração, emitentes, produtos e operações
-- -----------------------------------------------------------------------------
create or replace function public.nfe_configurar(p_empresa_id uuid, p_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual public.nfe_config;
  v_ambiente text := coalesce(p_dados ->> 'ambiente', 'homologacao');
  v_ativa boolean := coalesce((p_dados ->> 'ativa')::boolean, false);
  v_aut text := nullif(trim(p_dados ->> 'autorizacao_texto'), '');
  v_func numeric := nullif(p_dados ->> 'funrural_percentual', '')::numeric;
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  if exists (select 1 from public.empresas where id = p_empresa_id and demonstracao) and v_ativa and v_ambiente = 'producao' then
    raise exception 'Empresa de demonstração não emite notas em produção.';
  end if;
  select * into v_atual from public.nfe_config where empresa_id = p_empresa_id;
  if v_ativa then
    if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
      raise exception 'Cadastre o certificado digital A1 da empresa (válido) antes de ligar a emissão.';
    end if;
    if not exists (select 1 from public.nfe_emitentes e where e.empresa_id = p_empresa_id and e.ativo) then
      raise exception 'Cadastre a inscrição estadual de quem emite (com a série) antes de ligar a emissão.';
    end if;
    if not exists (select 1 from public.nfe_operacoes o where o.empresa_id = p_empresa_id and o.ativa) then
      raise exception 'Cadastre ao menos uma operação (natureza, CFOP e impostos) antes de ligar a emissão.';
    end if;
    if coalesce(v_aut, v_atual.autorizacao_texto) is null then
      raise exception 'Registre como o cliente autorizou o portal a emitir notas com o certificado da empresa.';
    end if;
  end if;
  insert into public.nfe_config as c (
    empresa_id, ativa, ambiente, crt, presenca, funrural_percentual, funrural_modo, enviar_email_destinatario,
    autorizar_escritorio_xml, informacoes_padrao, autorizacao_texto, autorizado_por, autorizado_em, atualizado_por
  ) values (
    p_empresa_id, v_ativa, v_ambiente,
    coalesce((p_dados ->> 'crt')::smallint, 3), coalesce((p_dados ->> 'presenca')::smallint, 9),
    v_func, case when v_func is not null then coalesce(nullif(p_dados ->> 'funrural_modo', ''), 'retido_adquirente') end,
    coalesce((p_dados ->> 'enviar_email_destinatario')::boolean, true),
    coalesce((p_dados ->> 'autorizar_escritorio_xml')::boolean, true),
    nullif(trim(p_dados ->> 'informacoes_padrao'), ''),
    coalesce(v_aut, v_atual.autorizacao_texto),
    case when v_aut is not null then auth.uid() else v_atual.autorizado_por end,
    case when v_aut is not null then now() else v_atual.autorizado_em end,
    auth.uid()
  )
  on conflict (empresa_id) do update set
    ativa = excluded.ativa,
    ambiente = excluded.ambiente,
    crt = excluded.crt,
    presenca = excluded.presenca,
    funrural_percentual = excluded.funrural_percentual,
    funrural_modo = excluded.funrural_modo,
    enviar_email_destinatario = excluded.enviar_email_destinatario,
    autorizar_escritorio_xml = excluded.autorizar_escritorio_xml,
    informacoes_padrao = excluded.informacoes_padrao,
    autorizacao_texto = excluded.autorizacao_texto,
    autorizado_por = excluded.autorizado_por,
    autorizado_em = excluded.autorizado_em,
    atualizado_por = auth.uid();
end;
$$;

create or replace function public.nfe_emitente_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_emp public.empresas;
  v_serie int := (p_dados ->> 'serie')::int;
  v_mun text := p_dados ->> 'municipio_ibge';
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  select * into v_emp from public.empresas where id = p_empresa_id;
  if v_emp.tipo_pessoa = 'PF' and (v_serie is null or v_serie not between 920 and 969) then
    raise exception 'Produtor rural pessoa física emite NF-e nas séries 920 a 969.';
  end if;
  if v_emp.tipo_pessoa = 'PJ' and (v_serie is null or v_serie not between 0 and 889) then
    raise exception 'Série da NF-e inválida (0 a 889).';
  end if;
  if not exists (select 1 from public.municipios where ibge = v_mun) then
    raise exception 'Município não encontrado.';
  end if;
  if p_id is null then
    insert into public.nfe_emitentes (empresa_id, nome, inscricao_estadual, logradouro, numero, complemento, bairro, municipio_ibge, cep, telefone, serie,
                                      proximo_numero_homologacao, proximo_numero_producao, ativo)
    values (p_empresa_id, trim(p_dados ->> 'nome'), regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'),
            trim(p_dados ->> 'logradouro'), trim(p_dados ->> 'numero'), nullif(trim(p_dados ->> 'complemento'), ''), trim(p_dados ->> 'bairro'),
            v_mun, regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'),
            nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''), v_serie,
            coalesce((p_dados ->> 'proximo_numero_homologacao')::bigint, 1), coalesce((p_dados ->> 'proximo_numero_producao')::bigint, 1),
            coalesce((p_dados ->> 'ativo')::boolean, true))
    returning id into v_id;
  else
    update public.nfe_emitentes
       set nome = trim(p_dados ->> 'nome'),
           inscricao_estadual = regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'),
           logradouro = trim(p_dados ->> 'logradouro'),
           numero = trim(p_dados ->> 'numero'),
           complemento = nullif(trim(p_dados ->> 'complemento'), ''),
           bairro = trim(p_dados ->> 'bairro'),
           municipio_ibge = v_mun,
           cep = regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'),
           telefone = nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
           serie = v_serie,
           -- A numeração só anda para a frente (números já usados não voltam)
           proximo_numero_homologacao = greatest(proximo_numero_homologacao, coalesce((p_dados ->> 'proximo_numero_homologacao')::bigint, 1)),
           proximo_numero_producao = greatest(proximo_numero_producao, coalesce((p_dados ->> 'proximo_numero_producao')::bigint, 1)),
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Inscrição não encontrada.';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.nfe_produto_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  if p_id is null then
    insert into public.nfe_produtos (empresa_id, codigo, descricao, ncm, cest, gtin, unidade, peso_kg, valor_unitario, origem, ativo)
    values (p_empresa_id, trim(p_dados ->> 'codigo'), trim(p_dados ->> 'descricao'), regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
            nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
            upper(trim(p_dados ->> 'unidade')), nullif(p_dados ->> 'peso_kg', '')::numeric, nullif(p_dados ->> 'valor_unitario', '')::numeric,
            coalesce((p_dados ->> 'origem')::smallint, 0), coalesce((p_dados ->> 'ativo')::boolean, true))
    returning id into v_id;
  else
    update public.nfe_produtos
       set codigo = trim(p_dados ->> 'codigo'),
           descricao = trim(p_dados ->> 'descricao'),
           ncm = regexp_replace(coalesce(p_dados ->> 'ncm', ''), '\D', '', 'g'),
           cest = nullif(regexp_replace(coalesce(p_dados ->> 'cest', ''), '\D', '', 'g'), ''),
           gtin = nullif(regexp_replace(coalesce(p_dados ->> 'gtin', ''), '\D', '', 'g'), ''),
           unidade = upper(trim(p_dados ->> 'unidade')),
           peso_kg = nullif(p_dados ->> 'peso_kg', '')::numeric,
           valor_unitario = nullif(p_dados ->> 'valor_unitario', '')::numeric,
           origem = coalesce((p_dados ->> 'origem')::smallint, 0),
           ativo = coalesce((p_dados ->> 'ativo')::boolean, true)
     where id = p_id and empresa_id = p_empresa_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Produto não encontrado.';
    end if;
  end if;
  return v_id;
end;
$$;

-- Contribuições estaduais: só os campos conhecidos, com tipos conferidos
create or replace function app.nfe_contribuicoes_validas(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  c jsonb;
  r jsonb := '[]'::jsonb;
  v_tipo text;
  v_valor numeric;
  v_upf numeric;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return '[]'::jsonb;
  end if;
  for c in select * from jsonb_array_elements(p) loop
    v_tipo := c ->> 'tipo';
    v_valor := nullif(c ->> 'valor', '')::numeric;
    v_upf := nullif(c ->> 'valorUpf', '')::numeric;
    if length(trim(coalesce(c ->> 'nome', ''))) not between 2 and 60 then
      raise exception 'Informe o nome da contribuição (ex.: FETHAB).';
    end if;
    if v_tipo not in ('upf_por_tonelada', 'valor_por_tonelada', 'percentual_valor') then
      raise exception 'Tipo de cálculo da contribuição % inválido.', c ->> 'nome';
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor ou percentual da contribuição %.', c ->> 'nome';
    end if;
    if v_tipo = 'upf_por_tonelada' and (v_upf is null or v_upf <= 0) then
      raise exception 'Informe o valor da UPF para calcular a contribuição %.', c ->> 'nome';
    end if;
    r := r || jsonb_build_array(jsonb_build_object(
      'nome', trim(c ->> 'nome'),
      'tipo', v_tipo,
      'valor', v_valor,
      'valorUpf', v_upf,
      'ncms', coalesce((select jsonb_agg(regexp_replace(x, '\D', '', 'g')) from jsonb_array_elements_text(coalesce(c -> 'ncms', '[]'::jsonb)) x
                         where regexp_replace(x, '\D', '', 'g') <> ''), '[]'::jsonb),
      'codigoReceita', nullif(trim(coalesce(c ->> 'codigoReceita', '')), '')
    ));
  end loop;
  return r;
end;
$$;

create or replace function public.nfe_operacao_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_crt smallint;
  v_cst text := p_dados ->> 'icms_cst';
  v_cclass text := nullif(p_dados ->> 'ibscbs_cclass_trib', '');
  v_contrib jsonb := app.nfe_contribuicoes_validas(p_dados -> 'contribuicoes');
begin
  perform app.exigir(p_empresa_id, 'nfe.configurar');
  select crt into v_crt from public.nfe_config where empresa_id = p_empresa_id;
  if coalesce(v_crt, 3) in (1, 4) and v_cst not in ('101', '102', '103', '300', '400', '900') then
    raise exception 'Empresa do Simples Nacional usa CSOSN (101, 102, 103, 300, 400 ou 900) no ICMS.';
  end if;
  if coalesce(v_crt, 3) in (2, 3) and v_cst not in ('00', '20', '40', '41', '50', '51', '90') then
    raise exception 'Empresa do regime normal usa CST (00, 20, 40, 41, 50, 51 ou 90) no ICMS.';
  end if;
  if coalesce(v_crt, 3) = 3 and v_cclass is null then
    raise exception 'Escolha a classificação do IBS/CBS (obrigatória no regime normal desde 03/08/2026).';
  end if;
  if v_cclass is not null and not exists (select 1 from public.nfe_cclass_trib where cclass_trib = v_cclass) then
    raise exception 'Classificação do IBS/CBS não encontrada na tabela oficial.';
  end if;
  if p_id is not null and not exists (select 1 from public.nfe_operacoes where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Operação não encontrada.';
  end if;
  insert into public.nfe_operacoes as o (id, empresa_id, nome, natureza, finalidade, destino, consumidor_final, cfop, icms_cst, icms_aliquota, icms_reducao, icms_diferimento, icms_credito_sn, icms_beneficio, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, excluir_icms_pis_cofins, ibscbs_cclass_trib, ibscbs_diferimento, difal_metodo, difal_codigo_receita, icms_por_operacao, icms_codigo_receita, frete_icms_retido, frete_aliquota, frete_reducao, frete_cfop, frete_codigo_receita, incide_funrural, contribuicoes, informacoes, ativa)
  values (coalesce(p_id, gen_random_uuid()), p_empresa_id,
          trim(p_dados ->> 'nome'),
          trim(p_dados ->> 'natureza'),
          coalesce((p_dados ->> 'finalidade')::smallint, 1),
          p_dados ->> 'destino',
          coalesce((p_dados ->> 'consumidor_final')::boolean, false),
          regexp_replace(coalesce(p_dados ->> 'cfop', ''), '\D', '', 'g'),
          v_cst,
          nullif(p_dados ->> 'icms_aliquota', '')::numeric,
          nullif(p_dados ->> 'icms_reducao', '')::numeric,
          nullif(p_dados ->> 'icms_diferimento', '')::numeric,
          nullif(p_dados ->> 'icms_credito_sn', '')::numeric,
          nullif(upper(trim(p_dados ->> 'icms_beneficio')), ''),
          p_dados ->> 'pis_cst',
          nullif(p_dados ->> 'pis_aliquota', '')::numeric,
          p_dados ->> 'cofins_cst',
          nullif(p_dados ->> 'cofins_aliquota', '')::numeric,
          coalesce((p_dados ->> 'excluir_icms_pis_cofins')::boolean, true),
          v_cclass,
          nullif(p_dados ->> 'ibscbs_diferimento', '')::numeric,
          nullif(p_dados ->> 'difal_metodo', ''),
          nullif(trim(p_dados ->> 'difal_codigo_receita'), ''),
          coalesce((p_dados ->> 'icms_por_operacao')::boolean, false),
          nullif(trim(p_dados ->> 'icms_codigo_receita'), ''),
          coalesce((p_dados ->> 'frete_icms_retido')::boolean, false),
          nullif(p_dados ->> 'frete_aliquota', '')::numeric,
          nullif(p_dados ->> 'frete_reducao', '')::numeric,
          nullif(regexp_replace(coalesce(p_dados ->> 'frete_cfop', ''), '\D', '', 'g'), ''),
          nullif(trim(p_dados ->> 'frete_codigo_receita'), ''),
          coalesce((p_dados ->> 'incide_funrural')::boolean, false),
          v_contrib,
          nullif(trim(p_dados ->> 'informacoes'), ''),
          coalesce((p_dados ->> 'ativa')::boolean, true))
  on conflict (id) do update set
    nome = excluded.nome,
    natureza = excluded.natureza,
    finalidade = excluded.finalidade,
    destino = excluded.destino,
    consumidor_final = excluded.consumidor_final,
    cfop = excluded.cfop,
    icms_cst = excluded.icms_cst,
    icms_aliquota = excluded.icms_aliquota,
    icms_reducao = excluded.icms_reducao,
    icms_diferimento = excluded.icms_diferimento,
    icms_credito_sn = excluded.icms_credito_sn,
    icms_beneficio = excluded.icms_beneficio,
    pis_cst = excluded.pis_cst,
    pis_aliquota = excluded.pis_aliquota,
    cofins_cst = excluded.cofins_cst,
    cofins_aliquota = excluded.cofins_aliquota,
    excluir_icms_pis_cofins = excluded.excluir_icms_pis_cofins,
    ibscbs_cclass_trib = excluded.ibscbs_cclass_trib,
    ibscbs_diferimento = excluded.ibscbs_diferimento,
    difal_metodo = excluded.difal_metodo,
    difal_codigo_receita = excluded.difal_codigo_receita,
    icms_por_operacao = excluded.icms_por_operacao,
    icms_codigo_receita = excluded.icms_codigo_receita,
    frete_icms_retido = excluded.frete_icms_retido,
    frete_aliquota = excluded.frete_aliquota,
    frete_reducao = excluded.frete_reducao,
    frete_cfop = excluded.frete_cfop,
    frete_codigo_receita = excluded.frete_codigo_receita,
    incide_funrural = excluded.incide_funrural,
    contribuicoes = excluded.contribuicoes,
    informacoes = excluded.informacoes,
    ativa = excluded.ativa
  returning o.id into v_id;
  return v_id;
end;
$$;

-- Clientes e transportadores: quem emite também cadastra
create or replace function public.nfe_destinatario_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tipo text := p_dados ->> 'tipo';
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_ind smallint := (p_dados ->> 'indicador_ie')::smallint;
  v_ie text := nullif(regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '\D', '', 'g'), '');
begin
  perform app.exigir(p_empresa_id, 'nfe.emitir');
  if v_tipo = 'cpf' and (v_doc is null or not app.cpf_valido(v_doc)) then
    raise exception 'CPF do cliente inválido.';
  end if;
  if v_tipo = 'cnpj' and (v_doc is null or not app.cnpj_valido(v_doc)) then
    raise exception 'CNPJ do cliente inválido.';
  end if;
  if v_tipo = 'estrangeiro' then
    v_doc := nullif(trim(coalesce(p_dados ->> 'documento', '')), '');
    v_ind := 9;
  end if;
  if v_ind = 1 and v_ie is null then
    raise exception 'Informe a inscrição estadual do cliente (contribuinte do ICMS).';
  end if;
  if v_ind <> 1 then
    v_ie := null;
  end if;
  if p_id is not null and not exists (select 1 from public.nfe_destinatarios where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  insert into public.nfe_destinatarios as d (id, empresa_id, tipo, documento, nome, indicador_ie, inscricao_estadual, logradouro, numero, complemento, bairro, municipio_ibge, codigo_pais, pais, cidade_exterior, cep, telefone, email)
  values (coalesce(p_id, gen_random_uuid()), p_empresa_id,
          v_tipo,
          v_doc,
          trim(p_dados ->> 'nome'),
          v_ind,
          v_ie,
          trim(p_dados ->> 'logradouro'),
          coalesce(nullif(trim(p_dados ->> 'numero'), ''), 'SN'),
          nullif(trim(p_dados ->> 'complemento'), ''),
          coalesce(nullif(trim(p_dados ->> 'bairro'), ''), 'Centro'),
          case when v_tipo = 'estrangeiro' then null else nullif(p_dados ->> 'municipio_ibge', '') end,
          case when v_tipo = 'estrangeiro' then nullif(p_dados ->> 'codigo_pais', '') end,
          case when v_tipo = 'estrangeiro' then nullif(trim(p_dados ->> 'pais'), '') end,
          case when v_tipo = 'estrangeiro' then nullif(trim(p_dados ->> 'cidade_exterior'), '') end,
          nullif(regexp_replace(coalesce(p_dados ->> 'cep', ''), '\D', '', 'g'), ''),
          nullif(regexp_replace(coalesce(p_dados ->> 'telefone', ''), '\D', '', 'g'), ''),
          nullif(lower(trim(p_dados ->> 'email')), ''))
  on conflict (id) do update set
    tipo = excluded.tipo,
    documento = excluded.documento,
    nome = excluded.nome,
    indicador_ie = excluded.indicador_ie,
    inscricao_estadual = excluded.inscricao_estadual,
    logradouro = excluded.logradouro,
    numero = excluded.numero,
    complemento = excluded.complemento,
    bairro = excluded.bairro,
    municipio_ibge = excluded.municipio_ibge,
    codigo_pais = excluded.codigo_pais,
    pais = excluded.pais,
    cidade_exterior = excluded.cidade_exterior,
    cep = excluded.cep,
    telefone = excluded.telefone,
    email = excluded.email
  returning d.id into v_id;
  return v_id;
end;
$$;

create or replace function public.nfe_transportador_salvar(p_empresa_id uuid, p_id uuid, p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_tipo text := p_dados ->> 'tipo';
  v_doc text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_ie text := nullif(upper(regexp_replace(coalesce(p_dados ->> 'inscricao_estadual', ''), '[^0-9A-Za-z]', '', 'g')), '');
begin
  perform app.exigir(p_empresa_id, 'nfe.emitir');
  if v_tipo = 'cpf' and (v_doc is null or not app.cpf_valido(v_doc)) then
    raise exception 'CPF do transportador inválido.';
  end if;
  if v_tipo = 'cnpj' and (v_doc is null or not app.cnpj_valido(v_doc)) then
    raise exception 'CNPJ do transportador inválido.';
  end if;
  if p_id is not null and not exists (select 1 from public.nfe_transportadores where id = p_id and empresa_id = p_empresa_id) then
    raise exception 'Transportador não encontrado.';
  end if;
  insert into public.nfe_transportadores as t (id, empresa_id, tipo, documento, nome, inscricao_estadual, endereco, municipio, uf, placa, placa_uf, rntc)
  values (coalesce(p_id, gen_random_uuid()), p_empresa_id,
          v_tipo,
          v_doc,
          trim(p_dados ->> 'nome'),
          v_ie,
          nullif(trim(p_dados ->> 'endereco'), ''),
          nullif(trim(p_dados ->> 'municipio'), ''),
          nullif(upper(trim(p_dados ->> 'uf')), ''),
          nullif(upper(regexp_replace(coalesce(p_dados ->> 'placa', ''), '[^0-9A-Za-z]', '', 'g')), ''),
          nullif(upper(trim(p_dados ->> 'placa_uf')), ''),
          nullif(trim(p_dados ->> 'rntc'), ''))
  on conflict (id) do update set
    tipo = excluded.tipo,
    documento = excluded.documento,
    nome = excluded.nome,
    inscricao_estadual = excluded.inscricao_estadual,
    endereco = excluded.endereco,
    municipio = excluded.municipio,
    uf = excluded.uf,
    placa = excluded.placa,
    placa_uf = excluded.placa_uf,
    rntc = excluded.rntc
  returning t.id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Emitir: monta a nota com as regras da operação, reserva o número e põe na fila
-- -----------------------------------------------------------------------------
create or replace function app.nfe_montar_dados(p_empresa_id uuid, p_dados jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfe_config;
  v_emp public.empresas;
  v_emi public.nfe_emitentes;
  v_op public.nfe_operacoes;
  v_dest public.nfe_destinatarios;
  v_tr public.nfe_transportadores;
  v_cl public.nfe_cclass_trib;
  v_esc public.escritorio;
  v_uf_emi text;
  v_mun_emi text;
  v_uf_dest text;
  v_mun_dest text;
  v_itens jsonb := '[]'::jsonb;
  it jsonb;
  v_prod public.nfe_produtos;
  v_q numeric;
  v_v numeric;
  v_total numeric := 0;
  v_difal jsonb;
  v_icms_uf public.icms_uf;
  v_frete_serv numeric := nullif(p_dados #>> '{transporte,frete_servico}', '')::numeric;
  v_simples boolean;
  v_refs jsonb;
  v_parcelas jsonb;
  v_info text;
  v_placa text;
begin
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id;
  select * into v_emp from public.empresas where id = p_empresa_id;
  select * into v_emi from public.nfe_emitentes where id = (p_dados ->> 'emitente_id')::uuid and empresa_id = p_empresa_id and ativo;
  if v_emi.id is null then
    raise exception 'Escolha a inscrição estadual (estabelecimento ou propriedade) que emite a nota.';
  end if;
  select * into v_op from public.nfe_operacoes where id = (p_dados ->> 'operacao_id')::uuid and empresa_id = p_empresa_id and ativa;
  if v_op.id is null then
    raise exception 'Escolha uma das operações cadastradas pelo escritório.';
  end if;
  select * into v_dest from public.nfe_destinatarios where id = (p_dados ->> 'destinatario_id')::uuid and empresa_id = p_empresa_id;
  if v_dest.id is null then
    raise exception 'Escolha o cliente (comprador).';
  end if;
  if v_dest.tipo = 'cnpj' and v_dest.documento = v_emp.documento and v_op.finalidade = 1 then
    raise exception 'O comprador não pode ser a própria empresa.';
  end if;
  select uf, nome into v_uf_emi, v_mun_emi from public.municipios where ibge = v_emi.municipio_ibge;
  if v_dest.tipo = 'estrangeiro' then
    v_uf_dest := 'EX';
  else
    select uf, nome into v_uf_dest, v_mun_dest from public.municipios where ibge = v_dest.municipio_ibge;
  end if;
  if v_op.destino = 'interna' and v_uf_dest <> v_uf_emi then
    raise exception 'A operação "%" é para dentro do estado, mas o cliente é de %.', v_op.nome, v_uf_dest;
  end if;
  if v_op.destino = 'interestadual' and (v_uf_dest = v_uf_emi or v_uf_dest = 'EX') then
    raise exception 'A operação "%" é para outro estado, mas o cliente é de %.', v_op.nome, v_uf_dest;
  end if;
  if v_op.destino = 'exterior' and v_uf_dest <> 'EX' then
    raise exception 'A operação "%" é para o exterior: escolha um cliente estrangeiro.', v_op.nome;
  end if;
  v_simples := v_cfg.crt in (1, 4);
  if v_op.ibscbs_cclass_trib is not null then
    select * into v_cl from public.nfe_cclass_trib where cclass_trib = v_op.ibscbs_cclass_trib;
  end if;

  -- Itens: dados do produto + regras da operação
  if jsonb_typeof(p_dados -> 'itens') <> 'array' or jsonb_array_length(p_dados -> 'itens') = 0 then
    raise exception 'Inclua ao menos um produto.';
  end if;
  if jsonb_array_length(p_dados -> 'itens') > 990 then
    raise exception 'A NF-e aceita no máximo 990 itens.';
  end if;
  for it in select * from jsonb_array_elements(p_dados -> 'itens') loop
    select * into v_prod from public.nfe_produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa_id and ativo;
    if v_prod.id is null then
      raise exception 'Escolha um dos produtos cadastrados.';
    end if;
    v_q := nullif(it ->> 'quantidade', '')::numeric;
    v_v := nullif(it ->> 'valor_unitario', '')::numeric;
    if v_q is null or v_q <= 0 or v_q <> round(v_q, 4) or v_q >= 100000000000 then
      raise exception 'Quantidade inválida no produto % (até 4 casas decimais).', v_prod.descricao;
    end if;
    if v_v is null or v_v <= 0 or v_v <> round(v_v, 10) or v_v >= 100000000000 then
      raise exception 'Preço inválido no produto %.', v_prod.descricao;
    end if;
    v_total := v_total + round(v_q * v_v, 2);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'codigo', v_prod.codigo,
      'descricao', coalesce(nullif(trim(it ->> 'descricao'), ''), v_prod.descricao),
      'ncm', v_prod.ncm,
      'cest', v_prod.cest,
      'gtin', v_prod.gtin,
      'cfop', v_op.cfop,
      'unidade', v_prod.unidade,
      'quantidade', trim(trailing '.' from trim(trailing '0' from to_char(v_q, 'FM99999999990.0000'))),
      'valorUnitario', trim(trailing '.' from trim(trailing '0' from to_char(v_v, 'FM99999999990.0000000000'))),
      'pesoKgUnidade', v_prod.peso_kg::text,
      'origem', v_prod.origem::text,
      'icms', jsonb_build_object(
        'cst', v_op.icms_cst, 'aliquota', v_op.icms_aliquota, 'reducaoBase', v_op.icms_reducao, 'diferimento', v_op.icms_diferimento,
        'creditoSimples', v_op.icms_credito_sn, 'beneficio', v_op.icms_beneficio),
      'pis', jsonb_build_object('cst', v_op.pis_cst, 'aliquota', v_op.pis_aliquota),
      'cofins', jsonb_build_object('cst', v_op.cofins_cst, 'aliquota', v_op.cofins_aliquota),
      'ibscbs', case when v_cl.cclass_trib is not null then jsonb_build_object(
        'cst', v_cl.cst, 'classificacao', v_cl.cclass_trib, 'reducaoIbs', v_cl.p_red_ibs, 'reducaoCbs', v_cl.p_red_cbs,
        'diferimento', v_op.ibscbs_diferimento) end,
      'excluirIcmsPisCofins', v_op.excluir_icms_pis_cofins,
      'informacoes', nullif(trim(it ->> 'informacoes'), '')
    ));
  end loop;
  if (v_simples and v_op.icms_cst not in ('101', '102', '103', '300', '400', '900')) or (not v_simples and v_op.icms_cst in ('101', '102', '103', '300', '400', '900')) then
    raise exception 'O ICMS da operação "%" não combina com o regime da empresa na configuração. Fale com o escritório.', v_op.nome;
  end if;
  if v_cfg.crt = 3 and v_cl.cclass_trib is null then
    raise exception 'A operação "%" está sem a classificação do IBS/CBS (obrigatória no regime normal). Fale com o escritório.', v_op.nome;
  end if;
  v_total := v_total + coalesce(nullif(p_dados ->> 'frete', '')::numeric, 0) + coalesce(nullif(p_dados ->> 'seguro', '')::numeric, 0)
             + coalesce(nullif(p_dados ->> 'outras', '')::numeric, 0) - coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0);
  if v_total < 0 then
    raise exception 'O desconto é maior que o valor da nota.';
  end if;

  -- DIFAL: venda a não contribuinte de outro estado (alíquota interna e FCP da tabela "ICMS por estado")
  if v_op.difal_metodo is not null and v_dest.indicador_ie = 9 and v_op.destino = 'interestadual' then
    select * into v_icms_uf from public.icms_uf where uf = v_uf_dest;
    if v_icms_uf.aliquota_interna is null then
      raise exception 'A alíquota interna do ICMS de % não está cadastrada (ICMS por estado). Fale com o escritório.', v_uf_dest;
    end if;
    v_difal := jsonb_build_object('metodo', v_op.difal_metodo, 'aliquotaInterna', v_icms_uf.aliquota_interna, 'fcp', coalesce(v_icms_uf.fcp, 0));
  end if;

  if v_op.frete_icms_retido and (v_frete_serv is null or v_frete_serv <= 0) then
    raise exception 'A operação "%" retém o ICMS do frete: informe o valor do frete contratado.', v_op.nome;
  end if;
  if (p_dados #>> '{transporte,transportador_id}') is not null then
    select * into v_tr from public.nfe_transportadores where id = (p_dados #>> '{transporte,transportador_id}')::uuid and empresa_id = p_empresa_id;
    if v_tr.id is null then
      raise exception 'Transportador não encontrado.';
    end if;
  end if;
  v_placa := nullif(upper(regexp_replace(coalesce(p_dados #>> '{transporte,placa}', v_tr.placa, ''), '[^0-9A-Za-z]', '', 'g')), '');

  v_refs := coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(p_dados -> 'referencias', '[]'::jsonb)) x where x ~ '^[0-9]{44}$'), '[]'::jsonb);
  if v_op.finalidade = 4 and jsonb_array_length(v_refs) = 0 then
    raise exception 'Informe a chave de acesso da nota que está sendo devolvida.';
  end if;
  v_parcelas := case when coalesce((p_dados #>> '{pagamento,a_prazo}')::boolean, false) then coalesce(p_dados #> '{pagamento,parcelas}', '[]'::jsonb) else '[]'::jsonb end;
  v_info := nullif(concat_ws(' ', nullif(trim(v_op.informacoes), ''), nullif(trim(v_cfg.informacoes_padrao), ''), nullif(trim(p_dados ->> 'informacoes'), '')), '');
  select * into v_esc from public.escritorio where id = 1;

  return jsonb_build_object(
    'natureza', v_op.natureza,
    'finalidade', v_op.finalidade,
    'consumidorFinal', v_op.consumidor_final,
    'presenca', v_cfg.presenca,
    'referencias', v_refs,
    'emitente', jsonb_build_object(
      'tipo', case when v_emp.tipo_pessoa = 'PF' then 'cpf' else 'cnpj' end,
      'documento', v_emp.documento,
      'nome', v_emp.razao_social,
      'fantasia', v_emp.nome_fantasia,
      'endereco', jsonb_build_object('logradouro', v_emi.logradouro, 'numero', v_emi.numero, 'complemento', v_emi.complemento, 'bairro', v_emi.bairro,
                                     'codigoMunicipio', v_emi.municipio_ibge, 'municipio', v_mun_emi, 'uf', v_uf_emi, 'cep', v_emi.cep, 'telefone', v_emi.telefone),
      'inscricaoEstadual', v_emi.inscricao_estadual,
      'crt', v_cfg.crt),
    'destinatario', jsonb_build_object(
      'tipo', v_dest.tipo, 'documento', v_dest.documento, 'nome', v_dest.nome,
      'endereco', jsonb_build_object('logradouro', v_dest.logradouro, 'numero', v_dest.numero, 'complemento', v_dest.complemento, 'bairro', v_dest.bairro,
                                     'codigoMunicipio', coalesce(v_dest.municipio_ibge, '9999999'), 'municipio', coalesce(v_mun_dest, v_dest.cidade_exterior, 'EXTERIOR'),
                                     'uf', v_uf_dest, 'cep', v_dest.cep, 'telefone', v_dest.telefone, 'codigoPais', v_dest.codigo_pais, 'pais', v_dest.pais),
      'indicadorIe', v_dest.indicador_ie, 'inscricaoEstadual', v_dest.inscricao_estadual, 'email', v_dest.email),
    'itens', v_itens,
    'frete', nullif(p_dados ->> 'frete', ''),
    'seguro', nullif(p_dados ->> 'seguro', ''),
    'outras', nullif(p_dados ->> 'outras', ''),
    'desconto', nullif(p_dados ->> 'desconto', ''),
    'transporte', jsonb_build_object(
      'modalidade', coalesce((p_dados #>> '{transporte,modalidade}')::int, 9),
      'transportador', case when v_tr.id is not null then jsonb_build_object(
        'tipo', v_tr.tipo, 'documento', v_tr.documento, 'nome', v_tr.nome, 'inscricaoEstadual', v_tr.inscricao_estadual,
        'endereco', v_tr.endereco, 'municipio', v_tr.municipio, 'uf', v_tr.uf) end,
      'veiculo', case when v_placa is not null then jsonb_build_object(
        'placa', v_placa, 'uf', coalesce(nullif(upper(p_dados #>> '{transporte,placa_uf}'), ''), v_tr.placa_uf),
        'rntc', coalesce(nullif(p_dados #>> '{transporte,rntc}', ''), v_tr.rntc)) end,
      'volumes', jsonb_build_object('quantidade', nullif(p_dados #>> '{transporte,volumes_quantidade}', '')::numeric,
                                    'especie', nullif(trim(p_dados #>> '{transporte,especie}'), ''), 'marca', nullif(trim(p_dados #>> '{transporte,marca}'), '')),
      'icmsFrete', case when v_op.frete_icms_retido then jsonb_build_object(
        'valorServico', v_frete_serv::text, 'reducaoBase', v_op.frete_reducao, 'aliquota', v_op.frete_aliquota, 'cfop', v_op.frete_cfop,
        'codigoMunicipio', v_emi.municipio_ibge) end),
    'pagamento', jsonb_build_object(
      'forma', coalesce(nullif(p_dados #>> '{pagamento,forma}', ''), '90'),
      'descricao', nullif(trim(p_dados #>> '{pagamento,descricao}'), ''),
      'aPrazo', coalesce((p_dados #>> '{pagamento,a_prazo}')::boolean, false),
      'parcelas', v_parcelas),
    'difal', v_difal,
    'funrural', case when v_op.incide_funrural and v_cfg.funrural_percentual > 0 then
      jsonb_build_object('percentual', v_cfg.funrural_percentual, 'modo', v_cfg.funrural_modo) end,
    'contribuicoes', v_op.contribuicoes,
    'icmsPorOperacao', v_op.icms_por_operacao,
    'codigosReceita', jsonb_build_object('icms_operacao', v_op.icms_codigo_receita, 'icms_frete', v_op.frete_codigo_receita,
                                         'difal', v_op.difal_codigo_receita, 'fcp_difal', v_op.difal_codigo_receita),
    'informacoesComplementares', v_info,
    'responsavelTecnico', case when v_esc.cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$' and v_esc.email is not null and regexp_replace(coalesce(v_esc.telefone, ''), '\D', '', 'g') ~ '^[0-9]{6,14}$'
      then jsonb_build_object('cnpj', v_esc.cnpj, 'contato', v_esc.razao_social, 'email', v_esc.email, 'telefone', regexp_replace(v_esc.telefone, '\D', '', 'g')) end,
    'autorizadosXml', case when v_cfg.autorizar_escritorio_xml and v_esc.cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$' then jsonb_build_array(v_esc.cnpj) else '[]'::jsonb end,
    'pedidoCompra', nullif(trim(p_dados ->> 'pedido_compra'), ''),
    '_resumo', jsonb_build_object('valor_total', round(v_total, 2), 'destinatario_nome', v_dest.nome, 'destinatario_documento', v_dest.documento,
                                  'destinatario_uf', case when v_uf_dest = 'EX' then null else v_uf_dest end)
  );
end;
$$;

create or replace function public.nfe_emitir(p_empresa_id uuid, p_dados jsonb, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg public.nfe_config;
  v_emi public.nfe_emitentes;
  v_ant public.nfe_emissoes;
  v_dados jsonb;
  v_resumo jsonb;
  v_numero bigint;
  v_cnf text;
  v_id uuid;
begin
  perform app.exigir(p_empresa_id, 'nfe.emitir');
  select * into v_cfg from public.nfe_config where empresa_id = p_empresa_id;
  if v_cfg.empresa_id is null or not v_cfg.ativa then
    raise exception 'A emissão de NF-e desta empresa ainda não foi ligada pelo escritório.';
  end if;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = p_empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  v_dados := app.nfe_montar_dados(p_empresa_id, p_dados);
  v_resumo := v_dados -> '_resumo';
  v_dados := v_dados - '_resumo';

  if p_id is not null then
    -- Nota rejeitada, corrigida: mesmo número (a SEFAZ não registrou a rejeitada)
    select * into v_ant from public.nfe_emissoes where id = p_id and empresa_id = p_empresa_id for update;
    if v_ant.id is null then
      raise exception 'Nota não encontrada.';
    end if;
    if v_ant.situacao <> 'rejeitada' then
      raise exception 'Só uma nota rejeitada pode ser corrigida e enviada de novo.';
    end if;
    if v_ant.emitente_id <> (p_dados ->> 'emitente_id')::uuid then
      raise exception 'Na correção, a inscrição que emite não pode mudar (o número é dela).';
    end if;
    update public.nfe_emissoes
       set operacao_id = (p_dados ->> 'operacao_id')::uuid, destinatario_id = (p_dados ->> 'destinatario_id')::uuid,
           situacao = 'na_fila', dados = v_dados, natureza = v_dados ->> 'natureza',
           destinatario_nome = v_resumo ->> 'destinatario_nome', destinatario_documento = v_resumo ->> 'destinatario_documento',
           destinatario_uf = v_resumo ->> 'destinatario_uf', valor_total = (v_resumo ->> 'valor_total')::numeric,
           emitida_em = null, chave = null, recibo = null, totais = null, xml_assinado = null, mensagens = null, tentativas = 0
     where id = p_id;
    perform app.enfileirar('emitir_nfe', jsonb_build_object('emissao_id', p_id), p_empresa_id,
                           'nfe:' || p_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
    return jsonb_build_object('id', p_id, 'numero', v_ant.numero, 'serie', v_ant.serie, 'ambiente', v_ant.ambiente);
  end if;

  -- Proteção contra pedido repetido por engano (mesmo cliente e valor em 10 minutos)
  if not coalesce((p_dados ->> 'confirmar_repetida')::boolean, false) and exists (
    select 1 from public.nfe_emissoes e
     where e.empresa_id = p_empresa_id and e.valor_total = (v_resumo ->> 'valor_total')::numeric
       and e.destinatario_documento is not distinct from (v_resumo ->> 'destinatario_documento')
       and e.situacao not in ('rejeitada', 'cancelada', 'descartada') and e.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'Uma nota igual (mesmo cliente e valor) foi emitida há poucos minutos. Confira a lista antes de emitir de novo.'
      using errcode = 'P0002';
  end if;
  if (select count(*) from public.nfe_emissoes e where e.empresa_id = p_empresa_id and e.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Limite de 60 notas por hora atingido. Aguarde um pouco ou fale com o escritório.';
  end if;

  -- Número (reservado agora) na série da inscrição que emite
  select * into v_emi from public.nfe_emitentes where id = (p_dados ->> 'emitente_id')::uuid for update;
  if v_cfg.ambiente = 'producao' then
    v_numero := v_emi.proximo_numero_producao;
    update public.nfe_emitentes set proximo_numero_producao = v_numero + 1 where id = v_emi.id;
  else
    v_numero := v_emi.proximo_numero_homologacao;
    update public.nfe_emitentes set proximo_numero_homologacao = v_numero + 1 where id = v_emi.id;
  end if;
  -- Código numérico (cNF) sorteado, diferente do número
  loop
    v_cnf := lpad((10000000 + floor(random() * 90000000))::bigint::text, 8, '0');
    exit when v_cnf <> lpad(v_numero::text, 8, '0') and v_cnf !~ '^(\d)\1{7}$';
  end loop;

  insert into public.nfe_emissoes (
    empresa_id, emitente_id, operacao_id, destinatario_id, ambiente, serie, numero, codigo_numerico, dados,
    natureza, destinatario_nome, destinatario_documento, destinatario_uf, valor_total
  ) values (
    p_empresa_id, v_emi.id, (p_dados ->> 'operacao_id')::uuid, (p_dados ->> 'destinatario_id')::uuid, v_cfg.ambiente, v_emi.serie, v_numero, v_cnf, v_dados,
    v_dados ->> 'natureza', v_resumo ->> 'destinatario_nome', v_resumo ->> 'destinatario_documento', v_resumo ->> 'destinatario_uf',
    (v_resumo ->> 'valor_total')::numeric
  ) returning id into v_id;

  perform app.enfileirar('emitir_nfe', jsonb_build_object('emissao_id', v_id), p_empresa_id, 'nfe:' || v_id::text, now(), 5);
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'serie', v_emi.serie, 'ambiente', v_cfg.ambiente);
end;
$$;

-- Envia de novo uma nota que ficou sem resposta (a tarefa consulta antes se ela já foi autorizada)
create or replace function public.nfe_tentar_de_novo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_emissoes;
begin
  select * into v from public.nfe_emissoes where id = p_id;
  if v.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.emitir');
  if v.situacao not in ('falha', 'aguardando') then
    raise exception 'Só uma nota que ficou sem resposta pode ser enviada de novo.';
  end if;
  update public.nfe_emissoes set situacao = case when v.situacao = 'aguardando' then 'aguardando' else 'na_fila' end where id = p_id;
  perform app.enfileirar('emitir_nfe', jsonb_build_object('emissao_id', p_id), v.empresa_id,
                         'nfe:' || p_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), now(), 5);
end;
$$;

-- Nota rejeitada que não será corrigida: o número fica sem uso (inutilizar na SEFAZ)
create or replace function public.nfe_descartar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_emissoes;
begin
  select * into v from public.nfe_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.emitir');
  if v.situacao <> 'rejeitada' then
    raise exception 'Só uma nota rejeitada pode ser descartada.';
  end if;
  update public.nfe_emissoes set situacao = 'descartada', descartada_em = now() where id = p_id;
end;
$$;

create or replace function public.nfe_cancelar(p_id uuid, p_justificativa text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_emissoes;
  v_ev uuid;
begin
  select * into v from public.nfe_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.emitir');
  if v.situacao <> 'autorizada' then
    raise exception 'Só uma nota autorizada pode ser cancelada.';
  end if;
  if length(trim(coalesce(p_justificativa, ''))) not between 15 and 255 then
    raise exception 'Explique o motivo do cancelamento (de 15 a 255 caracteres).';
  end if;
  if not exists (select 1 from public.certificados_digitais c where c.empresa_id = v.empresa_id and c.revogado_em is null and c.valido_ate > now()) then
    raise exception 'O certificado digital da empresa venceu ou foi removido. Fale com o escritório.';
  end if;
  delete from public.nfe_eventos where emissao_id = p_id and tipo = 'cancelamento' and situacao in ('rejeitado', 'falha');
  insert into public.nfe_eventos (emissao_id, empresa_id, tipo, sequencia, texto) values (p_id, v.empresa_id, 'cancelamento', 1, trim(p_justificativa))
  returning id into v_ev;
  update public.nfe_emissoes set situacao = 'cancelando', mensagens = null where id = p_id;
  perform app.enfileirar('evento_nfe', jsonb_build_object('evento_id', v_ev), v.empresa_id, 'nfe-evento:' || v_ev::text, now(), 5);
end;
$$;

create or replace function public.nfe_carta_correcao(p_id uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_emissoes;
  v_seq smallint;
  v_ev uuid;
begin
  select * into v from public.nfe_emissoes where id = p_id for update;
  if v.id is null then
    raise exception 'Nota não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.emitir');
  if v.situacao <> 'autorizada' then
    raise exception 'A carta de correção é para nota autorizada (e não cancelada).';
  end if;
  if length(trim(coalesce(p_texto, ''))) not between 15 and 1000 then
    raise exception 'Descreva a correção (de 15 a 1000 caracteres).';
  end if;
  if exists (select 1 from public.nfe_eventos where emissao_id = p_id and tipo = 'carta_correcao' and situacao in ('na_fila', 'enviando')) then
    raise exception 'Já há uma carta de correção sendo enviada para esta nota. Aguarde o retorno.';
  end if;
  -- Carta rejeitada não conta: a sequência é a das registradas
  delete from public.nfe_eventos where emissao_id = p_id and tipo = 'carta_correcao' and situacao in ('rejeitado', 'falha');
  select coalesce(max(sequencia), 0) + 1 into v_seq from public.nfe_eventos where emissao_id = p_id and tipo = 'carta_correcao';
  if v_seq > 20 then
    raise exception 'A nota já tem 20 cartas de correção (o máximo).';
  end if;
  insert into public.nfe_eventos (emissao_id, empresa_id, tipo, sequencia, texto) values (p_id, v.empresa_id, 'carta_correcao', v_seq, trim(p_texto))
  returning id into v_ev;
  perform app.enfileirar('evento_nfe', jsonb_build_object('evento_id', v_ev), v.empresa_id, 'nfe-evento:' || v_ev::text, now(), 5);
end;
$$;

-- Guia gerada no site oficial (PDF anexado como "guia" da empresa) ou dispensada
create or replace function public.nfe_guia_atualizar(p_id uuid, p_situacao text, p_documento_id uuid default null, p_observacao text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_guias;
  v_doc public.documentos;
begin
  select * into v from public.nfe_guias where id = p_id for update;
  if v.id is null then
    raise exception 'Guia não encontrada.';
  end if;
  perform app.exigir(v.empresa_id, 'nfe.configurar');
  if p_situacao not in ('a_gerar', 'gerada', 'dispensada') then
    raise exception 'Situação da guia inválida.';
  end if;
  if p_situacao = 'gerada' then
    select * into v_doc from public.documentos where id = p_documento_id;
    if v_doc.id is null or v_doc.empresa_id <> v.empresa_id or v_doc.categoria_codigo <> 'esc_guia' or v_doc.excluido_em is not null then
      raise exception 'Anexe o PDF da guia (documento de guia da empresa).';
    end if;
  end if;
  if p_situacao = 'dispensada' and length(trim(coalesce(p_observacao, ''))) < 5 then
    raise exception 'Explique por que a guia não se aplica.';
  end if;
  update public.nfe_guias
     set situacao = p_situacao,
         documento_id = case when p_situacao = 'gerada' then p_documento_id else null end,
         observacao = nullif(trim(coalesce(p_observacao, '')), ''),
         atualizado_por = auth.uid()
   where id = p_id;
end;
$$;

-- Avisos depois do retorno da SEFAZ (chamada pelo processador)
create or replace function public.nfe_avisar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.nfe_emissoes;
  v_link text;
  v_titulo text;
  v_corpo text;
  v_guias int;
begin
  select * into v from public.nfe_emissoes where id = p_id;
  if v.id is null then
    return;
  end if;
  v_link := '/e/' || v.empresa_id::text || '/notas-produto/' || v.id::text;
  if v.situacao = 'autorizada' and v.cancelada_em is null then
    select count(*) into v_guias from public.nfe_guias where emissao_id = p_id and situacao = 'a_gerar';
    if v_guias = 0 then
      return;
    end if;
    v_titulo := 'NF-e ' || v.numero || ' autorizada: ' || v_guias || ' guia(s) a gerar';
    v_corpo := 'A nota de ' || to_char(v.valor_total, 'FM999G999G990D00') || ' foi autorizada. Gere as guias no site oficial e anexe no portal.';
    perform app.notificar_equipe(v.empresa_id, 'nfe', v_titulo, v_corpo, v_link, false);
    return;
  elsif v.situacao = 'rejeitada' then
    v_titulo := 'NF-e não emitida';
    v_corpo := 'A SEFAZ recusou a nota de ' || to_char(v.valor_total, 'FM999G999G990D00') || '. Veja o motivo, corrija e envie de novo.';
  elsif v.situacao = 'denegada' then
    v_titulo := 'NF-e denegada';
    v_corpo := 'A SEFAZ denegou o uso da nota ' || v.numero || ' (irregularidade cadastral do emitente ou do destinatário). Fale com o escritório.';
  elsif v.situacao = 'falha' then
    v_titulo := 'NF-e sem resposta da SEFAZ';
    v_corpo := 'A SEFAZ não respondeu. O portal tenta de novo; se continuar, fale com o escritório.';
  elsif v.situacao = 'cancelada' then
    v_titulo := 'NF-e cancelada';
    v_corpo := 'O cancelamento da nota ' || v.numero || ' foi registrado na SEFAZ.';
  elsif v.situacao = 'autorizada' then
    v_titulo := 'Cancelamento da NF-e não aceito';
    v_corpo := 'A SEFAZ não aceitou o cancelamento da nota ' || v.numero || '. Veja o motivo.';
  else
    return;
  end if;
  perform app.notificar_clientes(v.empresa_id, 'nfe.emitir', 'nfe', v_titulo, v_corpo, v_link, false);
  perform app.notificar_equipe(v.empresa_id, 'nfe', v_titulo, v_corpo, v_link, false);
end;
$$;

-- Carteira do escritório
create or replace function public.nfe_carteira(p_inicio date, p_fim date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(app.tipo_usuario(), '') not in ('admin', 'equipe') then
    raise exception 'Somente a equipe do escritório.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'empresa')
      from (
        select jsonb_build_object(
                 'empresa_id', e.id,
                 'empresa', coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social),
                 'documento', e.documento,
                 'ativa', coalesce(c.ativa, false),
                 'ambiente', c.ambiente,
                 'certificado_valido_ate', (select max(cd.valido_ate) from public.certificados_digitais cd where cd.empresa_id = e.id and cd.revogado_em is null),
                 'autorizadas', count(n.id) filter (where n.situacao in ('autorizada', 'cancelando') and n.ambiente = 'producao'),
                 'valor', coalesce(sum(n.valor_total) filter (where n.situacao in ('autorizada', 'cancelando') and n.ambiente = 'producao'), 0),
                 'canceladas', count(n.id) filter (where n.situacao = 'cancelada' and n.ambiente = 'producao'),
                 'rejeitadas', count(n.id) filter (where n.situacao in ('rejeitada', 'denegada')),
                 'pendentes', count(n.id) filter (where n.situacao in ('na_fila', 'enviando', 'aguardando', 'falha', 'cancelando')),
                 'guias_a_gerar', (select count(*) from public.nfe_guias g where g.empresa_id = e.id and g.situacao = 'a_gerar'),
                 'testes', count(n.id) filter (where n.ambiente = 'homologacao')
               ) as x
          from public.empresas e
          left join public.nfe_config c on c.empresa_id = e.id
          left join public.nfe_emissoes n on n.empresa_id = e.id and (n.created_at at time zone 'America/Araguaina')::date between p_inicio and p_fim
         where e.id = any (app.empresas_com('nfe.configurar'))
           and (c.empresa_id is not null or exists (select 1 from public.nfe_emissoes n2 where n2.empresa_id = e.id))
         group by e.id, c.ativa, c.ambiente
      ) s
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.nfe_configurar(uuid, jsonb), public.nfe_emitente_salvar(uuid, uuid, jsonb), public.nfe_produto_salvar(uuid, uuid, jsonb),
  public.nfe_operacao_salvar(uuid, uuid, jsonb), public.nfe_destinatario_salvar(uuid, uuid, jsonb), public.nfe_transportador_salvar(uuid, uuid, jsonb),
  public.nfe_emitir(uuid, jsonb, uuid), public.nfe_tentar_de_novo(uuid), public.nfe_descartar(uuid), public.nfe_cancelar(uuid, text),
  public.nfe_carta_correcao(uuid, text), public.nfe_guia_atualizar(uuid, text, uuid, text), public.nfe_avisar(uuid), public.nfe_carteira(date, date),
  app.nfe_montar_dados(uuid, jsonb), app.nfe_contribuicoes_validas(jsonb)
  from public, anon, authenticated;
grant execute on function public.nfe_configurar(uuid, jsonb), public.nfe_emitente_salvar(uuid, uuid, jsonb), public.nfe_produto_salvar(uuid, uuid, jsonb),
  public.nfe_operacao_salvar(uuid, uuid, jsonb), public.nfe_destinatario_salvar(uuid, uuid, jsonb), public.nfe_transportador_salvar(uuid, uuid, jsonb),
  public.nfe_emitir(uuid, jsonb, uuid), public.nfe_tentar_de_novo(uuid), public.nfe_descartar(uuid), public.nfe_cancelar(uuid, text),
  public.nfe_carta_correcao(uuid, text), public.nfe_guia_atualizar(uuid, text, uuid, text), public.nfe_carteira(date, date)
  to authenticated;
grant execute on function public.nfe_avisar(uuid), app.nfe_montar_dados(uuid, jsonb) to service_role;
