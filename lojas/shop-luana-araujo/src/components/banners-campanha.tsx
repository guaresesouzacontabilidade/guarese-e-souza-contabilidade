"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { Banner } from "@/lib/tipos";

/** Tempo de cada banner na tela quando há mais de um. */
const INTERVALO_MS = 6000;

/** Tamanhos prontos das imagens (o portal gera dois de cada). */
const LARGURAS = {
  computador: { p: 960, g: 1920 },
  celular: { p: 600, g: 1080 },
} as const;
const fontes = (base: string, l: { p: number; g: number }) =>
  `${base}-p.webp ${l.p}w, ${base}-g.webp ${l.g}w`;

function inscreverMovimento(avisar: () => void) {
  const m = window.matchMedia("(prefers-reduced-motion: reduce)");
  m.addEventListener("change", avisar);
  return () => m.removeEventListener("change", avisar);
}
const semMovimento = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Só páginas do próprio site (o portal já confere; aqui é a segunda trava). */
const linkInterno = (link: string | null) =>
  link && link.startsWith("/") && !link.startsWith("//") ? link : null;

/**
 * Banners de campanha (cadastrados no portal, com data para entrar e sair do
 * ar) no lugar da abertura da página inicial. Com mais de um, passam sozinhos a
 * cada 6 segundos, com troca suave; param com o mouse ou o foco em cima, no
 * botão de pausa e para quem pediu menos movimento ao aparelho. No celular,
 * desliza com o dedo.
 *
 * Proporção: 1920 × 600 no computador; no celular, quadrada (1080 × 1080)
 * quando algum banner tem imagem própria para celular. Banner sem ela aparece
 * inteiro, sobre a faixa preta.
 */
export function BannersCampanha({ banners }: { banners: Banner[] }) {
  const [atual, setAtual] = React.useState(0);
  const [escolha, setEscolha] = React.useState<"auto" | "pausado" | "rodando">(
    "auto",
  );
  const [emCima, setEmCima] = React.useState(false);
  const reduzido = React.useSyncExternalStore(
    inscreverMovimento,
    semMovimento,
    () => false,
  );
  const toque = React.useRef<number | null>(null);
  const varios = banners.length > 1;
  const rodando =
    varios &&
    !emCima &&
    (escolha === "rodando" || (escolha === "auto" && !reduzido));
  const quadradoNoCelular = banners.some((b) => b.celular !== b.computador);

  const ir = React.useCallback(
    (i: number) => setAtual((i + banners.length) % banners.length),
    [banners.length],
  );

  React.useEffect(() => {
    if (!rodando) return;
    const t = window.setTimeout(() => ir(atual + 1), INTERVALO_MS);
    return () => window.clearTimeout(t);
  }, [rodando, atual, ir]);

  const sair = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setEmCima(false);
  };

  return (
    <section
      aria-roledescription={varios ? "carrossel" : undefined}
      aria-label="Campanhas da loja"
      className="no-escuro relative bg-noite"
      onMouseEnter={() => setEmCima(true)}
      onMouseLeave={() => setEmCima(false)}
      onFocus={() => setEmCima(true)}
      onBlur={sair}
      onTouchStart={(e) => (toque.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const inicio = toque.current;
        toque.current = null;
        const fim = e.changedTouches[0]?.clientX;
        if (
          !varios ||
          inicio === null ||
          fim === undefined ||
          Math.abs(fim - inicio) < 40
        )
          return;
        setEscolha("pausado");
        ir(fim < inicio ? atual + 1 : atual - 1);
      }}
    >
      <div className="relative mx-auto max-w-[1920px]">
        <div
          className={`relative overflow-hidden ${quadradoNoCelular ? "aspect-square" : "aspect-[16/5]"} md:aspect-[16/5]`}
        >
          {banners.map((b, i) => {
            const visivel = i === atual;
            const proprioCelular = b.celular !== b.computador;
            const href = linkInterno(b.link);
            const encaixada = quadradoNoCelular && !proprioCelular;
            const imagem = (
              <picture>
                <source
                  media="(min-width: 768px)"
                  srcSet={fontes(b.computador, LARGURAS.computador)}
                  sizes="100vw"
                />
                {/* img comum: os dois tamanhos já vêm prontos do portal, com imagem própria para o celular */}
                <img
                  src={`${proprioCelular ? b.celular : b.computador}-p.webp`}
                  srcSet={
                    proprioCelular
                      ? fontes(b.celular, LARGURAS.celular)
                      : fontes(b.computador, LARGURAS.computador)
                  }
                  sizes="100vw"
                  alt={b.titulo}
                  loading={i === 0 ? "eager" : "lazy"}
                  fetchPriority={i === 0 ? "high" : "auto"}
                  decoding="async"
                  className={`relative size-full ${encaixada ? "object-contain md:object-cover" : "object-cover"}`}
                />
              </picture>
            );
            // Banner sem imagem de celular entre outros com ela: aparece inteiro, sobre ele mesmo desfocado
            const fundo = encaixada ? (
              // eslint-disable-next-line @next/next/no-img-element -- mesma imagem, já carregada, só como fundo
              <img
                src={`${b.computador}-p.webp`}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                className="absolute inset-0 size-full scale-125 object-cover opacity-70 blur-2xl md:hidden"
              />
            ) : null;
            return (
              <div
                key={b.id}
                role={varios ? "group" : undefined}
                aria-roledescription={varios ? "banner" : undefined}
                aria-label={
                  varios ? `${i + 1} de ${banners.length}` : undefined
                }
                aria-hidden={!visivel}
                inert={!visivel}
                className={`absolute inset-0 transition-opacity duration-700 ease-out ${visivel ? "opacity-100" : "pointer-events-none opacity-0"}`}
              >
                {fundo}
                {href ? (
                  <Link href={href} className="relative block size-full">
                    {imagem}
                  </Link>
                ) : (
                  imagem
                )}
              </div>
            );
          })}

          {varios ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEscolha("pausado");
                  ir(atual - 1);
                }}
                className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-noite/55 text-white backdrop-blur-sm transition hover:bg-noite/80 md:grid"
                aria-label="Banner anterior"
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEscolha("pausado");
                  ir(atual + 1);
                }}
                className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-noite/55 text-white backdrop-blur-sm transition hover:bg-noite/80 md:grid"
                aria-label="Próximo banner"
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>

        {/* Pausa e bolinhas: na faixa preta abaixo da imagem no celular; numa pílula escura sobre a imagem no computador */}
        {varios ? (
          <div className="flex items-center justify-center gap-1 md:absolute md:bottom-3 md:left-1/2 md:-translate-x-1/2 md:gap-0 md:rounded-full md:bg-noite/50 md:px-2 md:backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setEscolha(rodando ? "pausado" : "rodando")}
              className="grid size-11 place-items-center text-white md:size-9"
              aria-label={
                rodando ? "Pausar os banners" : "Passar os banners sozinhos"
              }
            >
              {rodando ? (
                <Pause className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
            </button>
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setEscolha("pausado");
                  ir(i);
                }}
                className="group grid h-11 w-8 place-items-center md:h-9"
                aria-label={`Banner ${i + 1}: ${b.titulo}`}
                aria-current={i === atual ? "true" : undefined}
              >
                <span
                  className={`block h-1.5 rounded-full transition-all ${i === atual ? "w-5 bg-white" : "w-1.5 bg-white/50 group-hover:bg-white/90"}`}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
