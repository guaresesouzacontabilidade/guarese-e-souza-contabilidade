import "server-only";
import { request } from "node:https";

/**
 * API Pix do Sicredi (padrão da API Pix do Banco Central, v2), com o
 * certificado do escritório na conexão (mTLS) e token OAuth2
 * (client_credentials). Produção:
 *   token  https://api-pix.sicredi.com.br/oauth/token
 *   API    https://api-pix.sicredi.com.br/api/v2
 * A homologação usa os endereços informados pelo Sicredi na liberação.
 */

export const SICREDI_PRODUCAO = {
  urlToken: "https://api-pix.sicredi.com.br/oauth/token",
  urlApi: "https://api-pix.sicredi.com.br/api/v2",
};
export const ESCOPOS = "cobv.write cobv.read pix.read webhook.read webhook.write";

export interface ConexaoSicredi {
  urlToken: string;
  urlApi: string;
  clientId: string;
  clientSecret: string;
  /** Certificado assinado pelo Sicredi e a chave privada, em PEM. */
  certificado: string;
  chave: string;
  /** Cadeia de certificação extra (só nos testes com servidor próprio). */
  ca?: string;
}

export class ErroSicredi extends Error {
  constructor(
    mensagem: string,
    public status: number | null = null,
  ) {
    super(mensagem);
  }
}

interface Resposta {
  status: number;
  corpo: unknown;
}

function chamar(c: ConexaoSicredi, metodo: string, url: string, cabecalhos: Record<string, string>, corpo?: string): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      {
        method: metodo,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        cert: c.certificado,
        key: c.chave,
        ca: c.ca,
        headers: { Accept: "application/json", ...cabecalhos, ...(corpo ? { "Content-Length": String(Buffer.byteLength(corpo)) } : {}) },
        timeout: 20_000,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (p: Buffer) => partes.push(p));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let json: unknown = texto;
          try {
            json = texto ? JSON.parse(texto) : null;
          } catch {
            // resposta sem JSON
          }
          resolve({ status: res.statusCode ?? 0, corpo: json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new ErroSicredi("O banco não respondeu a tempo.")));
    req.on("error", (e) => reject(e instanceof ErroSicredi ? e : new ErroSicredi(mensagemConexao(e))));
    if (corpo) req.write(corpo);
    req.end();
  });
}

function mensagemConexao(e: Error & { code?: string }) {
  if (e.code === "ERR_OSSL_X509_KEY_VALUES_MISMATCH" || /key values mismatch/i.test(e.message)) return "O certificado e a chave privada não combinam.";
  if (e.code === "ENOTFOUND") return "Endereço do banco não encontrado.";
  if (e.code === "ECONNRESET" || /handshake|alert/i.test(e.message)) return "O banco recusou o certificado (confira se é o certificado assinado pelo Sicredi para estas credenciais).";
  return `Falha na conexão com o banco: ${e.message}`;
}

/** Mensagem do erro no padrão da API Pix (RFC 7807). */
function detalhe(r: Resposta) {
  const c = r.corpo as { title?: string; detail?: string; violacoes?: { razao?: string; propriedade?: string }[]; error_description?: string } | null;
  const v = c?.violacoes?.map((x) => `${x.propriedade ?? ""} ${x.razao ?? ""}`.trim()).join("; ");
  return [c?.title, c?.detail, c?.error_description, v].filter(Boolean).join(" — ") || `HTTP ${r.status}`;
}

const tokens = new Map<string, { token: string; expira: number }>();

/** Token OAuth2 (guardado enquanto vale, para não pedir a cada chamada). */
export async function obterToken(c: ConexaoSicredi): Promise<string> {
  const chave = `${c.urlToken}|${c.clientId}`;
  const guardado = tokens.get(chave);
  if (guardado && guardado.expira > Date.now() + 30_000) return guardado.token;
  const corpo = new URLSearchParams({ grant_type: "client_credentials", scope: ESCOPOS }).toString();
  const r = await chamar(c, "POST", c.urlToken, {
    Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  }, corpo);
  const j = r.corpo as { access_token?: string; expires_in?: number } | null;
  if (r.status !== 200 || !j?.access_token) {
    throw new ErroSicredi(r.status === 401 ? "Client ID ou Client Secret recusados pelo banco." : `O banco recusou o acesso: ${detalhe(r)}`, r.status);
  }
  tokens.set(chave, { token: j.access_token, expira: Date.now() + (j.expires_in ?? 300) * 1000 });
  return j.access_token;
}

async function api(c: ConexaoSicredi, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const token = await obterToken(c);
  return chamar(c, metodo, `${c.urlApi.replace(/\/$/, "")}${caminho}`, { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, corpo === undefined ? undefined : JSON.stringify(corpo));
}

export interface CobrancaBanco {
  txid: string;
  vencimento: string;
  valor: string;
  devedor: { documento: string; nome: string };
  chave: string;
  descricao: string;
  multaPercentual: number;
  jurosMesPercentual: number;
  cobrarEncargos: boolean;
  /** Dias para pagar depois do vencimento (com multa e juros). */
  validadeAposVencimento?: number;
}

export interface CobvBanco {
  txid: string;
  status: string;
  pixCopiaECola: string | null;
  location: string | null;
  pix: { endToEndId: string; valor: string; horario: string }[];
}

function lerCobv(j: unknown): CobvBanco {
  const o = (j ?? {}) as { txid?: string; status?: string; pixCopiaECola?: string; loc?: { location?: string }; location?: string; pix?: { endToEndId: string; valor: string; horario: string }[] };
  return { txid: o.txid ?? "", status: o.status ?? "", pixCopiaECola: o.pixCopiaECola ?? null, location: o.loc?.location ?? o.location ?? null, pix: o.pix ?? [] };
}

/** Corpo da cobrança com vencimento (cobv) no padrão do Banco Central. */
export function corpoCobv(d: CobrancaBanco) {
  const doc = d.devedor.documento.replace(/\D/g, "");
  return {
    calendario: { dataDeVencimento: d.vencimento, validadeAposVencimento: d.validadeAposVencimento ?? 60 },
    devedor: { ...(doc.length === 11 ? { cpf: doc } : { cnpj: doc }), nome: d.devedor.nome.slice(0, 140) },
    valor: {
      original: Number(d.valor).toFixed(2),
      ...(d.cobrarEncargos
        ? {
            // Multa percentual (modalidade 2) e juros percentuais ao mês em dias corridos (modalidade 3)
            multa: { modalidade: "2", valorPerc: Number(d.multaPercentual).toFixed(2) },
            juros: { modalidade: "3", valorPerc: Number(d.jurosMesPercentual).toFixed(2) },
          }
        : {}),
    },
    chave: d.chave,
    solicitacaoPagador: d.descricao.slice(0, 140),
  };
}

export async function criarCobv(c: ConexaoSicredi, d: CobrancaBanco): Promise<CobvBanco> {
  const r = await api(c, "PUT", `/cobv/${encodeURIComponent(d.txid)}`, corpoCobv(d));
  if (r.status !== 200 && r.status !== 201) throw new ErroSicredi(`O banco não criou a cobrança: ${detalhe(r)}`, r.status);
  return lerCobv(r.corpo);
}

export async function consultarCobv(c: ConexaoSicredi, txid: string): Promise<CobvBanco> {
  const r = await api(c, "GET", `/cobv/${encodeURIComponent(txid)}`);
  if (r.status !== 200) throw new ErroSicredi(`Consulta da cobrança no banco: ${detalhe(r)}`, r.status);
  return lerCobv(r.corpo);
}

export async function removerCobv(c: ConexaoSicredi, txid: string): Promise<void> {
  const r = await api(c, "PATCH", `/cobv/${encodeURIComponent(txid)}`, { status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" });
  if (r.status !== 200) throw new ErroSicredi(`O banco não removeu a cobrança: ${detalhe(r)}`, r.status);
}

/** Pix recebidos num intervalo (UTC, RFC 3339), com txid. */
export async function listarPix(c: ConexaoSicredi, inicio: Date, fim: Date): Promise<{ txid?: string; endToEndId: string; valor: string; horario: string }[]> {
  const lista: { txid?: string; endToEndId: string; valor: string; horario: string }[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const q = new URLSearchParams({ inicio: inicio.toISOString(), fim: fim.toISOString(), txIdPresente: "true", "paginacao.paginaAtual": String(pagina), "paginacao.itensPorPagina": "100" });
    const r = await api(c, "GET", `/pix?${q}`);
    if (r.status !== 200) throw new ErroSicredi(`Consulta dos Pix recebidos: ${detalhe(r)}`, r.status);
    const j = r.corpo as { pix?: { txid?: string; endToEndId: string; valor: string; horario: string }[]; parametros?: { paginacao?: { quantidadeDePaginas?: number } } };
    lista.push(...(j.pix ?? []));
    if (pagina + 1 >= (j.parametros?.paginacao?.quantidadeDePaginas ?? 1)) break;
  }
  return lista;
}

/** Cadastra o endereço que o banco chama quando um Pix da chave é pago. */
export async function registrarWebhook(c: ConexaoSicredi, chavePix: string, url: string): Promise<void> {
  const r = await api(c, "PUT", `/webhook/${encodeURIComponent(chavePix)}`, { webhookUrl: url });
  if (r.status !== 200 && r.status !== 201 && r.status !== 204) throw new ErroSicredi(`O banco não cadastrou o aviso automático: ${detalhe(r)}`, r.status);
}

/** Teste: pede o token (confere certificado, chave e credenciais). */
export async function testarConexao(c: ConexaoSicredi): Promise<void> {
  tokens.delete(`${c.urlToken}|${c.clientId}`);
  await obterToken(c);
}

/** txid da cobrança com vencimento: 26 a 35 letras e números, único por recebedor. */
export function txidCobv(ano: number, numero: number, aleatorio: string) {
  return `HON${ano}${String(numero).padStart(6, "0")}${aleatorio.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`.slice(0, 35).padEnd(26, "0");
}
