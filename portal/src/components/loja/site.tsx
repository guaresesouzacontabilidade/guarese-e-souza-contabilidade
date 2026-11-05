"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Copy, Eye, EyeOff, ImagePlus, KeyRound, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatarMoeda } from "@/lib/dinheiro";
import {
  desligarChaveSiteLoja,
  enviarFotosProduto,
  excluirCategoriaSite,
  gerarChaveSiteLoja,
  mostrarProdutosNoSite,
  salvarCategoriaSite,
  salvarFotosProduto,
  salvarProdutoSite,
  salvarSiteLoja,
} from "@/lib/vitrine/acoes";

// -----------------------------------------------------------------------------
// Configuração do site
// -----------------------------------------------------------------------------
export interface SiteForm {
  ativo: boolean;
  slug: string;
  nome: string;
  endereco_site: string | null;
  whatsapp: string | null;
  instagram: string | null;
  email: string | null;
  endereco_loja: string | null;
  cidade: string | null;
  horario: string | null;
  aviso: string | null;
  sobre: string | null;
  politica_trocas: string | null;
  pedido_minimo: number | null;
  pagamentos: string[];
  entregas: { id?: string; nome: string; valor: number | null; detalhe?: string; endereco?: boolean }[];
}

const PAGAMENTOS = [
  ["pix", "PIX"],
  ["cartao_credito", "Cartão de crédito"],
  ["cartao_debito", "Cartão de débito"],
  ["dinheiro", "Dinheiro"],
] as const;

const numBR = (v: number | null | undefined) => (v === null || v === undefined ? "" : formatarMoeda(v, { semSimbolo: true }));
const telBR = (v: string | null) => {
  const d = (v ?? "").replace(/^55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d;
};

export function FormSite({ empresaId, site }: { empresaId: string; site: SiteForm }) {
  const [entregas, setEntregas] = React.useState(
    site.entregas.length ? site.entregas.map((e, i) => ({ ...e, chave: `e${i}` })) : [{ chave: "e0", nome: "Retirada na loja", valor: 0, detalhe: "", endereco: false }],
  );
  const proxima = React.useRef(entregas.length);
  const mover = (i: number, d: number) =>
    setEntregas((l) => {
      const n = [...l];
      const [x] = n.splice(i, 1);
      n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
      return n;
    });

  return (
    <FormularioAcao acao={salvarSiteLoja.bind(null, empresaId)} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <section className="space-y-4">
            <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <Checkbox name="ativo" defaultChecked={site.ativo} className="mt-0.5" />
              <span>
                <span className="font-medium">Site ligado</span>
                <span className="block text-muted-foreground">Desligado, o site mostra só “loja fechada no momento” e não recebe pedidos.</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome da loja no site" htmlFor="site-nome" obrigatorio erro={estado.erros?.nome}>
                <Input id="site-nome" name="nome" defaultValue={site.nome} maxLength={80} />
              </Campo>
              <Campo rotulo="Endereço curto" htmlFor="site-slug" obrigatorio erro={estado.erros?.slug} ajuda="Identifica a loja na ligação com o site (LOJA_SLUG).">
                <Input id="site-slug" name="slug" defaultValue={site.slug} maxLength={40} />
              </Campo>
              <Campo rotulo="Endereço do site" htmlFor="site-endereco" erro={estado.erros?.endereco_site} ajuda="Ex.: https://shopluanaaraujo.com.br">
                <Input id="site-endereco" name="endereco_site" defaultValue={site.endereco_site ?? ""} inputMode="url" />
              </Campo>
              <Campo rotulo="WhatsApp da loja" htmlFor="site-whats" erro={estado.erros?.whatsapp} ajuda="Recebe os pedidos do site.">
                <Input id="site-whats" name="whatsapp" defaultValue={telBR(site.whatsapp)} inputMode="tel" />
              </Campo>
              <Campo rotulo="Instagram" htmlFor="site-insta" erro={estado.erros?.instagram}>
                <Input id="site-insta" name="instagram" defaultValue={site.instagram ? `@${site.instagram}` : ""} />
              </Campo>
              <Campo rotulo="E-mail de contato" htmlFor="site-email">
                <Input id="site-email" name="email" type="email" defaultValue={site.email ?? ""} />
              </Campo>
              <Campo rotulo="Endereço da loja física" htmlFor="site-end-loja">
                <Input id="site-end-loja" name="endereco_loja" defaultValue={site.endereco_loja ?? ""} maxLength={200} />
              </Campo>
              <Campo rotulo="Cidade" htmlFor="site-cidade" ajuda="Ex.: Porto Nacional – TO">
                <Input id="site-cidade" name="cidade" defaultValue={site.cidade ?? ""} maxLength={80} />
              </Campo>
              <Campo rotulo="Horário de atendimento" htmlFor="site-horario">
                <Input id="site-horario" name="horario" defaultValue={site.horario ?? ""} maxLength={200} placeholder="Seg. a sáb., das 8h às 18h" />
              </Campo>
              <Campo rotulo="Aviso no topo do site" htmlFor="site-aviso" ajuda="Até 160 letras.">
                <Input id="site-aviso" name="aviso" defaultValue={site.aviso ?? ""} maxLength={160} placeholder="Entrega no mesmo dia em Palmas e Porto Nacional" />
              </Campo>
            </div>
            <Campo rotulo="Sobre a loja" htmlFor="site-sobre" ajuda="Aparece no rodapé e na página “Sobre”.">
              <Textarea id="site-sobre" name="sobre" defaultValue={site.sobre ?? ""} maxLength={3000} rows={3} />
            </Campo>
            <Campo rotulo="Trocas e devoluções" htmlFor="site-trocas" ajuda="Em branco, o site mostra o resumo dos direitos do Código de Defesa do Consumidor (7 dias para desistir; 30 ou 90 dias para defeito).">
              <Textarea id="site-trocas" name="politica_trocas" defaultValue={site.politica_trocas ?? ""} maxLength={6000} rows={4} />
            </Campo>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Formas de entrega</h3>
              <p className="text-xs text-muted-foreground">Valor em branco = frete combinado pelo WhatsApp. “Pede endereço” faz o cliente informar onde entregar.</p>
            </div>
            <ul className="space-y-2">
              {entregas.map((e, i) => (
                <li key={e.chave} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1.2fr_7rem_1.6fr_auto] sm:items-end">
                  <Campo rotulo="Nome" htmlFor={`ent-nome-${e.chave}`} erro={estado.erros?.[`entrega_${i}`]}>
                    <Input id={`ent-nome-${e.chave}`} name="entrega_nome" defaultValue={e.nome} maxLength={60} />
                  </Campo>
                  <Campo rotulo="Valor (R$)" htmlFor={`ent-valor-${e.chave}`}>
                    <Input id={`ent-valor-${e.chave}`} name="entrega_valor" defaultValue={numBR(e.valor)} inputMode="decimal" placeholder="a combinar" />
                  </Campo>
                  <Campo rotulo="Detalhe" htmlFor={`ent-det-${e.chave}`}>
                    <Input id={`ent-det-${e.chave}`} name="entrega_detalhe" defaultValue={e.detalhe ?? ""} maxLength={160} placeholder="Pedidos até 14h saem no mesmo dia." />
                  </Campo>
                  <div className="flex items-center gap-1">
                    <Select name="entrega_endereco" defaultValue={e.endereco ? "sim" : "nao"} aria-label="Pede endereço?" className="w-36">
                      <option value="sim">Pede endereço</option>
                      <option value="nao">Sem endereço</option>
                    </Select>
                    <Button type="button" variante="fantasma" tamanho="icone" aria-label="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>
                      <ArrowLeft className="rotate-90" />
                    </Button>
                    <Button type="button" variante="fantasma" tamanho="icone" aria-label="Remover entrega" onClick={() => setEntregas((l) => l.filter((x) => x.chave !== e.chave))}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {entregas.length < 12 ? (
              <Button
                type="button"
                variante="contorno"
                tamanho="sm"
                onClick={() => setEntregas((l) => [...l, { chave: `e${proxima.current++}`, nome: "", valor: null, detalhe: "", endereco: true }])}
              >
                <Plus /> Forma de entrega
              </Button>
            ) : null}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Pagamentos aceitos</legend>
              <div className="flex flex-wrap gap-3">
                {PAGAMENTOS.map(([valor, rotulo]) => (
                  <label key={valor} className="flex items-center gap-2 text-sm">
                    <Checkbox name="pagamentos" value={valor} defaultChecked={site.pagamentos.includes(valor)} /> {rotulo}
                  </label>
                ))}
              </div>
              {estado.erros?.pagamentos ? <p className="mt-1 text-xs text-perigo">{estado.erros.pagamentos[0]}</p> : null}
            </fieldset>
            <Campo rotulo="Pedido mínimo (R$)" htmlFor="site-minimo" ajuda="Em branco: sem mínimo.">
              <Input id="site-minimo" name="pedido_minimo" defaultValue={numBR(site.pedido_minimo)} inputMode="decimal" />
            </Campo>
          </section>

          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar o site</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Chave que liga o site ao portal: gerada aqui, mostrada uma vez e guardada só como hash. */
export function ChaveSite({ empresaId, inicio, geradaEm, slug, portalUrl }: { empresaId: string; inicio: string | null; geradaEm: string | null; slug: string; portalUrl: string }) {
  const [chave, setChave] = React.useState<string | null>(null);
  const [gerando, iniciar] = React.useTransition();
  const router = useRouter();
  const copiar = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar; selecione e copie à mão.");
    }
  };
  const gerar = () =>
    iniciar(async () => {
      const r = await gerarChaveSiteLoja(empresaId);
      if (r.ok && r.dados) {
        setChave(r.dados.chave);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível gerar a chave.");
    });
  const variaveis = chave ? `PORTAL_URL=${portalUrl}\nLOJA_SLUG=${slug}\nPORTAL_CHAVE=${chave}` : "";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
        {inicio ? (
          <span>
            Chave em uso: <code className="rounded bg-muted px-1.5 py-0.5">{inicio}…</code>
            {geradaEm ? <span className="text-muted-foreground"> · gerada em {new Date(geradaEm).toLocaleString("pt-BR", { timeZone: "America/Araguaina" })}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">Sem chave: o site ainda não está ligado ao portal.</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variante={inicio ? "contorno" : "primario"} onClick={gerar} disabled={gerando}>
          {gerando ? <Loader2 className="animate-spin" /> : <KeyRound />} {inicio ? "Gerar nova chave" : "Gerar a chave do site"}
        </Button>
        {inicio ? (
          <BotaoAcao
            variante="fantasma"
            acao={() => desligarChaveSiteLoja(empresaId)}
            confirmar={{ titulo: "Desligar a chave do site?", descricao: "O site para de mostrar os produtos e de mandar pedidos até você gerar uma chave nova.", textoConfirmar: "Desligar", perigo: true }}
          >
            Desligar a chave
          </BotaoAcao>
        ) : null}
      </div>
      {chave ? (
        <Alerta tom="alerta" titulo="Copie agora: a chave não aparece de novo">
          <p className="mb-2">Cole estas três linhas nas variáveis do projeto do site (Vercel → Settings → Environment Variables) e publique o site de novo. A chave anterior parou de funcionar.</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-card p-3 text-xs">{variaveis}</pre>
          <Button type="button" tamanho="sm" variante="contorno" className="mt-2" onClick={() => copiar(variaveis)}>
            <Copy /> Copiar
          </Button>
        </Alerta>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Produtos no site
// -----------------------------------------------------------------------------
export interface ProdutoListaSite {
  id: string;
  codigo: string;
  nome: string;
  preco: number | null;
  estoque: number | null;
  categoria: string | null;
  situacao: "no_site" | "escondido" | "fora";
  fotos: number;
  miniatura: string | null;
  destaque: boolean;
}

export function ListaProdutosSite({ empresaId, produtos }: { empresaId: string; produtos: ProdutoListaSite[] }) {
  const [busca, setBusca] = React.useState("");
  const [filtro, setFiltro] = React.useState<"todos" | "no_site" | "fora" | "sem_foto">("todos");
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [ocupado, iniciar] = React.useTransition();
  const router = useRouter();
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const palavras = norm(busca).split(/\s+/).filter(Boolean);
  const visiveis = produtos.filter((p) => {
    if (filtro === "no_site" && p.situacao !== "no_site") return false;
    if (filtro === "fora" && p.situacao === "no_site") return false;
    if (filtro === "sem_foto" && p.fotos > 0) return false;
    const alvo = norm(`${p.nome} ${p.codigo} ${p.categoria ?? ""}`);
    return palavras.every((w) => alvo.includes(w));
  });
  const limite = visiveis.slice(0, 300);
  const todosMarcados = limite.length > 0 && limite.every((p) => marcados.has(p.id));
  const aplicar = (visivel: boolean) =>
    iniciar(async () => {
      const r = await mostrarProdutosNoSite(empresaId, [...marcados], visivel);
      if (r.ok) {
        toast.success(r.mensagem);
        setMarcados(new Set());
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível alterar.");
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, código ou categoria" className="max-w-sm" aria-label="Buscar produtos" />
        <Select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} aria-label="Filtrar" className="w-48">
          <option value="todos">Todos ({produtos.length})</option>
          <option value="no_site">No site ({produtos.filter((p) => p.situacao === "no_site").length})</option>
          <option value="fora">Fora do site ({produtos.filter((p) => p.situacao !== "no_site").length})</option>
          <option value="sem_foto">Sem foto ({produtos.filter((p) => p.fotos === 0).length})</option>
        </Select>
        {marcados.size ? (
          <div className="ml-auto flex gap-2">
            <Button tamanho="sm" onClick={() => aplicar(true)} disabled={ocupado}>
              <Eye /> Mostrar no site ({marcados.size})
            </Button>
            <Button tamanho="sm" variante="contorno" onClick={() => aplicar(false)} disabled={ocupado}>
              <EyeOff /> Esconder ({marcados.size})
            </Button>
          </div>
        ) : null}
      </div>
      <Table>
        <THead>
          <tr>
            <Th className="w-8">
              <Checkbox
                aria-label="Marcar todos os produtos da lista"
                checked={todosMarcados}
                onChange={(e) => setMarcados(e.target.checked ? new Set(limite.map((p) => p.id)) : new Set())}
              />
            </Th>
            <Th>Produto</Th>
            <Th>Categoria no site</Th>
            <Th className="text-right">Preço</Th>
            <Th className="text-right">Estoque</Th>
            <Th>No site</Th>
          </tr>
        </THead>
        <TBody>
          {limite.map((p) => (
            <Tr key={p.id}>
              <Td>
                <Checkbox
                  aria-label={`Marcar ${p.nome}`}
                  checked={marcados.has(p.id)}
                  onChange={(e) =>
                    setMarcados((m) => {
                      const n = new Set(m);
                      if (e.target.checked) n.add(p.id);
                      else n.delete(p.id);
                      return n;
                    })
                  }
                />
              </Td>
              <Td>
                <Link href={`/e/${empresaId}/loja/site/produtos/${p.id}`} className="flex items-center gap-3 hover:underline">
                  <span className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.miniatura ? <img src={p.miniatura} alt="" className="size-full object-cover" loading="lazy" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.codigo} · {p.fotos} foto(s)
                      {p.destaque ? " · destaque" : ""}
                    </span>
                  </span>
                </Link>
              </Td>
              <Td className="text-muted-foreground">{p.categoria ?? "—"}</Td>
              <Td className="text-right numero">{p.preco === null ? "sem preço" : formatarMoeda(p.preco)}</Td>
              <Td className="text-right numero">{p.estoque === null ? "—" : p.estoque.toLocaleString("pt-BR")}</Td>
              <Td>
                {p.situacao === "no_site" ? <Badge variante="sucesso">No site</Badge> : p.situacao === "escondido" ? <Badge variante="neutro">Escondido</Badge> : <Badge variante="contorno">Fora</Badge>}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {visiveis.length > limite.length ? <p className="text-xs text-muted-foreground">Mostrando 300 de {visiveis.length}. Use a busca para achar os demais.</p> : null}
      {!visiveis.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum produto com esse filtro.</p> : null}
    </div>
  );
}

export interface ProdutoEdicaoSite {
  id: string;
  descricaoCadastro: string;
  visivel: boolean;
  nome: string;
  descricao: string;
  categoria_id: string | null;
  rotulo_variacao: string;
  variacoes: string[];
  destaque: boolean;
  preco_de: number | null;
}

export function FormProdutoSite({ empresaId, produto: p, categorias }: { empresaId: string; produto: ProdutoEdicaoSite; categorias: { id: string; nome: string }[] }) {
  return (
    <FormularioAcao acao={salvarProdutoSite.bind(null, empresaId, p.id)} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="visivel" defaultChecked={p.visivel} /> Mostrar no site
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="destaque" defaultChecked={p.destaque} /> <Star className="size-3.5" aria-hidden="true" /> Destaque na página inicial
            </label>
          </div>
          <Campo rotulo="Nome no site" htmlFor="ps-nome" erro={estado.erros?.nome} ajuda={`Em branco, aparece como no cadastro: “${p.descricaoCadastro}”.`}>
            <Input id="ps-nome" name="nome" defaultValue={p.nome} maxLength={160} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Categoria" htmlFor="ps-cat">
              <Select id="ps-cat" name="categoria_id" defaultValue={p.categoria_id ?? ""}>
                <option value="">Sem categoria</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Preço “de” (promoção)" htmlFor="ps-de" erro={estado.erros?.preco_de} ajuda="Aparece riscado ao lado do preço do cadastro.">
              <Input id="ps-de" name="preco_de" defaultValue={p.preco_de === null ? "" : formatarMoeda(p.preco_de, { semSimbolo: true })} inputMode="decimal" />
            </Campo>
          </div>
          <Campo rotulo="Descrição" htmlFor="ps-desc" erro={estado.erros?.descricao}>
            <Textarea id="ps-desc" name="descricao" defaultValue={p.descricao} rows={6} maxLength={8000} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <Campo rotulo="Nome da escolha" htmlFor="ps-rot" ajuda="Ex.: Cor, Tom, Tamanho, Aro.">
              <Input id="ps-rot" name="rotulo_variacao" defaultValue={p.rotulo_variacao} maxLength={30} />
            </Campo>
            <Campo rotulo="Opções (uma por linha)" htmlFor="ps-var" erro={estado.erros?.variacoes} ajuda="Com opções, o cliente escolhe uma antes de pôr na sacola. O estoque é o do produto.">
              <Textarea id="ps-var" name="variacoes" defaultValue={p.variacoes.join("\n")} rows={4} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar no site</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Reduz a foto no próprio aparelho (lado maior até 1.600 px) antes de enviar: envio rápido e dentro do limite. */
async function reduzirFoto(arquivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala);
  const h = Math.round(bitmap.height * escala);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return arquivo;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((ok) => c.toBlob((b) => ok(b ?? arquivo), "image/jpeg", 0.88));
}

export function FotosProduto({ empresaId, produtoId, fotos }: { empresaId: string; produtoId: string; fotos: { caminho: string; url: string }[] }) {
  const [lista, setLista] = React.useState(fotos);
  const [enviando, setEnviando] = React.useState<string | null>(null);
  const [salvando, iniciar] = React.useTransition();
  const entrada = React.useRef<HTMLInputElement>(null);
  const router = useRouter();

  const gravarOrdem = (nova: typeof lista) =>
    iniciar(async () => {
      const r = await salvarFotosProduto(empresaId, produtoId, nova.map((f) => f.caminho));
      if (r.ok) {
        setLista(nova);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível salvar.");
    });

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    const escolhidos = [...arquivos].slice(0, Math.max(0, 8 - lista.length));
    if (!escolhidos.length) {
      toast.error("Cada produto tem até 8 fotos.");
      return;
    }
    let enviadas = 0;
    for (const [i, arq] of escolhidos.entries()) {
      setEnviando(`Enviando ${i + 1} de ${escolhidos.length}…`);
      try {
        const fd = new FormData();
        fd.append("fotos", new File([await reduzirFoto(arq)], arq.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
        const r = await enviarFotosProduto(empresaId, produtoId, fd);
        if (!r.ok) {
          toast.error(r.mensagem ?? `Não foi possível enviar "${arq.name}".`);
          break;
        }
        enviadas += 1;
      } catch {
        toast.error(`"${arq.name}" não abriu como imagem.`);
        break;
      }
    }
    setEnviando(null);
    if (entrada.current) entrada.current.value = "";
    if (enviadas) toast.success(enviadas === 1 ? "Foto enviada." : `${enviadas} fotos enviadas.`);
    router.refresh();
  };

  const mover = (i: number, d: number) => {
    const n = [...lista];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x);
    gravarOrdem(n);
  };

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {lista.map((f, i) => (
          <li key={f.caminho} className="group relative overflow-hidden rounded-lg border border-border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={`Foto ${i + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
            {i === 0 ? <span className="absolute left-1.5 top-1.5 rounded bg-card/90 px-1.5 py-0.5 text-[10px] font-medium">Capa</span> : null}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-card/90 p-1">
              <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label="Mover para a esquerda" disabled={i === 0 || salvando} onClick={() => mover(i, -1)}>
                <ArrowLeft />
              </Button>
              <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label="Apagar a foto" disabled={salvando} onClick={() => gravarOrdem(lista.filter((x) => x.caminho !== f.caminho))}>
                <Trash2 />
              </Button>
              <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label="Mover para a direita" disabled={i === lista.length - 1 || salvando} onClick={() => mover(i, 1)}>
                <ArrowRight />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden id={`fotos-${produtoId}`} onChange={(e) => void enviar(e.target.files)} />
        <Button type="button" variante="contorno" onClick={() => entrada.current?.click()} disabled={Boolean(enviando) || lista.length >= 8}>
          {enviando ? <Loader2 className="animate-spin" /> : <ImagePlus />} {enviando ?? "Enviar fotos"}
        </Button>
        <p className="text-xs text-muted-foreground">Até 8 fotos (JPG, PNG ou WebP). A primeira é a capa. O portal prepara cada uma em dois tamanhos leves para o site.</p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Categorias
// -----------------------------------------------------------------------------
export interface CategoriaEdicao {
  id: string;
  pai_id: string | null;
  nome: string;
  ordem: number;
  ativa: boolean;
  produtos: number;
}

function FormCategoria({ empresaId, categoria, principais, aoSalvar }: { empresaId: string; categoria?: CategoriaEdicao; principais: CategoriaEdicao[]; aoSalvar?: () => void }) {
  const id = categoria?.id ?? "nova";
  return (
    <FormularioAcao acao={salvarCategoriaSite.bind(null, empresaId, categoria?.id ?? null)} aoSucesso={aoSalvar} resetarAoSucesso={!categoria} className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem_auto] sm:items-end">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Nome" htmlFor={`cat-nome-${id}`} erro={estado.erros?.nome}>
            <Input id={`cat-nome-${id}`} name="nome" defaultValue={categoria?.nome} maxLength={60} />
          </Campo>
          <Campo rotulo="Dentro de" htmlFor={`cat-pai-${id}`}>
            <Select id={`cat-pai-${id}`} name="pai_id" defaultValue={categoria?.pai_id ?? ""}>
              <option value="">— categoria principal —</option>
              {principais
                .filter((c) => c.id !== categoria?.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </Select>
          </Campo>
          <Campo rotulo="Ordem" htmlFor={`cat-ordem-${id}`}>
            <Input id={`cat-ordem-${id}`} name="ordem" defaultValue={categoria?.ordem ?? 0} inputMode="numeric" />
          </Campo>
          <div className="flex items-center gap-3">
            {categoria ? (
              <Select name="ativa" defaultValue={categoria.ativa ? "on" : "off"} aria-label="Situação" className="w-32">
                <option value="on">No site</option>
                <option value="off">Escondida</option>
              </Select>
            ) : null}
            <BotaoEnviar pendente={pendente}>{categoria ? "Salvar" : "Criar"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function CategoriasSite({ empresaId, categorias }: { empresaId: string; categorias: CategoriaEdicao[] }) {
  const principais = categorias.filter((c) => !c.pai_id);
  const [editando, setEditando] = React.useState<string | null>(null);
  const linha = (c: CategoriaEdicao, sub: boolean) => (
    <Tr key={c.id}>
      <Td className={sub ? "pl-8" : "font-medium"}>
        {sub ? "↳ " : ""}
        {c.nome}
      </Td>
      <Td className="text-right numero">{c.produtos}</Td>
      <Td className="text-right numero">{c.ordem}</Td>
      <Td>{c.ativa ? <Badge variante="sucesso">No site</Badge> : <Badge>Escondida</Badge>}</Td>
      <Td className="text-right">
        <Dialog open={editando === c.id} onOpenChange={(a) => setEditando(a ? c.id : null)}>
          <DialogTrigger asChild>
            <Button variante="fantasma" tamanho="sm">
              Editar
            </Button>
          </DialogTrigger>
          <DialogContent titulo={`Editar “${c.nome}”`} largura="lg">
            <FormCategoria empresaId={empresaId} categoria={c} principais={principais} aoSalvar={() => setEditando(null)} />
          </DialogContent>
        </Dialog>
        <BotaoAcao
          variante="fantasma"
          tamanho="sm"
          acao={() => excluirCategoriaSite(empresaId, c.id)}
          confirmar={{ titulo: `Excluir “${c.nome}”?`, descricao: "Os produtos dela ficam sem categoria; as subcategorias viram categorias principais.", textoConfirmar: "Excluir", perigo: true }}
        >
          Excluir
        </BotaoAcao>
      </Td>
    </Tr>
  );
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border p-4">
        <p className="mb-3 text-sm font-semibold">Nova categoria</p>
        <FormCategoria empresaId={empresaId} principais={principais} />
      </div>
      {categorias.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Categoria</Th>
              <Th className="text-right">Produtos</Th>
              <Th className="text-right">Ordem</Th>
              <Th>Situação</Th>
              <Th />
            </tr>
          </THead>
          <TBody>{principais.flatMap((p) => [linha(p, false), ...categorias.filter((c) => c.pai_id === p.id).map((c) => linha(c, true))])}</TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma categoria ainda. Crie as principais (ex.: Maquiagens, Prata 925) e depois as de dentro (ex.: Bases, Anéis).</p>
      )}
    </div>
  );
}
