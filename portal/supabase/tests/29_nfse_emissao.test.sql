-- Emissão de NFS-e pelo portal: permissões, configuração (certificado, serviços,
-- autorização), pedido com numeração da DPS, proteções e isolamento entre empresas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

\ir 00_setup.sql.inc

-- Titular emite por padrão; configurar é só da equipe
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select ok(app.pode(current_setting('testes.empresa_a')::uuid, 'nfse.emitir'), 'o empresário emite notas por padrão');
select ok(not app.pode(current_setting('testes.empresa_a')::uuid, 'nfse.configurar'), 'o empresário não configura a emissão');
select throws_ok($$select public.nfse_configurar(current_setting('testes.empresa_a')::uuid, '{"ativa": false}'::jsonb)$$, '42501', null,
  'cliente não configura a emissão');
reset role;

select pg_temp.como('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select throws_like($$select public.vincular_membro(current_setting('testes.empresa_a')::uuid, '00000000-0000-0000-0000-0000000000b3',
  'cliente_colaborador', array['empresa.ver', 'nfse.configurar'])$$, '%exclusivas da equipe%', 'configurar a emissão não pode ser dado a cliente');
reset role;

-- Equipe configura: sem certificado não liga
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like($$select public.nfse_configurar(current_setting('testes.empresa_a')::uuid,
  '{"ativa": true, "codigo_municipio": "1718204", "autorizacao_texto": "Autorização do sócio por e-mail em 20/10/2026"}'::jsonb)$$,
  '%certificado digital%', 'sem certificado a emissão não liga');
select set_config('testes.servico', public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Consultoria", "codigo_tributacao_nacional": "170101", "descricao_padrao": "Consultoria empresarial"}'::jsonb)::text, true);
select throws_like($$select public.nfse_servico_salvar(current_setting('testes.empresa_a')::uuid, null,
  '{"nome": "Errado", "codigo_tributacao_nacional": "17.01"}'::jsonb)$$, '%violates check constraint%', 'código de tributação com 6 dígitos');
reset role;

insert into public.certificados_digitais (empresa_id, titular, documento, impressao_digital, valido_de, valido_ate, autorizacao, autorizacao_texto)
values (current_setting('testes.empresa_a')::uuid, 'EMPRESA A COMERCIO LTDA', '11444777000161', repeat('AB', 32),
        now() - interval '1 day', now() + interval '300 days', 'autorizacao_escrita', 'Autorização escrita do sócio (teste)');

select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_like($$select public.nfse_configurar(current_setting('testes.empresa_a')::uuid,
  '{"ativa": true, "codigo_municipio": "1718204"}'::jsonb)$$, '%autorizou o portal%', 'sem a autorização do cliente a emissão não liga');
select lives_ok($$select public.nfse_configurar(current_setting('testes.empresa_a')::uuid,
  '{"ativa": true, "ambiente": "homologacao", "codigo_municipio": "1718204", "serie": 1, "percentual_tributos_sn": 6,
    "autorizacao_texto": "Autorização do sócio por e-mail em 20/10/2026"}'::jsonb)$$, 'com certificado, serviço e autorização a emissão liga');
reset role;

-- Pedido do empresário: emite na hora (fila com prioridade) e reserva o número da DPS
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select set_config('testes.nota1', (public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 1500, 'descricao', 'Consultoria de outubro',
  'tomador_tipo', 'cpf', 'tomador_documento', '529.982.247-25', 'tomador_nome', 'Fulano de Tal')) ->> 'id'), true);
select is((select id_dps from public.nfse_emissoes where id = current_setting('testes.nota1')::uuid),
  'DPS1718204211444777000161000010000000000000' || '01', 'identificador da DPS: município, CNPJ, série e número');
select is((public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 800, 'descricao', 'Consultoria avulsa',
  'tomador_tipo', 'nao_identificado')) ->> 'numero_dps')::int, 2, 'a numeração segue');
select throws_ok($$select public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 800, 'descricao', 'Consultoria avulsa', 'tomador_tipo', 'nao_identificado'))$$,
  'P0002', null, 'pedido repetido por engano é barrado');
select throws_like($$select public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 100, 'descricao', 'Teste retenção', 'iss_retido', true,
  'tomador_tipo', 'cpf', 'tomador_documento', '52998224725', 'tomador_nome', 'Fulano'))$$, '%retenção do ISS%', 'retenção só quando o escritório libera');
select throws_like($$select public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 100, 'descricao', 'Para mim mesmo',
  'tomador_tipo', 'cnpj', 'tomador_documento', '11444777000161', 'tomador_nome', 'Eu', 'tomador_endereco', '{}'::jsonb))$$,
  '%própria empresa%', 'tomador não pode ser a própria empresa');
select throws_like($$select public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 100, 'descricao', 'CPF errado',
  'tomador_tipo', 'cpf', 'tomador_documento', '11111111111', 'tomador_nome', 'X'))$$, '%CPF do tomador%', 'CPF do tomador conferido');
select throws_like($$select public.nfse_cancelar(current_setting('testes.nota1')::uuid, 1::smallint, 'Valor digitado errado na nota')$$,
  '%autorizada%', 'só nota autorizada pode ser cancelada');
reset role;
select is((select count(*)::int from public.jobs where tipo = 'emitir_nfse' and empresa_id = current_setting('testes.empresa_a')::uuid), 2,
  'cada pedido vira uma tarefa de emissão');

-- Colaborador sem a permissão e cliente de outra empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok($$select public.nfse_pedir(current_setting('testes.empresa_a')::uuid, jsonb_build_object(
  'servico_id', current_setting('testes.servico'), 'valor', 10, 'descricao', 'Sem permissão', 'tomador_tipo', 'nao_identificado'))$$,
  '42501', null, 'colaborador sem permissão não pede nota');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select is((select count(*)::int from public.nfse_emissoes), 0, 'cliente de outra empresa não vê as notas');
select is((select count(*)::int from public.nfse_servicos), 0, 'nem os serviços');
select throws_ok($$select public.nfse_carteira('2026-01-01', '2026-12-31')$$, '42501', null, 'carteira é só da equipe');
reset role;

-- Nota autorizada pode ser cancelada pelo empresário (vira tarefa)
update public.nfse_emissoes set situacao = 'autorizada', chave_acesso = repeat('1', 50), numero_nfse = '15', xml_nfse = '<NFSe/>',
       autorizada_em = now()
 where id = current_setting('testes.nota1')::uuid;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select lives_ok($$select public.nfse_cancelar(current_setting('testes.nota1')::uuid, 1::smallint, 'Valor digitado errado na nota')$$,
  'empresário pede o cancelamento');
reset role;
select is((select situacao || '/' || (select count(*) from public.jobs j where j.tipo = 'cancelar_nfse')::text
             from public.nfse_emissoes where id = current_setting('testes.nota1')::uuid), 'cancelando/1', 'cancelamento entra na fila');

-- A numeração não volta e a carteira da equipe mostra a empresa
select pg_temp.como('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select public.nfse_configurar(current_setting('testes.empresa_a')::uuid,
  '{"ativa": true, "ambiente": "homologacao", "codigo_municipio": "1718204", "proximo_numero_homologacao": 1, "percentual_tributos_sn": 6}'::jsonb);
select is((select proximo_numero_homologacao::int from public.nfse_emissao_config where empresa_id = current_setting('testes.empresa_a')::uuid), 3,
  'números já usados não voltam');
select is((select (e ->> 'testes')::int from jsonb_array_elements(public.nfse_carteira('2026-01-01', '2030-12-31')) e
            where e ->> 'empresa_id' = current_setting('testes.empresa_a')), 2, 'carteira mostra as notas de teste da empresa');
reset role;

select * from finish();
rollback;
