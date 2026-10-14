# Meu Dia — agenda inteligente e assistente financeiro

Aplicativo pessoal para organizar o dia e cuidar do dinheiro sem complicação.
Funciona no computador, no iPhone e no Android (PWA instalável), com interface em português do Brasil,
tema claro/escuro e salvamento automático.

> Esta pasta é independente do site da contabilidade: nada fora de `meu-dia/` foi alterado.

## O que já funciona

| Área | O que faz |
| --- | --- |
| **Início** | Saudação e data, compromissos e tarefas de hoje, resumo do mês (saldo, receitas, despesas), indicador de orçamento, contas que vencem em breve, atalhos e botão para ocultar valores. |
| **Adicionar** | Botão sempre visível. Compromisso, tarefa, receita, despesa ou conta, cada um com só os campos essenciais; o resto fica em “Mais detalhes”. |
| **Agenda** | Visualizações dia, semana e mês; criar, editar, concluir e excluir; horário, local, notas, categoria, prioridade, lembrete; repetição semanal, mensal e anual; busca e filtros. Contas que vencem aparecem nos dias certos. |
| **Finanças** | Receitas e despesas em segundos (valor, descrição e data); categoria sugerida automaticamente pela descrição; carteiras (banco, dinheiro, cartão) com saldo; busca; edição e exclusão com confirmação e “Desfazer”; aviso de lançamento repetido. |
| **Contas** | A pagar e a receber; vencidas, vencem em breve, próximas e pagas; “Pagar”/“Recebi” com um toque; depois pergunta se quer registrar em Finanças e reaproveita um lançamento parecido para não duplicar; contas recorrentes geram a próxima sozinhas; lembretes configuráveis (no dia, 1, 3 ou 7 dias antes). |
| **Assistente** | Responde perguntas como “Quanto gastei este mês?”, “Quanto gastei com combustível?”, “Quais contas vencem esta semana?”, “Quanto ainda tenho no orçamento?”, “Qual foi meu maior gasto?”. Usa só os dados registrados, mostra “Como calculei” e avisa quando não há dados. Não faz pagamentos nem promete resultados. |
| **Relatórios** | Receitas, despesas e saldo por período (este mês, mês passado, 3 meses, ano ou datas livres), gastos por categoria, gráfico mês a mês (com opção de tabela) e comparação com o período anterior em frases simples. |
| **Ajustes** | Nome, tema, ocultar valores, orçamento mensal, lembretes e notificações, conta e sincronização, instalação, exportar/importar dados (JSON e planilha CSV) e excluir dados/conta. |

### Limites honestos desta versão

- **Notificações:** só aparecem com autorização. No **app nativo (Android)** tocam no horário mesmo com o app
  fechado. Na versão web, chegam enquanto o app está aberto ou em segundo plano (com o app totalmente fechado,
  o aviso aparece ao abrir); no iPhone, a versão web precisa estar adicionada à Tela de Início.
- **Conta e sincronização:** o código está pronto (cadastro, login, recuperação de senha, sincronização,
  exclusão de conta), mas só aparece ativo depois de configurar o Supabase (veja abaixo). Até lá, o app avisa
  que os dados ficam salvos neste aparelho.
- Não se conecta a bancos e não movimenta dinheiro.

## Usar no celular

Depois de publicado (veja abaixo), abra o endereço no navegador do celular:

- **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**.
- **Android (Chrome):** menu ⋮ → **Instalar app** (ou o botão “Instalar Meu Dia” em Ajustes).
- **Computador (Chrome/Edge):** ícone de instalar na barra de endereço, ou Ajustes → Instalar.

Instalado, ele abre em tela cheia e funciona sem internet.

## Publicar (GitHub Pages)

O app não precisa de compilação: são arquivos estáticos.

1. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/ (root)`.
2. O endereço fica `https://<usuário>.github.io/<repositório>/meu-dia/`.

Qualquer hospedagem estática com HTTPS serve (Netlify, Vercel, Cloudflare Pages…) — basta publicar a pasta `meu-dia/`.

## Ativar conta e sincronização (Supabase)

1. Crie um projeto no [Supabase](https://supabase.com) (de preferência só para o Meu Dia).
2. Em **SQL Editor**, rode o arquivo `supabase/migrations/20261014120000_meu_dia_init.sql`.
   Ele cria a tabela `meudia_records` com **RLS** (cada pessoa só lê e altera os próprios dados) e a função
   para excluir a conta.
3. Em **Authentication → URL Configuration**, coloque o endereço publicado do app em *Site URL* e em *Redirect URLs*
   (ex.: `https://<usuário>.github.io/<repositório>/meu-dia/`). É para lá que vão os links de confirmação e de nova senha.
4. Em **Authentication → Providers → Email**, mantenha a confirmação de e-mail ligada e, se quiser, traduza os
   modelos de e-mail para português em **Email Templates**.
5. Em **Project Settings → API**, copie a *Project URL* e a chave *anon/publishable* para `js/config.js`.
   Essa chave é pública por natureza; a proteção vem do RLS.
6. Rode `npm run precache` e publique.

Como funciona: os dados ficam sempre no aparelho (abre e funciona offline) e, com a conta conectada, cada mudança é
enviada para a nuvem e baixada nos outros aparelhos. Se o mesmo item for alterado em dois lugares, vale a alteração
mais recente. Ao entrar pela primeira vez, o app pergunta se deve juntar os dados que já estavam no aparelho.

## App nativo (Android e iPhone)

O mesmo código vira app nativo com o [Capacitor](https://capacitorjs.com). No app nativo:
os lembretes tocam **mesmo com o app fechado**, o “Exportar” abre o menu de compartilhar
do celular e o app aparece na lista de apps como qualquer outro.

### Android — instalar o APK

1. Pegue o arquivo `MeuDia-x.y.z.apk`:
   - no GitHub: aba **Actions** › “Meu Dia — app Android” › última execução › **Artifacts** › `MeuDia-android`
     (vem compactado em .zip; dentro está o .apk);
   - ou gere no computador com `npm run android:apk` (precisa de Java 21 e Android SDK).
2. Envie o .apk para o celular (Google Drive, WhatsApp, cabo…) e toque nele.
3. O Android vai pedir para **permitir instalar apps desta fonte** — permita e toque em **Instalar**.
4. Abra o Meu Dia e, em **Ajustes › Lembretes**, ative as notificações.

Versões novas instalam **por cima**, sem perder dados, desde que sejam assinadas com a **mesma chave**.
Por isso, guarde a chave do app (arquivo `meudia-release.jks` + senha) em local seguro e cadastre-a
no GitHub em **Settings › Secrets and variables › Actions**:

| Segredo | Valor |
| --- | --- |
| `MEUDIA_KEYSTORE_BASE64` | conteúdo do arquivo `meudia-keystore-base64.txt` |
| `MEUDIA_KEYSTORE_PASSWORD` | a senha da chave |

Sem esses segredos, o GitHub gera um APK de teste (com outra chave): para instalá-lo seria preciso
desinstalar a versão anterior — exporte um backup antes.

**Google Play:** com a mesma chave, `cd android && ./gradlew bundleRelease` gera o `.aab` que a Play Store
pede (conta de desenvolvedor Google: taxa única de US$ 25).

### iPhone

A Apple só permite instalar apps nativos assinados por uma conta **Apple Developer** (US$ 99/ano)
e o app precisa ser compilado num **Mac com Xcode**:

```bash
npm install @capacitor/ios@8
npm run build:native
npx cap add ios
npx cap open ios      # no Xcode: escolha sua equipe em Signing e rode no iPhone ou envie ao TestFlight
```

Enquanto isso, no iPhone use a versão web instalada (Safari › Compartilhar › **Adicionar à Tela de Início**):
ela abre em tela cheia e funciona sem internet; os lembretes aparecem com o app aberto.

## Desenvolvimento

```bash
npm install            # ferramentas de desenvolvimento (testes, ícones)
npm start              # http://localhost:4173/
npm test               # testes de unidade (cálculos, datas, contas, assistente)
npm run test:e2e       # testes no navegador: 320px, iPhone, Android e computador
npm run precache       # OBRIGATÓRIO depois de mudar qualquer arquivo do app (atualiza o modo offline)
```

App Android: `npm run android` (prepara `android/`) e `npm run android:apk` (gera o APK em `dist-android/`).

Outros scripts: `npm run vendor` (atualiza Preact/htm, Supabase, fontes e ícones em `js/vendor/`),
`npm run icons` (gera os PNGs a partir de `assets/icons/icon.svg`).

### Organização

```
index.html, manifest.webmanifest, sw.js   página, PWA e modo offline
css/app.css                               identidade visual (tokens de cor, claro/escuro)
js/core/        regras puras e testadas: datas, dinheiro, repetições, agenda, finanças, contas, lembretes, relatórios, assistente
js/data/        salvamento local (IndexedDB), estado, backup
js/services/    nuvem (Supabase), notificações, instalação
js/ui/          telas, formulários e componentes
supabase/       migração do banco com RLS
tests/          unidade (node:test) e ponta a ponta (Playwright)
```

Sem etapa de build: os módulos ES rodam direto no navegador. Bibliotecas de terceiros ficam em `js/vendor/`
(Preact + htm, supabase-js, ícones Lucide — licenças MIT/ISC) e as fontes Manrope e Sora (OFL) em `assets/fonts/`.

## Privacidade

- Nenhum dado de exemplo: o app começa vazio e só mostra o que você registra.
- Dados locais ficam no navegador do aparelho; com conta, ficam também no seu projeto Supabase, isolados por usuário.
- Exportar tudo (JSON/CSV) e excluir dados ou a conta estão em Ajustes.
