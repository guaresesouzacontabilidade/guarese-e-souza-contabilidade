/**
 * Baixar arquivos do portal no celular sem sair da tela: o arquivo é buscado
 * pela própria página (com a sessão da aba) e entregue ao aparelho — no
 * Android vai para Downloads; no iPhone abre a folha de compartilhar ("Salvar
 * em Arquivos", WhatsApp...). Abrir o PDF numa aba nova ou na mesma aba deixa
 * o celular numa tela sem "voltar" (principalmente com o portal instalado como
 * aplicativo), e o Android nem mostra o PDF.
 */

/** Aparelho de toque sem mouse (celular ou tablet). */
export function aparelhoDeToque(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/** iPhone ou iPad (o iPad recente se apresenta como Mac com toque). */
export function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** O aparelho consegue compartilhar este arquivo (folha de compartilhar do sistema). */
export function podeCompartilhar(arquivo: File): boolean {
  return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && typeof navigator.share === "function" && navigator.canShare({ files: [arquivo] });
}

/** Link (clique sem teclas extras) para um arquivo do portal (/api/...), na mesma aba ou em aba nova. */
export function linkDeArquivoDoPortal(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return null;
  try {
    const url = new URL(a.href, location.href);
    return url.origin === location.origin && url.pathname.startsWith("/api/") ? a : null;
  } catch {
    return null;
  }
}

/**
 * Nome do arquivo: o do cabeçalho Content-Disposition, o pedido pelo link
 * (atributo download), o do endereço assinado do armazenamento (?download=) ou
 * o fim do caminho.
 */
export function nomeDoArquivo(disposicao: string | null, urlFinal: string, sugerido?: string | null): string {
  const limpar = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 180);
  if (disposicao) {
    const estrela = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposicao);
    if (estrela) {
      try {
        const n = limpar(decodeURIComponent(estrela[1].trim().replace(/^"|"$/g, "")));
        if (n) return n;
      } catch {
        /* nome mal formado: tenta o próximo */
      }
    }
    const simples = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(disposicao);
    const n = limpar((simples?.[1] ?? simples?.[2] ?? "").trim());
    if (n) return n;
  }
  if (sugerido && limpar(sugerido)) return limpar(sugerido);
  try {
    const u = new URL(urlFinal);
    const pedido = u.searchParams.get("download");
    if (pedido && limpar(pedido)) return limpar(pedido);
    const fim = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    if (fim && /\.[a-z0-9]{2,5}$/i.test(fim)) return limpar(fim);
  } catch {
    /* sem nome no endereço */
  }
  return "arquivo";
}

/** Busca o arquivo do link (com a sessão da aba) e devolve pronto para salvar ou compartilhar. */
export async function prepararArquivo(url: string, sugerido?: string | null): Promise<File> {
  let r: Response;
  try {
    r = await fetch(url, { credentials: "same-origin", redirect: "follow" });
  } catch {
    throw new Error("Sem conexão para baixar o arquivo. Confira a internet e tente de novo.");
  }
  if (r.redirected && new URL(r.url).pathname.startsWith("/login")) {
    throw new Error("Sua sessão terminou. Entre de novo no portal para baixar o arquivo.");
  }
  if (!r.ok) {
    let msg = "";
    try {
      const tipo = r.headers.get("content-type") ?? "";
      if (tipo.includes("json")) {
        const j = (await r.json()) as { erro?: string; mensagem?: string };
        msg = j.erro ?? j.mensagem ?? "";
      } else {
        msg = (await r.text()).trim();
      }
    } catch {
      msg = "";
    }
    throw new Error(msg && !msg.startsWith("<") && msg.length <= 300 ? msg : "Não foi possível baixar o arquivo. Tente de novo.");
  }
  const blob = await r.blob();
  const nome = nomeDoArquivo(r.headers.get("content-disposition"), r.url, sugerido);
  return new File([blob], nome, { type: blob.type || "application/octet-stream" });
}

/** Entrega o arquivo ao aparelho como download (pasta Downloads no Android). */
export function salvarNoAparelho(arquivo: File): void {
  const endereco = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = endereco;
  a.download = arquivo.name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
}
