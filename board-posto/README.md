# Board Posto Catarinense

Painel do posto de combustível: preços do totem, faturamento, litros, ticket médio, margem por combustível,
formas de pagamento, estoque dos tanques, movimento por hora e mais vendidos da loja e pista.

> Esta pasta é independente do site da contabilidade e do Meu Dia: nada fora de `board-posto/` foi alterado.

## De onde vêm os números

Enquanto nada é importado, o Board mostra **dados de exemplo** (60 dias gerados com semente fixa) e avisa isso no topo.
Em **Importar dados** dá para mandar:

| Arquivo | O que o Board faz |
| --- | --- |
| **XML de NFC-e / NF-e** (soltos ou em `.zip`) | Vendas do posto (quem emite as NFC-e); compras de combustível da distribuidora viram o custo médio por litro (últimos 60 dias); eventos de cancelamento retiram a venda; notas repetidas, de homologação ou não autorizadas são puladas. |
| **CSV exportado do Meta Posto** | Sugere qual coluna é data, hora, produto, quantidade, valor, forma de pagamento e número da venda; você confere antes de importar. Linhas de total são puladas. |

Os dados importados, os custos e os estoques digitados ficam só no navegador (localStorage).

## Ligação com o Meta Posto

1. **Agora:** importar XML ou planilha.
2. **Aguardando:** perguntar ao Meta Posto se há API ou usuário só de leitura no banco de dados.
3. **Depois:** atualização automática a cada poucos minutos.

## Arquivo

`index.html` é uma página única, sem compilação, no formato de Artifact do Claude (sem `<!doctype>`/`<head>`:
a moldura é colocada na publicação). Usa as fontes Barlow, Barlow Condensed e Share Tech Mono (Google Fonts) e o
JSZip 3.10.1 (cdnjs) para abrir `.zip`.
