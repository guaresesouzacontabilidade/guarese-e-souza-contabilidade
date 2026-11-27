import Link from "next/link";
import { Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarDataHora, formatarTamanho } from "@/lib/formatos";
import { ROTULO_TIPO_LOTE, SITUACAO_LOTE, TIPOS_LOTE, type ParteLote, type SituacaoLote, type TipoLote } from "@/lib/lotes-xml/rotulos";

export interface LoteXml {
  id: string;
  empresa_id: string;
  competencia: string;
  tipos: string[];
  situacao: string;
  partes: unknown;
  total_arquivos: number | null;
  resumo: unknown;
  erro: string | null;
  criado_em: string;
  expira_em: string | null;
  empresa?: { razao_social: string; nome_fantasia: string | null } | null;
}

export const emPreparo = (l: { situacao: string }) => l.situacao === "pendente" || l.situacao === "gerando";

export function tiposTexto(tipos: string[]) {
  if (TIPOS_LOTE.every((t) => tipos.includes(t))) return "Todos os tipos";
  return tipos.map((t) => ROTULO_TIPO_LOTE[t as TipoLote] ?? t).join(", ");
}

function Downloads({ lote }: { lote: LoteXml }) {
  const partes = ((lote.partes as ParteLote[] | null) ?? []).slice().sort((a, b) => a.numero - b.numero);
  if (lote.situacao !== "pronto" || !partes.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {partes.map((p) => (
        <a
          key={p.numero}
          href={`/api/lotes-xml/${lote.id}/${p.numero}`}
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          title={`${p.arquivos} arquivos · ${formatarTamanho(p.bytes)}`}
        >
          <Download className="size-3.5" />
          {partes.length > 1 ? `Parte ${p.numero}` : "Baixar"}
          <span className="text-xs font-normal text-muted-foreground">({formatarTamanho(p.bytes)})</span>
        </a>
      ))}
    </div>
  );
}

function Situacao({ lote }: { lote: LoteXml }) {
  const s = SITUACAO_LOTE[lote.situacao as SituacaoLote] ?? { rotulo: lote.situacao, tom: "neutro" as const };
  const partes = ((lote.partes as ParteLote[] | null) ?? []).length;
  return (
    <>
      <Badge variante={s.tom}>
        {emPreparo(lote) ? <Loader2 className="size-3 animate-spin" /> : null}
        {s.rotulo}
        {lote.situacao === "gerando" && partes ? ` (parte ${partes + 1})` : ""}
      </Badge>
      {lote.situacao === "erro" && lote.erro ? <span className="mt-1 block max-w-xs text-xs text-perigo">{lote.erro}</span> : null}
    </>
  );
}

function Conteudo({ lote }: { lote: LoteXml }) {
  const resumo = (lote.resumo ?? null) as { valor_notas?: number | string; resumos_sem_xml?: unknown[] } | null;
  const partes = (lote.partes as ParteLote[] | null) ?? [];
  const incluidos = partes.reduce((t, p) => t + (p.arquivos ?? 0), 0);
  const semXml = resumo?.resumos_sem_xml?.length ?? 0;
  if (lote.situacao === "vazio") return <span className="text-muted-foreground">Nenhuma nota no mês</span>;
  if (lote.total_arquivos == null) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <span className="block">
        {lote.situacao === "pronto" ? incluidos : lote.total_arquivos} {(lote.situacao === "pronto" ? incluidos : lote.total_arquivos) === 1 ? "arquivo" : "arquivos"}
      </span>
      {resumo?.valor_notas != null ? <span className="block text-xs text-muted-foreground">Notas: {formatarMoeda(resumo.valor_notas)}</span> : null}
      {lote.situacao === "pronto" && incluidos < (lote.total_arquivos ?? 0) ? (
        <span className="block text-xs text-alerta-fg">{(lote.total_arquivos ?? 0) - incluidos} indisponível(is) — veja o LEIA-ME</span>
      ) : null}
      {semXml ? <span className="block text-xs text-alerta-fg">{semXml} NF-e só em resumo (sem XML)</span> : null}
    </>
  );
}

/** Lotes de XML: um por linha (com a empresa, na carteira). */
export function TabelaLotes({ lotes, mostrarEmpresa = false }: { lotes: LoteXml[]; mostrarEmpresa?: boolean }) {
  return (
    <Table>
      <THead>
        <Tr>
          {mostrarEmpresa ? <Th>Empresa</Th> : <Th>Mês</Th>}
          <Th>Situação</Th>
          <Th className="hidden sm:table-cell">Conteúdo</Th>
          <Th className="hidden md:table-cell">Disponível até</Th>
          <Th>Arquivo</Th>
        </Tr>
      </THead>
      <TBody>
        {lotes.map((l) => (
          <Tr key={l.id} data-lote={l.situacao}>
            <Td>
              {mostrarEmpresa ? (
                <Link href={`/e/${l.empresa_id}/notas-automaticas#lotes-xml`} className="font-medium text-primary hover:underline">
                  {l.empresa?.nome_fantasia ?? l.empresa?.razao_social ?? "Empresa"}
                </Link>
              ) : (
                <span className="font-medium">{formatarCompetencia(l.competencia)}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {mostrarEmpresa ? "" : `${tiposTexto(l.tipos)} · `}pedido {formatarDataHora(l.criado_em)}
              </span>
            </Td>
            <Td>
              <Situacao lote={l} />
            </Td>
            <Td className="hidden text-sm sm:table-cell">
              <Conteudo lote={l} />
            </Td>
            <Td className="hidden text-sm md:table-cell">{l.situacao === "pronto" && l.expira_em ? formatarDataHora(l.expira_em) : "—"}</Td>
            <Td className="text-sm">
              <Downloads lote={l} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

