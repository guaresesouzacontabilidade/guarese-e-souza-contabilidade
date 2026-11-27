import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { GerarContrato } from "@/components/honorarios/contratos";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { SITUACOES_CONTRATO, TIPOS_CONTRATO as TIPOS, numeroContrato } from "@/lib/honorarios/contratos-comum";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Contratos" };


export default async function Contratos() {
  const s = await exigirHonorarios();
  const [{ data: contratos }, { data: fichas }, { data: esc }] = await Promise.all([
    s.supabase.from("honorarios_contratos").select("id, ano, numero, tipo, situacao, empresa_id, enviado_em, aceite_em, created_at, empresa:empresas(razao_social, nome_fantasia)").order("created_at", { ascending: false }).limit(500),
    s.supabase.from("honorarios_fichas").select("empresa_id, situacao, empresa:empresas(razao_social, nome_fantasia)").neq("situacao", "encerrada"),
    s.supabase.from("escritorio").select("cidade, uf").eq("id", 1).single(),
  ]);
  const lista = contratos ?? [];
  const comContrato = new Set(lista.filter((c) => c.tipo === "contrato" && c.situacao !== "cancelado").map((c) => c.empresa_id));
  const semContrato = (fichas ?? []).filter((f) => !comContrato.has(f.empresa_id));
  const foro = [esc?.cidade, esc?.uf].filter(Boolean).join("/") || "Porto Nacional/TO";
  const nome = (e: unknown) => {
    const x = e as { razao_social: string; nome_fantasia: string | null } | null;
    return x ? (x.nome_fantasia ?? x.razao_social) : "—";
  };

  return (
    <div className="space-y-5">
      <CabecalhoPagina
        titulo="Contratos"
        descricao="Contratos de prestação de serviços montados pela ficha de cada cliente, com aditivo quando a ficha muda e distrato no encerramento. O sócio titular assina no portal."
        voltar={{ href: "/escritorio/honorarios", rotulo: "Honorários" }}
      />
      <Alerta tom="info">O texto segue as cláusulas mínimas da Resolução CFC nº 1.590/2020. É um modelo: vale a revisão do escritório antes do primeiro envio.</Alerta>

      {semContrato.length ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Clientes com ficha e sem contrato</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {semContrato.map((f) => (
              <li key={f.empresa_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <span className="min-w-0 truncate text-sm">{nome(f.empresa)}</span>
                <GerarContrato empresaId={f.empresa_id} foro={foro} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lista.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <THead>
              <Tr>
                <Th>Nº</Th>
                <Th>Tipo</Th>
                <Th>Cliente</Th>
                <Th>Situação</Th>
                <Th>Data</Th>
              </Tr>
            </THead>
            <TBody>
              {lista.map((c) => {
                const sit = SITUACOES_CONTRATO[c.situacao as keyof typeof SITUACOES_CONTRATO];
                return (
                  <Tr key={c.id}>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">{numeroContrato(c)}</Td>
                    <Td>{TIPOS[c.tipo as keyof typeof TIPOS]}</Td>
                    <Td>
                      <Link href={`/escritorio/honorarios/contratos/${c.id}`} className="font-medium hover:text-primary hover:underline">
                        {nome(c.empresa)}
                      </Link>
                    </Td>
                    <Td>
                      <Badge variante={sit.tom}>{sit.rotulo}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{formatarData((c.aceite_em ?? c.enviado_em ?? c.created_at).slice(0, 10))}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : (
        <EstadoVazio icone={FileSignature} titulo="Nenhum contrato ainda" descricao="Cadastre a ficha do cliente e clique em Gerar contrato." />
      )}
    </div>
  );
}
