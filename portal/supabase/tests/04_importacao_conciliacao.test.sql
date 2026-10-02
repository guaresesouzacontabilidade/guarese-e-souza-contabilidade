-- Critérios: importação repetida não duplica documentos nem movimentações; nota,
-- comprovante e extrato relacionados não duplicam receitas; conciliações são
-- revisáveis e podem ser desfeitas respeitando vínculos e períodos fechados.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(35);

\ir 00_setup.sql.inc

create or replace function pg_temp.cat(p_codigo text) returns uuid language sql as $$
  select id from public.categorias_financeiras
   where empresa_id = current_setting('testes.empresa_a')::uuid and (codigo = p_codigo or codigo_sistema = p_codigo);
$$;
create or replace function pg_temp.dre(p_tipo text) returns numeric language sql as $$
  select coalesce(sum(valor), 0) from public.relatorio_dre_linhas(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')
   where tipo = p_tipo;
$$;
-- Documento enviado (simula o upload ao Storage)
create or replace function pg_temp.enviar(p_categoria text, p_nome text, p_hash text) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.criar_documento(current_setting('testes.empresa_a')::uuid, '2026-09-01', p_categoria, p_nome, 'application/xml', 1000, p_hash);
  insert into storage.objects (bucket_id, name, metadata) values ('documentos', r ->> 'storage_path', '{"size": 1000, "mimetype": "application/xml"}');
  perform public.confirmar_upload((r ->> 'versao_id')::uuid);
  return (r ->> 'documento_id')::uuid;
end $$;

insert into public.contas_financeiras (empresa_id, tipo, nome, saldo_inicial, saldo_inicial_data)
values (current_setting('testes.empresa_a')::uuid, 'conta_corrente', 'BB', 0, '2026-08-31');
select set_config('testes.bb', (select id::text from public.contas_financeiras where nome = 'BB'), true);

-- -------------------------------------------------------------- XML de NF-e
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.xml1', pg_temp.enviar('nfe_saida_xml', 'nfe-123.xml', repeat('a', 64))::text, true);
select set_config('testes.xml2', pg_temp.enviar('nfe_saida_xml', 'nfe-123-copia.xml', repeat('b', 64))::text, true);
select set_config('testes.xml_evt', pg_temp.enviar('eventos_fiscais', 'cancelamento.xml', repeat('c', 64))::text, true);
select set_config('testes.xml3', pg_temp.enviar('nfe_saida_xml', 'nfe-124.xml', repeat('d', 64))::text, true);
select set_config('request.jwt.claims', '', true);

create or replace function pg_temp.nfe(p_chave text, p_numero text, p_valor numeric) returns jsonb language sql as $$
  select jsonb_build_object(
    'tipo', 'nota', 'modelo', '55', 'tipo_documento', 'NF-e', 'chave_acesso', p_chave, 'identificador', p_chave,
    'numero', p_numero, 'serie', '1', 'data_emissao', '2026-09-15T10:00:00-03:00',
    'emitente_documento', '11444777000161', 'emitente_nome', 'Empresa A Comércio Ltda',
    'destinatario_documento', '98765432000198', 'destinatario_nome', 'Cliente X Ltda',
    'tp_nf', '1', 'operacao', 'saida', 'valor_total', p_valor, 'situacao_arquivo', 'protocolo_autorizacao_no_arquivo',
    'relacionado_empresa', true,
    'itens', jsonb_build_array(jsonb_build_object('numero_item', 1, 'descricao', 'Produto', 'cfop', '5102', 'quantidade', 1, 'valor_unitario', p_valor, 'valor_total', p_valor)),
    'sugestao', jsonb_build_object('tipo', 'receber', 'descricao', 'NF-e ' || p_numero || ' — Cliente X Ltda', 'categoria_sistema', 'VENDAS',
       'contraparte', jsonb_build_object('documento', '98765432000198', 'nome', 'Cliente X Ltda'),
       'parcelas', jsonb_build_array(jsonb_build_object('numero', 1, 'vencimento', '2026-09-30', 'valor', p_valor))));
$$;

select is(public.registrar_xml_fiscal(current_setting('testes.xml1')::uuid, pg_temp.nfe('29260911444777000161550010000001231000001230', '123', 1500)) ->> 'situacao',
          'registrado', 'NF-e registrada a partir do XML');
select is(public.registrar_xml_fiscal(current_setting('testes.xml2')::uuid, pg_temp.nfe('29260911444777000161550010000001231000001230', '123', 1500)) ->> 'situacao',
          'duplicado', 'mesma chave de acesso detectada como duplicada');
select is((select count(*)::int from public.documentos_fiscais where chave_acesso = '29260911444777000161550010000001231000001230'), 1,
          'nota duplicada não é registrada duas vezes');
select is((select status_revisao from public.lancamentos where documento_fiscal_id is not null and numero_documento = '123'), 'sugerido',
          'XML gera apenas lançamento SUGERIDO (não definitivo)');
select is((select count(*)::int from public.lancamentos where numero_documento = '123'), 1, 'XML duplicado não duplica a sugestão');
select is(pg_temp.dre('receita_operacional'), 0::numeric, 'sugestão não entra no resultado');

-- Evento de cancelamento de outra nota
select public.registrar_xml_fiscal(current_setting('testes.xml3')::uuid, pg_temp.nfe('29260911444777000161550010000001241000001240', '124', 300));
select is(public.registrar_xml_fiscal(current_setting('testes.xml_evt')::uuid, jsonb_build_object(
  'tipo', 'evento', 'chave_acesso', '29260911444777000161550010000001241000001240', 'modelo', '55', 'tipo_evento', '110111',
  'descricao_evento', 'Cancelamento', 'sequencia', 1, 'data_evento', '2026-09-16T09:00:00-03:00', 'cstat', '135',
  'identificador', 'ID1101112926091144477700016155001000000124100000124001', 'justificativa', 'Erro de digitação')) ->> 'situacao',
  'evento_registrado', 'evento de cancelamento registrado');
select ok((select cancelada_evento from public.documentos_fiscais where numero = '124'), 'nota marcada como cancelada pelo evento do arquivo');
select is((select situacao from public.lancamentos where numero_documento = '124'), 'cancelado', 'sugestão da nota cancelada é cancelada');
select is(public.registrar_xml_fiscal(current_setting('testes.xml_evt')::uuid, jsonb_build_object(
  'tipo', 'evento', 'chave_acesso', '29260911444777000161550010000001241000001240', 'tipo_evento', '110111', 'cstat', '135',
  'identificador', 'ID1101112926091144477700016155001000000124100000124001')) ->> 'situacao',
  'evento_duplicado', 'evento repetido detectado pelo identificador');

-- Cliente confirma a sugestão da NF 123
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.lancamentos set status_revisao = 'confirmado' where numero_documento = '123';
select is(pg_temp.dre('receita_operacional'), 1500.00::numeric, 'receita da nota confirmada: R$ 1.500,00');
select set_config('testes.lanc_nf', (select id::text from public.lancamentos where numero_documento = '123'), true);
reset role;

-- -------------------------------------------------------------- extrato
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select set_config('testes.linhas', jsonb_build_array(
  jsonb_build_object('data', '2026-09-30', 'valor', 1500, 'descricao', 'PIX RECEBIDO CLIENTE X 98.765.432/0001-98', 'documento', '98765432000198', 'ocorrencia', 1),
  jsonb_build_object('data', '2026-09-30', 'valor', -45.90, 'descricao', 'TARIFA PACOTE', 'ocorrencia', 1),
  jsonb_build_object('data', '2026-09-30', 'valor', -10, 'descricao', 'TARIFA PIX', 'ocorrencia', 1),
  jsonb_build_object('data', '2026-09-30', 'valor', -10, 'descricao', 'TARIFA PIX', 'ocorrencia', 2)
)::text, true);
select is(public.importar_extrato(current_setting('testes.empresa_a')::uuid, current_setting('testes.bb')::uuid, 'extrato_ofx', 'imp-1',
  'extrato.ofx', repeat('e', 64), null, '{}', current_setting('testes.linhas')::jsonb, 1434.10, '2026-09-30') ->> 'novas', '4',
  'quatro movimentações importadas (inclusive duas tarifas iguais no mesmo dia)');
select is(public.importar_extrato(current_setting('testes.empresa_a')::uuid, current_setting('testes.bb')::uuid, 'extrato_ofx', 'imp-1',
  'extrato.ofx', repeat('e', 64), null, '{}', current_setting('testes.linhas')::jsonb) ->> 'reenvio', 'true',
  'reenvio da mesma operação é idempotente');
select is(public.importar_extrato(current_setting('testes.empresa_a')::uuid, current_setting('testes.bb')::uuid, 'extrato_ofx', 'imp-2',
  'extrato-de-novo.ofx', repeat('e', 64), null, '{}', current_setting('testes.linhas')::jsonb) ->> 'duplicadas', '4',
  'reimportar o mesmo extrato não duplica movimentações');
select is((select count(*)::int from public.movimentos_bancarios), 4, 'continuam apenas quatro movimentações');

select set_config('testes.mov_pix', (select id::text from public.movimentos_bancarios where valor = 1500), true);
select set_config('testes.mov_tarifa', (select id::text from public.movimentos_bancarios where valor = -45.90), true);

-- Sugestão de correspondência (motor) → confirmação humana
select is(public.registrar_sugestoes_conciliacao(current_setting('testes.empresa_a')::uuid, jsonb_build_array(jsonb_build_object(
  'conta_id', current_setting('testes.bb'), 'pontuacao', 95, 'criterios', jsonb_build_object('valor', true, 'documento', true),
  'itens', jsonb_build_array(jsonb_build_object('movimento_id', current_setting('testes.mov_pix'), 'valor', 1500),
                              jsonb_build_object('lancamento_id', current_setting('testes.lanc_nf'), 'valor', 1500))))), 1,
  'sugestão registrada como "sugerida"');
select is((select status from public.conciliacoes where status = 'sugerida' limit 1), 'sugerida', 'sugestão aguarda confirmação');
select is((select status_conciliacao from public.movimentos_bancarios where id = current_setting('testes.mov_pix')::uuid), 'pendente',
          'movimentação continua pendente até a confirmação');
select lives_ok($$select public.confirmar_conciliacao((select id from public.conciliacoes where status = 'sugerida' limit 1))$$,
                'equipe confirma a conciliação');
select is((select situacao from public.lancamentos where id = current_setting('testes.lanc_nf')::uuid), 'quitado',
          'lançamento da nota quitado pela conciliação');
select is(pg_temp.dre('receita_operacional'), 1500.00::numeric, 'nota + extrato não duplicam a receita');
reset role;

-- Comprovante vinculado ao mesmo lançamento
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
select set_config('testes.comprovante', pg_temp.enviar('comprovante', 'comprovante-pix.pdf', repeat('f', 64))::text, true);
set local role authenticated;
insert into public.lancamento_documentos (lancamento_id, documento_id, empresa_id, tipo_vinculo)
values (current_setting('testes.lanc_nf')::uuid, current_setting('testes.comprovante')::uuid, current_setting('testes.empresa_a')::uuid, 'comprovante');
select is(pg_temp.dre('receita_operacional'), 1500.00::numeric, 'nota + comprovante + extrato: receita contada uma única vez');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select ok(not exists (select 1 from public.movimentos_sem_comprovante(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')
                       where id = current_setting('testes.mov_pix')::uuid), 'movimentação com comprovante não aparece como sem comprovante');
select ok(exists (select 1 from public.movimentos_sem_comprovante(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')
                   where id = current_setting('testes.mov_tarifa')::uuid), 'tarifa sem comprovante é identificada');

-- Classificar movimentação sem lançamento
select lives_ok($$select public.classificar_movimento(current_setting('testes.mov_tarifa')::uuid, pg_temp.cat('TARIFAS_BANCARIAS'), 'Tarifa de pacote')$$,
                'movimentação classificada gera lançamento já conciliado');
select is(pg_temp.dre('despesa_financeira'), 45.90::numeric, 'tarifa entra como despesa financeira');

-- Várias movimentações → um lançamento
insert into public.lancamentos (empresa_id, tipo, descricao, categoria_id, data_competencia, data_vencimento, valor_previsto)
values (current_setting('testes.empresa_a')::uuid, 'pagar', 'Tarifas PIX do mês', pg_temp.cat('TARIFAS_BANCARIAS'), '2026-09-30', '2026-09-30', 20);
select lives_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid,
                  array(select id from public.movimentos_bancarios where descricao = 'TARIFA PIX'),
                  array(select id from public.lancamentos where descricao = 'Tarifas PIX do mês'))$$,
                'duas movimentações conciliadas com um lançamento');
select is((select count(*)::int from public.baixas b join public.lancamentos l on l.id = b.lancamento_id where l.descricao = 'Tarifas PIX do mês'), 2,
          'uma baixa por movimentação');
select throws_ok($$select public.conciliar_manual(current_setting('testes.empresa_a')::uuid, array[current_setting('testes.mov_pix')::uuid], array[]::uuid[])$$,
                 null, null, 'movimentação já conciliada não entra em outra conciliação');
select throws_ok($$delete from public.baixas where conciliacao_id is not null$$, null, null,
                 'baixa criada pela conciliação só é removida desfazendo a conciliação');

-- Conferência de saldos (sistema x extrato)
select is((select diferenca from public.conferencia_saldos(current_setting('testes.empresa_a')::uuid, '2026-09-01', '2026-09-30')), 0.00::numeric,
          'saldo do sistema confere com o saldo final do extrato');

-- Desfazer
select throws_ok($$select public.desfazer_importacao((select id from public.importacoes where chave_idempotencia = 'imp-1'), 'teste')$$, null, null,
                 'importação com movimentações conciliadas não pode ser desfeita');
select lives_ok($$select public.desfazer_conciliacao((select id from public.conciliacoes where tipo = 'classificacao'), 'Classificação errada')$$,
                'conciliação desfeita com motivo');
select is(pg_temp.dre('despesa_financeira'), 20.00::numeric, 'desfazer remove o lançamento criado pela classificação');
select is((select status_conciliacao from public.movimentos_bancarios where id = current_setting('testes.mov_tarifa')::uuid), 'pendente',
          'movimentação volta a pendente');
reset role;

select * from finish();
rollback;
