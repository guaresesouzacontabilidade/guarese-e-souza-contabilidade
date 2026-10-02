import "server-only";
import { timingSafeEqual } from "node:crypto";
import { envServidor } from "@/lib/env-servidor";

/** Confere o segredo das chamadas agendadas (Authorization: Bearer <CRON_SECRET>). */
export function cronAutorizado(req: Request): boolean {
  const segredo = envServidor.cronSecret();
  if (!segredo) return false;
  const enviado = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(enviado);
  const b = Buffer.from(segredo);
  return a.length === b.length && timingSafeEqual(a, b);
}
