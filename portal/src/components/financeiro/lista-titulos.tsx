"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarClock, Check, FolderTree, HandCoins, Handshake, Loader2, Repeat, ShieldCheck, ShieldX, Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData } from "@/lib/formatos";
import { dec, formatarMoeda, lerValorBR, somar } from "@/lib/dinheiro";
import { APROVACAO_PAGAMENTO, ORIGEM_LANCAMENTO, SITUACAO_LANCAMENTO } from "@/lib/rotulos";
import { alterarEmLote, baixarEmLote, decidirAprovacao, renegociarTitulos } from "@/lib/financeiro/acoes-titulos";
import type { ResultadoAcao } from "@/lib/acoes";
import { dividir, somarMeses } from "@/lib/financeiro/parcelas";
import { cn } from "@/lib/utils";

export interface LinhaTitulo {
  id: string;
  descricao: string;
  categoria: string | null;
  contraparte: string | null;
  centro: string | null;
  competencia: string;
  vencimento: string;
  valor: string;
  pago: string;
  saldo: string;
  situacao: string;
  vencido: boolean;
  diasAtraso: number;
  revisao: string;
  origem: string;
  parcela: string | null;
  aprovacao: string;
  acordo: boolean;
  recorrente: boolean;
}

export type Acao = "baixar" | "vencimento" | "categoria" | "centro" | "aprovar" | "reprovar" | "renegociar" | "cancelar";

const FORMAS = [
  ["pix", "Pix"],
  ["boleto", "Boleto"],
  ["transferencia", "Transferência"],
  ["dinheiro", "Dinheiro"],
  ["cartao_debito", "Cartão de débito"],
  ["cartao_credito", "Cartão de crédito"],
  ["debito_automatico", "Débito automático"],
  ["cheque", "Cheque"],
  ["outro", "Outro"],
] as const;

export function ListaTitulos({
  empresaId,
  tipo,
  linhas,
  hoje,
  voltar,
  permissoes,
  contas,
  categorias,
  centros,
}: {
  empresaId: string;
  tipo: "pagar" | "receber";
  linhas: LinhaTitulo[];
  hoje: string;
  voltar: string;
  permissoes: { editar: boolean; baixar: boolean; aprovar: boolean };
  contas: { id: string; nome: string }[];
  categorias: { id: string; nome: string }[];
  centros: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const pagar = tipo === "pagar";
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [acao, setAcao] = React.useState<{ tipo: Acao; ids: string[] } | null>(null);
  const podeSelecionar = permissoes.editar || permissoes.baixar || permissoes.aprovar;
  const selecionadas = linhas.filter((l) => sel.has(l.id));
  const totalSel = somar(selecionadas.map((l) => l.saldo));
  const emAberto = (l: LinhaTitulo) => l.situacao === "aberto" || l.situacao === "parcial";
  // As linhas da página mudaram (filtro, página): a seleção que sumiu sai junto
  const idsPagina = linhas.map((l) => l.id).join(",");
  const [idsAnteriores, setIdsAnteriores] = React.useState(idsPagina);
  if (idsAnteriores !== idsPagina) {
    setIdsAnteriores(idsPagina);
    setSel((s) => new Set([...s].filter((id) => linhas.some((l) => l.id === id))));
  }

  function alternar(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function abrir(tipoAcao: Acao, ids?: string[]) {
    const alvo = ids ?? [...sel];
    if (!alvo.length) return;
    setAcao({ tipo: tipoAcao, ids: alvo });
  }

  function concluido(r: ResultadoAcao) {
    if (r.ok) {
      toast.success(r.mensagem ?? "Feito.");
      setAcao(null);
      setSel(new Set());
      router.refresh();
      return true;
    }
    toast.error(r.mensagem ?? "Não foi possível concluir.");
    return false;
  }

  const abertasSel = selecionadas.filter(emAberto);
  const pendentesSel = selecionadas.filter((l) => l.aprovacao === "pendente" || l.aprovacao === "reprovado");

  return (
    <div className="space-y-3">
      {podeSelecionar && selecionadas.length ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-card p-2 shadow-md" role="region" aria-label="Ações com os selecionados">
          <span className="px-1 text-sm font-medium" data-testid="resumo-selecao">
            {selecionadas.length} selecionado(s) · saldo {formatarMoeda(totalSel)}
          </span>
          {permissoes.baixar && abertasSel.length ? (
            <Button tamanho="sm" onClick={() => abrir("baixar", abertasSel.map((l) => l.id))}>
              <HandCoins /> {pagar ? "Pagar" : "Receber"}
            </Button>
          ) : null}
          {permissoes.aprovar && pagar && pendentesSel.length ? (
            <>
              <Button tamanho="sm" variante="sucesso" onClick={() => abrir("aprovar", pendentesSel.map((l) => l.id))}>
                <ShieldCheck /> Aprovar
              </Button>
              <Button tamanho="sm" variante="contorno" onClick={() => abrir("reprovar", pendentesSel.map((l) => l.id))}>
                <ShieldX /> Reprovar
              </Button>
            </>
          ) : null}
          {permissoes.editar ? (
            <>
              {abertasSel.length ? (
                <Button tamanho="sm" variante="contorno" onClick={() => abrir("vencimento", abertasSel.map((l) => l.id))}>
                  <CalendarClock /> Vencimento
                </Button>
              ) : null}
              <Button tamanho="sm" variante="contorno" onClick={() => abrir("categoria")}>
                <Tags /> Categoria
              </Button>
              {centros.length ? (
                <Button tamanho="sm" variante="contorno" onClick={() => abrir("centro")}>
                  <FolderTree /> Centro de custo
                </Button>
              ) : null}
              {abertasSel.length ? (
                <Button tamanho="sm" variante="contorno" onClick={() => abrir("renegociar", abertasSel.map((l) => l.id))}>
                  <Handshake /> Renegociar
                </Button>
              ) : null}
              {abertasSel.some((l) => dec(l.pago).isZero() && !l.acordo) ? (
                <Button
                  tamanho="sm"
                  variante="fantasma"
                  className="text-perigo"
                  onClick={() => abrir("cancelar", abertasSel.filter((l) => dec(l.pago).isZero() && !l.acordo).map((l) => l.id))}
                >
                  <Ban /> Cancelar
                </Button>
              ) : null}
            </>
          ) : null}
          <Button tamanho="sm" variante="fantasma" onClick={() => setSel(new Set())} aria-label="Limpar a seleção">
            <X />
          </Button>
        </div>
      ) : null}

      <Table>
        <THead>
          <tr>
            {podeSelecionar ? (
              <Th className="w-8">
                <Checkbox
                  aria-label="Selecionar todos desta página"
                  checked={linhas.length > 0 && linhas.every((l) => sel.has(l.id))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map((l) => l.id)) : new Set())}
                />
              </Th>
            ) : null}
            <Th>Vencimento</Th>
            <Th>Descrição</Th>
            <Th>Situação</Th>
            <Th className="text-right">Valor original</Th>
            <Th className="text-right">{pagar ? "Pago" : "Recebido"}</Th>
            <Th className="text-right">Saldo</Th>
            {permissoes.baixar ? (
              <Th className="w-10">
                <span className="sr-only">Ações</span>
              </Th>
            ) : null}
          </tr>
        </THead>
        <TBody>
          {linhas.map((l) => {
            const st = SITUACAO_LANCAMENTO[l.situacao];
            const ap = APROVACAO_PAGAMENTO[l.aprovacao];
            const href = `/e/${empresaId}/financeiro/${tipo}/${l.id}${voltar ? `?voltar=${encodeURIComponent(voltar)}` : ""}`;
            return (
              <Tr key={l.id} data-testid="linha-titulo" className={sel.has(l.id) ? "bg-primary/5" : undefined}>
                {podeSelecionar ? (
                  <Td>
                    <Checkbox aria-label={`Selecionar ${l.descricao}`} checked={sel.has(l.id)} onChange={() => alternar(l.id)} />
                  </Td>
                ) : null}
                <Td className="whitespace-nowrap text-sm">
                  {formatarData(l.vencimento)}
                  {l.vencido ? (
                    <span className="block text-xs font-medium text-perigo">há {l.diasAtraso} dia(s)</span>
                  ) : emAberto(l) && l.vencimento === hoje ? (
                    <span className="block text-xs font-medium text-alerta-fg">vence hoje</span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">comp. {formatarData(l.competencia).slice(3)}</span>
                  )}
                </Td>
                <Td className="max-w-[20rem]">
                  <Link href={href} className="block truncate font-medium hover:underline" title={l.descricao}>
                    {l.descricao}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      l.contraparte,
                      l.categoria ?? "Sem categoria",
                      l.parcela ? `parcela ${l.parcela}` : null,
                      l.recorrente ? "recorrente" : null,
                      l.origem !== "manual" ? ORIGEM_LANCAMENTO[l.origem] ?? l.origem : null,
                      l.centro,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Td>
                <Td>
                  {/* Uma etiqueta só (vencido junta com a situação); o resto em texto pequeno */}
                  <Badge variante={l.vencido ? "perigo" : (st?.tom ?? "neutro")}>
                    {l.vencido ? (l.situacao === "parcial" ? `${st?.rotulo ?? "Pago em parte"} · vencido` : "Vencido") : (st?.rotulo ?? l.situacao)}
                  </Badge>
                  {(() => {
                    const extras = [
                      ap && emAberto(l) ? ap.rotulo : null,
                      l.revisao === "sugerido" ? "A conferir" : null,
                      l.acordo ? "Acordo" : null,
                    ].filter(Boolean);
                    return extras.length ? (
                      <span className={cn("mt-0.5 block text-xs", l.revisao === "sugerido" || ap?.tom === "alerta" ? "text-alerta-fg" : "text-muted-foreground")}>{extras.join(" · ")}</span>
                    ) : null;
                  })()}
                </Td>
                <Td className="whitespace-nowrap text-right numero">{formatarMoeda(l.valor)}</Td>
                <Td className="whitespace-nowrap text-right text-sucesso numero">{dec(l.pago).isZero() ? "—" : formatarMoeda(l.pago)}</Td>
                <Td className="whitespace-nowrap text-right font-semibold numero">{emAberto(l) ? formatarMoeda(l.saldo) : "—"}</Td>
                {permissoes.baixar ? (
                  <Td>
                    {emAberto(l) && l.revisao === "confirmado" ? (
                      <Button tamanho="iconeSm" variante="fantasma" aria-label={`${pagar ? "Pagar" : "Receber"} ${l.descricao}`} title={pagar ? "Pagar" : "Receber"} onClick={() => abrir("baixar", [l.id])}>
                        <HandCoins />
                      </Button>
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            );
          })}
        </TBody>
      </Table>

      {acao ? (
        <DialogoAcao
          key={`${acao.tipo}-${acao.ids.join(",")}`}
          empresaId={empresaId}
          pagar={pagar}
          acao={acao.tipo}
          titulos={linhas.filter((l) => acao.ids.includes(l.id))}
          hoje={hoje}
          contas={contas}
          categorias={categorias}
          centros={centros}
          aoFechar={() => setAcao(null)}
          aoConcluir={concluido}
        />
      ) : null}
    </div>
  );
}

/** Diálogo de cada ação em lote: mostra o resumo (quantos e quanto) antes de confirmar. */
export function DialogoAcao({
  empresaId,
  pagar,
  acao,
  titulos,
  hoje,
  contas,
  categorias,
  centros,
  aoFechar,
  aoConcluir,
}: {
  empresaId: string;
  pagar: boolean;
  acao: Acao;
  titulos: LinhaTitulo[];
  hoje: string;
  contas: { id: string; nome: string }[];
  categorias: { id: string; nome: string }[];
  centros: { id: string; nome: string }[];
  aoFechar: () => void;
  aoConcluir: (r: ResultadoAcao) => boolean;
}) {
  const [pendente, iniciar] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [data, setData] = React.useState(hoje);
  const [conta, setConta] = React.useState(contas.length === 1 ? contas[0].id : "");
  const [forma, setForma] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [texto, setTexto] = React.useState("");
  const [descAcordo, setDescAcordo] = React.useState(() =>
    titulos.length ? `Acordo: ${titulos[0].descricao.replace(/\s*\(\d+\/\d+\)$/, "")}${titulos.length > 1 ? ` e mais ${titulos.length - 1}` : ""}`.slice(0, 200) : "",
  );
  const [chave] = React.useState(() => crypto.randomUUID());
  const total = somar(titulos.map((t) => t.saldo));
  // Renegociação
  const [qtd, setQtd] = React.useState(3);
  const [primeiro, setPrimeiro] = React.useState(somarMeses(hoje, 1));
  const [novoTotal, setNovoTotal] = React.useState(total.toFixed(2).replace(".", ","));
  const [parcelas, setParcelas] = React.useState<{ vencimento: string; valor: string }[]>(() => {
    const vals = dividir(total.toFixed(2).replace(".", ","), 3);
    return vals.map((v, i) => ({ vencimento: somarMeses(somarMeses(hoje, 1), i), valor: v }));
  });
  const somaParcelas = somar(parcelas.map((p) => lerValorBR(p.valor) ?? 0));

  function gerarParcelas() {
    const n = Math.min(120, Math.max(1, qtd || 1));
    const vals = dividir(novoTotal, n);
    setParcelas(vals.map((v, i) => ({ vencimento: somarMeses(primeiro, i), valor: v })));
  }

  const titulo = {
    baixar: pagar ? "Pagar os títulos selecionados" : "Receber os títulos selecionados",
    vencimento: "Mudar o vencimento",
    categoria: "Mudar a categoria",
    centro: "Mudar o centro de custo",
    aprovar: "Aprovar pagamentos",
    reprovar: "Reprovar pagamentos",
    renegociar: "Renegociar",
    cancelar: "Cancelar títulos",
  }[acao];

  function confirmar() {
    setErro(null);
    const ids = titulos.map((t) => t.id);
    iniciar(async () => {
      let r: ResultadoAcao;
      if (acao === "baixar") {
        if (!conta) return setErro("Escolha a conta de onde saiu (ou para onde entrou) o dinheiro.");
        r = await baixarEmLote(empresaId, ids, { data, contaId: conta, forma, chave });
      } else if (acao === "vencimento") {
        if (!data) return setErro("Informe o novo vencimento.");
        r = await alterarEmLote(empresaId, ids, "vencimento", data);
      } else if (acao === "categoria") {
        if (!valor) return setErro("Escolha a categoria.");
        r = await alterarEmLote(empresaId, ids, "categoria", valor);
      } else if (acao === "centro") {
        r = await alterarEmLote(empresaId, ids, "centro_custo", valor);
      } else if (acao === "aprovar") {
        r = await decidirAprovacao(empresaId, ids, "aprovado");
      } else if (acao === "reprovar") {
        if (texto.trim().length < 3) return setErro("Explique por que o pagamento foi reprovado.");
        r = await decidirAprovacao(empresaId, ids, "reprovado", texto);
      } else if (acao === "renegociar") {
        if (texto.trim().length < 5) return setErro("Explique o motivo da renegociação (ao menos 5 letras).");
        r = await renegociarTitulos(empresaId, ids, parcelas, texto, descAcordo);
      } else {
        if (texto.trim().length < 3) return setErro("Informe o motivo do cancelamento.");
        r = await alterarEmLote(empresaId, ids, "cancelar", texto);
      }
      if (!aoConcluir(r)) setErro(r.mensagem ?? "Não foi possível concluir.");
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent titulo={titulo} descricao={`${titulos.length} título(s) · saldo em aberto ${formatarMoeda(total)}`} largura={acao === "renegociar" ? "lg" : undefined}>
        <div className="space-y-4">
          <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm" aria-label="Títulos escolhidos">
            {titulos.map((t) => (
              <li key={t.id} className="flex justify-between gap-2 px-3 py-1.5">
                <span className="truncate">
                  {t.descricao}
                  <span className="block text-xs text-muted-foreground">vence {formatarData(t.vencimento)}</span>
                </span>
                <span className="numero whitespace-nowrap">{formatarMoeda(t.saldo)}</span>
              </li>
            ))}
          </ul>

          {acao === "baixar" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Data do pagamento" htmlFor="lote-data" obrigatorio>
                <Input id="lote-data" type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value)} />
              </Campo>
              <Campo rotulo="Conta" htmlFor="lote-conta" obrigatorio>
                <Select id="lote-conta" value={conta} onChange={(e) => setConta(e.target.value)}>
                  <option value="">Escolha…</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Forma" htmlFor="lote-forma">
                <Select id="lote-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
                  <option value="">—</option>
                  {FORMAS.map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <p className="text-xs text-muted-foreground sm:col-span-3">
                Cada título é baixado pelo saldo em aberto. Para pagar só uma parte, com juros, multa ou desconto, abra o título e use “{pagar ? "Pagar" : "Receber"}”.
              </p>
            </div>
          ) : null}

          {acao === "vencimento" ? (
            <Campo rotulo="Novo vencimento" htmlFor="lote-venc" obrigatorio>
              <Input id="lote-venc" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
          ) : null}

          {acao === "categoria" ? (
            <Campo rotulo="Categoria" htmlFor="lote-cat" obrigatorio>
              <Select id="lote-cat" value={valor} onChange={(e) => setValor(e.target.value)}>
                <option value="">Escolha…</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}

          {acao === "centro" ? (
            <Campo rotulo="Centro de custo" htmlFor="lote-centro">
              <Select id="lote-centro" value={valor} onChange={(e) => setValor(e.target.value)}>
                <option value="">Sem centro de custo</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}

          {acao === "reprovar" || acao === "cancelar" ? (
            <Campo rotulo={acao === "reprovar" ? "Por que foi reprovado?" : "Motivo do cancelamento"} htmlFor="lote-motivo" obrigatorio>
              <Textarea id="lote-motivo" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} />
            </Campo>
          ) : null}

          {acao === "aprovar" ? <p className="text-sm text-muted-foreground">Depois de aprovados, os pagamentos podem ser baixados. A aprovação fica registrada com o seu nome.</p> : null}

          {acao === "renegociar" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Os títulos escolhidos ficam como <strong>Renegociados</strong> (no histórico, sem contar de novo) e as parcelas do acordo passam a valer. Se o
                acordo tiver juros ou desconto, a diferença entra no resultado do mês.
              </p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Campo rotulo="Novo total" htmlFor="reneg-total">
                  <CampoValor id="reneg-total" valorInicial={total.toFixed(2)} aoMudar={setNovoTotal} />
                </Campo>
                <Campo rotulo="Parcelas" htmlFor="reneg-qtd">
                  <Input id="reneg-qtd" type="number" min={1} max={120} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} />
                </Campo>
                <Campo rotulo="1º vencimento" htmlFor="reneg-primeiro">
                  <Input id="reneg-primeiro" type="date" min={hoje} value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} />
                </Campo>
                <div className="flex items-end">
                  <Button variante="contorno" className="w-full" onClick={gerarParcelas}>
                    <Repeat /> Gerar parcelas
                  </Button>
                </div>
              </div>
              <ul className="space-y-2" aria-label="Parcelas do acordo">
                {parcelas.map((p, i) => (
                  <li key={i} className="grid grid-cols-[3rem_1fr_1fr] items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{i + 1}ª</span>
                    <Input
                      type="date"
                      aria-label={`Vencimento da parcela ${i + 1}`}
                      value={p.vencimento}
                      min={hoje}
                      onChange={(e) => setParcelas((l) => l.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))}
                    />
                    <Input
                      inputMode="decimal"
                      aria-label={`Valor da parcela ${i + 1}`}
                      value={p.valor}
                      onChange={(e) => setParcelas((l) => l.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))}
                    />
                  </li>
                ))}
              </ul>
              <p className="text-sm" data-testid="resumo-renegociacao">
                Acordo: <strong className="numero">{formatarMoeda(somaParcelas)}</strong> em {parcelas.length} parcela(s) · antes:{" "}
                <span className="numero">{formatarMoeda(total)}</span>
                {!somaParcelas.eq(total) ? (
                  <span className={somaParcelas.gt(total) ? "text-alerta-fg" : "text-sucesso"}>
                    {" "}
                    · {somaParcelas.gt(total) ? "juros/encargos" : "desconto"} de {formatarMoeda(somaParcelas.minus(total).abs())}
                  </span>
                ) : null}
              </p>
              <Campo rotulo="Descrição do acordo" htmlFor="reneg-desc" ajuda="Nome das parcelas novas nas listas e na busca.">
                <Input id="reneg-desc" value={descAcordo} maxLength={200} onChange={(e) => setDescAcordo(e.target.value)} />
              </Campo>
              <Campo rotulo="Motivo da renegociação" htmlFor="reneg-motivo" obrigatorio>
                <Textarea id="reneg-motivo" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: cliente pediu mais prazo" />
              </Campo>
            </div>
          ) : null}

          {erro ? (
            <p role="alert" className="rounded-lg bg-perigo-bg px-3 py-2 text-sm text-perigo-fg">
              {erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variante="fantasma" onClick={aoFechar}>
              Voltar
            </Button>
            <Button onClick={confirmar} disabled={pendente} variante={acao === "cancelar" || acao === "reprovar" ? "perigo" : "primario"}>
              {pendente ? <Loader2 className="animate-spin" /> : <Check />}{" "}
              {acao === "baixar"
                ? `Confirmar ${pagar ? "pagamento" : "recebimento"} de ${formatarMoeda(total)}`
                : acao === "renegociar"
                  ? `Confirmar acordo de ${formatarMoeda(somaParcelas)}`
                  : `Confirmar (${titulos.length})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
