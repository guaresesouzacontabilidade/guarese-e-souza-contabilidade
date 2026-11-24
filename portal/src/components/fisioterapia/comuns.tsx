"use client";

import * as React from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import type { ResultadoAcao } from "@/lib/acoes";

/** Tela mostrada quando a empresa não usa a clínica (ou a pessoa não tem acesso). */
export function FisioIndisponivel({ empresaId, equipe, ativa }: { empresaId: string; equipe: boolean; ativa: boolean }) {
  if (ativa) {
    return (
      <EstadoVazio
        icone={Activity}
        titulo="Você não tem acesso à clínica"
        descricao="Peça ao responsável pela empresa para liberar a permissão “Vender no caixa” (recepção) ou para ligar o seu usuário ao seu CREFITO (fisioterapeutas)."
      />
    );
  }
  return (
    <EstadoVazio
      icone={Activity}
      titulo="Gestão da clínica de fisioterapia não contratada"
      descricao="Serviço opcional do escritório para clínicas e consultórios de fisioterapia: agenda dos fisioterapeutas, pacientes, avaliação e evolução de cada sessão, pacotes, recebimentos e repasse — tudo ligado à contabilidade. Fale com o escritório para aderir."
      acao={
        equipe ? (
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/configuracoes`}>Ligar a gestão da clínica</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/** Aviso para quem não é fisioterapeuta ligado ao próprio usuário (o prontuário é sigiloso e assinado por ele). */
export function AvisoSemProfissional({ gerente, empresaId }: { gerente: boolean; empresaId: string }) {
  return (
    <p className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm">
      O prontuário (avaliações, evoluções e documentos) é sigiloso: só os fisioterapeutas da clínica, com o próprio usuário, leem e registram.{" "}
      {gerente ? (
        <>
          Se você é fisioterapeuta, ligue o seu usuário ao seu CREFITO em{" "}
          <Link href={`/e/${empresaId}/fisioterapia/configuracoes`} className="font-medium underline">
            Configurações da clínica
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

/** Diálogo com motivo (cancelar, estornar) e, opcionalmente, uma caixa de marcar. */
export function DialogoMotivo({
  acao,
  titulo,
  descricao,
  rotuloBotao,
  textoConfirmar,
  caixa,
  variante = "fantasma",
  tamanho = "sm",
  icone,
}: {
  acao: (a: ResultadoAcao, fd: FormData) => Promise<ResultadoAcao>;
  titulo: string;
  descricao?: string;
  rotuloBotao: string;
  textoConfirmar: string;
  caixa?: { nome: string; rotulo: string };
  variante?: ButtonProps["variante"];
  tamanho?: ButtonProps["tamanho"];
  icone?: React.ReactNode;
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={variante} tamanho={tamanho}>
          {icone} {rotuloBotao}
        </Button>
      </DialogTrigger>
      <DialogContent titulo={titulo} descricao={descricao}>
        <FormularioAcao acao={acao} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ pendente }) => (
            <>
              <Campo rotulo="Motivo" htmlFor="motivo" obrigatorio>
                <Textarea id="motivo" name="motivo" rows={2} maxLength={300} required minLength={3} />
              </Campo>
              {caixa ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name={caixa.nome} /> {caixa.rotulo}
                </label>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante="perigo">
                  {textoConfirmar}
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Gráfico da dor (escala de 0 a 10) ao longo das sessões: antes e depois de cada sessão. */
export function GraficoDor({ pontos }: { pontos: { data: string; antes: number | null; depois: number | null }[] }) {
  const validos = pontos.filter((p) => p.antes !== null || p.depois !== null);
  if (validos.length < 2) return <p className="text-sm text-muted-foreground">O gráfico aparece a partir de duas sessões com a dor registrada.</p>;
  const L = 640;
  const A = 200;
  const m = { e: 28, d: 12, t: 12, b: 28 };
  const x = (i: number) => m.e + (i * (L - m.e - m.d)) / Math.max(validos.length - 1, 1);
  const y = (v: number) => m.t + ((10 - v) * (A - m.t - m.b)) / 10;
  const linha = (k: "antes" | "depois") =>
    validos
      .map((p, i) => (p[k] === null ? null : `${x(i).toFixed(1)},${y(p[k] as number).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label="Dor antes e depois de cada sessão, de 0 a 10">
        {[0, 2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line x1={m.e} x2={L - m.d} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={m.e - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        <polyline points={linha("antes")} fill="none" className="stroke-perigo" strokeWidth={2.5} strokeLinejoin="round" />
        <polyline points={linha("depois")} fill="none" className="stroke-sucesso" strokeWidth={2.5} strokeLinejoin="round" />
        {validos.map((p, i) => (
          <g key={i}>
            {p.antes !== null ? <circle cx={x(i)} cy={y(p.antes)} r={3.5} className="fill-perigo" /> : null}
            {p.depois !== null ? <circle cx={x(i)} cy={y(p.depois)} r={3.5} className="fill-sucesso" /> : null}
            {validos.length <= 16 || i % 2 === 0 ? (
              <text x={x(i)} y={A - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {p.data.slice(8, 10)}/{p.data.slice(5, 7)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-perigo" /> Dor antes da sessão
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-sucesso" /> Dor depois da sessão
        </span>
        <span>Escala visual analógica (0 = sem dor, 10 = pior dor)</span>
      </figcaption>
    </figure>
  );
}
