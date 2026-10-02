-- =============================================================================
-- E-mail de contato do escritório: onguaresescontato@gmail.com
-- (substitui o e-mail anterior apenas se ele ainda não tiver sido alterado
-- em Configurações → Escritório)
-- =============================================================================
update public.escritorio
   set email = 'onguaresescontato@gmail.com'
 where id = 1
   and email = 'guaresesouzacontabilidade@gmail.com';
