# Site institucional — ON Guarese's Contabilidade

Site estático (HTML, CSS e JavaScript, sem etapa de compilação), com versão
clara. Direção visual editorial: a paisagem só no topo, fundo liso, linhas
finas e seções numeradas; o vidro do portal aparece só no topo ao rolar, na
ficha do escritório e no formulário; o degradê da marca fica só na logo.
Posicionamento (do site antigo do escritório): médicos e clínicas, produtores
rurais e empresas em geral. Publicado na Vercel.

## Onde mudar cada coisa

| O quê | Onde |
| --- | --- |
| Textos e seções | `index.html` (cada seção tem um comentário com o nome) |
| Cores e fontes | começo de `css/site.css` (variáveis `--degrade`, `--destaque`, ...) |
| Números (clientes, anos, empresas abertas) | `index.html`, bloco `id="numeros"` (na seção Quem somos): preencha `data-alvo` com os valores **reais**. Sem os três valores, a faixa fica escondida. |
| Depoimentos | `index.html`, seção `id="depoimentos"`: copie o modelo comentado. Só depoimentos reais e autorizados por escrito. Sem nenhum, a seção fica escondida. |
| Fotos e mini-bios da equipe | seção `id="quem-somos"` (hoje com as iniciais) |
| Telas do portal | `img/portal-computador.webp` e `img/portal-celular.webp` (sempre da demonstração, com dados fictícios) |

## Formulário de contato

O formulário envia para `https://portal.onguaresescontabilidade.com.br/api/site/contato`
(rota do portal), que manda a mensagem para o e-mail do escritório usando o
servidor de e-mail já configurado no portal. Nada é guardado no banco. Se o
envio não der certo, o site oferece o WhatsApp e o e-mail com a mensagem já
escrita. Proteções: campo isca, tempo mínimo de preenchimento, limite de
envios por endereço e só as origens do site são aceitas.

## Segurança

`vercel.json` define a política de conteúdo (CSP). O pequeno script no
`<head>` (tema claro/escuro) é liberado pelo seu hash: se mudar esse script,
recalcule o hash `sha256` e atualize o `vercel.json` (os testes avisam).

## Testar

```
node --test site/testes/site.test.mjs     # páginas, menu, tema e formulário
node site/testes/servidor.mjs 4000         # abre o site em http://localhost:4000
```
