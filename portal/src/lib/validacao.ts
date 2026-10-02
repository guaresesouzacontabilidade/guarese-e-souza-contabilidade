import { z } from "zod";
import { lerValorBR } from "./dinheiro";

/** Campos de formulário comuns (FormData → valores tipados). */

export const textoOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const textoObrigatorio = (mensagem: string) => z.string().trim().min(1, mensagem);

export const uuidOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || /^[0-9a-f-]{36}$/i.test(v), "Seleção inválida.");

export const dataObrigatoria = (mensagem = "Informe a data.") =>
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, mensagem);

export const dataOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida.");

/** Valor monetário em texto BR → string decimal com 2 casas ("1234.56"). */
export const valorMonetario = (opcoes: { obrigatorio?: boolean; positivo?: boolean; permitirZero?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") {
        if (opcoes.obrigatorio) ctx.addIssue({ code: "custom", message: "Informe o valor." });
        return null;
      }
      const d = lerValorBR(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "Valor inválido. Use o formato 1.234,56." });
        return null;
      }
      if (opcoes.positivo && (d.isNegative() || (!opcoes.permitirZero && d.isZero()))) {
        ctx.addIssue({ code: "custom", message: opcoes.permitirZero ? "O valor não pode ser negativo." : "O valor deve ser maior que zero." });
        return null;
      }
      if (d.abs().greaterThan("9999999999999.99")) {
        ctx.addIssue({ code: "custom", message: "Valor muito alto." });
        return null;
      }
      return d.toDecimalPlaces(2).toFixed(2);
    });

export function campos(fd: FormData, nomes: string[]): Record<string, string> {
  const r: Record<string, string> = {};
  for (const n of nomes) r[n] = String(fd.get(n) ?? "");
  return r;
}

export const booleano = (fd: FormData, nome: string) => fd.getAll(nome).some((v) => v === "on" || v === "true");
