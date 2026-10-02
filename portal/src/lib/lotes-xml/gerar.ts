import "server-only";
import ExcelJS from "exceljs";
import { Zip, ZipDeflate, strToU8 } from "fflate";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { ContextoTarefa, Job } from "@/lib/jobs/executor";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { ROTULO_TIPO_LOTE, TIPOS_LOTE, nomeArquivoLote, type ParteLote } from "./rotulos";

/**
 * Tarefa "gerar_lote_xml" da fila: monta o ZIP com os XML de um mês.
 *  1. Na primeira execução, o banco escolhe os arquivos (preparar_lote_xml).
 *  2. Cada execução lê os arquivos guardados, em ordem, e grava uma parte do
 *     ZIP; se o tempo ou o tamanho acabar, a próxima parte fica para uma nova
 *     tarefa.
 *  3. A última parte leva a planilha com a relação das notas e o LEIA-ME; o
 *     lote fica pronto por 7 dias e quem pediu é avisado.
 */

const TEMPO_MAXIMO_MS = 30_000;
// Reserva para gravar a parte (planilha, envio ao armazenamento e banco)
const FOLGA_MS = 8_000;
const TEMPO_MINIMO_MS = 8_000;
const MAX_BYTES_PARTE = 30 * 1024 * 1024;
const MAX_ARQUIVOS_PARTE = 20_000;
const PAGINA = 1000;
const SIMULTANEOS = 10;

interface Lote {
  id: string;
  empresa_id: string;
  competencia: string;
  tipos: string[];
  situacao: string;
  partes: ParteLote[];
  total_arquivos: number | null;
  total_bytes: number | null;
  resumo: Resumo | null;
  criado_em: string;
  empresa: { razao_social: string; nome_fantasia: string | null; documento: string | null } | null;
}

interface Resumo {
  arquivos: number;
  por_tipo: Record<string, number>;
  valor_notas: number | string;
  resumos_sem_xml: { chave: string; emitente: string | null; emitente_documento: string | null; data: string | null; valor: number | string | null }[];
}

interface DadosItem {
  tipo?: string;
  numero?: string | null;
  serie?: string | null;
  chave?: string | null;
  data?: string | null;
  emitente_documento?: string | null;
  emitente?: string | null;
  destinatario_documento?: string | null;
  destinatario?: string | null;
  valor?: number | string | null;
  situacao?: string;
}

interface Item {
  ordem: number;
  caminho: string | null;
  arquivo: string;
}

async function carregar(admin: ClienteAdmin, id: string): Promise<Lote | null> {
  const { data, error } = await admin
    .from("xml_lotes")
    .select("id, empresa_id, competencia, tipos, situacao, partes, total_arquivos, total_bytes, resumo, criado_em, empresa:empresas(razao_social, nome_fantasia, documento)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar o lote: ${error.message}`);
  return data as unknown as Lote | null;
}

/** ZIP montado em memória (as partes têm no máximo ~30 MB). */
class ZipEmMemoria {
  private pedacos: Uint8Array[] = [];
  private erro: Error | null = null;
  private usados = new Set<string>();
  private zip: Zip;
  bytes = 0;

  constructor() {
    this.zip = new Zip((err, dado) => {
      if (err) this.erro = err;
      else {
        this.pedacos.push(dado);
        this.bytes += dado.length;
      }
    });
  }

  adicionar(nome: string, conteudo: Uint8Array) {
    let final = nome;
    for (let n = 2; this.usados.has(final.toLowerCase()); n++) final = nome.replace(/(\.[^./]+)?$/, ` (${n})$1`);
    this.usados.add(final.toLowerCase());
    const entrada = new ZipDeflate(final, { level: 6 });
    this.zip.add(entrada);
    entrada.push(conteudo, true);
    if (this.erro) throw this.erro;
  }

  finalizar(): Uint8Array {
    this.zip.end();
    if (this.erro) throw this.erro;
    const saida = new Uint8Array(this.bytes);
    let pos = 0;
    for (const p of this.pedacos) {
      saida.set(p, pos);
      pos += p.length;
    }
    return saida;
  }
}

type Leitura = { ok: true; bytes: Uint8Array } | { ok: false; temporario: boolean };

async function baixar(admin: ClienteAdmin, caminho: string | null): Promise<Leitura> {
  if (!caminho) return { ok: false, temporario: false };
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data, error } = await admin.storage.from("documentos").download(caminho);
    if (data) return { ok: true, bytes: new Uint8Array(await data.arrayBuffer()) };
    const codigo = String((error as { statusCode?: string } | null)?.statusCode ?? "");
    if (codigo === "404" || /not.?found/i.test(error?.message ?? "")) return { ok: false, temporario: false };
    await new Promise((r) => setTimeout(r, 300 * (tentativa + 1)));
  }
  return { ok: false, temporario: true };
}

async function todosOsItens(admin: ClienteAdmin, loteId: string) {
  const itens: { ordem: number; arquivo: string; dados: DadosItem; parte: number | null }[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("xml_lote_itens")
      .select("ordem, arquivo, dados, parte")
      .eq("lote_id", loteId)
      .order("ordem")
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao carregar a relação do lote: ${error.message}`);
    itens.push(...((data ?? []) as unknown as typeof itens));
    if (!data || data.length < PAGINA) return itens;
  }
}

const nomeEmpresa = (l: Lote) => l.empresa?.nome_fantasia || l.empresa?.razao_social || "Empresa";

async function planilha(lote: Lote, itens: Awaited<ReturnType<typeof todosOsItens>>, geradoEm: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal Guarese's ON";
  wb.created = new Date();
  const ws = wb.addWorksheet("Notas");
  ws.addRow([`XML das notas — ${formatarCompetencia(lote.competencia)}`]).font = { bold: true, size: 14, color: { argb: "FF4A2C1D" } };
  ws.addRow([`${lote.empresa?.razao_social ?? nomeEmpresa(lote)}${lote.empresa?.documento ? ` — ${formatarDocumento(lote.empresa.documento)}` : ""}`]);
  ws.addRow([`Gerado em ${geradoEm} (horário de Brasília) pelo Portal Guarese's ON`]).font = { size: 9, italic: true };
  ws.addRow([]);
  const colunas = ["Tipo", "Número", "Série", "Chave de acesso", "Emissão", "CNPJ/CPF do emitente", "Emitente", "CNPJ/CPF do destinatário", "Destinatário", "Valor", "Situação", "Arquivo no ZIP", "Parte"];
  const titulo = ws.addRow(colunas);
  titulo.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4A2C1D" } };
  });
  [20, 10, 6, 48, 11, 20, 36, 20, 36, 14, 18, 60, 7].forEach((l, i) => (ws.getColumn(i + 1).width = l));
  ws.views = [{ state: "frozen", ySplit: 5 }];
  for (const it of itens) {
    const d = it.dados;
    const linha = ws.addRow([
      d.tipo ?? "",
      d.numero ?? "",
      d.serie ?? "",
      d.chave ?? "",
      d.data ?? "",
      d.emitente_documento ? formatarDocumento(d.emitente_documento) : "",
      d.emitente ?? "",
      d.destinatario_documento ? formatarDocumento(d.destinatario_documento) : "",
      d.destinatario ?? "",
      d.valor === null || d.valor === undefined ? null : dec(d.valor).toNumber(),
      d.situacao ?? "",
      it.parte === 0 ? "não incluído (arquivo indisponível)" : it.arquivo,
      it.parte || null,
    ]);
    linha.getCell(10).numFmt = '"R$" #,##0.00';
  }
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: colunas.length } };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function leiaMe(
  lote: Lote,
  opcoes: { numero: number; final: boolean; geradoEm: string; itens?: Awaited<ReturnType<typeof todosOsItens>>; totalPartes?: number },
) {
  const l: string[] = [];
  const tipos = TIPOS_LOTE.every((t) => lote.tipos.includes(t))
    ? "todos (NF-e de entrada e de saída, NFC-e, CT-e, NFS-e e eventos)"
    : TIPOS_LOTE.filter((t) => lote.tipos.includes(t))
        .map((t) => ROTULO_TIPO_LOTE[t])
        .join(", ");
  l.push("XML das notas fiscais - Portal Guarese's ON", "");
  l.push(`Empresa: ${lote.empresa?.razao_social ?? nomeEmpresa(lote)}${lote.empresa?.documento ? ` (${formatarDocumento(lote.empresa.documento)})` : ""}`);
  l.push(`Mês de emissão: ${formatarCompetencia(lote.competencia)}`);
  l.push(`Tipos: ${tipos}`);
  l.push(`Gerado em: ${opcoes.geradoEm} (horário de Brasília)`, "");
  if (!opcoes.final || !opcoes.itens) {
    l.push(`Esta é a parte ${opcoes.numero} do lote. O resumo e a planilha com a relação das notas estão na última parte.`);
    return strToU8(`\uFEFF${l.join("\r\n")}\r\n`);
  }
  const itens = opcoes.itens;
  const total = opcoes.totalPartes ?? opcoes.numero;
  const incluidos = itens.filter((i) => i.parte && i.parte > 0);
  const porTipo = new Map<string, number>();
  for (const i of incluidos) porTipo.set(i.dados.tipo ?? "Outros", (porTipo.get(i.dados.tipo ?? "Outros") ?? 0) + 1);
  l.push("Conteúdo:");
  for (const [tipo, n] of porTipo) l.push(`  ${tipo}: ${n} ${n === 1 ? "arquivo" : "arquivos"}`);
  l.push(`  Total: ${incluidos.length} ${incluidos.length === 1 ? "arquivo" : "arquivos"}${total > 1 ? ` em ${total} partes (esta é a parte ${opcoes.numero} de ${total})` : ""}`);
  const valor = itens
    .filter((i) => i.dados.valor !== null && i.dados.valor !== undefined && i.dados.situacao !== "cancelada" && !String(i.dados.tipo ?? "").startsWith("Evento"))
    .reduce((t, i) => t.plus(dec(i.dados.valor ?? 0)), dec(0));
  l.push(`  Valor das notas (sem as canceladas): ${formatarMoeda(valor)}`, "");
  l.push('A planilha "Relacao das notas.xlsx" lista cada nota: número, chave de acesso, emitente, destinatário, valor, situação e o arquivo no ZIP.');
  l.push("Notas canceladas continuam na pasta do tipo; o cancelamento fica na pasta Eventos (quando o evento foi recebido).");
  const resumos = lote.resumo?.resumos_sem_xml ?? [];
  if (resumos.length) {
    l.push("", `NF-e recebidas só em resumo (a SEFAZ ainda não entregou o XML completo): ${resumos.length}`);
    for (const r of resumos.slice(0, 500)) {
      l.push(`  - ${r.data ?? ""} | ${r.emitente ?? "—"}${r.emitente_documento ? ` (${formatarDocumento(r.emitente_documento)})` : ""} | ${r.valor != null ? formatarMoeda(r.valor) : "—"} | chave ${r.chave}`);
    }
    if (resumos.length > 500) l.push(`  ... e mais ${resumos.length - 500}.`);
  }
  const falhas = itens.filter((i) => i.parte === 0);
  if (falhas.length) {
    l.push("", `Arquivos que não puderam ser incluídos (indisponíveis no armazenamento): ${falhas.length}`);
    for (const f of falhas.slice(0, 500)) l.push(`  - ${f.arquivo}`);
  }
  l.push("", "Os XML são cópias exatas dos arquivos guardados no portal, sem nenhuma alteração.");
  return strToU8(`\uFEFF${l.join("\r\n")}\r\n`);
}

async function adiar(admin: ClienteAdmin, lote: Lote) {
  await admin.from("jobs").insert({
    tipo: "gerar_lote_xml",
    payload: { lote_id: lote.id },
    empresa_id: lote.empresa_id,
    chave_idempotencia: `lote:${lote.id}:adiado:${Date.now()}`,
    prioridade: 60,
    executar_apos: new Date(Date.now() + 60_000).toISOString(),
  });
}

async function concluir(admin: ClienteAdmin, lote: Lote, partes: ParteLote[]) {
  const nomeadas = partes
    .sort((a, b) => a.numero - b.numero)
    .map((p) => ({ ...p, nome: nomeArquivoLote(nomeEmpresa(lote), lote.competencia, p.numero, partes.length) }));
  const { error } = await admin.rpc("concluir_lote_xml", {
    p_lote_id: lote.id,
    p_situacao: "pronto",
    p_partes: nomeadas as never,
  });
  if (error) throw new Error(`Falha ao concluir o lote: ${error.message}`);
}

/** Só para os testes automáticos (partes pequenas). */
export interface OpcoesTesteLote {
  maxArquivosParte?: number;
}

async function gerar(admin: ClienteAdmin, loteId: string, job: Job, contexto?: ContextoTarefa, teste: OpcoesTesteLote = {}) {
  const maxArquivos = teste.maxArquivosParte ?? MAX_ARQUIVOS_PARTE;
  let lote = await carregar(admin, loteId);
  if (!lote) return { ignorado: "lote não encontrado" };
  if (lote.situacao !== "pendente" && lote.situacao !== "gerando") return { ignorado: `lote ${lote.situacao}` };

  const inicio = Date.now();
  const limite = Math.min(inicio + TEMPO_MAXIMO_MS, (contexto?.prazo ?? Number.POSITIVE_INFINITY) - FOLGA_MS);
  if (limite - inicio < TEMPO_MINIMO_MS) {
    await adiar(admin, lote);
    return { adiado: true };
  }

  // 1. Escolha dos arquivos
  if (lote.situacao === "pendente") {
    const { error } = await admin.rpc("preparar_lote_xml", { p_lote_id: lote.id });
    if (error) throw new Error(`Falha ao preparar o lote: ${error.message}`);
    lote = (await carregar(admin, loteId))!;
  }
  if (!lote.total_arquivos) {
    const { error } = await admin.rpc("concluir_lote_xml", { p_lote_id: lote.id, p_situacao: "vazio" });
    if (error) throw new Error(`Falha ao concluir o lote: ${error.message}`);
    return { vazio: true };
  }
  const { count: restantes, error: erroRestantes } = await admin
    .from("xml_lote_itens")
    .select("ordem", { count: "exact", head: true })
    .eq("lote_id", lote.id)
    .is("parte", null);
  if (erroRestantes) throw new Error(`Falha ao consultar o lote: ${erroRestantes.message}`);
  if (!restantes && lote.partes.length) {
    // A última parte já foi gravada (a conclusão tinha falhado)
    await concluir(admin, lote, lote.partes);
    return { concluido: true, partes: lote.partes.length };
  }

  // 2. Leitura dos arquivos e montagem da parte
  const numero = lote.partes.length + 1;
  const zip = new ZipEmMemoria();
  const falhos: number[] = [];
  let incluidos = 0;
  let temporarios = 0;
  let ultima = 0;
  let acabou = false;
  paginas: for (;;) {
    const { data: pagina, error } = await admin
      .from("xml_lote_itens")
      .select("ordem, caminho, arquivo")
      .eq("lote_id", lote.id)
      .is("parte", null)
      .gt("ordem", ultima)
      .order("ordem")
      .limit(PAGINA);
    if (error) throw new Error(`Falha ao carregar os arquivos do lote: ${error.message}`);
    const itens = (pagina ?? []) as Item[];
    if (!itens.length) {
      acabou = true;
      break;
    }
    for (let i = 0; i < itens.length; i += Math.min(SIMULTANEOS, maxArquivos)) {
      const algumLido = incluidos + falhos.length > 0;
      if (algumLido && (Date.now() > limite || zip.bytes > MAX_BYTES_PARTE || incluidos >= maxArquivos)) break paginas;
      const grupo = itens.slice(i, i + Math.min(SIMULTANEOS, maxArquivos));
      const lidos = await Promise.all(grupo.map((it) => baixar(admin, it.caminho)));
      grupo.forEach((it, k) => {
        const r = lidos[k];
        if (r.ok) {
          zip.adicionar(it.arquivo, r.bytes);
          incluidos++;
        } else {
          if (r.temporario) temporarios++;
          falhos.push(it.ordem);
        }
        ultima = it.ordem;
      });
      // Falha passageira do armazenamento: tenta de novo mais tarde (nas últimas tentativas, segue sem o arquivo)
      if (temporarios > 0 && job.tentativas < 3) throw new Error("Falha temporária ao ler arquivos no armazenamento. Nova tentativa em instantes.");
    }
    if (itens.length < PAGINA) {
      acabou = true;
      break;
    }
  }
  if (!acabou) {
    const { count } = await admin
      .from("xml_lote_itens")
      .select("ordem", { count: "exact", head: true })
      .eq("lote_id", lote.id)
      .is("parte", null)
      .gt("ordem", ultima);
    acabou = !count;
  }

  // 3. Última parte: relação das notas e LEIA-ME
  const geradoEm = formatarDataHora(new Date().toISOString());
  if (acabou) {
    const falhosSet = new Set(falhos);
    const itens = (await todosOsItens(admin, lote.id)).map((i) =>
      i.parte === null && i.ordem <= ultima ? { ...i, parte: falhosSet.has(i.ordem) ? 0 : numero } : i,
    );
    zip.adicionar("LEIA-ME.txt", leiaMe(lote, { numero, final: true, geradoEm, itens, totalPartes: numero }));
    zip.adicionar("Relacao das notas.xlsx", await planilha(lote, itens, geradoEm));
  } else {
    zip.adicionar("LEIA-ME.txt", leiaMe(lote, { numero, final: false, geradoEm }));
  }
  const conteudo = zip.finalizar();

  // 4. Gravação
  const caminho = `${lote.empresa_id}/lotes-xml/${lote.id}/parte-${numero}.zip`;
  const { error: erroEnvio } = await admin.storage.from("documentos").upload(caminho, conteudo, { contentType: "application/zip", upsert: true });
  if (erroEnvio) throw new Error(`Falha ao gravar a parte ${numero} do lote: ${erroEnvio.message}`);
  const parte: ParteLote = { numero, caminho, nome: `parte-${numero}.zip`, arquivos: incluidos, bytes: conteudo.length };
  const { error: erroParte } = await admin.rpc("registrar_parte_lote_xml", {
    p_lote_id: lote.id,
    p_parte: parte as never,
    p_ate_ordem: ultima,
    p_falhos: falhos,
  });
  if (erroParte) throw new Error(`Falha ao registrar a parte ${numero}: ${erroParte.message}`);

  if (acabou) {
    await concluir(admin, lote, [...lote.partes.filter((p) => p.numero !== numero), parte]);
    return { concluido: true, partes: numero, arquivos: incluidos, falhos: falhos.length };
  }
  // Próxima parte em uma nova tarefa
  const { error: erroJob } = await admin.from("jobs").insert({
    tipo: "gerar_lote_xml",
    payload: { lote_id: lote.id },
    empresa_id: lote.empresa_id,
    chave_idempotencia: `lote:${lote.id}:${numero + 1}`,
    prioridade: 60,
  });
  if (erroJob && !/duplicate|unique/i.test(erroJob.message)) throw new Error(`Falha ao agendar a próxima parte: ${erroJob.message}`);
  return { parte: numero, arquivos: incluidos, falhos: falhos.length };
}

export async function gerarLoteXml(admin: ClienteAdmin, job: Job, contexto?: ContextoTarefa, teste?: OpcoesTesteLote) {
  const loteId = (job.payload as { lote_id?: string } | null)?.lote_id;
  if (!loteId) return { ignorado: "tarefa sem lote" };
  try {
    return await gerar(admin, loteId, job, contexto, teste);
  } catch (e) {
    // Última tentativa: o lote fica com erro e quem pediu é avisado
    if (job.tentativas >= job.max_tentativas) {
      const mensagem = e instanceof Error ? e.message : String(e);
      await admin.rpc("concluir_lote_xml", { p_lote_id: loteId, p_situacao: "erro", p_erro: mensagem.slice(0, 900) });
    }
    throw e;
  }
}
