import type { Metadata } from "next";
import { Users } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { ListaColaboradores, NovoColaborador, type Colaborador } from "@/components/calculos/colaboradores";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Colaboradores" };

export default async function PaginaColaboradores({ params }: PageProps<"/e/[empresaId]/calculos/colaboradores">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("calculos.ver")) return null;
  const editar = ctx.pode("colaboradores.gerenciar");
  const { data, error } = await ctx.supabase
    .from("colaboradores")
    .select("id, nome, cargo, admissao, desligamento, contrato, fim_contrato, salario, adicionais, dependentes_ir, ferias_vencidas, saldo_fgts, observacao")
    .eq("empresa_id", empresaId)
    .order("desligamento", { ascending: false, nullsFirst: true })
    .order("nome");
  const colaboradores: Colaborador[] = (data ?? []).map((c) => ({
    ...c,
    contrato: c.contrato as Colaborador["contrato"],
    salario: Number(c.salario),
    adicionais: Number(c.adicionais),
    saldo_fgts: c.saldo_fgts == null ? null : Number(c.saldo_fgts),
  }));

  return (
    <>
      <CabecalhoPagina
        titulo="Colaboradores"
        descricao="Cadastro simples dos empregados (salário e admissão), usado na previsão da folha e na simulação de rescisão."
        acoes={editar ? <NovoColaborador empresaId={empresaId} /> : null}
      />
      {error ? <Alerta tom="perigo">{mensagemErro(error)}</Alerta> : null}
      {colaboradores.length ? (
        <Card>
          <CardContent className="px-0 pt-2 sm:px-0">
            <ListaColaboradores empresaId={empresaId} colaboradores={colaboradores} editar={editar} />
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio
          icone={Users}
          titulo="Nenhum colaborador cadastrado"
          descricao={
            editar
              ? "Cadastre os empregados para incluir a folha (INSS e FGTS) na previsão de impostos e simular rescisões."
              : "O escritório ou o responsável pela empresa pode cadastrar os colaboradores."
          }
          acao={editar ? <NovoColaborador empresaId={empresaId} /> : undefined}
        />
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Os dados ficam visíveis só para quem tem acesso aos cálculos desta empresa e para o escritório. Não guarde aqui documentos pessoais dos colaboradores.
      </p>
    </>
  );
}
