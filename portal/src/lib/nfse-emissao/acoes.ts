"use server";

import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { somenteDigitos, validarCnpj, validarCpf } from "@/lib/formatos";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { ErroConsultaCnpj, consultarCnpjReceita } from "@/lib/empresas/receita";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// As telas da emissão são dinâmicas e os formulários atualizam a página depois
// de mostrar a mensagem: as ações não revalidam.

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

async function contexto(empresaId: string, permissao: "nfse.emitir" | "nfse.configurar") {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode(permissao) ? ctx : null;
}

export interface TomadorReceita {
  nome: string;
  email: string | null;
  endereco: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; codigo_municipio: string | null; municipio: string | null; uf: string | null; cep: string | null };
}

/** Dados do tomador (CNPJ) nos dados abertos da Receita, para preencher o pedido. */
export async function buscarTomador(empresaId: string, cnpj: string): Promise<ResultadoAcao<TomadorReceita>> {
  const ctx = await contexto(empresaId, "nfse.emitir");
  if (!ctx) return falha("Sem permissão para emitir notas desta empresa.");
  try {
    const r = await consultarCnpjReceita(cnpj);
    return sucesso("Dados do tomador preenchidos pela Receita. Confira.", {
      nome: r.razaoSocial,
      email: r.email,
      endereco: {
        logradouro: r.endereco.logradouro,
        numero: r.endereco.numero,
        complemento: r.endereco.complemento,
        bairro: r.endereco.bairro,
        codigo_municipio: r.endereco.codigoIbge,
        municipio: r.endereco.municipio,
        uf: r.endereco.uf,
        cep: r.endereco.cep,
      },
    });
  } catch (e) {
    return falha(e instanceof ErroConsultaCnpj ? e.message : "Não foi possível consultar a Receita agora. Preencha os dados do tomador à mão.");
  }
}

/** Busca na Receita as atividades (CNAE principal e secundários) da empresa e guarda com o cadastro. */
export async function buscarAtividades(empresaId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfse.configurar");
  if (!ctx) return falha("Somente a equipe do escritório busca as atividades da empresa.");
  const { data: emp } = await ctx.supabase.from("empresas").select("documento, tipo_pessoa").eq("id", empresaId).maybeSingle();
  if (!emp || emp.tipo_pessoa !== "PJ") return falha("A busca das atividades é para empresas (CNPJ).");
  try {
    const r = await consultarCnpjReceita(emp.documento);
    const { error } = await ctx.supabase.from("empresas").update({ dados_receita: r as never, dados_receita_em: r.consultadoEm }).eq("id", empresaId);
    if (error) return falha(mensagemErro(error));
    const n = (r.cnaePrincipal ? 1 : 0) + r.cnaesSecundarios.length;
    return sucesso(n ? `${n} atividade(s) encontrada(s) na Receita.` : "A Receita não informou atividades para este CNPJ.");
  } catch (e) {
    return falha(e instanceof ErroConsultaCnpj ? e.message : "Não foi possível consultar a Receita agora. Tente de novo em alguns minutos.");
  }
}

/** Pede (e emite na hora) a nota de serviço. */
export async function pedirNota(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao<{ id?: string; repetida?: boolean }>> {
  const ctx = await contexto(empresaId, "nfse.emitir");
  if (!ctx) return falha("Sem permissão para emitir notas desta empresa.");
  const erros: Record<string, string[]> = {};
  const servico = texto(fd, "servico_id");
  if (!UUID.test(servico)) erros.servico_id = ["Escolha o serviço."];
  const valor = lerValorBR(texto(fd, "valor"));
  if (!valor || valor.lte(0)) erros.valor = ["Informe o valor do serviço."];
  const descricao = texto(fd, "descricao");
  if (descricao.length < 3) erros.descricao = ["Descreva o serviço prestado."];
  if (descricao.length > 1000) erros.descricao = ["A descrição pode ter até 1.000 caracteres."];
  const tipo = texto(fd, "tomador_tipo");
  if (!["cnpj", "cpf", "nao_identificado"].includes(tipo)) erros.tomador_tipo = ["Escolha para quem é a nota."];
  const documento = somenteDigitos(texto(fd, "tomador_documento"));
  const nome = texto(fd, "tomador_nome");
  const email = texto(fd, "tomador_email").toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erros.tomador_email = ["E-mail inválido."];
  let endereco: Record<string, string | null> | null = null;
  if (tipo === "cnpj") {
    if (!validarCnpj(documento)) erros.tomador_documento = ["CNPJ inválido."];
    if (nome.length < 2) erros.tomador_nome = ["Informe o nome (razão social) do tomador."];
    endereco = {
      logradouro: texto(fd, "end_logradouro") || null,
      numero: texto(fd, "end_numero") || null,
      complemento: texto(fd, "end_complemento") || null,
      bairro: texto(fd, "end_bairro") || null,
      codigo_municipio: somenteDigitos(texto(fd, "end_codigo_municipio")) || null,
      municipio: texto(fd, "end_municipio") || null,
      uf: texto(fd, "end_uf").toUpperCase() || null,
      cep: somenteDigitos(texto(fd, "end_cep")) || null,
    };
    if (!endereco.logradouro) erros.end_logradouro = ["Informe o endereço do tomador."];
    if (!endereco.cep || endereco.cep.length !== 8) erros.end_cep = ["CEP com 8 números."];
    if (!endereco.codigo_municipio || endereco.codigo_municipio.length !== 7) erros.end_codigo_municipio = ["Busque o CNPJ na Receita para trazer o município."];
  } else if (tipo === "cpf") {
    if (!validarCpf(documento)) erros.tomador_documento = ["CPF inválido."];
    if (nome.length < 2) erros.tomador_nome = ["Informe o nome do tomador."];
  }
  const competencia = texto(fd, "competencia");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(competencia)) erros.competencia = ["Informe a data da prestação."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  // Local da prestação: município da empresa (padrão), do tomador ou outro código IBGE conferido
  let local = texto(fd, "local_prestacao");
  if (local === "tomador") local = endereco?.codigo_municipio ?? "";
  if (local && local !== "empresa") {
    const { data: m } = await ctx.supabase.from("municipios").select("ibge").eq("ibge", somenteDigitos(local)).maybeSingle();
    if (!m) return falha("Revise os campos destacados.", { local_prestacao: ["Município do local da prestação não encontrado."] });
    local = m.ibge;
  }

  const { data, error } = await ctx.supabase.rpc("nfse_pedir", {
    p_empresa_id: empresaId,
    p_dados: {
      servico_id: servico,
      valor: valor!.toFixed(2),
      descricao,
      competencia,
      local_prestacao: local === "empresa" ? null : local || null,
      iss_retido: fd.get("iss_retido") === "on",
      tomador_tipo: tipo,
      tomador_documento: tipo === "nao_identificado" ? null : documento,
      tomador_nome: tipo === "nao_identificado" ? null : nome,
      tomador_email: email || null,
      tomador_telefone: somenteDigitos(texto(fd, "tomador_telefone")) || null,
      tomador_endereco: endereco,
      informacoes_complementares: texto(fd, "informacoes_complementares") || null,
      confirmar_repetida: fd.get("confirmar_repetida") === "on",
    } as never,
  });
  if (error) {
    if (error.code === "P0002") return { ok: false, mensagem: error.message, dados: { repetida: true } };
    return falha(mensagemErro(error));
  }
  processarFilaDepois({ tipos: ["emitir_nfse"], limite: 5 });
  return sucesso("Nota enviada ao Emissor Nacional.", { id: (data as { id: string }).id });
}

export async function tentarDeNovo(empresaId: string, id: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfse.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão para emitir notas desta empresa.");
  const { error } = await ctx.supabase.rpc("nfse_tentar_de_novo", { p_id: id });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["emitir_nfse"], limite: 5 });
  return sucesso("Nota enviada de novo ao Emissor Nacional.");
}

export async function cancelarNota(empresaId: string, id: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfse.emitir");
  if (!ctx || !UUID.test(id)) return falha("Sem permissão para emitir notas desta empresa.");
  const motivo = Number(texto(fd, "motivo"));
  const justificativa = texto(fd, "justificativa");
  if (![1, 2, 9].includes(motivo)) return falha("Escolha o motivo.", { motivo: ["Escolha o motivo."] });
  if (justificativa.length < 15 || justificativa.length > 255) return falha("Explique o motivo.", { justificativa: ["Explique em 15 a 255 caracteres."] });
  const { error } = await ctx.supabase.rpc("nfse_cancelar", { p_id: id, p_motivo: motivo, p_justificativa: justificativa });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["cancelar_nfse"], limite: 5 });
  return sucesso("Pedido de cancelamento enviado ao Emissor Nacional.");
}

// -----------------------------------------------------------------------------
// Escritório: configuração e serviços
// -----------------------------------------------------------------------------

function percentual(fd: FormData, nome: string, max: number): number | null | "erro" {
  const t = texto(fd, nome).replace("%", "");
  if (!t) return null;
  const v = lerValorBR(t);
  if (!v || v.lt(0) || v.gt(max)) return "erro";
  return Number(v.toDecimalPlaces(2).toFixed(2));
}

export async function salvarConfiguracao(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfse.configurar");
  if (!ctx) return falha("Somente a equipe do escritório configura a emissão.");
  const erros: Record<string, string[]> = {};
  const municipio = somenteDigitos(texto(fd, "codigo_municipio"));
  if (municipio && municipio.length !== 7) erros.codigo_municipio = ["Código IBGE com 7 números."];
  const serie = Number(texto(fd, "serie") || "1");
  if (!Number.isInteger(serie) || serie < 1 || serie > 49999) erros.serie = ["Série de 1 a 49999 (faixa do aplicativo próprio)."];
  const proximo = (nome: string) => {
    const n = Number(texto(fd, nome) || "1");
    if (!Number.isInteger(n) || n < 1) erros[nome] = ["Número inteiro a partir de 1."];
    return n;
  };
  const pHom = proximo("proximo_numero_homologacao");
  const pProd = proximo("proximo_numero_producao");
  const sn = percentual(fd, "percentual_tributos_sn", 99.99);
  const fed = percentual(fd, "percentual_tributos_federais", 100);
  const mun = percentual(fd, "percentual_tributos_municipais", 100);
  const aliq = percentual(fd, "aliquota_iss_retencao", 5);
  if (sn === "erro") erros.percentual_tributos_sn = ["Percentual entre 0 e 99,99."];
  if (fed === "erro") erros.percentual_tributos_federais = ["Percentual entre 0 e 100."];
  if (mun === "erro") erros.percentual_tributos_municipais = ["Percentual entre 0 e 100."];
  if (aliq === "erro" || aliq === 0) erros.aliquota_iss_retencao = ["Alíquota entre 0,01 e 5."];
  const retencao = fd.get("iss_retencao_permitida") === "on";
  if (retencao && aliq === null) erros.aliquota_iss_retencao = ["Informe a alíquota do ISS retido."];
  if (municipio) {
    const { data: m } = await ctx.supabase.from("municipios").select("ibge").eq("ibge", municipio).maybeSingle();
    if (!m) erros.codigo_municipio = ["Município não encontrado na tabela do IBGE."];
  }
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.rpc("nfse_configurar", {
    p_empresa_id: empresaId,
    p_dados: {
      ativa: fd.get("ativa") === "on",
      ambiente: texto(fd, "ambiente") === "producao" ? "producao" : "homologacao",
      codigo_municipio: municipio || null,
      inscricao_municipal: texto(fd, "inscricao_municipal") || null,
      regime_apuracao_sn: Number(texto(fd, "regime_apuracao_sn") || "1"),
      regime_especial: Number(texto(fd, "regime_especial") || "0"),
      serie,
      proximo_numero_homologacao: pHom,
      proximo_numero_producao: pProd,
      percentual_tributos_sn: sn,
      percentual_tributos_federais: fed,
      percentual_tributos_municipais: mun,
      iss_retencao_permitida: retencao,
      aliquota_iss_retencao: aliq,
      enviar_email_tomador: fd.get("enviar_email_tomador") === "on",
      autorizacao_texto: texto(fd, "autorizacao_texto") || null,
    } as never,
  });
  if (error) {
    const msg = mensagemErro(error);
    // A autorização fica no fim do formulário: aponta o campo
    if (/autorizou o portal/.test(msg)) {
      return falha("Para ligar a emissão, preencha a “Autorização do cliente”, no fim do formulário.", {
        autorizacao_texto: ["Escreva como o cliente autorizou (ex.: e-mail do sócio de 20/10/2026, contrato assinado)."],
      });
    }
    return falha(msg);
  }
  return sucesso("Configuração da emissão salva.");
}

export async function salvarServico(empresaId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId, "nfse.configurar");
  if (!ctx) return falha("Somente a equipe do escritório cadastra os serviços.");
  const id = texto(fd, "id");
  const erros: Record<string, string[]> = {};
  const nome = texto(fd, "nome");
  const nacional = somenteDigitos(texto(fd, "codigo_tributacao_nacional"));
  const municipal = somenteDigitos(texto(fd, "codigo_tributacao_municipal"));
  const nbs = somenteDigitos(texto(fd, "codigo_nbs"));
  const cnae = texto(fd, "cnae");
  if (nome.length < 2) erros.nome = ["Dê um nome ao serviço."];
  if (nacional.length !== 6) erros.codigo_tributacao_nacional = ["Escolha o serviço na lista nacional."];
  if (cnae && !/^\d{4}-\d\/\d{2}$/.test(cnae)) erros.cnae = ["Atividade inválida."];
  if (municipal && (municipal.length !== 3 || municipal === "000")) erros.codigo_tributacao_municipal = ["Código com 3 números (diferente de 000)."];
  if (nbs && nbs.length !== 9) erros.codigo_nbs = ["Código NBS com 9 números."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);
  const { error } = await ctx.supabase.rpc("nfse_servico_salvar", {
    p_empresa_id: empresaId,
    p_id: UUID.test(id) ? id : (null as never),
    p_dados: {
      nome,
      codigo_tributacao_nacional: nacional,
      codigo_tributacao_municipal: municipal || null,
      codigo_nbs: nbs || null,
      descricao_padrao: texto(fd, "descricao_padrao") || null,
      ativo: fd.get("ativo") !== "off",
      cnae: cnae || null,
    } as never,
  });
  if (error) return falha(mensagemErro(error));
  return sucesso(UUID.test(id) ? "Serviço atualizado." : "Serviço cadastrado.");
}
