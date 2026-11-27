import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { ApagarVinculo } from "@/components/loja/entrada-automatica";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { formatarQuantidade, un } from "@/lib/gestao/rotulos";
import { formatarData, formatarDocumento } from "@/lib/formatos";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Itens de fornecedor ligados" };

export default async function PaginaVinculos({ params }: PageProps<"/e/[empresaId]/loja/produtos/entrada-nota/vinculos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;

  const [vinculos, { data: notas }] = await Promise.all([
    buscarTudo((de, ate) =>
      ctx.supabase
        .from("estoque_vinculos")
        .select("id, fornecedor_documento, codigo_fornecedor, descricao_fornecedor, unidade_fornecedor, fator, updated_at, nfe_produtos(descricao, unidade)")
        .eq("empresa_id", empresaId)
        .order("fornecedor_documento")
        .order("descricao_fornecedor")
        .range(de, ate),
    ),
    ctx.supabase.from("documentos_fiscais").select("emitente_documento, emitente_nome").eq("empresa_id", empresaId).eq("operacao", "entrada").order("data_emissao", { ascending: false }).limit(2000),
  ]);
  // Nome do fornecedor pelas notas de compra recebidas
  const nomes = new Map<string, string>();
  for (const n of notas ?? []) {
    const doc = (n.emitente_documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (doc && n.emitente_nome && !nomes.has(doc)) nomes.set(doc, n.emitente_nome);
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Itens de fornecedor ligados"
        descricao="Cada linha diz: este item do fornecedor é este produto da loja. A nota seguinte já vem ligada (e, com a entrada automática, entra sozinha). Apague um vínculo errado para voltar a conferir."
        voltar={{ href: `/e/${empresaId}/loja/produtos/entrada-nota`, rotulo: "Entrada de mercadorias" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <Card>
        <CardContent className="pt-5">
          {vinculos.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Fornecedor</Th>
                  <Th>Item na nota do fornecedor</Th>
                  <Th>Produto da loja</Th>
                  <Th className="text-right">Conversão</Th>
                  <Th>Atualizado</Th>
                  <Th />
                </tr>
              </THead>
              <TBody>
                {vinculos.map((v) => {
                  const produto = v.nfe_produtos as { descricao: string; unidade: string } | null;
                  return (
                    <Tr key={v.id}>
                      <Td>
                        {nomes.get(v.fornecedor_documento) ?? "Fornecedor"}
                        <span className="block text-xs text-muted-foreground">{formatarDocumento(v.fornecedor_documento)}</span>
                      </Td>
                      <Td>
                        {v.descricao_fornecedor ?? "—"}
                        <span className="block text-xs text-muted-foreground">Cód. {v.codigo_fornecedor}</span>
                      </Td>
                      <Td>{produto?.descricao ?? "—"}</Td>
                      <Td className="numero text-right">
                        1 {un(v.unidade_fornecedor) || "un."} = {formatarQuantidade(v.fator, 6)} {un(produto?.unidade)}
                      </Td>
                      <Td className="numero">{formatarData(v.updated_at)}</Td>
                      <Td className="text-right">
                        <ApagarVinculo empresaId={empresaId} vinculoId={v.id} descricao={v.descricao_fornecedor ?? v.codigo_fornecedor} />
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio
              icone={Link2}
              titulo="Nenhum item ligado ainda"
              descricao="Dê entrada em uma nota de compra com “Lembrar” marcado: os itens do fornecedor ficam ligados aos produtos da loja."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
