import type { Metadata } from "next";
import Link from "next/link";
import { exigirEquipe } from "@/lib/auth/sessao";
import { competenciaAtual, hojeISO, somarDias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, nomeMes } from "@/lib/formatos";
import { buscarTudo } from "@/lib/supabase/paginar";
import { Bloco, CabecaDia, diasDaSemana, Estatistica, GradeBlocos, LinhaContagem, Medidor, Selo } from "@/components/painel/blocos";
import { NumeroAnimado } from "@/components/painel/numero-animado";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Visão geral da carteira" };

const ABERTAS = ["pendente", "em_andamento", "aguardando_cliente", "em_revisao"];

export default async function VisaoGeralEscritorio() {
  const s = await exigirEquipe();
  const hoje = hojeISO();
  const comp = somarMeses(competenciaAtual(), -1);
  const inicioMes = competenciaAtual();
  const fimMes = ultimoDiaDoMes(inicioMes);
  const semana = diasDaSemana(hoje);
  const [iniSemana, fimSemana] = [semana[0].data, semana[6].data];

  const [empresas, itens, fila, correcoes, aposFechamento, naoAplica, conversas, competencias, solicitacoes, vencendo, achados, tarefasMes, tarefasSemana, atrasadas] =
    await Promise.all([
      buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, cidade, uf").eq("ativa", true).order("razao_social").range(de, ate)),
      buscarTudo((de, ate) =>
        s.supabase.from("checklist_itens").select("empresa_id, status, obrigatorio, prazo, competencia").gte("competencia", somarMeses(comp, -2)).range(de, ate),
      ),
      s.supabase
        .from("documentos")
        .select("id", { count: "exact", head: true })
        .eq("direcao", "cliente")
        .eq("upload_status", "concluido")
        .is("excluido_em", null)
        .is("zip_origem_id", null)
        .in("status", ["recebido", "em_analise"]),
      s.supabase.from("documentos").select("id", { count: "exact", head: true }).eq("status", "correcao").is("excluido_em", null),
      s.supabase.from("documentos").select("id", { count: "exact", head: true }).eq("recebido_apos_fechamento", true).is("apos_fechamento_avaliado_em", null).is("excluido_em", null),
      s.supabase.from("checklist_itens").select("id", { count: "exact", head: true }).eq("status", "nao_se_aplica_solicitado"),
      s.supabase.from("conversas").select("id", { count: "exact", head: true }).eq("status", "aberta").eq("aguardando", "escritorio"),
      s.supabase.from("competencias").select("empresa_id, status").eq("competencia", comp),
      s.supabase.from("solicitacoes").select("id", { count: "exact", head: true }).in("status", ["aberta", "em_andamento"]),
      s.supabase.from("vencimentos").select("id", { count: "exact", head: true }).eq("situacao", "ativo").lte("validade", somarDias(hoje, 15)),
      buscarTudo((de, ate) => s.supabase.from("auditor_achados").select("empresa_id, valor_estimado, situacao").in("situacao", ["novo", "confirmado", "publicado"]).range(de, ate)),
      // Tarefas do mês: pelo prazo legal (ou o interno, quando não há prazo legal)
      buscarTudo((de, ate) =>
        s.supabase
          .from("tarefas")
          .select("status, responsavel_id")
          .or(`and(prazo_legal.gte.${inicioMes},prazo_legal.lte.${fimMes}),and(prazo_legal.is.null,prazo_interno.gte.${inicioMes},prazo_interno.lte.${fimMes})`)
          .range(de, ate),
      ),
      // Tarefas em aberto da semana, pelo prazo interno da equipe (ou o legal)
      buscarTudo((de, ate) =>
        s.supabase
          .from("tarefas")
          .select("prazo_interno, prazo_legal")
          .in("status", ABERTAS)
          .or(`and(prazo_interno.gte.${iniSemana},prazo_interno.lte.${fimSemana}),and(prazo_interno.is.null,prazo_legal.gte.${iniSemana},prazo_legal.lte.${fimSemana})`)
          .range(de, ate),
      ),
      s.supabase
        .from("tarefas")
        .select("id", { count: "exact", head: true })
        .in("status", ABERTAS)
        .or(`prazo_legal.lt.${hoje},and(prazo_legal.is.null,prazo_interno.lt.${hoje})`),
    ]);

  // Entrega de documentos da competência de trabalho e itens atrasados
  const entrega = new Map<string, { total: number; ok: number; atrasados: number }>();
  let itensAtrasados = 0;
  for (const i of itens) {
    const e = entrega.get(i.empresa_id) ?? { total: 0, ok: 0, atrasados: 0 };
    if (i.competencia === comp && i.obrigatorio) {
      e.total++;
      if (i.status === "concluido" || i.status === "nao_se_aplica") e.ok++;
    }
    if ((i.status === "pendente" || i.status === "correcao") && i.prazo < hoje) {
      e.atrasados++;
      itensAtrasados++;
    }
    entrega.set(i.empresa_id, e);
  }
  const comChecklist = empresas.filter((e) => (entrega.get(e.id)?.total ?? 0) > 0);
  const completas = comChecklist.filter((e) => entrega.get(e.id)!.ok === entrega.get(e.id)!.total).length;
  const percentualCarteira = comChecklist.length ? Math.round((100 * completas) / comChecklist.length) : null;
  const maisAtrasadas = empresas
    .map((e) => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social, atrasados: entrega.get(e.id)?.atrasados ?? 0 }))
    .filter((e) => e.atrasados > 0)
    .sort((a, b) => b.atrasados - a.atrasados)
    .slice(0, 3);

  // Obrigações do mês
  const concluidas = tarefasMes.filter((t) => t.status === "concluida" || t.status === "dispensada").length;
  const aguardandoCliente = tarefasMes.filter((t) => t.status === "aguardando_cliente").length;
  const percentualTarefas = tarefasMes.length ? Math.round((100 * concluidas) / tarefasMes.length) : null;
  const porDia = new Map<string, number>();
  for (const t of tarefasSemana) {
    const d = (t.prazo_interno ?? t.prazo_legal) as string;
    porDia.set(d, (porDia.get(d) ?? 0) + 1);
  }
  const maiorDia = Math.max(1, ...porDia.values());

  // Tarefas do mês por pessoa da equipe
  const porPessoa = new Map<string, { total: number; feitas: number }>();
  for (const t of tarefasMes) {
    const k = t.responsavel_id ?? "";
    const p = porPessoa.get(k) ?? { total: 0, feitas: 0 };
    p.total++;
    if (t.status === "concluida" || t.status === "dispensada") p.feitas++;
    porPessoa.set(k, p);
  }
  const idsEquipe = [...porPessoa.keys()].filter(Boolean);
  const { data: perfis } = idsEquipe.length ? await s.supabase.from("perfis").select("id, nome").in("id", idsEquipe) : { data: [] };
  const nomePessoa = new Map((perfis ?? []).map((p) => [p.id, p.nome as string]));
  const equipe = [...porPessoa.entries()]
    .map(([id, p]) => ({ id, nome: id ? (nomePessoa.get(id) ?? "Equipe") : "Sem responsável", ...p }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Fechamento, auditor e cidades
  const statusComp = new Map((competencias.data ?? []).map((c) => [c.empresa_id, c.status]));
  const fechadas = [...statusComp.values()].filter((v) => v === "fechada").length;
  const emFechamento = [...statusComp.values()].filter((v) => v === "em_fechamento").length;
  const economia = achados.reduce((soma, a) => soma + Number(a.valor_estimado ?? 0), 0);
  const empresasComAchado = new Set(achados.map((a) => a.empresa_id)).size;
  const paraRevisar = achados.filter((a) => a.situacao === "novo").length;
  const porCidade = new Map<string, number>();
  for (const e of empresas) {
    const c = e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "Sem cidade";
    porCidade.set(c, (porCidade.get(c) ?? 0) + 1);
  }
  const cidades = [...porCidade.entries()].sort((a, b) => b[1] - a[1]);
  const topoCidades = cidades.slice(0, 4);
  const outrasCidades = cidades.slice(4).reduce((s2, [, n]) => s2 + n, 0);
  const maiorCidade = Math.max(1, ...cidades.map(([, n]) => n));

  const atencao = (atrasadas.count ?? 0) + itensAtrasados;
  const inicial = (nome: string) =>
    nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Competência de trabalho: {formatarCompetencia(comp, true)}</p>
          <h1 className="font-titulo text-2xl font-semibold tracking-tight text-titulo sm:text-3xl">Visão geral da carteira</h1>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Estatistica rotulo="Empresas ativas" valor={<NumeroAnimado valor={empresas.length} />} href="/escritorio/empresas" />
          <Estatistica
            rotulo="Documentos a conferir"
            valor={<NumeroAnimado valor={fila.count ?? 0} />}
            selo={correcoes.count ? <Selo tom="alerta">{`${correcoes.count} em correção`}</Selo> : null}
            href="/escritorio/documentos"
          />
          <Estatistica
            rotulo="Mensagens aguardando"
            valor={<NumeroAnimado valor={conversas.count ?? 0} />}
            selo={conversas.count ? <Selo tom="info">responder</Selo> : <Selo tom="sucesso">em dia</Selo>}
            href="/escritorio/mensagens"
          />
        </div>
      </section>

      <GradeBlocos>
        <Bloco titulo={`Obrigações de ${nomeMes(Number(inicioMes.slice(5, 7)))}`} largura={2} href="/escritorio/obrigacoes" rotuloLink="Abrir obrigações e prazos">
          {tarefasMes.length ? (
            <div className="flex flex-wrap items-center gap-6">
              <Medidor percentual={percentualTarefas} legenda={`${concluidas} de ${tarefasMes.length} concluídas`} rotulo={`${percentualTarefas ?? 0}% das obrigações do mês concluídas`} />
              <div className="flex min-w-52 flex-1 flex-col gap-0.5">
                <LinhaContagem href="/escritorio/obrigacoes" rotulo="Atrasadas" valor={atrasadas.count ?? 0} tom="perigo" />
                <LinhaContagem href="/escritorio/obrigacoes" rotulo="Vencem esta semana" valor={tarefasSemana.length} tom="alerta" />
                <LinhaContagem href="/escritorio/obrigacoes" rotulo="Esperando o cliente" valor={aguardandoCliente} tom="info" />
                <LinhaContagem href="/escritorio/obrigacoes" rotulo="Concluídas" valor={concluidas} tom="sucesso" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma obrigação com prazo neste mês. As tarefas são geradas em Obrigações e prazos.</p>
          )}
        </Bloco>

        <Bloco titulo="Atenção hoje" destaque acao={atencao ? <Selo tom="claro">urgente</Selo> : null}>
          <p className="mt-auto flex items-baseline gap-2">
            <span className="font-titulo text-5xl font-semibold leading-none">
              <NumeroAnimado valor={atencao} />
            </span>
            <span className="text-sm font-medium">{atencao === 1 ? "item atrasado" : "itens atrasados"}</span>
          </p>
          <ul className="space-y-1 text-sm opacity-95">
            <li>{atrasadas.count ?? 0} obrigação(ões) com prazo vencido</li>
            <li>{itensAtrasados} documento(s) dos clientes atrasado(s)</li>
            {vencendo.count ? <li>{vencendo.count} certificado(s) ou licença(s) vencendo em até 15 dias</li> : null}
            {aposFechamento.count ? <li>{aposFechamento.count} documento(s) recebido(s) após o fechamento</li> : null}
          </ul>
          <Link
            href="/escritorio/pendencias?situacao=atraso"
            className="mt-1 inline-flex min-h-10 items-center self-start rounded-full bg-primary-foreground px-4 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
          >
            Resolver agora
          </Link>
        </Bloco>

        <Bloco titulo="Caixa de entrada">
          <div className="flex flex-col gap-0.5">
            <LinhaContagem href="/escritorio/documentos" rotulo="Documentos recebidos" valor={fila.count ?? 0} tom="neutro" />
            <LinhaContagem href="/escritorio/mensagens" rotulo="Mensagens" valor={conversas.count ?? 0} tom="info" />
            <LinhaContagem href="/escritorio/solicitacoes" rotulo="Solicitações" valor={solicitacoes.count ?? 0} tom="neutro" />
            <LinhaContagem href="/escritorio/pendencias?situacao=conferir" rotulo="“Não se aplica” a revisar" valor={naoAplica.count ?? 0} tom="alerta" />
          </div>
        </Bloco>

        <Bloco titulo={`Entrega de documentos de ${nomeMes(Number(comp.slice(5, 7)))}`} largura={2} href="/escritorio/pendencias" rotuloLink="Abrir o quadro de pendências">
          {comChecklist.length ? (
            <div className="flex flex-wrap items-center gap-6">
              <Medidor percentual={percentualCarteira} legenda={`${completas} de ${comChecklist.length} empresas completas`} rotulo={`${percentualCarteira ?? 0}% da carteira com os documentos completos`} />
              <div className="flex min-w-52 flex-1 flex-col gap-2 text-sm">
                {maisAtrasadas.length ? (
                  <>
                    <p className="font-semibold text-muted-foreground">Mais atrasos</p>
                    {maisAtrasadas.map((e) => (
                      <Link key={e.id} href={`/e/${e.id}/pendencias`} className="flex items-center justify-between gap-2 hover:underline">
                        <span className="min-w-0 truncate">{e.nome}</span>
                        <Selo tom="perigo">{`${e.atrasados} atrasado(s)`}</Selo>
                      </Link>
                    ))}
                  </>
                ) : (
                  <p className="text-sucesso-fg">Nenhum documento atrasado na carteira.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">O checklist de {formatarCompetencia(comp, true)} ainda não foi gerado.</p>
          )}
        </Bloco>

        <Bloco titulo="Fechamento do mês" href="/escritorio/fechamentos" rotuloLink="Abrir fechamentos">
          <p className="-mt-2 text-sm text-muted-foreground">{formatarCompetencia(comp, true)}</p>
          <p className="flex items-baseline gap-2">
            <span className="font-titulo text-3xl font-semibold text-titulo">
              <NumeroAnimado valor={fechadas} />
            </span>
            <span className="text-sm text-muted-foreground">de {empresas.length} empresas</span>
          </p>
          <div className="h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={empresas.length} aria-valuenow={fechadas} aria-label="Empresas com o mês fechado">
            <div className="h-full rounded-full bg-primary" style={{ width: `${empresas.length ? (100 * fechadas) / empresas.length : 0}%` }} />
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Em fechamento</dt>
              <dd className="numero font-semibold">{emFechamento}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Abertas</dt>
              <dd className="numero font-semibold">{Math.max(0, empresas.length - fechadas - emFechamento)}</dd>
            </div>
          </dl>
        </Bloco>

        <Bloco titulo="Economia encontrada" href="/escritorio/auditor-fiscal" rotuloLink="Abrir o auditor fiscal">
          <div>
            <p className="font-titulo text-3xl font-semibold text-sucesso">
              <NumeroAnimado valor={economia} formato="moeda" />
            </p>
            <p className="text-sm text-muted-foreground">
              {achados.length} achado(s) do auditor fiscal em {empresasComAchado} empresa(s)
            </p>
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Para revisar</dt>
              <dd className="numero font-semibold">{paraRevisar}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Confirmados ou publicados</dt>
              <dd className="numero font-semibold">{achados.length - paraRevisar}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">Valor estimado: a confirmação é feita pela equipe.</p>
        </Bloco>

        <Bloco titulo="Prazos da semana" largura={2} href="/escritorio/obrigacoes" rotuloLink="Abrir a agenda de obrigações">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <ol className="grid min-w-[520px] grid-cols-7 gap-2">
              {semana.map((d) => {
                const qtd = porDia.get(d.data) ?? 0;
                return (
                  <li key={d.data} className="flex flex-col items-center gap-2">
                    <CabecaDia dia={d} />
                    <div className="flex h-24 w-full items-end justify-center">
                      <div
                        className={cn("barra-cresce w-7 rounded-t-lg rounded-b-sm", d.hoje ? "bg-primary" : qtd >= maiorDia * 0.6 ? "bg-foreground" : "bg-muted-foreground/25")}
                        style={{ height: Math.max(4, Math.round((qtd / maiorDia) * 90)) }}
                      />
                    </div>
                    <strong className="numero text-sm">{qtd}</strong>
                  </li>
                );
              })}
            </ol>
          </div>
          <p className="text-xs text-muted-foreground">Tarefas em aberto por dia, pelo prazo interno da equipe.</p>
        </Bloco>

        <Bloco titulo="Tarefas da equipe" href="/escritorio/obrigacoes" rotuloLink="Abrir as tarefas">
          {equipe.length ? (
            <ul className="space-y-3">
              {equipe.map((p) => (
                <li key={p.id || "sem"} className="flex items-center gap-2.5">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">
                    {p.id ? inicial(p.nome) : "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate font-semibold">{p.nome}</span>
                      <span className="numero shrink-0 text-muted-foreground">
                        {p.feitas} de {p.total}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(100 * p.feitas) / p.total}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma tarefa com prazo neste mês.</p>
          )}
        </Bloco>

        <Bloco titulo="Clientes por cidade" href="/escritorio/empresas" rotuloLink="Abrir empresas">
          <ul className="space-y-2.5">
            {topoCidades.map(([cidade, n]) => (
              <li key={cidade}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate">{cidade}</span>
                  <strong className="numero">{n}</strong>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground/80" style={{ width: `${(100 * n) / maiorCidade}%` }} />
                </div>
              </li>
            ))}
            {outrasCidades ? (
              <li className="flex justify-between text-sm text-muted-foreground">
                <span>Outras cidades</span>
                <span className="numero">{outrasCidades}</span>
              </li>
            ) : null}
          </ul>
        </Bloco>
      </GradeBlocos>
    </div>
  );
}
