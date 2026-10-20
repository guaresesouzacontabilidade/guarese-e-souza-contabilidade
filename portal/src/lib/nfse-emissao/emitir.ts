import "server-only";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { Job } from "@/lib/jobs/executor";
import { envServidor } from "@/lib/env-servidor";
import { decifrar } from "@/lib/notas-automaticas/cripto";
import { ErroConexao, type Credencial } from "@/lib/notas-automaticas/transporte";
import { importarXmlAutomatico } from "@/lib/notas-automaticas/importar";
import {
  VARIANTE_PADRAO,
  ajustarVariante,
  dpsAssinada,
  pedidoCancelamentoAssinado,
  type AmbienteNfse,
  type DadosDps,
  type EnderecoNacional,
  type MotivoCancelamento,
  type VarianteLeiaute,
} from "./dps";
import { URLS_SEFIN, chaveDaDps, enviarDps, lerNfse, nfsePorChave, registrarEvento, type ConexaoSefin, type ErroSefin } from "./sefin";
import { atividadeSimplesPadrao } from "./reforma";

/**
 * Tarefas da fila que falam com o Emissor Nacional:
 *  - emitir_nfse: monta e assina a DPS, envia e guarda a nota autorizada (ou
 *    os motivos da rejeição). Se uma tentativa anterior ficou sem resposta,
 *    pergunta antes se a DPS já virou nota, para nunca emitir duas vezes.
 *  - cancelar_nfse: envia o pedido de cancelamento (evento 101101).
 * Falha de conexão volta à fila (1, 5, 15 min...); rejeição não se repete.
 * Em produção, a nota e o cancelamento entram nos documentos fiscais da
 * empresa; notas de teste (produção restrita) não entram.
 */

type Emissao = Database["public"]["Tables"]["nfse_emissoes"]["Row"];
type Config = Database["public"]["Tables"]["nfse_emissao_config"]["Row"];
export interface OpcoesTeste {
  base?: string;
  ca?: string[];
}

const PORTAL = "PORTAL";

function mensagem(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

async function credencialDaEmpresa(admin: ClienteAdmin, empresaId: string): Promise<{ credencial: Credencial } | { erro: string }> {
  const { data: cert } = await admin
    .from("certificados_digitais")
    .select("id, valido_ate")
    .eq("empresa_id", empresaId)
    .is("revogado_em", null)
    .maybeSingle();
  if (!cert) return { erro: "A empresa não tem certificado digital cadastrado." };
  if (new Date(cert.valido_ate).getTime() <= Date.now()) return { erro: "O certificado digital da empresa venceu. Cadastre o certificado renovado." };
  const { data: segredo } = await admin.from("certificados_segredos").select("conteudo_cifrado").eq("certificado_id", cert.id).maybeSingle();
  if (!segredo) return { erro: "O certificado guardado não foi encontrado. Cadastre o certificado de novo." };
  return { credencial: JSON.parse(decifrar(segredo.conteudo_cifrado)) as Credencial };
}

/** Dados da DPS a partir do pedido, da configuração e do cadastro da empresa. */
export function dadosDaDps(
  e: Emissao,
  cfg: Pick<Config, "inscricao_municipal" | "regime_apuracao_sn" | "regime_especial" | "percentual_tributos_sn" | "percentual_tributos_federais" | "percentual_tributos_municipais">,
  emp: { documento: string; regime_tributario: string },
  agora: Date,
  simples: { anexo_servicos?: string | null; fator_r?: boolean | null } | null = null,
): DadosDps {
  const opcao = emp.regime_tributario === "mei" ? 2 : emp.regime_tributario === "simples_nacional" ? 3 : 1;
  const end = e.tomador_endereco as Record<string, string | null> | null;
  const endereco: EnderecoNacional | null =
    end && end.codigo_municipio && end.cep
      ? {
          logradouro: end.logradouro ?? "",
          numero: end.numero ?? null,
          complemento: end.complemento ?? null,
          bairro: end.bairro ?? null,
          codigoMunicipio: end.codigo_municipio,
          cep: end.cep,
        }
      : null;
  let tomador: DadosDps["tomador"] = null;
  if (e.tomador_tipo === "cnpj") {
    if (!endereco) throw new Error("Endereço do tomador (CNPJ) incompleto: falta o município ou o CEP.");
    tomador = { tipo: "cnpj", documento: e.tomador_documento!, nome: e.tomador_nome!, endereco, email: e.tomador_email, telefone: e.tomador_telefone };
  } else if (e.tomador_tipo === "cpf") {
    tomador = { tipo: "cpf", documento: e.tomador_documento!, nome: e.tomador_nome!, endereco, email: e.tomador_email, telefone: e.tomador_telefone };
  }
  const tributos: DadosDps["tributosAproximados"] =
    opcao === 2
      ? { tipo: "nao_informar" }
      : opcao === 3
        ? { tipo: "simples", percentual: String(cfg.percentual_tributos_sn ?? "") }
        : { tipo: "percentuais", federal: String(cfg.percentual_tributos_federais ?? ""), estadual: "0", municipal: String(cfg.percentual_tributos_municipais ?? "") };
  // dhEmi um pouco antes de agora (relógios), mas nunca antes do dia da competência
  const emitidaEm = new Date(Math.max(agora.getTime() - 30_000, Date.parse(`${e.competencia}T00:00:00-03:00`)));
  return {
    ambiente: e.ambiente as DadosDps["ambiente"],
    emitidaEm,
    serie: e.serie,
    numero: Number(e.numero_dps),
    competencia: e.competencia,
    codigoMunicipioEmissor: e.codigo_municipio_emissor,
    prestador: {
      cnpj: emp.documento,
      inscricaoMunicipal: cfg.inscricao_municipal,
      opcaoSimples: opcao,
      regimeApuracaoSn: cfg.regime_apuracao_sn as 1 | 2 | 3,
      regimeEspecial: cfg.regime_especial,
    },
    tomador,
    servico: {
      localPrestacao: e.local_prestacao,
      codigoTributacaoNacional: e.codigo_tributacao_nacional,
      codigoTributacaoMunicipal: e.codigo_tributacao_municipal,
      codigoNbs: e.codigo_nbs,
      descricao: e.descricao,
      atividadeSimples: opcao === 3 ? (e.atividade_sn ?? atividadeSimplesPadrao(e.codigo_tributacao_nacional, simples?.anexo_servicos, simples?.fator_r)) : null,
      ibscbs: e.cind_op && e.cclass_trib ? { indicadorOperacao: e.cind_op, classificacao: e.cclass_trib } : null,
    },
    valor: String(e.valor),
    issRetido: e.iss_retido,
    aliquotaIss: e.aliquota_iss == null ? null : String(e.aliquota_iss),
    tributosAproximados: tributos,
    informacoesComplementares: e.informacoes_complementares,
  };
}

/** Combinação de partes do leiaute que o ambiente aceita: a aprendida nas recusas ou o padrão. */
export async function varianteDoAmbiente(admin: ClienteAdmin, ambiente: AmbienteNfse): Promise<VarianteLeiaute> {
  const { data } = await admin.from("nfse_leiaute_ambiente").select("variante").eq("ambiente", ambiente).maybeSingle();
  return { ...VARIANTE_PADRAO[ambiente], ...((data?.variante as Partial<VarianteLeiaute> | null) ?? {}) };
}

async function guardarVariante(admin: ClienteAdmin, ambiente: AmbienteNfse, variante: VarianteLeiaute, erros: ErroSefin[]) {
  await admin.from("nfse_leiaute_ambiente").upsert({
    ambiente,
    variante: variante as never,
    motivo: erros.map((x) => `${x.codigo}: ${x.descricao}`).join(" | ").slice(0, 2000),
    atualizado_em: new Date().toISOString(),
  });
}

async function registrar(admin: ClienteAdmin, id: string, dados: Partial<Emissao>) {
  const { error } = await admin.from("nfse_emissoes").update(dados as never).eq("id", id);
  if (error) throw new Error(`Falha ao gravar a nota: ${error.message}`);
}

async function avisar(admin: ClienteAdmin, id: string) {
  await admin.rpc("nfse_avisar", { p_id: id });
}

const ultimaTentativa = (job: Job) => job.tentativas >= (job.max_tentativas ?? 5);

/** Nota autorizada: guarda o XML; em produção, registra nos documentos fiscais e manda ao tomador. */
async function concluirAutorizada(admin: ClienteAdmin, e: Emissao, emp: { documento: string }, cfg: Config, chave: string, xml: string) {
  const lida = lerNfse(xml);
  await registrar(admin, e.id, {
    situacao: "autorizada",
    chave_acesso: chave,
    numero_nfse: lida.numero,
    autorizada_em: lida.processadaEm ? new Date(lida.processadaEm).toISOString() : new Date().toISOString(),
    xml_nfse: xml,
    mensagens: null,
  });
  if (e.ambiente !== "producao") return { situacao: "autorizada", chave, teste: true };

  try {
    const r = await importarXmlAutomatico(admin, {
      empresaId: e.empresa_id,
      documentoEmpresa: emp.documento,
      xml,
      nome: `NFSe-${lida.numero ?? ""}-${chave}.xml`,
      origem: "emissao",
      categoriaPadrao: "nfse",
    });
    if (r.documentoId) await registrar(admin, e.id, { documento_id: r.documentoId });
  } catch (err) {
    // A nota já está autorizada e guardada; o registro nos documentos pode ser refeito pela busca automática
    console.error("[nfse] registro nos documentos:", mensagem(err));
  }
  if (cfg.enviar_email_tomador && e.tomador_email) {
    try {
      const { enviarParaTomador } = await import("./email-tomador");
      if (await enviarParaTomador(admin, e.id)) await registrar(admin, e.id, { email_tomador_enviado_em: new Date().toISOString() });
    } catch (err) {
      console.error("[nfse] e-mail ao tomador:", mensagem(err));
    }
  }
  return { situacao: "autorizada", chave };
}

export async function emitirNfse(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const id = (job.payload as { emissao_id?: string } | null)?.emissao_id;
  if (!id) return { ignorado: "tarefa sem nota" };
  const { data: e } = await admin.from("nfse_emissoes").select("*").eq("id", id).maybeSingle();
  if (!e) return { ignorado: "nota não encontrada" };
  if (!["na_fila", "enviando", "falha"].includes(e.situacao)) return { ignorado: `nota ${e.situacao}` };
  const [{ data: cfg }, { data: emp }, { data: simples }] = await Promise.all([
    admin.from("nfse_emissao_config").select("*").eq("empresa_id", e.empresa_id).maybeSingle(),
    admin.from("empresas").select("documento, regime_tributario").eq("id", e.empresa_id).maybeSingle(),
    admin.from("calculo_parametros").select("anexo_servicos, fator_r").eq("empresa_id", e.empresa_id).maybeSingle(),
  ]);
  if (!cfg || !emp) return { ignorado: "empresa sem configuração" };

  const falhaDefinitiva = async (descricao: string, codigo = PORTAL) => {
    await registrar(admin, id, { situacao: "falha", mensagens: [{ codigo, descricao }] as never });
    await avisar(admin, id);
    return { situacao: "falha", motivo: descricao };
  };
  if (!teste.base && envServidor.notasSemRede()) {
    return falhaDefinitiva("Emissão desligada neste ambiente (demonstração ou teste): nada foi enviado ao Emissor Nacional.");
  }
  const cred = await credencialDaEmpresa(admin, e.empresa_id);
  if ("erro" in cred) return falhaDefinitiva(cred.erro);

  const ambiente = e.ambiente as AmbienteNfse;
  const chaves = { chavePem: cred.credencial.chave, certificadoPem: cred.credencial.certificados[0] };
  // Dados fora do leiaute: a nota não sai daqui (rejeitada pelo portal, sem envio)
  const montar = (variante: VarianteLeiaute) => {
    const dps = dpsAssinada({ ...dadosDaDps(e, cfg, emp, new Date(), simples), variante }, chaves);
    if (dps.id !== e.id_dps) throw new Error("Identificador da DPS diferente do reservado.");
    return dps;
  };
  const rejeitarNoPortal = async (err: unknown) => {
    await registrar(admin, id, { situacao: "rejeitada", mensagens: [{ codigo: PORTAL, descricao: mensagem(err) }] as never });
    await avisar(admin, id);
    return { situacao: "rejeitada", motivo: mensagem(err) };
  };
  let variante = await varianteDoAmbiente(admin, ambiente);
  let dps: { id: string; xml: string };
  try {
    dps = montar(variante);
  } catch (err) {
    return rejeitarNoPortal(err);
  }

  const conexao: ConexaoSefin = { base: teste.base ?? URLS_SEFIN[e.ambiente as keyof typeof URLS_SEFIN], credencial: cred.credencial, ca: teste.ca };
  await registrar(admin, id, { situacao: "enviando", tentativas: e.tentativas + 1, ultimo_envio_em: new Date().toISOString() });
  try {
    // Tentativa anterior sem resposta: a DPS pode já ter virado nota
    if (e.tentativas > 0) {
      const chave = await chaveDaDps(conexao, e.id_dps);
      if (chave) return concluirAutorizada(admin, e, emp, cfg, chave, await nfsePorChave(conexao, chave));
    }
    // Recusa de leiaute (o governo implanta a NT 009 em etapas): ajusta a combinação e envia de novo a mesma DPS,
    // que não foi registrada; a combinação que passou fica guardada para as próximas notas do ambiente
    const vistas = new Set([JSON.stringify(variante)]);
    for (;;) {
      const r = await enviarDps(conexao, dps.xml);
      if (r.situacao === "autorizada") return concluirAutorizada(admin, e, emp, cfg, r.chave, r.xml);
      // E0014: série e número já usados numa nota (resposta anterior perdida): busca essa nota
      if (r.erros.some((x) => x.codigo === "E0014")) {
        const chave = await chaveDaDps(conexao, e.id_dps);
        if (chave) return concluirAutorizada(admin, e, emp, cfg, chave, await nfsePorChave(conexao, chave));
      }
      const nova = ajustarVariante(variante, r.erros);
      if (nova && !vistas.has(JSON.stringify(nova)) && vistas.size < 7) {
        vistas.add(JSON.stringify(nova));
        variante = nova;
        await guardarVariante(admin, ambiente, variante, r.erros);
        try {
          dps = montar(variante);
        } catch (err) {
          return rejeitarNoPortal(err);
        }
        continue;
      }
      await registrar(admin, id, { situacao: "rejeitada", mensagens: r.erros as never });
      await avisar(admin, id);
      return { situacao: "rejeitada", erros: r.erros.length };
    }
  } catch (err) {
    const erro: ErroSefin = { codigo: err instanceof ErroConexao ? err.codigo : PORTAL, descricao: mensagem(err) };
    await registrar(admin, id, { situacao: "falha", mensagens: [erro] as never });
    // Certificado recusado não melhora tentando de novo
    if ((err instanceof ErroConexao && err.codigo === "certificado") || ultimaTentativa(job)) {
      await avisar(admin, id);
      return { situacao: "falha", motivo: erro.descricao };
    }
    throw err;
  }
}

export async function cancelarNfse(admin: ClienteAdmin, job: Job, teste: OpcoesTeste = {}) {
  const id = (job.payload as { emissao_id?: string } | null)?.emissao_id;
  if (!id) return { ignorado: "tarefa sem nota" };
  const { data: e } = await admin.from("nfse_emissoes").select("*").eq("id", id).maybeSingle();
  if (!e || e.situacao !== "cancelando" || !e.chave_acesso) return { ignorado: "nada a cancelar" };
  const { data: emp } = await admin.from("empresas").select("documento").eq("id", e.empresa_id).maybeSingle();
  if (!emp) return { ignorado: "empresa não encontrada" };

  const voltar = async (erros: ErroSefin[]) => {
    await registrar(admin, id, { situacao: "autorizada", mensagens: erros as never });
    await avisar(admin, id);
    return { situacao: "cancelamento_recusado", erros: erros.length };
  };
  if (!teste.base && envServidor.notasSemRede()) {
    return voltar([{ codigo: PORTAL, descricao: "Cancelamento desligado neste ambiente (demonstração ou teste): nada foi enviado." }]);
  }
  const cred = await credencialDaEmpresa(admin, e.empresa_id);
  if ("erro" in cred) return voltar([{ codigo: PORTAL, descricao: cred.erro }]);

  let pedido: string;
  try {
    pedido = pedidoCancelamentoAssinado(
      {
        ambiente: e.ambiente as "producao" | "homologacao",
        chave: e.chave_acesso,
        cnpj: emp.documento,
        quando: new Date(Date.now() - 30_000),
        motivo: (e.cancelamento_motivo ?? 9) as MotivoCancelamento,
        justificativa: e.cancelamento_justificativa ?? "",
      },
      { chavePem: cred.credencial.chave, certificadoPem: cred.credencial.certificados[0] },
    ).xml;
  } catch (err) {
    return voltar([{ codigo: PORTAL, descricao: mensagem(err) }]);
  }

  const conexao: ConexaoSefin = { base: teste.base ?? URLS_SEFIN[e.ambiente as keyof typeof URLS_SEFIN], credencial: cred.credencial, ca: teste.ca };
  try {
    const r = await registrarEvento(conexao, e.chave_acesso, pedido);
    if (r.situacao === "rejeitado") return voltar(r.erros);
    await registrar(admin, id, { situacao: "cancelada", cancelada_em: new Date().toISOString(), cancelamento_xml: r.xml, mensagens: null });
    if (e.ambiente === "producao" && r.xml) {
      try {
        await importarXmlAutomatico(admin, {
          empresaId: e.empresa_id,
          documentoEmpresa: emp.documento,
          xml: r.xml,
          nome: `Cancelamento-NFSe-${e.numero_nfse ?? ""}-${e.chave_acesso}.xml`,
          origem: "emissao",
          categoriaPadrao: "eventos_fiscais",
        });
      } catch (err) {
        console.error("[nfse] registro do cancelamento:", mensagem(err));
      }
    }
    await avisar(admin, id);
    return { situacao: "cancelada" };
  } catch (err) {
    if (ultimaTentativa(job) || (err instanceof ErroConexao && err.codigo === "certificado")) {
      return voltar([{ codigo: err instanceof ErroConexao ? err.codigo : PORTAL, descricao: mensagem(err) }]);
    }
    throw err;
  }
}
