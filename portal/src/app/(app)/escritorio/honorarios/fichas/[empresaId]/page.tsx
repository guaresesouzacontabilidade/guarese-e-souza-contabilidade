import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormularioFicha, type FichaForm } from "@/components/honorarios/ficha";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { numeroCobranca, situacaoExibida } from "@/lib/honorarios/comum";
import { competenciaAtual, hojeISO, somarMeses } from "@/lib/competencia";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Ficha de honorários" };

export default async function Ficha({ params }: PageProps<"/escritorio/honorarios/fichas/[empresaId]">) {
  const s = await exigirHonorarios();
  const { empresaId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(empresaId)) notFound();
  const [{ data: empresa }, { data: ficha }, { data: cobrancas }, { data: cfg }] = await Promise.all([
    s.supabase.from("empresas").select("id, razao_social, nome_fantasia, email").eq("id", empresaId).maybeSingle(),
    s.supabase.from("honorarios_fichas").select("*").eq("empresa_id", empresaId).maybeSingle(),
    s.supabase.from("honorarios_cobrancas").select("id, ano, numero, descricao, valor, vencimento, situacao").eq("empresa_id", empresaId).order("vencimento", { ascending: false }).limit(12),
    s.supabase.from("honorarios_config").select("competencia_referencia").single(),
  ]);
  if (!empresa) notFound();
  const nome = empresa.nome_fantasia ?? empresa.razao_social;
  const hoje = hojeISO();
  const dados: FichaForm = ficha
    ? { ...ficha, valor_mensal: Number(ficha.valor_mensal), valor_funcionario_extra: ficha.valor_funcionario_extra === null ? null : Number(ficha.valor_funcionario_extra), valor_nota_extra: ficha.valor_nota_extra === null ? null : Number(ficha.valor_nota_extra) }
    : {
        id: null,
        empresa_id: empresaId,
        situacao: "ativa",
        valor_mensal: null,
        dia_vencimento: 10,
        // O mês que a cobrança deste mês paga (o anterior, quando a cobrança é do mês já trabalhado)
        inicio: cfg?.competencia_referencia === "mes_atual" ? competenciaAtual() : somarMeses(competenciaAtual(), -1),
        fim: null,
        servicos: ["contabil", "fiscal"],
        funcionarios_inclusos: null,
        valor_funcionario_extra: null,
        notas_inclusas: null,
        valor_nota_extra: null,
        decimo_terceiro: false,
        decimo_terceiro_mes: 12,
        reajuste_indice: "nenhum",
        reajuste_mes: null,
        contato_nome: null,
        contato_email: empresa.email,
        contato_whatsapp: null,
        whatsapp_autorizado: false,
        canal_email: true,
        canal_whatsapp: true,
        robo_pausado_ate: null,
        observacao: null,
      };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <CabecalhoPagina titulo={ficha ? `Ficha de ${nome}` : `Nova ficha — ${nome}`} voltar={{ href: "/escritorio/honorarios/fichas", rotulo: "Clientes e valores" }} />
      <Card>
        <CardContent className="pt-6">
          <FormularioFicha ficha={dados} empresaNome={nome} />
        </CardContent>
      </Card>
      {cobrancas?.length ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Últimas cobranças</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {cobrancas.map((c) => {
              const sit = situacaoExibida(c, hoje);
              return (
                <li key={c.id}>
                  <Link href={`/escritorio/honorarios/cobrancas/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:text-primary">
                    <span>
                      nº {numeroCobranca(c)} · {c.descricao}
                    </span>
                    <span className="flex items-center gap-2">
                      {formatarMoeda(c.valor)} · {formatarData(c.vencimento)} <Badge variante={sit.tom === "neutro" ? "neutro" : sit.tom}>{sit.rotulo}</Badge>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
