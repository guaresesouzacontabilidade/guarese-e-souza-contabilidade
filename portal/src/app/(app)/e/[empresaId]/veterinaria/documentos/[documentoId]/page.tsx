import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { ClinicaIndisponivel, DialogoMotivo } from "@/components/veterinaria/comuns";
import { cancelarDocumento } from "@/lib/veterinaria/acoes";
import { formatarDataHora } from "@/lib/formatos";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { TIPOS_DOCUMENTO } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Documento" };

export default async function PaginaDocumento({ params }: PageProps<"/e/[empresaId]/veterinaria/documentos/[documentoId]">) {
  const { empresaId, documentoId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!/^[0-9a-f-]{36}$/i.test(documentoId)) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const { data: d } = await ctx.supabase
    .from("vet_documentos")
    .select("*, paciente:vet_pacientes(id, nome), tutor:vet_tutores(nome), veterinario:vet_veterinarios(id, nome, crmv, crmv_uf)")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!d) notFound();
  const p = d.paciente as unknown as { id: string; nome: string };
  const v = d.veterinario as unknown as { id: string; nome: string; crmv: string; crmv_uf: string };
  const def = TIPOS_DOCUMENTO[d.tipo];
  const dados = (d.dados ?? {}) as Record<string, unknown>;
  const podeCancelar = !d.cancelado_em && (ctx.veterinario?.id === v.id || ctx.gerente);
  const termo = def?.grupo === "Termos de consentimento";
  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {def?.rotulo ?? d.tipo} {d.cancelado_em ? <Badge variante="perigo">cancelado</Badge> : null}
          </span>
        }
        descricao={`nº ${d.numero} · ${p.nome} · tutor ${(d.tutor as unknown as { nome: string }).nome} · ${formatarDataHora(d.emitido_em)} · ${v.nome} (CRMV-${v.crmv_uf} ${v.crmv})`}
        voltar={{ href: `${base}/pacientes/${p.id}`, rotulo: `Ficha de ${p.nome}` }}
        acoes={
          <>
            {!d.cancelado_em ? (
              <Button asChild>
                <a href={`/api/veterinaria/${empresaId}/documentos/${d.id}`} target="_blank" rel="noopener">
                  <FileDown /> PDF (2 vias)
                </a>
              </Button>
            ) : null}
            {podeCancelar ? (
              <DialogoMotivo
                acao={cancelarDocumento.bind(null, empresaId, d.id)}
                titulo="Cancelar o documento?"
                descricao={d.tipo === "atestado_obito" ? "O óbito sai da ficha do animal (se não houver outro atestado de óbito)." : "O documento fica no prontuário, marcado como cancelado."}
                rotuloBotao="Cancelar"
                variante="contorno"
                tamanho="md"
              />
            ) : null}
          </>
        }
      />
      {d.cancelado_em ? (
        <Alerta tom="perigo" className="mb-4">
          Cancelado em {formatarDataHora(d.cancelado_em)}: {d.cancelado_motivo}
        </Alerta>
      ) : termo ? (
        <Alerta tom="info" className="mb-4">
          Imprima, leia com o responsável e colha a assinatura dele antes do procedimento. Uma via fica com a clínica e outra com o responsável.
        </Alerta>
      ) : null}
      <Card>
        <CardContent className="space-y-3 pt-6 text-sm">
          {(def?.campos ?? []).map((c) =>
            dados[c.nome] ? (
              <div key={c.nome}>
                <p className="font-medium text-muted-foreground">{c.rotulo}</p>
                <p className="whitespace-pre-line">{c.tipo === "datahora" ? formatarDataHora(String(dados[c.nome])) : String(dados[c.nome])}</p>
              </div>
            ) : null,
          )}
          {dados.observacoes_veterinario ? (
            <div>
              <p className="font-medium text-muted-foreground">Observações do veterinário</p>
              <p className="whitespace-pre-line">{String(dados.observacoes_veterinario)}</p>
            </div>
          ) : null}
          {dados.observacoes_responsavel ? (
            <div>
              <p className="font-medium text-muted-foreground">Observações do responsável</p>
              <p className="whitespace-pre-line">{String(dados.observacoes_responsavel)}</p>
            </div>
          ) : null}
          {d.tipo === "atestado_vacinacao" ? <p>{(dados.vacinacoes as string[] | undefined)?.length ?? 0} vacina(s) no atestado — veja no PDF.</p> : null}
        </CardContent>
      </Card>
    </>
  );
}
