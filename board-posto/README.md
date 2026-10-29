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

## Posto 3D

O botão **Posto 3D** (ou o endereço com `#posto-3d`) abre o posto em 3D, com as mesmas vendas do Board:

- Cada venda de combustível vira um carro, picape ou caminhão que chega, abastece e sai no horário da nota.
  O mostrador da bomba corre os litros e o valor, e o frentista vai até o carro.
- Clientes da loja aparecem dentro da conveniência; o caminhão-tanque aparece quando há nota de compra no dia.
- Os tanques ficam visíveis sob um piso transparente, com o nível estimado (estoque digitado no Board,
  menos as vendas, mais as entregas).
- Dá para tocar em bombas, carros, clientes, tanques, loja, troca de óleo, totem e coberturas para abrir os detalhes.
- **Ao vivo:** toca as vendas do último dia com dados no horário de agora. Também dá para pausar, acelerar
  (10×, 60×, 300×), arrastar a linha do tempo e trocar de dia. Céu e luzes seguem a hora do dia.

Sem bico na nota (o grupo `encerrante` da NFC-e traz `nBico`), o 3D escolhe um bico livre do mesmo combustível.
O layout das bombas, bicos e tanques é um padrão (4 bombas, 16 bicos, 5 tanques) em `LAYOUT`, no `dados.js`,
até ser trocado pelo layout real do posto.

## Ligação com o Meta Posto

1. **Agora:** importar XML ou planilha.
2. **Aguardando:** perguntar ao Meta Posto se há API ou usuário só de leitura no banco de dados.
3. **Depois:** atualização automática a cada poucos minutos.

## Arquivos

| Arquivo | O que tem |
| --- | --- |
| `index.html` | O Board e a importação. Formato de Artifact do Claude (sem `<!doctype>`/`<head>`: a moldura é colocada na publicação). |
| `dados.js` | Dados compartilhados: cadastros, layout do posto, dados de exemplo, leitura de números e datas, cálculos. |
| `posto3d.js` | O posto em 3D. Carrega o Three.js 0.147.0 (jsDelivr) só quando o 3D é aberto. |

Sem compilação. Usa as fontes Barlow, Barlow Condensed e Share Tech Mono (Google Fonts) e o JSZip 3.10.1 (cdnjs)
para abrir `.zip`.
