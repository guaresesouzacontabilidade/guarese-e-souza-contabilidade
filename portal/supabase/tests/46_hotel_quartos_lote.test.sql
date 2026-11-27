-- Critérios: o gerente cadastra vários quartos de uma vez por faixa de números
-- (pulando os que não existem e mantendo zeros à esquerda); os que já existem
-- ficam como estão e voltam na resposta; a faixa é limitada; o colaborador sem
-- permissão de gerente e outra empresa não cadastram.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

\ir 00_setup.sql.inc

-- O escritório liga o hotel; o dono cria uma categoria e o quarto 104
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "hotel"}');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.std', public.hotel_categoria_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Standard", "diaria": 200, "capacidade": 3, "pessoas_incluidas": 2}')::text, true);
select public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '104', 'categoria_id', current_setting('testes.std')));

-- 1. Faixa 101 a 106 sem o 103: cria 101, 102, 105 e 106; o 104 já existia
select is(
  public.hotel_quartos_lote(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
    'categoria_id', current_setting('testes.std'), 'inicio', '101', 'fim', '106', 'pular', '103', 'andar', '1º andar', 'camas', '1 casal')),
  '{"criados": ["101", "102", "105", "106"], "existentes": ["104"]}'::jsonb,
  'cria a faixa, pula o 103 e informa o 104 que já existia');
reset role;
select is((select count(*)::int from public.hotel_quartos where empresa_id = current_setting('testes.empresa_a')::uuid), 5, 'o hotel tem 5 quartos');
select is((select andar || ' / ' || camas || ' / ' || limpeza from public.hotel_quartos
            where empresa_id = current_setting('testes.empresa_a')::uuid and numero = '105'), '1º andar / 1 casal / limpo', 'andar e camas gravados; quarto novo limpo');
select is((select count(*)::int from public.hotel_quartos where empresa_id = current_setting('testes.empresa_a')::uuid and numero = '103'), 0, 'o 103 não foi criado');

-- 2. Zeros à esquerda: "01" a "03"
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(
  public.hotel_quartos_lote(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
    'categoria_id', current_setting('testes.std'), 'inicio', '01', 'fim', '03')) -> 'criados',
  '["01", "02", "03"]'::jsonb, 'mantém os zeros à esquerda');

-- 3. Limites e validações
select throws_like(format($$select public.hotel_quartos_lote(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('categoria_id', current_setting('testes.std'), 'inicio', '1', 'fim', '300')), '%no máximo 200%', 'no máximo 200 de cada vez');
select throws_like(format($$select public.hotel_quartos_lote(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('categoria_id', current_setting('testes.std'), 'inicio', '120', 'fim', '101')), '%maior ou igual%', 'o último precisa ser maior que o primeiro');
select throws_like(format($$select public.hotel_quartos_lote(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('categoria_id', current_setting('testes.std'), 'inicio', 'A1', 'fim', 'A9')), '%só com algarismos%', 'faixa só com números');
select throws_like(format($$select public.hotel_quartos_lote(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('categoria_id', gen_random_uuid(), 'inicio', '1', 'fim', '2')), '%categoria%', 'categoria precisa ser do hotel');
reset role;

-- 4. Colaborador sem permissão de gerente e outra empresa não cadastram
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(format($$select public.hotel_quartos_lote(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('categoria_id', current_setting('testes.std'), 'inicio', '301', 'fim', '302')), null, 'colaborador sem permissão não cadastra');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select throws_ok(format($$select public.hotel_quartos_lote(%L, %L)$$, current_setting('testes.empresa_a'),
  jsonb_build_object('categoria_id', current_setting('testes.std'), 'inicio', '401', 'fim', '402')), null, 'outra empresa não cadastra');
reset role;

select * from finish();
rollback;
