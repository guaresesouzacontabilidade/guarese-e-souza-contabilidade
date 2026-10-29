import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copy, FileDown } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { ClinicaIndisponivel, DialogoMotivo } from "@/components/veterinaria/comuns";
import { cancelarReceita } from "@/lib/veterinaria/acoes";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { TIPOS_RECEITA, USOS_RECEITA, VIAS } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Receita" };

export default async function PaginaReceita({ params }: PageProps<"/e/[empresaId]/veterinaria/receitas/[receitaId]">) {
  const { empresaId, receitaId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!/^[0-9a-f-]{36}$/i.test(receitaId)) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const [{ data: r }, { data: itens }] = await Promise.all([
    ctx.supabase
      .from("vet_receitas")
      .select("*, paciente:vet_pacientes(id, nome), tutor:vet_tutores(nome), veterinario:vet_veterinarios(id, nome, crmv, crmv_uf)")
      .eq("id", receitaId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("vet_receita_itens").select("*").eq("receita_id", receitaId).order("ordem"),
  ]);
  if (!r) notFound();
  const p = r.paciente as unknown as { id: string; nome: string };
  const v = r.veterinario as unknown as { id: string; nome: string; crmv: string; crmv_uf: string };
  const podeCancelar = !r.cancelada_em && (ctx.veterinario?.id === v.id || ctx.gerente);
  const vias = r.tipo === "magistral_controlada" ? 3 : 2;
  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Receita nº {r.numero} {r.cancelada_em ? <Badge variante="perigo">cancelada</Badge> : null}
          </span>
        }
        descricao={`${TIPOS_RECEITA[r.tipo]?.rotulo ?? r.tipo} · ${p.nome} · tutor ${(r.tutor as unknown as { nome: string }).nome} · ${formatarDataHora(r.emitida_em)}`}
        voltar={{ href: `${base}/pacientes/${p.id}`, rotulo: `Ficha de ${p.nome}` }}
        acoes={
          <>
            {!r.cancelada_em ? (
              <Button asChild>
                <a href={`/api/veterinaria/${empresaId}/receitas/${r.id}`} target="_blank" rel="noopener">
                  <FileDown /> PDF ({vias} vias)
                </a>
              </Button>
            ) : null}
            {ctx.veterinario ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/receitas/nova?paciente=${p.id}&repetir=${r.id}`}>
                  <Copy /> Repetir
                </Link>
              </Button>
            ) : null}
            {podeCancelar ? (
              <DialogoMotivo
                acao={cancelarReceita.bind(null, empresaId, r.id)}
                titulo="Cancelar a receita?"
                descricao="A receita fica no prontuário, marcada como cancelada. Se precisar, emita outra."
                rotuloBotao="Cancelar"
                variante="contorno"
                tamanho="md"
              />
            ) : null}
          </>
        }
      />
      {r.cancelada_em ? (
        <Alerta tom="perigo" className="mb-4">
          Cancelada em {formatarDataHora(r.cancelada_em)}: {r.cancelada_motivo}
        </Alerta>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Prescrição</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            {v.nome} · CRMV-{v.crmv_uf} {v.crmv}
            {r.numero_controle ? ` · Numeração MAPA ${r.numero_controle}` : ""}
            {r.validade ? ` · válida até ${formatarData(r.validade)}` : ""}
            {r.uso_continuo ? " · USO CONTÍNUO" : ""}
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            {(itens ?? []).map((i) => (
              <li key={i.id}>
                <strong>
                  {i.medicamento}
                  {i.concentracao ? ` ${i.concentracao}` : ""}
                </strong>
                {i.forma_farmaceutica ? ` — ${i.forma_farmaceutica}` : ""} · {i.quantidade}
                <span className="block">
                  Uso {VIAS[i.via]?.toLowerCase() ?? i.via}: {i.posologia}
                  {i.duracao ? ` (${i.duracao})` : ""}
                </span>
                <span className="block text-xs text-muted-foreground">{USOS_RECEITA[i.uso] ?? i.uso}</span>
              </li>
            ))}
          </ol>
          {r.observacoes ? <p className="whitespace-pre-line">Obs.: {r.observacoes}</p> : null}
        </CardContent>
      </Card>
    </>
  );
}
