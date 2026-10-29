import "server-only";
import type { Column, Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { carregarPdfMake } from "@/lib/relatorios/pdf";
import { nomeArquivo } from "@/lib/relatorios/cabecalho";
import { logoDoCliente, type ImagemEmbutida } from "@/lib/marca/logos-relatorio";
import { formatarCep, formatarCpf, formatarData, formatarDataHora, formatarDocumento, formatarTelefone, nomeMes } from "@/lib/formatos";
import type { ContextoClinica } from "./contexto";
import { DOSES, ESPECIES_DOCUMENTO, PORTES, SEXOS, TIPOS_ATENDIMENTO, TIPOS_RECEITA, USOS_RECEITA, VIAS, diaLocal, horaLocal, idadeAnimal } from "./rotulos";

/**
 * Documentos da clínica veterinária em PDF (Res. CFMV nº 1.321/2020): receitas
 * nas vias de cada tipo, atestados, termos de consentimento, carteira de
 * vacinação e cópia do prontuário. Levam só a identidade da clínica (logo,
 * razão social, CNPJ, registro no CRMV, endereço e contatos), sem a marca do
 * escritório nem propaganda (art. 3º, § 1º). Os dados são lidos com as regras
 * de acesso de quem pediu.
 */

type Supa = ContextoClinica["supabase"];

export interface ArquivoPdf {
  arquivo: Buffer;
  nome: string;
}

const COR = { titulo: "#0f5f5a", linha: "#b9d4d1", fundo: "#eef5f4", cinza: "#5f5f5f", texto: "#222222", alerta: "#b91c1c" };
const LARGURA_UTIL = 595.28 - 80;

// ------------------------------------------------------------------ identidade

export interface IdentidadeClinica {
  nome: string;
  razao: string;
  documento: string;
  /** "CNPJ" ou "CPF" (produtor ou profissional autônomo). */
  rotuloDocumento: string;
  registroCrmv: string | null;
  endereco: string | null;
  contatos: string[];
  /** Cidade dos documentos ("Porto Nacional/TO"). */
  cidade: string;
  logo: ImagemEmbutida | null;
}

type EnderecoPartes = { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };

/** Endereço numa linha ("Rua X, 10 — Centro — Porto Nacional/TO — CEP 77500-000"). */
function linhaEndereco(e: EnderecoPartes) {
  return [[e.logradouro, e.numero].filter(Boolean).join(", "), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join("/"), e.cep ? `CEP ${formatarCep(e.cep)}` : null]
    .filter(Boolean)
    .join(" — ");
}

export async function carregarIdentidadeClinica(supabase: Supa, empresaId: string): Promise<IdentidadeClinica> {
  const [{ data: e }, { data: cfg }] = await Promise.all([
    supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, documento, logo_path, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase.from("vet_config").select("nome_clinica, registro_crmv, telefone, email, endereco, cidade_documentos").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  const telefone = cfg?.telefone ?? e?.telefone ?? null;
  const email = cfg?.email ?? e?.email ?? null;
  const doc = (e?.documento ?? "").replace(/\D/g, "");
  return {
    nome: cfg?.nome_clinica ?? e?.nome_fantasia ?? e?.razao_social ?? "Clínica veterinária",
    razao: e?.razao_social ?? "",
    documento: doc ? formatarDocumento(doc) : "",
    rotuloDocumento: doc.length === 11 ? "CPF" : "CNPJ",
    registroCrmv: cfg?.registro_crmv ?? null,
    endereco: cfg?.endereco ?? (e ? linhaEndereco(e) || null : null),
    contatos: [telefone ? `Tel. ${formatarTelefone(telefone)}` : null, email].filter((c): c is string => Boolean(c)),
    cidade: cfg?.cidade_documentos ?? ([e?.cidade, e?.uf].filter(Boolean).join("/") || ""),
    logo: await logoDoCliente(supabase, e?.logo_path),
  };
}

// ------------------------------------------------------------------ dados comuns

interface Paciente {
  id: string;
  nome: string;
  especie: string;
  especie_outra: string | null;
  raca: string | null;
  sexo: string;
  castrado: boolean;
  nascimento: string | null;
  nascimento_estimado: boolean;
  pelagem: string | null;
  porte: string | null;
  peso_kg: number | string | null;
  microchip: string | null;
  sinais_particulares: string | null;
  alergias: string | null;
  obito_em: string | null;
  obito_causa: string | null;
}

interface Tutor extends EnderecoPartes {
  nome: string;
  cpf: string | null;
  telefone: string | null;
  email: string | null;
}

interface Veterinario {
  nome: string;
  crmv: string;
  crmv_uf: string;
  cadastro_mapa?: string | null;
  telefone?: string | null;
  email?: string | null;
}

const CAMPOS_PACIENTE =
  "id, nome, especie, especie_outra, raca, sexo, castrado, nascimento, nascimento_estimado, pelagem, porte, peso_kg, microchip, sinais_particulares, alergias, obito_em, obito_causa";
const CAMPOS_TUTOR = "nome, cpf, telefone, email, cep, logradouro, numero, complemento, bairro, cidade, uf";
const CAMPOS_VETERINARIO = "nome, crmv, crmv_uf, cadastro_mapa, telefone, email";

/** "AAAA-MM-DD" ou instante → "29 de outubro de 2026" (no fuso da clínica). */
export function dataPorExtenso(data: string) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : diaLocal(data);
  const [a, m, d] = dia.split("-").map(Number);
  return `${d} de ${nomeMes(m)} de ${a}`;
}

function numeroBr(v: number | string | null | undefined) {
  return v === null || v === undefined || v === "" ? "" : String(Number(v)).replace(".", ",");
}

function crmv(v: Veterinario) {
  return `CRMV-${v.crmv_uf} nº ${v.crmv}`;
}

function rotuloValor(rotulo: string, valor: string | null | undefined): Content | null {
  if (!valor) return null;
  return { text: [{ text: `${rotulo}: `, bold: true }, valor], margin: [0, 0, 0, 1.5] };
}

function linhas(...partes: (Content | null)[]): Content[] {
  return partes.filter((p): p is Content => p !== null);
}

function especie(p: Paciente) {
  return p.especie === "outra" ? (p.especie_outra ?? "Outra") : (ESPECIES_DOCUMENTO[p.especie] ?? p.especie);
}

/** Identificação do animal e do responsável (art. 3º, incisos V e VI). */
function blocoIdentificacao(p: Paciente, t: Tutor, referencia?: string): Content {
  const idade = idadeAnimal(p.nascimento, referencia ? new Date(referencia) : new Date());
  const animal = linhas(
    { text: "ANIMAL", bold: true, fontSize: 7.5, color: COR.titulo, margin: [0, 0, 0, 3] },
    rotuloValor("Nome", p.nome),
    rotuloValor("Espécie", [especie(p), p.raca ? `raça ${p.raca}` : "raça não definida"].join(" · ")),
    rotuloValor("Sexo", `${SEXOS[p.sexo] ?? p.sexo}${p.castrado ? (p.sexo === "femea" ? " (castrada)" : " (castrado)") : ""}`),
    rotuloValor("Idade", idade ? `${idade}${p.nascimento_estimado ? " (presumida)" : ""}` : "não informada"),
    rotuloValor("Pelagem", p.pelagem),
    rotuloValor("Porte e peso", [p.porte ? PORTES[p.porte] : null, p.peso_kg ? `${numeroBr(p.peso_kg)} kg` : null].filter(Boolean).join(" · ") || null),
    rotuloValor("Microchip", p.microchip),
    rotuloValor("Sinais particulares", p.sinais_particulares),
  );
  const endereco = linhaEndereco(t);
  const responsavel = linhas(
    { text: "RESPONSÁVEL (TUTOR)", bold: true, fontSize: 7.5, color: COR.titulo, margin: [0, 0, 0, 3] },
    rotuloValor("Nome", t.nome),
    rotuloValor("CPF", t.cpf ? formatarCpf(t.cpf) : "não informado"),
    rotuloValor("Endereço", endereco || "não informado"),
    rotuloValor("Contato", [t.telefone ? formatarTelefone(t.telefone) : null, t.email].filter(Boolean).join(" · ") || null),
  );
  return {
    table: { widths: ["*", "*"], body: [[{ stack: animal }, { stack: responsavel }]] },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => COR.linha,
      vLineColor: () => COR.linha,
      fillColor: () => COR.fundo,
      paddingLeft: () => 7,
      paddingRight: () => 7,
      paddingTop: () => 6,
      paddingBottom: () => 5,
    },
    fontSize: 8.5,
    margin: [0, 6, 0, 8],
  };
}

function secao(texto: string): Content {
  return { text: texto, bold: true, fontSize: 10, color: COR.titulo, margin: [0, 10, 0, 4] };
}

function paragrafo(texto: string | null | undefined, extra?: Partial<{ margin: [number, number, number, number]; bold: boolean; fontSize: number }>): Content | null {
  if (!texto) return null;
  return { text: texto, alignment: "justify", margin: [0, 0, 0, 5], ...extra };
}

/** Linhas em branco para completar à mão. */
function linhasEmBranco(n: number): Content {
  return {
    stack: Array.from({ length: n }, () => ({ canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA_UTIL, y2: 0, lineWidth: 0.4, lineColor: "#9a9a9a" }], margin: [0, 15, 0, 0] }) as Content),
    margin: [0, 0, 0, 6],
  };
}

function localEData(id: IdentidadeClinica, quando: string): Content {
  return { text: `${id.cidade ? `${id.cidade}, ` : ""}${dataPorExtenso(quando)}.`, margin: [0, 14, 0, 0] };
}

function linhaAssinatura(rotulos: string[], largura = 230): Column {
  return {
    width: largura,
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: largura, y2: 0, lineWidth: 0.6, lineColor: "#333333" }], margin: [0, 34, 0, 3] },
      ...rotulos.map((r, i) => ({ text: r, alignment: "center", fontSize: i === 0 ? 8.5 : 7.5, bold: i === 0, color: i === 0 ? COR.texto : COR.cinza }) as Content),
    ],
  };
}

function assinaturaVeterinario(v: Veterinario): Content {
  return {
    columns: [{ width: "*", text: "" }, linhaAssinatura([v.nome, `Médico(a)-veterinário(a) · ${crmv(v)}`, "assinatura e carimbo"], 260), { width: "*", text: "" }],
    unbreakable: true,
  };
}

function assinaturasTermo(t: Tutor, v: Veterinario, testemunhas = false): Content {
  return {
    unbreakable: true,
    stack: [
      {
        columns: [
          linhaAssinatura([t.nome, `Responsável pelo animal${t.cpf ? ` · CPF ${formatarCpf(t.cpf)}` : ""}`]),
          { width: "*", text: "" },
          linhaAssinatura([v.nome, `Médico(a)-veterinário(a) · ${crmv(v)}`]),
        ],
      },
      ...(testemunhas
        ? [
            {
              columns: [linhaAssinatura(["Testemunha 1", "nome e CPF"]), { width: "*", text: "" }, linhaAssinatura(["Testemunha 2", "nome e CPF"])],
            } as Content,
          ]
        : []),
    ],
  };
}

function rotuloVia(texto: string): Content {
  return {
    columns: [
      { width: "*", text: "" },
      {
        width: "auto",
        table: { body: [[{ text: texto.toUpperCase(), bold: true, fontSize: 7.5, color: "#ffffff", characterSpacing: 0.4 }]] },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => COR.titulo, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 2, paddingBottom: () => 2 },
      },
    ],
    margin: [0, 0, 0, 6],
  };
}

function titulo(texto: string, subtitulo?: string | null): Content[] {
  return linhas(
    { text: texto, fontSize: 14, bold: true, color: COR.titulo, alignment: "center" },
    subtitulo ? { text: subtitulo, fontSize: 8.5, color: COR.cinza, alignment: "center", margin: [0, 2, 0, 0] } : null,
  );
}

function caixa(tituloCaixa: string, conteudo: Content[]): Content {
  return {
    unbreakable: true,
    margin: [0, 10, 0, 0],
    table: {
      widths: ["*"],
      body: [[{ stack: [{ text: tituloCaixa.toUpperCase(), bold: true, fontSize: 7.5, color: COR.titulo, margin: [0, 0, 0, 4] }, ...conteudo] }]],
    },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => "#8a8a8a",
      vLineColor: () => "#8a8a8a",
      hLineStyle: () => ({ dash: { length: 3, space: 2 } }),
      vLineStyle: () => ({ dash: { length: 3, space: 2 } }),
      paddingLeft: () => 8,
      paddingRight: () => 8,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    fontSize: 8.5,
  };
}

function campoPreencher(rotulo: string): Content {
  return { text: `${rotulo}: ____________________________________________`, margin: [0, 4, 0, 0], color: COR.cinza };
}

// ------------------------------------------------------------------ PDF base

function cabecalho(id: IdentidadeClinica): Content {
  const linhaEstabelecimento = [id.razao, id.documento ? `${id.rotuloDocumento} ${id.documento}` : null, id.registroCrmv ? `Registro no CRMV ${id.registroCrmv}` : null]
    .filter(Boolean)
    .join("  ·  ");
  const dados: Content[] = linhas(
    { text: id.nome, bold: true, fontSize: id.logo ? 12 : 15, color: COR.titulo },
    linhaEstabelecimento ? { text: linhaEstabelecimento, fontSize: 7.5, color: COR.cinza } : null,
    id.endereco ? { text: id.endereco, fontSize: 7.5, color: COR.cinza } : null,
    id.contatos.length ? { text: id.contatos.join("  ·  "), fontSize: 7.5, color: COR.cinza } : null,
  );
  return {
    margin: [40, 22, 40, 0],
    stack: [
      {
        columns: [
          ...(id.logo ? [{ width: "auto", stack: [{ image: id.logo.dados, fit: [130, 52] }] } as Content] : []),
          { width: "*", stack: dados, alignment: id.logo ? "right" : "left", margin: [0, id.logo ? 2 : 6, 0, 0] },
        ],
        columnGap: 14,
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA_UTIL, y2: 0, lineWidth: 1.6, lineColor: COR.titulo }], margin: [0, 7, 0, 0] },
    ],
  };
}

async function gerarPdf(id: IdentidadeClinica, opcoes: { titulo: string; rodape: string; numerarPaginas?: boolean }, vias: Content[][]): Promise<Buffer> {
  const pm = await carregarPdfMake();
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 104, 40, 50],
    info: { title: `${opcoes.titulo} — ${id.nome}`, author: id.nome, creator: id.nome },
    header: () => cabecalho(id),
    footer: (pagina: number, total: number) => ({
      margin: [40, 12, 40, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: LARGURA_UTIL, y2: 0, lineWidth: 0.4, lineColor: COR.linha }] },
        {
          margin: [0, 4, 0, 0],
          columns: [
            { text: opcoes.rodape, fontSize: 7, color: COR.cinza },
            ...(opcoes.numerarPaginas ? [{ text: `Página ${pagina} de ${total}`, alignment: "right", fontSize: 7, color: COR.cinza, width: 80 } as Content] : []),
          ],
        },
      ],
    }),
    defaultStyle: { font: "Roboto", fontSize: 9, lineHeight: 1.2, color: COR.texto },
    content: vias.map((via, i) => ({ stack: via, ...(i ? { pageBreak: "before" as const } : {}) })),
  };
  return pm.createPdf(doc).getBuffer();
}

// ------------------------------------------------------------------ receitas

interface ItemReceita {
  ordem: number;
  medicamento: string;
  concentracao: string | null;
  forma_farmaceutica: string | null;
  quantidade: string;
  via: string;
  posologia: string;
  duracao: string | null;
  uso: string;
}

/** Vias de cada receita, na ordem em que saem impressas. */
export const VIAS_RECEITA: Record<string, string[]> = {
  simples: ["1ª via — responsável pelo animal", "2ª via — arquivo do médico-veterinário"],
  // RDC Anvisa nº 471/2021: a 1ª via fica retida na farmácia e a 2ª volta ao paciente
  antimicrobiano: ["1ª via — retenção da farmácia", "2ª via — responsável pelo animal"],
  magistral_controlada: ["1ª via — responsável pelo animal", "2ª via — retenção da farmácia de manipulação", "3ª via — arquivo do médico-veterinário"],
};

function prescricao(itens: ItemReceita[]): Content[] {
  return itens.map((it, i) => ({
    unbreakable: true,
    margin: [0, i ? 6 : 2, 0, 0],
    columns: [
      { width: 16, text: `${i + 1}.`, bold: true },
      {
        width: "*",
        stack: linhas(
          { text: [{ text: it.medicamento, bold: true }, it.concentracao ? ` ${it.concentracao}` : "", it.forma_farmaceutica ? ` — ${it.forma_farmaceutica}` : ""] },
          { text: it.posologia, margin: [0, 1, 0, 0] },
          { text: [`Uso ${(VIAS[it.via] ?? it.via).toLowerCase()}`, it.duracao ? ` · duração: ${it.duracao}` : "", ` · ${USOS_RECEITA[it.uso] ?? it.uso}`].join(""), fontSize: 7.5, color: COR.cinza },
        ),
      },
      { width: 110, text: it.quantidade, alignment: "right", bold: true },
    ],
    columnGap: 6,
  }));
}

export async function pdfReceita(supabase: Supa, empresaId: string, receitaId: string): Promise<ArquivoPdf | "cancelada" | null> {
  const [{ data: r }, { data: itens }, id] = await Promise.all([
    supabase
      .from("vet_receitas")
      .select(`*, paciente:vet_pacientes(${CAMPOS_PACIENTE}), tutor:vet_tutores(${CAMPOS_TUTOR}), veterinario:vet_veterinarios(${CAMPOS_VETERINARIO})`)
      .eq("id", receitaId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase.from("vet_receita_itens").select("ordem, medicamento, concentracao, forma_farmaceutica, quantidade, via, posologia, duracao, uso").eq("receita_id", receitaId).order("ordem"),
    carregarIdentidadeClinica(supabase, empresaId),
  ]);
  if (!r) return null;
  if (r.cancelada_em) return "cancelada";
  const p = r.paciente as unknown as Paciente;
  const t = r.tutor as unknown as Tutor;
  const v = r.veterinario as unknown as Veterinario;
  const lista = (itens ?? []) as ItemReceita[];
  const magistral = r.tipo === "magistral_controlada";
  const antimicrobiano = r.tipo === "antimicrobiano";
  const nomeDoc = magistral ? "Receita de controle especial — manipulado veterinário" : antimicrobiano ? "Receituário — antimicrobiano" : "Receituário";

  const via = (rotulo: string): Content[] =>
    linhas(
      rotuloVia(rotulo),
      ...titulo(nomeDoc, "USO VETERINÁRIO"),
      {
        text: [
          `Receita nº ${r.numero} · emitida em ${formatarData(r.emitida_em)}`,
          magistral ? ` · Numeração: ${r.numero_controle}` : "",
          magistral && v.cadastro_mapa ? ` · Cadastro no MAPA: ${v.cadastro_mapa}` : "",
        ].join(""),
        alignment: "center",
        fontSize: 8,
        color: COR.cinza,
        margin: [0, 3, 0, 0],
      },
      blocoIdentificacao(p, t, r.emitida_em),
      secao("Prescrição"),
      ...prescricao(lista),
      r.observacoes ? secao("Orientações") : null,
      paragrafo(r.observacoes),
      r.validade || r.uso_continuo
        ? {
            text: [r.uso_continuo ? { text: "USO CONTÍNUO. ", bold: true } : "", r.validade ? `Válida até ${formatarData(r.validade)}.` : ""],
            margin: [0, 8, 0, 0],
          }
        : null,
      localEData(id, r.emitida_em),
      assinaturaVeterinario(v),
      antimicrobiano
        ? caixa("Para uso da farmácia (RDC Anvisa nº 471/2021)", [
            campoPreencher("Data da dispensação"),
            campoPreencher("Quantidade dispensada"),
            campoPreencher("Lote do medicamento"),
            campoPreencher("Farmacêutico(a) e CRF"),
            campoPreencher("Rubrica"),
          ])
        : null,
      magistral
        ? caixa("Identificação do comprador e da farmácia de manipulação", [
            campoPreencher("Comprador — nome"),
            campoPreencher("Documento de identidade e telefone"),
            campoPreencher("Farmácia de manipulação — nome e CNPJ"),
            campoPreencher("Data do aviamento e nº da fórmula"),
            campoPreencher("Farmacêutico(a), CRF e assinatura"),
          ])
        : null,
    );

  const arquivo = await gerarPdf(id, { titulo: `${nomeDoc} nº ${r.numero}`, rodape: `${TIPOS_RECEITA[r.tipo]?.rotulo ?? "Receita"} nº ${r.numero} · ${p.nome} · ${t.nome}` }, (VIAS_RECEITA[r.tipo] ?? VIAS_RECEITA.simples).map(via));
  return { arquivo, nome: nomeArquivo(["receita", String(r.numero), p.nome], "pdf") };
}

// ------------------------------------------------------------------ atestados e termos

const TITULOS_DOCUMENTO: Record<string, string> = {
  atestado_sanitario: "Atestado sanitário",
  atestado_vacinacao: "Atestado de vacinação",
  atestado_obito: "Atestado de óbito",
  termo_exames: "Termo de consentimento livre e esclarecido para realização de exames",
  termo_procedimento_risco: "Termo de consentimento livre e esclarecido para procedimento terapêutico de risco",
  termo_cirurgia: "Termo de consentimento livre e esclarecido para procedimento cirúrgico",
  termo_anestesia: "Termo de consentimento livre e esclarecido para anestesia",
  termo_internacao: "Termo de consentimento livre e esclarecido para internação e tratamento",
  termo_eutanasia: "Termo de consentimento livre e esclarecido para eutanásia",
  termo_retirada_corpo: "Termo de responsabilidade para retirada do corpo do animal",
  termo_retirada_sem_alta: "Termo de responsabilidade para retirada do animal sem alta médica",
  termo_doacao_corpo: "Termo de consentimento para doação do corpo do animal para ensino e pesquisa",
};

/** O que o responsável declara ter sido esclarecido em cada termo de consentimento. */
const OBJETO_TERMO: Record<string, { esclarecido: string; autorizo: string; rotulo: string }> = {
  termo_exames: { esclarecido: "os exames indicados, a sua finalidade e os riscos envolvidos", autorizo: "a realização dos exames", rotulo: "Exame(s)" },
  termo_procedimento_risco: {
    esclarecido: "o procedimento terapêutico indicado, que pode causar perda de função, deformidade ou óbito do animal, e as alternativas de tratamento",
    autorizo: "a realização do procedimento",
    rotulo: "Procedimento",
  },
  termo_cirurgia: {
    esclarecido: "o procedimento cirúrgico indicado, os seus riscos, os cuidados pós-operatórios e as alternativas de tratamento",
    autorizo: "a realização da cirurgia",
    rotulo: "Cirurgia",
  },
  termo_anestesia: { esclarecido: "o procedimento anestésico ou de sedação indicado e os seus riscos", autorizo: "a realização da anestesia ou sedação", rotulo: "Anestesia ou sedação" },
  termo_internacao: {
    esclarecido: "a necessidade de internação, o tratamento indicado, os seus riscos e os cuidados envolvidos",
    autorizo: "a internação e o tratamento",
    rotulo: "Internação e tratamento",
  },
  termo_eutanasia: {
    esclarecido: "o quadro clínico do animal, os motivos da indicação, o método a ser empregado e a irreversibilidade do procedimento",
    autorizo: "a realização da eutanásia",
    rotulo: "Motivo e método",
  },
};

const VIAS_DOCUMENTO = ["1ª via — responsável pelo animal", "2ª via — arquivo do estabelecimento"];

interface Vacinacao {
  id: string;
  vacina_nome: string;
  fabricante: string | null;
  partida: string | null;
  fabricacao: string | null;
  validade: string | null;
  dose: string;
  aplicada_em: string;
  origem: string;
  veterinario_externo: string | null;
  proxima_dose_em: string | null;
  veterinario: { nome: string; crmv: string; crmv_uf: string } | null;
}

const CAMPOS_VACINACAO =
  "id, vacina_nome, fabricante, partida, fabricacao, validade, dose, aplicada_em, origem, veterinario_externo, proxima_dose_em, veterinario:vet_veterinarios(nome, crmv, crmv_uf)";

const LAYOUT_TABELA = {
  hLineWidth: (i: number) => (i <= 1 ? 0.8 : 0.4),
  vLineWidth: () => 0,
  hLineColor: () => COR.linha,
  paddingLeft: () => 3,
  paddingRight: () => 3,
  paddingTop: () => 2.5,
  paddingBottom: () => 2.5,
};

function cabecalhoTabela(rotulos: string[]): TableCell[] {
  return rotulos.map((r) => ({ text: r, bold: true, fontSize: 7, color: COR.titulo }));
}

function tabelaVacinas(vacinas: Vacinacao[], opcoes: { comVeterinario: boolean }): Content {
  const cab = ["Aplicada em", "Vacina", "Dose", "Fabricante", "Partida", "Fabricação", "Validade", ...(opcoes.comVeterinario ? ["Médico-veterinário"] : []), "Próxima dose"];
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: opcoes.comVeterinario ? [44, "*", 38, 56, 44, 42, 42, 82, 44] : [48, "*", 44, 72, 56, 50, 50, 50],
      body: [
        cabecalhoTabela(cab),
        ...vacinas.map((x) => [
          formatarData(x.aplicada_em),
          { text: x.vacina_nome, bold: true },
          DOSES[x.dose] ?? x.dose,
          x.fabricante ?? "—",
          x.partida ?? "—",
          x.fabricacao ? formatarData(x.fabricacao) : "—",
          x.validade ? formatarData(x.validade) : "—",
          ...(opcoes.comVeterinario
            ? [
                x.origem === "externa"
                  ? { text: `Registro externo${x.veterinario_externo ? `: ${x.veterinario_externo}` : ""}`, italics: true, color: COR.cinza }
                  : x.veterinario
                    ? `${x.veterinario.nome} (CRMV-${x.veterinario.crmv_uf} ${x.veterinario.crmv})`
                    : "—",
              ]
            : []),
          x.proxima_dose_em ? formatarData(x.proxima_dose_em) : "—",
        ]),
      ],
    },
    layout: LAYOUT_TABELA,
    fontSize: 7.5,
    margin: [0, 2, 0, 6],
  };
}

/** Última dose (não cancelada) de cada vacina, para o atestado sanitário e as próximas doses da carteira. */
function ultimasPorVacina(vacinas: Vacinacao[]) {
  const ultima = new Map<string, Vacinacao>();
  for (const x of [...vacinas].sort((a, b) => a.aplicada_em.localeCompare(b.aplicada_em))) ultima.set(x.vacina_nome.toLowerCase(), x);
  return [...ultima.values()];
}

function declaracaoResponsavel(t: Tutor) {
  const endereco = linhaEndereco(t);
  return `Eu, ${t.nome}${t.cpf ? `, CPF ${formatarCpf(t.cpf)}` : ""}${endereco ? `, residente em ${endereco}` : ""}, responsável pelo animal identificado acima`;
}

function corpoDocumento(tipo: string, d: Record<string, string>, t: Tutor, v: Veterinario, vacinas: Vacinacao[]): Content[] {
  const ve = `pelo(a) médico(a)-veterinário(a) ${v.nome}, ${crmv(v)}`;
  if (tipo === "atestado_sanitario") {
    const ultimas = ultimasPorVacina(vacinas);
    return linhas(
      paragrafo(`Atesto, para os devidos fins, que examinei nesta data o animal identificado acima e constatei o seguinte estado de saúde: ${d.estado_saude ?? ""}`),
      d.finalidade ? rotuloValor("Finalidade", d.finalidade) : null,
      secao("Imunizações registradas no prontuário"),
      ultimas.length
        ? tabelaVacinas(ultimas, { comVeterinario: true })
        : { text: "Não há vacinas registradas no prontuário deste animal.", color: COR.cinza, margin: [0, 0, 0, 6] },
      { text: "Este atestado se refere às condições do animal na data do exame.", fontSize: 7.5, italics: true, color: COR.cinza },
    );
  }
  if (tipo === "atestado_vacinacao") {
    return linhas(
      paragrafo("Atesto, para os devidos fins, que o animal identificado acima foi vacinado neste estabelecimento, conforme o quadro a seguir:"),
      tabelaVacinas(vacinas, { comVeterinario: true }),
    );
  }
  if (tipo === "atestado_obito") {
    return linhas(
      paragrafo(
        `Atesto que o animal identificado acima veio a óbito em ${formatarData(d.data_hora)}, às ${horaLocal(d.data_hora)}, no local: ${d.local ?? ""}, em ${d.cidade_uf ?? ""}.`,
      ),
      rotuloValor("Provável causa mortis", d.causa),
      rotuloValor("Informações complementares", d.complementares),
      secao("Orientações para a destinação do corpo"),
      paragrafo(d.destinacao),
      { text: "O corpo deve receber destinação sanitária e ambientalmente adequada, conforme a legislação vigente.", fontSize: 7.5, italics: true, color: COR.cinza },
    );
  }
  if (tipo === "termo_retirada_corpo") {
    return linhas(
      paragrafo(
        `${declaracaoResponsavel(t)}, declaro que nesta data retiro o corpo do animal deste estabelecimento e assumo a responsabilidade pela sua destinação, de forma sanitária e ambientalmente adequada, conforme a legislação vigente, tendo recebido as orientações ${ve}.`,
      ),
      rotuloValor("Destinação informada pelo responsável", d.destinacao),
    );
  }
  if (tipo === "termo_retirada_sem_alta") {
    return linhas(
      paragrafo(
        `${declaracaoResponsavel(t)}, declaro que, por minha livre vontade e contra a recomendação ${ve}, retiro nesta data o animal deste estabelecimento sem a alta médica. Fui informado(a) do quadro clínico do animal e dos riscos da retirada, inclusive de agravamento do quadro, de riscos sanitários e de óbito, e assumo a responsabilidade pelas consequências da interrupção do tratamento.`,
      ),
      secao("Quadro do animal e riscos da retirada"),
      paragrafo(d.quadro),
    );
  }
  if (tipo === "termo_doacao_corpo") {
    return linhas(
      paragrafo(
        `${declaracaoResponsavel(t)}, AUTORIZO a doação do corpo do animal à instituição ${d.instituicao ?? ""}, para fins de ensino e pesquisa, sem qualquer ônus ou remuneração, ciente de que o corpo não será devolvido.`,
      ),
    );
  }
  const o = OBJETO_TERMO[tipo];
  return linhas(
    paragrafo(`${declaracaoResponsavel(t)}, declaro que fui esclarecido(a) ${ve}, de forma clara e compreensível, sobre ${o.esclarecido}, e AUTORIZO ${o.autorizo}.`),
    rotuloValor(o.rotulo, d.procedimento),
    rotuloValor(tipo === "termo_eutanasia" ? "Esclarecimentos" : "Riscos explicados", d.riscos),
    rotuloValor("Valor estimado", d.valor_estimado),
    paragrafo(
      tipo === "termo_eutanasia"
        ? "Declaro que a decisão foi tomada de forma livre e consciente, que tive a oportunidade de fazer perguntas e que elas foram respondidas de forma satisfatória."
        : "Declaro estar ciente de que o procedimento envolve riscos, que podem incluir complicações, sequelas e até o óbito do animal, e de que não há garantia de resultado. Tive a oportunidade de fazer perguntas, que foram respondidas de forma satisfatória.",
      { margin: [0, 5, 0, 5] },
    ),
  );
}

export async function pdfDocumento(supabase: Supa, empresaId: string, documentoId: string): Promise<ArquivoPdf | "cancelado" | null> {
  const [{ data: doc }, id] = await Promise.all([
    supabase
      .from("vet_documentos")
      .select(`*, paciente:vet_pacientes(${CAMPOS_PACIENTE}), tutor:vet_tutores(${CAMPOS_TUTOR}), veterinario:vet_veterinarios(${CAMPOS_VETERINARIO})`)
      .eq("id", documentoId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    carregarIdentidadeClinica(supabase, empresaId),
  ]);
  if (!doc) return null;
  if (doc.cancelado_em) return "cancelado";
  const p = doc.paciente as unknown as Paciente;
  const t = doc.tutor as unknown as Tutor;
  const v = doc.veterinario as unknown as Veterinario;
  const dados = (doc.dados ?? {}) as Record<string, unknown>;
  const textos = Object.fromEntries(Object.entries(dados).filter(([, x]) => typeof x === "string")) as Record<string, string>;
  let vacinas: Vacinacao[] = [];
  if (doc.tipo === "atestado_vacinacao" || doc.tipo === "atestado_sanitario") {
    let q = supabase.from("vet_vacinacoes").select(CAMPOS_VACINACAO).eq("empresa_id", empresaId).eq("paciente_id", p.id).is("cancelada_em", null);
    if (doc.tipo === "atestado_vacinacao") q = q.in("id", Array.isArray(dados.vacinacoes) ? (dados.vacinacoes as string[]) : []);
    const { data } = await q.order("aplicada_em");
    vacinas = (data ?? []) as unknown as Vacinacao[];
  }
  const termo = doc.tipo.startsWith("termo_");
  const nomeDoc = TITULOS_DOCUMENTO[doc.tipo] ?? "Documento";
  const vias = doc.tipo === "atestado_sanitario" ? ["Via única"] : VIAS_DOCUMENTO;

  const via = (rotulo: string): Content[] =>
    linhas(
      rotuloVia(rotulo),
      ...titulo(nomeDoc),
      { text: `Documento nº ${doc.numero} · emitido em ${formatarDataHora(doc.emitido_em)}`, alignment: "center", fontSize: 8, color: COR.cinza, margin: [0, 3, 0, 0] },
      blocoIdentificacao(p, t, doc.emitido_em),
      ...corpoDocumento(doc.tipo, textos, t, v, vacinas),
      textos.observacoes_veterinario ? secao("Observações do médico-veterinário") : null,
      paragrafo(textos.observacoes_veterinario),
      termo ? secao("Observações do responsável") : null,
      termo ? (textos.observacoes_responsavel ? paragrafo(textos.observacoes_responsavel) : linhasEmBranco(2)) : null,
      localEData(id, doc.emitido_em),
      termo ? assinaturasTermo(t, v, doc.tipo === "termo_retirada_sem_alta") : assinaturaVeterinario(v),
    );

  const arquivo = await gerarPdf(id, { titulo: `${nomeDoc} nº ${doc.numero}`, rodape: `${nomeDoc} · documento nº ${doc.numero} · ${p.nome} · ${t.nome}` }, vias.map(via));
  return { arquivo, nome: nomeArquivo([doc.tipo.replaceAll("_", "-"), String(doc.numero), p.nome], "pdf") };
}

// ------------------------------------------------------------------ carteira de vacinação

export async function pdfCarteira(supabase: Supa, empresaId: string, pacienteId: string): Promise<ArquivoPdf | null> {
  const [{ data: p }, { data: vacinas }, id] = await Promise.all([
    supabase.from("vet_pacientes").select(`${CAMPOS_PACIENTE}, tutor:vet_tutores(${CAMPOS_TUTOR})`).eq("id", pacienteId).eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("vet_vacinacoes").select(CAMPOS_VACINACAO).eq("empresa_id", empresaId).eq("paciente_id", pacienteId).is("cancelada_em", null).order("aplicada_em"),
    carregarIdentidadeClinica(supabase, empresaId),
  ]);
  if (!p) return null;
  const paciente = p as unknown as Paciente;
  const t = (p as unknown as { tutor: Tutor }).tutor;
  const lista = (vacinas ?? []) as unknown as Vacinacao[];
  const agora = new Date().toISOString();
  const hoje = diaLocal(agora);
  const proximas = ultimasPorVacina(lista)
    .filter((x) => x.proxima_dose_em && !paciente.obito_em)
    .sort((a, b) => (a.proxima_dose_em ?? "").localeCompare(b.proxima_dose_em ?? ""));

  const conteudo: Content[] = linhas(
    ...titulo("Carteira de vacinação", paciente.nome),
    blocoIdentificacao(paciente, t),
    secao("Vacinas aplicadas"),
    lista.length ? tabelaVacinas(lista, { comVeterinario: true }) : { text: "Nenhuma vacina registrada até o momento.", color: COR.cinza },
    proximas.length ? secao("Próximas doses") : null,
    proximas.length
      ? {
          ul: proximas.map((x) => ({
            text: [
              { text: x.vacina_nome, bold: true },
              ` — ${formatarData(x.proxima_dose_em)}`,
              (x.proxima_dose_em ?? "") < hoje ? { text: " (atrasada)", color: COR.alerta, bold: true } : "",
            ],
          })),
          margin: [0, 0, 0, 6],
        }
      : null,
    {
      text: "Extrato do registro de vacinas do prontuário deste estabelecimento. Os registros marcados como externos foram transcritos de carteira anterior e não foram aplicados aqui. Leve esta carteira em cada vacinação.",
      fontSize: 7.5,
      italics: true,
      color: COR.cinza,
      margin: [0, 8, 0, 0],
    },
  );
  const arquivo = await gerarPdf(id, { titulo: `Carteira de vacinação — ${paciente.nome}`, rodape: `Carteira de vacinação · ${paciente.nome} · emitida em ${formatarDataHora(agora)}`, numerarPaginas: true }, [conteudo]);
  return { arquivo, nome: nomeArquivo(["carteira-vacinacao", paciente.nome], "pdf") };
}

// ------------------------------------------------------------------ cópia do prontuário

const CAMPOS_PRONTUARIO: [string, string][] = [
  ["relato", "Relato do responsável"],
  ["anamnese", "Anamnese"],
  ["exame_fisico", "Exame físico"],
  ["diagnostico_presuntivo", "Diagnóstico presuntivo"],
  ["diagnostico_conclusivo", "Diagnóstico conclusivo"],
  ["procedimentos", "Procedimentos"],
  ["tratamento", "Tratamento"],
  ["orientacoes", "Orientações"],
];

type Linha = Record<string, unknown>;

function parametros(a: Linha) {
  return [
    a.peso_kg ? `Peso ${numeroBr(a.peso_kg as number)} kg` : null,
    a.temperatura ? `T ${numeroBr(a.temperatura as number)} °C` : null,
    a.frequencia_cardiaca ? `FC ${a.frequencia_cardiaca} bpm` : null,
    a.frequencia_respiratoria ? `FR ${a.frequencia_respiratoria} mpm` : null,
    a.tpc ? `TPC ${numeroBr(a.tpc as number)} s` : null,
    a.mucosas ? `Mucosas ${a.mucosas}` : null,
    a.hidratacao ? `Hidratação ${a.hidratacao}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Cópia do prontuário (art. 9º): todos os atendimentos em ordem, com os
 * adendos, e as vacinas, receitas, documentos e anexos do animal.
 */
export async function pdfProntuario(supabase: Supa, empresaId: string, pacienteId: string, emitidoPor: string): Promise<ArquivoPdf | null> {
  const [{ data: p }, id] = await Promise.all([
    supabase.from("vet_pacientes").select(`${CAMPOS_PACIENTE}, tutor:vet_tutores(${CAMPOS_TUTOR})`).eq("id", pacienteId).eq("empresa_id", empresaId).maybeSingle(),
    carregarIdentidadeClinica(supabase, empresaId),
  ]);
  if (!p) return null;
  const [{ data: atendimentos }, { data: adendos }, { data: vacinas }, { data: receitas }, { data: itens }, { data: documentos }, { data: anexos }] = await Promise.all([
    supabase.from("vet_atendimentos").select("*, veterinario:vet_veterinarios(nome, crmv, crmv_uf)").eq("empresa_id", empresaId).eq("paciente_id", pacienteId).order("data_hora"),
    supabase
      .from("vet_adendos")
      .select("atendimento_id, texto, created_at, veterinario:vet_veterinarios(nome, crmv, crmv_uf), atendimento:vet_atendimentos!inner(paciente_id)")
      .eq("empresa_id", empresaId)
      .eq("atendimento.paciente_id", pacienteId)
      .order("created_at"),
    supabase.from("vet_vacinacoes").select(`${CAMPOS_VACINACAO}, cancelada_em, cancelada_motivo`).eq("empresa_id", empresaId).eq("paciente_id", pacienteId).order("aplicada_em"),
    supabase
      .from("vet_receitas")
      .select("id, numero, tipo, numero_controle, emitida_em, validade, uso_continuo, observacoes, cancelada_em, cancelada_motivo, atendimento_id, veterinario:vet_veterinarios(nome, crmv, crmv_uf)")
      .eq("empresa_id", empresaId)
      .eq("paciente_id", pacienteId)
      .order("numero"),
    supabase
      .from("vet_receita_itens")
      .select("receita_id, ordem, medicamento, concentracao, forma_farmaceutica, quantidade, via, posologia, duracao, uso, receita:vet_receitas!inner(paciente_id)")
      .eq("empresa_id", empresaId)
      .eq("receita.paciente_id", pacienteId)
      .order("ordem"),
    supabase
      .from("vet_documentos")
      .select("numero, tipo, emitido_em, cancelado_em, cancelado_motivo, veterinario:vet_veterinarios(nome, crmv, crmv_uf)")
      .eq("empresa_id", empresaId)
      .eq("paciente_id", pacienteId)
      .order("numero"),
    supabase
      .from("vet_anexos")
      .select("nome, descricao, created_at, atendimento:vet_atendimentos!inner(numero, paciente_id)")
      .eq("empresa_id", empresaId)
      .eq("atendimento.paciente_id", pacienteId)
      .not("confirmado_em", "is", null)
      .order("created_at"),
  ]);
  const paciente = p as unknown as Paciente;
  const t = (p as unknown as { tutor: Tutor }).tutor;
  const agora = new Date().toISOString();
  const numeroAtendimento = new Map((atendimentos ?? []).map((a) => [a.id, a.numero]));

  const blocosAtendimentos: Content[] = (atendimentos ?? []).map((a) => {
    const vet = a.veterinario as unknown as Veterinario;
    const meus = (adendos ?? []).filter((x) => x.atendimento_id === a.id);
    const situacao = a.status === "cancelado" ? ` — CANCELADO (${a.cancelado_motivo ?? ""})` : a.status === "aberto" ? " — em andamento" : "";
    return {
      margin: [0, 0, 0, 8],
      stack: linhas(
        {
          table: {
            widths: ["*"],
            body: [[{ text: [{ text: `Atendimento nº ${a.numero}`, bold: true }, ` · ${formatarDataHora(a.data_hora)} · ${TIPOS_ATENDIMENTO[a.tipo] ?? a.tipo}${a.local ? ` · ${a.local}` : ""}${situacao}`], color: COR.titulo }]],
          },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => COR.fundo, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 },
        },
        { text: `Médico-veterinário: ${vet.nome} (${crmv(vet)})`, fontSize: 7.5, color: COR.cinza, margin: [0, 2, 0, 3] },
        rotuloValor("Parâmetros", parametros(a as unknown as Linha) || null),
        rotuloValor("Estado geral", a.estado_geral),
        ...CAMPOS_PRONTUARIO.map(([campo, rotulo]) => rotuloValor(rotulo, (a as unknown as Record<string, string | null>)[campo])),
        rotuloValor("Retorno", a.retorno_em ? `${formatarData(a.retorno_em)}${a.retorno_motivo ? ` — ${a.retorno_motivo}` : ""}` : null),
        a.finalizado_em ? { text: `Finalizado em ${formatarDataHora(a.finalizado_em)}.`, fontSize: 7.5, color: COR.cinza } : null,
        ...meus.map((x) => {
          const av = x.veterinario as unknown as Veterinario;
          return {
            margin: [8, 3, 0, 0],
            text: [{ text: `Adendo de ${formatarDataHora(x.created_at)} — ${av.nome} (${crmv(av)}): `, bold: true }, x.texto],
          } as Content;
        }),
      ),
    } as Content;
  });

  const itensPorReceita = new Map<string, ItemReceita[]>();
  for (const it of (itens ?? []) as unknown as (ItemReceita & { receita_id: string })[]) {
    itensPorReceita.set(it.receita_id, [...(itensPorReceita.get(it.receita_id) ?? []), it]);
  }
  const blocosReceitas: Content[] = (receitas ?? []).map((r) => {
    const rv = r.veterinario as unknown as Veterinario;
    return {
      unbreakable: true,
      margin: [0, 0, 0, 6],
      stack: linhas(
        {
          text: [
            { text: `Receita nº ${r.numero}`, bold: true },
            ` · ${TIPOS_RECEITA[r.tipo]?.rotulo ?? r.tipo} · ${formatarData(r.emitida_em)}`,
            r.numero_controle ? ` · numeração ${r.numero_controle}` : "",
            r.atendimento_id && numeroAtendimento.has(r.atendimento_id) ? ` · atendimento nº ${numeroAtendimento.get(r.atendimento_id)}` : "",
            ` · ${rv.nome} (${crmv(rv)})`,
            r.cancelada_em ? { text: ` — CANCELADA (${r.cancelada_motivo ?? ""})`, color: COR.alerta } : "",
          ],
        },
        {
          ul: (itensPorReceita.get(r.id) ?? []).map(
            (it) => `${it.medicamento}${it.concentracao ? ` ${it.concentracao}` : ""} — ${it.quantidade} — ${it.posologia}${it.duracao ? ` (${it.duracao})` : ""}`,
          ),
          fontSize: 8,
          margin: [0, 1, 0, 0],
        },
        r.observacoes ? { text: `Orientações: ${r.observacoes}`, fontSize: 8, margin: [0, 1, 0, 0] } : null,
      ),
    } as Content;
  });

  const listaVacinas = ((vacinas ?? []) as unknown as (Vacinacao & { cancelada_em: string | null; cancelada_motivo: string | null })[]).filter((x) => !x.cancelada_em);
  const canceladas = ((vacinas ?? []) as unknown as (Vacinacao & { cancelada_em: string | null; cancelada_motivo: string | null })[]).filter((x) => x.cancelada_em);

  const conteudo: Content[] = linhas(
    ...titulo("Cópia do prontuário", paciente.nome),
    blocoIdentificacao(paciente, t),
    paciente.alergias ? { text: [{ text: "Alergias e alertas: ", bold: true }, paciente.alergias], color: COR.alerta, margin: [0, 0, 0, 4] } : null,
    paciente.obito_em
      ? { text: [{ text: "Óbito: ", bold: true }, `${formatarDataHora(paciente.obito_em)}${paciente.obito_causa ? ` — ${paciente.obito_causa}` : ""}`], margin: [0, 0, 0, 4] }
      : null,
    secao("Atendimentos"),
    ...(blocosAtendimentos.length ? blocosAtendimentos : [{ text: "Nenhum atendimento registrado.", color: COR.cinza } as Content]),
    secao("Vacinas"),
    listaVacinas.length ? tabelaVacinas(listaVacinas, { comVeterinario: true }) : { text: "Nenhuma vacina registrada.", color: COR.cinza },
    canceladas.length
      ? {
          text: `Registros de vacina cancelados: ${canceladas.map((x) => `${x.vacina_nome} de ${formatarData(x.aplicada_em)} (${x.cancelada_motivo ?? ""})`).join("; ")}.`,
          fontSize: 7.5,
          color: COR.cinza,
        }
      : null,
    secao("Receitas"),
    ...(blocosReceitas.length ? blocosReceitas : [{ text: "Nenhuma receita emitida.", color: COR.cinza } as Content]),
    secao("Atestados e termos"),
    (documentos ?? []).length
      ? {
          ul: (documentos ?? []).map((d) => {
            const dv = d.veterinario as unknown as Veterinario;
            return {
              text: [
                { text: `${TITULOS_DOCUMENTO[d.tipo] ?? d.tipo} nº ${d.numero}`, bold: true },
                ` · ${formatarDataHora(d.emitido_em)} · ${dv.nome} (${crmv(dv)})`,
                d.cancelado_em ? { text: ` — CANCELADO (${d.cancelado_motivo ?? ""})`, color: COR.alerta } : "",
              ],
            };
          }),
          fontSize: 8,
        }
      : { text: "Nenhum atestado ou termo emitido.", color: COR.cinza },
    secao("Exames e arquivos anexados"),
    (anexos ?? []).length
      ? {
          ul: (anexos ?? []).map((x) => {
            const at = x.atendimento as unknown as { numero: number };
            return `${x.nome}${x.descricao ? ` — ${x.descricao}` : ""} · atendimento nº ${at.numero} · ${formatarData(x.created_at)}`;
          }),
          fontSize: 8,
        }
      : { text: "Nenhum arquivo anexado.", color: COR.cinza },
    {
      text: `Cópia fiel dos registros do prontuário eletrônico deste estabelecimento, emitida em ${formatarDataHora(agora)} por ${emitidoPor}. Os arquivos anexados (laudos e exames) são entregues à parte. O prontuário é guardado por no mínimo 5 anos (Res. CFMV nº 1.321/2020, art. 9º).`,
      fontSize: 7.5,
      italics: true,
      color: COR.cinza,
      margin: [0, 12, 0, 0],
    },
  );
  const arquivo = await gerarPdf(id, { titulo: `Prontuário — ${paciente.nome}`, rodape: `Cópia do prontuário · ${paciente.nome} · ${t.nome} · ${formatarDataHora(agora)}`, numerarPaginas: true }, [conteudo]);
  return { arquivo, nome: nomeArquivo(["prontuario", paciente.nome], "pdf") };
}
