"use client";

import * as React from "react";
import { Dialog as D, AlertDialog as AD } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  titulo,
  descricao,
  largura = "md",
  ...props
}: React.ComponentProps<typeof D.Content> & {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  largura?: "sm" | "md" | "lg" | "xl";
}) {
  const larguras = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card shadow-xl",
          larguras[largura],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div className="space-y-1">
            <D.Title className="text-base font-semibold text-titulo">{titulo}</D.Title>
            {descricao ? <D.Description className="text-sm text-muted-foreground">{descricao}</D.Description> : null}
          </div>
          <D.Close asChild>
            <Button variante="fantasma" tamanho="iconeSm" aria-label="Fechar">
              <X />
            </Button>
          </D.Close>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/** Painel lateral (gaveta), usado no menu móvel e em detalhes. */
export function Gaveta({
  aberto,
  aoMudar,
  titulo,
  lado = "esquerda",
  children,
  className,
}: {
  aberto: boolean;
  aoMudar: (v: boolean) => void;
  titulo: string;
  lado?: "esquerda" | "direita";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={aberto} onOpenChange={aoMudar}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <D.Content
          className={cn(
            "fixed top-0 z-50 h-dvh w-[85vw] max-w-sm overflow-y-auto shadow-xl focus:outline-none",
            lado === "esquerda" ? "left-0" : "right-0",
            className,
          )}
        >
          <D.Title className="sr-only">{titulo}</D.Title>
          <D.Description className="sr-only">{titulo}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Diálogo de confirmação para ações sensíveis. */
export function Confirmacao({
  gatilho,
  titulo,
  descricao,
  textoConfirmar = "Confirmar",
  variante = "primario",
  aoConfirmar,
  children,
}: {
  gatilho: React.ReactNode;
  titulo: string;
  descricao?: React.ReactNode;
  textoConfirmar?: string;
  variante?: "primario" | "perigo";
  aoConfirmar?: () => void | Promise<void>;
  children?: React.ReactNode;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [ocupado, setOcupado] = React.useState(false);
  return (
    <AD.Root open={aberto} onOpenChange={setAberto}>
      <AD.Trigger asChild>{gatilho}</AD.Trigger>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-xl">
          <AD.Title className="text-base font-semibold text-titulo">{titulo}</AD.Title>
          {descricao ? <AD.Description className="mt-2 text-sm text-muted-foreground">{descricao}</AD.Description> : null}
          {children ? <div className="mt-4">{children}</div> : null}
          {aoConfirmar ? (
            <div className="mt-5 flex justify-end gap-2">
              <AD.Cancel asChild>
                <Button variante="contorno">Cancelar</Button>
              </AD.Cancel>
              <Button
                variante={variante}
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  try {
                    await aoConfirmar();
                    setAberto(false);
                  } finally {
                    setOcupado(false);
                  }
                }}
              >
                {ocupado ? "Aguarde..." : textoConfirmar}
              </Button>
            </div>
          ) : null}
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
