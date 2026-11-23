import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { AnexoEmail } from "@/lib/email/enviar";
import type { DadosModeloEmail } from "@/lib/email/modelo";
import type { ConfigWhatsapp } from "@/lib/whatsapp/cloud-api";
import { diasEntre, hojeISO } from "@/lib/competencia";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { arquivoAssinado, gerarArquivoRecibo } from "@/lib/recibos/arquivo";
import { carregarRecibo } from "@/lib/recibos/carregar";
import { nomeArquivoRecibo } from "@/lib/recibos/pdf";
import { numeroCobranca } from "./comum";
import { preencher, resumoWhatsapp, textoDaMensagem, tipoDaMensagem } from "./mensagens";
import { dadosEscritorio, montarCobrancaPdf, pixDaCobranca, valorParaPagar } from "./montar";
import { gerarPdfCobranca, nomeArquivoCobranca } from "./pdf";
import { qrPng } from "./qr";

type Envio = Database["public"]["Tables"]["envios"]["Row"];

export type EnvioCobrancaPreparado =
  | { dispensado: string }
  | { canal: "email"; assunto: string; conteudo: DadosModeloEmail; anexos: AnexoEmail[] }
  | { canal: "whatsapp"; cfg: ConfigWhatsapp; parametros: string[] };

/** O WhatsApp aceita parâmetros sem quebras de linha e sem muitos espaços seguidos. */
function parametro(t: string) {
  return t.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 900);
}

/**
 * Monta o e-mail ou o WhatsApp de uma cobrança na hora de enviar: confere se
 * ela ainda está em aberto (paga ou cancelada não recebe lembrete), calcula
 * o valor do dia (com multa e juros depois do vencimento) e o Pix desse valor.
 */
export async function prepararEnvioCobranca(admin: ClienteAdmin, envio: Envio, site: string): Promise<EnvioCobrancaPreparado> {
  if (!envio.referencia_id) return { dispensado: "Envio sem cobrança." };
  const [{ data: c }, { data: etapa }, { data: cfg }] = await Promise.all([
    admin.from("honorarios_cobrancas").select("*").eq("id", envio.referencia_id).maybeSingle(),
    admin.from("honorarios_lembretes").select("motivo, dias").eq("envio_id", envio.id).maybeSingle(),
    admin.from("honorarios_config").select("*").eq("id", 1).single(),
  ]);
  if (!c) return { dispensado: "Cobrança não encontrada." };
  const motivo = etapa?.motivo ?? "manual";
  if (motivo === "pagamento" ? c.situacao !== "paga" : c.situacao !== "aberta") {
    return { dispensado: c.situacao === "paga" ? "Cobrança já paga: lembrete dispensado." : "Cobrança cancelada ou fora de aberto: envio dispensado." };
  }
  if (motivo !== "pagamento" && envio.canal === "whatsapp" && !c.whatsapp_autorizado) {
    return { dispensado: "O cliente não autoriza mais cobrança por WhatsApp neste número." };
  }

  const hoje = hojeISO();
  const tipo = tipoDaMensagem(motivo, etapa?.dias ?? null);
  const pagar = valorParaPagar(c, hoje);
  const pix = pixDaCobranca(c, pagar.valor);
  const escritorio = await dadosEscritorio();
  let cliente = c.pagador_nome;
  if (c.ficha_id) {
    const { data: f } = await admin.from("honorarios_fichas").select("contato_nome").eq("id", c.ficha_id).maybeSingle();
    if (f?.contato_nome) cliente = f.contato_nome;
  }
  const variaveis: Record<string, string> = {
    cliente,
    descricao: c.descricao,
    valor: formatarMoeda(c.valor),
    vencimento: formatarData(c.vencimento),
    dias: String(Math.abs(diasEntre(hoje, c.vencimento))),
    valor_atualizado: formatarMoeda(pagar.valor),
    valor_pago: formatarMoeda(c.valor_pago ?? c.valor),
    data_pagamento: formatarData(c.pago_em),
    escritorio: escritorio.nome,
  };
  const link = c.token_publico ? `${site}/pagar/${c.token_publico}` : null;

  if (envio.canal === "whatsapp") {
    const { data: esc } = await admin.from("escritorio").select("whatsapp_phone_number_id, whatsapp_template_idioma").eq("id", 1).single();
    if (!cfg?.whatsapp_ativo) return { dispensado: "Cobrança por WhatsApp desligada nas configurações." };
    return {
      canal: "whatsapp",
      cfg: { phoneNumberId: esc?.whatsapp_phone_number_id ?? null, modelo: cfg.whatsapp_template, idioma: esc?.whatsapp_template_idioma ?? "pt_BR" },
      parametros: [parametro(cliente), parametro(resumoWhatsapp(tipo, variaveis)), pix ?? "Peça o Pix ao escritório.", link ?? `${site}/login`],
    };
  }

  // E-mail
  const modelo = textoDaMensagem(tipo, cfg?.mensagens);
  const assunto = preencher(modelo.assunto, variaveis).slice(0, 200);
  const paragrafos = preencher(modelo.texto, variaveis).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const anexos: AnexoEmail[] = [];
  let destaque: DadosModeloEmail["destaque"];

  if (motivo === "pagamento") {
    if (c.recibo_id) {
      const r = await carregarRecibo(admin, c.recibo_id);
      if (r && r.linha.situacao === "emitido") {
        const pdf = (await arquivoAssinado(r.linha)) ?? (await gerarArquivoRecibo(admin, r.linha)).pdf;
        anexos.push({ nome: nomeArquivoRecibo(r.pdf), conteudo: pdf, tipo: "application/pdf" });
      }
    }
  } else {
    if (pix) {
      anexos.push({ nome: "pix-qrcode.png", conteudo: await qrPng(pix), tipo: "image/png", cid: "pixqr" });
      destaque = {
        titulo: "Pague com Pix",
        imagemCid: "pixqr",
        linhas: [
          pagar.atualizado
            ? `Valor atualizado até hoje: ${formatarMoeda(pagar.valor)} (multa ${formatarMoeda(pagar.atualizado.multa)} + juros ${formatarMoeda(pagar.atualizado.juros)})`
            : `Valor: ${formatarMoeda(pagar.valor)} · vencimento ${formatarData(c.vencimento)}`,
          `Cobrança nº ${numeroCobranca(c)} · ${escritorio.nome}`,
        ],
        codigo: pix,
      };
    }
    const { data: itens } = await admin.from("honorarios_cobranca_itens").select("*").eq("cobranca_id", c.id).order("ordem");
    const dadosPdf = await montarCobrancaPdf(c, itens ?? [], hoje);
    anexos.push({ nome: nomeArquivoCobranca(dadosPdf), conteudo: await gerarPdfCobranca(dadosPdf), tipo: "application/pdf" });
  }

  return {
    canal: "email",
    assunto,
    conteudo: {
      titulo: assunto,
      paragrafos,
      destaque,
      botao:
        motivo === "pagamento"
          ? c.empresa_id
            ? { texto: "Ver no portal", url: `${site}/e/${c.empresa_id}/honorarios` }
            : undefined
          : link
            ? { texto: "Ver a cobrança e pagar", url: link }
            : undefined,
      aviso: "O pagamento pelo Pix é conferido pelo escritório, que envia o recibo em seguida.",
    },
    anexos,
  };
}
