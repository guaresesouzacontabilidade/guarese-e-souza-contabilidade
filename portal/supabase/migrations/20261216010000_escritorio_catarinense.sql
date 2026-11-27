-- O escritório passa a se chamar Catarinense Contabilidade & Gestão (mesmo
-- CNPJ e endereço, conforme o comprovante de inscrição do CNPJ). Atualiza a
-- razão social e o nome fantasia e informa o telefone/WhatsApp de contato. O
-- e-mail de contato continua o que já estava cadastrado. Só muda se o
-- cadastro ainda estiver com o nome antigo (o que foi editado em
-- Configurações fica como está).

update public.escritorio
   set razao_social = 'CATARINENSE CONTABILIDADE & GESTAO LTDA',
       nome_fantasia = 'CATARINENSE CONTABILIDADE & GESTAO',
       telefone = coalesce(nullif(telefone, ''), '63992969763'),
       whatsapp = coalesce(nullif(whatsapp, ''), '63992969763')
 where cnpj = '62935399000150'
   and razao_social = 'GUARESE''S ON SOLUCOES EMPRESARIAIS LTDA';
