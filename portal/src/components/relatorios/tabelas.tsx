import Link from "next/link";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { cn } from "@/lib/utils";
import type { ResultadoDre } from "@/lib/relatorios/dre";
import { GRUPOS_FLUXO, type ResultadoFluxo } from "@/lib/relatorios/fluxo";
import { rotuloMesCurto } from "@/lib/relatorios/periodo";

export function Dinheiro({ v, sinal, forte }: { v: string | number | null | undefined; sinal?: boolean; forte?: boolean }) {
  const d = dec(v ?? 0);
  return (
    <span className={cn("numero whitespace-nowrap", d.isZero() && "text-muted-foreground", sinal && d.lessThan(0) && "text-perigo", forte && "font-semibold")}>
      {d.isZero() ? "—" : formatarMoeda(d)}
    </span>
  );
}

/** Tabela da DRE (com links de detalhamento opcionais). */
export function TabelaDre({
  dre,
  rotuloPeriodo,
  hrefLinha,
  ativa,
}: {
  dre: ResultadoDre;
  rotuloPeriodo: string;
  hrefLinha?: (chave: string) => string;
  ativa?: string | null;
}) {
  const varios = dre.meses.length > 1;
  return (
    <Table className="min-w-[640px]">
      <THead>
        <tr>
          <Th className="sticky left-0 z-10 min-w-64 bg-muted">Descrição</Th>
          {varios
            ? dre.meses.map((m) => (
                <Th key={m} className="text-right">
                  {rotuloMesCurto(m)}
                </Th>
              ))
            : null}
          <Th className="text-right">{varios ? "Total" : rotuloPeriodo}</Th>
          <Th className="text-right" title="Participação sobre a receita bruta">
            % receita
          </Th>
        </tr>
      </THead>
      <TBody>
        {dre.linhas.map((l) => {
          const href = hrefLinha && l.tipo !== "total" ? hrefLinha(l.chave) : null;
          const destaque = l.chave === ativa;
          return (
            <Tr key={l.chave} className={cn(l.tipo === "total" && "bg-muted/60", l.destaque && "bg-bege/70", destaque && "bg-info-bg")}>
              <Td
                className={cn(
                  "sticky left-0 z-10",
                  destaque ? "bg-info-bg" : l.destaque ? "bg-bege" : l.tipo === "total" ? "bg-muted" : "bg-card",
                  l.nivel === 1 && "pl-8 text-sm",
                  l.tipo !== "categoria" && "font-semibold",
                  l.destaque && "text-titulo",
                )}
              >
                {href ? (
                  <Link href={href} scroll={false} className="hover:underline">
                    {l.rotulo}
                  </Link>
                ) : (
                  l.rotulo
                )}
              </Td>
              {varios
                ? dre.meses.map((m) => (
                    <Td key={m} className="text-right text-sm">
                      <Dinheiro v={l.valores[m]} sinal forte={l.tipo !== "categoria"} />
                    </Td>
                  ))
                : null}
              <Td className="text-right">
                <Dinheiro v={l.total} sinal forte />
              </Td>
              <Td className="text-right text-sm text-muted-foreground numero">{l.percentual === null ? "" : `${l.percentual.toFixed(1).replace(".", ",")}%`}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/** Tabela do fluxo de caixa realizado por mês. */
export function TabelaFluxo({ fluxo }: { fluxo: ResultadoFluxo }) {
  const grupos = Object.keys(GRUPOS_FLUXO).filter((g) => fluxo.meses.some((m) => m.porGrupo[g]));
  const temAbertura = fluxo.meses.some((m) => !dec(m.abertura).isZero());
  const varios = fluxo.meses.length > 1;
  const soma = (l: string[]) => l.reduce((t, v) => t.plus(dec(v)), dec(0)).toFixed(2);
  return (
    <Table className="min-w-[560px]">
      <THead>
        <tr>
          <Th className="sticky left-0 z-10 min-w-56 bg-muted">Movimento</Th>
          {fluxo.meses.map((m) => (
            <Th key={m.mes} className="text-right">
              {rotuloMesCurto(m.mes)}
            </Th>
          ))}
          {varios ? <Th className="text-right">Total</Th> : null}
        </tr>
      </THead>
      <TBody>
        <Tr className="bg-muted/50">
          <Td className="sticky left-0 z-10 bg-muted font-semibold">Saldo no início</Td>
          {fluxo.meses.map((m) => (
            <Td key={m.mes} className="text-right">
              <Dinheiro v={m.saldoInicial} sinal forte />
            </Td>
          ))}
          {varios ? <Td /> : null}
        </Tr>
        {grupos.flatMap((g) =>
          (["entradas", "saidas"] as const).map((lado) => {
            const valores = fluxo.meses.map((m) => m.porGrupo[g]?.[lado] ?? "0");
            if (valores.every((v) => dec(v).isZero())) return null;
            return (
              <Tr key={`${g}-${lado}`}>
                <Td className="sticky left-0 z-10 bg-card text-sm">
                  <span className="font-medium">{GRUPOS_FLUXO[g]}</span> — {lado === "entradas" ? "entradas" : "saídas"}
                </Td>
                {valores.map((v, i) => (
                  <Td key={fluxo.meses[i].mes} className={cn("text-right text-sm", lado === "entradas" ? "text-sucesso" : "text-perigo")}>
                    <Dinheiro v={v} />
                  </Td>
                ))}
                {varios ? (
                  <Td className={cn("text-right text-sm", lado === "entradas" ? "text-sucesso" : "text-perigo")}>
                    <Dinheiro v={soma(valores)} />
                  </Td>
                ) : null}
              </Tr>
            );
          }),
        )}
        {temAbertura ? (
          <Tr>
            <Td className="sticky left-0 z-10 bg-card text-sm">Saldo inicial de contas cadastradas</Td>
            {fluxo.meses.map((m) => (
              <Td key={m.mes} className="text-right text-sm">
                <Dinheiro v={m.abertura} />
              </Td>
            ))}
            {varios ? <Td /> : null}
          </Tr>
        ) : null}
      </TBody>
      <TFoot>
        <Tr>
          <Td className="sticky left-0 z-10 bg-muted">Geração de caixa (entradas − saídas)</Td>
          {fluxo.meses.map((m) => (
            <Td key={m.mes} className="text-right">
              <Dinheiro v={dec(m.entradas).minus(m.saidas).toFixed(2)} sinal />
            </Td>
          ))}
          {varios ? (
            <Td className="text-right">
              <Dinheiro v={fluxo.total.geracao} sinal />
            </Td>
          ) : null}
        </Tr>
        <Tr>
          <Td className="sticky left-0 z-10 bg-muted">Saldo no fim</Td>
          {fluxo.meses.map((m) => (
            <Td key={m.mes} className="text-right">
              <Dinheiro v={m.saldoFinal} sinal />
            </Td>
          ))}
          {varios ? <Td /> : null}
        </Tr>
      </TFoot>
    </Table>
  );
}
