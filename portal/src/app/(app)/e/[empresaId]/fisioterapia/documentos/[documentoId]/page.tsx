import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock, X } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { BotaoImprimir } from "@/components/fisioterapia/imprimir";
import { DialogoMotivo, FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { cancelarDocumento } from "@/lib/fisioterapia/acoes";
import { diaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { crefitoTexto } from "@/lib/fisioterapia/rotulos";

export const metadata: Metadata = { title: "Documento da clínica" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export default async function PaginaDocumentoFisio({ params }: PageProps<"/e/[empresaId]/fisioterapia/documentos/[documentoId]">) {
  const { empresaId, documentoId } = await params;
  if (!UUID.test(documentoId)) notFound();
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!ctx.profissional) return <EstadoVazio icone={Lock} titulo="Documento do prontuário" descricao="Só os fisioterapeutas da clínica leem os documentos do prontuário." />;
  const [{ data: d }, { data: cfg }, { data: empresa }] = await Promise.all([
    ctx.supabase
      .from("fisio_documentos")
      .select("*, paciente:fisio_pacientes(id, nome, cpf), profissional:fisio_profissionais(id, nome, crefito, crefito_regiao)")
      .eq("id", documentoId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("fisio_config").select("nome_clinica, registro_crefito, telefone, endereco, cidade_documentos").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("empresas").select("razao_social, nome_fantasia, documento").eq("id", empresaId).maybeSingle(),
  ]);
  if (!d) notFound();
  const paciente = d.paciente as unknown as { id: string; nome: string; cpf: string | null };
  const prof = d.profissional as unknown as { id: string; nome: string; crefito: string; crefito_regiao: number };
  const clinica = cfg?.nome_clinica || empresa?.nome_fantasia || empresa?.razao_social || "";
  const dia = diaLocal(d.emitido_em);
  const [a, m, dd] = dia.split("-").map(Number);
  const base = `/e/${empresaId}/fisioterapia`;

  return (
    <>
      <div className="print:hidden">
        <CabecalhoPagina
          titulo={`${d.titulo} nº ${d.numero}`}
          descricao={`${paciente.nome} · emitido em ${formatarData(dia)}`}
          voltar={{ href: `${base}/pacientes/${paciente.id}`, rotulo: paciente.nome }}
          acoes={
            <div className="flex flex-wrap items-center gap-2">
              {d.cancelado_em ? <Badge variante="perigo">Cancelado</Badge> : <BotaoImprimir />}
              {!d.cancelado_em && prof.id === ctx.profissional.id ? (
                <DialogoMotivo acao={cancelarDocumento.bind(null, empresaId, d.id)} titulo="Cancelar este documento?" rotuloBotao="Cancelar" textoConfirmar="Cancelar documento" icone={<X />} />
              ) : null}
            </div>
          }
        />
        {d.cancelado_em ? <p className="mb-4 text-sm text-muted-foreground">Cancelado: {d.cancelado_motivo}</p> : null}
      </div>
      <Card className="mx-auto max-w-3xl print:border-0 print:shadow-none">
        <CardContent className="space-y-8 p-8 sm:p-12">
          <header className="border-b border-border pb-4 text-center">
            <p className="text-lg font-semibold">{clinica}</p>
            <p className="text-xs text-muted-foreground">
              {[empresa?.documento ? `CNPJ/CPF ${formatarDocumento(empresa.documento)}` : null, cfg?.registro_crefito ? `CREFITO ${cfg.registro_crefito}` : null, cfg?.telefone]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {cfg?.endereco ? <p className="text-xs text-muted-foreground">{cfg.endereco}</p> : null}
          </header>
          <h1 className="text-center text-xl font-semibold uppercase tracking-wide">{d.titulo}</h1>
          <div className="text-justify text-base leading-relaxed whitespace-pre-wrap">{d.texto}</div>
          <p className="text-right">
            {cfg?.cidade_documentos ? `${cfg.cidade_documentos}, ` : ""}
            {dd} de {MESES[m - 1]} de {a}.
          </p>
          <div className="mx-auto w-72 border-t border-foreground pt-2 text-center text-sm">
            <p className="font-medium">{prof.nome}</p>
            <p>Fisioterapeuta · {crefitoTexto(prof)}</p>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Documento nº {d.numero} · Paciente: {paciente.nome}
            {paciente.cpf ? ` · CPF ${formatarDocumento(paciente.cpf)}` : ""}
          </p>
        </CardContent>
      </Card>
    </>
  );
}
