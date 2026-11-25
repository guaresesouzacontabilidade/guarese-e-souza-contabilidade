import { BORDAO_SISTEMA, NOME_SISTEMA } from "@/lib/marca/sistema";

/** Modelo de e-mail com a identidade do sistema e os dados do escritório (ou a do cliente que envia; HTML com estilos inline). */

function esc(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DadosModeloEmail {
  titulo: string;
  paragrafos: string[];
  botao?: { texto: string; url: string };
  aviso?: string;
  /**
   * E-mail que um cliente do escritório manda aos clientes dele (ex.: lembrete
   * da clínica ao tutor): cabeçalho e rodapé com o nome e os contatos dele, sem
   * a marca do escritório.
   */
  remetente?: { nome: string; contatos: string[] };
  /** Dados do escritório para o rodapé (vêm de Configurações do escritório). */
  escritorio?: { nome: string; razao: string; cnpj: string; endereco: string };
  /** Quadro em destaque (ex.: Pix da cobrança): título, linhas, imagem anexada (cid) e código para copiar. */
  destaque?: { titulo: string; linhas: string[]; imagemCid?: string; codigo?: string };
}

export function modeloEmail({ titulo, paragrafos, botao, aviso, remetente, escritorio, destaque }: DadosModeloEmail) {
  const corpo = paragrafos
    .map((p) => `<p style="margin:0 0 12px;line-height:1.6;white-space:pre-line;">${esc(p)}</p>`)
    .join("");
  const quadro = destaque
    ? `<div style="margin:18px 0;padding:16px;border:1px solid #e7e2dc;border-radius:10px;background:#faf8f5;">
<p style="margin:0 0 8px;font-weight:bold;color:#07461f;">${esc(destaque.titulo)}</p>
${destaque.imagemCid ? `<p style="margin:0 0 10px;"><img src="cid:${esc(destaque.imagemCid)}" width="200" height="200" alt="QR code do Pix" style="display:block;border:0;"></p>` : ""}
${destaque.linhas.map((l) => `<p style="margin:0 0 6px;line-height:1.5;">${esc(l)}</p>`).join("")}
${destaque.codigo ? `<p style="margin:8px 0 0;font-size:12px;color:#6b625b;">Pix copia e cola:</p><p style="margin:4px 0 0;font-family:Consolas,Menlo,monospace;font-size:12px;word-break:break-all;background:#ffffff;border:1px dashed #cfc8c1;border-radius:6px;padding:8px;">${esc(destaque.codigo)}</p>` : ""}
</div>`
    : "";
  const btn = botao
    ? `<p style="margin:24px 0;"><a href="${esc(botao.url)}" style="display:inline-block;background:#07461f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;">${esc(botao.texto)}</a></p>
       <p style="font-size:12px;color:#6b625b;line-height:1.5;">Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all;">${esc(botao.url)}</span></p>`
    : "";
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f5f3f0;font-family:Arial,Helvetica,sans-serif;color:#1f1a17;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3f0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e2dc;border-radius:12px;">
<tr><td style="padding:22px 28px;border-bottom:1px solid #efe6da;">
${
  remetente
    ? `<div style="font-size:19px;font-weight:bold;color:#07461f;">${esc(remetente.nome)}</div>`
    : `<div style="font-size:19px;font-weight:bold;color:#07461f;">${esc(NOME_SISTEMA)}</div>
<div style="font-size:12px;color:#8e1018;">${esc(BORDAO_SISTEMA)}</div>`
}</td></tr>
<tr><td style="padding:26px 28px;"><h1 style="margin:0 0 14px;font-size:18px;color:#07461f;">${esc(titulo)}</h1>${corpo}${quadro}${btn}
${aviso ? `<p style="font-size:12px;color:#6b625b;line-height:1.5;">${esc(aviso)}</p>` : ""}</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #efe6da;font-size:11px;color:#8a8079;line-height:1.5;">
${
  remetente
    ? `${esc(remetente.nome)}${remetente.contatos.length ? ` — ${esc(remetente.contatos.join(" · "))}` : ""}<br>
Mensagem automática. Não responda a este e-mail; fale com ${esc(remetente.nome)} pelos contatos acima.`
    : `${escritorio ? `${esc([escritorio.nome, escritorio.razao, escritorio.cnpj ? `CNPJ ${escritorio.cnpj}` : ""].filter(Boolean).join(" — "))}<br>${escritorio.endereco ? `${esc(escritorio.endereco)}<br>` : ""}` : ""}
Esta é uma mensagem automática do ${esc(NOME_SISTEMA)}. Não responda a este e-mail; use a central de mensagens.`
}</td></tr>
</table></td></tr></table></body></html>`;
  const texto = [
    titulo,
    "",
    ...paragrafos,
    destaque ? `\n${destaque.titulo}\n${destaque.linhas.join("\n")}${destaque.codigo ? `\nPix copia e cola: ${destaque.codigo}` : ""}` : "",
    botao ? `\n${botao.texto}: ${botao.url}` : "",
    aviso ? `\n${aviso}` : "",
    remetente ? `\n${[remetente.nome, ...remetente.contatos].join(" · ")}` : "",
  ].join("\n");
  return { html, texto };
}
