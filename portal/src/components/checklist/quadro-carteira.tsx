"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Textarea } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { Progresso } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { enviarLembretesEmLote } from "@/lib/checklist/acoes";

export interface LinhaCarteira {
  id: string;
  nome: string;
  responsavel: string | null;
  total: number;
  percentual: number | null;
  faltantes: number;
  atrasados: number;
  correcao: number;
  emRevisao: number;
  enviados: number;
  proximoPrazo: string | null;
  ultimoEnvio: string | null;
  ultimoLembrete: string | null;
}

export function QuadroCarteira({ linhas, competencia }: { linhas: LinhaCarteira[]; competencia: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mensagem, setMensagem] = useState("");
  const todos = linhas.length > 0 && sel.size === linhas.length;
  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{sel.size ? `${sel.size} empresa(s) selecionada(s)` : "Selecione empresas para enviar lembretes em lote."}</p>
        <Confirmacao
          gatilho={
            <Button variante="contorno" disabled={!sel.size}>
              <BellRing /> Enviar lembrete às selecionadas
            </Button>
          }
          titulo="Enviar lembrete das pendências"
          descricao="Cada empresa recebe a lista do que falta nesta competência (no portal e por e-mail, se ativado). Empresas sem pendências são ignoradas."
          textoConfirmar="Enviar"
          aoConfirmar={async () => {
            const r = await enviarLembretesEmLote([...sel], competencia, mensagem);
            if (r.ok) {
              toast.success(r.mensagem ?? "Lembretes enviados.");
              setSel(new Set());
              setMensagem("");
              router.refresh();
            } else {
              toast.error(r.mensagem ?? "Não foi possível enviar.");
              return false;
            }
          }}
        >
          <Textarea aria-label="Mensagem opcional" placeholder="Mensagem opcional" value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={2} />
        </Confirmacao>
      </div>
      <Table>
        <THead>
          <tr>
            <Th className="w-8">
              <Checkbox aria-label="Selecionar todas" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(linhas.map((l) => l.id)))} />
            </Th>
            <Th>Empresa</Th>
            <Th className="min-w-36">Entrega</Th>
            <Th className="text-center">Faltam</Th>
            <Th className="text-center">Atrasados</Th>
            <Th className="text-center">Correção</Th>
            <Th className="text-center">A conferir</Th>
            <Th>Próximo prazo</Th>
            <Th>Último envio</Th>
            <Th>Último lembrete</Th>
          </tr>
        </THead>
        <TBody>
          {linhas.map((l) => (
            <Tr key={l.id}>
              <Td>
                <Checkbox aria-label={`Selecionar ${l.nome}`} checked={sel.has(l.id)} onChange={() => alternar(l.id)} />
              </Td>
              <Td className="max-w-[16rem]">
                <Link href={`/e/${l.id}/pendencias?competencia=${competencia}`} className="block truncate font-medium hover:underline">
                  {l.nome}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">{l.responsavel ?? "sem responsável"}</span>
              </Td>
              <Td>
                {l.total ? (
                  <div className="space-y-1">
                    <span className="text-xs numero">{l.percentual == null ? "—" : `${l.percentual}%`}</span>
                    <Progresso valor={l.percentual} rotulo={`Entrega de ${l.nome}`} />
                  </div>
                ) : (
                  <Badge variante="neutro">Sem checklist</Badge>
                )}
              </Td>
              <Td className="text-center numero">{l.faltantes || "—"}</Td>
              <Td className="text-center numero">{l.atrasados ? <Badge variante="perigo">{l.atrasados}</Badge> : "—"}</Td>
              <Td className="text-center numero">{l.correcao ? <Badge variante="perigo">{l.correcao}</Badge> : "—"}</Td>
              <Td className="text-center numero">
                {l.enviados || l.emRevisao ? (
                  <Badge variante="info">
                    {l.enviados}
                    {l.emRevisao ? ` + ${l.emRevisao} “não se aplica”` : ""}
                  </Badge>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="whitespace-nowrap text-sm">{formatarData(l.proximoPrazo)}</Td>
              <Td className="whitespace-nowrap text-sm">{l.ultimoEnvio ? formatarDataHora(l.ultimoEnvio) : "—"}</Td>
              <Td className="whitespace-nowrap text-sm">{l.ultimoLembrete ? formatarDataHora(l.ultimoLembrete) : "—"}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
