-- O sistema passa a se chamar Catarinense Tech (produto independente do
-- escritório). Troca o padrão do nome e da mensagem da tela de entrada e
-- atualiza o cadastro do escritório só onde ainda estavam os textos antigos
-- (o que o escritório personalizou em Configurações fica como está).

alter table public.escritorio
  alter column nome_sistema set default 'Catarinense Tech',
  alter column mensagem_login set default 'Bem-vindo ao Catarinense Tech. Envie seus documentos, acompanhe suas pendências e entenda a saúde financeira da sua empresa.';

update public.escritorio
   set nome_sistema = 'Catarinense Tech'
 where nome_sistema = 'Portal Guarese''s ON';

update public.escritorio
   set mensagem_login = 'Bem-vindo ao Catarinense Tech. Envie seus documentos, acompanhe suas pendências e entenda a saúde financeira da sua empresa.'
 where mensagem_login = 'Bem-vindo ao seu Portal Guarese''s ON. Envie seus documentos, acompanhe suas pendências e entenda a saúde financeira da sua empresa.';
