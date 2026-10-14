import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoleto, bankDV, factorFromDate, dueDateFromFactor, mod10, bankBarcodeToLine } from '../../js/core/boleto.js';
import { parseQuickEntry } from '../../js/core/quickEntry.js';
import { parseStatementText, parseOFX, parseCSV, totalsOf, itemsToLines, importKey } from '../../js/core/statement.js';

const TODAY = '2026-10-14';

// Monta um código de barras bancário válido (Itaú, vence 20/10/2026, R$ 180,00).
function makeBankBarcode({ bank = '341', due = '2026-10-20', cents = 18000, free = '1234567890123456789012345' }) {
  const factor = String(factorFromDate(due)).padStart(4, '0');
  const value = String(cents).padStart(10, '0');
  const noDV = `${bank}9${factor}${value}${free}`;
  return `${noDV.slice(0, 4)}${bankDV(noDV)}${noDV.slice(4)}`;
}

test('boleto bancário: código de barras traz valor e vencimento', () => {
  const barcode = makeBankBarcode({});
  assert.equal(barcode.length, 44);
  const b = parseBoleto(barcode, TODAY);
  assert.equal(b.kind, 'bank');
  assert.equal(b.valid, true);
  assert.equal(b.amount, 18000);
  assert.equal(b.dueDate, '2026-10-20');
  assert.equal(b.bank, 'Itaú');
  assert.equal(b.suggestion.description, 'Boleto Itaú');
});

test('boleto bancário: linha digitável (47) vira o mesmo código', () => {
  const barcode = makeBankBarcode({ cents: 123456, due: '2026-11-05' });
  const line = bankBarcodeToLine(barcode);
  const b = parseBoleto(line, TODAY);
  assert.equal(b.barcode, barcode);
  assert.equal(b.amount, 123456);
  assert.equal(b.dueDate, '2026-11-05');
  assert.equal(b.valid, true);
});

test('boleto: código com erro de leitura é marcado como inválido', () => {
  const barcode = makeBankBarcode({});
  const broken = barcode.slice(0, 20) + ((Number(barcode[20]) + 1) % 10) + barcode.slice(21);
  assert.equal(parseBoleto(broken, TODAY).valid, false);
  assert.equal(parseBoleto('123', TODAY), null);
});

test('boleto: fator de vencimento antes e depois do reinício de 2025', () => {
  assert.equal(dueDateFromFactor(9999, '2025-02-01'), '2025-02-21');
  assert.equal(dueDateFromFactor(1000, TODAY), '2025-02-22');
  assert.equal(dueDateFromFactor(0, TODAY), null);
});

test('boleto de concessionária (luz) com linha de 48 dígitos', () => {
  const body = '83660000001' + '80000123456' + '78901234567' + '89012345678'; // 44 dígitos com DV na 4ª posição
  const noDV = body.slice(0, 3) + body.slice(4);
  const barcode = body.slice(0, 3) + mod10(noDV) + body.slice(4);
  const line = [0, 11, 22, 33].map((i) => barcode.slice(i, i + 11) + mod10(barcode.slice(i, i + 11))).join('');
  const b = parseBoleto(line, TODAY);
  assert.equal(b.kind, 'utility');
  assert.equal(b.valid, true);
  assert.equal(b.amount, 18000); // R$ 180,00
  assert.equal(b.suggestion.description, 'Conta de luz/gás');
  assert.equal(b.suggestion.category, 'moradia');
});

test('frase falada vira lançamento', () => {
  const a = parseQuickEntry('gastei 45 reais de gasolina ontem', TODAY);
  assert.deepEqual({ ...a }, { type: 'expense', amount: 4500, date: '2026-10-13', description: 'Gasolina', category: 'combustivel' });
  const b = parseQuickEntry('Recebi R$ 1.500 do cliente Silva', TODAY);
  assert.equal(b.type, 'income');
  assert.equal(b.amount, 150000);
  assert.equal(b.description, 'Cliente silva');
  const c = parseQuickEntry('paguei 32,90 no almoço', TODAY);
  assert.equal(c.amount, 3290);
  assert.equal(c.description, 'Almoço');
  assert.equal(c.category, 'alimentacao');
  assert.equal(parseQuickEntry('comprei remédio na farmácia por 2 mil', TODAY).amount, 200000);
  assert.equal(parseQuickEntry('mercado 120 reais e 50 centavos dia 3', TODAY).amount, 12050);
  assert.equal(parseQuickEntry('mercado 120 reais dia 3', TODAY).date, '2026-10-03');
  assert.equal(parseQuickEntry('', TODAY), null);
});

const ITAU = `EXTRATO CONTA CORRENTE  período 01/10/2026 a 14/10/2026
01/10  SALDO ANTERIOR   1.000,00
02/10  PIX TRANSF JOAO 02/10   -150,00   850,00
03/10  COMPRA CARTAO DEB PADARIA   45,90   804,10
05/10  SALARIO EMPRESA X   5.000,00   5.804,10
06/10  TAR PACOTE SERVICOS   29,90 D  5.774,20
07/10  PAGTO BOLETO LUZ   180,00-   5.594,20
       SALDO DO DIA   5.594,20`;

test('extrato bancário: sinais explícitos e deduzidos pelo saldo', () => {
  const r = parseStatementText(ITAU, { today: TODAY });
  assert.equal(r.mode, 'bank');
  assert.deepEqual(r.rows.map((x) => [x.date, x.type, x.amount]), [
    ['2026-10-02', 'expense', 15000],
    ['2026-10-03', 'expense', 4590],
    ['2026-10-05', 'income', 500000],
    ['2026-10-06', 'expense', 2990],
    ['2026-10-07', 'expense', 18000],
  ]);
  assert.equal(r.rows[2].category, 'salario');
  assert.deepEqual(r.period, { from: '2026-10-02', to: '2026-10-07' });
  const t = totalsOf(r.rows);
  assert.equal(t.income, 500000);
  assert.equal(t.expense, 15000 + 4590 + 2990 + 18000);
});

const NUBANK_CONTA = `Extrato de conta
14 OUT 2026  Total de entradas  + 1.000,00
Transferência recebida pelo Pix  MARIA SOUZA  1.000,00
Total de saídas  - 70,40
Compra no débito  Padaria Pão Quente  20,40
Transferência enviada pelo Pix  JOSE  50,00`;

test('extrato com data em cabeçalho e palavras-chave', () => {
  const r = parseStatementText(NUBANK_CONTA, { today: TODAY });
  assert.deepEqual(r.rows.map((x) => [x.date, x.type, x.amount]), [
    ['2026-10-14', 'income', 100000],
    ['2026-10-14', 'expense', 2040],
    ['2026-10-14', 'expense', 5000],
  ]);
});

const FATURA = `Fatura de outubro 2026
Vencimento 20 OUT 2026
Limite disponível R$ 2.000,00
14 SET  Padaria Pao Quente  45,90
15 SET  Posto Shell  R$ 200,00
16 SET  Uber *Trip  23,45
20 SET  Pagamento recebido  -1.500,00
21 SET  Estorno Loja X  -50,00
22 SET  Netflix.com  55,90
Total da fatura  R$ 275,25`;

test('fatura de cartão: compras são despesas e o pagamento da fatura não conta', () => {
  const r = parseStatementText(FATURA, { today: TODAY });
  assert.equal(r.mode, 'card');
  assert.deepEqual(r.rows.map((x) => [x.description, x.type]), [
    ['Padaria Pao Quente', 'expense'],
    ['Posto Shell', 'expense'],
    ['Uber *Trip', 'expense'],
    ['Pagamento recebido', 'transfer'],
    ['Estorno Loja X', 'income'],
    ['Netflix.com', 'expense'],
  ]);
  assert.equal(r.rows[1].category, 'combustivel');
  assert.equal(totalsOf(r.rows).expense, 4590 + 20000 + 2345 + 5590);
});

test('OFX e CSV', () => {
  const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-45.90<FITID>abc1<MEMO>PADARIA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>5000.00<FITID>abc2<NAME>SALARIO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const o = parseOFX(ofx, { today: TODAY });
  assert.deepEqual(o.rows.map((x) => [x.date, x.type, x.amount, x.externalId]), [
    ['2026-10-03', 'expense', 4590, 'abc1'],
    ['2026-10-05', 'income', 500000, 'abc2'],
  ]);

  const nubankCard = 'date,title,amount\n2026-09-14,Padaria,45.90\n2026-09-20,Pagamento recebido,-1500.00\n';
  const c = parseCSV(nubankCard, { today: TODAY });
  assert.equal(c.mode, 'card');
  assert.deepEqual(c.rows.map((x) => [x.type, x.amount]), [['expense', 4590], ['transfer', 150000]]);

  const conta = 'Data;Descrição;Valor\n03/10/2026;Compra mercado;-120,50\n05/10/2026;Pix recebido;300,00\n';
  const d = parseCSV(conta, { today: TODAY });
  assert.deepEqual(d.rows.map((x) => [x.date, x.type, x.amount]), [['2026-10-03', 'expense', 12050], ['2026-10-05', 'income', 30000]]);
});

test('texto de PDF: trechos viram linhas e a chave evita importação repetida', () => {
  const text = itemsToLines([
    { str: '45,90', x: 400, y: 700 },
    { str: '14/10', x: 40, y: 700.5 },
    { str: 'PADARIA', x: 100, y: 699.8 },
    { str: 'Linha de baixo', x: 40, y: 680 },
  ]);
  assert.equal(text, '14/10  PADARIA  45,90\nLinha de baixo');
  const row = { date: TODAY, amount: 4590, description: 'Padaria' };
  assert.equal(importKey(row, 'extrato.pdf'), importKey({ ...row }, 'extrato.pdf'));
  assert.notEqual(importKey(row, 'a'), importKey({ ...row, amount: 4591 }, 'a'));
});
