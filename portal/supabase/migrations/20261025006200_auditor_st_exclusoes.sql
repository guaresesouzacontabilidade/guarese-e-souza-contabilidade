-- =============================================================================
-- Auditor fiscal: produtos que saíram da substituição tributária do ICMS por
-- regra do Estado (hoje, o Tocantins).
--
-- O Decreto nº 6.996/2025 (TO), alterado pelos Decretos nº 7.103/2026 e
-- nº 7.150/2026, tirou da ST, NAS OPERAÇÕES INTERNAS e quando a saída é de
-- ESTABELECIMENTO INDUSTRIAL FABRICANTE LOCALIZADO NO ESTADO, as bebidas frias
-- (itens 8.29 a 8.51 do Anexo XXI do RICMS/TO), as tintas e vernizes (item
-- 4.4) e produtos de higiene pessoal (itens 16.1 a 16.8 e 16.10 a 16.12). A
-- compra de outro estado continua com ST.
--
-- O texto oficial do Anexo XXI vigente não pôde ser conferido (site da
-- SEFAZ-TO fora do ar no levantamento de 21/10/2026): o enquadramento de cada
-- linha é pelo CEST do Convênio ICMS nº 142/2018 e vem marcado "conferir".
-- O administrador do escritório ajusta, desativa ou inclui linhas.
-- =============================================================================

create table public.auditor_st_exclusoes (
  id uuid primary key default gen_random_uuid(),
  uf char(2) not null check (uf ~ '^[A-Z]{2}$'),
  -- Item da lista de ST do Estado (ex.: "16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI")
  item text not null check (length(item) between 1 and 120),
  segmento text not null check (segmento in ('bebidas_frias', 'tintas_vernizes', 'higiene_cosmeticos')),
  -- Prefixo do CEST (2 a 7 dígitos, sem pontos) e, se preciso, do NCM
  cest_prefixo text not null check (cest_prefixo ~ '^[0-9]{2,7}$'),
  ncm_prefixo text check (ncm_prefixo is null or ncm_prefixo ~ '^[0-9]{4,8}$'),
  descricao text not null check (length(descricao) between 3 and 300),
  condicao text check (condicao is null or length(condicao) <= 500),
  -- A exclusão só vale na venda interna da indústria fabricante do próprio Estado
  somente_fabricante_uf boolean not null default true,
  confianca text not null default 'conferir' check (confianca in ('alta', 'conferir')),
  fonte_titulo text not null check (length(fonte_titulo) between 3 and 300),
  fonte_url text check (fonte_url is null or fonte_url ~ '^https?://'),
  vigencia_inicio date not null,
  vigencia_fim date check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index auditor_st_exclusoes_uk on public.auditor_st_exclusoes (uf, cest_prefixo, coalesce(ncm_prefixo, ''), vigencia_inicio);
create trigger auditor_st_exclusoes_updated_at before update on public.auditor_st_exclusoes
  for each row execute function app.tg_updated_at();
create trigger auditoria_auditor_st_exclusoes after insert or update or delete on public.auditor_st_exclusoes
  for each row execute function app.tg_auditoria();

alter table public.auditor_st_exclusoes enable row level security;
create policy auditor_st_exclusoes_leitura on public.auditor_st_exclusoes for select to authenticated
  using ((select app.tipo_usuario()) in ('admin', 'equipe'));
create policy auditor_st_exclusoes_inclusao on public.auditor_st_exclusoes for insert to authenticated
  with check ((select app.tipo_usuario()) = 'admin');
create policy auditor_st_exclusoes_alteracao on public.auditor_st_exclusoes for update to authenticated
  using ((select app.tipo_usuario()) = 'admin') with check ((select app.tipo_usuario()) = 'admin');
create policy auditor_st_exclusoes_exclusao on public.auditor_st_exclusoes for delete to authenticated
  using ((select app.tipo_usuario()) = 'admin');
grant select, insert, update, delete on public.auditor_st_exclusoes to authenticated;
grant select, insert, update, delete on public.auditor_st_exclusoes to service_role;

-- Carga inicial: Tocantins (levantamento de 21/10/2026)
insert into public.auditor_st_exclusoes
  (uf, item, segmento, cest_prefixo, ncm_prefixo, descricao, condicao, confianca, fonte_titulo, fonte_url, vigencia_inicio)
select 'TO', v.item, v.segmento, v.cest, v.ncm, v.descricao, v.condicao, 'conferir', f.titulo, f.url, v.inicio::date
  from (values
    -- Bebidas frias: segmento 03 do CEST (cervejas, chopes, refrigerantes, águas e outras bebidas).
    -- Efeitos desde 01/07/2025 (art. 7º do Decreto nº 7.103/2026, quanto aos arts. 2º a 4º do Decreto nº 6.996/2025).
    ('8.29 a 8.51 do Anexo XXI', 'bebidas_frias', '03', null,
       'Cervejas, chopes, refrigerantes, águas, energéticos, isotônicos e outras bebidas frias (CEST 03.xxx.xx)',
       'O decreto lista os itens 8.29 a 8.51 do Anexo XXI (art. 57 do RICMS/TO): confira se o CEST do produto está entre eles.', 'd6996_bebidas', '2025-07-01'),
    -- Tintas e vernizes: item 4.4 do Anexo XXI (art. 52 do RICMS/TO).
    ('4.4 do Anexo XXI', 'tintas_vernizes', '2400100', null,
       'Tintas e vernizes (CEST 24.001.00 — NCM 3208, 3209 e 3210.00)',
       'O decreto exclui só o item 4.4 (os demais itens do grupo de tintas — corantes, massas, solventes — continuam na ST): confira o item e a data no Anexo XXI.', 'd6996_tintas', '2025-08-08'),
    -- Higiene pessoal: itens 16.1 a 16.8 e 16.10 a 16.12 (o 16.9 continua na ST). Data de referência: DOE de 13/02/2026.
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2002300', '33061',  'Dentifrícios (CEST 20.023.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2002400', '33062',  'Fios dentais (CEST 20.024.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2002500', '33069',  'Outras preparações para higiene bucal ou dentária (CEST 20.025.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2003900', null,     'Chupetas e bicos de borracha (CEST 20.039.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2004000', null,     'Chupetas e bicos de silicone ou plástico (CEST 20.040.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '200480',  '9619',   'Fraldas (CEST 20.048.00 e 20.048.01)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2004900', '9619',   'Tampões higiênicos (CEST 20.049.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2005100', '560121', 'Hastes flexíveis de uso não medicinal (CEST 20.051.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2005800', '960321', 'Escovas de dentes (CEST 20.058.00)', null, 'd7103', '2026-02-13'),
    ('16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI', 'higiene_cosmeticos', '2006300', null,     'Mamadeiras (CEST 20.063.00)', null, 'd7103', '2026-02-13')
  ) as v(item, segmento, cest, ncm, descricao, condicao, fonte, inicio)
  join (values
    ('d6996_bebidas',
     'Decreto nº 6.996/2025 (TO), arts. 2º a 4º, com efeitos desde 01/07/2025 pelo Decreto nº 7.103/2026, art. 7º — bebidas frias fora da ST nas saídas internas de indústria do Estado',
     'https://dtri.sefaz.to.gov.br/legislacao/ntributaria/decretos/Decreto2.912-06.htm'),
    ('d6996_tintas',
     'Decreto nº 6.996/2025 (TO), redação dos Decretos nº 7.103/2026 e nº 7.150/2026 — item 4.4 do Anexo XXI (tintas e vernizes) fora da ST nas saídas internas de indústria do Estado',
     'https://dtri.sefaz.to.gov.br/legislacao/ntributaria/decretos/Decreto2.912-06.htm'),
    ('d7103',
     'Decreto nº 7.103/2026 (TO, DOE de 13/02/2026) — itens 16.1 a 16.8 e 16.10 a 16.12 do Anexo XXI fora da ST nas saídas internas de indústria do Estado',
     'https://dtri.sefaz.to.gov.br/legislacao/ntributaria/decretos/Decreto2.912-06.htm')
  ) as f(chave, titulo, url) on f.chave = v.fonte;
