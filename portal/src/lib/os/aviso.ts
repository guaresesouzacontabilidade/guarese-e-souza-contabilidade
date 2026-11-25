import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { enviarModeloWhatsapp } from "@/lib/whatsapp/cloud-api";
import { parametrosAvisoOs } from "./rotulos";

/**
 * Aviso automático "sua OS está pronta" pelo WhatsApp oficial (Cloud API da
 * Meta), saindo do número da própria loja. Vai só o necessário para o modelo
 * aprovado: o primeiro nome do cliente, o número da OS, o nome da loja e o
 * link de acompanhamento. Sem o número, o modelo ou o token, nada é enviado
 * (fica registrado como "não configurado").
 */

interface EnvioOs {
  id: string;
  empresa_id: string | null;
  referencia_id: string | null;
  destinatario: string;
  tentativas: number;
}

async function resultado(admin: ClienteAdmin, envio: EnvioOs, situacao: "enviado" | "falhou" | "nao_configurado" | "dispensado", erro: string | null, provedor?: string | null) {
  const status = situacao === "dispensado" ? "desativado" : situacao;
  await admin
    .from("envios")
    .update({
      status,
      erro: situacao === "enviado" ? null : (erro ?? (situacao === "nao_configurado" ? "WhatsApp da loja não configurado: nenhuma mensagem foi enviada." : null)),
      enviado_em: situacao === "enviado" ? new Date().toISOString() : null,
      provedor_id: provedor ?? null,
      tentativas: envio.tentativas + (situacao === "dispensado" ? 0 : 1),
    })
    .eq("id", envio.id);
  if (envio.referencia_id) await admin.rpc("os_aviso_resultado", { p_ordem_id: envio.referencia_id, p_situacao: situacao, p_erro: erro ?? "" });
}

export async function executarAvisoOs(admin: ClienteAdmin, envio: EnvioOs, site: string) {
  if (!envio.referencia_id || !envio.empresa_id) return { ignorado: "envio sem OS" };
  const [{ data: o }, { data: cfg }, { data: emp }, { data: segredo }] = await Promise.all([
    admin.from("os_ordens").select("id, empresa_id, numero, etapa, cliente_nome, cliente_telefone, codigo_publico, avisar_whatsapp").eq("id", envio.referencia_id).maybeSingle(),
    admin.from("os_config").select("whatsapp_ativo, whatsapp_phone_number_id, whatsapp_modelo, whatsapp_idioma, nome_exibicao").eq("empresa_id", envio.empresa_id).maybeSingle(),
    admin.from("empresas").select("razao_social, nome_fantasia, ferramentas_desligadas").eq("id", envio.empresa_id).maybeSingle(),
    admin.from("os_whatsapp_segredo").select("token_cifrado").eq("empresa_id", envio.empresa_id).maybeSingle(),
  ]);
  if (!o || o.empresa_id !== envio.empresa_id) {
    await resultado(admin, envio, "dispensado", "OS não encontrada.");
    return { status: "desativado" };
  }
  // Voltou da etapa "pronta" antes do envio (clique errado) ou a ferramenta foi desligada
  if (o.etapa !== "pronta") {
    await resultado(admin, envio, "dispensado", o.etapa === "entregue" ? "a OS já foi entregue" : "a OS saiu da etapa Pronta");
    return { status: "desativado" };
  }
  if (!cfg?.whatsapp_ativo || !o.avisar_whatsapp || (emp?.ferramentas_desligadas ?? []).includes("os")) {
    await resultado(admin, envio, "dispensado", "aviso automático desligado");
    return { status: "desativado" };
  }
  const telefone = (o.cliente_telefone ?? "").replace(/\D/g, "");
  if (!telefone || telefone !== envio.destinatario.replace(/\D/g, "")) {
    await resultado(admin, envio, "dispensado", "o telefone do cliente mudou");
    return { status: "desativado" };
  }
  let token: string | null = null;
  if (segredo?.token_cifrado) {
    try {
      token = decifrar(segredo.token_cifrado);
    } catch {
      token = null;
    }
  }
  const loja = cfg.nome_exibicao ?? emp?.nome_fantasia ?? emp?.razao_social ?? "a loja";
  const r = await enviarModeloWhatsapp(
    { phoneNumberId: cfg.whatsapp_phone_number_id, modelo: cfg.whatsapp_modelo, idioma: cfg.whatsapp_idioma, token },
    telefone,
    parametrosAvisoOs({ cliente: o.cliente_nome, numero: o.numero, loja, link: `${site}/acompanhar/${o.codigo_publico}` }),
  );
  if (r.enviado) {
    await resultado(admin, envio, "enviado", null, r.id);
    return { status: "enviado" };
  }
  if (r.motivo === "nao_configurado") {
    await resultado(admin, envio, "nao_configurado", null);
    return { status: "nao_configurado" };
  }
  await resultado(admin, envio, "falhou", r.erro ?? "Falha no envio");
  throw new Error(r.erro ?? "Falha no envio do aviso da OS");
}
