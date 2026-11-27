import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { BotaoAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormularioAjuste } from "@/components/relatorios/formulario-ajuste";
import { excluirAjuste } from "@/lib/relatorios/acoes-modelo-dre";
import { tipoEntraNoDre, naturezaDoTipo } from "@/lib/financeiro/plano-contas";
import { formatarDataHora } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { hojeISO } from "@/lib/competencia";

export const metadata: Metadata = { title: "Ajustes no resultado" };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`;

export default async function AjustesDre({ params }: PageProps<"/e/[empresaId]/relatorios/dre/ajustes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) redirect(`/e/${empresaId}/relatorios/publicados`);
  const podeEditar = ctx.pode("financeiro.editar");

  const [{ data: ajustes }, { data: cats }] = await Promise.all([
    ctx.supabase
      .from("dre_ajustes")
      .select("id, competencia, valor, motivo, created_at, categoria:categorias_financeiras(codigo, nome, tipo)")
      .eq("empresa_id", empresaId)
      .order("competencia", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    ctx.supabase.from("categorias_financeiras").select("id, codigo, nome, tipo, sintetica, ativa").eq("empresa_id", empresaId).order("codigo"),
  ]);
  const contas = (cats ?? []).filter((c) => !c.sintetica && c.ativa && tipoEntraNoDre(c.tipo)).map((c) => ({ id: c.id, rotulo: `${c.codigo} ${c.nome}`, natureza: naturezaDoTipo(c.tipo) }));

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: `/e/${empresaId}/relatorios/dre`, rotulo: "Resultado (DRE)" }}
        titulo="Ajustes no resultado"
        descricao="Valores que entram só no DRE, sem mexer no caixa nem nas contas a pagar: depreciação, provisão de 13º e férias, correções. Cada ajuste tem motivo e fica no histórico."
      />
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        {podeEditar ? (
          <Card>
            <CardContent className="pt-5">
              <h2 className="mb-3 text-base font-semibold">Novo ajuste</h2>
              <FormularioAjuste empresaId={empresaId} contas={contas} mesInicial={hojeISO().slice(0, 7)} />
            </CardContent>
          </Card>
        ) : (
          <Alerta tom="info">Seu acesso permite apenas consultar os ajustes.</Alerta>
        )}
        <section aria-labelledby="t-ajustes" className="min-w-0 space-y-2">
          <h2 id="t-ajustes" className="text-base font-semibold">
            Ajustes lançados
          </h2>
          {!ajustes?.length ? (
            <EstadoVazio titulo="Nenhum ajuste lançado" descricao="Os ajustes aparecem no DRE do mês, junto da conta escolhida." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Mês</Th>
                  <Th>Conta</Th>
                  <Th>Motivo</Th>
                  <Th className="text-right">Valor</Th>
                  {podeEditar ? <Th className="w-10"><span className="sr-only">Ações</span></Th> : null}
                </tr>
              </THead>
              <TBody>
                {ajustes.map((a) => {
                  const cat = a.categoria as { codigo: string; nome: string; tipo: string } | null;
                  return (
                    <Tr key={a.id}>
                      <Td className="whitespace-nowrap text-sm">{rotuloMes(a.competencia)}</Td>
                      <Td className="text-sm">{cat ? `${cat.codigo} ${cat.nome}` : "—"}</Td>
                      <Td className="max-w-[22rem] text-sm">
                        {a.motivo}
                        <span className="block text-xs text-muted-foreground">Lançado em {formatarDataHora(a.created_at)}</span>
                      </Td>
                      <Td className="whitespace-nowrap text-right numero">
                        {Number(a.valor) < 0 ? "(estorno) " : ""}
                        {formatarMoeda(a.valor)}
                      </Td>
                      {podeEditar ? (
                        <Td>
                          <BotaoAcao
                            tamanho="iconeSm"
                            variante="fantasma"
                            aria-label={`Excluir ajuste ${a.motivo}`}
                            acao={excluirAjuste.bind(null, empresaId, a.id)}
                            confirmar={{ titulo: "Excluir este ajuste?", descricao: "O DRE do mês volta sem ele. A exclusão fica no histórico.", textoConfirmar: "Excluir", perigo: true }}
                          >
                            <Trash2 />
                          </BotaoAcao>
                        </Td>
                      ) : null}
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
