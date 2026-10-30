"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownUp, ClipboardCheck, PackagePlus, Pencil, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { excluirProdutoLoja, lancarEstoque, registrarInventario, salvarProdutoLoja, darEntradaNota } from "@/lib/gestao/acoes";
import { UNIDADES_LOJA, formatarQuantidade, modoMedida, quantidadePorPecas, un } from "@/lib/gestao/rotulos";

export interface ProdutoLoja {
  id: string;
  codigo: string;
  descricao: string;
  ncm: string;
  cest: string | null;
  gtin: string | null;
  unidade: string;
  grupo: string | null;
  valor_unitario: string | null;
  preco_custo: string | null;
  controla_estoque: boolean;
  estoque_atual: string;
  estoque_minimo: string | null;
  custo_medio: string | null;
  ativo: boolean;
  espessura_cm: string | null;
  largura_cm: string | null;
  comprimento_m: string | null;
}

const num = (v: string | null | undefined, casas = 4) => (v == null || v === "" ? "" : formatarQuantidade(v, casas));

/** Cadastro e edição do produto (com as medidas da peça para madeira). */
export function FormProduto({ empresaId, produto, grupos, aoSalvar }: { empresaId: string; produto?: ProdutoLoja; grupos: string[]; aoSalvar?: () => void }) {
  const [unidade, setUnidade] = React.useState(produto?.unidade ?? "UN");
  const [esp, setEsp] = React.useState(num(produto?.espessura_cm, 2));
  const [larg, setLarg] = React.useState(num(produto?.largura_cm, 2));
  const [comp, setComp] = React.useState(num(produto?.comprimento_m, 3));
  const [preco, setPreco] = React.useState(produto?.valor_unitario ? formatarMoeda(produto.valor_unitario, { semSimbolo: true }) : "");
  const medidas = unidade === "M3" || unidade === "M" || unidade === "ML";
  const idp = produto?.id ?? "novo";

  // Prévia: quanto custa uma peça no preço do m³ (ou do metro)
  const previa = (() => {
    const p = lerValorBR(preco);
    const q = quantidadePorPecas({ unidade, espessura_cm: lerValorBR(esp)?.toString() ?? null, largura_cm: lerValorBR(larg)?.toString() ?? null }, 1, lerValorBR(comp)?.toString() ?? null);
    if (!p || !q || modoMedida({ unidade, espessura_cm: esp || null, largura_cm: larg || null }) === "direto") return null;
    return { q, valor: q.times(p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) };
  })();

  return (
    <FormularioAcao acao={salvarProdutoLoja.bind(null, empresaId, produto?.id ?? null)} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Campo rotulo="Descrição do produto" htmlFor={`descricao-${idp}`} obrigatorio erro={estado.erros?.descricao}>
              <Input id={`descricao-${idp}`} name="descricao" defaultValue={produto?.descricao} maxLength={120} placeholder="Ex.: Caibro de eucalipto 5 × 6 cm" />
            </Campo>
            <Campo rotulo="Código" htmlFor={`codigo-${idp}`} ajuda="Em branco: automático.">
              <Input id={`codigo-${idp}`} name="codigo" defaultValue={produto?.codigo} maxLength={60} />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Grupo" htmlFor={`grupo-${idp}`} ajuda="Ex.: Eucalipto, Pinus, Tratada.">
              <Input id={`grupo-${idp}`} name="grupo" defaultValue={produto?.grupo ?? ""} list={`grupos-${idp}`} maxLength={60} />
              <datalist id={`grupos-${idp}`}>
                {grupos.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Campo>
            <Campo rotulo="Unidade de venda" htmlFor={`unidade-${idp}`} obrigatorio erro={estado.erros?.unidade}>
              <Select id={`unidade-${idp}`} name="unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                {UNIDADES_LOJA.map((u) => (
                  <option key={u.valor} value={u.valor}>
                    {u.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="NCM" htmlFor={`ncm-${idp}`} obrigatorio erro={estado.erros?.ncm} ajuda="8 números. Na dúvida, o escritório ajuda.">
              <Input id={`ncm-${idp}`} name="ncm" defaultValue={produto?.ncm} inputMode="numeric" maxLength={10} />
            </Campo>
          </div>
          {medidas ? (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="mb-2 text-sm font-medium">Medidas da peça {unidade === "M3" ? "(para calcular os m³ pela quantidade de peças)" : "(comprimento padrão)"}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {unidade === "M3" ? (
                  <>
                    <Campo rotulo="Espessura (cm)" htmlFor={`esp-${idp}`}>
                      <Input id={`esp-${idp}`} name="espessura_cm" value={esp} onChange={(e) => setEsp(e.target.value)} inputMode="decimal" />
                    </Campo>
                    <Campo rotulo="Largura (cm)" htmlFor={`larg-${idp}`} erro={estado.erros?.largura_cm}>
                      <Input id={`larg-${idp}`} name="largura_cm" value={larg} onChange={(e) => setLarg(e.target.value)} inputMode="decimal" />
                    </Campo>
                  </>
                ) : null}
                <Campo rotulo="Comprimento padrão (m)" htmlFor={`comp-${idp}`} ajuda="Pode mudar na hora da venda.">
                  <Input id={`comp-${idp}`} name="comprimento_m" value={comp} onChange={(e) => setComp(e.target.value)} inputMode="decimal" />
                </Campo>
              </div>
              {previa ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  1 peça = {formatarQuantidade(previa.q)} {un(unidade)} → {formatarMoeda(previa.valor)} no preço de venda.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo={`Preço de venda (por ${un(unidade)})`} htmlFor={`preco-${idp}`} obrigatorio erro={estado.erros?.valor_unitario}>
              <CampoValor id={`preco-${idp}`} name="valor_unitario" valorInicial={produto?.valor_unitario} aoMudar={setPreco} />
            </Campo>
            <Campo rotulo={`Custo de compra (por ${un(unidade)})`} htmlFor={`custo-${idp}`} ajuda="Atualiza sozinho na entrada por nota.">
              <CampoValor id={`custo-${idp}`} name="preco_custo" valorInicial={produto?.preco_custo} />
            </Campo>
            <Campo rotulo="Estoque mínimo" htmlFor={`min-${idp}`} ajuda="Avisa quando ficar abaixo.">
              <Input id={`min-${idp}`} name="estoque_minimo" defaultValue={num(produto?.estoque_minimo)} inputMode="decimal" />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Código de barras (GTIN)" htmlFor={`gtin-${idp}`}>
              <Input id={`gtin-${idp}`} name="gtin" defaultValue={produto?.gtin ?? ""} inputMode="numeric" maxLength={14} />
            </Campo>
            <Campo rotulo="CEST" htmlFor={`cest-${idp}`} ajuda="Só se houver substituição tributária.">
              <Input id={`cest-${idp}`} name="cest" defaultValue={produto?.cest ?? ""} inputMode="numeric" maxLength={9} />
            </Campo>
            <Campo rotulo="Situação" htmlFor={`ativo-${idp}`}>
              <Select id={`ativo-${idp}`} name="ativo" defaultValue={produto && !produto.ativo ? "off" : "on"}>
                <option value="on">Ativo (aparece na venda)</option>
                <option value="off">Inativo</option>
              </Select>
            </Campo>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="controla_estoque" defaultChecked={produto ? produto.controla_estoque : true} />
            Controlar o estoque deste produto
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{produto ? "Salvar alterações" : "Cadastrar produto"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function DialogoProduto({ empresaId, produto, grupos }: { empresaId: string; produto?: ProdutoLoja; grupos: string[] }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {produto ? (
          <Button variante="contorno">
            <Pencil /> Editar
          </Button>
        ) : (
          <Button>
            <PackagePlus /> Novo produto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={produto ? "Editar produto" : "Novo produto"} largura="lg">
        <FormProduto empresaId={empresaId} produto={produto} grupos={grupos} aoSalvar={() => setAberto(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Excluir o produto (com histórico, o banco só desativa) e voltar para a lista. */
export function ExcluirProduto({ empresaId, produto }: { empresaId: string; produto: Pick<ProdutoLoja, "id" | "descricao"> }) {
  const router = useRouter();
  return (
    <BotaoAcao
      variante="contorno"
      acao={() => excluirProdutoLoja(empresaId, produto.id)}
      aoSucesso={() => router.push(`/e/${empresaId}/loja/produtos`)}
      confirmar={{
        titulo: `Excluir "${produto.descricao}"?`,
        descricao:
          "Se o produto nunca foi vendido, comprado por nota nem saiu em nota fiscal, ele é apagado, junto com o estoque lançado à mão ou pela planilha. Se já tem esse histórico, ele é desativado: sai das listas, do caixa e das notas, e as vendas e notas antigas continuam guardadas (dá para reativar em Inativos).",
        textoConfirmar: "Excluir produto",
        perigo: true,
      }}
    >
      <Trash2 /> Excluir
    </BotaoAcao>
  );
}

/** Entrada ou saída manual do estoque (com a conta da cubagem pelas peças). */
export function LancarEstoque({ empresaId, produtos, produtoId }: { empresaId: string; produtos: ProdutoLoja[]; produtoId?: string }) {
  const [aberto, setAberto] = React.useState(false);
  const [tipo, setTipo] = React.useState("entrada_manual");
  const [pid, setPid] = React.useState(produtoId ?? "");
  const [pecas, setPecas] = React.useState("");
  const [comp, setComp] = React.useState("");
  const [qtd, setQtd] = React.useState("");
  const produto = produtos.find((p) => p.id === pid);
  const modo = produto ? modoMedida(produto) : "direto";
  const calculada = produto && modo !== "direto" && pecas ? quantidadePorPecas(produto, lerValorBR(pecas) ?? 0, comp ? (lerValorBR(comp)?.toString() ?? null) : null) : null;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno">
          <ArrowDownUp /> Entrada ou saída
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Entrada ou saída de estoque" descricao="Para compras com nota, use “Entrada de mercadorias”: importe o XML ou o PDF e o custo vem certinho da nota." largura="lg">
        <FormularioAcao acao={lancarEstoque.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo" htmlFor="tipo-mov">
                  <Select id="tipo-mov" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="entrada_manual">Entrada (produção, compra sem nota, devolução)</option>
                    <option value="saida_manual">Saída (perda, quebra, uso próprio)</option>
                  </Select>
                </Campo>
                <Campo rotulo="Produto" htmlFor="produto-mov" obrigatorio>
                  <Select id="produto-mov" name="produto_id" value={pid} onChange={(e) => setPid(e.target.value)}>
                    <option value="">Escolha...</option>
                    {produtos
                      .filter((p) => p.controla_estoque)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.descricao} ({formatarQuantidade(p.estoque_atual)} {un(p.unidade)})
                        </option>
                      ))}
                  </Select>
                </Campo>
              </div>
              {produto && modo !== "direto" ? (
                <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-3">
                  <Campo rotulo="Peças" htmlFor="pecas-mov">
                    <Input id="pecas-mov" value={pecas} onChange={(e) => setPecas(e.target.value)} inputMode="decimal" />
                  </Campo>
                  <Campo rotulo="Comprimento (m)" htmlFor="comp-mov">
                    <Input id="comp-mov" value={comp} onChange={(e) => setComp(e.target.value)} placeholder={produto.comprimento_m ? formatarQuantidade(produto.comprimento_m, 3) : ""} inputMode="decimal" />
                  </Campo>
                  <div className="self-end pb-2 text-sm">
                    {calculada ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => setQtd(formatarQuantidade(calculada))}>
                        = {formatarQuantidade(calculada)} {un(produto.unidade)} (usar)
                      </button>
                    ) : (
                      <span className="text-muted-foreground">Informe as peças para calcular.</span>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo={`Quantidade${produto ? ` (${un(produto.unidade)})` : ""}`} htmlFor="qtd-mov" obrigatorio erro={estado.erros?.quantidade}>
                  <Input id="qtd-mov" name="quantidade" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
                </Campo>
                {tipo === "entrada_manual" ? (
                  <Campo rotulo="Custo unitário (opcional)" htmlFor="custo-mov" ajuda="Entra no custo médio.">
                    <CampoValor id="custo-mov" name="custo_unitario" />
                  </Campo>
                ) : null}
              </div>
              <Campo rotulo="Observação" htmlFor="obs-mov">
                <Input id="obs-mov" name="observacao" maxLength={300} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Inventário: digita o que foi contado e o sistema ajusta a diferença. */
export function Inventario({ empresaId, produtos }: { empresaId: string; produtos: ProdutoLoja[] }) {
  const router = useRouter();
  const [contagem, setContagem] = React.useState<Record<string, string>>({});
  const [obs, setObs] = React.useState("");
  const [filtro, setFiltro] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const lista = produtos.filter((p) => p.controla_estoque && (!filtro || `${p.descricao} ${p.grupo ?? ""} ${p.codigo}`.toLowerCase().includes(filtro.toLowerCase())));
  const preenchidos = Object.entries(contagem).filter(([, v]) => v.trim() !== "");

  async function salvar() {
    setEnviando(true);
    const r = await registrarInventario(
      empresaId,
      preenchidos.map(([produto_id, contado]) => ({ produto_id, contado })),
      obs,
    );
    setEnviando(false);
    if (r.ok) {
      toast.success(r.mensagem);
      setContagem({});
      router.refresh();
    } else toast.error(r.mensagem);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Filtrar" htmlFor="filtro-inv" className="w-full sm:w-72">
          <Input id="filtro-inv" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Produto, grupo ou código" />
        </Campo>
        <Campo rotulo="Observação" htmlFor="obs-inv" className="w-full sm:w-80">
          <Input id="obs-inv" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: contagem do pátio de outubro" maxLength={300} />
        </Campo>
      </div>
      <Table>
        <THead>
          <tr>
            <Th>Produto</Th>
            <Th className="text-right">No sistema</Th>
            <Th className="w-40 text-right">Contado</Th>
            <Th className="text-right">Diferença</Th>
          </tr>
        </THead>
        <TBody>
          {lista.map((p) => {
            const c = contagem[p.id] ?? "";
            const lido = c ? lerValorBR(c) : null;
            const dif = lido ? lido.minus(p.estoque_atual) : null;
            return (
              <Tr key={p.id}>
                <Td>
                  {p.descricao}
                  <span className="block text-xs text-muted-foreground">
                    {p.codigo}
                    {p.grupo ? ` · ${p.grupo}` : ""}
                  </span>
                </Td>
                <Td className="text-right numero">
                  {formatarQuantidade(p.estoque_atual)} {un(p.unidade)}
                </Td>
                <Td className="text-right">
                  <Input
                    aria-label={`Contado de ${p.descricao}`}
                    value={c}
                    onChange={(e) => setContagem((m) => ({ ...m, [p.id]: e.target.value }))}
                    inputMode="decimal"
                    className="text-right"
                  />
                </Td>
                <Td className={`text-right numero ${dif && !dif.isZero() ? (dif.gt(0) ? "text-sucesso" : "text-perigo") : "text-muted-foreground"}`}>
                  {dif ? (dif.isZero() ? "ok" : `${dif.gt(0) ? "+" : ""}${formatarQuantidade(dif)}`) : "—"}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{preenchidos.length} produto(s) contado(s). Os que ficarem em branco não mudam.</p>
        <Button onClick={salvar} disabled={!preenchidos.length || enviando}>
          <ClipboardCheck /> {enviando ? "Registrando..." : "Registrar inventário"}
        </Button>
      </div>
    </div>
  );
}

export interface ItemNota {
  numero_item: number;
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  gtin: string | null;
  unidade: string | null;
  quantidade: string | null;
  valor_unitario: string | null;
  valor_total: string | null;
  valor_desconto: string | null;
}

/** Vínculo guardado: este código do fornecedor é este produto da loja. */
export interface VinculoNota {
  codigo: string;
  produto_id: string;
  fator: string;
}

type OrigemSugestao = "vinculo" | "gtin" | "codigo" | null;

interface LinhaEntrada {
  item: ItemNota;
  /** id do produto, "novo" (criar a partir do item) ou "" (não dar entrada) */
  escolha: string;
  origem: OrigemSugestao;
  fator: string;
  quantidade: string;
  custo: string;
  lembrar: boolean;
  novo: { descricao: string; ncm: string; unidade: string; preco: string; grupo: string };
}

const ORIGEM: Record<Exclude<OrigemSugestao, null>, string> = {
  vinculo: "Ligado na nota anterior",
  gtin: "Mesmo código de barras",
  codigo: "Mesmo código ou nome",
};

/** Quantidade e custo na unidade da loja: quantidade da nota × fator; custo = valor do item (sem desconto) ÷ quantidade. */
function converter(item: ItemNota, fatorTexto: string) {
  const fator = lerValorBR(fatorTexto);
  const qtdNota = item.quantidade ? new Decimal(item.quantidade) : null;
  if (!fator || fator.lte(0) || !qtdNota || qtdNota.lte(0)) return null;
  const qtd = qtdNota.times(fator).toDecimalPlaces(4);
  const valor = new Decimal(item.valor_total ?? 0).minus(item.valor_desconto ?? 0);
  const custo = qtd.gt(0) ? Decimal.max(valor, 0).div(qtd).toDecimalPlaces(4) : new Decimal(0);
  return { quantidade: formatarQuantidade(qtd), custo: formatarQuantidade(custo) };
}

/** Entrada pela nota de compra: liga cada item do XML a um produto da loja (ou cria o produto) e lembra o vínculo. */
export function EntradaPorNota({
  empresaId,
  documentoId,
  itens,
  produtos,
  vinculos,
}: {
  empresaId: string;
  documentoId: string;
  itens: ItemNota[];
  produtos: ProdutoLoja[];
  vinculos: VinculoNota[];
}) {
  const router = useRouter();
  const [linhas, setLinhas] = React.useState<LinhaEntrada[]>(() =>
    itens.map((i) => {
      const codigo = (i.codigo ?? "").trim();
      const d = (i.descricao ?? "").toLowerCase();
      const v = vinculos.find((x) => x.codigo === codigo && produtos.some((p) => p.id === x.produto_id));
      const porGtin = i.gtin && /^\d{8,14}$/.test(i.gtin) ? produtos.filter((p) => p.gtin === i.gtin) : [];
      const porCodigo = produtos.find((p) => p.codigo === codigo || p.descricao.toLowerCase() === d);
      const [escolha, origem, fator]: [string, OrigemSugestao, string] = v
        ? [v.produto_id, "vinculo", formatarQuantidade(v.fator, 6)]
        : porGtin.length === 1
          ? [porGtin[0].id, "gtin", "1"]
          : porCodigo
            ? [porCodigo.id, "codigo", "1"]
            : ["", null, "1"];
      const conv = converter(i, fator);
      const unidadeItem = (i.unidade ?? "").trim().toUpperCase();
      return {
        item: i,
        escolha,
        origem,
        fator,
        quantidade: conv?.quantidade ?? "",
        custo: conv?.custo ?? (i.valor_unitario ? formatarQuantidade(i.valor_unitario) : ""),
        lembrar: true,
        novo: {
          descricao: (i.descricao ?? "").slice(0, 120),
          ncm: (i.ncm ?? "").replace(/\D/g, "").slice(0, 8),
          unidade: UNIDADES_LOJA.some((u) => u.valor === unidadeItem) ? unidadeItem : "UN",
          preco: "",
          grupo: "",
        },
      };
    }),
  );
  const [enviando, setEnviando] = React.useState(false);
  const mudar = (n: number, m: Partial<LinhaEntrada>) => setLinhas((ls) => ls.map((x, i) => (i === n ? { ...x, ...m } : x)));
  const mudarFator = (n: number, fator: string) =>
    setLinhas((ls) => ls.map((x, i) => (i === n ? { ...x, fator, ...(converter(x.item, fator) ?? {}) } : x)));
  const escolhidas = linhas.filter((l) => l.escolha);

  async function salvar() {
    setEnviando(true);
    const r = await darEntradaNota(
      empresaId,
      documentoId,
      escolhidas.map((l) => ({
        numero_item: l.item.numero_item,
        produto_id: l.escolha === "novo" ? null : l.escolha,
        novo: l.escolha === "novo" ? { descricao: l.novo.descricao, ncm: l.novo.ncm, unidade: l.novo.unidade, valor_unitario: l.novo.preco, grupo: l.novo.grupo } : null,
        quantidade: l.quantidade,
        custo_unitario: l.custo,
        fator: l.fator,
        lembrar: l.lembrar,
      })),
    );
    setEnviando(false);
    if (r.ok) {
      toast.success(r.mensagem);
      router.push(`/e/${empresaId}/loja/produtos`);
      router.refresh();
    } else toast.error(r.mensagem);
  }

  return (
    <div className="space-y-4">
      <Alerta tom="info">
        Ligue cada item da nota a um produto da loja, ou crie o produto a partir do item. Se a nota vem em outra unidade (ex.: caixa e a loja vende por
        quilo), informe quantas unidades da loja vêm em uma da nota: a quantidade e o custo se ajustam sozinhos. Com “Lembrar” marcado, a próxima nota deste
        fornecedor já vem ligada.
      </Alerta>
      <ul className="space-y-3">
        {linhas.map((l, n) => {
          const id = l.item.numero_item;
          const p = produtos.find((x) => x.id === l.escolha);
          const unLoja = l.escolha === "novo" ? l.novo.unidade : p?.unidade;
          return (
            <li key={id} className="rounded-xl border border-border p-4" data-item={id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{l.item.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.item.codigo ? `Cód. ${l.item.codigo} · ` : ""}
                    {formatarQuantidade(l.item.quantidade)} {un(l.item.unidade)} × {formatarMoeda(l.item.valor_unitario)} = {formatarMoeda(l.item.valor_total)}
                  </p>
                </div>
                {l.origem && l.escolha && l.escolha !== "novo" ? <Badge variante="sucesso">{ORIGEM[l.origem]}</Badge> : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Campo rotulo="Produto da loja" htmlFor={`produto-${id}`} className="lg:col-span-1">
                  <Select
                    id={`produto-${id}`}
                    aria-label={`Produto do item ${id}`}
                    value={l.escolha}
                    onChange={(e) => mudar(n, { escolha: e.target.value, origem: null })}
                  >
                    <option value="">Não dar entrada</option>
                    <option value="novo">+ Criar produto novo com este item</option>
                    {produtos.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.descricao} ({un(x.unidade)})
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo={`1 ${un(l.item.unidade) || "unidade"} da nota =`} htmlFor={`fator-${id}`} ajuda={unLoja ? `${un(unLoja)} da loja` : undefined}>
                  <Input
                    id={`fator-${id}`}
                    aria-label={`Fator do item ${id}`}
                    value={l.fator}
                    onChange={(e) => mudarFator(n, e.target.value)}
                    inputMode="decimal"
                    className="text-right"
                    disabled={!l.escolha}
                  />
                </Campo>
                <Campo rotulo={`Quantidade${unLoja ? ` (${un(unLoja)})` : ""}`} htmlFor={`qtd-${id}`}>
                  <Input
                    id={`qtd-${id}`}
                    aria-label={`Quantidade do item ${id}`}
                    value={l.quantidade}
                    onChange={(e) => mudar(n, { quantidade: e.target.value })}
                    inputMode="decimal"
                    className="text-right"
                    disabled={!l.escolha}
                  />
                </Campo>
                <Campo rotulo={`Custo por ${unLoja ? un(unLoja) : "unidade"} (R$)`} htmlFor={`custo-${id}`}>
                  <Input
                    id={`custo-${id}`}
                    aria-label={`Custo do item ${id}`}
                    value={l.custo}
                    onChange={(e) => mudar(n, { custo: e.target.value })}
                    inputMode="decimal"
                    className="text-right"
                    disabled={!l.escolha}
                  />
                </Campo>
              </div>
              {l.escolha === "novo" ? (
                <div className="mt-3 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Campo rotulo="Nome na loja" htmlFor={`novo-desc-${id}`} className="sm:col-span-2" obrigatorio>
                    <Input id={`novo-desc-${id}`} value={l.novo.descricao} maxLength={120} onChange={(e) => mudar(n, { novo: { ...l.novo, descricao: e.target.value } })} />
                  </Campo>
                  <Campo rotulo="NCM" htmlFor={`novo-ncm-${id}`} obrigatorio>
                    <Input id={`novo-ncm-${id}`} value={l.novo.ncm} inputMode="numeric" maxLength={10} onChange={(e) => mudar(n, { novo: { ...l.novo, ncm: e.target.value } })} />
                  </Campo>
                  <Campo rotulo="Unidade na loja" htmlFor={`novo-un-${id}`} obrigatorio>
                    <Select id={`novo-un-${id}`} value={l.novo.unidade} onChange={(e) => mudar(n, { novo: { ...l.novo, unidade: e.target.value } })}>
                      {UNIDADES_LOJA.map((u) => (
                        <option key={u.valor} value={u.valor}>
                          {u.rotulo}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo={`Preço de venda (por ${un(l.novo.unidade)})`} htmlFor={`novo-preco-${id}`} obrigatorio>
                    <CampoValor id={`novo-preco-${id}`} aria-label={`Preço de venda do item ${id}`} aoMudar={(v) => mudar(n, { novo: { ...l.novo, preco: v } })} />
                  </Campo>
                </div>
              ) : null}
              {l.escolha && l.item.codigo ? (
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={l.lembrar} onChange={(e) => mudar(n, { lembrar: e.target.checked })} aria-label={`Lembrar o item ${id}`} />
                  Lembrar: o código {l.item.codigo} deste fornecedor é{" "}
                  {l.escolha === "novo" ? "o produto novo" : (p?.descricao ?? "este produto")}
                  {lerValorBR(l.fator)?.eq(1) === false ? ` (1 ${un(l.item.unidade)} = ${l.fator} ${un(unLoja)})` : ""}
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <Button onClick={salvar} disabled={enviando || !escolhidas.length}>
          {enviando ? "Registrando..." : `Dar entrada no estoque (${escolhidas.length} ${escolhidas.length === 1 ? "item" : "itens"})`}
        </Button>
      </div>
    </div>
  );
}

