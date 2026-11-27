-- =============================================================================
-- ICMS por estado: alíquota interna geral, adicional geral de fundo de pobreza
-- (quando incide sobre as operações em geral) e prazo de recolhimento do ICMS
-- apurado no regime normal, com a fonte oficial de cada informação.
--
-- Situação de cada dado:
--   alíquota:   conferida   = lida no texto oficial da norma (lei, regulamento ou
--                             resposta oficial da Fazenda);
--               informada   = informação oficial do estado (tabela da Fazenda,
--                             Portal Nacional do DIFAL, notícia da Assembleia), sem
--                             leitura do texto da norma;
--               a_conferir  = só há informação antiga ou indireta.
--   vencimento: conferido   = lido no regulamento/ato oficial;
--               calendario  = o estado fixa as datas em calendário periódico;
--               a_conferir  = ainda não conferido: a equipe completa com a fonte.
--
-- Nenhum prazo é inventado: só os conferidos viram proposta de regra no
-- catálogo de obrigações (rascunho, validada pelo administrador). Os demais
-- ficam "a conferir" até a equipe preencher com a fonte oficial.
--
-- Alíquotas interestaduais (não dependem de cada estado): Resolução do Senado
-- nº 22/1989 (7% das regiões Sul e Sudeste, exceto ES, para N, NE, CO e ES; 12%
-- nas demais), nº 13/2012 (4% para importados e conteúdo de importação acima de
-- 40%) e nº 95/1996 (4% no transporte aéreo).
-- =============================================================================

create table public.icms_uf (
  id uuid primary key default gen_random_uuid(),
  uf text not null unique check (uf ~ '^[A-Z]{2}$'),
  nome text not null,
  regiao text not null check (regiao in ('N', 'NE', 'CO', 'SE', 'S')),
  aliquota_interna numeric(5,2) check (aliquota_interna between 0 and 40),
  fcp numeric(5,2) check (fcp between 0 and 5),
  fcp_observacao text,
  aliquota_situacao text not null check (aliquota_situacao in ('conferida', 'informada', 'a_conferir')),
  aliquota_vigencia date,
  aliquota_base_legal text,
  aliquota_fonte_url text,
  aliquota_observacao text,
  vencimento_situacao text not null check (vencimento_situacao in ('conferido', 'calendario', 'a_conferir')),
  vencimento_dia smallint check (vencimento_dia between 1 and 31),
  vencimento_ajuste text check (vencimento_ajuste in ('antecipar', 'postergar', 'manter')),
  vencimento_base_legal text,
  vencimento_fonte_url text,
  vencimento_observacao text,
  conferido_em date not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.perfis(id) on delete set null,
  constraint icms_uf_aliquota_coerente check (
    aliquota_situacao = 'a_conferir'
    or (aliquota_interna is not null and nullif(trim(coalesce(aliquota_base_legal, '')), '') is not null)),
  constraint icms_uf_vencimento_coerente check (
    vencimento_situacao <> 'conferido'
    or (vencimento_dia is not null and vencimento_ajuste is not null
        and nullif(trim(coalesce(vencimento_base_legal, '')), '') is not null)),
  constraint icms_uf_urls check (
    (aliquota_fonte_url is null or aliquota_fonte_url ~ '^https?://')
    and (vencimento_fonte_url is null or vencimento_fonte_url ~ '^https?://'))
);

comment on table public.icms_uf is 'ICMS por estado: alíquota interna geral, FCP geral e prazo de recolhimento do ICMS apurado (regime normal), com fonte e situação da conferência.';

-- Quem alterou e quando
create or replace function app.tg_icms_uf_atualizado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end;
$$;

create trigger icms_uf_atualizado before update on public.icms_uf
  for each row execute function app.tg_icms_uf_atualizado();
create trigger auditoria_icms_uf after insert or update or delete on public.icms_uf
  for each row execute function app.tg_auditoria();

-- Dado de referência (não é dado de cliente): todo usuário ativo pode ler;
-- só o administrador do escritório altera, e apenas os campos de conteúdo.
alter table public.icms_uf enable row level security;
create policy icms_uf_leitura on public.icms_uf for select to authenticated using ((select app.usuario_valido()));
create policy icms_uf_alteracao on public.icms_uf for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select on public.icms_uf to authenticated;
grant update (aliquota_interna, fcp, fcp_observacao, aliquota_situacao, aliquota_vigencia, aliquota_base_legal,
              aliquota_fonte_url, aliquota_observacao, vencimento_situacao, vencimento_dia, vencimento_ajuste,
              vencimento_base_legal, vencimento_fonte_url, vencimento_observacao, conferido_em)
  on public.icms_uf to authenticated;

-- -----------------------------------------------------------------------------
-- Alíquota interestadual (Resoluções do Senado nº 22/1989 e nº 13/2012)
-- -----------------------------------------------------------------------------
create or replace function app.icms_aliquota_interestadual(p_origem text, p_destino text, p_importado boolean default false)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_origem is null or p_destino is null or upper(p_origem) = upper(p_destino) then null
    when coalesce(p_importado, false) then 4
    when upper(p_origem) in ('MG', 'PR', 'RJ', 'RS', 'SC', 'SP')
         and upper(p_destino) not in ('MG', 'PR', 'RJ', 'RS', 'SC', 'SP') then 7
    else 12
  end::numeric;
$$;

grant execute on function app.icms_aliquota_interestadual(text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Proposta de regra de vencimento do ICMS para o catálogo de obrigações
-- -----------------------------------------------------------------------------
create or replace function app.icms_regra_proposta(p_uf text,
                                                   out regra jsonb, out titulo text, out resumo text,
                                                   out fonte_titulo text, out fonte_url text, out fonte_consultada_em date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  u public.icms_uf;
  v_inicio date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '1 month')::date;
  v_ajuste text;
begin
  select * into u from public.icms_uf where uf = upper(trim(coalesce(p_uf, '')));
  if u.id is null then
    raise exception 'Estado não encontrado.';
  end if;
  if u.vencimento_situacao <> 'conferido' or u.vencimento_dia is null then
    raise exception 'Confira o prazo do ICMS de % na legislação antes de propor a regra.', u.uf;
  end if;
  v_ajuste := case u.vencimento_ajuste
                when 'antecipar' then 'antecipa para o dia útil anterior'
                when 'postergar' then 'passa para o dia útil seguinte'
                else 'mantém a data' end;
  regra := jsonb_build_object(
    'vigencia_inicio', to_char(v_inicio, 'YYYY-MM-DD'),
    'regimes', jsonb_build_array('lucro_presumido', 'lucro_real', 'lucro_arbitrado'),
    'ufs', jsonb_build_array(u.uf),
    'exige_icms', true,
    'servico', 'fiscal',
    'prazo_interno_dias_uteis', 2,
    'prazo_pagamento', jsonb_build_object('tipo', 'dia_fixo', 'meses_apos', 1, 'dia', u.vencimento_dia,
                                          'ajuste', u.vencimento_ajuste, 'calendario', 'expediente_bancario',
                                          'feriados', 'municipal'),
    'observacao', u.vencimento_observacao);
  titulo := format('ICMS %s: recolhimento até o dia %s do mês seguinte', u.uf, u.vencimento_dia);
  resumo := format('ICMS apurado no regime normal (Lucro Presumido, Real ou Arbitrado) de empresas contribuintes de %s: '
                   'até o dia %s do mês seguinte; sem expediente bancário, %s.%s',
                   u.nome, u.vencimento_dia, v_ajuste,
                   case when u.vencimento_observacao is not null then ' ' || u.vencimento_observacao else '' end);
  fonte_titulo := u.vencimento_base_legal;
  fonte_url := u.vencimento_fonte_url;
  fonte_consultada_em := u.conferido_em;
end;
$$;

-- A equipe propõe; o administrador valida em Obrigações > Atualizações normativas.
create or replace function public.icms_uf_propor_regra(p_uf text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p record;
  v_obr uuid := (select id from public.obrigacoes where codigo = 'ICMS');
  v_anterior uuid;
  v_id uuid;
begin
  if not app.is_equipe() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if v_obr is null then
    raise exception 'A obrigação ICMS não está no catálogo.';
  end if;
  if exists (select 1 from public.obrigacao_regras r
              where r.obrigacao_id = v_obr and r.empresa_id is null and r.status = 'rascunho'
                and upper(trim(coalesce(p_uf, ''))) = any(r.ufs)) then
    raise exception 'Já existe uma proposta de regra do ICMS para este estado aguardando validação.';
  end if;
  select * into p from app.icms_regra_proposta(p_uf);
  -- Se o estado já tem regra validada em vigor, a proposta a substitui (alteração), sem duplicar tarefas.
  select r.id into v_anterior
    from public.obrigacao_regras r
   where r.obrigacao_id = v_obr and r.empresa_id is null and r.status = 'validada'
     and r.ufs = array[upper(trim(p_uf))]
     and (r.vigencia_fim is null or r.vigencia_fim >= date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date)
   order by r.vigencia_inicio desc
   limit 1;
  if v_anterior is not null and exists (
       select 1 from public.obrigacao_regras r
        where r.id = v_anterior
          and r.prazo_pagamento ->> 'dia' = (p.regra -> 'prazo_pagamento' ->> 'dia')
          and r.prazo_pagamento ->> 'ajuste' = (p.regra -> 'prazo_pagamento' ->> 'ajuste')) then
    raise exception 'A regra validada deste estado já tem este prazo.';
  end if;
  select public.propor_regra(v_obr, p.titulo, p.resumo, p.regra, p.fonte_titulo, p.fonte_url, null, p.fonte_consultada_em, v_anterior)
    into v_id;
  perform app.registrar_auditoria('icms_regra_proposta', 'icms_uf', upper(trim(p_uf)), null,
                                  jsonb_build_object('atualizacao_id', v_id));
  return v_id;
end;
$$;

revoke all on function public.icms_uf_propor_regra(text) from public, anon;
grant execute on function public.icms_uf_propor_regra(text) to authenticated;
revoke all on function app.icms_regra_proposta(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Dados conferidos em 03/10/2026
-- -----------------------------------------------------------------------------
insert into public.icms_uf (uf, nome, regiao, aliquota_interna, fcp, fcp_observacao, aliquota_situacao, aliquota_vigencia,
                            aliquota_base_legal, aliquota_fonte_url, aliquota_observacao,
                            vencimento_situacao, vencimento_dia, vencimento_ajuste, vencimento_base_legal, vencimento_fonte_url,
                            vencimento_observacao, conferido_em)
values
('AC', 'Acre', 'N', 19, null, null, 'informada', '2023-04-01',
 'LC estadual nº 55/1997, art. 18, I; RICMS/AC (Decreto nº 8/1998), art. 17 — conforme o Portal Nacional do DIFAL (atualizado pelo Acre em 01/04/2023)',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', null,
 'a_conferir', null, null, 'RICMS/AC (Decreto nº 8/1998)', 'https://sefaz.ac.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('AL', 'Alagoas', 'NE', 20.5, 1, 'FECOEP: adicional de 1 ponto sobre as mercadorias e os serviços não listados no art. 2º, I, da Lei nº 6.558/2004, com as exceções do art. 2º-A, § 3º.', 'conferida', '2026-04-01',
 'Lei nº 5.900/1996, art. 17, I, "b" (redação da Lei nº 9.776/2025, publicada em 23/12/2025)',
 'https://sapl.al.al.leg.br/media/sapl/public/normajuridica/2025/3699/lei_no_9.776_de_22_de_dezembro_de_2025.pdf',
 'Vale a partir do 1º dia do 4º mês após a publicação (01/04/2026). Até 31/03/2026, 19% (Lei nº 8.779/2022).',
 'a_conferir', null, null, 'RICMS/AL (Decreto nº 35.245/1991)', 'https://www.sefaz.al.gov.br/legislacao', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('AP', 'Amapá', 'N', 18, null, null, 'informada', null,
 'RICMS/AP, Anexo I, art. 25 — tabela oficial de alíquotas da SEFAZ-AP (versão de 30/05/2025) publicada no Portal Nacional do DIFAL',
 'https://dfe-portal.svrs.rs.gov.br/DIFAL/DownloadArquivoEstatico/?sistema=DIFAL&tipoArquivo=12&nomeArquivo=AP%20-%20Vers%C3%A3o%20001%20-%2030-05-2025.pdf', null,
 'a_conferir', null, null, 'RICMS/AP (Decreto nº 2.269/1998)', 'https://www.sefaz.ap.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('AM', 'Amazonas', 'N', 20, null, null, 'conferida', '2023-04-01',
 'Lei Complementar nº 19/1997 (Código Tributário do AM), art. 12, I, "b" (redação da LC nº 244/2023)',
 'https://sistemas.sefaz.am.gov.br/get/Normas.do?metodo=viewDoc&uuidDoc=ac5497ab-4fbd-4bc8-a51b-32405f61dc30', 'GLP: 18%.',
 'conferido', 20, 'postergar', 'RICMS/AM (Decreto nº 20.686/1999), art. 107, II, "c", 1, e art. 106, § 4º',
 'https://sistemas.sefaz.am.gov.br/get/Normas.do?metodo=viewDoc&uuidDoc=cc3888c0-e1b9-4433-b513-3c0f29cc625a',
 'Comércio, indústria e serviços. Só vence em dia de expediente: se cair em dia sem expediente, passa para o dia útil seguinte. Substituição tributária nas saídas internas: dia 5; estimativa (parcela fixa): dia 15.', '2026-10-03'),

('BA', 'Bahia', 'NE', 20.5, null, null, 'conferida', '2024-02-07',
 'Lei nº 7.014/1996, art. 15, I, "a" (redação da Lei nº 14.629/2023)',
 'https://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf', 'Adicional de 2 pontos (fundo de pobreza, art. 16-A) só em produtos específicos.',
 'conferido', 9, 'postergar', 'RICMS/BA (Decreto nº 13.780/2012), art. 332, I, "a", e art. 491, § 2º',
 'https://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf',
 'Contribuintes no regime de conta corrente fiscal. Em dia não útil, paga no dia útil imediatamente seguinte.', '2026-10-03'),

('CE', 'Ceará', 'NE', 20, null, null, 'conferida', null,
 'Lei nº 12.670/1996, art. 44, I, "c" (redação da Lei nº 18.305/2023)',
 'https://www2.al.ce.gov.br/legislativo/legislacao5/leis2023/18305.htm', 'Antes, 18%. Confira a data de efeitos no art. 6º da Lei nº 18.305/2023.',
 'a_conferir', null, null, 'RICMS/CE (Decreto nº 33.327/2019), art. 88', 'https://www.sefaz.ce.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('DF', 'Distrito Federal', 'CO', 20, null, null, 'informada', null,
 'Lei nº 1.254/1996 (DF) — conforme o Portal Nacional do DIFAL (atualizado pelo DF em 22/01/2024)',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', null,
 'conferido', 9, 'postergar', 'RICMS/DF (Decreto nº 18.955/1997), art. 74, I, "a", e § 1º (redação do Decreto nº 37.122/2016)',
 'https://www.sinj.df.gov.br/sinj/Norma/1c0a6a0b610d4606a9c10b9db6a5cf22/exec_dec_37.122_2016.html',
 'Até o dia 9 sem atualização monetária; até o dia 20 com atualização monetária (art. 74, I, "a"). Confira se houve alteração posterior.', '2026-10-03'),

('ES', 'Espírito Santo', 'SE', 17, null, null, 'a_conferir', null,
 'Lei nº 7.000/2001, art. 20, I — conforme o Portal Nacional do DIFAL',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', 'A última informação do ES no Portal Nacional do DIFAL é de 30/12/2021: confira se houve alteração.',
 'a_conferir', null, null, 'RICMS/ES (Decreto nº 1.090-R/2002)', 'https://sefaz.es.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('GO', 'Goiás', 'CO', 19, null, null, 'conferida', '2024-04-01',
 'Código Tributário Estadual (Lei nº 11.651/1991), art. 27, I (redação da Lei nº 22.460/2023)',
 'https://appasp.economia.go.gov.br/legislacao/arquivos/Cte/CTE.htm', 'Até 31/03/2024, 17%.',
 'conferido', 20, 'postergar', 'IN nº 155/94-GSF, art. 2º, I (redação da IN nº 1.598/2024-GSE); RCTE (Decreto nº 4.852/1997), art. 75, § 3º',
 'https://appasp.economia.go.gov.br/legislacao/arquivos/Secretario/IN/IN_0155_1994.htm',
 'Comerciante, industrial, prestador de serviço (com fornecimento de mercadoria, transporte e comunicação), energia e substituto tributário (operação própria). Sem expediente bancário, passa para o primeiro dia útil seguinte.', '2026-10-03'),

('MA', 'Maranhão', 'NE', 23, null, null, 'a_conferir', null,
 'Lei nº 7.799/2002, art. 23, I', null,
 'Notícias oficiais da Assembleia indicam 23% desde 2025 (projeto de lei nº 477/2024); o Portal Nacional do DIFAL ainda mostra 18% (2021). Confira o texto da lei e a vigência.',
 'a_conferir', null, null, 'RICMS/MA (Decreto nº 19.714/2003)', 'https://sistemas1.sefaz.ma.gov.br/portalsefaz/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('MT', 'Mato Grosso', 'CO', 17, null, null, 'a_conferir', null,
 'Lei nº 7.098/1998, art. 14, I — conforme o Portal Nacional do DIFAL',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', 'A última informação de MT no Portal Nacional do DIFAL é de 30/12/2021: confira se houve alteração.',
 'conferido', 20, 'postergar', 'Portaria nº 137/2021-SEFAZ/MT, art. 1º, II (citada em resposta oficial à consulta tributária)',
 'https://app1.sefaz.mt.gov.br/Sistema/Legislacao/respostaConsulta.nsf/5540d90afcacd4f204257057004b655c/d08cc4f19b28c10e042589b800748e50?OpenDocument=',
 'Regime normal com atividade principal de comércio atacadista ou varejista. Outras atividades têm prazos próprios na Portaria nº 137/2021: confira antes de usar.', '2026-10-03'),

('MS', 'Mato Grosso do Sul', 'CO', 17, null, null, 'conferida', null,
 'Lei nº 1.810/1997, art. 41, III, "a"',
 'https://aacpdappls.net.ms.gov.br/appls/legislacao/serc/legato.nsf/23b657614c182061042579c80053770d/9b9e5fd2565751de042579cf004d33a6', null,
 'calendario', null, null, 'RICMS/MS (Decreto nº 9.203/1998), Anexo VIII, art. 1º, I — datas do Calendário Fiscal',
 'https://aacpdappls.net.ms.gov.br/appls/legislacao/serc/legato.nsf/34248fea4d6a6d2a04256b210079ce20/e7986f976b7e0c5804256afc0070c638?OpenDocument',
 'O ICMS apurado vence nas datas do Calendário Fiscal, fixadas periodicamente pela SEFAZ-MS: não há um dia fixo. Para empresas de MS, cadastre as datas de cada calendário.', '2026-10-03'),

('MG', 'Minas Gerais', 'SE', 18, null, null, 'conferida', null,
 'RICMS/2023 (Decreto nº 48.589/2023), art. 11, I, e Anexo I, Parte 1, item 7, subitem 7.1',
 'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexoi2023_2.html', null,
 'conferido', 8, 'postergar', 'RICMS/2023 (Decreto nº 48.589/2023), art. 112, I, "d", e art. 118',
 'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/regulamento2023_2.html',
 'Comércio atacadista e varejista, indústria e transporte. Atividades não especificadas: dia 10 (art. 112, I, "g"). Atacadista de combustíveis, bebidas ou cigarros, extração mineral e comunicação: dia 5. Os prazos só vencem em dia de expediente bancário.', '2026-10-03'),

('PA', 'Pará', 'N', 19, null, null, 'informada', null,
 'Lei nº 5.530/1989, art. 12 (alíquota modal elevada de 17% para 19% pela Lei nº 9.755/2022) — conforme notícia oficial da Assembleia Legislativa do Pará',
 'https://www.alepa.pa.gov.br/Comunicacao/Noticia/5255/alepa-aprova-pl-que-reajusta-aliquota-de-icms-mas-projeto-mantem-preco-da-cesta-basica',
 'Confira o texto da lei e a data de efeitos.',
 'a_conferir', null, null, 'RICMS/PA (Decreto nº 4.676/2001)', 'https://www.sefa.pa.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('PB', 'Paraíba', 'NE', 20, null, null, 'informada', null,
 'Lei nº 6.379/1996 (PB) — conforme o Portal Nacional do DIFAL (atualizado pela Paraíba em 01/01/2024)',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', 'Adicional de 2 pontos (fundo de pobreza) só em produtos específicos.',
 'a_conferir', null, null, 'RICMS/PB (Decreto nº 18.930/1997)', 'https://www.sefaz.pb.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('PR', 'Paraná', 'S', 19.5, null, null, 'conferida', '2024-03-18',
 'RICMS/PR (Decreto nº 7.871/2017), art. 17, V (Lei nº 21.850/2023)',
 'https://www.sefanet.pr.gov.br/dados/SEFADOCUMENTOS/106201707871.pdf', 'De 13/03/2023 a 17/03/2024, 19%. Adicional de 2 pontos (FECOP) só em produtos específicos.',
 'conferido', 12, 'postergar', 'RICMS/PR (Decreto nº 7.871/2017), art. 74, XIX',
 'https://www.sefanet.pr.gov.br/dados/SEFADOCUMENTOS/106201707871.pdf',
 'Regra geral ("demais casos"). O regulamento não traz regra própria para dia não útil: aplicada a regra geral do CTN (art. 210, parágrafo único), que leva ao dia útil seguinte.', '2026-10-03'),

('PE', 'Pernambuco', 'NE', 20.5, null, null, 'conferida', '2024-01-01',
 'Lei nº 15.730/2016, art. 15, VII (redação da Lei nº 18.305/2023)',
 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/legislacao/Leis_Tributarias/2016/Lei15730_2016.htm', 'Até 31/12/2023, 18%.',
 'conferido', 15, 'postergar', 'RICMS/PE (Decreto nº 44.650/2017), art. 23, caput e § 2º, I',
 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/legislacao/44650/texto/Dec44650_2017.htm',
 'Regra geral. Indústria: prazos por CNAE no art. 24 (dia 15, 20 ou 25). Em dia não útil, até o primeiro dia útil seguinte, dentro do mesmo mês.', '2026-10-03'),

('PI', 'Piauí', 'NE', 22.5, null, null, 'informada', null,
 'Lei nº 4.257/1989, art. 23 (alíquota modal alterada pela Lei nº 8.558/2024) — conforme o Portal Nacional do DIFAL e a Assembleia Legislativa do Piauí',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', 'Antes, 21%. Confira a data de efeitos no texto da lei.',
 'a_conferir', null, null, 'RICMS/PI (Decreto nº 21.866/2023)', 'https://portal.sefaz.pi.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('RJ', 'Rio de Janeiro', 'SE', 20, 2, 'FECP: adicional de 2 pontos (Lei nº 4.056/2002), conforme o Portal Nacional do DIFAL. Confira as exceções.', 'informada', null,
 'Lei nº 2.657/1996, art. 14 (alíquota modal elevada de 18% para 20% pela Lei nº 10.253/2023) — conforme notícia oficial da ALERJ',
 'https://www.alerj.rj.gov.br/Visualizar/Noticia/62648',
 'O Portal Nacional do DIFAL ainda mostra 18% + 2% (2021). Confira a data de efeitos no texto da lei.',
 'a_conferir', null, null, 'Regulamento do ICMS/RJ (Decreto nº 27.427/2000)', 'https://portal.fazenda.rj.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('RN', 'Rio Grande do Norte', 'NE', 20, null, null, 'conferida', '2025-03-20',
 'Lei nº 6.968/1996, art. 27, I, "a" (redação da Lei nº 11.999/2024, publicada em 20/12/2024, com efeitos 90 dias depois)',
 'https://www.al.rn.leg.br/storage/legislacao/2025/stqpzaxnkhj8e1efdy6wnsk815m85v.pdf', 'Adicional de 2 pontos (FECOP, art. 27-A) só em produtos específicos.',
 'a_conferir', null, null, 'Regulamento do ICMS do RN', 'https://www.set.rn.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('RS', 'Rio Grande do Sul', 'S', 17, null, null, 'a_conferir', null,
 'Lei nº 8.820/1989, art. 27; RICMS/RS, Livro I, art. 27, X — conforme o Portal Nacional do DIFAL',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', 'A última informação do RS no Portal Nacional do DIFAL é de 30/12/2021: confira se houve alteração.',
 'a_conferir', null, null, 'RICMS/RS (Decreto nº 37.699/1997), Livro I, art. 46', 'https://www.legislacao.sefaz.rs.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('RO', 'Rondônia', 'N', 19.5, null, null, 'conferida', '2024-01-12',
 'RICMS/RO (Decreto nº 22.721/2018), art. 12, I, "e" (redação do Decreto nº 29.048/2024)',
 'https://www.sefin.ro.gov.br/portalsefin/anexos/D24-29048---Adequa-o-RICMS-RO-a-nova-aliquota-modal-do-imposto;-prorroga-beneficios-fiscais;-e-reduz-a-MVA-de-alguns-itens.pdf',
 'Até 11/01/2024, 17,5%.',
 'conferido', 20, 'postergar', 'RICMS/RO (Decreto nº 22.721/2018), art. 57, XI, "a", e § 9º',
 'https://www.sefin.ro.gov.br/portalsefin/anexos/D18-22721-DECRETO--NOVO-RICMS---Consolid.-ate-Dec.-27465-22.pdf',
 'Apuração mensal (comércio, indústria, energia, transporte e comunicação). Só prorroga se não houver expediente bancário no município. Texto consolidado até 2022: confira alterações posteriores.', '2026-10-03'),

('RR', 'Roraima', 'N', 20, null, null, 'conferida', '2023-03-30',
 'Lei nº 59/1993 (Código Tributário de RR), art. 32, I, "d" (redação da Lei nº 1.767/2022)',
 'https://www.sefaz.rr.gov.br/downloads/legislacao?dir=02%20-%20LEGISLACAO%20ESTADUAL%2F02%20-%20CODIGO%20TRIBUTARIO%20ESTADUAL%20-%20ATUALIZADO%20-%20LEI%20N%2059-93', null,
 'conferido', 20, 'postergar', 'RICMS/RR (Decreto nº 4.335/2001), art. 71, I, e § 1º',
 'https://www.sefaz.rr.gov.br/downloads/legislacao?dir=02%20-%20LEGISLACAO%20ESTADUAL%2F03%20-%20REGULAMENTO%20DE%20ICMS%20-%20ATUALIZADO%20-%20DECRETO%204.335%202001',
 'Indústria, comércio, serviços, energia, combustíveis, estimativa e cooperativas. Sábado, domingo ou feriado (inclusive bancário): dia útil seguinte.', '2026-10-03'),

('SC', 'Santa Catarina', 'S', 17, null, null, 'conferida', null,
 'RICMS/SC (Decreto nº 2.870/2001), art. 26, I',
 'https://legislacao.sef.sc.gov.br/html/regulamentos/icms/ricms_01_00.htm', null,
 'conferido', 10, 'postergar', 'RICMS/SC (Decreto nº 2.870/2001), art. 60',
 'https://legislacao.sef.sc.gov.br/html/regulamentos/icms/ricms_01_00.htm',
 'Até o 10º dia após o fim do período de apuração. O regulamento não traz regra própria para dia não útil: aplicada a regra geral do CTN (art. 210, parágrafo único), que leva ao dia útil seguinte.', '2026-10-03'),

('SP', 'São Paulo', 'SE', 18, null, null, 'conferida', null,
 'RICMS/2000 (Decreto nº 45.490/2000), art. 52, I',
 'https://legislacao.fazenda.sp.gov.br/Paginas/RC29299_2024.aspx', null,
 'conferido', 20, 'postergar', 'RICMS/2000 (Decreto nº 45.490/2000), Anexo IV, arts. 1º a 3º (CPR 1200)',
 'https://legislacao.fazenda.sp.gov.br/Paginas/l6an4.aspx',
 'O prazo depende do Código de Prazo de Recolhimento (CPR) da atividade (CNAE). CPR 1200 (dia 20) vale para a maior parte do comércio e dos serviços; outros: CPR 1250 (dia 25), 1220 (dia 22), 1210 (dia 21), 1150 (dia 15), 1100 (dia 10), 1090 (dia 9) e 1031 (3º dia útil). Confira o CPR da empresa.', '2026-10-03'),

('SE', 'Sergipe', 'NE', 19, null, 'Adicional de 1 ou 2 pontos (fundo de pobreza) conforme os arts. 40-C e 40-D do RICMS/SE.', 'informada', null,
 'Lei nº 3.796/1996, art. 18; RICMS/SE (Decreto nº 21.400/2002), art. 40 — conforme o Portal Nacional do DIFAL (atualizado por Sergipe em 28/08/2024)',
 'https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas', null,
 'a_conferir', null, null, 'RICMS/SE (Decreto nº 21.400/2002)', 'https://www.sefaz.se.gov.br/', 'Prazo ainda não conferido no texto oficial: confira no regulamento e cadastre.', '2026-10-03'),

('TO', 'Tocantins', 'N', 20, null, null, 'conferida', '2024-01-01',
 'Lei nº 1.287/2001, art. 27, II (redação da Lei nº 4.141/2023)',
 'https://www.al.to.leg.br/arquivo/62676', 'Aplicada a partir de 01/01/2024 (STF, ADI 7.375). Adicional de 2 pontos (fundo de pobreza) só em produtos específicos.',
 'a_conferir', null, null, 'RICMS/TO (Decreto nº 2.912/2006)', 'https://dtri.sefaz.to.gov.br/legislacao/ntributaria/decretos/Decreto2.912-06.htm',
 'O site da SEFAZ-TO não abriu a partir do servidor do portal: confira o prazo no RICMS/TO e cadastre.', '2026-10-03');

-- -----------------------------------------------------------------------------
-- Propostas de regra para os estados com prazo conferido (aguardam validação)
-- -----------------------------------------------------------------------------
create or replace function pg_temp.propor_icms(p_uf text)
returns void
language plpgsql
as $$
declare
  p record;
  r public.obrigacao_regras;
  v_obr uuid := (select id from public.obrigacoes where codigo = 'ICMS');
begin
  if v_obr is null then
    return;
  end if;
  select * into p from app.icms_regra_proposta(p_uf);
  r := app.preencher_regra(r, p.regra);
  insert into public.obrigacao_regras (
    obrigacao_id, vigencia_inicio, vigencia_fim, regimes, ufs, municipios, empresa_id,
    exige_empregados, exige_folha, exige_icms, exige_iss, lucro_real_apuracao, servico,
    prazo_entrega, prazo_pagamento, prazo_apuracao, prazo_interno_dias_uteis,
    fonte_titulo, fonte_url, fonte_consultada_em, observacao, status, criada_por)
  values (
    v_obr, r.vigencia_inicio, r.vigencia_fim, r.regimes, r.ufs, r.municipios, null,
    r.exige_empregados, r.exige_folha, r.exige_icms, r.exige_iss, r.lucro_real_apuracao, r.servico,
    r.prazo_entrega, r.prazo_pagamento, r.prazo_apuracao, r.prazo_interno_dias_uteis,
    p.fonte_titulo, p.fonte_url, p.fonte_consultada_em, r.observacao, 'rascunho', null)
  returning id into r.id;
  insert into public.atualizacoes_normativas (titulo, resumo, tipo, obrigacao_id, regra_proposta_id, vigencia_inicio,
                                              fonte_titulo, fonte_url, fonte_consultada_em, proposta_por)
  values (p.titulo, p.resumo, 'nova_regra', v_obr, r.id, r.vigencia_inicio, p.fonte_titulo, p.fonte_url, p.fonte_consultada_em, null);
end;
$$;

select pg_temp.propor_icms(uf) from public.icms_uf where vencimento_situacao = 'conferido' order by uf;

-- O catálogo passa a apontar para a tabela de referência
update public.obrigacoes
   set descricao = 'O prazo é definido pela legislação de cada estado: veja Obrigações > ICMS por estado (prazos conferidos com a fonte viram proposta de regra para validar). Reforma tributária: redução gradual de 2029 a 2032 e extinção em 2033 (EC nº 132/2023); o histórico permanece.'
 where codigo = 'ICMS';
