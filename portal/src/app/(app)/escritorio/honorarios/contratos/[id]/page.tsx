import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileDown, Send, Upload } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BotaoAcao } from "@/components/ui/acao";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CancelarContrato, GerarAditivo, GerarDistrato } from "@/components/honorarios/contratos";
import { TextoContrato } from "@/components/honorarios/texto-contrato";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { enviarContrato, publicarViaFinal } from "@/lib/honorarios/acoes-contratos";
import type { Clausula, PartesContrato } from "@/lib/honorarios/contrato";
import { SITUACOES_CONTRATO, TIPOS_CONTRATO, numeroContrato } from "@/lib/honorarios/contratos-comum";
import { competenciaAtual, hojeISO, somarMeses } from "@/lib/competencia";
import { formatarDataHora, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Contrato" };

export default async function Contrato({ params, searchParams }: PageProps<"/escritorio/honorarios/contratos/[id]">) {
  const s = await exigirHonorarios();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: c } = await s.supabase.from("honorarios_contratos").select("*, empresa:empresas(razao_social, nome_fantasia)").eq("id", id).maybeSingle();
  if (!c) notFound();
  const { data: derivados } = c.tipo === "contrato"
    ? await s.supabase.from("honorarios_contratos").select("id, ano, numero, tipo, situacao").eq("contrato_origem_id", id).order("created_at")
    : { data: [] };
  const empresa = c.empresa as unknown as { razao_social: string; nome_fantasia: string | null };
  const dados = c.dados as unknown as { partes: PartesContrato; opcoes?: { foro?: string } };
  const sit = SITUACOES_CONTRATO[c.situacao as keyof typeof SITUACOES_CONTRATO];
  const distratado = (derivados ?? []).some((d) => d.tipo === "distrato" && d.situacao !== "cancelado");
  const aviso = typeof sp.aviso === "string" ? sp.aviso : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {TIPOS_CONTRATO[c.tipo as keyof typeof TIPOS_CONTRATO]} nº {numeroContrato(c)} <Badge variante={sit.tom}>{sit.rotulo}</Badge>
          </span>
        }
        descricao={empresa.nome_fantasia ?? empresa.razao_social}
        voltar={{ href: "/escritorio/honorarios/contratos", rotulo: "Contratos" }}
        acoes={
          c.arquivo_path ? (
            <Button asChild variante="contorno">
              <a href={`/api/honorarios/contratos/${c.id}/pdf${c.final_path ? "?via=final" : ""}`}>
                <FileDown /> {c.final_path ? "Via assinada (PDF)" : "PDF"}
              </a>
            </Button>
          ) : null
        }
      />
      {sp.gerado ? <Alerta tom="sucesso">Documento gerado pela ficha. Confira o texto abaixo e clique em Enviar ao cliente.</Alerta> : null}
      {aviso ? <Alerta tom="alerta">Atenção: {aviso}.</Alerta> : null}

      <div className="flex flex-wrap gap-2">
        {c.situacao === "rascunho" ? (
          <BotaoAcao
            acao={enviarContrato.bind(null, c.id)}
            confirmar={{ titulo: "Enviar para o cliente assinar?", descricao: "O sócio titular recebe o aviso no portal e por e-mail, lê e assina. Depois de enviado, o texto não muda (só por aditivo).", textoConfirmar: "Enviar" }}
          >
            <Send /> Enviar ao cliente
          </BotaoAcao>
        ) : null}
        {c.situacao === "assinado" && !c.documento_id ? (
          <BotaoAcao variante="contorno" acao={publicarViaFinal.bind(null, c.id)}>
            <Upload /> Publicar nos documentos do cliente
          </BotaoAcao>
        ) : null}
        {c.tipo === "contrato" && c.situacao === "assinado" && !distratado ? (
          <>
            <GerarAditivo contratoId={c.id} foro={dados.opcoes?.foro ?? ""} mesAtual={competenciaAtual()} />
            <GerarDistrato contratoId={c.id} hoje={hojeISO()} mesAnterior={somarMeses(competenciaAtual(), -1)} />
          </>
        ) : null}
        {c.situacao === "rascunho" || c.situacao === "enviado" ? <CancelarContrato id={c.id} /> : null}
      </div>

      {c.situacao === "assinado" ? (
        <Card>
          <CardHeader>
            <CardTitle>Assinaturas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="block text-xs text-muted-foreground">Cliente</span>
              {c.aceite_nome} · CPF {formatarDocumento(c.aceite_cpf)} · {formatarDataHora(c.aceite_em)}
            </p>
            <p>
              <span className="block text-xs text-muted-foreground">Confirmação</span>
              {c.aceite_metodo === "codigo_email" ? "Senha do portal + código por e-mail" : "Senha do portal"} · IP {c.aceite_ip || "—"}
            </p>
            <p>
              <span className="block text-xs text-muted-foreground">Escritório</span>
              {c.arquivo_assinado ? "Assinado com o certificado digital do escritório (ICP-Brasil)" : "Sem certificado digital cadastrado"}
            </p>
            <p className="break-all">
              <span className="block text-xs text-muted-foreground">Resumo do arquivo aceito (SHA-256)</span>
              <span className="font-mono text-xs">{c.arquivo_hash}</span>
            </p>
          </CardContent>
        </Card>
      ) : null}
      {c.situacao === "cancelado" ? <Alerta tom="info">Cancelado em {formatarDataHora(c.cancelado_em)}: {c.motivo_cancelamento}</Alerta> : null}

      {derivados?.length ? (
        <p className="text-sm text-muted-foreground">
          Ligados a este contrato:{" "}
          {derivados.map((d, i) => (
            <span key={d.id}>
              {i ? ", " : ""}
              <a className="underline" href={`/escritorio/honorarios/contratos/${d.id}`}>
                {TIPOS_CONTRATO[d.tipo as keyof typeof TIPOS_CONTRATO]} nº {numeroContrato(d)}
              </a>{" "}
              ({SITUACOES_CONTRATO[d.situacao as keyof typeof SITUACOES_CONTRATO].rotulo.toLowerCase()})
            </span>
          ))}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{c.titulo}</CardTitle>
        </CardHeader>
        <CardContent>
          <TextoContrato partes={dados.partes} clausulas={c.clausulas as unknown as Clausula[]} />
        </CardContent>
      </Card>
    </div>
  );
}
