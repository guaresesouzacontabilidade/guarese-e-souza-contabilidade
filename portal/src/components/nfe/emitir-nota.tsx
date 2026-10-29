"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calculator, Loader2, Plus, Send, Trash2, UserPlus, Truck } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormDestinatario, FormTransportador } from "./cadastros";
import { emitirNota, previaNota, type PedidoNfe, type PreviaNfe } from "@/lib/nfe-emissao/acoes";
import { DESTINO, FORMAS_PAGAMENTO, MODALIDADE_FRETE, TIPO_GUIA } from "@/lib/nfe-emissao/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";
import { UFS } from "@/lib/obrigacoes/rotulos";

export interface OpcaoEmitente {
  id: string;
  nome: string;
  serie: number;
  inscricao: string;
  uf: string;
}
export interface OpcaoOperacao {
  id: string;
  nome: string;
  natureza: string;
  cfop: string;
  destino: keyof typeof DESTINO;
  finalidade: number;
  freteIcmsRetido: boolean;
}
export interface OpcaoProduto {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  valorUnitario: number | null;
  pesoKg: number | null;
}
export interface OpcaoDestinatario {
  id: string;
  nome: string;
  documento: string | null;
  uf: string | null;
}
export interface OpcaoTransportador {
  id: string;
  nome: string;
  documento: string;
  placa: string | null;
  placaUf: string | null;
  rntc: string | null;
}

/**
 * Número digitado no padrão brasileiro: vírgula decimal e ponto de milhar
 * ("30.000" = trinta mil; "1,15"). Sem vírgula, um ponto seguido de 3
 * dígitos é milhar; outro ponto é decimal ("1.5").
 */
export function lerNumeroBR(t: string, casas: number): string | null {
  const s = t.trim().replace(/\s/g, "");
  if (!s) return null;
  let n: string;
  if (s.includes(",")) n = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, "");
  else n = s;
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  const [i, f = ""] = n.split(".");
  if (f.length > casas) return null;
  return f ? `${i.replace(/^0+(?=\d)/, "")}.${f}` : i.replace(/^0+(?=\d)/, "");
}
const mostrar = (n: string | null, casas = 4) =>
  n == null ? "" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });

interface Item {
  chave: number;
  produto_id: string;
  quantidade: string;
  valor: string;
}

const hoje = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

export function EmitirNota({
  empresaId,
  ambiente,
  emitentes,
  operacoes,
  produtos,
  destinatarios: destinatariosIniciais,
  transportadores: transportadoresIniciais,
  inicial,
  corrigir,
  vendaId,
  ordemId,
}: {
  empresaId: string;
  ambiente: "homologacao" | "producao";
  emitentes: OpcaoEmitente[];
  operacoes: OpcaoOperacao[];
  produtos: OpcaoProduto[];
  destinatarios: OpcaoDestinatario[];
  transportadores: OpcaoTransportador[];
  inicial?: PedidoNfe | null;
  corrigir?: { id: string; numero: number } | null;
  /** Venda da loja que deu origem à nota (fica ligada a ela). */
  vendaId?: string | null;
  /** Ordem de carregamento que deu origem à nota (fica faturada). */
  ordemId?: string | null;
}) {
  const router = useRouter();
  // Chave das linhas novas (as iniciais usam a posição)
  const seq = React.useRef(10_000);
  const [emitenteId, setEmitenteId] = React.useState(inicial?.emitente_id || (emitentes.length === 1 ? emitentes[0].id : ""));
  const [operacaoId, setOperacaoId] = React.useState(inicial?.operacao_id || (operacoes.length === 1 ? operacoes[0].id : ""));
  const [destinatarioId, setDestinatarioId] = React.useState(inicial?.destinatario_id ?? "");
  const [destinatarios, setDestinatarios] = React.useState(destinatariosIniciais);
  const [transportadores, setTransportadores] = React.useState(transportadoresIniciais);
  const [itens, setItens] = React.useState<Item[]>(() =>
    inicial?.itens?.length
      ? inicial.itens.map((i, n) => ({ chave: n + 1, produto_id: i.produto_id, quantidade: mostrar(i.quantidade), valor: mostrar(i.valor_unitario, 10) }))
      : [{ chave: 1, produto_id: produtos.length === 1 ? produtos[0].id : "", quantidade: "", valor: produtos.length === 1 && produtos[0].valorUnitario != null ? mostrar(String(produtos[0].valorUnitario), 10) : "" }],
  );
  const t0 = inicial?.transporte;
  const [modalidade, setModalidade] = React.useState(String(t0?.modalidade ?? 9));
  const [transportadorId, setTransportadorId] = React.useState(t0?.transportador_id ?? "");
  const [placa, setPlaca] = React.useState(t0?.placa ?? "");
  const [placaUf, setPlacaUf] = React.useState(t0?.placa_uf ?? "");
  const [rntc, setRntc] = React.useState(t0?.rntc ?? "");
  const [especie, setEspecie] = React.useState(t0?.especie ?? "");
  const [marca, setMarca] = React.useState(t0?.marca ?? "");
  const [volumes, setVolumes] = React.useState(t0?.volumes_quantidade ?? "");
  const [freteServico, setFreteServico] = React.useState(t0?.frete_servico ? mostrar(t0.frete_servico, 2) : "");
  const [reterMesmoAssim, setReterMesmoAssim] = React.useState(Boolean(t0?.reter_icms_frete));
  const [valores, setValores] = React.useState({
    frete: inicial?.frete ? mostrar(inicial.frete, 2) : "",
    seguro: inicial?.seguro ? mostrar(inicial.seguro, 2) : "",
    outras: inicial?.outras ? mostrar(inicial.outras, 2) : "",
    desconto: inicial?.desconto ? mostrar(inicial.desconto, 2) : "",
  });
  const p0 = inicial?.pagamento;
  const [forma, setForma] = React.useState(p0?.forma ?? "15");
  const [descricaoPag, setDescricaoPag] = React.useState(p0?.descricao ?? "");
  const [aPrazo, setAPrazo] = React.useState(Boolean(p0?.a_prazo));
  const [parcelas, setParcelas] = React.useState<{ vencimento: string; valor: string }[]>(
    p0?.parcelas?.map((p) => ({ vencimento: p.vencimento, valor: mostrar(p.valor, 2) })) ?? [],
  );
  const [referencias, setReferencias] = React.useState((inicial?.referencias ?? []).join("\n"));
  const [informacoes, setInformacoes] = React.useState(inicial?.informacoes ?? "");
  const [pedidoCompra, setPedidoCompra] = React.useState(inicial?.pedido_compra ?? "");
  const [novoCliente, setNovoCliente] = React.useState(false);
  const [novoTransp, setNovoTransp] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [previa, setPrevia] = React.useState<PreviaNfe | null>(null);
  const [ocupado, setOcupado] = React.useState<"previa" | "emitir" | null>(null);
  const [repetida, setRepetida] = React.useState(false);

  const operacao = operacoes.find((o) => o.id === operacaoId);
  // ICMS do frete retido: só quando o vendedor contrata o frete (CIF). Por conta do comprador
  // ou de terceiros, só se quem emite marcar; transporte próprio ou sem frete, nunca.
  const freteDeOutro = ["1", "2", "4"].includes(modalidade);
  const reterFrete = Boolean(operacao?.freteIcmsRetido) && (modalidade === "0" || (freteDeOutro && reterMesmoAssim));
  const emitente = emitentes.find((e) => e.id === emitenteId);
  const destinatario = destinatarios.find((d) => d.id === destinatarioId);
  const somaProdutos = itens.reduce((s, i) => {
    const q = lerNumeroBR(i.quantidade, 4);
    const v = lerNumeroBR(i.valor, 10);
    return q && v ? s + Math.round(Number(q) * Number(v) * 100) / 100 : s;
  }, 0);
  const extra = (k: keyof typeof valores) => Number(lerNumeroBR(valores[k], 2) ?? 0);
  const totalAproximado = somaProdutos + extra("frete") + extra("seguro") + extra("outras") - extra("desconto");

  const destinoErrado =
    operacao && emitente && destinatario
      ? operacao.destino === "interna" && destinatario.uf && destinatario.uf !== emitente.uf
        ? `A operação é para dentro do estado, mas o cliente é de ${destinatario.uf}.`
        : operacao.destino === "interestadual" && destinatario.uf === emitente.uf
          ? `A operação é para outro estado, mas o cliente é de ${destinatario.uf}.`
          : null
      : null;

  function montar(): PedidoNfe | string {
    if (!emitenteId) return "Escolha quem emite (inscrição estadual).";
    if (!operacaoId) return "Escolha a operação.";
    if (!destinatarioId) return "Escolha o cliente (comprador).";
    const its = [];
    for (const [n, i] of itens.entries()) {
      const p = produtos.find((x) => x.id === i.produto_id);
      if (!p) return `Escolha o produto da linha ${n + 1}.`;
      const q = lerNumeroBR(i.quantidade, 4);
      if (!q || Number(q) <= 0) return `Quantidade inválida em ${p.descricao} (até 4 casas decimais).`;
      const v = lerNumeroBR(i.valor, 10);
      if (!v || Number(v) <= 0) return `Preço inválido em ${p.descricao}.`;
      its.push({ produto_id: p.id, quantidade: q, valor_unitario: v });
    }
    const num = (k: keyof typeof valores) => {
      const v = lerNumeroBR(valores[k], 2);
      return v && Number(v) > 0 ? v : "";
    };
    let fs = "";
    if (reterFrete) {
      const v = lerNumeroBR(freteServico, 2);
      if (!v || Number(v) <= 0) return "Informe o valor do frete contratado (para o ICMS do frete).";
      fs = v;
    }
    const pars = [];
    if (aPrazo) {
      for (const p of parcelas) {
        const v = lerNumeroBR(p.valor, 2);
        if (!p.vencimento || !v) return "Confira o vencimento e o valor das parcelas.";
        pars.push({ vencimento: p.vencimento, valor: v });
      }
    }
    const refs = referencias
      .split(/\s+/)
      .map((r) => r.replace(/\D/g, ""))
      .filter(Boolean);
    if (refs.some((r) => r.length !== 44)) return "Cada chave de acesso referenciada tem 44 números.";
    return {
      emitente_id: emitenteId,
      operacao_id: operacaoId,
      destinatario_id: destinatarioId,
      itens: its,
      frete: num("frete"),
      seguro: num("seguro"),
      outras: num("outras"),
      desconto: num("desconto"),
      transporte: {
        modalidade: Number(modalidade),
        transportador_id: transportadorId || "",
        placa: placa.trim(),
        placa_uf: placaUf,
        rntc: rntc.trim(),
        volumes_quantidade: volumes.replace(/\D/g, ""),
        especie: especie.trim(),
        marca: marca.trim(),
        frete_servico: fs,
        reter_icms_frete: freteDeOutro && reterMesmoAssim,
      },
      pagamento: { forma, descricao: descricaoPag.trim(), a_prazo: aPrazo, parcelas: pars },
      referencias: refs,
      informacoes: informacoes.trim(),
      pedido_compra: pedidoCompra.trim(),
    };
  }

  async function conferir() {
    setErro(null);
    const p = montar();
    if (typeof p === "string") {
      setErro(p);
      return;
    }
    setOcupado("previa");
    const r = await previaNota(empresaId, p);
    setOcupado(null);
    if (r.ok && r.dados) setPrevia(r.dados);
    else setErro(r.mensagem ?? "Não foi possível calcular a nota.");
  }

  async function emitir() {
    const p = montar();
    if (typeof p === "string") {
      setErro(p);
      setPrevia(null);
      return;
    }
    setOcupado("emitir");
    const r = await emitirNota(empresaId, { ...p, confirmar_repetida: repetida }, corrigir?.id ?? null, vendaId ?? null, ordemId ?? null);
    setOcupado(null);
    if (r.ok && r.dados?.id) {
      toast.success(r.mensagem ?? "Nota enviada à SEFAZ.");
      router.push(`/e/${empresaId}/notas-produto/${r.dados.id}`);
      return;
    }
    setPrevia(null);
    if (r.dados?.repetida) setRepetida(true);
    setErro(r.mensagem ?? "Não foi possível emitir a nota.");
  }

  const atualizarItem = (chave: number, dados: Partial<Item>) => setItens((l) => l.map((i) => (i.chave === chave ? { ...i, ...dados } : i)));

  return (
    <div className="space-y-6">
      {ambiente === "homologacao" ? (
        <Alerta tom="info" titulo="Emissão em teste (homologação)">
          Esta empresa ainda emite no ambiente de testes da SEFAZ: a nota não tem valor fiscal e o nome do comprador sai trocado pelo texto exigido pela SEFAZ.
        </Alerta>
      ) : null}
      {corrigir ? (
        <Alerta tom="alerta" titulo={`Correção da nota nº ${corrigir.numero}`}>
          A nota rejeitada vai de novo para a SEFAZ com o mesmo número, com os dados abaixo.
        </Alerta>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Campo rotulo="Quem emite" htmlFor="emitente" obrigatorio ajuda={emitente ? `Inscrição ${emitente.inscricao} — série ${emitente.serie} — ${emitente.uf}` : undefined}>
          <Select id="emitente" value={emitenteId} onChange={(e) => setEmitenteId(e.target.value)} disabled={Boolean(corrigir)}>
            <option value="">Escolha...</option>
            {emitentes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome} (IE {e.inscricao})
              </option>
            ))}
          </Select>
        </Campo>
        <Campo
          rotulo="Operação"
          htmlFor="operacao"
          obrigatorio
          ajuda={operacao ? `${operacao.natureza} — CFOP ${operacao.cfop} — ${DESTINO[operacao.destino]}. Impostos definidos pelo escritório.` : "As regras fiscais de cada operação são cadastradas pelo escritório."}
        >
          <Select id="operacao" value={operacaoId} onChange={(e) => setOperacaoId(e.target.value)}>
            <option value="">Escolha...</option>
            {operacoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Select>
        </Campo>
      </section>

      <section className="space-y-2">
        <Campo rotulo="Cliente (comprador)" htmlFor="destinatario" obrigatorio erro={destinoErrado ?? undefined}>
          <div className="flex gap-2">
            <Select id="destinatario" value={destinatarioId} onChange={(e) => setDestinatarioId(e.target.value)}>
              <option value="">Escolha...</option>
              {destinatarios.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                  {d.documento ? ` — ${formatarDocumento(d.documento)}` : ""}
                  {d.uf ? ` — ${d.uf}` : ""}
                </option>
              ))}
            </Select>
            <Button type="button" variante="contorno" onClick={() => setNovoCliente(true)}>
              <UserPlus /> Novo
            </Button>
          </div>
        </Campo>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-titulo">Produtos</h2>
        <div className="space-y-3">
          {itens.map((i, n) => {
            const p = produtos.find((x) => x.id === i.produto_id);
            const q = lerNumeroBR(i.quantidade, 4);
            const v = lerNumeroBR(i.valor, 10);
            return (
              <div key={i.chave} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_9rem_9rem_8rem_auto] sm:items-end [&>*]:min-w-0">
                <Campo rotulo={`Produto ${n + 1}`} htmlFor={`p-${i.chave}`}>
                  <Select
                    id={`p-${i.chave}`}
                    value={i.produto_id}
                    onChange={(e) => {
                      const novo = produtos.find((x) => x.id === e.target.value);
                      atualizarItem(i.chave, { produto_id: e.target.value, valor: i.valor || (novo?.valorUnitario != null ? mostrar(String(novo.valorUnitario), 10) : "") });
                    }}
                  >
                    <option value="">Escolha...</option>
                    {produtos.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.descricao} ({x.unidade})
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo={`Quantidade${p ? ` (${p.unidade})` : ""}`} htmlFor={`q-${i.chave}`} ajuda={q ? `= ${mostrar(q)}${p?.pesoKg ? ` — ${mostrar(String(Number(q) * p.pesoKg), 3)} kg` : ""}` : undefined}>
                  <Input id={`q-${i.chave}`} inputMode="decimal" value={i.quantidade} onChange={(e) => atualizarItem(i.chave, { quantidade: e.target.value })} />
                </Campo>
                <Campo rotulo="Preço unitário (R$)" htmlFor={`v-${i.chave}`}>
                  <Input id={`v-${i.chave}`} inputMode="decimal" value={i.valor} onChange={(e) => atualizarItem(i.chave, { valor: e.target.value })} />
                </Campo>
                <div className="pb-2 text-right text-sm numero">{q && v ? formatarMoeda(Math.round(Number(q) * Number(v) * 100) / 100) : "—"}</div>
                <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setItens((l) => (l.length > 1 ? l.filter((x) => x.chave !== i.chave) : l))} title="Remover" disabled={itens.length === 1}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
        <Button type="button" variante="contorno" tamanho="sm" onClick={() => setItens((l) => [...l, { chave: seq.current++, produto_id: "", quantidade: "", valor: "" }])}>
          <Plus /> Adicionar produto
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-titulo">Transporte</h2>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Campo rotulo="Frete" htmlFor="modalidade">
            <Select id="modalidade" value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
              {Object.entries(MODALIDADE_FRETE).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Select>
          </Campo>
          {modalidade !== "9" ? (
            <Campo rotulo="Transportador" htmlFor="transportador" ajuda="Motorista autônomo ou transportadora (opcional no transporte próprio).">
              <div className="flex gap-2">
                <Select
                  id="transportador"
                  value={transportadorId}
                  onChange={(e) => {
                    setTransportadorId(e.target.value);
                    const t = transportadores.find((x) => x.id === e.target.value);
                    if (t?.placa && !placa) setPlaca(t.placa);
                    if (t?.placaUf && !placaUf) setPlacaUf(t.placaUf);
                    if (t?.rntc && !rntc) setRntc(t.rntc);
                  }}
                >
                  <option value="">Nenhum</option>
                  {transportadores.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} — {formatarDocumento(t.documento)}
                    </option>
                  ))}
                </Select>
                <Button type="button" variante="contorno" onClick={() => setNovoTransp(true)}>
                  <Truck /> Novo
                </Button>
              </div>
            </Campo>
          ) : null}
        </div>
        {modalidade !== "9" ? (
          <div className="grid gap-3 sm:grid-cols-6 [&>*]:min-w-0">
            <Campo rotulo="Placa" htmlFor="placa" className="sm:col-span-2">
              <Input id="placa" value={placa} maxLength={8} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
            </Campo>
            <Campo rotulo="UF da placa" htmlFor="placa-uf">
              <Select id="placa-uf" value={placaUf} onChange={(e) => setPlacaUf(e.target.value)}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Espécie" htmlFor="especie" ajuda="Ex.: GRANEL, SACOS">
              <Input id="especie" value={especie} maxLength={60} onChange={(e) => setEspecie(e.target.value)} />
            </Campo>
            <Campo rotulo="Volumes" htmlFor="volumes">
              <Input id="volumes" inputMode="numeric" value={volumes} onChange={(e) => setVolumes(e.target.value)} />
            </Campo>
            <Campo rotulo="Marca" htmlFor="marca">
              <Input id="marca" value={marca} maxLength={60} onChange={(e) => setMarca(e.target.value)} />
            </Campo>
          </div>
        ) : null}
        {operacao?.freteIcmsRetido && freteDeOutro ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p>
              Frete {modalidade === "2" ? "por conta de terceiros" : "por conta do comprador"}: quem contrata o transporte é que responde pelo ICMS do frete, então ele{" "}
              <strong>não sai nesta nota</strong>.
            </p>
            <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={reterMesmoAssim} onChange={(e) => setReterMesmoAssim(e.target.checked)} className="mt-0.5" />
              O vendedor vai recolher o ICMS deste frete mesmo assim (só quando a lei do estado mandar)
            </label>
          </div>
        ) : operacao?.freteIcmsRetido && modalidade !== "0" ? (
          <p className="text-sm text-muted-foreground">Sem frete contratado pelo vendedor: o ICMS do frete não sai nesta nota.</p>
        ) : null}
        {reterFrete ? (
          <Campo
            rotulo="Valor do frete contratado (R$)"
            htmlFor="frete-servico"
            obrigatorio
            ajuda="Valor pago ao transportador. O portal calcula o ICMS do frete retido, que vira uma guia depois da autorização."
          >
            <Input id="frete-servico" inputMode="decimal" value={freteServico} onChange={(e) => setFreteServico(e.target.value)} className="max-w-xs" />
          </Campo>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-titulo">Valores da nota</h2>
        <div className="grid gap-3 sm:grid-cols-4 [&>*]:min-w-0">
          {(
            [
              ["frete", "Frete cobrado do cliente"],
              ["seguro", "Seguro"],
              ["outras", "Outras despesas"],
              ["desconto", "Desconto"],
            ] as const
          ).map(([k, r]) => (
            <Campo key={k} rotulo={`${r} (R$)`} htmlFor={`v-${k}`}>
              <Input id={`v-${k}`} inputMode="decimal" value={valores[k]} onChange={(e) => setValores({ ...valores, [k]: e.target.value })} />
            </Campo>
          ))}
        </div>
        <p className="text-sm">
          Total aproximado da nota: <strong className="numero">{formatarMoeda(totalAproximado)}</strong>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-titulo">Pagamento</h2>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Campo rotulo="Forma de pagamento" htmlFor="forma">
            <Select id="forma" value={forma} onChange={(e) => setForma(e.target.value)}>
              {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Select>
          </Campo>
          {forma === "99" ? (
            <Campo rotulo="Descreva a forma" htmlFor="forma-desc">
              <Input id="forma-desc" maxLength={60} value={descricaoPag} onChange={(e) => setDescricaoPag(e.target.value)} />
            </Campo>
          ) : forma !== "90" ? (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox
                checked={aPrazo}
                onChange={(e) => {
                  setAPrazo(e.target.checked);
                  if (e.target.checked && !parcelas.length) setParcelas([{ vencimento: hoje(), valor: mostrar(totalAproximado.toFixed(2), 2) }]);
                }}
              />
              Venda a prazo (com parcelas/duplicatas)
            </label>
          ) : null}
        </div>
        {aPrazo && forma !== "90" ? (
          <div className="space-y-2">
            {parcelas.map((p, i) => (
              <div key={i} className="grid grid-cols-[3rem_1fr_1fr_auto] items-end gap-2">
                <span className="pb-2 text-sm numero">{String(i + 1).padStart(3, "0")}</span>
                <Input type="date" value={p.vencimento} onChange={(e) => setParcelas(parcelas.map((x, j) => (j === i ? { ...x, vencimento: e.target.value } : x)))} aria-label="Vencimento" />
                <Input inputMode="decimal" value={p.valor} onChange={(e) => setParcelas(parcelas.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} aria-label="Valor" />
                <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setParcelas(parcelas.filter((_, j) => j !== i))} title="Remover parcela">
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" variante="contorno" tamanho="sm" onClick={() => setParcelas([...parcelas, { vencimento: hoje(), valor: "" }])}>
              <Plus /> Parcela
            </Button>
            <p className="text-xs text-muted-foreground">A soma das parcelas precisa ser igual ao total da nota.</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        {operacao && operacao.finalidade !== 1 ? (
          <Campo rotulo="Chave da nota referenciada" htmlFor="refs" obrigatorio={operacao.finalidade === 4} ajuda="Na devolução, a chave (44 números) da nota que está sendo devolvida.">
            <Textarea id="refs" rows={2} value={referencias} onChange={(e) => setReferencias(e.target.value)} />
          </Campo>
        ) : null}
        <Campo rotulo="Informações complementares" htmlFor="info" ajuda="Somadas ao texto padrão da operação. FUNRURAL, FETHAB e frete entram sozinhos.">
          <Textarea id="info" rows={3} maxLength={2000} value={informacoes} onChange={(e) => setInformacoes(e.target.value)} />
        </Campo>
        <Campo rotulo="Pedido de compra do cliente" htmlFor="pedido">
          <Input id="pedido" maxLength={15} value={pedidoCompra} onChange={(e) => setPedidoCompra(e.target.value)} />
        </Campo>
      </section>

      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
      {repetida ? (
        <Alerta tom="alerta" titulo="Nota parecida emitida há pouco">
          Se for mesmo uma nova venda, clique de novo em “Conferir e emitir” e confirme.
        </Alerta>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={conferir} disabled={Boolean(ocupado) || Boolean(destinoErrado)}>
          {ocupado === "previa" ? <Loader2 className="animate-spin" /> : <Calculator />} Conferir e emitir
        </Button>
      </div>

      <Dialog open={Boolean(previa)} onOpenChange={(v) => !v && !ocupado && setPrevia(null)}>
        {previa ? (
          <DialogContent titulo="Confira os valores antes de emitir" descricao="Cálculo com as regras da operação cadastradas pelo escritório." largura="lg">
            <div className="space-y-4 text-sm">
              <Table>
                <THead>
                  <Tr>
                    <Th>Produto</Th>
                    <Th className="text-right">Qtd.</Th>
                    <Th className="text-right">Valor</Th>
                    <Th>CFOP / CST</Th>
                    <Th className="text-right">ICMS</Th>
                  </Tr>
                </THead>
                <TBody>
                  {previa.itens.map((i, n) => (
                    <Tr key={n}>
                      <Td>
                        {i.descricao}
                        {i.operacao ? <span className="block text-xs text-muted-foreground">Regra própria do produto: {i.operacao}</span> : null}
                      </Td>
                      <Td className="text-right numero">
                        {mostrar(i.quantidade)} {i.unidade}
                      </Td>
                      <Td className="text-right numero">{formatarMoeda(i.valor)}</Td>
                      <Td className="numero">
                        {i.cfop} / {i.icms}
                      </Td>
                      <Td className="text-right numero">{formatarMoeda(i.vICMS)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                {(
                  [
                    ["Produtos", previa.totais.vProd],
                    ["ICMS", previa.totais.vICMS],
                    ["PIS", previa.totais.vPIS],
                    ["COFINS", previa.totais.vCOFINS],
                    ["DIFAL (destino)", previa.totais.vICMSUFDest],
                    ["FCP (destino)", previa.totais.vFCPUFDest],
                    ["IBS (teste 2026)", previa.totais.vIBS],
                    ["CBS (teste 2026)", previa.totais.vCBS],
                  ] as const
                )
                  .filter(([, v]) => v != null && v !== "0.00")
                  .map(([r, v]) => (
                    <React.Fragment key={r}>
                      <dt className="text-muted-foreground">{r}</dt>
                      <dd className="text-right numero">{formatarMoeda(v!)}</dd>
                    </React.Fragment>
                  ))}
                <dt className="font-semibold">Total da nota</dt>
                <dd className="text-right font-semibold numero">{formatarMoeda(previa.totais.vNF)}</dd>
              </dl>
              {previa.guias.length ? (
                <Alerta tom="info" titulo="Guias que esta nota vai gerar">
                  <ul className="list-disc pl-4">
                    {previa.guias.map((g, n) => (
                      <li key={n}>
                        {TIPO_GUIA[g.tipo] ?? g.descricao}
                        {g.tipo === "contribuicao" ? ` (${g.descricao})` : ""} — {g.uf}: <strong className="numero">{formatarMoeda(g.valor)}</strong>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-1 block text-xs">Valores calculados pelo portal. A guia oficial é gerada no site da SEFAZ (ou GNRE), que confere o valor.</span>
                </Alerta>
              ) : null}
              {previa.textos.length ? <p className="text-xs text-muted-foreground">Informações automáticas na nota: {previa.textos.join(" ")}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variante="contorno" onClick={() => setPrevia(null)} disabled={Boolean(ocupado)}>
                  Voltar e corrigir
                </Button>
                <Button type="button" onClick={emitir} disabled={Boolean(ocupado)}>
                  {ocupado === "emitir" ? <Loader2 className="animate-spin" /> : <Send />} {ambiente === "homologacao" ? "Emitir nota de teste" : "Emitir NF-e"}
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={novoCliente} onOpenChange={setNovoCliente}>
        <DialogContent titulo="Novo cliente" descricao="O cliente fica cadastrado para as próximas notas." largura="lg">
          <FormDestinatario
            empresaId={empresaId}
            aoSalvar={(id) => {
              setNovoCliente(false);
              setDestinatarioId(id);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={novoTransp} onOpenChange={setNovoTransp}>
        <DialogContent titulo="Novo transportador" largura="lg">
          <FormTransportador
            empresaId={empresaId}
            aoSalvar={(id) => {
              setNovoTransp(false);
              setTransportadorId(id);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      {/* As listas vêm do servidor: depois de cadastrar, a página é atualizada */}
      <SincronizarListas destinatarios={destinatariosIniciais} transportadores={transportadoresIniciais} setDestinatarios={setDestinatarios} setTransportadores={setTransportadores} />
    </div>
  );
}

function SincronizarListas({
  destinatarios,
  transportadores,
  setDestinatarios,
  setTransportadores,
}: {
  destinatarios: OpcaoDestinatario[];
  transportadores: OpcaoTransportador[];
  setDestinatarios: (d: OpcaoDestinatario[]) => void;
  setTransportadores: (t: OpcaoTransportador[]) => void;
}) {
  React.useEffect(() => setDestinatarios(destinatarios), [destinatarios, setDestinatarios]);
  React.useEffect(() => setTransportadores(transportadores), [transportadores, setTransportadores]);
  return null;
}
