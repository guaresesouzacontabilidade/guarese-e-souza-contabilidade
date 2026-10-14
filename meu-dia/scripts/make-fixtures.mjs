// Gera PDFs de exemplo (dados fictícios) usados apenas nos testes de importação.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');

const table = (rows) =>
  `<table style="width:100%;border-collapse:collapse;font:12px Arial">${rows
    .map((r) => `<tr>${r.map((c, i) => `<td style="padding:4px 6px;${i >= 2 ? 'text-align:right' : ''}">${c}</td>`).join('')}</tr>`)
    .join('')}</table>`;

const extrato = `<h2 style="font:16px Arial">BANCO EXEMPLO S.A. — EXTRATO DE CONTA CORRENTE</h2>
<p style="font:12px Arial">Período: 01/10/2026 a 14/10/2026 · Agência 0001 Conta 12345-6 (DADOS FICTÍCIOS PARA TESTE)</p>
${table([
  ['Data', 'Lançamento', 'Valor (R$)', 'Saldo (R$)'],
  ['01/10', 'SALDO ANTERIOR', '', '1.000,00'],
  ['02/10', 'PIX ENVIADO JOAO', '-150,00', '850,00'],
  ['03/10', 'COMPRA DEBITO SUPERMERCADO BOM PRECO', '-245,90', '604,10'],
  ['05/10', 'SALARIO EMPRESA EXEMPLO', '5.000,00', '5.604,10'],
  ['06/10', 'TARIFA PACOTE SERVICOS', '-29,90', '5.574,20'],
  ['08/10', 'PAGAMENTO BOLETO ENERGIA', '-180,00', '5.394,20'],
  ['10/10', 'PIX RECEBIDO MARIA', '300,00', '5.694,20'],
])}`;

const fatura = `<h2 style="font:16px Arial">CARTÃO EXEMPLO — FATURA DE OUTUBRO 2026</h2>
<p style="font:12px Arial">Vencimento 20/10/2026 · Limite disponível R$ 2.000,00 (DADOS FICTÍCIOS PARA TESTE)</p>
${table([
  ['Data', 'Descrição', 'Valor'],
  ['14 SET', 'PADARIA PAO QUENTE', '45,90'],
  ['15 SET', 'POSTO SHELL', '200,00'],
  ['16 SET', 'UBER *TRIP', '23,45'],
  ['20 SET', 'PAGAMENTO RECEBIDO', '-1.500,00'],
  ['22 SET', 'NETFLIX.COM', '55,90'],
  ['', 'Total da fatura', 'R$ 325,25'],
])}`;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, body] of [['extrato-exemplo.pdf', extrato], ['fatura-exemplo.pdf', fatura]]) {
  await page.setContent(`<html><body style="margin:24px">${body}</body></html>`);
  await page.pdf({ path: path.join(dir, name), format: 'A4' });
}
await browser.close();
console.log('PDFs de exemplo gerados em tests/fixtures/');
