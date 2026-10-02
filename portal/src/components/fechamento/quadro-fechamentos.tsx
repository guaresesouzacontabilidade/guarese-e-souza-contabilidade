import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Progresso } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData } from "@/lib/formatos";
import { ETAPAS_FECHAMENTO, STATUS_COMPETENCIA } from "@/lib/rotulos";

export interface LinhaFechamento {
  id: string;
  nome: string;
  responsavel: string | null;
  /** Usuário pode conduzir o fechamento desta empresa (fechamento.gerenciar). */
  acesso: boolean;
  status: string;
  iniciado: boolean;
  etapasConcluidas: number;
  etapasTotal: number;
  etapaAtual: string | null;
  responsavelEtapa: string | null;
  impeditivas: number;
  pendenciasAbertas: number;
  checklist: number | null;
  fechadaEm: string | null;
  reaberta: boolean;
}

/** Quadro de fechamentos da carteira (uma linha por empresa). */
export function QuadroFechamentos({ linhas, competencia }: { linhas: LinhaFechamento[]; competencia: string }) {
  return (
    <Table>
      <THead>
        <tr>
          <Th>Empresa</Th>
          <Th>Situação</Th>
          <Th className="min-w-40">Etapas</Th>
          <Th>Etapa atual</Th>
          <Th className="text-center">Pendências</Th>
          <Th className="min-w-28">Checklist</Th>
          <Th>Fechada em</Th>
        </tr>
      </THead>
      <TBody>
        {linhas.map((l) => {
          const st = l.iniciado || l.status !== "aberta" ? (STATUS_COMPETENCIA[l.status] ?? { rotulo: l.status, tom: "neutro" as const }) : { rotulo: "Não iniciado", tom: "neutro" as const };
          const percentual = l.etapasTotal ? Math.round((100 * l.etapasConcluidas) / l.etapasTotal) : null;
          return (
            <Tr key={l.id}>
              <Td className="max-w-[16rem]">
                {l.acesso ? (
                  <Link href={`/e/${l.id}/fechamento?competencia=${competencia}`} className="block truncate font-medium hover:underline">
                    {l.nome}
                  </Link>
                ) : (
                  <span className="block truncate font-medium" title="Seu acesso não inclui o fechamento desta empresa.">
                    {l.nome}
                  </span>
                )}
                <span className="block truncate text-xs text-muted-foreground">{l.responsavel ?? "sem responsável"}</span>
              </Td>
              <Td>
                <span className="flex flex-wrap items-center gap-1">
                  <Badge variante={st.tom}>{st.rotulo}</Badge>
                  {l.reaberta ? <Badge variante="contorno">Reaberta</Badge> : null}
                </span>
              </Td>
              <Td>
                {l.iniciado ? (
                  <div className="space-y-1">
                    <span className="text-xs numero">
                      {l.etapasConcluidas}/{l.etapasTotal}
                    </span>
                    <Progresso valor={percentual} rotulo={`Etapas de ${l.nome}`} />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </Td>
              <Td className="text-sm">
                {l.etapaAtual ? (
                  <>
                    <span className="block whitespace-nowrap">{ETAPAS_FECHAMENTO[l.etapaAtual] ?? l.etapaAtual}</span>
                    <span className="block truncate text-xs text-muted-foreground">{l.responsavelEtapa ?? "sem responsável"}</span>
                  </>
                ) : l.iniciado ? (
                  <span className="text-muted-foreground">Todas concluídas</span>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="text-center numero">
                {l.impeditivas ? (
                  <Badge variante="perigo">{l.impeditivas} impeditiva(s)</Badge>
                ) : l.pendenciasAbertas ? (
                  <Badge variante="alerta">{l.pendenciasAbertas}</Badge>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {l.checklist == null ? (
                  <span className="text-xs text-muted-foreground">Sem checklist</span>
                ) : (
                  <div className="space-y-1">
                    <span className="text-xs numero">{l.checklist}%</span>
                    <Progresso valor={l.checklist} rotulo={`Checklist de ${l.nome}`} />
                  </div>
                )}
              </Td>
              <Td className="whitespace-nowrap text-sm">{formatarData(l.fechadaEm)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
