import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import {
  DialogoFuncionario,
  ExcluirFuncionario,
  ImportarColaboradores,
  type FuncionarioTela,
} from "@/components/escalas/cadastros";
import {
  carregarAcessos,
  carregarCargos,
  obterContextoRh,
} from "@/lib/rh/dados";
import { formatarHoras } from "@/lib/escalas/horas";
import { DIAS_CURTOS } from "@/lib/escalas/tipos";

export const metadata: Metadata = { title: "Funcionários" };

export default async function PaginaFuncionariosRh({
  params,
}: PageProps<"/e/[empresaId]/rh/funcionarios">) {
  const { empresaId } = await params;
  const ctx = await obterContextoRh(empresaId);
  if (!ctx.cadastro) notFound();
  const [{ data }, cargos, acessos] = await Promise.all([
    ctx.supabase
      .from("escala_funcionarios")
      .select(
        "id, nome, cargo, cargo_id, usuario_id, setor, jornada_semanal, nao_trabalha, domingo_quinzenal, menor_idade, preferencias, ativo",
      )
      .eq("empresa_id", empresaId)
      .order("ativo", { ascending: false })
      .order("nome"),
    carregarCargos(ctx.supabase, empresaId),
    ctx.gestor
      ? carregarAcessos(ctx.supabase, empresaId)
      : Promise.resolve(null),
  ]);
  const funcionarios = (data ?? []) as FuncionarioTela[];
  const nomeAcesso = new Map((acessos ?? []).map((a) => [a.id, a.nome]));

  return (
    <>
      <CabecalhoPagina
        titulo="Funcionários"
        descricao="O cadastro da equipe: cargo, jornada, restrições da escala e o acesso ao portal de cada pessoa."
        acoes={
          <>
            {ctx.pode("calculos.ver") && ctx.pode("escalas.gerenciar") ? (
              <ImportarColaboradores empresaId={empresaId} />
            ) : null}
            <DialogoFuncionario
              empresaId={empresaId}
              cargos={cargos}
              acessos={acessos ?? undefined}
            />
          </>
        }
      />
      {funcionarios.length ? (
        <Table>
          <THead>
            <Tr>
              <Th>Nome</Th>
              <Th className="hidden sm:table-cell">Cargo</Th>
              {acessos ? (
                <Th className="hidden md:table-cell">Acesso ao portal</Th>
              ) : null}
              <Th className="text-right">Jornada</Th>
              <Th className="hidden lg:table-cell">Restrições</Th>
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
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    {f.cargo}
                  </span>
                </Td>
                <Td className="hidden sm:table-cell">{f.cargo ?? "—"}</Td>
                {acessos ? (
                  <Td className="hidden md:table-cell">
                    {f.usuario_id ? (
                      <Badge variante="sucesso">
                        {nomeAcesso.get(f.usuario_id) ?? "Ligado"}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">Sem acesso</span>
                    )}
                  </Td>
                ) : null}
                <Td className="text-right tabular-nums">
                  {formatarHoras(Number(f.jornada_semanal) * 60)}/sem.
                </Td>
                <Td className="hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {f.nao_trabalha.length ? (
                      <Badge variante="info">
                        Não trabalha:{" "}
                        {f.nao_trabalha.map((d) => DIAS_CURTOS[d]).join(", ")}
                      </Badge>
                    ) : null}
                    {f.domingo_quinzenal ? (
                      <Badge variante="info">Domingo quinzenal</Badge>
                    ) : null}
                    {f.menor_idade ? (
                      <Badge variante="alerta">Menor de idade</Badge>
                    ) : null}
                    {!f.nao_trabalha.length &&
                    !f.domingo_quinzenal &&
                    !f.menor_idade ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </div>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <DialogoFuncionario
                      empresaId={empresaId}
                      funcionario={f}
                      cargos={cargos}
                      acessos={acessos ?? undefined}
                    />
                    <ExcluirFuncionario
                      empresaId={empresaId}
                      id={f.id}
                      nome={f.nome}
                    />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio
          icone={Users}
          titulo="Nenhum funcionário cadastrado"
          descricao="Cadastre as pessoas da equipe. O mesmo cadastro serve para as escalas e para as tarefas."
        />
      )}
    </>
  );
}
