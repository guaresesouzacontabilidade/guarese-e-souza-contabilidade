"use client";

import * as React from "react";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { estadoInicial, type ResultadoAcao } from "@/lib/acoes";
import { Alerta } from "./feedback";
import { Button, type ButtonProps } from "./button";
import { Confirmacao } from "./dialog";

type AcaoFormulario = (anterior: ResultadoAcao, formData: FormData) => Promise<ResultadoAcao>;

interface FormularioAcaoProps {
  acao: AcaoFormulario;
  children: React.ReactNode | ((ctx: { estado: ResultadoAcao; pendente: boolean }) => React.ReactNode);
  className?: string;
  aoSucesso?: (estado: ResultadoAcao) => void;
  resetarAoSucesso?: boolean;
  atualizarAoSucesso?: boolean;
  id?: string;
}

/** Formulário ligado a uma ação do servidor, com mensagens de erro e confirmação. */
export function FormularioAcao({
  acao,
  children,
  className,
  aoSucesso,
  resetarAoSucesso = false,
  atualizarAoSucesso = true,
  id,
}: FormularioAcaoProps) {
  const [estado, despachar, pendente] = useActionState(async (anterior: ResultadoAcao, fd: FormData) => {
    const r = await acao(anterior, fd);
    // A confirmação sai aqui, e não no efeito abaixo: quando a resposta já atualiza a
    // página e o formulário some dela (ex.: o aviso que tinha o botão), o efeito não roda.
    if (r.ok && r.mensagem) toast.success(r.mensagem);
    return r;
  }, estadoInicial);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const ultimo = useRef<ResultadoAcao>(estadoInicial);

  useEffect(() => {
    if (estado === ultimo.current) return;
    ultimo.current = estado;
    if (estado.ok) {
      if (resetarAoSucesso) ref.current?.reset();
      aoSucesso?.(estado);
      if (atualizarAoSucesso) router.refresh();
    }
  }, [estado, aoSucesso, resetarAoSucesso, atualizarAoSucesso, router]);

  return (
    <form ref={ref} action={despachar} className={className} id={id} noValidate>
      {estado.mensagem && !estado.ok ? <Alerta tom="perigo" className="mb-4">{estado.mensagem}</Alerta> : null}
      {typeof children === "function" ? children({ estado, pendente }) : children}
    </form>
  );
}

export function BotaoEnviar({ pendente, children, textoPendente = "Salvando...", ...props }: ButtonProps & { pendente: boolean; textoPendente?: string }) {
  return (
    <Button type="submit" disabled={pendente || props.disabled} {...props}>
      {pendente ? <Loader2 className="animate-spin" /> : null}
      {pendente ? textoPendente : children}
    </Button>
  );
}

/** Botão que executa uma ação do servidor (com confirmação opcional). */
export function BotaoAcao({
  acao,
  children,
  confirmar,
  aoSucesso,
  ...props
}: Omit<ButtonProps, "onClick"> & {
  acao: () => Promise<ResultadoAcao>;
  confirmar?: { titulo: string; descricao?: React.ReactNode; textoConfirmar?: string; perigo?: boolean };
  aoSucesso?: (r: ResultadoAcao) => void;
}) {
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const executar = async () => {
    const r = await acao();
    if (r.ok) {
      if (r.mensagem) toast.success(r.mensagem);
      aoSucesso?.(r);
      router.refresh();
    } else {
      toast.error(r.mensagem ?? "Não foi possível concluir a operação.");
    }
  };
  if (confirmar) {
    return (
      <Confirmacao
        gatilho={
          <Button {...props} disabled={pendente || props.disabled}>
            {children}
          </Button>
        }
        titulo={confirmar.titulo}
        descricao={confirmar.descricao}
        textoConfirmar={confirmar.textoConfirmar}
        variante={confirmar.perigo ? "perigo" : "primario"}
        aoConfirmar={executar}
      />
    );
  }
  return (
    <Button {...props} disabled={pendente || props.disabled} onClick={() => iniciar(executar)}>
      {pendente ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
