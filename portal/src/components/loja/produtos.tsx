"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownUp, ClipboardCheck, PackagePlus, Pencil } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { lancarEstoque, registrarInventario, salvarProdutoLoja, darEntradaNota } from "@/lib/gestao/acoes";
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
      <DialogContent titulo="Entrada ou saída de estoque" descricao="Para compras com nota, use “Entrada por nota”: o custo vem certinho do XML." largura="lg">
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
  unidade: string | null;
  quantidade: string | null;
  valor_unitario: string | null;
  valor_total: string | null;
}

/** Entrada pela nota de compra: liga cada item do XML a um produto da loja. */
export function EntradaPorNota({ empresaId, documentoId, itens, produtos }: { empresaId: string; documentoId: string; itens: ItemNota[]; produtos: ProdutoLoja[] }) {
  const router = useRouter();
  const sugerir = (i: ItemNota) => {
    const d = (i.descricao ?? "").toLowerCase();
    return produtos.find((p) => p.codigo === i.codigo || p.descricao.toLowerCase() === d)?.id ?? "";
  };
  const [linhas, setLinhas] = React.useState(() =>
    itens.map((i) => ({
      item: i,
      produto_id: sugerir(i),
      quantidade: i.quantidade ? formatarQuantidade(i.quantidade) : "",
      custo: i.valor_unitario ? formatarMoeda(new Decimal(i.valor_unitario).toDecimalPlaces(4), { semSimbolo: true }) : "",
    })),
  );
  const [enviando, setEnviando] = React.useState(false);

  async function salvar() {
    setEnviando(true);
    const r = await darEntradaNota(
      empresaId,
      documentoId,
      linhas.filter((l) => l.produto_id).map((l) => ({ produto_id: l.produto_id, quantidade: l.quantidade, custo_unitario: l.custo })),
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
        Ligue cada item da nota a um produto da loja. Se a unidade da nota for diferente (ex.: a nota em peças e a loja em m³), ajuste a quantidade e o custo
        para a unidade da loja. Itens sem produto escolhido ficam de fora.
      </Alerta>
      <Table>
        <THead>
          <tr>
            <Th>Item da nota</Th>
            <Th>Produto da loja</Th>
            <Th className="w-32 text-right">Quantidade</Th>
            <Th className="w-36 text-right">Custo unitário</Th>
          </tr>
        </THead>
        <TBody>
          {linhas.map((l, n) => {
            const p = produtos.find((x) => x.id === l.produto_id);
            return (
              <Tr key={l.item.numero_item}>
                <Td>
                  <p className="font-medium">{l.item.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatarQuantidade(l.item.quantidade)} {un(l.item.unidade)} × {formatarMoeda(l.item.valor_unitario)} = {formatarMoeda(l.item.valor_total)}
                  </p>
                </Td>
                <Td>
                  <Select
                    aria-label={`Produto do item ${l.item.numero_item}`}
                    value={l.produto_id}
                    onChange={(e) => setLinhas((ls) => ls.map((x, i) => (i === n ? { ...x, produto_id: e.target.value } : x)))}
                  >
                    <option value="">Não dar entrada</option>
                    {produtos.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.descricao} ({un(x.unidade)})
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Input
                    aria-label={`Quantidade do item ${l.item.numero_item}`}
                    value={l.quantidade}
                    onChange={(e) => setLinhas((ls) => ls.map((x, i) => (i === n ? { ...x, quantidade: e.target.value } : x)))}
                    inputMode="decimal"
                    className="text-right"
                  />
                  {p ? <span className="text-xs text-muted-foreground">{un(p.unidade)}</span> : null}
                </Td>
                <Td>
                  <CampoValor
                    aria-label={`Custo do item ${l.item.numero_item}`}
                    valorInicial={l.custo}
                    aoMudar={(v) => setLinhas((ls) => ls.map((x, i) => (i === n ? { ...x, custo: v } : x)))}
                  />
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      <div className="flex justify-end">
        <Button onClick={salvar} disabled={enviando || !linhas.some((l) => l.produto_id)}>
          {enviando ? "Registrando..." : "Dar entrada no estoque"}
        </Button>
      </div>
    </div>
  );
}

