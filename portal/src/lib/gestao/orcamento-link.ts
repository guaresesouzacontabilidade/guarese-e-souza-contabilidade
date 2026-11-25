/**
 * Orçamento enviado ao cliente pelo WhatsApp: a loja toca no botão, o WhatsApp
 * do próprio aparelho (tablet ou celular) abre com a mensagem pronta e o link
 * do orçamento. Nada é enviado pelo portal: quem envia é a pessoa, no WhatsApp.
 */
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

/** Endereço do orçamento para o cliente (sem login). */
export function linkPublicoOrcamento(siteUrl: string, codigo: string): string {
  return `${siteUrl.replace(/\/$/, "")}/orcamento/${codigo}`;
}

/** Telefone em dígitos com DDD (10 ou 11), sem o 55. */
export function telefoneComDdd(telefone: string | null | undefined): string | null {
  let d = (telefone ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return /^[1-9][0-9]{9,10}$/.test(d) ? d : null;
}

export function mensagemOrcamento(v: {
  cliente: string | null | undefined;
  numero: number | string;
  loja: string;
  total: string | number;
  validade: string | null | undefined;
  link: string;
}): string {
  const nome = (v.cliente ?? "").trim().split(/\s+/)[0];
  const linhas = [
    `${nome ? `Olá, ${nome}!` : "Olá!"} Segue o orçamento nº ${v.numero} da ${v.loja.trim()}.`,
    `Total: ${formatarMoeda(v.total)}${v.validade ? ` (válido até ${formatarData(v.validade)})` : ""}.`,
    `Veja os itens e os valores: ${v.link}`,
  ];
  return linhas.join("\n");
}

/**
 * Link do WhatsApp com a mensagem. Com telefone, abre a conversa com o cliente;
 * sem telefone, o WhatsApp pede para escolher o contato.
 */
export function linkWhatsAppOrcamento(telefone: string | null | undefined, texto: string): string {
  const d = telefoneComDdd(telefone);
  return d ? `https://wa.me/55${d}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
}
