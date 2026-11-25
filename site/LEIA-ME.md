# Site institucional — Catarinense Contabilidade & Gestão

Site estático feito com **Vite** (HTML, CSS e JavaScript, sem bibliotecas):
o Vite junta e minifica o CSS e o JavaScript, com o nome versionado, e gera a
pasta `dist`, que é o que vai para o ar. Direção visual editorial e clara: céu claro
com ondas suaves de verde e vermelho só no topo, fundo liso, linhas finas e
seções numeradas; o vidro aparece só no topo ao rolar, na ficha do escritório
e no formulário. Cores do símbolo da Catarinense: verde (#07461f), vermelho
(#8e1018) e branco. A versão clara é a padrão; a escura é opcional pelo botão
do topo. A logo (símbolo + CATARINENSE + "Contabilidade e Gestão") fica em
`public/img/logo-horizontal.png` (letras claras no modo escuro:
`logo-horizontal-claro.png`); a arte original está em
`../portal/docs/marca/catarinense-original.png`.
Posicionamento (do site antigo do escritório): médicos e clínicas, produtores
rurais e empresas em geral. Publicado na Vercel, que roda `npm ci` e
`npm run build` e publica a pasta `dist` (configurado no `vercel.json`).

Endereço: **https://onguaresescontabilidade.com.br** (o `www` redireciona para
ele). O domínio está no Registro.br, com duas entradas na zona DNS: tipo A
(nome em branco) `76.76.21.21` e CNAME `www` → `cname.vercel-dns.com`. As
entradas de e-mail do Google (MX e TXT) e a do portal (`portal`, CNAME para a
Vercel) ficam como estão. O certificado (https) é renovado pela Vercel.

## Pastas

| Pasta ou arquivo | O que tem |
| --- | --- |
| `index.html`, `privacidade.html`, `404.html` | as três páginas (entradas do Vite, ver `vite.config.js`) |
| `css/site.css`, `js/site.js` | estilos e comportamento; o Vite empacota em `/assets` |
| `public/` | arquivos que mantêm o endereço: `img/`, `fontes/`, manifesto, `robots.txt`, `sitemap.xml` |
| `testes/` | testes automáticos e o servidor local que imita a Vercel |

## Onde mudar cada coisa

| O quê | Onde |
| --- | --- |
| Textos e seções | `index.html` (cada seção tem um comentário com o nome) |
| Cores e fontes | começo de `css/site.css`: `:root` (versão clara, padrão) e `html.escuro` (versão escura). Principais: `--fundo`, `--texto`, `--botao-fundo`, `--marca` (traço do verde ao vermelho). Topo parado: `public/img/fundo-catarinense.svg`; cores das ondas em movimento: variáveis `--onda1-alto` a `--onda4-pe` em `.heroi`. |
| Ondas do topo (em movimento) | `js/site.js`, bloco "Topo: as ondas do fundo": em cada camada, `base` e `amp` são a altura e o tamanho das ondas, e o 4º número de cada onda é a velocidade (0 para parar); as cores vêm do CSS (`--onda1-alto`...). O céu fica em `public/img/fundo-catarinense-ceu.svg`; com pouco movimento no aparelho (ou sem JavaScript) aparece o topo parado `public/img/fundo-catarinense.svg`. |
| Números (clientes, anos, empresas abertas) | `index.html`, bloco `id="numeros"` (na seção Quem somos): preencha `data-alvo` com os valores **reais**. Sem os três valores, a faixa fica escondida. |
| Depoimentos | `index.html`, seção `id="depoimentos"`: copie o modelo comentado. Só depoimentos reais e autorizados por escrito. Sem nenhum, a seção fica escondida. |
| Fotos e mini-bios da equipe | seção `id="quem-somos"` (hoje com as iniciais) |
| Telas do portal | Vídeo no notebook: `public/video/portal-demonstracao.webm` e `.mp4` (gravados no portal da demonstração, aparência Catarinense (vidro claro), com dados fictícios; a resposta digitada nas Mensagens não é enviada). A imagem `public/img/portal-computador.webp` é o primeiro quadro do vídeo e aparece antes de ele tocar, sem JavaScript ou com pouco movimento no aparelho. No celular do desenho fica `public/img/portal-celular.webp`. O vídeo só baixa quando a seção aparece na tela e tem botão de pausar. |

## Formulário de contato

O formulário envia para `https://portal.onguaresescontabilidade.com.br/api/site/contato`
(rota do portal), que manda a mensagem para o e-mail do escritório usando o
servidor de e-mail já configurado no portal. Nada é guardado no banco. Se o
envio não der certo, o site oferece o WhatsApp e o e-mail com a mensagem já
escrita. Proteções: campo isca, tempo mínimo de preenchimento, limite de
envios por endereço e só as origens do site são aceitas.

## Segurança

`vercel.json` define a política de conteúdo (CSP). O pequeno script no
`<head>` (tema claro/escuro) é liberado pelo seu hash; o Vite não altera esse
script. Se mudar o script, recalcule o hash `sha256` e atualize o
`vercel.json` (os testes avisam).

## Testar

Na pasta `site`:

```
npm install                    # uma vez
npm run dev                    # site com recarga automática, para editar
npm test                       # compila com o Vite e testa o build: páginas, menu, tema, formulário e CSP
npm run build && node testes/servidor.mjs 4000   # o build como na Vercel (com a CSP), em http://localhost:4000
```
