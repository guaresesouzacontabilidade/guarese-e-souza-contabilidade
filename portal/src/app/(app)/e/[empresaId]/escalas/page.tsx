import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, CalendarRange, ChevronRight, Users } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { NovaEscala } from "@/components/escalas/cadastros";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { formatarDataHora, nomeMes } from "@/lib/formatos";
import { configSchema, gradeSchema } from "@/lib/escalas/tipos";
import { conferirEscala } from "@/lib/escalas/conferencia";
import { NavegacaoEscalas } from "./navegacao";

export const metadata: Metadata = { title: "Escalas de trabalho" };

const mesTexto = (competencia: string) => `${nomeMes(Number(competencia.slice(5, 7)))} de ${competencia.slice(0, 4)}`;

export default async function PaginaEscalas({ params }: PageProps<"/e/[empresaId]/escalas">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const gerenciar = ctx.pode("escalas.gerenciar");
  if (!gerenciar && !ctx.pode("escalas.ver")) notFound();

  const [{ data: escalas }, funcionarios, situacao] = await Promise.all([
    ctx.supabase.from("escalas").select("id, nome, competencia, status, config, grade, publicada_em, updated_at").eq("empresa_id", empresaId).order("competencia", { ascending: false }).order("nome").limit(60),
    gerenciar ? ctx.supabase.from("escala_funcionarios").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("ativo", true) : Promise.resolve({ count: 0 }),
    gerenciar ? ctx.supabase.rpc("escala_ia_situacao", { p_empresa_id: empresaId }) : Promise.resolve({ data: null }),
  ]);
  const ia = situacao.data?.[0];
  const totalFuncionarios = funcionarios.count ?? 0;
  const hoje = new Date();
  const proximo = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);

  const linhas = (escalas ?? []).map((e) => {
    const c = configSchema.safeParse(e.config);
    const g = gradeSchema.safeParse(e.grade);
    const conf = c.success && g.success ? conferirEscala(c.data, e.competencia, g.data) : null;
    return { ...e, pessoas: c.success ? c.data.pessoas.length : 0, erros: conf?.erros ?? 0, alertas: conf?.alertas ?? 0 };
  });

  return (
    <>
      <CabecalhoPagina
        titulo="Escalas de trabalho"
        descricao="Monte a escala do mês com os modelos usados no mercado (5x2, 6x1, 12x36 e outros), confira com a CLT e publique para a equipe."
        acoes={gerenciar && totalFuncionarios > 0 ? <NovaEscala empresaId={empresaId} mesSugerido={proximo} escalas={linhas.map((l) => ({ id: l.id, nome: l.nome, competencia: l.competencia }))} /> : null}
      />
      <NavegacaoEscalas empresaId={empresaId} gerenciar={gerenciar} />

      {gerenciar && totalFuncionarios === 0 ? (
        <EstadoVazio
          icone={Users}
          titulo="Comece cadastrando os funcionários"
          descricao="A escala precisa de nome, jornada e restrições de cada pessoa. Salário e documentos não entram aqui."
          acao={
            <Button asChild>
              <Link href={`/e/${empresaId}/escalas/funcionarios`}>Cadastrar funcionários</Link>
            </Button>
          }
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-3 lg:col-span-2">
          {linhas.length ? (
            <ul className="space-y-3">
              {linhas.map((e) => (
                <li key={e.id}>
                  <Link href={`/e/${empresaId}/escalas/${e.id}`} className="block rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-titulo">{e.nome}</p>
                        <p className="text-sm text-muted-foreground">{mesTexto(e.competencia)}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variante={e.status === "publicada" ? "sucesso" : "neutro"}>{e.status === "publicada" ? "Publicada" : "Rascunho"}</Badge>
                        {gerenciar && e.erros ? <Badge variante="perigo">{e.erros} fora da CLT</Badge> : null}
                        {gerenciar && !e.erros && e.alertas ? <Badge variante="alerta">{e.alertas} para atenção</Badge> : null}
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {e.pessoas} pessoa(s) · {e.publicada_em ? `publicada em ${formatarDataHora(e.publicada_em)}` : `alterada em ${formatarDataHora(e.updated_at)}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : totalFuncionarios > 0 || !gerenciar ? (
            <EstadoVazio
              icone={CalendarRange}
              titulo={gerenciar ? "Nenhuma escala ainda" : "Nenhuma escala publicada"}
              descricao={gerenciar ? "Clique em “Nova escala”: o portal monta o mês e você ajusta." : "Quando a empresa publicar a escala, ela aparece aqui."}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          {gerenciar ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bot className="size-4" /> Assistente de IA
                </CardTitle>
                <CardDescription>
                  {ia?.ligada
                    ? `Ligado. ${ia.usados_hoje} de ${ia.limite_diario} pedidos hoje nesta empresa.`
                    : "Desconectado até o administrador do escritório cadastrar a chave da Anthropic."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Descreva a empresa em palavras simples (“padaria aberta todo dia, 2 no balcão de manhã...”) e o assistente propõe modelos, turnos e folgas. O portal confere
                  com a CLT antes de você aplicar.
                </p>
                <p>Os nomes dos funcionários não são enviados: a IA recebe apelidos (P1, P2...).</p>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Qual escala usar?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>5x2 e 6x1 são as mais comuns no comércio; 12x36, em saúde e portaria; turnos de revezamento, na indústria contínua.</p>
              <Link href={`/e/${empresaId}/escalas/modelos`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Ver todos os modelos e as regras <ChevronRight className="size-4" />
              </Link>
            </CardContent>
          </Card>
          {!gerenciar ? (
            <Alerta tom="info">Você vê as escalas publicadas. Para montar ou alterar, fale com o responsável pela empresa.</Alerta>
          ) : null}
        </div>
      </div>
    </>
  );
}
