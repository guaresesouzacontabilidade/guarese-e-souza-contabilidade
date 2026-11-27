import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import type { DadosReceita } from "@/lib/empresas/receita";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";

function opcao(o: DadosReceita["simples"], rotulo: string) {
  if (o.optante) return `Optante${o.desde ? ` desde ${formatarData(o.desde)}` : ""}`;
  if (o.optante === false) return o.excluidoEm && o.desde && o.excluidoEm !== o.desde ? `Não optante (saiu em ${formatarData(o.excluidoEm)})` : "Não optante";
  return `${rotulo}: não informado`;
}

/** Resumo do cadastro na Receita Federal (consulta do CNPJ nos dados abertos). */
export function PainelReceita({ dados }: { dados: DadosReceita }) {
  const ativa = dados.situacao?.toUpperCase() === "ATIVA";
  const itens: [string, string | null][] = [
    ["Abertura", dados.abertura ? formatarData(dados.abertura) : null],
    ["Natureza jurídica", dados.naturezaJuridica],
    ["Porte", dados.porte],
    ["Capital social", dados.capitalSocial != null ? formatarMoeda(dados.capitalSocial) : null],
    ["Simples Nacional", opcao(dados.simples, "Simples")],
    ["MEI", opcao(dados.mei, "MEI")],
    ["Última tributação declarada (ECF)", dados.tributacao ? `${dados.tributacao.ano}: ${dados.tributacao.forma}` : null],
    ["Telefones", dados.telefones.length ? dados.telefones.join(" · ") : null],
  ];
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-titulo">Dados da Receita Federal</span>
        <Badge variante={ativa ? "sucesso" : "perigo"}>{dados.situacao ?? "Situação não informada"}</Badge>
        {dados.matriz !== null ? <Badge variante="contorno">{dados.matriz ? "Matriz" : "Filial"}</Badge> : null}
      </div>
      {!ativa && dados.situacao ? (
        <Alerta tom="perigo">
          Situação cadastral na Receita: {dados.situacao}
          {dados.situacaoDesde ? ` desde ${formatarData(dados.situacaoDesde)}` : ""}
          {dados.motivoSituacao ? ` (${dados.motivoSituacao.toLowerCase()})` : ""}. Confira antes de cadastrar.
        </Alerta>
      ) : null}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {itens
          .filter(([, v]) => v)
          .map(([rotulo, valor]) => (
            <div key={rotulo} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{rotulo}</dt>
              <dd className="break-words">{valor}</dd>
            </div>
          ))}
      </dl>
      {dados.cnaePrincipal ? (
        <div>
          <p className="text-xs text-muted-foreground">Atividade principal (CNAE)</p>
          <p>
            {dados.cnaePrincipal.codigo} — {dados.cnaePrincipal.descricao}
          </p>
          {dados.cnaesSecundarios.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-primary">
                {dados.cnaesSecundarios.length} {dados.cnaesSecundarios.length === 1 ? "atividade secundária" : "atividades secundárias"}
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {dados.cnaesSecundarios.map((c) => (
                  <li key={c.codigo}>
                    {c.codigo} — {c.descricao}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {dados.socios.length ? (
        <div>
          <p className="text-xs text-muted-foreground">Quadro de sócios e administradores</p>
          <ul className="space-y-0.5">
            {dados.socios.map((s, i) => (
              <li key={`${s.nome}-${i}`}>
                {s.nome}
                <span className="text-xs text-muted-foreground">
                  {s.qualificacao ? ` · ${s.qualificacao}` : ""}
                  {s.desde ? ` · desde ${formatarData(s.desde)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Fonte: {dados.fonte}. Consultado em {formatarDataHora(dados.consultadoEm)}. A base da Receita é atualizada uma vez por mês: alterações muito recentes
        podem ainda não aparecer.
      </p>
    </div>
  );
}
