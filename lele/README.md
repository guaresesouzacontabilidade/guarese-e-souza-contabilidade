# App da Lelé — flashcards de medicina

App de flashcards com **repetição espaçada** (no estilo do Anki), feito para a Lelé estudar medicina.
Funciona no iPhone (instalado na tela de início), no computador e sem internet. Interface em português,
tema claro/escuro e sincronização entre aparelhos.

> Esta pasta é independente do site da contabilidade e do Meu Dia: nada fora de `lele/` foi alterado.

## O que já funciona

| Área | O que faz |
| --- | --- |
| **Início** | Saudação com o nome dela, quantos cartões tem para hoje (novos · aprendendo · para revisar) e botão “Estudar agora”; sequência de dias 🔥, cartões e minutos de hoje, % de acertos; baralhos agrupados (ex.: “Clínica Médica”) com contadores e barra de progresso; busca em todos os cartões. |
| **Estudar** | Cartão que vira com animação; botões **Errei / Difícil / Bom / Fácil** mostrando quando o cartão volta (1 min, 10 min, 4 dias…); desfazer; editar o cartão sem sair; cartões errados voltam na mesma sessão; tela de comemoração com confete de corações. No computador: Espaço, 1–4, Z (desfazer), E (editar), Esc. |
| **Treino livre** | Todos os cartões de um baralho embaralhados, sem mexer na agenda (bom para a véspera da prova). |
| **Cartões** | Três tipos: *pergunta e resposta*, *ida e volta* (gera os dois sentidos) e *lacunas* (`{{c1::…}}`, como no Anki — selecione um trecho e toque em **Ocultar**). Negrito, destaque, listas, setas (`->` vira →), campo “extra” e foto/imagem (comprimida para sincronizar rápido). Pausar, recomeçar e apagar. |
| **Importar** | Cola uma lista ou abre um arquivo `.txt/.csv/.tsv/.md`: `pergunta ; resposta`, tabulação (planilha/Anki), `::`, `|`, ou blocos separados por linha em branco. Linhas com `{{…}}` viram lacunas. Mostra a prévia antes de importar. |
| **Progresso** | Sequência e recorde, calendário dos últimos meses, revisões por dia (30 dias), % de acertos, previsão dos próximos 7 dias e cartões por fase (novos, aprendendo, recentes, dominados). |
| **Ajustes** | Nome, cartões novos por dia, tema, sons, sincronização (código), instalar no iPhone, backup (salvar/restaurar `.json`), apagar dados do aparelho. |
| **Notion** | Ajustes › Notion › **Conectar**: ela entra na conta do Notion e escolhe as páginas que o app pode ler (só leitura). Em **Gerar cartões do Notion**, escolhe as páginas e o app cria os cartões sozinho, **um baralho por tópico** (títulos da página; ou um baralho por página), mostrando tudo antes de salvar. **Atualizar do Notion** traz só o que é novo ou mudou, sem mexer no que ela apagou ou editou no app. A conexão vale para todos os aparelhos dela. |
| **Baralhos prontos** | Pacotes em `packs/` entram com um toque (“Chegaram cartões novos…”). Ao atualizar um pacote, só entram as notas novas: nada do que ela editou ou apagou é sobrescrito. |
| **Toque pessoal** | Recado escondido configurável em `js/personal.js` (aparece depois da primeira revisão completa e em Ajustes). |

### Como o app agenda os cartões

SM-2 com etapas de aprendizado, como no Anki: cartão novo passa por 1 min → 10 min → 1 dia; depois o intervalo
cresce com a “facilidade” do cartão (Difícil ×1,2, Bom ×facilidade, Fácil ×facilidade×1,3). Errar um cartão
em revisão faz ele voltar em 10 min e reduz a facilidade. Cartões irmãos (lacunas da mesma nota) ficam
separados na sessão para um não entregar a resposta do outro. O dia vira às **4h da manhã**.
Limite padrão: 20 cartões novos por dia (ajustável).

## Usar no iPhone

1. Abra o endereço publicado no **Safari**.
2. Toque em **Compartilhar** › **Adicionar à Tela de Início**.
3. Abra pelo ícone: tela cheia, funciona sem internet.

## Sincronização

Não tem login nem senha: o primeiro aparelho cria um **código de sincronização** (`LELE-XXXXX-XXXXX-XXXXX-XXXXX`,
~100 bits aleatórios). No outro aparelho, toque em **Já uso em outro aparelho** e digite o código
(fica em Ajustes › Sincronização). Os dados ficam sempre no aparelho e cada mudança vai para a nuvem; se o mesmo
item mudar em dois lugares, vale a alteração mais recente.

O banco guarda só um *hash* do código. A tabela não é acessível pela API: tudo passa pelas funções
`lele_pull` e `lele_push` (veja `supabase/migrations/`).

### Configurar o Supabase

O app usa **o mesmo projeto Supabase do Meu Dia**, numa tabela própria (`lele_records`), sem misturar com os dados
do Meu Dia (`meudia_records`). A URL e a chave *publishable* já estão em `js/config.js`.

A tabela e as funções já foram criadas nesse projeto (migração `supabase/migrations/20261111120000_app_da_lele_init.sql`,
aplicada em 11/11/2026). Ao abrir o app e tocar em **Começar**, a sincronização liga sozinha (Ajustes › Sincronização
mostra “Sincronizado”).

O painel do Supabase mostra avisos de que `lele_pull`/`lele_push` podem ser chamadas sem login e de que a tabela tem
RLS sem políticas: é de propósito. A tabela fica fechada e o acesso só acontece pelas funções, protegidas pelo código.

Observação: no plano gratuito, o Supabase “dorme” o projeto depois de cerca de uma semana sem nenhum uso
(do Meu Dia ou do App da Lelé). Os cartões continuam no aparelho; é só reativar no painel.

Para usar outro projeto, troque a URL e a chave em `js/config.js` e rode o mesmo SQL no SQL Editor dele.

Sem `js/config.js` preenchido o app funciona só no aparelho (com backup por arquivo).

## Ligação com o Notion

### Como as anotações viram cartões (sem IA, de graça)

| No Notion | Vira |
| --- | --- |
| Título (H1/H2/H3) | Tópico → um baralho (subtítulos aparecem no cartão como contexto) |
| Toggle (▸ título com conteúdo dentro) | Pergunta = título do toggle, resposta = conteúdo |
| `Termo: definição` (também `—`, `–`, `->`, `=`) | Pergunta = termo, resposta = definição |
| Item de lista com subitens | Pergunta = item, resposta = subitens |
| Frase terminando em `?` | Pergunta; resposta = subitens ou o parágrafo seguinte |
| Trechos em **negrito** ou com marca-texto | Lacunas (`{{c1::…}}`) |
| Tabela | Uma linha = um cartão (1ª coluna → demais colunas com o nome de cada coluna) |

Texto corrido sem nenhuma marcação não vira cartão (a lógica está em `js/core/notionCards.js`, com testes).

### Como funciona por dentro

O navegador não pode falar direto com a API do Notion, então há uma Edge Function no Supabase do Meu Dia:
`supabase/functions/lele-notion` (código em `handler.js`, testado no Node). Ela faz o login com o Notion (OAuth),
guarda o token na tabela fechada `lele_notion` (ligado ao hash do código de sincronização) e lê as páginas.
Tabelas em `supabase/migrations/20261112120000_lele_notion.sql`.

### Ativar (uma vez)

1. Em https://www.notion.so/profile/integrations › **New integration**: tipo **Public**, nome “App da Lelé”.
   - Redirect URI: `https://ijwoglxhwbihpriauhay.supabase.co/functions/v1/lele-notion`
   - Site: `https://guaresesouzacontabilidade.github.io/guarese-e-souza-contabilidade/lele/`
   - Privacidade e Termos: `https://guaresesouzacontabilidade.github.io/guarese-e-souza-contabilidade/lele/privacidade.html`
   - Capacidades: só **Read content**; informações de usuário: nenhuma.
2. Copie o **OAuth client ID** e o **OAuth client secret** da integração.
3. No Supabase do Meu Dia › **Edge Functions › Secrets**, crie `NOTION_CLIENT_ID` e `NOTION_CLIENT_SECRET`.

Atualizar a função: `supabase functions deploy lele-notion --no-verify-jwt` (Supabase CLI) a partir de `lele/`.

## Adicionar baralhos prontos

1. Crie `packs/<id>.json`:
   ```json
   {
     "id": "cardio",
     "version": 1,
     "decks": [{ "key": "ic", "name": "Insuficiência cardíaca", "group": "Cardiologia", "color": "#E0457B", "emoji": "🫀" }],
     "notes": [
       { "id": "1", "deck": "ic", "type": "basic", "front": "Pergunta", "back": "Resposta", "extra": "" },
       { "id": "2", "deck": "ic", "type": "cloze", "front": "Texto com {{c1::lacuna}}", "extra": "" }
     ]
   }
   ```
2. Adicione o pacote em `packs/index.json` (`id`, `version`, `title`, `description`, `emoji`, `file`).
3. Para mandar cartões novos de um pacote que ela já tem: acrescente notas com **ids novos** e aumente `version`.
4. Rode `npm run precache`.

## Publicar (GitHub Pages)

Arquivos estáticos, sem compilação. Com o Pages publicando a branch `main`, o endereço fica
`https://guaresesouzacontabilidade.github.io/guarese-e-souza-contabilidade/lele/`.

## Desenvolvimento

```bash
npm install            # ferramentas (testes, ícones, fontes)
npm start              # http://localhost:4180/  (LELE_FAKE_CLOUD=1 liga uma nuvem de teste em memória)
npm test               # testes de unidade: agendamento, lacunas, importação, estatísticas
npm run test:e2e       # navegador: celular pequeno, iPhone e computador, incluindo sincronização
npm run precache       # OBRIGATÓRIO depois de mudar qualquer arquivo do app (modo offline)
```

```
index.html, manifest.webmanifest, sw.js   página, PWA e modo offline
css/app.css                               identidade visual (Fraunces + Nunito, tokens claro/escuro)
js/core/        regras puras e testadas: datas, agendamento (srs), fila, lacunas, texto, importação, estatísticas
js/data/        salvamento local (IndexedDB), ações, pacotes, backup
js/services/    sincronização, efeitos/sons, imagens, instalação
js/ui/          telas (views), painéis (sheets) e componentes
packs/          baralhos prontos
supabase/       migração do banco
tests/          unidade (node:test) e ponta a ponta (Playwright)
```

Bibliotecas de terceiros em `js/vendor/` (Preact + htm, ícones Lucide — MIT/ISC) e fontes Fraunces e Nunito (OFL)
em `assets/fonts/`, geradas por `npm run vendor`.
