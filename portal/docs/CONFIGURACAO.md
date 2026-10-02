# Configurações e integrações

Este guia explica cada configuração do portal. A maior parte é feita **dentro do próprio portal**, em **Configurações** (somente administradores). Chaves e senhas de serviços externos ficam nas **variáveis de ambiente da hospedagem** (Vercel → Project → Settings → Environment Variables) e nunca aparecem nas telas nem no navegador.

> Regra de ouro: variáveis que começam com `NEXT_PUBLIC_` chegam ao navegador. **Nunca** coloque chaves secretas com esse prefixo.

## 1. Variáveis de ambiente

O script de publicação (`scripts/publicar.ts`) cadastra automaticamente as variáveis marcadas com ✔. As demais são opcionais e ficam “desconectadas” até serem preenchidas.

| Variável | Obrigatória | O que é |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✔ | endereço do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✔ | chave pública do Supabase (pode ir ao navegador; o acesso é limitado pelas regras do banco) |
| `SUPABASE_SECRET_KEY` | ✔ | chave secreta do Supabase — **somente servidor**, marcada como protegida na Vercel |
| `NEXT_PUBLIC_SITE_URL` | ✔ | endereço público do portal (usado nos links dos e-mails e convites) |
| `NEXT_PUBLIC_AMBIENTE` | ✔ | `producao`, `demonstracao` ou `desenvolvimento` (os dois últimos mostram a faixa de aviso) |
| `CRON_SECRET` | ✔ | segredo das rotinas automáticas (`/api/cron/*`) |
| `OCR_ATIVO` | ✔ | `true` liga a leitura automática de imagens e PDFs digitalizados |
| `OCR_CAMINHO_IDIOMAS` | | pasta ou endereço próprio do modelo de idioma do OCR (opcional) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | | envio de e-mails (seção 3) |
| `WHATSAPP_TOKEN`, `WHATSAPP_API_VERSION` | | WhatsApp Business Platform (seção 4) |
| `CLAMAV_HOST`, `CLAMAV_PORT` | | antivírus ClamAV (seção 6) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | ✔ (as duas chaves) | notificações no aparelho (seção 12); a chave privada é **somente servidor** |
| `PORTAL_URL`, `WORKER_INTERVALO_SEGUNDOS`, `WORKER_ROTINA_DIARIA` | | processador contínuo opcional (seção 5) |

Depois de alterar variáveis na Vercel, é preciso publicar de novo (**Deployments → ⋯ → Redeploy**) para que passem a valer.

O modelo completo está em `.env.example`.

## 2. Configurações dentro do portal

**Configurações** (menu do escritório, somente administradores):

| Aba | O que se configura |
| --- | --- |
| Escritório | nome, razão social, CNPJ, endereço, contatos, textos da tela de entrada e, se quiser substituir a logomarca oficial, outra imagem (PNG ou JPG, até 2 MB) |
| Segurança | verificação em duas etapas obrigatória (equipe / clientes) e limites de envio de arquivos (tamanho por arquivo, arquivos por ZIP, tamanho do ZIP) |
| Lembretes | dias de aviso em relação ao prazo (ex.: `-5, -2, 0, +2, +5`), envio por e-mail e por WhatsApp, dados do WhatsApp Business |
| Integrações | situação de cada serviço (conectado / desconectado), envio de e-mail de teste, última execução das rotinas automáticas |
| Privacidade (LGPD) | pedidos dos titulares, prazos de guarda por tipo de documento e eliminação revisada de documentos vencidos |

Outras configurações:

- **Empresas → empresa → Checklist mensal**: quais documentos cada empresa deve enviar todo mês, prazos e responsáveis.
- **Empresas → empresa → Contas bancárias**: contas, saldos iniciais e cartões.
- **Equipe e permissões**: perfis e o que cada pessoa pode fazer em cada empresa.
- **Minha conta** (cada usuário): dados pessoais, senha, verificação em duas etapas, avisos por e-mail.

## 3. E-mail (SMTP)

Sem SMTP, o portal **não finge** que enviou: convites mostram um link para copiar (e enviar por WhatsApp, por exemplo), avisos aparecem só no sino do portal e o histórico registra “não configurado”.

**Jeito mais simples (Gmail do escritório, produção):** crie a senha de app do Gmail (abaixo) e guarde-a na variável `SMTP_PASS` nas configurações do ambiente do Claude Code (nunca no chat). Ao publicar a produção, o script cadastra sozinho o envio na Vercel (`smtp.gmail.com`, porta 465, remetente “Guarese's ON <guaresesouzacontabilidade@gmail.com>”) e no login do Supabase (convites e “Esqueci minha senha”). Para outro Gmail, informe também `SMTP_USER`. A demonstração nunca envia e-mails reais.

Para ativar manualmente, cadastre na Vercel:

```
SMTP_HOST=servidor SMTP do provedor
SMTP_PORT=587            (ou 465)
SMTP_SECURE=false        (true quando a porta for 465)
SMTP_USER=usuário
SMTP_PASS=senha do SMTP  (marque como “Sensitive”)
SMTP_FROM="Portal Guarese's ON <nao-responda@seudominio.com.br>"
```

Opções comuns:

- **Gmail do escritório**: ative a verificação em duas etapas da conta Google, crie uma **senha de app** (Conta Google → Segurança → Senhas de app) e use `smtp.gmail.com`, porta 465, `SMTP_SECURE=true`, `SMTP_USER` = o Gmail e `SMTP_PASS` = a senha de app. Limite de cerca de 500 envios por dia.
- **Serviços de envio** (Brevo, Resend, Amazon SES e similares): costumam ter plano gratuito com limite diário e melhor entrega para caixas de entrada. Exigem confirmar o domínio do remetente.

Depois, em **Configurações → Integrações**, use **Enviar e-mail de teste para mim**.

**“Esqueci minha senha”** é enviado pelo Supabase, não pelo portal. Configure o mesmo SMTP em **Supabase → Authentication → Emails → SMTP Settings**. Sem isso, o Supabase só entrega esses e-mails para membros da conta do Supabase.

## 4. WhatsApp Business Platform (API oficial da Meta)

Fica **desconectado** até que três coisas estejam prontas; enquanto isso nenhuma mensagem é enviada por WhatsApp.

1. Em https://developers.facebook.com, criar um app do tipo **Business** e adicionar o produto **WhatsApp**, com um número de telefone do escritório verificado.
2. Gerar um **token permanente** (Meta Business Suite → Configurações do negócio → Usuários do sistema → gerar token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`). Cadastrar na Vercel como `WHATSAPP_TOKEN` (marcar como “Sensitive”).
3. Criar e aprovar um **modelo de mensagem** (categoria “Utilidade”), em português, com 4 variáveis, por exemplo:

   > Olá! A empresa {{1}} tem {{3}} documento(s) pendente(s) referente(s) a {{2}}. Envie pelo portal: {{4}}

4. No portal, em **Configurações → Lembretes**, informar o **identificador do número** (Phone Number ID), o **nome do modelo** e o idioma (`pt_BR`), e marcar “Enviar lembretes por WhatsApp”.
5. Em cada empresa, cadastrar os contatos com WhatsApp e marcar “recebe lembretes”.

A Meta cobra por conversa iniciada pela empresa conforme a tabela vigente dela.

## 5. Rotinas automáticas

Duas rotinas mantêm o portal em dia:

| Rotina | Frequência | O que faz |
| --- | --- | --- |
| Fila de tarefas (`/api/cron/processar`) | a cada 5 minutos | lê documentos enviados (XML, OCR), envia e-mails e WhatsApp, gera sugestões de conciliação, remove arquivos eliminados |
| Rotina diária (`/api/cron/diario`) | 6h05 (Brasília) | gera o checklist do mês, os lançamentos recorrentes e os lembretes; limpa envios incompletos; gera as tarefas das obrigações (sem duplicar) e os alertas de prazo para a equipe |

Na publicação padrão, o **próprio banco (Supabase, extensões `pg_cron` e `pg_net`)** chama essas rotas com o `CRON_SECRET`, guardado no cofre do Supabase (Vault). A situação aparece em **Configurações → Integrações → Rotinas automáticas**.

Em um servidor próprio, ou para processar mais rápido, é possível rodar o processador contínuo:

```bash
PORTAL_URL=https://seu-portal CRON_SECRET=... WORKER_ROTINA_DIARIA=1 npm run worker
```

## 6. Antivírus (ClamAV) — opcional

Todo arquivo enviado já passa por conferência de tipo (pelo conteúdo real, não só pela extensão), tamanho e estrutura de ZIP. Para também varrer contra vírus, aponte `CLAMAV_HOST`/`CLAMAV_PORT` para um servidor `clamd` acessível pela hospedagem. Sem isso, a integração aparece como “desconectada”.

## 7. Leitura automática de documentos (OCR)

- Feita **no próprio servidor do portal** com o Tesseract: nenhum documento é enviado a serviços externos.
- Na primeira execução, o servidor baixa o modelo do idioma português (arquivo público, sem nenhum dado de cliente) da CDN jsDelivr. Para evitar esse download, informe uma pasta ou endereço próprio em `OCR_CAMINHO_IDIOMAS`.
- Os dados lidos (CNPJ, datas, valores) são **sugestões**: uma pessoa do escritório confere antes de virar lançamento.
- Para desligar: `OCR_ATIVO=false`.

## 8. Login e segurança (Supabase Auth)

Aplicado automaticamente pelo script de publicação (confira em **Supabase → Authentication**):

- Cadastro público **desligado** (só entra quem for convidado).
- Senha com no mínimo 10 caracteres, com letras maiúsculas, minúsculas e números.
- Verificação em duas etapas por aplicativo autenticador (TOTP) habilitada.
- Endereço do site e endereços de retorno permitidos (**URL Configuration**).
- Renovação de sessão com rotação de token; links de convite válidos por 24 horas.
- Modelos de e-mail em português.

No Supabase Pro, o script também limita a sessão a 24 horas e encerra após 8 horas sem uso.

## 9. Domínio próprio

1. Registrar o domínio (ex.: no Registro.br).
2. Executar a publicação com `--dominio portal.seudominio.com.br` (veja `IMPLANTACAO.md`).
3. No Registro.br, criar um registro **CNAME** de `portal` para `cname.vercel-dns.com`.
4. Aguardar a propagação (minutos a algumas horas). A Vercel emite o certificado HTTPS sozinha.

## 10. Logomarca

A logomarca oficial (ON com a seta, “Guarese’s” e “CONTABILIDADE”) foi vetorizada a partir da arte enviada pelo escritório (`docs/marca/logo-original.jpg`) e está em três versões em `public/marca/`: vertical (tela de entrada), horizontal (menu) e símbolo (ícone do navegador, em `src/app/icon.svg`). Nos relatórios em PDF ela vem de `src/lib/marca/logo.ts`. A cor acompanha o tema: marrom no fundo claro e clara no menu e no modo escuro.

## 11. Obrigações e prazos (camada operacional)

Fica em **Obrigações e prazos** (somente equipe). Configurações necessárias depois de publicar:

1. **Endereço do escritório** (Configurações → Escritório): a cidade e a UF definem o calendário de dias úteis usado nos **prazos internos** da equipe.
2. **Regras do catálogo**: chegam como propostas, com a fonte oficial e a data da consulta. Um administrador confere, **valida** e **aplica** em Obrigações → Atualizações normativas. Nenhum prazo é calculado sem regra validada.
3. **ICMS, ISS e EFD ICMS/IPI**: sem regra padrão — cada estado e município define o prazo. Proponha a regra por UF ou município, com a lei e o link oficial.
4. **Feriados municipais**: cadastre em Obrigações → Feriados, com a fonte. Os nacionais e os do Tocantins (2024–2030) já vêm cadastrados; o Carnaval e o Corpus Christi contam só para regras que dependem de expediente bancário.
5. **Empresas**: município (código do IBGE), ICMS/ISS, empregados e pró-labore, histórico de regimes (no Lucro Real, trimestral ou anual) e, se preciso, inclusões ou exclusões por vigência, responsável, revisor e prazo interno próprio.

Como funciona:

- Cada regra informa aplicabilidade (regimes, local, exigências do cadastro), periodicidade, regra de vencimento (dia fixo, n-ésimo dia útil ou último dia útil), o que fazer quando não é dia útil (antecipar, adiar ou manter), quais feriados contam e a fonte oficial.
- O prazo de entrega, o vencimento do pagamento e o prazo interno são separados. O prazo interno é contado em dias úteis do escritório antes do prazo legal.
- A reforma tributária é tratada por competência: PIS/Cofins até 12/2026, CBS e IBS a partir de 01/2027 (com prazo a regulamentar até a publicação do regulamento) e o destaque de teste em 2026. ICMS e ISS seguem até que uma atualização normativa encerre a regra; o histórico das competências anteriores é mantido.
- Regra validada não é alterada: mudanças entram como atualização normativa (proposta → validação → aplicação). Na aplicação, a regra anterior é encerrada no mês anterior à vigência nova e as tarefas abertas são recalculadas.
- As tarefas são geradas pela rotina diária para os últimos 12 meses (sem criar atrasos de períodos anteriores ao uso do sistema) e pelo botão **Gerar tarefas**. Não há duplicidade: cada empresa, obrigação, competência e etapa tem uma única tarefa.
- Entrega e pagamento só são concluídos com recibo ou comprovante que esteja no portal. Tarefas com revisor só são concluídas por quem revisa (ou por um administrador).
- Todas as mudanças ficam na Auditoria (filtro “Obrigações, prazos e normas”) e no histórico de cada tarefa.

Os dados de municípios vêm da tabela oficial do IBGE (5.571 municípios) e foram carregados no próprio banco: o portal não consulta serviços externos para calcular prazos.

## 12. Notificações no aparelho (Web Push)

Os avisos do portal (por exemplo, “Padaria enviou 3 arquivos”) também podem chegar como notificação no celular ou no computador, mesmo com o portal fechado. Cada pessoa ativa em **Minha conta → Avisos → Ativar neste aparelho**; a situação geral aparece em **Configurações → Integrações**.

- **Chaves**: o padrão Web Push usa um par de chaves (VAPID). O script de publicação cria o par na primeira publicação e o mantém nas seguintes — trocar as chaves desativa os avisos de todos os aparelhos, que precisariam ser ativados de novo. A chave pública vai ao navegador; a privada fica só na hospedagem (variável protegida).
- **Sem as chaves**, a integração aparece como **desconectada**: os avisos ficam só no sino e nada é enviado aos aparelhos (o portal não simula a entrega).
- **Para gerar manualmente** (servidor próprio): `npx web-push generate-vapid-keys` e cadastre `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. `VAPID_SUBJECT` é opcional (padrão: o endereço do portal).
- **Entrega**: a fila de tarefas envia o aviso logo depois da ação que o gerou (ex.: o envio de arquivos pelo cliente) e, nos demais casos, na rotina de 5 minutos. Aparelhos cuja permissão foi retirada são removidos automaticamente; o aviso só vai para aparelhos com a sessão ativa.
- **Instalação na tela inicial**: o portal tem manifesto e ícones próprios. No iPhone/iPad, as notificações só funcionam com o portal instalado na Tela de Início (iOS 16.4 ou mais recente).

