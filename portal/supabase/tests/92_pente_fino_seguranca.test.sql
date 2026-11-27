-- Pente fino de segurança: limite de tentativas guardado no banco (só o
-- servidor usa), código secreto do aviso de Pix fora do alcance do navegador e
-- custo do uso na veterinária só com "Ver custos e margens".
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

-- 1. Limite de tentativas
select ok(not has_function_privilege('authenticated', 'public.limite_consumir(text, integer, integer)', 'execute'),
  'quem está logado não mexe no limite de tentativas');
select ok(not has_function_privilege('anon', 'public.limite_consumir(text, integer, integer)', 'execute'),
  'visitante sem login não mexe no limite de tentativas');
select ok(not has_function_privilege('anon', 'public.limite_zerar(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.limite_estourado(text, integer)', 'execute'),
  'nem consulta nem zera o limite pelo navegador');
select ok(not has_table_privilege('authenticated', 'app.limites_taxa', 'select'), 'a tabela de tentativas não é lida pelo navegador');

set local role service_role;
select ok(public.limite_consumir('teste:email:abc', 3, 900) and public.limite_consumir('teste:email:abc', 3, 900)
          and public.limite_consumir('teste:email:abc', 3, 900), 'as 3 primeiras tentativas passam');
select ok(public.limite_estourado('teste:email:abc', 3), 'depois de 3, o limite aparece como atingido');
select ok(not public.limite_consumir('teste:email:abc', 3, 900), 'a 4ª tentativa é barrada');
select ok(public.limite_consumir('teste:email:outro', 3, 900), 'outro e-mail tem a sua própria contagem');
select public.limite_zerar('teste:email:abc');
select ok(not public.limite_estourado('teste:email:abc', 3), 'entrar com a senha certa zera a contagem');
reset role;
update app.limites_taxa set janela_inicio = now() - interval '16 minutes' where chave = 'teste:email:outro';
set local role service_role;
select ok(public.limite_consumir('teste:email:outro', 1, 900), 'passada a janela de 15 minutos, a contagem recomeça');
select throws_ok($$select public.limite_consumir('x', 3, 900)$$, '22023', 'Limite inválido.', 'chave curta demais é recusada');
reset role;

-- 2. Código do aviso de Pix
select ok(not has_column_privilege('authenticated', 'public.honorarios_config', 'banco_webhook_segredo', 'select'),
  'o código secreto do aviso de Pix não é lido pelo navegador');
select ok(has_column_privilege('authenticated', 'public.honorarios_config', 'pix_chave', 'select')
          and has_column_privilege('authenticated', 'public.honorarios_config', 'banco_webhook_em', 'select'),
  'as demais configurações da cobrança continuam visíveis para quem cuida dos honorários');

-- 3. Custo do uso na veterinária
select ok(not has_column_privilege('authenticated', 'public.vet_usos', 'custo_unitario', 'select')
          and has_column_privilege('authenticated', 'public.vet_usos', 'descricao', 'select'),
  'o custo do produto usado no atendimento não aparece pelo navegador (o resto do uso, sim)');

select * from finish();
rollback;
