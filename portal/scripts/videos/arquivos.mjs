/**
 * Arquivos FICTÍCIOS usados nos vídeos de apresentação: um recibo em PDF, a
 * foto de um cupom (para o envio pelo celular), um comprovante de pagamento e
 * uma declaração "assinada". Todos trazem a marca de demonstração no próprio
 * conteúdo e nomes de empresas e pessoas inventados.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const AVISO = "DOCUMENTO FICTÍCIO — DEMONSTRAÇÃO DO PORTAL, SEM VALOR";

const base = (corpo, extra = "") => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#1f2937}
  .aviso{background:#fef3c7;color:#92400e;border:1px solid #f59e0b;padding:8px 12px;font-weight:700;font-size:12px;text-align:center;letter-spacing:.04em}
  ${extra}</style></head><body>${corpo}</body></html>`;

function htmlRecibo() {
  return base(
    `<div style="padding:48px 56px">
      <div class="aviso">${AVISO}</div>
      <h1 style="font-size:26px;margin:28px 0 4px">RECIBO DE ALUGUEL</h1>
      <p style="margin:0;color:#6b7280">Referente a setembro de 2026</p>
      <div style="margin:28px 0;padding:20px;border:1px solid #d1d5db;border-radius:10px;font-size:15px;line-height:1.7">
        Recebi de <b>PADARIA PÃO DOURADO LTDA (DEMONSTRAÇÃO)</b>, CNPJ 11.222.333/0001-81, a importância de
        <b>R$ 3.200,00</b> (três mil e duzentos reais), referente ao aluguel do imóvel comercial situado na
        Rua das Flores, 100 — Centro (endereço fictício), com vencimento em 10/09/2026.
      </div>
      <p style="font-size:15px">Porto Nacional (TO), 10 de setembro de 2026.</p>
      <div style="margin-top:70px;width:320px;border-top:1px solid #111;padding-top:6px;font-size:14px">
        IMOBILIÁRIA EXEMPLO LTDA (FICTÍCIA)<br><span style="color:#6b7280">Locadora</span>
      </div>
    </div>`,
  );
}

const LINHAS_DAS = [
  ["Documento", "DAS — Simples Nacional"],
  ["Competência", "09/2026"],
  ["Contribuinte", "PADARIA PÃO DOURADO LTDA (DEMONSTRAÇÃO)"],
  ["CNPJ", "11.222.333/0001-81"],
  ["Valor pago", "R$ 1.967,15"],
  ["Data do pagamento", "18/10/2026"],
  ["Autenticação", "DEMO.0000.1111.2222.3333"],
];
const LINHAS_PIX = [
  ["Tipo", "PIX enviado"],
  ["Pagador", "PADARIA PÃO DOURADO LTDA (DEMONSTRAÇÃO)"],
  ["Recebedor", "LATICÍNIOS SERRA AZUL LTDA (FICTÍCIO)"],
  ["Valor", "R$ 1.089,90"],
  ["Data", "22/09/2026 10:15"],
  ["Identificador", "E00000000202609221015DEMO0001"],
];

function htmlComprovante(subtitulo = "Banco Exemplo S.A. (fictício) — pagamento de tributos", linhas = LINHAS_DAS) {
  return base(
    `<div style="padding:44px 56px">
      <div class="aviso">${AVISO}</div>
      <h1 style="font-size:22px;margin:26px 0 2px">Comprovante de pagamento</h1>
      <p style="margin:0 0 22px;color:#6b7280">${subtitulo}</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${linhas
          .map(([a, b]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:42%">${a}</td><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;font-weight:600">${b}</td></tr>`)
          .join("")}
      </table>
    </div>`,
  );
}

function htmlDeclaracaoAssinada() {
  return base(
    `<div style="padding:48px 56px">
      <div class="aviso">${AVISO}</div>
      <h1 style="font-size:22px;margin:26px 0 12px">Declaração de faturamento — via assinada</h1>
      <p style="font-size:15px;line-height:1.7">Via assinada da declaração de faturamento dos últimos 12 meses da
      PADARIA PÃO DOURADO LTDA (DEMONSTRAÇÃO), devolvida ao escritório pelo portal.</p>
      <div style="margin-top:80px;width:340px;border-top:1px solid #111;padding-top:6px;font-size:14px">
        MARIA EXEMPLO (FICTÍCIA)<br><span style="color:#6b7280">Sócia administradora</span>
      </div>
    </div>`,
  );
}

function htmlFotoCupom() {
  const itens = [
    ["Farinha de trigo 25 kg", "2", "289,80"],
    ["Fermento biológico 500 g", "6", "71,40"],
    ["Açúcar refinado 5 kg", "4", "98,00"],
    ["Margarina 15 kg", "1", "212,50"],
  ];
  return base(
    `<div class="mesa"><div class="cupom">
      <div style="text-align:center;font-weight:700">ATACADO EXEMPLO LTDA</div>
      <div style="text-align:center;font-size:13px">CNPJ 00.000.000/0001-00 (FICTÍCIO)</div>
      <div style="text-align:center;font-size:13px;margin-bottom:10px">Porto Nacional - TO</div>
      <div class="linha"></div>
      <div style="text-align:center;font-weight:700;margin:6px 0">CUPOM — DEMONSTRAÇÃO</div>
      <div class="linha"></div>
      ${itens.map(([d, q, v]) => `<div style="display:flex;justify-content:space-between;margin:7px 0"><span>${d} x${q}</span><span>${v}</span></div>`).join("")}
      <div class="linha"></div>
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:20px;margin:8px 0"><span>TOTAL R$</span><span>671,70</span></div>
      <div style="font-size:13px">Pago no cartão de débito</div>
      <div style="font-size:13px">18/10/2026 07:42</div>
      <div class="linha"></div>
      <div style="text-align:center;font-size:12px;font-weight:700">${AVISO}</div>
    </div></div>`,
    `.mesa{width:900px;height:1200px;display:flex;align-items:center;justify-content:center;
       background:radial-gradient(circle at 30% 20%,#a47551,#6b4426 70%);}
     .cupom{width:520px;padding:34px 30px;background:#fdfcf7;font-family:"Courier New",monospace;font-size:17px;color:#222;
       box-shadow:0 30px 60px rgba(0,0,0,.45);transform:rotate(-3deg)}
     .linha{border-top:2px dashed #999;margin:8px 0}`,
  );
}

/** Gera os arquivos na pasta e devolve o caminho de cada um. */
export async function gerarArquivos(browser, pasta) {
  await mkdir(pasta, { recursive: true });
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const caminhos = {
    recibo: join(pasta, "Recibo de aluguel - setembro 2026 (DEMO).pdf"),
    comprovante: join(pasta, "Comprovante DAS 09-2026 (DEMO).pdf"),
    comprovantePix: join(pasta, "Comprovante PIX Laticinios Serra Azul (DEMO).pdf"),
    declaracaoAssinada: join(pasta, "Declaracao de faturamento assinada (DEMO).pdf"),
    fotoCupom: join(pasta, "Foto do cupom de compra (DEMO).jpg"),
  };
  for (const [chave, html] of [
    ["recibo", htmlRecibo()],
    ["comprovante", htmlComprovante()],
    ["comprovantePix", htmlComprovante("Banco Exemplo S.A. (fictício) — transferência PIX", LINHAS_PIX)],
    ["declaracaoAssinada", htmlDeclaracaoAssinada()],
  ]) {
    await p.setContent(html);
    await writeFile(caminhos[chave], await p.pdf({ format: "A4", printBackground: true }));
  }
  await p.setViewportSize({ width: 900, height: 1200 });
  await p.setContent(htmlFotoCupom());
  await p.screenshot({ path: caminhos.fotoCupom, type: "jpeg", quality: 88 });
  await ctx.close();
  return caminhos;
}
