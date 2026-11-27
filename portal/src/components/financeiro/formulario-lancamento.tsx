"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Loader2, Paperclip, Repeat, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { cn } from "@/lib/utils";
import { TIPOS_CATEGORIA } from "@/lib/rotulos";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { gerarParcelas, mudarValorParcela, somaParcelas, type Intervalo, type ParcelaEditavel } from "@/lib/financeiro/parcelas";
import { salvarLancamento } from "@/lib/financeiro/acoes-lancamentos";
import { salvarContraparte } from "@/lib/financeiro/acoes-cadastros";
import { contasMaisUsadas, sugerirConta, type LancamentoHistorico } from "@/lib/financeiro/sugestao-conta";
import { calcularSha256, enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirEnvio, iniciarEnvio } from "@/lib/documentos/acoes";
import { AvisoSugestao, SeletorConta, type OpcaoConta } from "./seletor-conta";

export interface OpcoesLancamento {
  categorias: { id: string; codigo: string; nome: string; natureza: string; tipo: string }[];
  contrapartes: { id: string; nome: string }[];
  centros: { id: string; nome: string }[];
  projetos: { id: string; nome: string }[];
  contas: { id: string; nome: string; tipo: string }[];
  /** Lançamentos recentes da empresa (mais recente primeiro), para atalhos e sugestão de conta. */
  historico?: LancamentoHistorico[];
  /** Último banco/caixa usado para pagar e para receber. */
  ultimaContaPagamento?: { pagar: string | null; receber: string | null };
}

export interface ValoresLancamento {
  id?: string;
  tipo: "receber" | "pagar";
  descricao: string;
  categoria_id: string;
  contraparte_id: string;
  centro_custo_id: string;
  projeto_id: string;
  conta_financeira_id: string;
  data_competencia: string;
  data_vencimento: string;
  valor: string;
  numero_documento: string;
  observacoes: string;
  documento_id?: string;
}

interface Lembrar {
  tipo: "receber" | "pagar";
  data: string;
  contaPagamento: string;
}

/**
 * Lançamento de despesa ou receita. Na frente só o essencial (tipo, valor,
 * data, descrição, conta, "já foi pago" e comprovante); o resto fica em
 * "Mais detalhes". Lançamento novo: depois de salvar, o formulário fica pronto
 * para o próximo (mantém o tipo, a data e o banco). Edição: abre o lançamento.
 */
export function FormularioLancamento({
  empresaId,
  opcoes,
  valores,
  base,
  podeAnexar = false,
}: {
  empresaId: string;
  opcoes: OpcoesLancamento;
  valores: ValoresLancamento;
  base: string;
  podeAnexar?: boolean;
}) {
  const [rodada, setRodada] = useState(0);
  const [ultimo, setUltimo] = useState<{ id: string | null; texto: string } | null>(null);
  const [lembrar, setLembrar] = useState<Lembrar | null>(null);
  const inicial: ValoresLancamento =
    lembrar && !valores.id
      ? { ...valores, tipo: lembrar.tipo, descricao: "", categoria_id: "", contraparte_id: "", valor: "", numero_documento: "", observacoes: "", documento_id: undefined, data_vencimento: lembrar.data, data_competencia: lembrar.data }
      : valores;
  return (
    <div className="space-y-4">
      {ultimo ? (
        <Alerta tom="sucesso" titulo="Lançado!">
          {ultimo.texto}
          {ultimo.id ? (
            <>
              {" "}
              <Link href={`${base}/${ultimo.id}`} className="font-semibold underline">
                Ver o lançamento
              </Link>
            </>
          ) : null}
          . Pode lançar o próximo.
        </Alerta>
      ) : null}
      <CorpoFormulario
        key={rodada}
        empresaId={empresaId}
        opcoes={opcoes}
        valores={inicial}
        base={base}
        podeAnexar={podeAnexar}
        contaPagamentoInicial={lembrar?.contaPagamento}
        aoCriar={(id, texto, l) => {
          setUltimo({ id, texto });
          setLembrar(l);
          setRodada((r) => r + 1);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}

function CorpoFormulario({
  empresaId,
  opcoes,
  valores,
  base,
  podeAnexar,
  contaPagamentoInicial,
  aoCriar,
}: {
  empresaId: string;
  opcoes: OpcoesLancamento;
  valores: ValoresLancamento;
  base: string;
  podeAnexar: boolean;
  contaPagamentoInicial?: string;
  aoCriar: (id: string | null, texto: string, lembrar: Lembrar) => void;
}) {
  const router = useRouter();
  const edicao = Boolean(valores.id);
  const historico = useMemo(() => opcoes.historico ?? [], [opcoes.historico]);
  const [tipo, setTipo] = useState<"receber" | "pagar">(valores.tipo);
  const [valor, setValor] = useState(valores.valor);
  const [descricao, setDescricao] = useState(valores.descricao);
  const [categoria, setCategoria] = useState(valores.categoria_id);
  const [categoriaEscolhida, setCategoriaEscolhida] = useState(Boolean(valores.categoria_id));
  const [contrapartes, setContrapartes] = useState(opcoes.contrapartes);
  const [contraparte, setContraparte] = useState(valores.contraparte_id);
  const [novaContraparte, setNovaContraparte] = useState(false);
  const [data, setData] = useState(valores.data_vencimento);
  const [competencia, setCompetencia] = useState<string | null>(valores.data_competencia !== valores.data_vencimento ? valores.data_competencia : null);
  const [modo, setModo] = useState<"unico" | "parcelado" | "recorrente">("unico");
  // Parcelas: geradas pelo total, quantidade, 1º vencimento e intervalo; editáveis uma a uma
  const [qtdTexto, setQtdTexto] = useState("2");
  const [intervalo, setIntervalo] = useState<Intervalo>("mensal");
  const [editadas, setEditadas] = useState<ParcelaEditavel[] | null>(null);
  const [jaPago, setJaPago] = useState(!edicao);
  const contasPagamento = opcoes.contas.filter((c) => c.tipo !== "cartao_credito" && c.tipo !== "adquirente");
  const contaPadrao = (t: "pagar" | "receber") => {
    const candidata = contaPagamentoInicial ?? opcoes.ultimaContaPagamento?.[t] ?? null;
    return candidata && contasPagamento.some((c) => c.id === candidata) ? candidata : (contasPagamento[0]?.id ?? "");
  };
  const [contaPagamento, setContaPagamento] = useState(() => contaPadrao(valores.tipo));
  const [documentoId, setDocumentoId] = useState(valores.documento_id ?? "");
  const [arquivo, setArquivo] = useState<{ nome: string; etapa: "enviando" | "pronto" | "erro"; erro?: string } | null>(null);
  const [detalhes, setDetalhes] = useState(edicao);

  const natureza = tipo === "receber" ? "receita" : "despesa";
  const opcoesConta: OpcaoConta[] = useMemo(
    () =>
      opcoes.categorias
        .filter((c) => c.natureza === natureza)
        .map((c) => {
          const t = TIPOS_CATEGORIA[c.tipo];
          return { id: c.id, codigo: c.codigo, nome: c.nome, grupo: t ? (t.dre ? t.grupo : "Fora do resultado (não entra no DRE)") : "Outras" };
        }),
    [opcoes.categorias, natureza],
  );
  const validas = useMemo(() => new Set(opcoesConta.map((o) => o.id)), [opcoesConta]);
  const maisUsadas = useMemo(() => contasMaisUsadas(historico, tipo).filter((id) => validas.has(id)), [historico, tipo, validas]);
  // Sugestão pelo histórico da própria empresa (mesmo fornecedor ou descrição parecida)
  const sugestao = useMemo(
    () => (categoriaEscolhida ? null : sugerirConta(historico, { tipo, descricao, contraparteId: contraparte || null }, validas)),
    [categoriaEscolhida, historico, tipo, descricao, contraparte, validas],
  );
  const categoriaFinal = categoriaEscolhida ? categoria : (sugestao?.categoriaId ?? "");
  const unico = modo === "unico";
  const qtdParcelas = Math.min(360, Math.max(2, Number(qtdTexto) || 2));
  const geradas = useMemo(() => gerarParcelas(valor, qtdParcelas, data, intervalo), [valor, qtdParcelas, data, intervalo]);
  const parcelas = editadas ?? geradas;
  const totalInformado = lerValorBR(valor);
  const somaDasParcelas = somaParcelas(parcelas);
  const parcelasBatem = totalInformado ? somaDasParcelas.eq(totalInformado) : false;

  const enviarComprovante = async (f: File) => {
    setArquivo({ nome: f.name, etapa: "enviando" });
    try {
      const sha256 = await calcularSha256(f);
      const inicio = await iniciarEnvio(empresaId, {
        categoria: "comprovante",
        competencia: (competencia ?? data).slice(0, 7),
        nome: f.name,
        mime: f.type || "application/octet-stream",
        tamanho: f.size,
        sha256,
        titulo: (descricao || f.name).slice(0, 200),
      });
      if (!inicio.ok || !inicio.dados) throw new Error(inicio.mensagem ?? "Não foi possível enviar o comprovante.");
      if (inicio.dados.situacao === "duplicado") {
        setDocumentoId(inicio.dados.duplicado.id);
      } else {
        await enviarParaArmazenamento(inicio.dados.url, f, () => undefined);
        const fim = await concluirEnvio(empresaId, inicio.dados.versaoId);
        if (!fim.ok || !fim.dados) throw new Error(fim.mensagem ?? "Não foi possível concluir o envio do comprovante.");
        setDocumentoId(fim.dados.documentoId);
      }
      setArquivo({ nome: f.name, etapa: "pronto" });
    } catch (e) {
      setArquivo({ nome: f.name, etapa: "erro", erro: e instanceof Error ? e.message : "Não foi possível enviar o comprovante." });
    }
  };

  return (
    <>
      <FormularioAcao
        acao={salvarLancamento.bind(null, empresaId)}
        atualizarAoSucesso={false}
        manterAoErrar
        aoSucesso={(e) => {
          const id = (e.dados as { id?: string } | undefined)?.id ?? null;
          if (edicao) {
            router.push(id ? `${base}/${id}` : base);
            router.refresh();
            return;
          }
          const nomeConta = opcoesConta.find((o) => o.id === categoriaFinal)?.nome;
          aoCriar(id, `${descricao}${nomeConta ? ` em ${nomeConta}` : ""}${valor ? `, ${formatarMoeda(valor.replace(/\./g, "").replace(",", "."))}` : ""}`, {
            tipo,
            data,
            contaPagamento,
          });
          router.refresh();
        }}
        className="space-y-5"
      >
        {({ estado, pendente }) => {
          const erroNosDetalhes = Boolean(estado.erros?.parcelas || estado.erros?.frequencia || estado.erros?.data_competencia);
          return (
            <>
              {valores.id ? <input type="hidden" name="id" value={valores.id} /> : null}
              {documentoId ? <input type="hidden" name="documento_id" value={documentoId} /> : null}
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="data_vencimento" value={data} />
              <input type="hidden" name="data_competencia" value={competencia ?? data} />
              {jaPago && unico && !edicao ? <input type="hidden" name="data_pagamento" value={data} /> : null}

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo do lançamento">
                {(
                  [
                    ["pagar", "Despesa", "saída de dinheiro", ArrowUpRight],
                    ["receber", "Receita", "entrada de dinheiro", ArrowDownLeft],
                  ] as const
                ).map(([t, rotulo, detalhe, Icone]) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tipo === t}
                    onClick={() => {
                      if (t === tipo) return;
                      setTipo(t);
                      setCategoria("");
                      setCategoriaEscolhida(false);
                      if (!contaPagamentoInicial) setContaPagamento(contaPadrao(t));
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                      tipo === t ? (t === "pagar" ? "border-perigo bg-perigo-bg" : "border-sucesso bg-sucesso-bg") : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    <Icone className={cn("size-5 shrink-0", t === "pagar" ? "text-perigo" : "text-sucesso")} />
                    <span>
                      <span className="block font-semibold">{rotulo}</span>
                      <span className="block text-xs text-muted-foreground">{detalhe}</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo={modo === "parcelado" ? "Valor total" : "Valor"} htmlFor="l-valor" obrigatorio erro={estado.erros?.valor}>
                  <CampoValor
                    id="l-valor"
                    name="valor"
                    valorInicial={valores.valor}
                    aoMudar={(v) => {
                      setValor(v);
                      setEditadas(null);
                    }}
                    className="h-12 text-lg font-semibold"
                  />
                </Campo>
                <Campo
                  rotulo={modo === "parcelado" ? "Vencimento da 1ª parcela" : modo === "recorrente" ? "Primeiro vencimento" : jaPago && unico && !edicao ? "Data do pagamento" : "Data (vencimento)"}
                  htmlFor="l-data"
                  obrigatorio
                  erro={estado.erros?.data_vencimento ?? estado.erros?.data_pagamento}
                >
                  <Input
                    id="l-data"
                    type="date"
                    value={data}
                    onChange={(e) => {
                      setData(e.target.value);
                      setEditadas(null);
                    }}
                    className="h-12"
                  />
                </Campo>
                <Campo rotulo="Descrição" htmlFor="l-desc" obrigatorio erro={estado.erros?.descricao} className="sm:col-span-2">
                  <Input
                    id="l-desc"
                    name="descricao"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    maxLength={300}
                    autoComplete="off"
                    placeholder={tipo === "receber" ? "Ex.: venda para Cliente X" : "Ex.: aluguel da loja"}
                  />
                </Campo>
                <Campo
                  rotulo="Conta"
                  htmlFor="l-cat"
                  obrigatorio
                  erro={estado.erros?.categoria_id}
                  className="sm:col-span-2"
                  ajuda={!sugestao ? "Onde o valor entra no DRE (ex.: Aluguel, Vendas). Aportes, empréstimos e retiradas ficam fora do resultado." : undefined}
                >
                  <SeletorConta
                    id="l-cat"
                    name="categoria_id"
                    rotulo="Conta"
                    opcoes={opcoesConta}
                    valor={categoriaFinal}
                    aoMudar={(id) => {
                      setCategoria(id);
                      setCategoriaEscolhida(true);
                    }}
                    maisUsadas={maisUsadas}
                    invalido={Boolean(estado.erros?.categoria_id)}
                  />
                  {sugestao ? (
                    <AvisoSugestao
                      texto={
                        sugestao.motivo === "fornecedor"
                          ? `Sugerida pelo último lançamento deste ${tipo === "receber" ? "cliente" : "fornecedor"} (“${sugestao.exemplo}”). Confira.`
                          : `Sugerida por um lançamento parecido (“${sugestao.exemplo}”). Confira.`
                      }
                    />
                  ) : null}
                </Campo>
              </div>

              {!edicao && unico ? (
                <div className="space-y-3 rounded-xl border border-border p-4">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox name="ja_pago" checked={jaPago} onChange={(e) => setJaPago(e.target.checked)} />
                    {tipo === "receber" ? "Já foi recebido" : "Já foi pago"} (valor integral, na data acima)
                  </label>
                  {jaPago ? (
                    <Campo rotulo={tipo === "receber" ? "Recebido em" : "Pago com"} htmlFor="l-cpag" obrigatorio erro={estado.erros?.conta_pagamento_id}>
                      <Select id="l-cpag" name="conta_pagamento_id" value={contaPagamento} onChange={(e) => setContaPagamento(e.target.value)}>
                        <option value="">Selecione o banco ou caixa...</option>
                        {contasPagamento.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  ) : (
                    <p className="text-xs text-muted-foreground">Fica em aberto nas contas a {tipo === "receber" ? "receber" : "pagar"} até você dar baixa.</p>
                  )}
                </div>
              ) : null}

              {!edicao && podeAnexar ? (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Comprovante (opcional)</p>
                  {arquivo ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {arquivo.etapa === "enviando" ? <Loader2 className="size-4 animate-spin" /> : arquivo.etapa === "pronto" ? <CheckCircle2 className="size-4 text-sucesso" /> : null}
                      <span className="truncate">{arquivo.nome}</span>
                      <span className="text-muted-foreground">{arquivo.etapa === "enviando" ? "enviando…" : arquivo.etapa === "pronto" ? "enviado" : ""}</span>
                      {arquivo.etapa !== "enviando" ? (
                        <Button
                          type="button"
                          tamanho="iconeSm"
                          variante="fantasma"
                          aria-label="Tirar o comprovante"
                          onClick={() => {
                            setArquivo(null);
                            setDocumentoId(valores.documento_id ?? "");
                          }}
                        >
                          <X />
                        </Button>
                      ) : null}
                      {arquivo.erro ? <p className="w-full text-xs text-perigo">{arquivo.erro}</p> : null}
                    </div>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2 text-sm hover:bg-muted">
                      <Paperclip className="size-4" /> Anexar foto ou PDF
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                        className="sr-only"
                        aria-label="Anexar comprovante"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void enviarComprovante(f);
                        }}
                      />
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">Fica guardado em Documentos e ligado ao lançamento.</p>
                </div>
              ) : null}

              <details
                open={detalhes || erroNosDetalhes}
                onToggle={(e) => setDetalhes((e.currentTarget as HTMLDetailsElement).open)}
                className="rounded-xl border border-border"
              >
                <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                  Mais detalhes <span className="font-normal text-muted-foreground">— {tipo === "receber" ? "cliente" : "fornecedor"}, mês do DRE, centro de custo, parcelado ou mensal…</span>
                </summary>
                <div className="space-y-4 border-t border-border p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Campo rotulo={tipo === "receber" ? "Cliente / pagador" : "Fornecedor / beneficiário"} htmlFor="l-contra">
                      <div className="flex gap-2">
                        <Select id="l-contra" name="contraparte_id" value={contraparte} onChange={(e) => setContraparte(e.target.value)}>
                          <option value="">—</option>
                          {contrapartes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nome}
                            </option>
                          ))}
                        </Select>
                        <Button type="button" variante="contorno" tamanho="icone" aria-label="Cadastrar novo" onClick={() => setNovaContraparte(true)}>
                          <UserPlus />
                        </Button>
                      </div>
                    </Campo>
                    <Campo
                      rotulo="Competência (mês do DRE)"
                      htmlFor="l-comp"
                      erro={estado.erros?.data_competencia}
                      ajuda="Quando a receita ou a despesa aconteceu. Normalmente é a mesma data."
                    >
                      <Input id="l-comp" type="date" value={competencia ?? data} onChange={(e) => setCompetencia(e.target.value === data ? null : e.target.value)} />
                    </Campo>
                    <Campo rotulo="Conta prevista" htmlFor="l-conta" ajuda="Banco em que o valor deve entrar ou sair (opcional).">
                      <Select id="l-conta" name="conta_financeira_id" defaultValue={valores.conta_financeira_id}>
                        <option value="">—</option>
                        {opcoes.contas.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                    <Campo rotulo="Centro de custo" htmlFor="l-cc">
                      <Select id="l-cc" name="centro_custo_id" defaultValue={valores.centro_custo_id}>
                        <option value="">—</option>
                        {opcoes.centros.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                    <Campo rotulo="Projeto" htmlFor="l-proj">
                      <Select id="l-proj" name="projeto_id" defaultValue={valores.projeto_id}>
                        <option value="">—</option>
                        {opcoes.projetos.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                    <Campo rotulo="Nº do documento" htmlFor="l-num" ajuda="Nota fiscal, boleto, contrato...">
                      <Input id="l-num" name="numero_documento" defaultValue={valores.numero_documento} maxLength={100} />
                    </Campo>
                    <Campo rotulo="Observações" htmlFor="l-obs" className="md:col-span-2">
                      <Textarea id="l-obs" name="observacoes" defaultValue={valores.observacoes} rows={2} />
                    </Campo>
                  </div>

                  {!edicao ? (
                    <fieldset className="space-y-3">
                      <legend className="text-sm font-medium">Repetição</legend>
                      <div className="flex flex-wrap gap-4 text-sm">
                        {(
                          [
                            ["unico", "Uma vez só"],
                            ["parcelado", "Parcelado"],
                            ["recorrente", "Todo mês ou período (aluguel, mensalidade...)"],
                          ] as const
                        ).map(([v, r]) => (
                          <label key={v} className="inline-flex items-center gap-2">
                            <input type="radio" name="modo" value={v} checked={modo === v} onChange={() => setModo(v)} className="accent-[var(--primary)]" /> {r}
                          </label>
                        ))}
                      </div>
                      {modo === "parcelado" ? (
                        <div className="space-y-3">
                          <div className="grid gap-4 sm:grid-cols-3">
                            <Campo rotulo="Número de parcelas" htmlFor="l-parc" erro={estado.erros?.parcelas}>
                              <Input
                                id="l-parc"
                                name="parcelas"
                                type="number"
                                min={2}
                                max={360}
                                value={qtdTexto}
                                onChange={(e) => {
                                  setQtdTexto(e.target.value);
                                  setEditadas(null);
                                }}
                              />
                            </Campo>
                            <Campo rotulo="De quanto em quanto tempo" htmlFor="l-intervalo">
                              <Select
                                id="l-intervalo"
                                value={intervalo}
                                onChange={(e) => {
                                  setIntervalo(e.target.value as Intervalo);
                                  setEditadas(null);
                                }}
                              >
                                <option value="mensal">Todo mês</option>
                                <option value="quinzenal">A cada 15 dias</option>
                                <option value="semanal">Toda semana</option>
                              </Select>
                            </Campo>
                            <label className="flex items-center gap-2 self-end pb-2 text-sm">
                              <Checkbox name="competencia_por_parcela" /> Competência de cada parcela no mês do vencimento
                            </label>
                          </div>
                          <input type="hidden" name="parcelas_json" value={JSON.stringify(parcelas)} />
                          {parcelas.length ? (
                            <div className="rounded-xl border border-border">
                              <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                                <span>Nº</span>
                                <span>Vencimento</span>
                                <span>Valor</span>
                              </div>
                              <ul className="max-h-80 space-y-2 overflow-y-auto p-3" aria-label="Parcelas">
                                {parcelas.map((p, i) => (
                                  <li key={i} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">{i + 1}ª</span>
                                    <Input
                                      type="date"
                                      aria-label={`Vencimento da parcela ${i + 1}`}
                                      value={p.vencimento}
                                      onChange={(e) => setEditadas(parcelas.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))}
                                    />
                                    <Input
                                      inputMode="decimal"
                                      aria-label={`Valor da parcela ${i + 1}`}
                                      value={p.valor}
                                      onChange={(e) => setEditadas(mudarValorParcela(parcelas, i, e.target.value, valor))}
                                      className="numero"
                                    />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">Informe o valor total e o vencimento da 1ª parcela para ver as parcelas.</p>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <p data-testid="resumo-parcelas" className={parcelasBatem ? "text-muted-foreground" : "text-perigo"}>
                              {parcelas.length} parcela(s) somando <strong className="numero">{formatarMoeda(somaDasParcelas)}</strong>
                              {totalInformado && !parcelasBatem ? <> — diferente do valor total ({formatarMoeda(totalInformado)}). Ajuste os valores ou refaça as parcelas.</> : null}
                              {parcelasBatem ? ". Mudou o valor de uma parcela? A última se ajusta para fechar o total." : null}
                            </p>
                            {editadas ? (
                              <Button type="button" variante="contorno" tamanho="sm" onClick={() => setEditadas(null)}>
                                <Repeat /> Refazer parcelas
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {modo === "recorrente" ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Campo rotulo="Frequência" htmlFor="l-freq" erro={estado.erros?.frequencia}>
                            <Select id="l-freq" name="frequencia" defaultValue="mensal">
                              <option value="semanal">Semanal</option>
                              <option value="quinzenal">Quinzenal</option>
                              <option value="mensal">Mensal</option>
                              <option value="bimestral">Bimestral</option>
                              <option value="trimestral">Trimestral</option>
                              <option value="semestral">Semestral</option>
                              <option value="anual">Anual</option>
                            </Select>
                          </Campo>
                          <Campo rotulo="Termina em (opcional)" htmlFor="l-fim" ajuda="Sem data final, os lançamentos são gerados 3 meses à frente, continuamente.">
                            <Input id="l-fim" name="data_fim" type="date" />
                          </Campo>
                        </div>
                      ) : null}
                    </fieldset>
                  ) : null}
                </div>
              </details>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variante="contorno" onClick={() => router.back()}>
                  Cancelar
                </Button>
                <BotaoEnviar pendente={pendente} disabled={arquivo?.etapa === "enviando"}>
                  {edicao ? "Salvar alterações" : tipo === "receber" ? "Salvar receita" : "Salvar despesa"}
                </BotaoEnviar>
              </div>
            </>
          );
        }}
      </FormularioAcao>

      <Dialog open={novaContraparte} onOpenChange={setNovaContraparte}>
        <DialogContent titulo={tipo === "receber" ? "Novo cliente" : "Novo fornecedor"} descricao="Cadastro rápido. Você pode completar depois em Cadastros.">
          <FormularioAcao
            acao={salvarContraparte.bind(null, empresaId)}
            atualizarAoSucesso={false}
            aoSucesso={(e) => {
              const id = (e.dados as { id?: string } | undefined)?.id;
              const nome = (document.getElementById("nc-nome") as HTMLInputElement | null)?.value ?? "Novo cadastro";
              if (id) {
                setContrapartes((l) => [...l, { id, nome }].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
                setContraparte(id);
              }
              setNovaContraparte(false);
            }}
            className="space-y-4"
          >
            {({ estado, pendente }) => (
              <>
                <input type="hidden" name="papeis" value={tipo === "receber" ? "cliente" : "fornecedor"} />
                <Campo rotulo="Nome" htmlFor="nc-nome" obrigatorio erro={estado.erros?.nome}>
                  <Input id="nc-nome" name="nome" />
                </Campo>
                <Campo rotulo="CPF ou CNPJ (opcional)" htmlFor="nc-doc" erro={estado.erros?.documento}>
                  <Input id="nc-doc" name="documento" inputMode="numeric" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Cadastrar</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}
