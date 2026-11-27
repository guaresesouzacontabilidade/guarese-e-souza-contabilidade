import Link from "next/link";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { FERRAMENTAS, type Ferramenta } from "@/lib/empresas/ferramentas";

/**
 * Telas de uma ferramenta da empresa: quando o escritório a desligou, mostra o
 * aviso no lugar da tela (para a equipe, com o atalho para religar).
 */
export async function GuardaFerramenta({ empresaId, ferramenta, children }: { empresaId: string; ferramenta: Ferramenta; children: React.ReactNode }) {
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.acesso.ferramentas_desligadas.includes(ferramenta)) return <>{children}</>;
  const f = FERRAMENTAS.find((x) => x.chave === ferramenta)!;
  return (
    <Alerta tom="info" titulo={`${f.rotulo}: ferramenta desligada`}>
      {ctx.equipe ? (
        <>
          O escritório desligou esta ferramenta para esta empresa. Os dados e as configurações continuam guardados. Para religar, use{" "}
          <Link href={`/escritorio/empresas/${empresaId}?aba=ferramentas`} className="font-medium underline">
            Cadastro da empresa → Ferramentas
          </Link>
          .
        </>
      ) : (
        "Esta ferramenta não faz parte do atendimento da sua empresa. Se precisar dela, fale com o escritório."
      )}
    </Alerta>
  );
}
