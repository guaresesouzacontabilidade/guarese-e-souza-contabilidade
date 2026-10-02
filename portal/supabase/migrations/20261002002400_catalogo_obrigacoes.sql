-- =============================================================================
-- Catálogo inicial de obrigações, feriados e transição da reforma tributária
--
-- As regras de prazo entram como PROPOSTAS (atualizações normativas) com a
-- fonte oficial e a data de consulta. Nenhuma vale antes de um administrador
-- conferir a fonte, validar e aplicar em Obrigações → Atualizações normativas.
-- ICMS, ISS e EFD ICMS/IPI ficam sem regra: cada estado e município define o
-- prazo, que deve ser cadastrado com a fonte. CBS e IBS seguem a vigência da
-- EC nº 132/2023 e da LC nº 214/2025; PIS/Cofins, ICMS e ISS continuam no
-- histórico das competências em que se aplicam.
--
-- Fontes consultadas em 02/10/2026.
-- =============================================================================

-- Feriados nacionais (e do Tocantins) de 2024 a 2030. Carnaval e Corpus Christi
-- não são feriados nacionais por lei: contam só para regras que dependem de
-- expediente bancário. Feriados municipais devem ser cadastrados pelo escritório.
insert into public.feriados (data, nome, abrangencia, uf, tipo, fonte) values
('2024-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-02-12', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2024-02-13', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2024-03-29', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2024-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-05-30', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2024-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2024-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2024-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2024-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2024-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989'),
('2025-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-03-03', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2025-03-04', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2025-04-18', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2025-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-06-19', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2025-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2025-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2025-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2025-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2025-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989'),
('2026-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-02-16', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2026-02-17', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2026-04-03', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2026-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-06-04', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2026-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2026-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2026-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2026-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2026-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989'),
('2027-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-02-08', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2027-02-09', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2027-03-26', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2027-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-05-27', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2027-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2027-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2027-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2027-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2027-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989'),
('2028-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-02-28', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2028-02-29', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2028-04-14', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2028-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-06-15', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2028-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2028-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2028-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2028-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2028-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989'),
('2029-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-02-12', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2029-02-13', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2029-03-30', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2029-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-05-31', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2029-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2029-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2029-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2029-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2029-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989'),
('2030-01-01', 'Confraternização Universal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-03-04', 'Carnaval (segunda-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2030-03-05', 'Carnaval (terça-feira)', 'nacional', null, 'sem_expediente_bancario', 'Resolução CMN nº 4.880/2020 (dias não úteis para operações bancárias); ponto facultativo federal'),
('2030-04-19', 'Paixão de Cristo (Sexta-feira Santa)', 'nacional', null, 'feriado', 'Lei nº 9.093/1995, art. 2º; portaria anual de feriados do Governo Federal'),
('2030-04-21', 'Tiradentes', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-05-01', 'Dia do Trabalho', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-06-20', 'Corpus Christi', 'nacional', null, 'sem_expediente_bancario', 'Calendário de feriados bancários nacionais (Febraban); ponto facultativo federal'),
('2030-09-07', 'Independência do Brasil', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-10-12', 'Nossa Senhora Aparecida', 'nacional', null, 'feriado', 'Lei nº 6.802/1980'),
('2030-11-02', 'Finados', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-11-15', 'Proclamação da República', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', null, 'feriado', 'Lei nº 14.759/2023'),
('2030-12-25', 'Natal', 'nacional', null, 'feriado', 'Lei nº 662/1949, art. 1º (redação da Lei nº 10.607/2002)'),
('2030-09-08', 'Nossa Senhora da Natividade (padroeira do Tocantins)', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 627/1993'),
('2030-10-05', 'Criação do Estado do Tocantins', 'estadual', 'TO', 'feriado', 'Lei estadual (TO) nº 98/1989')
on conflict do nothing;

-- Obrigações
insert into public.obrigacoes (codigo, nome, descricao, esfera, area, tributos, etapas, periodicidade, categorias_documento) values
('SN_DAS', 'Simples Nacional — PGDAS-D e DAS', 'Apuração mensal no PGDAS-D, transmissão da declaração e pagamento do DAS.', 'federal', 'fiscal', '{SIMPLES}', '{apuracao,entrega,pagamento}', 'mensal', '{esc_guia,esc_protocolo}'),
('SN_DEFIS', 'DEFIS (Simples Nacional)', 'Declaração de Informações Socioeconômicas e Fiscais do ano-base (competência de dezembro).', 'federal', 'fiscal', '{SIMPLES}', '{apuracao,entrega}', 'anual', '{esc_protocolo}'),
('MEI_DAS', 'MEI — DAS mensal', 'Pagamento mensal do DAS do Microempreendedor Individual.', 'federal', 'fiscal', '{SIMPLES}', '{pagamento}', 'mensal', '{esc_guia}'),
('MEI_DASN', 'DASN-SIMEI (MEI)', 'Declaração anual do MEI referente ao ano-base (competência de dezembro).', 'federal', 'fiscal', '{SIMPLES}', '{entrega}', 'anual', '{esc_protocolo}'),
('PIS_COFINS', 'PIS/Pasep e Cofins — apuração e DARF', 'Apuração mensal e pagamento do PIS/Pasep e da Cofins (regimes cumulativo e não cumulativo). Extintos a partir de 2027 pela reforma tributária (substituídos pela CBS); as competências até dezembro de 2026 continuam no histórico.', 'federal', 'fiscal', '{PIS,COFINS}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('EFD_CONTRIB', 'EFD-Contribuições', 'Escrituração Fiscal Digital do PIS/Pasep e da Cofins. Confira as hipóteses de dispensa na instrução normativa. O encerramento após a extinção do PIS/Cofins depende de norma da Receita Federal.', 'federal', 'fiscal', '{PIS,COFINS}', '{apuracao,entrega}', 'mensal', '{esc_protocolo}'),
('IRPJ_CSLL_TRIM', 'IRPJ e CSLL — trimestrais', 'Apuração trimestral (Lucro Presumido, Lucro Arbitrado e Lucro Real trimestral). Pagamento em quota única ou em até três quotas; a 1ª ou única vence no prazo abaixo.', 'federal', 'contabil', '{IRPJ,CSLL}', '{apuracao,pagamento}', 'trimestral', '{esc_guia}'),
('IRPJ_CSLL_EST', 'IRPJ e CSLL — estimativa mensal (Lucro Real anual)', 'Recolhimento mensal por estimativa (ou balancete de suspensão/redução) de quem apura o Lucro Real anualmente.', 'federal', 'contabil', '{IRPJ,CSLL}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('IRPJ_CSLL_AJUSTE', 'IRPJ e CSLL — saldo do ajuste anual (Lucro Real anual)', 'Saldo do imposto e da contribuição apurados em 31 de dezembro (competência de dezembro).', 'federal', 'contabil', '{IRPJ,CSLL}', '{apuracao,pagamento}', 'anual', '{esc_guia}'),
('DCTFWEB', 'DCTFWeb', 'Declaração mensal de débitos federais, alimentada pelo eSocial, pela EFD-Reinf e pelo MIT (desde 2025 substitui a DCTF).', 'federal', 'fiscal', '{INSS,IRRF,IRPJ,CSLL,PIS,COFINS}', '{apuracao,entrega}', 'mensal', '{esc_protocolo}'),
('INSS_DARF', 'Contribuições previdenciárias e IRRF da folha (DARF da DCTFWeb)', 'DARF numerado emitido a partir da DCTFWeb com as contribuições sobre a folha e o pró-labore.', 'federal', 'pessoal', '{INSS,IRRF}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('FGTS', 'FGTS Digital — guia mensal', 'Guia do FGTS Digital gerada a partir das informações do eSocial (empregados).', 'federal', 'pessoal', '{FGTS}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('ESOCIAL', 'eSocial — eventos periódicos da folha', 'Remuneração, pagamentos e fechamento dos eventos periódicos (S-1200, S-1210, S-1299).', 'federal', 'pessoal', '{INSS,FGTS,IRRF}', '{apuracao,entrega}', 'mensal', '{esc_folha,esc_protocolo}'),
('EFD_REINF', 'EFD-Reinf', 'Retenções e informações fiscais (serviços com cessão de mão de obra, CPRB, pagamentos e retenções da série R-4000). Só é exigida quando há fatos a informar: sem movimento, dispense a tarefa informando o motivo.', 'federal', 'fiscal', '{INSS,IRRF,CSLL,PIS,COFINS}', '{apuracao,entrega}', 'mensal', '{esc_protocolo}'),
('ECD', 'ECD — Escrituração Contábil Digital', 'Livro Diário e demonstrações do ano-base (competência de dezembro). Lucro Presumido: obrigatória se distribuir lucros sem imposto acima da base presumida — inclua na empresa quando for o caso.', 'federal', 'contabil', '{}', '{apuracao,entrega}', 'anual', '{esc_protocolo,esc_relatorio}'),
('ECF', 'ECF — Escrituração Contábil Fiscal', 'Escrituração fiscal do IRPJ e da CSLL do ano-base (competência de dezembro).', 'federal', 'contabil', '{IRPJ,CSLL}', '{apuracao,entrega}', 'anual', '{esc_protocolo}'),
('ICMS', 'ICMS — apuração e recolhimento', 'O prazo é definido pela legislação de cada estado: cadastre a regra do estado com a fonte oficial. Reforma tributária: redução gradual de 2029 a 2032 e extinção em 2033 (EC nº 132/2023); o histórico permanece.', 'estadual', 'fiscal', '{ICMS}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('EFD_ICMS_IPI', 'EFD ICMS/IPI (SPED Fiscal)', 'O prazo de entrega é definido por cada estado: cadastre a regra do estado com a fonte oficial.', 'estadual', 'fiscal', '{ICMS,IPI}', '{apuracao,entrega}', 'mensal', '{esc_protocolo}'),
('ISS', 'ISS — apuração e recolhimento', 'O prazo é definido pela legislação de cada município: cadastre a regra do município com a fonte oficial. Reforma tributária: redução gradual de 2029 a 2032 e extinção em 2033 (EC nº 132/2023); o histórico permanece.', 'municipal', 'fiscal', '{ISS}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('ISS_DECLARACAO', 'Declaração mensal de serviços (ISS)', 'Nome e prazo variam por município (ex.: declaração de serviços prestados e tomados). Cadastre a regra do município com a fonte oficial.', 'municipal', 'fiscal', '{ISS}', '{apuracao,entrega}', 'mensal', '{esc_protocolo}'),
('CBS_IBS_TESTE', 'CBS e IBS — destaque nas notas (ano de teste 2026)', 'Em 2026 a CBS (0,9%) e o IBS (0,1%) são destacados nos documentos fiscais em caráter de teste. Não há prazo legal de pagamento nesta fase; a tarefa é a conferência mensal do destaque, com meta interna do escritório.', 'nacional', 'fiscal', '{CBS,IBS}', '{apuracao}', 'mensal', '{}'),
('CBS', 'CBS — apuração e recolhimento', 'Contribuição sobre Bens e Serviços, que substitui o PIS/Cofins a partir de 2027.', 'federal', 'fiscal', '{CBS}', '{apuracao,pagamento}', 'mensal', '{esc_guia}'),
('IBS', 'IBS — apuração e recolhimento', 'Imposto sobre Bens e Serviços (estados e municípios, gestão compartilhada). Em 2027 e 2028 à alíquota de 0,1%; transição de 2029 a 2032; substitui ICMS e ISS em 2033.', 'nacional', 'fiscal', '{IBS}', '{apuracao,pagamento}', 'mensal', '{esc_guia}')
on conflict (codigo) do nothing;

-- Regras propostas (aguardam validação)
create or replace function pg_temp.propor(p_codigo text, p_titulo text, p_resumo text, p_regra jsonb, p_fonte text, p_url text)
returns void
language plpgsql
as $$
declare
  r public.obrigacao_regras;
  v_obr uuid := (select id from public.obrigacoes where codigo = p_codigo);
begin
  r := app.preencher_regra(r, p_regra);
  insert into public.obrigacao_regras (
    obrigacao_id, vigencia_inicio, vigencia_fim, regimes, ufs, municipios, empresa_id,
    exige_empregados, exige_folha, exige_icms, exige_iss, lucro_real_apuracao, servico,
    prazo_entrega, prazo_pagamento, prazo_apuracao, prazo_interno_dias_uteis,
    fonte_titulo, fonte_url, fonte_consultada_em, observacao, status, criada_por)
  values (
    v_obr, r.vigencia_inicio, r.vigencia_fim, r.regimes, r.ufs, r.municipios, null,
    r.exige_empregados, r.exige_folha, r.exige_icms, r.exige_iss, r.lucro_real_apuracao, r.servico,
    r.prazo_entrega, r.prazo_pagamento, r.prazo_apuracao, r.prazo_interno_dias_uteis,
    p_fonte, p_url, '2026-10-02', r.observacao, 'rascunho', null)
  returning id into r.id;
  insert into public.atualizacoes_normativas (titulo, resumo, tipo, obrigacao_id, regra_proposta_id, vigencia_inicio,
                                              fonte_titulo, fonte_url, fonte_consultada_em, proposta_por)
  values (p_titulo, p_resumo, 'nova_regra', v_obr, r.id, r.vigencia_inicio, p_fonte, p_url, '2026-10-02', null);
end;
$$;

select pg_temp.propor('SN_DAS', 'Simples Nacional: PGDAS-D e DAS até o dia 20 do mês seguinte', 'O DAS vence no dia 20 do mês seguinte ao da receita; sem expediente bancário nesse dia, vence no dia útil seguinte. O PGDAS-D deve ser transmitido até o vencimento do DAS.', '{"vigencia_inicio": "2025-01-01", "regimes": ["simples_nacional"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "prazo_entrega": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 20, "ajuste": "postergar", "calendario": "expediente_bancario", "feriados": "nacional"}, "prazo_pagamento": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 20, "ajuste": "postergar", "calendario": "expediente_bancario", "feriados": "nacional"}}'::jsonb, 'Resolução CGSN nº 140/2018, art. 38, § 1º, e art. 40, caput e § 3º; LC nº 123/2006, art. 21, III', 'http://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278');
select pg_temp.propor('SN_DEFIS', 'DEFIS até 31 de março do ano seguinte', 'Entregue até 31 de março do ano-calendário seguinte ao dos fatos geradores. A norma não prevê prorrogação quando a data cai em fim de semana.', '{"vigencia_inicio": "2025-12-01", "regimes": ["simples_nacional"], "servico": "fiscal", "prazo_interno_dias_uteis": 10, "prazo_entrega": {"tipo": "dia_fixo", "meses_apos": 3, "dia": 31, "ajuste": "manter", "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Resolução CGSN nº 140/2018, art. 72', 'http://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278');
select pg_temp.propor('MEI_DAS', 'DAS do MEI até o dia 20 do mês seguinte', 'Mesma regra de vencimento do Simples Nacional: dia 20 do mês seguinte; sem expediente bancário, dia útil seguinte.', '{"vigencia_inicio": "2025-01-01", "regimes": ["mei"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "prazo_pagamento": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 20, "ajuste": "postergar", "calendario": "expediente_bancario", "feriados": "nacional"}}'::jsonb, 'Resolução CGSN nº 140/2018, art. 40, caput e § 3º', 'http://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278');
select pg_temp.propor('MEI_DASN', 'DASN-SIMEI até o último dia de maio', 'O MEI apresenta a declaração anual até o último dia de maio do ano seguinte.', '{"vigencia_inicio": "2025-12-01", "regimes": ["mei"], "servico": "fiscal", "prazo_interno_dias_uteis": 10, "prazo_entrega": {"tipo": "dia_fixo", "meses_apos": 5, "dia": 31, "ajuste": "manter", "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Resolução CGSN nº 140/2018, art. 109', 'http://normas.receita.fazenda.gov.br/sijut2consulta/link.action?idAto=92278');
select pg_temp.propor('PIS_COFINS', 'PIS/Cofins até o dia 25 do mês seguinte (até a competência 12/2026)', 'Pagamento até o 25º dia do mês seguinte; se não for dia útil, antecipa para o dia útil anterior. Vigência encerrada na competência de dezembro de 2026: a EC nº 132/2023 extingue as contribuições a partir de 2027.', '{"vigencia_inicio": "2025-01-01", "vigencia_fim": "2026-12-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "prazo_pagamento": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 25, "ajuste": "antecipar", "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'MP nº 2.158-35/2001, art. 18; Lei nº 10.637/2002, art. 10; Lei nº 10.833/2003, art. 11 (redação da Lei nº 11.933/2009); EC nº 132/2023 (extinção em 2027)', 'https://www.planalto.gov.br/ccivil_03/_ato2007-2010/2009/lei/l11933.htm');
select pg_temp.propor('EFD_CONTRIB', 'EFD-Contribuições até o 10º dia útil do 2º mês seguinte', 'Transmissão mensal ao Sped até o 10º dia útil do segundo mês subsequente ao da escrituração.', '{"vigencia_inicio": "2025-01-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "prazo_entrega": {"tipo": "dia_util", "meses_apos": 2, "dia": 10, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Instrução Normativa RFB nº 1.252/2012, art. 7º', null);
select pg_temp.propor('IRPJ_CSLL_TRIM', 'IRPJ e CSLL trimestrais até o último dia útil do mês seguinte ao trimestre', 'Quota única (ou 1ª quota) até o último dia útil do mês subsequente ao encerramento do trimestre. No Lucro Real, só para quem apura trimestralmente.', '{"vigencia_inicio": "2025-01-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "lucro_real_apuracao": "trimestral", "servico": "contabil", "prazo_interno_dias_uteis": 3, "prazo_pagamento": {"tipo": "ultimo_dia_util", "meses_apos": 1, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Lei nº 9.430/1996, arts. 1º, 5º e 28', 'https://www.planalto.gov.br/ccivil_03/leis/l9430.htm');
select pg_temp.propor('IRPJ_CSLL_EST', 'Estimativa mensal de IRPJ e CSLL até o último dia útil do mês seguinte', 'Pagamento da estimativa até o último dia útil do mês subsequente. Só para Lucro Real com apuração anual.', '{"vigencia_inicio": "2025-01-01", "regimes": ["lucro_real"], "lucro_real_apuracao": "anual", "servico": "contabil", "prazo_interno_dias_uteis": 3, "prazo_pagamento": {"tipo": "ultimo_dia_util", "meses_apos": 1, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Lei nº 9.430/1996, arts. 2º, 6º e 28', 'https://www.planalto.gov.br/ccivil_03/leis/l9430.htm');
select pg_temp.propor('IRPJ_CSLL_AJUSTE', 'Saldo do ajuste anual até o último dia útil de março', 'O saldo apurado em 31 de dezembro é pago até o último dia útil de março do ano seguinte.', '{"vigencia_inicio": "2025-12-01", "regimes": ["lucro_real"], "lucro_real_apuracao": "anual", "servico": "contabil", "prazo_interno_dias_uteis": 5, "prazo_pagamento": {"tipo": "ultimo_dia_util", "meses_apos": 3, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Lei nº 9.430/1996, art. 6º, § 1º, I, e art. 28', 'https://www.planalto.gov.br/ccivil_03/leis/l9430.htm');
select pg_temp.propor('DCTFWEB', 'DCTFWeb até o último dia útil do mês seguinte (Lucro Presumido, Real e Arbitrado)', 'Apresentação mensal até o último dia útil do mês seguinte ao dos fatos geradores.', '{"vigencia_inicio": "2025-02-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado", "imune_isenta"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "prazo_entrega": {"tipo": "ultimo_dia_util", "meses_apos": 1, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Instrução Normativa RFB nº 2.237/2024, art. 6º (redação da IN RFB nº 2.248/2025)', 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2025/fevereiro/contribuintes-ganham-mais-tempo-para-entregar-a-dctfweb');
select pg_temp.propor('DCTFWEB', 'DCTFWeb até o último dia útil do mês seguinte (Simples e MEI com folha)', 'Optantes pelo Simples Nacional e MEI apresentam a DCTFWeb quando há folha (empregados ou pró-labore), no mesmo prazo.', '{"vigencia_inicio": "2025-02-01", "regimes": ["simples_nacional", "mei"], "exige_folha": true, "servico": "folha", "prazo_interno_dias_uteis": 3, "prazo_entrega": {"tipo": "ultimo_dia_util", "meses_apos": 1, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Instrução Normativa RFB nº 2.237/2024, art. 6º (redação da IN RFB nº 2.248/2025)', 'https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2025/fevereiro/contribuintes-ganham-mais-tempo-para-entregar-a-dctfweb');
select pg_temp.propor('INSS_DARF', 'Contribuições previdenciárias da empresa até o dia 20 do mês seguinte', 'Recolhimento até o dia 20 do mês seguinte ao da competência; sem expediente bancário, antecipa para o dia útil anterior.', '{"vigencia_inicio": "2025-01-01", "regimes": ["simples_nacional", "lucro_presumido", "lucro_real", "lucro_arbitrado", "imune_isenta"], "exige_folha": true, "servico": "folha", "prazo_interno_dias_uteis": 2, "prazo_pagamento": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 20, "ajuste": "antecipar", "calendario": "expediente_bancario", "feriados": "nacional"}}'::jsonb, 'Lei nº 8.212/1991, art. 30, I, "b", e § 2º', 'https://www.planalto.gov.br/ccivil_03/leis/l8212cons.htm');
select pg_temp.propor('FGTS', 'FGTS Digital até o dia 20 do mês seguinte', 'Recolhimento até o dia 20 do mês seguinte ao da competência; quando não for dia útil, antecipa para o dia útil anterior.', '{"vigencia_inicio": "2025-01-01", "regimes": ["mei", "simples_nacional", "lucro_presumido", "lucro_real", "lucro_arbitrado", "imune_isenta"], "exige_empregados": true, "servico": "folha", "prazo_interno_dias_uteis": 2, "prazo_pagamento": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 20, "ajuste": "antecipar", "calendario": "expediente_bancario", "feriados": "nacional"}}'::jsonb, 'Lei nº 8.036/1990, art. 15 (redação da Lei nº 14.438/2022); Manual do FGTS Digital', 'https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm');
select pg_temp.propor('ESOCIAL', 'eSocial periódico até o dia 15 do mês seguinte', 'Eventos periódicos até o dia 15 do mês seguinte; sem expediente bancário nesse dia, antecipa para o dia útil anterior.', '{"vigencia_inicio": "2025-01-01", "regimes": ["mei", "simples_nacional", "lucro_presumido", "lucro_real", "lucro_arbitrado", "imune_isenta"], "exige_folha": true, "servico": "folha", "prazo_interno_dias_uteis": 3, "prazo_entrega": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 15, "ajuste": "antecipar", "calendario": "expediente_bancario", "feriados": "nacional"}}'::jsonb, 'Manual de Orientação do eSocial (MOS) — prazos dos eventos periódicos', null);
select pg_temp.propor('EFD_REINF', 'EFD-Reinf até o dia 15 do mês seguinte', 'Transmissão mensal até o dia 15 do mês seguinte; se não for dia útil, passa para o primeiro dia útil seguinte.', '{"vigencia_inicio": "2025-01-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "prazo_entrega": {"tipo": "dia_fixo", "meses_apos": 1, "dia": 15, "ajuste": "postergar", "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Instrução Normativa RFB nº 2.043/2021, art. 6º, § 2º (redação da IN RFB nº 2.163/2023)', null);
select pg_temp.propor('ECD', 'ECD até o último dia útil de junho', 'Transmissão ao Sped até o último dia útil de junho do ano seguinte ao ano-calendário.', '{"vigencia_inicio": "2025-12-01", "regimes": ["lucro_real"], "servico": "contabil", "prazo_interno_dias_uteis": 10, "prazo_entrega": {"tipo": "ultimo_dia_util", "meses_apos": 6, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Instrução Normativa RFB nº 2.003/2021, art. 5º', 'http://sped.rfb.gov.br/pagina/show/499');
select pg_temp.propor('ECF', 'ECF até o último dia útil de julho', 'Transmissão ao Sped até o último dia útil de julho do ano seguinte ao ano-calendário.', '{"vigencia_inicio": "2025-12-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado", "imune_isenta"], "servico": "contabil", "prazo_interno_dias_uteis": 10, "prazo_entrega": {"tipo": "ultimo_dia_util", "meses_apos": 7, "calendario": "dia_util", "feriados": "nacional"}}'::jsonb, 'Instrução Normativa RFB nº 2.004/2021, art. 3º', null);
select pg_temp.propor('CBS_IBS_TESTE', 'CBS e IBS em 2026: conferência mensal do destaque (meta interna)', 'Sem prazo legal de recolhimento no ano de teste. A meta de conferência (5º dia útil do mês seguinte) é interna do escritório, não é prazo legal.', '{"vigencia_inicio": "2026-01-01", "vigencia_fim": "2026-12-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "servico": "fiscal", "prazo_interno_dias_uteis": 2, "prazo_apuracao": {"tipo": "dia_util", "meses_apos": 1, "dia": 5, "calendario": "dia_util", "feriados": "municipal"}, "observacao": "Meta interna do escritório para conferir o destaque nas notas emitidas; não é prazo legal."}'::jsonb, 'ADCT, art. 125 (EC nº 132/2023); Lei Complementar nº 214/2025', 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm');
select pg_temp.propor('CBS', 'CBS a partir da competência 01/2027 (prazo a regulamentar)', 'A CBS passa a ser cobrada em 2027. O prazo de recolhimento depende de regulamentação: enquanto não houver, o calendário mostra "prazo a regulamentar" e nenhuma data é presumida.', '{"vigencia_inicio": "2027-01-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "observacao": "Prazo de recolhimento a ser fixado em regulamento."}'::jsonb, 'ADCT, arts. 125 a 127 (EC nº 132/2023); Lei Complementar nº 214/2025', 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm');
select pg_temp.propor('IBS', 'IBS a partir da competência 01/2027 (prazo a regulamentar)', 'O IBS passa a ser cobrado em 2027. O prazo depende de regulamentação do Comitê Gestor do IBS: enquanto não houver, nenhuma data é presumida.', '{"vigencia_inicio": "2027-01-01", "regimes": ["lucro_presumido", "lucro_real", "lucro_arbitrado"], "servico": "fiscal", "prazo_interno_dias_uteis": 3, "observacao": "Prazo de recolhimento a ser fixado em regulamento."}'::jsonb, 'ADCT, arts. 125 a 129 (EC nº 132/2023); Lei Complementar nº 214/2025', 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm');
