-- Critérios: a recepção registra o comprovante de um recebimento do hotel (foto
-- ou PDF, até 10 MB) e só confirma depois que o arquivo chegou ao
-- armazenamento; recebimento estornado não recebe comprovante; quem enviou
-- exclui enquanto o caixa está aberto e, depois de fechado, só o gerente;
-- colaborador sem a gestão e outra empresa não veem nem enviam; ninguém grava
-- direto na tabela.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(17);

\ir 00_setup.sql.inc

select set_config('testes.hoje', app.hoje()::text, true);

-- Hotel ligado, um quarto, um hóspede, uma reserva e o caixa da recepção aberto
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "modalidade": "hotel"}');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.std', public.hotel_categoria_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Standard", "diaria": 200, "capacidade": 2, "pessoas_incluidas": 2}')::text, true);
select set_config('testes.q101', public.hotel_quarto_salvar(current_setting('testes.empresa_a')::uuid, null,
  jsonb_build_object('numero', '101', 'categoria_id', current_setting('testes.std')))::text, true);
select set_config('testes.maria', public.hotel_hospede_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Maria Silva", "cpf": "529.982.247-25"}')::text, true);
select set_config('testes.r1', (public.hotel_reserva_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'hospede_id', current_setting('testes.maria'), 'quarto_id', current_setting('testes.q101'), 'adultos', 1,
  'entrada', current_setting('testes.hoje'), 'saida', (current_setting('testes.hoje')::date + 2)::text)) ->> 'id'), true);
reset role;
-- A recepção (b2) só com a permissão de vender
update public.empresa_membros set permissoes = array['empresa.ver', 'gestao.vender']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Recepção', 0)::text, true);
select set_config('testes.pix', public.hotel_pagamento_registrar(current_setting('testes.r1')::uuid, '{"forma": "pix", "valor": "200"}')::text, true);

-- 1. A recepção registra a foto do PIX: o caminho fica na pasta da empresa e do recebimento
select set_config('testes.a1', (public.hotel_comprovante_iniciar(current_setting('testes.pix')::uuid,
  '{"nome": "pix.jpg", "mime": "image/jpeg", "tamanho": 120000, "origem": "camera"}') ->> 'anexo_id'), true);
select ok((select caminho = current_setting('testes.empresa_a') || '/' || current_setting('testes.pix') || '/' || id || '.jpg'
             from public.hotel_pagamento_anexos where id = current_setting('testes.a1')::uuid),
  'o comprovante fica na pasta da empresa e do recebimento');

-- 2. Formato e tamanho
select throws_like(format($$select public.hotel_comprovante_iniciar(%L, '{"nome": "x.html", "mime": "text/html", "tamanho": 10}')$$,
  current_setting('testes.pix')), '%foto%PDF%', 'só foto ou PDF');
select throws_like(format($$select public.hotel_comprovante_iniciar(%L, '{"nome": "x.pdf", "mime": "application/pdf", "tamanho": 20000000}')$$,
  current_setting('testes.pix')), '%até 10 MB%', 'até 10 MB');
select throws_like(format($$select public.hotel_comprovante_iniciar(%L, '{"nome": "x.pdf", "mime": "application/pdf", "tamanho": 0}')$$,
  current_setting('testes.pix')), '%vazio%', 'arquivo vazio é recusado');

-- 3. Só confirma depois que o arquivo chegou
select throws_like(format($$select public.hotel_comprovante_confirmar(%L)$$, current_setting('testes.a1')),
  '%não chegou%', 'sem o arquivo no armazenamento, não confirma');
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'hotel-comprovantes', caminho, '{"size": 98765, "mimetype": "image/jpeg"}'::jsonb
  from public.hotel_pagamento_anexos where id = current_setting('testes.a1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.hotel_comprovante_confirmar(%L)$$, current_setting('testes.a1')),
  '%quem iniciou%', 'só quem iniciou o envio confirma');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select lives_ok(format($$select public.hotel_comprovante_confirmar(%L)$$, current_setting('testes.a1')), 'a recepção confirma o envio');
select is((select tamanho from public.hotel_pagamento_anexos where id = current_setting('testes.a1')::uuid
            and confirmado_em is not null), 98765::bigint, 'confirmado com o tamanho que chegou');
select is((select count(*)::int from storage.objects where bucket_id = 'hotel-comprovantes'), 1, 'a recepção vê o arquivo da própria empresa');

-- 4. Ninguém grava direto na tabela
select throws_like(format($$insert into public.hotel_pagamento_anexos (empresa_id, pagamento_id, caminho, nome, mime, tamanho)
  values (%L, %L, 'x', 'x', 'application/pdf', 1)$$, current_setting('testes.empresa_a'), current_setting('testes.pix')),
  '%permission denied%', 'ninguém grava direto na tabela de comprovantes');
reset role;

-- 5. Outra empresa não vê nem envia
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.hotel_pagamento_anexos), 0, 'outra empresa não vê os comprovantes');
select is((select count(*)::int from storage.objects where bucket_id = 'hotel-comprovantes'), 0, 'outra empresa não vê os arquivos');
select throws_ok(format($$select public.hotel_comprovante_iniciar(%L, '{"nome": "x.jpg", "mime": "image/jpeg", "tamanho": 10}')$$,
  current_setting('testes.pix')), null, 'outra empresa não envia comprovante');
reset role;

-- 6. Exclusão: com o caixa aberto, quem enviou exclui; fechado o caixa, só o gerente
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select set_config('testes.a2', (public.hotel_comprovante_iniciar(current_setting('testes.pix')::uuid,
  '{"nome": "errado.png", "mime": "image/png", "tamanho": 5000}') ->> 'anexo_id'), true);
select is(public.hotel_comprovante_excluir(current_setting('testes.a2')::uuid), (select caminho from public.hotel_pagamento_anexos
  where id = current_setting('testes.a2')::uuid), 'quem enviou exclui com o caixa aberto (e recebe o caminho do arquivo)');
select public.gestao_caixa_fechar(current_setting('testes.caixa')::uuid, 0, null);
select throws_like(format($$select public.hotel_comprovante_excluir(%L)$$, current_setting('testes.a1')),
  '%já foi fechado%', 'com o caixa fechado, a recepção não exclui');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok(format($$select public.hotel_comprovante_excluir(%L)$$, current_setting('testes.a1')), 'o gerente exclui depois do fechamento');

-- 7. Recebimento estornado não recebe comprovante
select public.hotel_pagamento_estornar(current_setting('testes.pix')::uuid, 'Valor digitado errado');
select throws_like(format($$select public.hotel_comprovante_iniciar(%L, '{"nome": "x.jpg", "mime": "image/jpeg", "tamanho": 10}')$$,
  current_setting('testes.pix')), '%estornado%', 'recebimento estornado não recebe comprovante');
reset role;

select * from finish();
rollback;
