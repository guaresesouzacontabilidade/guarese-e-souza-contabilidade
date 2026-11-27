import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { SERVICOS_HONORARIOS, type ServicoHonorario } from "@/lib/honorarios/comum";
import { casaBusca, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { CampoBusca } from "@/components/ui/campo-busca";

export const metadata: Metadata = { title: "Clientes e valores" };

const SITUACAO = { ativa: { rotulo: "Ativa", tom: "sucesso" }, pausada: { rotulo: "Pausada", tom: "alerta" }, encerrada: { rotulo: "Encerrada", tom: "neutro" } } as const;

export default async function Fichas({ searchParams }: PageProps<"/escritorio/honorarios/fichas">) {
  const s = await exigirHonorarios();
  const sp = await searchParams;
  const busca = termoBusca(sp.busca).toLowerCase();
  const [empresas, { data: fichas }] = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento").eq("ativa", true).order("razao_social").range(de, ate)),
    s.supabase.from("honorarios_fichas").select("*"),
  ]);
  const porEmpresa = new Map((fichas ?? []).map((f) => [f.empresa_id, f]));
  const filtra = (e: { razao_social: string; nome_fantasia: string | null; documento?: string }) => casaBusca(busca, e.razao_social, e.nome_fantasia, e.documento);
  const comFicha = empresas.filter((e) => porEmpresa.has(e.id) && filtra(e));
  const semFicha = empresas.filter((e) => !porEmpresa.has(e.id) && filtra(e));
  const ativas = (fichas ?? []).filter((f) => f.situacao === "ativa");

  return (
    <div className="space-y-5">
      <CabecalhoPagina
        titulo="Clientes e valores"
        descricao="A ficha de cada cliente: honorário mensal, vencimento, extras automáticos e para onde mandar a cobrança."
        voltar={{ href: "/escritorio/honorarios", rotulo: "Honorários" }}
      />
      {sp.salvo ? <Alerta tom="sucesso">Ficha salva. As próximas cobranças mensais seguem estes valores.</Alerta> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador rotulo="Receita mensal (fichas ativas)" valor={formatarMoeda(somar(ativas.map((f) => f.valor_mensal)))} />
        <Indicador rotulo="Clientes com ficha ativa" valor={String(ativas.length)} />
        <Indicador rotulo="Empresas sem ficha" valor={String(empresas.length - porEmpresa.size)} tom={empresas.length - porEmpresa.size ? "alerta" : "neutro"} detalhe="não recebem cobrança mensal" />
      </div>
      <form className="max-w-md" action="/escritorio/honorarios/fichas" role="search">
        <CampoBusca name="busca" defaultValue={busca} placeholder="Buscar empresa" />
      </form>

      {comFicha.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <THead>
              <Tr>
                <Th>Empresa</Th>
                <Th className="text-right">Honorário</Th>
                <Th>Vencimento</Th>
                <Th>Serviços</Th>
                <Th>Contato</Th>
                <Th>Situação</Th>
              </Tr>
            </THead>
            <TBody>
              {comFicha.map((e) => {
                const f = porEmpresa.get(e.id)!;
                const sit = SITUACAO[f.situacao as keyof typeof SITUACAO];
                return (
                  <Tr key={e.id}>
                    <Td>
                      <Link href={`/escritorio/honorarios/fichas/${e.id}`} className="font-medium hover:text-primary hover:underline">
                        {e.nome_fantasia ?? e.razao_social}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-right font-medium">{formatarMoeda(f.valor_mensal)}</Td>
                    <Td className="whitespace-nowrap">Dia {f.dia_vencimento}</Td>
                    <Td className="max-w-64 text-xs text-muted-foreground">{f.servicos.map((x) => SERVICOS_HONORARIOS[x as ServicoHonorario] ?? x).join(", ") || "—"}</Td>
                    <Td className="text-xs">
                      {f.contato_email ?? <span className="text-alerta">sem e-mail</span>}
                      {f.contato_whatsapp && f.whatsapp_autorizado ? " · WhatsApp" : ""}
                    </Td>
                    <Td>
                      <Badge variante={sit.tom}>{sit.rotulo}</Badge>
                      {f.robo_pausado_ate ? <span className="block text-xs text-muted-foreground">lembretes pausados</span> : null}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      ) : (
        <EstadoVazio icone={Users} titulo="Nenhuma ficha cadastrada" descricao="Cadastre a ficha de cada cliente para o portal gerar as cobranças do mês sozinho." />
      )}

      {semFicha.length ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Empresas sem ficha</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {semFicha.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <span className="min-w-0 truncate text-sm">{e.nome_fantasia ?? e.razao_social}</span>
                <Button asChild tamanho="sm" variante="contorno">
                  <Link href={`/escritorio/honorarios/fichas/${e.id}`} aria-label={`Cadastrar ficha de ${e.nome_fantasia ?? e.razao_social}`}>
                    <Plus /> Ficha
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
