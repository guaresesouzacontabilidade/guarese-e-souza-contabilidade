import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { EmitirCte, type OpcaoOperacaoCte } from "@/components/cte/emitir-cte";
import { parametro } from "@/lib/busca";
import type { PedidoCte } from "@/lib/cte-emissao/acoes";
import { pedidoCteDaOrdem } from "@/lib/cte-emissao/cte-da-ordem";

export const metadata: Metadata = { title: "Emitir CT-e" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NovoCte({ params, searchParams }: PageProps<"/e/[empresaId]/cte/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("cte.emitir")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de CT-e desta empresa.</Alerta>;
  const base = `/e/${empresaId}/cte`;

  const [{ data: cfg }, { data: operacoes }, { data: participantes }] = await Promise.all([
    ctx.supabase.from("cte_config").select("ativa, ambiente, rntrc, emitente:nfe_emitentes(municipio:municipios(uf))").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("cte_operacoes").select("id, nome, natureza, cfop, destino").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.supabase.from("nfe_destinatarios").select("id, nome, documento, municipio:municipios(nome, uf)").eq("empresa_id", empresaId).neq("tipo", "estrangeiro").order("nome").limit(2000),
  ]);
  // Emissão desligada, mas já configurada: o formulário abre só para conferir os valores (nada vai à SEFAZ)
  const somenteConferir = !cfg?.ativa;
  if (!cfg?.emitente || !cfg.rntrc) {
    return (
      <Alerta tom="alerta" titulo="Emissão desconectada">
        A emissão de CT-e desta empresa ainda não foi configurada pelo escritório. <Link href={base} className="underline">Voltar</Link>
      </Alerta>
    );
  }
  if (!operacoes?.length) {
    return (
      <Alerta tom="alerta" titulo="Faltam cadastros">
        Para emitir, o escritório precisa cadastrar as operações do frete. <Link href={base} className="underline">Voltar</Link>
      </Alerta>
    );
  }
  const ufEmitente = ((cfg.emitente as { municipio?: { uf?: string } | null } | null)?.municipio ?? null)?.uf ?? "";

  // Corrigir um CT-e rejeitado (mesmo número) ou copiar os dados de outro
  const corrigirId = parametro(sp, "corrigir");
  const copiarId = parametro(sp, "copiar");
  const origemId = corrigirId && UUID.test(corrigirId) ? corrigirId : copiarId && UUID.test(copiarId) ? copiarId : null;
  let inicial: PedidoCte | null = null;
  let corrigir: { id: string; numero: number } | null = null;
  if (origemId) {
    const { data: origem } = await ctx.supabase.from("cte_emissoes").select("id, numero, situacao, pedido").eq("id", origemId).eq("empresa_id", empresaId).maybeSingle();
    if (origem) {
      inicial = origem.pedido as unknown as PedidoCte;
      if (origemId === corrigirId && origem.situacao === "rejeitada") corrigir = { id: origem.id, numero: Number(origem.numero) };
      else inicial = { ...inicial, nfes: [], origem: undefined };
    }
  }
  // CT-e a partir de uma ordem de carregamento
  const ordemParam = parametro(sp, "ordem");
  const daOrdem = !origemId && ordemParam && UUID.test(ordemParam) ? await pedidoCteDaOrdem(ctx.supabase, empresaId, ordemParam) : null;
  if (daOrdem) inicial = daOrdem.pedido;

  return (
    <>
      <CabecalhoPagina
        titulo={corrigir ? `Corrigir o CT-e nº ${corrigir.numero}` : daOrdem ? `Emitir CT-e da ordem de carregamento nº ${daOrdem.numero}` : "Emitir CT-e"}
        descricao="Informe as partes, o valor do frete e a carga (ou preencha pela NF-e). O portal calcula o ICMS e o IBS/CBS e mostra os valores para você conferir antes de enviar à SEFAZ."
        voltar={{ href: base, rotulo: "CT-e (frete)" }}
      />
      {somenteConferir ? (
        <Alerta tom="alerta" className="mb-4" titulo="Emissão desconectada: modo de conferência">
          Você pode preencher e conferir o cálculo do frete (ICMS e IBS/CBS), mas nada é enviado à SEFAZ. O envio começa quando o escritório ligar a emissão, com o certificado
          digital da empresa.
        </Alerta>
      ) : null}
      {daOrdem ? (
        <div className="mb-4 space-y-2">
          <Alerta tom="info" titulo={`Comprador, carga, peso e NF-e vieram da ordem nº ${daOrdem.numero}`}>
            Confira as partes, a operação do frete e informe o valor do frete antes de enviar.{" "}
            <Link href={`/e/${empresaId}/loja/carregamentos/${ordemParam}`} className="underline">
              Ver a ordem
            </Link>
          </Alerta>
          {daOrdem.avisos.map((a) => (
            <Alerta key={a} tom="alerta">
              {a}
            </Alerta>
          ))}
        </div>
      ) : null}
      <Card>
        <CardContent>
          <EmitirCte
            empresaId={empresaId}
            ambiente={cfg.ambiente as "homologacao" | "producao"}
            ufEmitente={ufEmitente}
            operacoes={operacoes.map((o) => ({ id: o.id, nome: o.nome, natureza: o.natureza, cfop: o.cfop, destino: o.destino as OpcaoOperacaoCte["destino"] }))}
            participantes={(participantes ?? []).map((p) => {
              const m = p.municipio as { nome?: string; uf?: string } | null;
              return { id: p.id, nome: p.nome, documento: p.documento, municipio: m?.nome ?? null, uf: m?.uf ?? null };
            })}
            inicial={inicial}
            corrigir={corrigir}
            somenteConferir={somenteConferir}
          />
        </CardContent>
      </Card>
    </>
  );
}
