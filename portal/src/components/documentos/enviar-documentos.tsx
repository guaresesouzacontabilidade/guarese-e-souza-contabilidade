"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CopyCheck,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { cn, protocolo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta, Progresso } from "@/components/ui/feedback";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatarCompetencia, formatarData, formatarDataHora, formatarTamanho } from "@/lib/formatos";
import { STATUS_DOCUMENTO } from "@/lib/rotulos";
import { combinarSugestoes, extensao, sugerirPorConteudo, sugerirPorNome, type Sugestao } from "@/lib/documentos/sugestao";
import { calcularSha256, enviarParaArmazenamento, lerInicio, nomeFoto } from "@/lib/documentos/envio-navegador";
import { concluirEnvio, iniciarEnvio, type Duplicado } from "@/lib/documentos/acoes";

export interface CategoriaEnvio {
  codigo: string;
  nome: string;
  descricao: string | null;
  extensoes: string[];
}

export interface ItemPendente {
  id: string;
  titulo: string;
  categoria_codigo: string;
  competencia: string; // AAAA-MM-01
  status: string;
  prazo: string;
}

type Etapa = "pronto" | "verificando" | "preparando" | "enviando" | "confirmando" | "concluido" | "duplicado" | "erro";

interface ItemArquivo {
  chave: string;
  arquivo: File;
  nome: string;
  origem: "upload" | "camera";
  categoria: string;
  categoriaSugerida: boolean;
  competencia: string; // AAAA-MM
  competenciaSugerida: boolean;
  sugestao: Sugestao | null;
  itemId: string | null;
  titulo: string;
  vencimento: string;
  valor: string;
  etapa: Etapa;
  progresso: number;
  erro?: string;
  duplicado?: Duplicado;
  forcarDuplicado?: boolean;
  documentoId?: string;
  aposFechamento?: boolean;
  concluidoEm?: string;
}

interface Props {
  empresaId: string;
  documentoEmpresa: string;
  categorias: CategoriaEnvio[];
  itens: ItemPendente[];
  competencias: { valor: string; rotulo: string }[];
  competenciaPadrao: string;
  limiteMb: number;
  itemFixo?: ItemPendente | null;
  /** Tipo de documento já escolhido ao abrir (ex.: vindo da página das maquininhas). */
  categoriaInicial?: string;
  modo?: "cliente" | "escritorio";
  baseDocumentos: string;
}

const PARALELO = 2;
const EM_ANDAMENTO: Etapa[] = ["verificando", "preparando", "enviando", "confirmando"];

function semExtensao(nome: string) {
  return nome.replace(/\.[^.]+$/, "");
}

export function EnviarDocumentos({
  empresaId,
  documentoEmpresa,
  categorias,
  itens,
  competencias,
  competenciaPadrao,
  limiteMb,
  itemFixo,
  categoriaInicial,
  modo = "cliente",
  baseDocumentos,
}: Props) {
  const router = useRouter();
  const [lista, setLista] = useState<ItemArquivo[]>([]);
  const [categoriaPadrao, setCategoriaPadrao] = useState(itemFixo?.categoria_codigo ?? categoriaInicial ?? "");
  const [competencia, setCompetencia] = useState(itemFixo ? itemFixo.competencia.slice(0, 7) : competenciaPadrao);
  const [observacao, setObservacao] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [executando, setExecutando] = useState(false);
  const controles = useRef(new Map<string, AbortController>());
  const listaRef = useRef(lista);
  useEffect(() => {
    listaRef.current = lista;
  }, [lista]);
  const entradaArquivos = useRef<HTMLInputElement>(null);
  const entradaCamera = useRef<HTMLInputElement>(null);

  const porCodigo = useMemo(() => new Map(categorias.map((c) => [c.codigo, c])), [categorias]);
  const aceitas = useMemo(() => [...new Set(categorias.flatMap((c) => c.extensoes))].map((e) => `.${e}`).join(","), [categorias]);
  const categoriaSelecionada = porCodigo.get(categoriaPadrao);

  const atualizar = useCallback((chave: string, mudancas: Partial<ItemArquivo>) => {
    setLista((l) => l.map((i) => (i.chave === chave ? { ...i, ...mudancas } : i)));
  }, []);

  // Evita fechar a página no meio de um envio
  useEffect(() => {
    if (!executando) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [executando]);

  function pendenciasPara(categoria: string, comp: string) {
    return itens.filter(
      (i) => i.categoria_codigo === categoria && i.competencia.slice(0, 7) === comp && !["concluido", "nao_se_aplica"].includes(i.status),
    );
  }

  function itemAutomatico(categoria: string, comp: string) {
    if (itemFixo) return itemFixo.id;
    const c = pendenciasPara(categoria, comp);
    return c.length === 1 ? c[0].id : null;
  }

  async function adicionar(arquivos: FileList | File[], origem: "upload" | "camera") {
    const novos: ItemArquivo[] = [];
    for (const original of Array.from(arquivos)) {
      const nome = origem === "camera" ? nomeFoto(original) : original.name;
      const arquivo = origem === "camera" ? new File([original], nome, { type: original.type || "image/jpeg" }) : original;
      if (listaRef.current.some((i) => i.nome === nome && i.arquivo.size === arquivo.size && i.etapa !== "concluido")) continue;

      let sugestao: Sugestao | null = null;
      const ext = extensao(nome);
      try {
        const porConteudo = ext === "xml" || ext === "ofx" ? sugerirPorConteudo(nome, await lerInicio(arquivo), documentoEmpresa) : null;
        sugestao = modo === "cliente" ? combinarSugestoes(porConteudo, sugerirPorNome(nome)) : null;
        if (sugestao && porConteudo?.competencia) sugestao = { ...sugestao, competencia: porConteudo.competencia };
        // Só sugere categorias que aceitam o formato do arquivo
        if (sugestao?.categoria && !porCodigo.get(sugestao.categoria)?.extensoes.includes(ext)) {
          sugestao = sugestao.competencia ? { ...sugestao, categoria: undefined, motivo: porConteudo?.motivo ?? sugestao.motivo } : null;
        }
      } catch {
        sugestao = null;
      }

      let categoria = categoriaPadrao;
      let categoriaSugerida = false;
      if (!itemFixo && !categoriaPadrao && sugestao?.categoria && porCodigo.has(sugestao.categoria)) {
        categoria = sugestao.categoria;
        categoriaSugerida = true;
      }
      let comp = competencia;
      let competenciaSugerida = false;
      const compValida = sugestao?.competencia && competencias.some((c) => c.valor === sugestao!.competencia);
      // Competência lida do conteúdo (XML/OFX) é aplicada e destacada; a do nome fica como dica.
      if (!itemFixo && compValida && (ext === "xml" || ext === "ofx") && sugestao!.competencia !== comp) {
        comp = sugestao!.competencia!;
        competenciaSugerida = true;
      }
      novos.push({
        chave: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        arquivo,
        nome,
        origem,
        categoria,
        categoriaSugerida,
        competencia: comp,
        competenciaSugerida,
        sugestao,
        itemId: categoria ? itemAutomatico(categoria, comp) : null,
        titulo: modo === "escritorio" ? semExtensao(nome) : "",
        vencimento: "",
        valor: "",
        etapa: "pronto",
        progresso: 0,
      });
    }
    if (novos.length) setLista((l) => [...l, ...novos]);
  }

  function problema(i: ItemArquivo): string | null {
    if (i.arquivo.size === 0) return "Arquivo vazio.";
    if (i.arquivo.size > limiteMb * 1024 * 1024) return `Arquivo maior que o limite de ${limiteMb} MB.`;
    if (!i.categoria) return "Escolha o tipo de documento.";
    const cat = porCodigo.get(i.categoria);
    const ext = extensao(i.nome);
    if (!cat) return "Categoria inválida.";
    if (!ext) return "O arquivo precisa ter extensão (ex.: .pdf, .xml).";
    if (!cat.extensoes.includes(ext)) return `Formato .${ext} não é aceito em “${cat.nome}”. Aceitos: ${cat.extensoes.join(", ")}.`;
    if (!i.competencia) return "Informe a competência.";
    return null;
  }

  async function processar(i: ItemArquivo) {
    const controle = new AbortController();
    controles.current.set(i.chave, controle);
    try {
      atualizar(i.chave, { etapa: "verificando", progresso: 0, erro: undefined });
      const hash = await calcularSha256(i.arquivo, (f) => atualizar(i.chave, { progresso: f }), controle.signal);

      atualizar(i.chave, { etapa: "preparando", progresso: 0 });
      const r = await iniciarEnvio(empresaId, {
        categoria: i.categoria,
        competencia: i.competencia,
        nome: i.nome,
        mime: i.arquivo.type || "application/octet-stream",
        tamanho: i.arquivo.size,
        sha256: hash,
        observacao: observacao.trim() || null,
        itemId: i.itemId,
        origem: i.origem,
        forcarDuplicado: Boolean(i.forcarDuplicado),
        titulo: modo === "escritorio" ? i.titulo.trim() || null : null,
        vencimento: modo === "escritorio" && i.vencimento ? i.vencimento : null,
        valor: modo === "escritorio" && i.valor ? i.valor : null,
      });
      if (!r.ok || !r.dados) throw new Error(r.mensagem ?? "Não foi possível iniciar o envio.");
      if (r.dados.situacao === "duplicado") {
        atualizar(i.chave, { etapa: "duplicado", duplicado: r.dados.duplicado, progresso: 0 });
        return;
      }

      atualizar(i.chave, { etapa: "enviando", progresso: 0, documentoId: r.dados.documentoId });
      await enviarParaArmazenamento(r.dados.url, i.arquivo, (f) => atualizar(i.chave, { progresso: f }), controle.signal);

      atualizar(i.chave, { etapa: "confirmando", progresso: 1 });
      const c = await concluirEnvio(empresaId, r.dados.versaoId);
      if (!c.ok || !c.dados) throw new Error(c.mensagem ?? "O arquivo foi enviado, mas não conseguimos confirmar o recebimento. Tente novamente.");
      atualizar(i.chave, {
        etapa: "concluido",
        documentoId: c.dados.documentoId,
        aposFechamento: c.dados.recebidoAposFechamento,
        concluidoEm: new Date().toISOString(),
      });
    } catch (e) {
      const cancelado = e instanceof DOMException && e.name === "AbortError";
      atualizar(i.chave, { etapa: "erro", erro: cancelado ? "Envio cancelado." : e instanceof Error ? e.message : "Falha no envio." });
    } finally {
      controles.current.delete(i.chave);
    }
  }

  async function enviarTodos(alvos?: string[], ajustes?: Partial<ItemArquivo>) {
    const fila = listaRef.current
      .filter((i) => (alvos ? alvos.includes(i.chave) : i.etapa === "pronto" || i.etapa === "erro"))
      .map((i) => ({ ...i, ...ajustes }));
    const comProblema = fila.filter((i) => problema(i));
    if (comProblema.length) {
      toast.error(`Revise ${comProblema.length} arquivo(s) antes de enviar.`);
      return;
    }
    if (!fila.length) return;
    setExecutando(true);
    let pos = 0;
    const trabalhador = async () => {
      while (pos < fila.length) {
        const atual = fila[pos++];
        const recente = listaRef.current.find((x) => x.chave === atual.chave);
        if (!recente) continue; // removido da lista antes de começar
        await processar({ ...recente, ...ajustes });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALELO, fila.length) }, trabalhador));
    setExecutando(false);
    const final = listaRef.current;
    const ok = final.filter((i) => fila.some((f) => f.chave === i.chave) && i.etapa === "concluido").length;
    const dup = final.filter((i) => i.etapa === "duplicado").length;
    if (ok) toast.success(`${ok} documento(s) recebido(s) com sucesso.`);
    if (dup) toast.warning(`${dup} arquivo(s) já haviam sido enviados. Decida se deseja enviar mesmo assim.`);
    router.refresh();
  }

  function enviarDuplicado(chave: string) {
    atualizar(chave, { forcarDuplicado: true, etapa: "pronto", duplicado: undefined });
    void enviarTodos([chave], { forcarDuplicado: true, etapa: "pronto", duplicado: undefined });
  }

  function remover(chave: string) {
    controles.current.get(chave)?.abort();
    setLista((l) => l.filter((i) => i.chave !== chave));
  }

  function aplicarCategoriaATodos(valor: string) {
    setCategoriaPadrao(valor);
    if (!valor) return;
    setLista((l) =>
      l.map((i) => (i.etapa === "pronto" || i.etapa === "erro" ? { ...i, categoria: valor, categoriaSugerida: false, itemId: itemAutomatico(valor, i.competencia) } : i)),
    );
  }

  function aplicarCompetenciaATodos(valor: string) {
    setCompetencia(valor);
    setLista((l) =>
      l.map((i) =>
        i.etapa === "pronto" || i.etapa === "erro"
          ? { ...i, competencia: valor, competenciaSugerida: false, itemId: i.categoria ? itemAutomatico(i.categoria, valor) : null }
          : i,
      ),
    );
  }

  const pendentes = lista.filter((i) => i.etapa === "pronto" || i.etapa === "erro");
  const concluidos = lista.filter((i) => i.etapa === "concluido");
  const comProblema = pendentes.filter((i) => problema(i));
  const tamanhoTotal = pendentes.reduce((s, i) => s + i.arquivo.size, 0);

  return (
    <div className="space-y-5">
      {itemFixo ? (
        <Alerta tom="info" titulo={`Enviando para a pendência: ${itemFixo.titulo}`}>
          Competência {formatarCompetencia(itemFixo.competencia)} · prazo {formatarData(itemFixo.prazo)}. Os arquivos ficam vinculados a esta pendência e passam pela
          conferência do escritório.
        </Alerta>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>1. Do que se trata?</CardTitle>
          <CardDescription>
            A <strong>competência</strong> é o mês a que o documento se refere (por exemplo, o extrato de setembro), e não a data de envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Competência (mês de referência)" htmlFor="competencia" obrigatorio>
            <Select id="competencia" value={competencia} onChange={(e) => aplicarCompetenciaATodos(e.target.value)} disabled={Boolean(itemFixo) || executando}>
              {competencias.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo
            rotulo="Tipo de documento"
            htmlFor="categoria"
            ajuda={
              categoriaSelecionada
                ? `${categoriaSelecionada.descricao ?? ""} Formatos: ${categoriaSelecionada.extensoes.join(", ")}.`
                : modo === "cliente"
                  ? "Deixe em “identificar pelo arquivo” para receber uma sugestão por arquivo — você confere antes de enviar."
                  : undefined
            }
          >
            <Select id="categoria" value={categoriaPadrao} onChange={(e) => aplicarCategoriaATodos(e.target.value)} disabled={Boolean(itemFixo) || executando}>
              <option value="">{modo === "cliente" ? "Identificar pelo arquivo (sugestão)" : "Selecione..."}</option>
              {categorias.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Arquivos</CardTitle>
          <CardDescription>
            Você pode enviar vários arquivos de uma vez, inclusive ZIP com XMLs. Limite de {limiteMb} MB por arquivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastando(false);
              if (e.dataTransfer.files?.length) void adicionar(e.dataTransfer.files, "upload");
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              arrastando ? "border-primary bg-bege/60" : "border-bege-forte bg-muted/30",
            )}
          >
            <UploadCloud className="size-10 text-primary" aria-hidden="true" />
            <div>
              <p className="font-medium text-titulo">Arraste os arquivos para cá</p>
              <p className="text-sm text-muted-foreground">ou escolha no seu computador ou celular</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => entradaArquivos.current?.click()} disabled={executando}>
                <FileUp /> Escolher arquivos
              </Button>
              <Button variante="contorno" onClick={() => entradaCamera.current?.click()} disabled={executando}>
                <Camera /> Tirar foto
              </Button>
            </div>
            <input
              ref={entradaArquivos}
              type="file"
              multiple
              accept={aceitas}
              className="sr-only"
              aria-label="Escolher arquivos"
              onChange={(e) => {
                if (e.target.files?.length) void adicionar(e.target.files, "upload");
                e.target.value = "";
              }}
            />
            <input
              ref={entradaCamera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Tirar foto do documento"
              onChange={(e) => {
                if (e.target.files?.length) void adicionar(e.target.files, "camera");
                e.target.value = "";
              }}
            />
          </div>

          {lista.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Arquivos selecionados">
              {lista.map((i) => (
                <LinhaArquivo
                  key={i.chave}
                  item={i}
                  categorias={categorias}
                  competencias={competencias}
                  problema={i.etapa === "pronto" || i.etapa === "erro" ? problema(i) : null}
                  pendencias={i.categoria ? pendenciasPara(i.categoria, i.competencia) : []}
                  bloqueado={Boolean(itemFixo) || executando}
                  modo={modo}
                  baseDocumentos={baseDocumentos}
                  categoriaNome={porCodigo.get(i.categoria)?.nome}
                  aoMudar={(m) => {
                    const novo = { ...i, ...m };
                    if ("categoria" in m || "competencia" in m) novo.itemId = novo.categoria ? itemAutomatico(novo.categoria, novo.competencia) : null;
                    atualizar(i.chave, novo);
                  }}
                  aoRemover={() => remover(i.chave)}
                  aoEnviarDuplicado={() => enviarDuplicado(i.chave)}
                  aoTentarNovamente={() => enviarTodos([i.chave])}
                />
              ))}
            </ul>
          ) : null}

          {modo === "cliente" ? (
            <Campo rotulo="Observação para o escritório (opcional)" htmlFor="observacao" ajuda="Vale para todos os arquivos deste envio.">
              <Textarea id="observacao" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={2000} disabled={executando} placeholder="Ex.: este extrato inclui o período de 15/09 a 30/09." />
            </Campo>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {pendentes.length ? `${pendentes.length} arquivo(s) para enviar · ${formatarTamanho(tamanhoTotal)}` : "Nenhum arquivo aguardando envio."}
              {comProblema.length ? <span className="ml-1 text-perigo">· {comProblema.length} precisa(m) de ajuste</span> : null}
            </p>
            <Button tamanho="lg" onClick={() => enviarTodos()} disabled={executando || !pendentes.length || comProblema.length > 0}>
              {executando ? <Loader2 className="animate-spin" /> : <UploadCloud />}
              {executando ? "Enviando..." : `Enviar ${pendentes.length || ""} arquivo(s)`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {concluidos.length ? (
        <Alerta
          tom="sucesso"
          titulo={`${concluidos.length} documento(s) recebido(s) pelo escritório`}
          acao={
            <Button asChild variante="contorno" tamanho="sm">
              <Link href={baseDocumentos}>Ver documentos</Link>
            </Button>
          }
        >
          Recebimento registrado em {formatarDataHora(concluidos.at(-1)?.concluidoEm)}. Os arquivos agora passam pela conferência da equipe; você será avisado se algo
          precisar de correção.
          {concluidos.some((c) => c.aposFechamento) ? " Atenção: algum documento é de um mês já fechado e será avaliado pela equipe." : ""}
        </Alerta>
      ) : null}
    </div>
  );
}

const ROTULO_ETAPA: Record<Etapa, string> = {
  pronto: "Pronto para enviar",
  verificando: "Verificando o arquivo...",
  preparando: "Preparando...",
  enviando: "Enviando...",
  confirmando: "Confirmando recebimento...",
  concluido: "Recebido",
  duplicado: "Já enviado antes",
  erro: "Não enviado",
};

function LinhaArquivo({
  item: i,
  categorias,
  competencias,
  problema,
  pendencias,
  bloqueado,
  modo,
  baseDocumentos,
  categoriaNome,
  aoMudar,
  aoRemover,
  aoEnviarDuplicado,
  aoTentarNovamente,
}: {
  item: ItemArquivo;
  categorias: CategoriaEnvio[];
  competencias: { valor: string; rotulo: string }[];
  problema: string | null;
  pendencias: ItemPendente[];
  bloqueado: boolean;
  modo: "cliente" | "escritorio";
  baseDocumentos: string;
  categoriaNome?: string;
  aoMudar: (m: Partial<ItemArquivo>) => void;
  aoRemover: () => void;
  aoEnviarDuplicado: () => void;
  aoTentarNovamente: () => void;
}) {
  const editavel = (i.etapa === "pronto" || i.etapa === "erro") && !bloqueado;
  const andamento = EM_ANDAMENTO.includes(i.etapa);
  const s = i.sugestao;
  const dicaCategoria = s?.categoria && s.categoria !== i.categoria ? categorias.find((c) => c.codigo === s.categoria) : undefined;
  const dicaCompetencia = s?.competencia && s.competencia !== i.competencia ? s.competencia : undefined;
  const pendencia = pendencias.find((p) => p.id === i.itemId);

  return (
    <li className="space-y-2 p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {i.etapa === "concluido" ? (
            <CheckCircle2 className="size-5 text-sucesso" aria-hidden="true" />
          ) : i.etapa === "erro" ? (
            <AlertTriangle className="size-5 text-perigo" aria-hidden="true" />
          ) : i.etapa === "duplicado" ? (
            <CopyCheck className="size-5 text-alerta" aria-hidden="true" />
          ) : andamento ? (
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <FileUp className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-medium" title={i.nome}>
              {i.nome}
            </p>
            <span className="text-xs text-muted-foreground">{formatarTamanho(i.arquivo.size)}</span>
            {i.origem === "camera" ? <Badge variante="info">Foto</Badge> : null}
            <span className={cn("text-xs", i.etapa === "erro" ? "text-perigo" : i.etapa === "concluido" ? "text-sucesso" : "text-muted-foreground")}>
              {ROTULO_ETAPA[i.etapa]}
            </span>
          </div>

          {andamento ? (
            <div className="mt-2">
              <Progresso valor={Math.round(i.progresso * 100)} rotulo={`${ROTULO_ETAPA[i.etapa]} ${i.nome}`} />
            </div>
          ) : null}

          {editavel ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <Select aria-label={`Tipo de documento de ${i.nome}`} value={i.categoria} onChange={(e) => aoMudar({ categoria: e.target.value, categoriaSugerida: false })} className="h-9">
                  <option value="">Escolha o tipo de documento...</option>
                  {categorias.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
                {i.categoriaSugerida && s ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-info-fg">
                    <Sparkles className="size-3" /> Sugerido: {s.motivo}. Confira.
                  </p>
                ) : dicaCategoria ? (
                  <button type="button" className="mt-1 flex items-center gap-1 text-left text-xs text-info-fg underline-offset-2 hover:underline" onClick={() => aoMudar({ categoria: dicaCategoria.codigo, categoriaSugerida: true })}>
                    <Sparkles className="size-3" /> Parece ser “{dicaCategoria.nome}” ({s?.motivo}). Usar
                  </button>
                ) : null}
              </div>
              <div>
                <Select aria-label={`Competência de ${i.nome}`} value={i.competencia} onChange={(e) => aoMudar({ competencia: e.target.value, competenciaSugerida: false })} className="h-9">
                  {competencias.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.rotulo}
                    </option>
                  ))}
                </Select>
                {i.competenciaSugerida ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-info-fg">
                    <Sparkles className="size-3" /> Mês ajustado conforme o conteúdo do arquivo. Confira.
                  </p>
                ) : dicaCompetencia && competencias.some((c) => c.valor === dicaCompetencia) ? (
                  <button type="button" className="mt-1 flex items-center gap-1 text-xs text-info-fg underline-offset-2 hover:underline" onClick={() => aoMudar({ competencia: dicaCompetencia, competenciaSugerida: true })}>
                    <Sparkles className="size-3" /> O arquivo parece ser de {formatarCompetencia(`${dicaCompetencia}-01`)}. Usar
                  </button>
                ) : null}
              </div>
              {pendencias.length > 1 ? (
                <Select aria-label={`Pendência atendida por ${i.nome}`} value={i.itemId ?? ""} onChange={(e) => aoMudar({ itemId: e.target.value || null })} className="h-9 sm:col-span-2">
                  <option value="">Qual pendência este arquivo atende? (opcional)</option>
                  {pendencias.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.titulo}
                    </option>
                  ))}
                </Select>
              ) : pendencia ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">Atende à pendência: {pendencia.titulo}</p>
              ) : null}
              {modo === "escritorio" ? (
                <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
                  <Input aria-label="Título exibido ao cliente" placeholder="Título exibido ao cliente" value={i.titulo} onChange={(e) => aoMudar({ titulo: e.target.value })} className="h-9" />
                  <Input aria-label="Vencimento" type="date" value={i.vencimento} onChange={(e) => aoMudar({ vencimento: e.target.value })} className="h-9" />
                  <Input aria-label="Valor" inputMode="decimal" placeholder="Valor (R$)" value={i.valor} onChange={(e) => aoMudar({ valor: e.target.value })} className="h-9" />
                </div>
              ) : null}
            </div>
          ) : i.etapa !== "concluido" && i.etapa !== "duplicado" && categoriaNome ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {categoriaNome} · {formatarCompetencia(`${i.competencia}-01`)}
            </p>
          ) : null}

          {problema ? <p className="mt-1 text-xs text-perigo">{problema}</p> : null}
          {i.etapa === "erro" && i.erro ? <p className="mt-1 text-xs text-perigo">{i.erro}</p> : null}

          {i.etapa === "duplicado" && i.duplicado ? (
            <div className="mt-2 rounded-md border border-alerta/40 bg-alerta-bg p-2 text-xs text-alerta-fg">
              <p>
                Este mesmo arquivo já foi enviado em {formatarDataHora(i.duplicado.enviado_em)} (“{i.duplicado.nome}”, competência{" "}
                {formatarCompetencia(i.duplicado.competencia)}, situação: {i.duplicado.status ? STATUS_DOCUMENTO[i.duplicado.status]?.rotulo ?? i.duplicado.status : "—"}).
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button tamanho="sm" variante="contorno" onClick={aoRemover}>
                  Não enviar
                </Button>
                <Button tamanho="sm" variante="secundario" onClick={aoEnviarDuplicado}>
                  Enviar mesmo assim
                </Button>
                <Button tamanho="sm" variante="link" asChild>
                  <Link href={`${baseDocumentos}/${i.duplicado.id}`}>Ver o documento enviado</Link>
                </Button>
              </div>
            </div>
          ) : null}

          {i.etapa === "concluido" && i.documentoId ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Protocolo {protocolo(i.documentoId, i.concluidoEm)} ·{" "}
              <Link className="underline" href={`${baseDocumentos}/${i.documentoId}`}>
                acompanhar
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          {i.etapa === "erro" ? (
            <Button variante="fantasma" tamanho="iconeSm" aria-label={`Tentar enviar ${i.nome} novamente`} onClick={aoTentarNovamente} disabled={Boolean(problema)}>
              <RotateCcw />
            </Button>
          ) : null}
          {i.etapa !== "concluido" ? (
            <Button variante="fantasma" tamanho="iconeSm" aria-label={andamento ? `Cancelar envio de ${i.nome}` : `Remover ${i.nome}`} onClick={aoRemover}>
              {andamento ? <X /> : <Trash2 />}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
