import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { DialogoFuncionario, ExcluirFuncionario, ImportarColaboradores, type FuncionarioTela } from "@/components/escalas/cadastros";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { formatarHoras } from "@/lib/escalas/horas";
import { DIAS_CURTOS } from "@/lib/escalas/tipos";
import { NavegacaoEscalas } from "../navegacao";

export const metadata: Metadata = { title: "Funcionários da escala" };

export default async function PaginaFuncionariosEscala({ params }: PageProps<"/e/[empresaId]/escalas/funcionarios">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("escalas.gerenciar")) notFound();
  const { data } = await ctx.supabase
    .from("escala_funcionarios")
    .select("id, nome, cargo, setor, jornada_semanal, nao_trabalha, domingo_quinzenal, menor_idade, preferencias, ativo")
    .eq("empresa_id", empresaId)
    .order("ativo", { ascending: false })
    .order("nome");
  const funcionarios = (data ?? []) as FuncionarioTela[];

  return (
    <>
      <CabecalhoPagina
        titulo="Funcionários da escala"
        descricao="Nome, jornada do contrato e restrições de cada pessoa. É o que o gerador e a conferência da CLT usam."
        acoes={
          <>
            {ctx.pode("calculos.ver") ? <ImportarColaboradores empresaId={empresaId} /> : null}
            <DialogoFuncionario empresaId={empresaId} />
          </>
        }
      />
      <NavegacaoEscalas empresaId={empresaId} gerenciar />
      {funcionarios.length ? (
        <Table>
          <THead>
            <Tr>
              <Th>Nome</Th>
              <Th className="hidden sm:table-cell">Cargo</Th>
              <Th className="text-right">Jornada</Th>
              <Th className="hidden md:table-cell">Restrições</Th>
              <Th className="w-24">
                <span className="sr-only">Ações</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {funcionarios.map((f) => (
              <Tr key={f.id} className={f.ativo ? undefined : "opacity-60"}>
                <Td>
                  <span className="font-medium">{f.nome}</span>
                  {!f.ativo ? <Badge className="ml-2">Inativo</Badge> : null}
                  <span className="block text-xs text-muted-foreground sm:hidden">{f.cargo}</span>
                </Td>
                <Td className="hidden sm:table-cell">{f.cargo ?? "—"}</Td>
                <Td className="text-right tabular-nums">{formatarHoras(Number(f.jornada_semanal) * 60)}/sem.</Td>
                <Td className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {f.nao_trabalha.length ? <Badge variante="info">Não trabalha: {f.nao_trabalha.map((d) => DIAS_CURTOS[d]).join(", ")}</Badge> : null}
                    {f.domingo_quinzenal ? <Badge variante="info">Domingo quinzenal</Badge> : null}
                    {f.menor_idade ? <Badge variante="alerta">Menor de idade</Badge> : null}
                    {!f.nao_trabalha.length && !f.domingo_quinzenal && !f.menor_idade ? <span className="text-muted-foreground">—</span> : null}
                  </div>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <DialogoFuncionario empresaId={empresaId} funcionario={f} />
                    <ExcluirFuncionario empresaId={empresaId} id={f.id} nome={f.nome} />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={Users} titulo="Nenhum funcionário cadastrado" descricao="Cadastre as pessoas que entram na escala. Dá para trazer do cadastro de colaboradores dos cálculos, se houver." />
      )}
    </>
  );
}
