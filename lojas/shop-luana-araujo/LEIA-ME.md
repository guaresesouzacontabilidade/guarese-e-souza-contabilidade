# Site da Shop Luana Araújo

Loja online da Shop Luana Araújo (maquiagem, prata 925 e aço inoxidável, Porto
Nacional – TO), feita para substituir a FácilZap. O pedido é fechado pelo
WhatsApp da loja.

**O site não tem banco de dados próprio.** Produtos, preços, estoque, fotos e
pedidos ficam no **Portal Guarese's ON**, na empresa da loja (Gestão da loja →
aba **Site da loja**). O site lê o catálogo do portal e manda os pedidos para lá
usando uma **chave secreta**, que fica só no servidor do site. O pedido entra no
portal como orçamento marcado "Site"; no caixa, "Vender" transforma o pedido em
venda (baixa o estoque, entra no Financeiro e pode sair a NF-e).

- Tecnologia: Next.js 16 e Tailwind CSS 4, publicado na Vercel.
- Visual: preto e prata da logo original, fundo branco quente, Cormorant nos
  títulos e Montserrat no texto (direção definida com a skill `ui-ux-pro-max`).
- Cache: cada página guarda o catálogo por até 60 segundos. Com muitas ou poucas
  visitas, o portal recebe no máximo uma consulta por minuto por página. Uma
  mudança de preço ou estoque no portal aparece no site em até 1 minuto.
- Fotos: o portal guarda cada foto em dois tamanhos prontos (WebP, 600 e
  1200 px). O site só escolhe o tamanho, sem serviço pago de otimização de imagens,
  e entrega as fotos pelo próprio endereço (`/fotos/...`): a Vercel busca cada uma
  no portal uma vez e guarda por um ano (o nome da foto nunca muda). Assim o
  armazenamento do portal quase não reenvia fotos, e o link compartilhado no
  WhatsApp mostra a imagem pelo domínio da loja.

## Páginas

| Endereço | O que tem |
| --- | --- |
| `/` | início: banners de campanha (quando há algum no ar) ou a abertura com foto de produto, entregas, categorias, novidades, destaques e como comprar |
| `/c/<categoria>` | categoria com subcategorias, ordenar e "ver mais" |
| `/p/<id>/<nome>` | produto: fotos, preço, escolha da opção (cor, tom, tamanho), quantidade, entrega e descrição |
| `/busca` | busca sem acento e com palavras em qualquer ordem |
| `/sacola` | sacola e pedido em uma tela só; depois de enviar, botão com a mensagem pronta para o WhatsApp |
| `/sobre`, `/trocas`, `/privacidade` | informações da loja, trocas e devoluções (CDC) e privacidade (LGPD) |

A razão social e o CNPJ (do cadastro da empresa no portal) aparecem no rodapé,
como pede o Decreto 7.962/2013 para lojas virtuais.

## Onde mudar cada coisa

| O quê | Onde |
| --- | --- |
| Produtos, preço, estoque | Portal → Loja → Produtos e estoque |
| Fotos, nome no site, descrição, opções, categoria, destaque, promoção | Portal → Loja → Site da loja → Produtos no site |
| Categorias e a ordem do menu | Portal → Site da loja → Categorias |
| Banners de campanha (imagem para computador 1920 × 600 e para celular 1080 × 1080, link, período e ordem) | Portal → Site da loja → Banners |
| WhatsApp, Instagram, endereço, aviso do topo, entregas, pagamentos, textos "Sobre" e "Trocas" | Portal → Site da loja → Configurar o site |
| Ligar ou desligar o site ("loja fechada no momento") | Portal → Configurar o site → "Site ligado" |
| Cores e fontes | `src/app/globals.css` (bloco `@theme`) |
| Logo | `public/marca/logo-prata.png` (letras prateadas, fundo transparente) |
| Textos fixos (abertura, "Como comprar") | `src/app/page.tsx` |

## Variáveis (Vercel → Settings → Environment Variables)

| Variável | Valor |
| --- | --- |
| `PORTAL_URL` | `https://portal.onguaresescontabilidade.com.br` |
| `LOJA_SLUG` | o "endereço curto" da loja no portal (ex.: `shop-luana-araujo`) |
| `PORTAL_CHAVE` | a chave gerada em Portal → Configurar o site (aparece uma vez só) |
| `NEXT_PUBLIC_SITE_URL` | `https://shopluanaaraujo.com.br` |
| `FOTOS_URL` | o mesmo `NEXT_PUBLIC_SUPABASE_URL` do portal (de onde o site busca as fotos para entregar em `/fotos`) |

O portal mostra as três primeiras já prontas para copiar quando a chave é
gerada. Gerar uma chave nova desliga a anterior na hora: troque a variável na
Vercel e publique de novo (Deployments → Redeploy).

## Colocar no ar e trocar a FácilZap

1. **Portal:** Loja → Site da loja → **Configurar o site**: preencha, ligue o
   site e gere a chave.
2. **Portal:** **Importar da FácilZap**: informe `https://shopluanaaraujo.com.br`,
   confira o NCM de cada categoria e importe. Pode rodar de novo até o dia da
   troca: não duplica e atualiza preço, estoque e textos.
3. **Vercel:** Add New → Project → este repositório → **Root Directory**
   `lojas/shop-luana-araujo` (o Next.js é reconhecido sozinho) → preencha as
   variáveis acima → Deploy. Teste no endereço `.vercel.app` que a Vercel
   mostrar: navegue, faça um pedido de teste e confira se ele chega no portal.
   Depois cancele esse pedido no portal.
4. **Domínio:** no projeto da Vercel, Settings → Domains → adicione
   `shopluanaaraujo.com.br` e `www.shopluanaaraujo.com.br`. No **Registro.br**
   (ou onde estiver o DNS do domínio), troque as entradas que hoje apontam para a
   FácilZap pelas que a Vercel mostrar. Normalmente são estas, as mesmas do site
   do escritório:
   - tipo **A**, nome em branco → `76.76.21.21`
   - tipo **CNAME**, nome `www` → `cname.vercel-dns.com`

   Entradas de e-mail (MX e TXT), se existirem, ficam como estão. A troca leva de
   minutos a algumas horas. O certificado (https) é emitido pela Vercel.
5. **Só depois** que o domínio abrir o site novo: tire o domínio da FácilZap e
   cancele o plano por lá. O histórico de pedidos da FácilZap não vem para o
   portal; exporte o que quiser guardar antes de cancelar.

> Plano da Vercel: o plano gratuito (Hobby) é para uso pessoal e não comercial.
> Para uma loja, use um plano pago (Pro) na equipe do escritório. Confira o plano
> atual antes de publicar.

## Testar

Nesta pasta:

```
npm install
npm test            # regras do catálogo, mensagem do WhatsApp e validação do pedido
npm run lint
npm run typecheck
```

Para ver o site sem o portal, com dados de exemplo (nada é enviado), aponte
`VITRINE_DEMO` para um arquivo JSON no formato da rota `/api/vitrine` com um
campo `detalhes` (produto por id). O site mostra uma faixa "Demonstração" e não
deixa o Google indexar:

```
VITRINE_DEMO=/caminho/demo.json VITRINE_DEMO_FOTOS=http://localhost:3200 npm run dev
```

Com o portal rodando no computador (`npm run dev` na pasta `portal`, porta 3000):

```
PORTAL_URL=http://localhost:3000 LOJA_SLUG=... PORTAL_CHAVE=... FOTOS_URL=http://127.0.0.1:54321 npm run dev
```

O site abre em http://localhost:3100.
