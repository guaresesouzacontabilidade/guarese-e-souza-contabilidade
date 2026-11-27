import "server-only";
import { obterContextoEmpresa } from "@/lib/auth/sessao";

/** Contexto da empresa com o estado da gestão do hotel (o banco confere de novo em cada operação). */
export async function obterContextoHotel(empresaId: string) {
  const ctx = await obterContextoEmpresa(empresaId);
  const ativo = ctx.acesso.loja && ctx.acesso.gestao_modalidade === "hotel";
  return {
    ...ctx,
    hotelAtivo: ativo,
    /** Recepção: reservas, check-in e check-out, consumo e pagamentos. */
    recepcao: ativo && ctx.pode("gestao.vender"),
    /** Gerente: quartos, tarifas, descontos, estornos, relatórios e configurações. */
    gerente: ativo && ctx.pode("gestao.gerenciar"),
  };
}

export type ContextoHotel = Awaited<ReturnType<typeof obterContextoHotel>>;
