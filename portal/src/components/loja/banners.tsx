"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Loader2, Plus } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import type { ResultadoAcao } from "@/lib/acoes";
import { enviarImagemBanner, excluirBannerSite, removerImagemCelularBanner, salvarBannerSite } from "@/lib/vitrine/acoes";
import { formatarDataHora as dataHora } from "@/lib/formatos";
import { paraCampoLocal, ROTULO_SITUACAO, type SituacaoBanner } from "@/lib/vitrine/banners";
import { reduzirFoto } from "./site";

export interface BannerEdicao {
  id: string;
  titulo: string;
  link: string | null;
  inicio: string | null;
  fim: string | null;
  ordem: number;
  ativo: boolean;
  imagem_computador: string | null;
  imagem_celular: string | null;
  /** Miniaturas para a prévia */
  computador: string | null;
  celular: string | null;
  situacao: SituacaoBanner;
}

/** Proporções em que o site mostra o banner (a prévia corta igual). */
const TAMANHOS = {
  computador: { rotulo: "Computador", medida: "1920 × 600 px", largura: 1920, altura: 1920, aspecto: "aspect-[16/5]" },
  celular: { rotulo: "Celular", medida: "1080 × 1080 px (quadrada, como um post do Instagram)", largura: 1080, altura: 1920, aspecto: "aspect-square" },
} as const;

const TOM: Record<SituacaoBanner, "sucesso" | "info" | "neutro" | "alerta"> = {
  no_ar: "sucesso",
  agendado: "info",
  encerrado: "neutro",
  desligado: "neutro",
  sem_imagem: "alerta",
};

function periodo(b: Pick<BannerEdicao, "inicio" | "fim">) {
  if (b.inicio && b.fim) return `De ${dataHora(b.inicio)} até ${dataHora(b.fim)}`;
  if (b.inicio) return `A partir de ${dataHora(b.inicio)}, sem data para sair`;
  if (b.fim) return `Já valendo, até ${dataHora(b.fim)}`;
  return "Sem período: fica no ar enquanto estiver ligado";
}

function destinoDoLink(link: string | null, categorias: { nome: string; slug: string }[]) {
  if (!link) return "Só a imagem (sem link)";
  const cat = categorias.find((c) => `/c/${c.slug}` === link);
  if (cat) return `Abre a categoria ${cat.nome}`;
  if (link.startsWith("/busca")) return `Abre a busca “${decodeURIComponent(link.replace(/^\/busca\?q=/, "").replace(/\+/g, " "))}”`;
  return `Abre ${link}`;
}

// -----------------------------------------------------------------------------
// Formulário (nome, link, período, ordem, ligado)
// -----------------------------------------------------------------------------
type Rascunho = Partial<Record<"titulo" | "destino" | "link" | "inicio" | "fim" | "ordem" | "ativo", string>>;

function FormBanner({
  empresaId,
  banner,
  categorias,
  aoSalvar,
}: {
  empresaId: string;
  banner?: BannerEdicao;
  categorias: { nome: string; slug: string }[];
  aoSalvar?: () => void;
}) {
  // Depois do envio, o React limpa o formulário. Quando volta com erro, os campos
  // renascem (key) com o que foi digitado, para corrigir sem redigitar.
  const [rascunho, setRascunho] = React.useState<{ n: number; valores: Rascunho } | null>(null);
  const salvar = salvarBannerSite.bind(null, empresaId, banner?.id ?? null);
  const acao = async (anterior: ResultadoAcao, fd: FormData) => {
    const r = await salvar(anterior, fd);
    if (!r.ok) setRascunho((x) => ({ n: (x?.n ?? 0) + 1, valores: Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])) }));
    return r;
  };
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} resetarAoSucesso={!banner} className="space-y-4">
      {({ estado, pendente }) => (
        <CamposBanner
          key={rascunho?.n ?? 0}
          id={banner?.id ?? "novo"}
          banner={banner}
          rascunho={rascunho?.valores}
          categorias={categorias}
          erros={estado.erros ?? {}}
          pendente={pendente}
        />
      )}
    </FormularioAcao>
  );
}

function CamposBanner({
  id,
  banner,
  rascunho,
  categorias,
  erros,
  pendente,
}: {
  id: string;
  banner?: BannerEdicao;
  rascunho?: Rascunho;
  categorias: { nome: string; slug: string }[];
  erros: Record<string, string[] | undefined>;
  pendente: boolean;
}) {
  const daCategoria = Boolean(banner?.link && categorias.some((c) => `/c/${c.slug}` === banner.link));
  const inicial = rascunho
    ? {
        titulo: rascunho.titulo ?? "",
        destino: rascunho.destino ?? "",
        link: rascunho.link ?? "",
        inicio: rascunho.inicio ?? "",
        fim: rascunho.fim ?? "",
        ordem: rascunho.ordem ?? "0",
        ativo: rascunho.ativo === "on",
      }
    : {
        titulo: banner?.titulo ?? "",
        destino: banner?.link ? (daCategoria ? banner.link : "outro") : "",
        link: banner?.link && !daCategoria ? banner.link : "",
        inicio: paraCampoLocal(banner?.inicio ?? null),
        fim: paraCampoLocal(banner?.fim ?? null),
        ordem: String(banner?.ordem ?? 0),
        ativo: banner?.ativo ?? true,
      };
  const [destino, setDestino] = React.useState(inicial.destino);
  return (
    <>
      <Campo rotulo="Nome do banner" htmlFor={`bn-titulo-${id}`} erro={erros.titulo} ajuda="Ex.: Dia das Mães. Também descreve a imagem para quem usa leitor de tela." obrigatorio>
        <Input id={`bn-titulo-${id}`} name="titulo" defaultValue={inicial.titulo} maxLength={100} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Ao tocar no banner, abre" htmlFor={`bn-destino-${id}`}>
          <Select id={`bn-destino-${id}`} name="destino" defaultValue={inicial.destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Nada (só a imagem)</option>
            {categorias.length ? (
              <optgroup label="Categoria do site">
                {categorias.map((c) => (
                  <option key={c.slug} value={`/c/${c.slug}`}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value="outro">Outra página do site (colar o endereço)</option>
          </Select>
        </Campo>
        {destino === "outro" ? (
          <Campo rotulo="Endereço da página" htmlFor={`bn-link-${id}`} erro={erros.link} ajuda="Abra a página no site (um produto ou uma busca) e cole o endereço aqui.">
            <Input id={`bn-link-${id}`} name="link" defaultValue={inicial.link} placeholder="https://shopluanaaraujo.com.br/busca?q=colar" inputMode="url" />
          </Campo>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_7rem]">
        <Campo rotulo="Entra no ar em" htmlFor={`bn-inicio-${id}`} erro={erros.inicio} ajuda="Vazio: já entra.">
          <Input id={`bn-inicio-${id}`} name="inicio" type="datetime-local" defaultValue={inicial.inicio} />
        </Campo>
        <Campo rotulo="Sai do ar em" htmlFor={`bn-fim-${id}`} erro={erros.fim} ajuda="Vazio: fica até você desligar.">
          <Input id={`bn-fim-${id}`} name="fim" type="datetime-local" defaultValue={inicial.fim} />
        </Campo>
        <Campo rotulo="Ordem" htmlFor={`bn-ordem-${id}`} ajuda="Menor passa antes.">
          <Input id={`bn-ordem-${id}`} name="ordem" defaultValue={inicial.ordem} inputMode="numeric" />
        </Campo>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="ativo" defaultChecked={inicial.ativo} /> Ligado
          <span className="text-muted-foreground">(desligado, não aparece mesmo dentro do período)</span>
        </label>
        <BotaoEnviar pendente={pendente}>{banner ? "Salvar" : "Criar banner"}</BotaoEnviar>
      </div>
      <p className="text-xs text-muted-foreground">Horários de Tocantins.</p>
    </>
  );
}

// -----------------------------------------------------------------------------
// Imagem (computador ou celular), com a prévia no recorte do site
// -----------------------------------------------------------------------------
function ImagemBanner({ empresaId, banner, tipo }: { empresaId: string; banner: BannerEdicao; tipo: "computador" | "celular" }) {
  const t = TAMANHOS[tipo];
  const url = tipo === "computador" ? banner.computador : banner.celular;
  const usaDoComputador = tipo === "celular" && !url && banner.computador;
  const [enviando, setEnviando] = React.useState(false);
  const entrada = React.useRef<HTMLInputElement>(null);
  const router = useRouter();

  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("imagem", new File([await reduzirFoto(arquivo, t.largura, t.altura)], `${tipo}.jpg`, { type: "image/jpeg" }));
      const r = await enviarImagemBanner(empresaId, banner.id, tipo, fd);
      if (r.ok) {
        toast.success(r.mensagem ?? "Imagem enviada.");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível enviar a imagem.");
    } catch {
      toast.error(`"${arquivo.name}" não abriu como imagem.`);
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className={tipo === "computador" ? "min-w-0 flex-1" : "w-40 shrink-0"}>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t.rotulo}
        {tipo === "celular" ? " (opcional)" : ""}
      </p>
      <div className={`relative overflow-hidden rounded-lg border border-border bg-muted ${t.aspecto}`}>
        {url || usaDoComputador ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={(url ?? banner.computador)!} alt="" className={`size-full ${usaDoComputador ? "bg-[#0c0a09] object-contain" : "object-cover"}`} loading="lazy" />
        ) : (
          <span className="absolute inset-0 grid place-items-center p-2 text-center text-xs text-muted-foreground">{t.medida}</span>
        )}
        {usaDoComputador ? <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-card/90 px-1.5 py-0.5 text-[10px] leading-tight">Usando a do computador</span> : null}
      </div>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void enviar(e.target.files?.[0])} aria-label={`Imagem do banner para ${t.rotulo.toLowerCase()}`} />
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Button type="button" variante={url ? "fantasma" : "contorno"} tamanho="sm" onClick={() => entrada.current?.click()} disabled={enviando}>
          {enviando ? <Loader2 className="animate-spin" /> : <ImagePlus />} {enviando ? "Enviando…" : url ? "Trocar" : "Enviar imagem"}
        </Button>
        {tipo === "celular" && url ? (
          <BotaoAcao variante="fantasma" tamanho="sm" acao={() => removerImagemCelularBanner(empresaId, banner.id)}>
            Usar a do computador
          </BotaoAcao>
        ) : null}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Lista
// -----------------------------------------------------------------------------
export function BannersSite({ empresaId, banners, categorias }: { empresaId: string; banners: BannerEdicao[]; categorias: { nome: string; slug: string }[] }) {
  const [novo, setNovo] = React.useState(false);
  const [editando, setEditando] = React.useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Enquanto houver banner no ar, ele aparece no lugar da abertura da página inicial do site. Com mais de um, eles passam sozinhos, na ordem. Fora do período, a abertura volta.
        </p>
        <Dialog open={novo} onOpenChange={setNovo}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> Novo banner
            </Button>
          </DialogTrigger>
          <DialogContent titulo="Novo banner" descricao="Depois de criar, envie a imagem na lista." largura="lg">
            <FormBanner empresaId={empresaId} categorias={categorias} aoSalvar={() => setNovo(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {banners.length ? (
        <ul className="space-y-3">
          {banners.map((b) => {
            const situacao = b.situacao;
            return (
              <li key={b.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {b.titulo} <Badge variante={TOM[situacao]}>{ROTULO_SITUACAO[situacao]}</Badge>
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {periodo(b)} · {destinoDoLink(b.link, categorias)} · ordem {b.ordem}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Dialog open={editando === b.id} onOpenChange={(a) => setEditando(a ? b.id : null)}>
                      <DialogTrigger asChild>
                        <Button variante="fantasma" tamanho="sm">
                          Editar
                        </Button>
                      </DialogTrigger>
                      <DialogContent titulo={`Editar “${b.titulo}”`} largura="lg">
                        <FormBanner empresaId={empresaId} banner={b} categorias={categorias} aoSalvar={() => setEditando(null)} />
                      </DialogContent>
                    </Dialog>
                    <BotaoAcao
                      variante="fantasma"
                      tamanho="sm"
                      acao={() => excluirBannerSite(empresaId, b.id)}
                      confirmar={{ titulo: `Excluir “${b.titulo}”?`, descricao: "O banner sai do site e as imagens são apagadas. Para tirar só por um tempo, desligue em Editar.", textoConfirmar: "Excluir", perigo: true }}
                    >
                      Excluir
                    </BotaoAcao>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-4 sm:flex-row">
                  <ImagemBanner empresaId={empresaId} banner={b} tipo="computador" />
                  <ImagemBanner empresaId={empresaId} banner={b} tipo="celular" />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum banner ainda. Crie um para a próxima campanha (Dia das Mães, Black Friday, Natal…), envie a imagem e escolha o período: ele entra e sai do site sozinho.
        </div>
      )}

      <div className="rounded-xl bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Tamanho das imagens</p>
        <p>
          Computador: {TAMANHOS.computador.medida}. Celular: {TAMANHOS.celular.medida}; sem ela, o celular mostra a do computador inteira. Se um banner tiver a
          imagem do celular, envie para todos: assim todos ocupam a tela do celular. JPG, PNG ou WebP. Deixe textos e rostos longe das bordas: a prévia
          mostra o recorte que aparece no site.
        </p>
      </div>
    </div>
  );
}
