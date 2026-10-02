"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";

/** Falha inesperada ao carregar uma página da área logada. */
export default function ErroApp({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EstadoVazio
      icone={TriangleAlert}
      titulo="Não foi possível carregar esta página"
      descricao={
        <>
          Tente novamente em instantes. Se o problema continuar, avise o escritório
          {error.digest ? (
            <>
              {" "}
              informando o código <code className="rounded bg-muted px-1">{error.digest}</code>
            </>
          ) : null}
          .
        </>
      }
      acao={<Button onClick={() => reset()}>Tentar novamente</Button>}
      className="mt-8"
    />
  );
}
