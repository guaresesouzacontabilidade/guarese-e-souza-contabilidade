import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combina classes do Tailwind resolvendo conflitos. */
export function cn(...entradas: ClassValue[]) {
  return twMerge(clsx(entradas));
}

/** Gera um identificador curto e legível (protocolos de recebimento). */
export function protocolo(id: string, data?: string | Date | null) {
  const d = data ? new Date(data) : new Date();
  const aaaammdd = d.toISOString().slice(0, 10).replace(/-/g, "");
  return `${aaaammdd}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
