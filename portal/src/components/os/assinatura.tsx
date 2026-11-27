"use client";

import * as React from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Quadro para assinar com o dedo (celular/tablet) ou o mouse. Devolve a
 * assinatura como imagem PNG (data URL) ao soltar o traço, ou null ao limpar.
 */
export function QuadroAssinatura({ aoMudar, desabilitado }: { aoMudar: (png: string | null) => void; desabilitado?: boolean }) {
  const tela = React.useRef<HTMLCanvasElement>(null);
  const desenhando = React.useRef(false);
  const ultimo = React.useRef<{ x: number; y: number } | null>(null);
  const tracos = React.useRef(0);
  const [vazio, setVazio] = React.useState(true);

  // Ajusta a resolução ao tamanho real (nítido em telas de alta densidade)
  React.useEffect(() => {
    const c = tela.current;
    if (!c) return;
    const escala = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * escala);
    c.height = Math.round(height * escala);
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(escala, escala);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = 2.4;
    g.strokeStyle = "#111827";
  }, []);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const limpar = () => {
    const c = tela.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    tracos.current = 0;
    setVazio(true);
    aoMudar(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="relative overflow-hidden rounded-lg border-2 border-dashed border-zinc-300 bg-white">
        <canvas
          ref={tela}
          className="block h-40 w-full touch-none"
          aria-label="Quadro para assinar com o dedo ou o mouse"
          role="img"
          onPointerDown={(e) => {
            if (desabilitado) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            desenhando.current = true;
            ultimo.current = ponto(e);
            const g = e.currentTarget.getContext("2d");
            const p = ultimo.current;
            g?.beginPath();
            g?.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
            g?.fill();
          }}
          onPointerMove={(e) => {
            if (!desenhando.current || !ultimo.current) return;
            const g = e.currentTarget.getContext("2d");
            const p = ponto(e);
            g?.beginPath();
            g?.moveTo(ultimo.current.x, ultimo.current.y);
            g?.lineTo(p.x, p.y);
            g?.stroke();
            ultimo.current = p;
          }}
          onPointerUp={(e) => {
            if (!desenhando.current) return;
            desenhando.current = false;
            ultimo.current = null;
            tracos.current += 1;
            setVazio(false);
            aoMudar(e.currentTarget.toDataURL("image/png"));
          }}
          onPointerCancel={() => {
            desenhando.current = false;
            ultimo.current = null;
          }}
        />
        {vazio ? <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-zinc-400">Assine aqui</span> : null}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-zinc-300" aria-hidden />
      </div>
      <div className="flex justify-end">
        <Button type="button" tamanho="sm" variante="fantasma" onClick={limpar} disabled={vazio || desabilitado}>
          <Eraser /> Limpar
        </Button>
      </div>
    </div>
  );
}
