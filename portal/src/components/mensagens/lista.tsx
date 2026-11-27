import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { formatarCompetencia, formatarDataHora } from "@/lib/formatos";

export interface LinhaConversa {
  id: string;
  empresa_id: string;
  empresa_nome?: string;
  assunto: string;
  tipo: string;
  status: string;
  aguardando: string | null;
  competencia: string | null;
  ultima_mensagem_em: string;
  nao_lida: boolean;
}

export function ListaConversas({ conversas, lado, mostrarEmpresa = false }: { conversas: LinhaConversa[]; lado: "cliente" | "escritorio"; mostrarEmpresa?: boolean }) {
  if (!conversas.length) {
    return <EstadoVazio icone={MessagesSquare} titulo="Nenhuma conversa por aqui" descricao="Use “Nova conversa” para falar com o escritório sobre documentos, guias, dúvidas e solicitações." />;
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {conversas.map((c) => (
        <li key={c.id}>
          <Link href={`/e/${c.empresa_id}/mensagens/${c.id}`} className={cn("flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between", c.nao_lida && "bg-bege/40")}>
            <span className="min-w-0">
              <span className={cn("flex items-center gap-2 truncate", c.nao_lida ? "font-semibold text-titulo" : "font-medium")}>
                {c.nao_lida ? <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" /> : null}
                <span className="truncate">{c.assunto}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {mostrarEmpresa && c.empresa_nome ? `${c.empresa_nome} · ` : ""}
                {c.tipo === "solicitacao" ? "Solicitação" : "Mensagem"}
                {c.competencia ? ` · competência ${formatarCompetencia(c.competencia)}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {c.status === "resolvida" ? (
                <Badge variante="sucesso">Resolvida</Badge>
              ) : c.aguardando === lado ? (
                <Badge variante="alerta">Aguardando {lado === "escritorio" ? "o escritório" : "você"}</Badge>
              ) : (
                <Badge variante="info">Aguardando {lado === "escritorio" ? "o cliente" : "o escritório"}</Badge>
              )}
              {formatarDataHora(c.ultima_mensagem_em)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
