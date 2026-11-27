"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownUp, ArrowLeftRight, ClipboardCheck, PackagePlus, Pencil, Trash2 } from "lucide-react";
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
import { precoSugerido } from "@/lib/gestao/precos";
import { classeUnidade, fatorDaNota, nomeUnidade, rendimentoSugerido, resumoConversao, temConversao } from "@/lib/gestao/conversao";
import { filtrarLista } from "@/lib/busca";

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
  /** Peso do prato/embalagem descontado na pesagem (só produto por quilo). */
  tara_kg?: string | null;
  /** Margem que quer ganhar (%) sobre o custo; vazio usa a do grupo ou a padrão. */
  margem_desejada?: string | null;
  /** Compra em outra unidade (ex.: PC) e quanto cada uma rende na unidade de venda (ex.: 3 metros). */
  unidade_compra?: string | null;
  fator_compra?: string | null;
}

const num = (v: string | null | undefined, casas = 4) => (v == null || v === "" ? "" : formatarQuantidade(v, casas));

/** Cadastro e edição do produto (com as medidas da peça para madeira). */
export function FormProduto({
  empresaId,
  produto,
  grupos,
  custos = false,
  aoSalvar,
}: {
  empresaId: string;
  produto?: ProdutoLoja;
  grupos: string[];
  /** Mostra o custo de compra e a margem (permissão "Ver custos e margens"); sem ela, o custo guardado fica como está. */
  custos?: boolean;
  aoSalvar?: () => void;
}) {
  const [unidade, setUnidade] = React.useState(produto?.unidade ?? "UN");
  const [esp, setEsp] = React.useState(num(produto?.espessura_cm, 2));
  const [larg, setLarg] = React.useState(num(produto?.largura_cm, 2));
  const [comp, setComp] = React.useState(num(produto?.comprimento_m, 3));
  const [preco, setPreco] = React.useState(produto?.valor_unitario ? formatarMoeda(produto.valor_unitario, { semSimbolo: true }) : "");
  const [custo, setCusto] = React.useState(produto?.preco_custo ? formatarMoeda(produto.preco_custo, { semSimbolo: true }) : "");
  const [margem, setMargem] = React.useState(produto?.margem_desejada ? formatarQuantidade(produto.margem_desejada, 2) : "");
  // "Usar" o preço sugerido recria o campo de preço com o valor novo
  const [precoInicial, setPrecoInicial] = React.useState<string | null>(produto?.valor_unitario ?? null);
  const [chavePreco, setChavePreco] = React.useState(0);
  const sugerido = precoSugerido(lerValorBR(custo)?.toString() ?? null, lerValorBR(margem)?.toString() ?? null);
  // Compra numa unidade e vende em outra (ex.: compra a peça e vende o metro)
  const [converte, setConverte] = React.useState(Boolean(produto?.unidade_compra && produto.fator_compra));
  const [unidadeCompra, setUnidadeCompra] = React.useState(produto?.unidade_compra ?? (unidade === "UN" ? "CX" : "UN"));
  const [fator, setFator] = React.useState(produto?.fator_compra ? formatarQuantidade(produto.fator_compra, 6) : "");
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
          {unidade === "KG" ? (
            <Campo
              rotulo="Peso do prato ou da embalagem (kg)"
              htmlFor={`tara-${idp}`}
              erro={estado.erros?.tara_kg}
              ajuda="Descontado do peso da balança no caixa (ex.: 0,350 para o prato do self-service). Deixe em branco se a balança já desconta."
              className="max-w-sm"
            >
              <Input id={`tara-${idp}`} name="tara_kg" defaultValue={produto?.tara_kg ? new Decimal(produto.tara_kg).toFixed(3).replace(".", ",") : ""} inputMode="decimal" placeholder="0,000" />
            </Campo>
          ) : null}
          <SecaoConversao
            idp={idp}
            unidade={unidade}
            medidas={{ unidade, espessura_cm: lerValorBR(esp)?.toString() ?? null, largura_cm: lerValorBR(larg)?.toString() ?? null, comprimento_m: lerValorBR(comp)?.toString() ?? null }}
            converte={converte}
            setConverte={setConverte}
            unidadeCompra={unidadeCompra}
            setUnidadeCompra={setUnidadeCompra}
            fator={fator}
            setFator={setFator}
            custo={custos ? custo : ""}
            erros={estado.erros}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {custos ? (
              <>
                <Campo rotulo={`Custo de compra (por ${un(unidade)})`} htmlFor={`custo-${idp}`} ajuda="Atualiza sozinho na entrada por nota. Sem entrada com custo, vale como custo médio.">
                  <CampoValor id={`custo-${idp}`} name="preco_custo" valorInicial={produto?.preco_custo} aoMudar={setCusto} />
                </Campo>
                <Campo rotulo="Margem que quero ganhar (%)" htmlFor={`margem-${idp}`} erro={estado.erros?.margem_desejada} ajuda="Opcional. Sobre o custo. Vazio: usa a do grupo ou a padrão.">
                  <Input id={`margem-${idp}`} name="margem_desejada" value={margem} onChange={(e) => setMargem(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="Ex.: 30" />
                </Campo>
              </>
            ) : null}
            <Campo rotulo={`Preço de venda (por ${un(unidade)})`} htmlFor={`preco-${idp}`} obrigatorio erro={estado.erros?.valor_unitario}>
              <CampoValor key={chavePreco} id={`preco-${idp}`} name="valor_unitario" valorInicial={precoInicial} aoMudar={setPreco} />
              {sugerido ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Sugerido: {formatarMoeda(sugerido)}
                  {lerValorBR(preco)?.toDecimalPlaces(2).eq(sugerido) ? (
                    " ✓"
                  ) : (
                    <button
                      type="button"
                      className="ml-1 text-primary hover:underline"
                      onClick={() => {
                        const v = sugerido.toFixed(2);
                        setPrecoInicial(v);
                        setPreco(formatarMoeda(v, { semSimbolo: true }));
                        setChavePreco((k) => k + 1);
                      }}
                    >
                      usar
                    </button>
                  )}
                </span>
              ) : null}
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
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

/** "Compro em uma unidade e vendo em outra": unidade de compra, rendimento e o resumo da conversão. */
function SecaoConversao({
  idp,
  unidade,
  medidas,
  converte,
  setConverte,
  unidadeCompra,
  setUnidadeCompra,
  fator,
  setFator,
  custo,
  erros,
}: {
  idp: string;
  unidade: string;
  medidas: Parameters<typeof rendimentoSugerido>[0];
  converte: boolean;
  setConverte: (v: boolean) => void;
  unidadeCompra: string;
  setUnidadeCompra: (v: string) => void;
  fator: string;
  setFator: (v: string) => void;
  custo: string;
  erros?: Record<string, string[] | undefined>;
}) {
  const mesma = unidadeCompra === unidade;
  const f = lerValorBR(fator);
  const sugestao = converte && !mesma ? rendimentoSugerido(medidas, unidadeCompra) : null;
  const resumo = converte && !mesma && f && f.gt(0) ? resumoConversao(unidadeCompra, f, unidade) : null;
  const custoCompra = resumo && custo ? lerValorBR(custo)?.times(f!).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null;
  const nomeCompra = nomeUnidade(unidadeCompra, 1).toLowerCase();
  return (
    <div className="rounded-xl border border-border p-3">
      <input type="hidden" name="conversao" value="1" />
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox name="converte" checked={converte} onChange={(e) => setConverte(e.target.checked)} />
        <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden />
        Compro em uma unidade e vendo em outra
      </label>
      <p className="mt-1 text-xs text-muted-foreground">Ex.: compra a peça e vende o metro; compra a caixa e vende a unidade. O estoque e o preço ficam na unidade de venda.</p>
      {converte ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Unidade de compra" htmlFor={`un-compra-${idp}`} obrigatorio erro={erros?.unidade_compra ?? (mesma ? ["Escolha uma unidade diferente da de venda."] : undefined)}>
              <Select id={`un-compra-${idp}`} name="unidade_compra" value={unidadeCompra} onChange={(e) => setUnidadeCompra(e.target.value)}>
                {UNIDADES_LOJA.map((u) => (
                  <option key={u.valor} value={u.valor} disabled={u.valor === unidade}>
                    {u.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo
              rotulo={`Cada ${nomeCompra} rende (em ${nomeUnidade(unidade, 2).toLowerCase()})`}
              htmlFor={`fator-${idp}`}
              obrigatorio
              erro={erros?.fator_compra}
            >
              <Input id={`fator-${idp}`} name="fator_compra" value={fator} onChange={(e) => setFator(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="Ex.: 3" />
              {sugestao && !(f && f.eq(sugestao)) ? (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Pelas medidas da peça: {formatarQuantidade(sugestao, 6)} {un(unidade)}{" "}
                  <button type="button" className="text-primary hover:underline" onClick={() => setFator(formatarQuantidade(sugestao, 6))}>
                    usar
                  </button>
                </span>
              ) : null}
            </Campo>
            <div className="text-sm">
              <p className="mb-1.5 font-medium">Unidade de venda</p>
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2">{nomeUnidade(unidade, 1)} (escolhida acima)</p>
            </div>
          </div>
          {resumo ? (
            <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3" data-testid="resumo-conversao">
              <ArrowLeftRight className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div className="text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resumo da conversão</p>
                <p className="font-semibold">{resumo.frase}</p>
                <p className="text-xs text-muted-foreground">
                  Compra em {nomeUnidade(unidadeCompra, 1)} · Estoque e venda em {nomeUnidade(unidade, 1)} · Ex.: {resumo.exemplo}
                  {custoCompra ? ` · Custo de 1 ${nomeCompra}: ${formatarMoeda(custoCompra)}` : ""}
                </p>
              </div>
            </div>
          ) : null}
          {resumo && f?.eq(1) ? (
            <Alerta tom="alerta">
              Confira: 1 {nomeCompra} rende só 1 {nomeUnidade(unidade, 1).toLowerCase()}? Se a peça tem 3 m, por exemplo, o certo é 3. Com o número errado, o estoque e o custo saem errados.
            </Alerta>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DialogoProduto({ empresaId, produto, grupos, custos = false }: { empresaId: string; produto?: ProdutoLoja; grupos: string[]; custos?: boolean }) {
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
        <FormProduto empresaId={empresaId} produto={produto} grupos={grupos} custos={custos} aoSalvar={() => setAberto(false)} />
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
export function LancarEstoque({
  empresaId,
  produtos,
  produtoId,
  custos = false,
}: {
  empresaId: string;
  produtos: ProdutoLoja[];
  produtoId?: string;
  /** Pede o custo na entrada e oferece conferir os preços (permissão "Ver custos e margens"). */
  custos?: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  // Na página do produto, o mais comum é corrigir o saldo; na lista, lançar uma entrada
  const [tipo, setTipo] = React.useState(produtoId ? "corrigir" : "entrada_manual");
  const [pid, setPid] = React.useState(produtoId ?? "");
  const [pecas, setPecas] = React.useState("");
  const [comp, setComp] = React.useState("");
  const [qtd, setQtd] = React.useState("");
  const [qtdCompra, setQtdCompra] = React.useState("");
  const produto = produtos.find((p) => p.id === pid);
  const modo = produto ? modoMedida(produto) : "direto";
  // Compra em outra unidade (ex.: peça): digita na unidade de compra e o portal converte
  const conversao = produto && temConversao(produto) && !(modo !== "direto" && classeUnidade(produto.unidade_compra) === "UN") ? produto : null;
  const convertida = conversao && qtdCompra ? lerValorBR(qtdCompra)?.times(conversao.fator_compra).toDecimalPlaces(4) : null;
  const calculada = produto && modo !== "direto" && pecas ? quantidadePorPecas(produto, lerValorBR(pecas) ?? 0, comp ? (lerValorBR(comp)?.toString() ?? null) : null) : null;
  const certa = tipo === "corrigir" && qtd.trim() ? lerValorBR(qtd) : null;
  const diferenca = produto && certa ? certa.minus(produto.estoque_atual) : null;

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno">
          <ArrowDownUp /> Ajustar estoque
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo="Ajustar o estoque"
        descricao="Corrija o saldo para a quantidade certa ou lance uma entrada ou saída. Para compras com nota, use “Entrada de mercadorias”: o custo vem certinho da nota."
        largura="lg"
      >
        <FormularioAcao
          acao={lancarEstoque.bind(null, empresaId)}
          aoSucesso={() => {
            setAberto(false);
            // Entrada com custo: oferece conferir o preço de venda
            if (tipo === "entrada_manual" && custos) {
              toast.message("Quer conferir o preço de venda?", {
                description: "Se o custo mudou, veja se o preço ainda dá a margem que você quer.",
                action: { label: "Conferir preços", onClick: () => router.push(`/e/${empresaId}/loja/produtos/precos?filtro=entrada`) },
                duration: 10000,
              });
            }
          }}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo" htmlFor="tipo-mov">
                  <Select id="tipo-mov" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    <option value="corrigir">Corrigir para a quantidade certa (contei e está diferente)</option>
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
              {conversao ? (
                <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-2">
                  <Campo rotulo={`Em ${nomeUnidade(conversao.unidade_compra, 2).toLowerCase()} (unidade de compra)`} htmlFor="qtd-compra-mov">
                    <Input id="qtd-compra-mov" value={qtdCompra} onChange={(e) => setQtdCompra(e.target.value)} inputMode="decimal" />
                  </Campo>
                  <div className="self-end pb-2 text-sm">
                    {convertida && convertida.gt(0) ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => setQtd(formatarQuantidade(convertida))}>
                        = {formatarQuantidade(convertida)} {un(conversao.unidade)} (usar)
                      </button>
                    ) : (
                      <span className="text-muted-foreground">
                        1 {nomeUnidade(conversao.unidade_compra, 1).toLowerCase()} = {formatarQuantidade(conversao.fator_compra, 6)} {un(conversao.unidade)}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  rotulo={`${tipo === "corrigir" ? "Quantidade certa agora" : "Quantidade"}${produto ? ` (${un(produto.unidade)})` : ""}`}
                  htmlFor="qtd-mov"
                  obrigatorio
                  erro={estado.erros?.quantidade}
                  ajuda={tipo === "corrigir" && produto ? `O sistema mostra ${formatarQuantidade(produto.estoque_atual)} ${un(produto.unidade)}. O portal lança a diferença.` : undefined}
                >
                  <Input id="qtd-mov" name="quantidade" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" />
                </Campo>
                {tipo === "entrada_manual" && custos ? (
                  <Campo
                    rotulo={`Custo unitário${produto ? ` por ${un(produto.unidade)}` : ""} (opcional)`}
                    htmlFor="custo-mov"
                    ajuda={conversao ? `Entra no custo médio. É o custo de 1 ${un(conversao.unidade)}, não da ${nomeUnidade(conversao.unidade_compra, 1).toLowerCase()}.` : "Entra no custo médio."}
                  >
                    <CampoValor id="custo-mov" name="custo_unitario" />
                  </Campo>
                ) : null}
              </div>
              {produto && diferenca ? (
                <p className="text-sm text-muted-foreground">
                  {diferenca.isZero()
                    ? "O estoque já está com essa quantidade."
                    : `Vai lançar uma ${diferenca.isPositive() ? "entrada" : "saída"} de ${formatarQuantidade(diferenca.abs())} ${un(produto.unidade)} (fica no histórico do produto).`}
                </p>
              ) : null}
              <Campo rotulo="Observação" htmlFor="obs-mov">
                <Input id="obs-mov" name="observacao" maxLength={300} placeholder={tipo === "corrigir" ? "Ex.: contagem da prateleira" : undefined} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{tipo === "corrigir" ? "Corrigir estoque" : "Registrar"}</BotaoEnviar>
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
  const lista = filtrarLista(
    produtos.filter((p) => p.controla_estoque),
    filtro,
    (p) => [p.descricao, p.codigo, p.grupo, p.gtin],
  );
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

/** Rendimento pelo cadastro do produto (compra numa unidade e vende em outra): "1" quando não converte; null quando a unidade da nota não bate. */
function fatorDoCadastro(p: ProdutoLoja | undefined, unidadeNota: string | null): string | null {
  if (!p) return "1";
  const f = fatorDaNota(p, unidadeNota);
  return f ? formatarQuantidade(f, 6) : null;
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
      // Sem vínculo com o fornecedor: o rendimento vem do cadastro do produto (ex.: 1 peça = 3 m)
      const [escolha, origem, fator]: [string, OrigemSugestao, string] = v
        ? [v.produto_id, "vinculo", formatarQuantidade(v.fator, 6)]
        : porGtin.length === 1
          ? [porGtin[0].id, "gtin", fatorDoCadastro(porGtin[0], i.unidade) ?? "1"]
          : porCodigo
            ? [porCodigo.id, "codigo", fatorDoCadastro(porCodigo, i.unidade) ?? "1"]
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
      router.push(`/e/${empresaId}/loja/produtos?conferir=1`);
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
                    onChange={(e) => {
                      const escolha = e.target.value;
                      const f = fatorDoCadastro(produtos.find((x) => x.id === escolha), l.item.unidade);
                      setLinhas((ls) => ls.map((x, i) => (i === n ? { ...x, escolha, origem: null, ...(f ? { fator: f, ...(converter(x.item, f) ?? {}) } : {}) } : x)));
                    }}
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
                  {p && temConversao(p) ? (
                    <span className={`mt-1 block text-xs ${fatorDaNota(p, l.item.unidade) ? "text-muted-foreground" : "font-medium text-alerta-fg"}`} data-testid={`conversao-item-${id}`}>
                      {fatorDaNota(p, l.item.unidade)
                        ? `Cadastro: 1 ${nomeUnidade(p.unidade_compra, 1).toLowerCase()} = ${formatarQuantidade(p.fator_compra, 6)} ${un(p.unidade)}`
                        : `A nota vem em ${l.item.unidade ?? "outra unidade"}; o produto é comprado em ${p.unidade_compra} e vendido em ${un(p.unidade)}. Informe quantos ${un(p.unidade)} vêm em 1 ${l.item.unidade ?? "unidade"}.`}
                    </span>
                  ) : null}
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

