-- Critérios: o setor do serviço vira setor com máquinas; a previsão espera só a
-- fila dos setores que a OS usa (dividida pelas máquinas); a OS recebe sinal e
-- restante pelo caixa aberto (Financeiro e gaveta do caixa) ou fica a receber;
-- o estorno desfaz; não dá para cancelar com recebimento nem baixar o total
-- abaixo do recebido; a loja pode exigir pagamento e assinatura na entrega; o
-- aviso de pronta vai para a fila do WhatsApp só com a loja configurada; as
-- fotos ficam na pasta da OS; quem não tem permissão e outra empresa não veem.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(42);

\ir 00_setup.sql.inc

-- Escritório liga as OS e a Loja na empresa A
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
update public.empresas set ferramentas_desligadas = array_remove(ferramentas_desligadas, 'os') where id = current_setting('testes.empresa_a')::uuid;
set local role authenticated;
select public.gestao_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": true, "perfil_fiscal": "comercio"}');
reset role;

-- 1. Setores e máquinas
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.corte', public.os_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Corte de MDF", "unidade": "chapa", "minutos_por_unidade": "4", "minutos_fixos": "10", "valor_unitario": "15.00", "setor": "Seccionadora"}')::text, true);
select set_config('testes.fita', public.os_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Fita de borda", "unidade": "m", "minutos_por_unidade": "1,5", "valor_unitario": "3.50", "setor": "Coladeira"}')::text, true);
select is((select string_agg(nome || ':' || maquinas, ',' order by nome) from public.os_setores where empresa_id = current_setting('testes.empresa_a')::uuid),
  'Coladeira:1,Seccionadora:1', 'o setor escrito no serviço vira setor com 1 máquina');
select set_config('testes.secc', (select id::text from public.os_setores where nome = 'Seccionadora'), true);
select public.os_setor_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.secc')::uuid, '{"nome": "Seccionadora", "maquinas": 2}');
select throws_like(format($$select public.os_setor_salvar(%L, null, '{"nome": "coladeira", "maquinas": 1}')$$, current_setting('testes.empresa_a')),
  '%com este nome%', 'setor repetido não salva');
select throws_like(format($$select public.os_setor_salvar(%L, null, '{"nome": "Prensa", "maquinas": 0}')$$, current_setting('testes.empresa_a')),
  '%1 a 50%', 'setor precisa de 1 a 50 máquinas');

-- OS A: 10 chapas na seccionadora (50 min)
select set_config('testes.osA', public.os_salvar(current_setting('testes.empresa_a')::uuid, null, jsonb_build_object(
  'cliente_nome', 'Carlos Marceneiro', 'cliente_telefone', '(63) 99999-1234',
  'itens', jsonb_build_array(jsonb_build_object('servico_id', current_setting('testes.corte'), 'quantidade', 10))))::text, true);
select is((select setor || ' ' || maquinas || ' ' || minutos from public.os_fila_setores(current_setting('testes.empresa_a')::uuid)),
  'Seccionadora 2 50.0', 'fila por setor: 50 min na seccionadora, com 2 máquinas');
-- Só fita não espera a seccionadora; com 2 máquinas a espera da seccionadora cai pela metade
select set_config('testes.p_fita', public.os_previsao_itens(current_setting('testes.empresa_a')::uuid,
  jsonb_build_array(jsonb_build_object('servico_id', current_setting('testes.fita'), 'quantidade', 4)), 'normal')::text, true);
select set_config('testes.p_corte2', public.os_previsao_itens(current_setting('testes.empresa_a')::uuid,
  jsonb_build_array(jsonb_build_object('servico_id', current_setting('testes.corte'), 'quantidade', 1)), 'normal')::text, true);
select ok(current_setting('testes.p_fita')::timestamptz < current_setting('testes.p_corte2')::timestamptz,
  'OS só de fita não espera a fila da seccionadora');
select public.os_setor_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.secc')::uuid, '{"nome": "Seccionadora", "maquinas": 1}');
select ok(public.os_previsao_itens(current_setting('testes.empresa_a')::uuid,
  jsonb_build_array(jsonb_build_object('servico_id', current_setting('testes.corte'), 'quantidade', 1)), 'normal') > current_setting('testes.p_corte2')::timestamptz,
  'com 1 máquina a previsão da seccionadora fica mais longa');
select public.os_setor_salvar(current_setting('testes.empresa_a')::uuid, current_setting('testes.secc')::uuid, '{"nome": "Serra", "maquinas": 1}');
select is((select setor from public.os_servicos where id = current_setting('testes.corte')::uuid), 'Serra', 'renomear o setor muda os serviços dele');
select ok((select previsao is not null from public.os_ordens where id = current_setting('testes.osA')::uuid), 'OS aberta com previsão por setor');

-- 2. Recebimentos pelo caixa
select throws_like(format($$select public.os_pagamento_registrar(%L, '{"forma": "pix", "valor": "10"}')$$, current_setting('testes.osA')),
  '%Abra o seu caixa%', 'sem caixa aberto não recebe na hora');
select set_config('testes.caixa', public.gestao_caixa_abrir(current_setting('testes.empresa_a')::uuid, 'Caixa 1', 100)::text, true);
select set_config('testes.pg1', public.os_pagamento_registrar(current_setting('testes.osA')::uuid, '{"forma": "dinheiro", "valor": "50"}')::text, true);
select is((select valor_recebido || '/' || valor_a_receber from public.os_ordens where id = current_setting('testes.osA')::uuid), '50.00/0.00',
  'sinal de R$ 50 recebido');
select ok((select sinal and sessao_id = current_setting('testes.caixa')::uuid from public.os_pagamentos where id = current_setting('testes.pg1')::uuid),
  'recebido antes de ficar pronta conta como sinal, no caixa aberto');
select is((select count(*)::int from public.lancamentos l join public.baixas b on b.lancamento_id = l.id
            where l.origem = 'os' and l.origem_referencia = current_setting('testes.osA') and l.valor_previsto = 50), 1,
  'lançamento recebido no Financeiro');
select is((select (r ->> 'os_total') || ' ' || (r ->> 'dinheiro_esperado') from public.gestao_caixa_resumo(current_setting('testes.caixa')::uuid) r),
  '50.00 150.00', 'o caixa soma o recebido da OS e o dinheiro na gaveta');
select throws_like(format($$select public.os_pagamento_registrar(%L, '{"forma": "pix", "valor": "200"}')$$, current_setting('testes.osA')),
  '%passa do que falta%', 'não recebe mais que o saldo');
select throws_like(format($$select public.os_pagamento_registrar(%L, '{"forma": "a_receber", "valor": "10"}')$$, current_setting('testes.osA')),
  '%vencimento%', 'a receber pede o vencimento');
select public.os_pagamento_registrar(current_setting('testes.osA')::uuid,
  jsonb_build_object('forma', 'a_receber', 'valor', '20', 'vencimento', (current_date + 10)::text));
select is((select valor_a_receber from public.os_ordens where id = current_setting('testes.osA')::uuid), 20.00::numeric(12,2), 'R$ 20 a receber');
select throws_like(format($$select public.os_salvar(%L, %L, jsonb_build_object('cliente_nome', 'Carlos', 'itens', jsonb_build_array(jsonb_build_object('servico_id', %L, 'quantidade', 1))))$$,
  current_setting('testes.empresa_a'), current_setting('testes.osA'), current_setting('testes.corte')), '%menor que o já recebido%',
  'não diminui o total abaixo do recebido');
select throws_like(format($$select public.os_cancelar(%L, 'desistiu')$$, current_setting('testes.osA')), '%Estorne%', 'não cancela OS com recebimento');
select throws_like(format($$select public.os_pagamento_estornar(%L, '')$$, current_setting('testes.pg1')), '%motivo%', 'estorno pede o motivo');
select public.os_pagamento_estornar(current_setting('testes.pg1')::uuid, 'Valor errado');
select is((select valor_recebido from public.os_ordens where id = current_setting('testes.osA')::uuid), 0.00::numeric(12,2), 'estorno devolve o saldo');
select is((select situacao from public.lancamentos where origem = 'os' and origem_referencia = current_setting('testes.osA') and valor_previsto = 50), 'cancelado',
  'estorno cancela o lançamento');
reset role;

-- Colaborador com as OS mas sem o caixa não recebe
select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
update public.empresa_membros set permissoes = array['os.operar']
 where empresa_id = current_setting('testes.empresa_a')::uuid and user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.os_pagamento_registrar(%L, '{"forma": "pix", "valor": "10"}')$$, current_setting('testes.osA')),
  '%permissão%', 'quem não opera o caixa não recebe');
reset role;

-- 3. Aviso de pronta pelo WhatsApp (só com a loja configurada)
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.os_mover(current_setting('testes.osA')::uuid, 'execucao');
select public.os_mover(current_setting('testes.osA')::uuid, 'pronta');
select is((select count(*)::int from public.os_ordens where id = current_setting('testes.osA')::uuid and aviso_whatsapp is null), 1,
  'sem o aviso automático ligado, nada vai para o WhatsApp');
select throws_like(format($$select public.os_configurar_extras(%L, '{"whatsapp_ativo": true}')$$, current_setting('testes.empresa_a')),
  '%Phone Number ID%', 'ligar o aviso pede o número e o modelo');
select public.os_configurar_extras(current_setting('testes.empresa_a')::uuid,
  '{"whatsapp_ativo": true, "whatsapp_phone_number_id": "123456789012345", "whatsapp_modelo": "os_pronta", "whatsapp_idioma": "pt_BR"}');
select public.os_mover(current_setting('testes.osA')::uuid, 'execucao');
select public.os_mover(current_setting('testes.osA')::uuid, 'pronta');
select public.os_mover(current_setting('testes.osA')::uuid, 'execucao');
select public.os_mover(current_setting('testes.osA')::uuid, 'pronta');
reset role;
select is((select count(*)::int from public.envios e join public.jobs j on j.payload ->> 'envio_id' = e.id::text
            where e.tipo = 'os_pronta' and e.referencia_id = current_setting('testes.osA') and e.canal = 'whatsapp' and e.destinatario = '63999991234'), 1,
  'pronta: um aviso na fila do WhatsApp (sem repetir)');
select is((select aviso_whatsapp from public.os_ordens where id = current_setting('testes.osA')::uuid), 'pendente', 'aviso pendente na OS');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.os_aviso_resultado(%L, 'enviado', null)$$, current_setting('testes.osA')),
  '%permission denied%', 'só o servidor grava o resultado do aviso');

-- 4. Entrega: pagamento e assinatura exigidos pela loja
select public.os_configurar_extras(current_setting('testes.empresa_a')::uuid,
  '{"whatsapp_ativo": true, "whatsapp_phone_number_id": "123456789012345", "whatsapp_modelo": "os_pronta", "exigir_pagamento_entrega": true, "exigir_assinatura": true}');
select throws_like(format($$select public.os_mover(%L, 'entregue')$$, current_setting('testes.osA')),
  '%assinatura%', 'com assinatura exigida, arrastar para Entregue não entrega');
select throws_like(format($$select public.os_entregar(%L, '{"retirado_por": "Carlos"}')$$, current_setting('testes.osA')),
  '%assinatura%', 'entrega sem assinatura recusada');
select set_config('testes.ass', current_setting('testes.empresa_a') || '/' || current_setting('testes.osA') || '/assinatura-1.png', true);
select throws_like(format($$select public.os_entregar(%L, jsonb_build_object('retirado_por', 'Carlos', 'assinatura_caminho', %L))$$,
  current_setting('testes.osA'), current_setting('testes.ass')), '%não chegou%', 'assinatura que não foi enviada é recusada');
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('os-fotos', current_setting('testes.ass'), '00000000-0000-0000-0000-0000000000b1', '{"size": 2048, "mimetype": "image/png"}');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_like(format($$select public.os_entregar(%L, jsonb_build_object('retirado_por', 'Carlos', 'assinatura_caminho', %L))$$,
  current_setting('testes.osA'), current_setting('testes.ass')), '%Falta receber R$ 130%', 'falta receber: não entrega');
select public.os_pagamento_registrar(current_setting('testes.osA')::uuid, '{"forma": "pix", "valor": "130"}');
select public.os_entregar(current_setting('testes.osA')::uuid,
  jsonb_build_object('retirado_por', 'Carlos', 'retirado_documento', '123.456.789-09', 'assinatura_caminho', current_setting('testes.ass')));
select is((select etapa || ' ' || retirado_por || ' ' || retirado_documento || ' ' || (assinatura_caminho = current_setting('testes.ass'))
             from public.os_ordens where id = current_setting('testes.osA')::uuid),
  'entregue Carlos 123.456.789-09 true', 'entregue com nome, documento e assinatura');
select ok((select not sinal from public.os_pagamentos where ordem_id = current_setting('testes.osA')::uuid and forma = 'pix'), 'pago na retirada não é sinal');

-- 5. Fotos da OS
select throws_like(format($$select public.os_foto_iniciar(%L, '{"mime": "application/pdf", "tamanho": 100}')$$, current_setting('testes.osA')),
  '%foto%', 'só aceita foto');
select set_config('testes.foto', public.os_foto_iniciar(current_setting('testes.osA')::uuid, '{"mime": "image/jpeg", "tamanho": 5000, "momento": "pronta"}')::text, true);
select ok((current_setting('testes.foto')::jsonb ->> 'caminho') like current_setting('testes.empresa_a') || '/' || current_setting('testes.osA') || '/%.jpg',
  'a foto vai para a pasta da OS');
select throws_like(format($$select public.os_foto_confirmar(%L)$$, current_setting('testes.foto')::jsonb ->> 'foto_id'),
  '%não chegou%', 'confirma só depois que o arquivo chega');
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('os-fotos', current_setting('testes.foto')::jsonb ->> 'caminho', '00000000-0000-0000-0000-0000000000b1', '{"size": 4800, "mimetype": "image/jpeg"}');
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.os_foto_confirmar((current_setting('testes.foto')::jsonb ->> 'foto_id')::uuid);
select is((select tamanho from public.os_fotos where id = (current_setting('testes.foto')::jsonb ->> 'foto_id')::uuid), 4800::bigint, 'foto confirmada');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_like(format($$select public.os_foto_excluir(%L)$$, current_setting('testes.foto')::jsonb ->> 'foto_id'),
  '%Só quem enviou%', 'outro colaborador não exclui a foto depois da entrega');
reset role;

-- 6. Outra empresa não vê nada
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.os_pagamentos) + (select count(*)::int from public.os_fotos) + (select count(*)::int from public.os_setores)
          + (select count(*)::int from storage.objects where bucket_id = 'os-fotos'), 0,
  'outra empresa não vê recebimentos, fotos nem setores');
select throws_like(format($$select public.os_fila_setores(%L)$$, current_setting('testes.empresa_a')), '%permissão%', 'outra empresa não vê a fila');
reset role;
select is((select count(*)::int from public.os_whatsapp_segredo), 0, 'nenhum token guardado sem a loja enviar');
select ok(not has_table_privilege('authenticated', 'public.os_whatsapp_segredo', 'select'), 'o token da loja não é lido pelo navegador');

select * from finish();
rollback;
