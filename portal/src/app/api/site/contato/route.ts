import { NextResponse, type NextRequest } from "next/server";
import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { enviarEmail } from "@/lib/email/enviar";
import { criarLimitador, origemPermitida, validarContato } from "@/lib/site/contato";

/**
 * Formulário de contato do site institucional: valida, barra robôs e excesso
 * de envios e manda a mensagem para o e-mail do escritório (a resposta vai
 * para o visitante). Sem o e-mail configurado no servidor, avisa que não
 * enviou — o site então oferece o WhatsApp e o e-mail com a mensagem pronta.
 */
const porEndereco = criarLimitador(5, 15 * 60_000);
const geral = criarLimitador(120, 60 * 60_000);

function cors(origem: string | null) {
  const h: Record<string, string> = { Vary: "Origin", "Cache-Control": "no-store" };
  if (origem && origemPermitida(origem)) {
    h["Access-Control-Allow-Origin"] = origem;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

const resposta = (origem: string | null, corpo: { ok: boolean; mensagem?: string }, status = 200) =>
  NextResponse.json(corpo, { status, headers: cors(origem) });

export function OPTIONS(req: NextRequest) {
  const origem = req.headers.get("origin");
  return new NextResponse(null, { status: origemPermitida(origem) ? 204 : 403, headers: cors(origem) });
}

export async function POST(req: NextRequest) {
  const origem = req.headers.get("origin");
  if (!origemPermitida(origem)) return resposta(origem, { ok: false, mensagem: "Origem não autorizada." }, 403);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "desconhecido";
  if (!porEndereco(ip) || !geral("todos")) {
    return resposta(origem, { ok: false, mensagem: "Muitas mensagens em pouco tempo. Tente de novo mais tarde ou fale pelo WhatsApp." }, 429);
  }

  let corpo: unknown;
  try {
    const texto = await req.text();
    if (texto.length > 20_000) return resposta(origem, { ok: false, mensagem: "Mensagem grande demais." }, 413);
    corpo = JSON.parse(texto);
  } catch {
    return resposta(origem, { ok: false, mensagem: "Envio inválido." }, 400);
  }

  const v = validarContato(corpo);
  // Robôs recebem "ok" e nada é enviado
  if (!v.ok && v.robo) return resposta(origem, { ok: true });
  if (!v.ok) return resposta(origem, { ok: false, mensagem: v.mensagem }, 400);

  const d = v.dados;
  const escritorio = await obterEscritorioPublico();
  const para = escritorio.email || "onguaresescontato@gmail.com";
  const r = await enviarEmail(
    para,
    `Contato pelo site: ${d.assunto} — ${d.nome}`,
    {
      titulo: "Nova mensagem pelo site",
      paragrafos: [
        `Nome: ${d.nome}`,
        `E-mail: ${d.email}`,
        d.telefone ? `WhatsApp/telefone: ${d.telefone}` : "WhatsApp/telefone: não informado",
        d.empresa ? `Empresa: ${d.empresa}` : "Empresa: não informada",
        `Assunto: ${d.assunto}`,
        `Mensagem:\n${d.mensagem}`,
      ],
      aviso: "Responda direto a este e-mail: a resposta vai para quem escreveu. A pessoa concordou com o uso dos dados só para responder ao contato.",
    },
    [],
    { responderPara: d.email },
  );
  if (r.enviado) return resposta(origem, { ok: true });
  if (r.motivo === "nao_configurado") {
    return resposta(origem, { ok: false, mensagem: "O envio pelo formulário ainda não está ligado. Use o WhatsApp ou o e-mail abaixo: a mensagem já vai escrita." }, 503);
  }
  console.error("[site/contato] falha ao enviar o e-mail:", r.erro);
  return resposta(origem, { ok: false, mensagem: "Não foi possível enviar agora. Use o WhatsApp ou o e-mail abaixo: a mensagem já vai escrita." }, 502);
}
