import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { BotaoExcluirTarifa, BotoesLimpeza, DialogoCategoria, DialogoQuarto, DialogoQuartosLote, DialogoTarifa } from "@/components/hotel/cadastros";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarCategorias, carregarQuartos } from "@/lib/hotel/dados";
import { LIMPEZA, VARIANTE_LIMPEZA, diaMes } from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDataHora } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Quartos e governança" };

export default async function PaginaQuartos({ params }: PageProps<"/e/[empresaId]/hotel/quartos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const [quartos, categorias, { data: ocupados }, { data: tarifas }] = await Promise.all([
    carregarQuartos(ctx.supabase, empresaId),
    carregarCategorias(ctx.supabase, empresaId),
    ctx.supabase
      .from("hotel_reservas")
      .select("quarto_id, saida, hospede:hotel_hospedes!hotel_reservas_empresa_id_hospede_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "hospedado"),
    ctx.supabase
      .from("hotel_tarifas")
      .select("id, nome, inicio, fim, diaria, categoria:hotel_categorias!hotel_tarifas_empresa_id_categoria_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .gte("fim", hoje)
      .order("inicio"),
  ]);
  const ocupacao = new Map((ocupados ?? []).map((o) => [o.quarto_id, o]));
  const ativos = quartos.filter((q) => q.ativo);
  const contagem = (l: string) => ativos.filter((q) => q.limpeza === l).length;
  const catAtivas = categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }));
  return (
    <>
      <CabecalhoPagina
        titulo="Quartos e governança"
        descricao="A situação de limpeza de cada quarto. Quarto sujo ou em manutenção não recebe check-in; no check-out, o quarto vai sozinho para a limpeza."
        acoes={
          ctx.gerente ? (
            <>
              <DialogoQuartosLote empresaId={empresaId} categorias={catAtivas} existentes={quartos.map((q) => q.numero)} />
              <DialogoQuarto empresaId={empresaId} categorias={catAtivas} />
            </>
          ) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {(["limpo", "sujo", "em_limpeza", "manutencao"] as const).map((l) => (
          <Badge key={l} variante={VARIANTE_LIMPEZA[l]}>
            {LIMPEZA[l]}: {contagem(l)}
          </Badge>
        ))}
        <Badge variante="neutro">Ocupados: {ocupacao.size}</Badge>
      </div>
      {!categorias.length ? (
        <Alerta tom="info" className="mb-4">
          {ctx.gerente ? "Comece criando as categorias de quarto (ex.: Standard, Luxo) com a diária de tabela; depois cadastre os quartos." : "O gerente ainda não cadastrou os quartos."}
        </Alerta>
      ) : null}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {quartos.map((q) => {
          const o = ocupacao.get(q.id);
          return (
            <div key={q.id} className={cn("space-y-2 rounded-2xl border bg-card p-3", !q.ativo && "opacity-60", o ? "border-sucesso/40" : "border-border")}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-titulo text-xl font-bold">
                    {q.numero}
                    {!q.ativo ? <span className="ml-2 text-xs font-normal text-muted-foreground">fora de uso</span> : null}
                  </p>
                  <div className="flex items-center gap-1">
                    <Badge variante={VARIANTE_LIMPEZA[q.limpeza]}>{LIMPEZA[q.limpeza]}</Badge>
                    {ctx.gerente ? (
                      <DialogoQuarto
                        empresaId={empresaId}
                        categorias={catAtivas}
                        quarto={{ id: q.id, numero: q.numero, andar: q.andar, camas: q.camas, observacao: q.observacao, ativo: q.ativo, categoria_id: q.categoria.id }}
                      />
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {q.categoria.nome}
                  {q.andar ? ` · ${q.andar}` : ""}
                  {q.camas ? ` · ${q.camas}` : ""}
                </p>
              </div>
              <p className="text-sm">
                {o ? (
                  <>
                    <span className="font-medium">{o.hospede?.nome}</span> <span className="text-muted-foreground">· até {diaMes(o.saida)}</span>
                  </>
                ) : q.limpeza === "manutencao" ? (
                  <span className="text-perigo">{q.motivo_manutencao}</span>
                ) : (
                  <span className="text-muted-foreground">Livre</span>
                )}
              </p>
              {q.limpeza_atualizada_em ? <p className="text-[11px] text-muted-foreground">Atualizado em {formatarDataHora(q.limpeza_atualizada_em)}</p> : null}
              {q.ativo ? <BotoesLimpeza empresaId={empresaId} quartoId={q.id} numero={q.numero} limpeza={q.limpeza} ocupado={Boolean(o)} /> : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Categorias e diárias de tabela</CardTitle>
            {ctx.gerente ? <DialogoCategoria empresaId={empresaId} /> : null}
          </CardHeader>
          <CardContent className="p-0">
            {categorias.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Categoria</Th>
                    <Th className="text-right">Diária</Th>
                    <Th className="text-right">Pessoas</Th>
                    {ctx.gerente ? <Th /> : null}
                  </Tr>
                </THead>
                <TBody>
                  {categorias.map((c) => (
                    <Tr key={c.id} className={cn(!c.ativa && "text-muted-foreground")}>
                      <Td>
                        <span className="font-medium">{c.nome}</span>
                        {c.descricao ? <span className="block text-xs text-muted-foreground">{c.descricao}</span> : null}
                      </Td>
                      <Td className="whitespace-nowrap text-right numero">
                        {formatarMoeda(c.diaria)}
                        {c.adicional_pessoa ? <span className="block text-xs text-muted-foreground">+{formatarMoeda(c.adicional_pessoa)} por pessoa extra</span> : null}
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        {c.pessoas_incluidas} incl. · até {c.capacidade}
                      </Td>
                      {ctx.gerente ? (
                        <Td className="w-10">
                          <DialogoCategoria empresaId={empresaId} categoria={c} />
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhuma categoria.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Tarifas de período (temporada, feriados)</CardTitle>
            {ctx.gerente ? <DialogoTarifa empresaId={empresaId} categorias={catAtivas} hoje={hoje} /> : null}
          </CardHeader>
          <CardContent className="p-0">
            {tarifas?.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Período</Th>
                    <Th>Categoria</Th>
                    <Th className="text-right">Diária</Th>
                    {ctx.gerente ? <Th /> : null}
                  </Tr>
                </THead>
                <TBody>
                  {tarifas.map((t) => (
                    <Tr key={t.id}>
                      <Td>
                        <span className="font-medium">{t.nome}</span>
                        <span className="block text-xs text-muted-foreground">
                          {diaMes(t.inicio)} a {diaMes(t.fim)}
                        </span>
                      </Td>
                      <Td>{t.categoria?.nome}</Td>
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(t.diaria)}</Td>
                      {ctx.gerente ? (
                        <Td className="w-10">
                          <BotaoExcluirTarifa empresaId={empresaId} tarifaId={t.id} nome={t.nome} />
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted-foreground">Sem tarifas de período: todas as noites usam a diária de tabela.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
