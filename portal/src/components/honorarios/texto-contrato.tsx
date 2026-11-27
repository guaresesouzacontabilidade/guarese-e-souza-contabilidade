import { identificacaoPartes, rotuloClausula, type Clausula, type PartesContrato } from "@/lib/honorarios/contrato";

/** Texto do contrato na tela (o mesmo do PDF), para conferir e ler antes de assinar. */
export function TextoContrato({ partes, clausulas }: { partes: PartesContrato; clausulas: Clausula[] }) {
  const item = (p: string) => /^[a-z]\)|^\d+\./.test(p);
  return (
    <article className="space-y-3 text-sm leading-relaxed">
      {identificacaoPartes(partes).map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p>As partes acima identificadas têm entre si justo e contratado o seguinte:</p>
      {clausulas.map((cl, i) => {
        let n = 0;
        const varios = cl.paragrafos.filter((x) => !item(x)).length > 1;
        return (
          <section key={i} className="space-y-1.5">
            <h3 className="pt-2 text-xs font-bold tracking-wide text-titulo">{rotuloClausula(i, cl.titulo)}</h3>
            {cl.paragrafos.map((p, j) => {
              const numerado = j > 0 && varios && !item(p);
              if (numerado) n += 1;
              return (
                <p key={j} className={item(p) ? "pl-4" : undefined}>
                  {numerado ? <strong>§ {n}º </strong> : null}
                  {p}
                </p>
              );
            })}
          </section>
        );
      })}
    </article>
  );
}
