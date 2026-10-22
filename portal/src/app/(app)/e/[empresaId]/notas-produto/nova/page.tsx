import type { Metadata } from "next";
import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { EmitirNota, type OpcaoOperacao } from "@/components/nfe/emitir-nota";
import { parametro } from "@/lib/busca";
import type { PedidoNfe } from "@/lib/nfe-emissao/acoes";
import { pedidoDaVenda } from "@/lib/gestao/nfe-da-venda";

export const metadata: Metadata = { title: "Emitir NF-e" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NovaNfe({ params, searchParams }: PageProps<"/e/[empresaId]/notas-produto/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("nfe.emitir")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de NF-e desta empresa.</Alerta>;
  const base = `/e/${empresaId}/notas-produto`;

  const [{ data: cfg }, { data: emitentes }, { data: operacoes }, { data: produtos }, { data: destinatarios }, { data: transportadores }] = await Promise.all([
    ctx.supabase.from("nfe_config").select("ativa, ambiente").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("nfe_emitentes").select("id, nome, serie, inscricao_estadual, municipio:municipios(uf)").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("nfe_operacoes").select("id, nome, natureza, cfop, destino, finalidade, frete_icms_retido").eq("empresa_id", empresaId).eq("ativa", true).order("nome"),
    ctx.supabase.from("nfe_produtos").select("id, codigo, descricao, unidade, valor_unitario, peso_kg").eq("empresa_id", empresaId).eq("ativo", true).order("descricao"),
    ctx.supabase.from("nfe_destinatarios").select("id, nome, documento, municipio:municipios(uf)").eq("empresa_id", empresaId).order("nome").limit(2000),
    ctx.supabase.from("nfe_transportadores").select("id, nome, documento, placa, placa_uf, rntc").eq("empresa_id", empresaId).order("nome").limit(1000),
  ]);
  if (!cfg?.ativa) {
    return (
      <Alerta tom="alerta" titulo="Emissão desconectada">
        A emissão de NF-e desta empresa ainda não foi ligada pelo escritório. <Link href={base} className="underline">Voltar</Link>
      </Alerta>
    );
  }
  if (!emitentes?.length || !operacoes?.length || !produtos?.length) {
    return (
      <Alerta tom="alerta" titulo="Faltam cadastros">
        Para emitir, o escritório precisa cadastrar {[!emitentes?.length && "a inscrição estadual", !operacoes?.length && "as operações", !produtos?.length && "os produtos"].filter(Boolean).join(", ")}.{" "}
        <Link href={base} className="underline">Voltar</Link>
      </Alerta>
    );
  }

  // Corrigir uma rejeitada (mesmo número) ou copiar os dados de outra nota
  const corrigirId = parametro(sp, "corrigir");
  const copiarId = parametro(sp, "copiar");
  const origemId = corrigirId && UUID.test(corrigirId) ? corrigirId : copiarId && UUID.test(copiarId) ? copiarId : null;
  let inicial: PedidoNfe | null = null;
  let corrigir: { id: string; numero: number } | null = null;
  if (origemId) {
    const { data: origem } = await ctx.supabase.from("nfe_emissoes").select("id, numero, situacao, pedido").eq("id", origemId).eq("empresa_id", empresaId).maybeSingle();
    if (origem) {
      inicial = origem.pedido as unknown as PedidoNfe;
      if (origemId === corrigirId && origem.situacao === "rejeitada") corrigir = { id: origem.id, numero: Number(origem.numero) };
    }
  }

  // Nota a partir de uma venda da loja (quando o cliente pede a nota)
  const vendaParam = parametro(sp, "venda");
  const daVenda = !origemId && vendaParam && UUID.test(vendaParam) ? await pedidoDaVenda(ctx.supabase, empresaId, vendaParam) : null;
  if (daVenda) inicial = daVenda.pedido;

  return (
    <>
      <CabecalhoPagina
        titulo={corrigir ? `Corrigir a NF-e nº ${corrigir.numero}` : daVenda ? `Emitir NF-e da venda nº ${daVenda.numero}` : "Emitir NF-e"}
        descricao="Escolha a operação, o cliente e os produtos. O portal calcula os impostos e mostra os valores para você conferir antes de enviar à SEFAZ."
        voltar={{ href: base, rotulo: "Notas de produto" }}
      />
      {daVenda ? (
        <div className="mb-4 space-y-2">
          <Alerta tom="info" titulo={`Itens, frete, desconto e pagamento vieram da venda nº ${daVenda.numero}`}>
            Confira a operação e os impostos antes de enviar. Ao emitir, a venda fica ligada à nota.{" "}
            <Link href={`/e/${empresaId}/loja/vendas/${vendaParam}`} className="underline">
              Ver a venda
            </Link>
          </Alerta>
          {daVenda.avisos.map((a) => (
            <Alerta key={a} tom="alerta">
              {a}
            </Alerta>
          ))}
        </div>
      ) : null}
      <Card>
        <CardContent>
          <EmitirNota
            empresaId={empresaId}
            ambiente={cfg.ambiente as "homologacao" | "producao"}
            emitentes={emitentes.map((e) => ({ id: e.id, nome: e.nome, serie: e.serie, inscricao: e.inscricao_estadual, uf: (e.municipio as { uf?: string } | null)?.uf ?? "" }))}
            operacoes={operacoes.map((o) => ({
              id: o.id,
              nome: o.nome,
              natureza: o.natureza,
              cfop: o.cfop,
              destino: o.destino as OpcaoOperacao["destino"],
              finalidade: o.finalidade,
              freteIcmsRetido: o.frete_icms_retido,
            }))}
            produtos={produtos.map((p) => ({
              id: p.id,
              codigo: p.codigo,
              descricao: p.descricao,
              unidade: p.unidade,
              valorUnitario: p.valor_unitario == null ? null : Number(p.valor_unitario),
              pesoKg: p.peso_kg == null ? null : Number(p.peso_kg),
            }))}
            destinatarios={(destinatarios ?? []).map((d) => ({ id: d.id, nome: d.nome, documento: d.documento, uf: (d.municipio as { uf?: string } | null)?.uf ?? null }))}
            transportadores={(transportadores ?? []).map((t) => ({ id: t.id, nome: t.nome, documento: t.documento, placa: t.placa, placaUf: t.placa_uf, rntc: t.rntc }))}
            inicial={inicial}
            corrigir={corrigir}
            vendaId={daVenda ? vendaParam : null}
          />
        </CardContent>
      </Card>
    </>
  );
}
