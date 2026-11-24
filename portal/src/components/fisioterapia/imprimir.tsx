"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Imprime ou salva em PDF pelo navegador (o documento é a própria página). */
export function BotaoImprimir() {
  return (
    <Button variante="contorno" onClick={() => window.print()}>
      <Printer /> Imprimir ou salvar PDF
    </Button>
  );
}
