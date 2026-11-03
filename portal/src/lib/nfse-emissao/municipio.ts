import { formatarData } from "@/lib/formatos";
import type { ConvenioMunicipio } from "./sefin";

/**
 * Aviso de Configurar emissão: a empresa pode emitir pelo Emissor Nacional na
 * cidade dela? Junta a consulta ao convênio da prefeitura no Sistema Nacional
 * NFS-e com o que o portal já viu (a última nota da empresa recusada com
 * E0039 e as outras empresas da mesma cidade que já emitem pelo portal).
 *
 * Regras do governo ("Perguntas e Respostas NFS-e" v1.1, assuntos 1.2, 5.2,
 * 19.6 e 21.5): a prefeitura escolhe se usa os Emissores Públicos Nacionais
 * (senão, as notas saem pelo sistema dela; o MEI sempre emite pelo nacional)
 * e se libera todas as empresas da cidade ou autoriza uma a uma no Cadastro
 * Nacional de Contribuintes (CNC), com a data a partir da qual cada uma emite.
 * Empresa não liberada recebe a recusa E0039.
 */

export type ConsultaConvenio =
  | { tipo: "ok"; convenio: ConvenioMunicipio }
  | { tipo: "nao_encontrado" }
  | { tipo: "erro"; motivo: string }
  | { tipo: "desligada" }
  | { tipo: "sem_certificado" };

export interface EntradaAvisoMunicipio {
  /** Ex.: "Porto Nacional / TO" */
  municipio: string | null;
  ambiente: "homologacao" | "producao";
  /** empresas.regime_tributario */
  regime: string;
  consulta: ConsultaConvenio;
  /** Quando a nota mais recente da empresa nesta cidade foi recusada com E0039 (data e hora), ou null */
  recusaE0039: string | null;
  /** Outras empresas da mesma cidade com nota emitida pelo portal no mesmo ambiente */
  outrasEmpresasEmitindo: number;
}

export interface AvisoMunicipio {
  tom: "sucesso" | "info" | "alerta" | "perigo";
  titulo: string;
  texto: string[];
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios.replace("#", String(n)));

export function avaliarEmissorNacional(e: EntradaAvisoMunicipio): AvisoMunicipio | null {
  const cidade = e.municipio ?? "da empresa";
  const naCidade = e.municipio ? `A prefeitura de ${e.municipio}` : "A prefeitura da empresa";
  const recusa = e.recusaE0039 ? `O governo recusou a nota de ${formatarData(e.recusaE0039)} (código E0039)` : null;
  const outras =
    e.outrasEmpresasEmitindo > 0
      ? plural(e.outrasEmpresasEmitindo, `Outra empresa de ${cidade} já emite pelo portal.`, `Outras # empresas de ${cidade} já emitem pelo portal.`)
      : null;
  const teste =
    e.ambiente === "homologacao" ? "Consulta feita no ambiente de teste do governo; na produção, a configuração da prefeitura pode ser diferente." : null;
  const pedirAutorizacao =
    "Peça ao setor de ISS da prefeitura para autorizar o CNPJ desta empresa no Cadastro Nacional de Contribuintes (CNC) do Emissor Nacional, com a data a partir da qual ela pode emitir. Enquanto isso, as notas saem pelo sistema da prefeitura.";
  const aviso = (tom: AvisoMunicipio["tom"], titulo: string, ...texto: (string | null)[]): AvisoMunicipio => ({
    tom,
    titulo,
    texto: texto.filter((t): t is string => Boolean(t)),
  });

  if (e.regime === "mei") {
    return aviso("sucesso", "MEI emite pelo Emissor Nacional", "O MEI emite sempre pelo Emissor Nacional, mesmo quando a prefeitura usa sistema próprio.");
  }

  const c = e.consulta.tipo === "ok" ? e.consulta.convenio : null;
  if (c?.emissorNacional === false) {
    return aviso(
      "perigo",
      `${naCidade} não usa o Emissor Nacional`,
      `As notas desta empresa saem pelo sistema da prefeitura: pelo portal, o governo recusa a nota (código E0039). Nessas cidades, só o MEI emite pelo Emissor Nacional.`,
      "Quando a prefeitura liberar o Emissor Nacional, o portal passa a emitir sem precisar mudar nada aqui.",
      teste,
    );
  }
  if (c?.emissorNacional === true && c.todasHabilitadas === false) {
    if (recusa) {
      return aviso(
        "perigo",
        "A prefeitura ainda não autorizou esta empresa",
        `${naCidade} usa o Emissor Nacional, mas autoriza empresa por empresa. ${recusa}: esta empresa ainda não está autorizada.`,
        outras,
        pedirAutorizacao,
        teste,
      );
    }
    return aviso(
      "alerta",
      "A prefeitura autoriza empresa por empresa",
      `${naCidade} usa o Emissor Nacional, mas cada empresa precisa ser autorizada pela prefeitura no Cadastro Nacional de Contribuintes (CNC), com a data a partir da qual pode emitir. Empresa ainda não autorizada tem a nota recusada (código E0039).`,
      outras,
      "Na dúvida, confirme com o setor de ISS da prefeitura antes de emitir a primeira nota.",
      teste,
    );
  }
  if (c?.emissorNacional === true) {
    if (recusa) {
      return aviso(
        "perigo",
        "O governo recusou uma nota desta empresa (E0039)",
        `${naCidade} usa o Emissor Nacional, mas ${recusa.charAt(0).toLowerCase()}${recusa.slice(1)}: a prefeitura pode ter bloqueado esta empresa ou marcado uma data de início mais adiante.`,
        "Confira com o setor de ISS da prefeitura o cadastro desta empresa no Emissor Nacional.",
        teste,
      );
    }
    return aviso(
      "sucesso",
      `${naCidade} usa o Emissor Nacional`,
      c.todasHabilitadas ? "As empresas com endereço na cidade já podem emitir pelo portal." : null,
      teste,
    );
  }

  if (e.consulta.tipo === "nao_encontrado") {
    return aviso(
      recusa ? "perigo" : "alerta",
      `${e.municipio ?? "A cidade"} não aparece no Emissor Nacional`,
      "O governo não encontrou a configuração dessa cidade no Sistema Nacional da NFS-e. Confira se o município emissor está certo; se estiver, as notas saem pelo sistema da prefeitura.",
      recusa ? `${recusa}.` : null,
      teste,
    );
  }

  // Sem a resposta da prefeitura (consulta falhou, desligada ou sem certificado): vale o que o portal já viu
  const motivoConsulta =
    e.consulta.tipo === "erro"
      ? `Não foi possível consultar a prefeitura agora: ${e.consulta.motivo.charAt(0).toLowerCase()}${e.consulta.motivo.slice(1)}`
      : e.consulta.tipo === "ok"
        ? "A resposta da prefeitura veio sem os dados esperados."
        : null;
  if (recusa) {
    return aviso(
      "perigo",
      "A prefeitura não liberou esta empresa no Emissor Nacional",
      `${recusa}: ${e.municipio ?? "a cidade"} usa o sistema próprio da prefeitura ou ainda não autorizou esta empresa.`,
      outras ? `${outras} Então a cidade usa o Emissor Nacional: o mais provável é que a prefeitura autorize empresa por empresa e esta ainda não esteja autorizada.` : null,
      pedirAutorizacao,
      motivoConsulta,
    );
  }
  if (e.consulta.tipo === "desligada") {
    return aviso("info", "Consulta à prefeitura desligada neste ambiente", "Na demonstração, o portal não consulta o Emissor Nacional.");
  }
  if (motivoConsulta) {
    return aviso("info", "Não deu para confirmar com a prefeitura", motivoConsulta, "A consulta é feita de novo sempre que esta tela é aberta.");
  }
  return null;
}
