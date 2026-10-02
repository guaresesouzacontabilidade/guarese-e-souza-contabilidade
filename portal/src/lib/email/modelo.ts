/** Modelo de e-mail com a identidade do escritório (HTML com estilos inline). */

function esc(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DadosModeloEmail {
  titulo: string;
  paragrafos: string[];
  botao?: { texto: string; url: string };
  aviso?: string;
}

export function modeloEmail({ titulo, paragrafos, botao, aviso }: DadosModeloEmail) {
  const corpo = paragrafos
    .map((p) => `<p style="margin:0 0 12px;line-height:1.6;white-space:pre-line;">${esc(p)}</p>`)
    .join("");
  const btn = botao
    ? `<p style="margin:24px 0;"><a href="${esc(botao.url)}" style="display:inline-block;background:#4a2c1d;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">${esc(botao.texto)}</a></p>
       <p style="font-size:12px;color:#6b625b;line-height:1.5;">Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all;">${esc(botao.url)}</span></p>`
    : "";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f5f3f0;font-family:Arial,Helvetica,sans-serif;color:#1f1a17;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3f0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e2dc;border-radius:12px;">
<tr><td style="padding:22px 28px;border-bottom:1px solid #efe6da;">
<div style="font-size:19px;font-weight:bold;color:#4a2c1d;">Portal Guarese&rsquo;s ON</div>
<div style="font-size:12px;color:#6b625b;">Documentos, contabilidade e gestão financeira em um só lugar.</div></td></tr>
<tr><td style="padding:26px 28px;"><h1 style="margin:0 0 14px;font-size:18px;color:#4a2c1d;">${esc(titulo)}</h1>${corpo}${btn}
${aviso ? `<p style="font-size:12px;color:#6b625b;line-height:1.5;">${esc(aviso)}</p>` : ""}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #efe6da;font-size:11px;color:#8a8079;line-height:1.5;">
GUARESE&rsquo;S ON CONTABILIDADE — GUARESE&rsquo;S ON SOLUCOES EMPRESARIAIS LTDA — CNPJ 62.935.399/0001-50<br>
Praça do Centenário, nº 713, Centro, Porto Nacional – TO — CEP 77.500-000<br>
Esta é uma mensagem automática do portal. Não responda a este e-mail; use a central de mensagens.</td></tr>
</table></td></tr></table></body></html>`;
  const texto = [titulo, "", ...paragrafos, botao ? `\n${botao.texto}: ${botao.url}` : "", aviso ? `\n${aviso}` : ""].join("\n");
  return { html, texto };
}
