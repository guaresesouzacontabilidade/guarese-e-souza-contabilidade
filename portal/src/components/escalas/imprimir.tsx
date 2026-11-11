"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BotaoImprimirEscala() {
  return (
    <Button variante="contorno" onClick={() => window.print()} className="print:hidden">
      <Printer /> Imprimir
    </Button>
  );
}
