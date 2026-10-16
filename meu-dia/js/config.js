// Configuração da nuvem (Supabase) para cadastro, login e sincronização entre aparelhos.
// A chave "anon/publishable" é pública por natureza: a proteção dos dados é feita
// pelas regras de segurança (RLS) do banco — veja supabase/migrations.
// Deixe vazio para usar o app só neste aparelho (as telas de conta avisam isso).
export const SUPABASE_URL = 'https://ijwoglxhwbihpriauhay.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_iFJSFVjZHb-7qOSNpeA4Cw_6tn4Z4lx';
// Endereço público do app. Os links dos e-mails (confirmar conta, nova senha) abrem aqui
// quando o pedido sai do app Android, que roda num endereço interno do celular.
export const PUBLIC_URL = 'https://guaresesouzacontabilidade.github.io/guarese-e-souza-contabilidade/meu-dia/';
