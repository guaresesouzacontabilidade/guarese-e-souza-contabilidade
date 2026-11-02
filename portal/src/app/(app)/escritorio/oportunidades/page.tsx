import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Bot, FileSearch, HandCoins, PiggyBank } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AbasLink } from "@/components/ui/abas";
import { AtualizarEnquanto } from "@/components/ui/atualizar-enquanto";
import { BotaoRodarRobo } from "@/components/estudos/acoes-estudo";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro } from "@/lib/busca";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCnpj, formatarRelativo } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";
import { ESTADO_ESTUDO, NOME_TIPO, SITUACAO_ESTUDO, TIPOS_ESTUDO, estudandoAgora } from "@/lib/estudos/rotulos";

export const metadata: Metadata = { title: "Oportunidades da carteira" };

const VISOES = ["abertas", "aprovadas", "descartadas", "faltam_dados", "todas"] as const;
type Visao = (typeof VISOES)[number];

export default async function OportunidadesDaCarteira({ searchParams }: PageProps<"/escritorio/oportunidades">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const visao = (parametro(sp, "ver", VISOES) || "abertas") as Visao;
  const tipo = parametro(sp, "tipo", TIPOS_ESTUDO.map((t) => t.tipo));

  const dados = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, documento").range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase
        .from("estudo_oportunidades")
        .select("id, empresa_id, tipo, estado, titulo, economia_anual, valor_unico, situacao, faltando, detectado_em, atualizado_em")
        .range(de, ate),
    ),
    s.supabase.from("estudo_execucoes").select("empresa_id, situacao, iniciado_em, concluido_em").order("iniciado_em", { ascending: false }).limit(1000),
  ])
    .then(([empresas, estudos, execucoes]) => ({ empresas, estudos, execucoes: execucoes.data ?? [], erro: null as string | null }))
    .catch((e: unknown) => ({ empresas: [], estudos: [], execucoes: [], erro: mensagemErro(e) }));

  const nomes = new Map(dados.empresas.map((e) => [e.id, e]));
  const valor = (e: { economia_anual: number | null; valor_unico: number | null }) => Number(e.economia_anual ?? 0) + Number(e.valor_unico ?? 0);
  const comAchado = (e: { estado: string }) => e.estado === "oportunidade" || e.estado === "alerta";
  const emAberto = dados.estudos.filter((e) => comAchado(e) && e.situacao !== "descartada");

  const economiaAno = emAberto.filter((e) => e.estado === "oportunidade").reduce((t, e) => t + Number(e.economia_anual ?? 0), 0);
  const recuperar = emAberto.filter((e) => e.estado === "oportunidade").reduce((t, e) => t + Number(e.valor_unico ?? 0), 0);
  const paraRevisar = emAberto.filter((e) => e.situacao === "nova").length;
  const alertas = emAberto.filter((e) => e.estado === "alerta").length;
  const faltam = dados.estudos.filter((e) => e.estado === "faltam_dados");

  const naFila = new Set(dados.execucoes.filter(estudandoAgora).map((x) => x.empresa_id));
  const ultimaRodada = dados.execucoes.find((x) => x.situacao === "concluida")?.concluido_em ?? null;

  const filtro: Record<Visao, (e: (typeof dados.estudos)[number]) => boolean> = {
    abertas: (e) => comAchado(e) && (e.situacao === "nova" || e.situacao === "aprovada"),
    aprovadas: (e) => comAchado(e) && (e.situacao === "aprovada" || e.situacao === "apresentada"),
    descartadas: (e) => comAchado(e) && e.situacao === "descartada",
    faltam_dados: (e) => e.estado === "faltam_dados",
    todas: () => true,
  };
  const linhas = dados.estudos
    .filter(filtro[visao])
    .filter((e) => !tipo || e.tipo === tipo)
    .sort((a, b) => valor(b) - valor(a) || (a.estado === "alerta" ? -1 : 0) - (b.estado === "alerta" ? -1 : 0) || a.detectado_em.localeCompare(b.detectado_em));

  const contar = (v: Visao) => dados.estudos.filter(filtro[v]).filter((e) => !tipo || e.tipo === tipo).length;
  const abas = [
    { valor: "abertas", rotulo: "Em aberto" },
    { valor: "aprovadas", rotulo: "Aprovadas e apresentadas" },
    { valor: "descartadas", rotulo: "Descartadas" },
    { valor: "faltam_dados", rotulo: "Faltam dados" },
    { valor: "todas", rotulo: "Todos os estudos" },
  ].map((a) => ({ ...a, href: urlCom("/escritorio/oportunidades", sp, { ver: a.valor === "abertas" ? null : a.valor }), contador: a.valor === "todas" ? null : contar(a.valor as Visao) }));

  return (
    <>
      <CabecalhoPagina
        titulo="Oportunidades da carteira"
        descricao="O robô de planejamento tributário estuda cada empresa toda noite com os dados do portal: regime mais barato, Fator R, imposto pago a mais e limite do Simples. A equipe revisa antes de apresentar ao cliente."
        acoes={<BotaoRodarRobo rotulo="Rodar agora em toda a carteira" emAndamento={naFila.size > 0 && naFila.size >= dados.empresas.length} />}
      />
      <AtualizarEnquanto ativo={naFila.size > 0} intervaloMs={8000} />
      {dados.erro ? <Alerta tom="perigo" className="mb-4">{dados.erro}</Alerta> : null}
      {naFila.size ? (
        <Alerta tom="info" className="mb-4">
          O robô está estudando {naFila.size} {naFila.size === 1 ? "empresa" : "empresas"} agora. A tela se atualiza sozinha.
        </Alerta>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo="Economia estimada por ano" valor={formatarMoeda(economiaAno)} detalhe="oportunidades em aberto" tom="sucesso" icone={PiggyBank} />
        <Indicador rotulo="Valor a recuperar" valor={formatarMoeda(recuperar)} detalhe="imposto pago a mais" tom={recuperar ? "sucesso" : "neutro"} icone={HandCoins} />
        <Indicador rotulo="Para revisar" valor={paraRevisar} tom={paraRevisar ? "alerta" : "neutro"} icone={FileSearch} href="/escritorio/oportunidades" />
        <Indicador
          rotulo="Alertas"
          valor={alertas}
          detalhe={faltam.length ? `${faltam.length} ${faltam.length === 1 ? "estudo sem dados" : "estudos sem dados"}` : undefined}
          tom={alertas ? "alerta" : "neutro"}
          icone={AlertTriangle}
        />
      </div>

      <AbasLink abas={abas} ativa={visao} className="mb-3" />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {visao !== "abertas" ? <input type="hidden" name="ver" value={visao} /> : null}
        <label className="text-sm text-muted-foreground" htmlFor="filtro-tipo">
          Estudo
        </label>
        <Select id="filtro-tipo" name="tipo" defaultValue={tipo} className="w-auto min-w-[220px]">
          <option value="">Todos os estudos</option>
          {TIPOS_ESTUDO.map((t) => (
            <option key={t.tipo} value={t.tipo}>
              {t.nome}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{ultimaRodada ? `Última análise ${formatarRelativo(ultimaRodada)}` : "O robô ainda não rodou"}</span>
      </form>

      {!dados.estudos.length && !dados.erro ? (
        <EstadoVazio
          icone={Bot}
          titulo="O robô ainda não estudou a carteira"
          descricao="Ele roda sozinho toda noite. Para ver agora, clique em Rodar agora em toda a carteira."
          acao={<BotaoRodarRobo rotulo="Rodar agora em toda a carteira" />}
        />
      ) : linhas.length ? (
        <Card>
          <CardContent className="px-0 pt-2 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Estudo</Th>
                  <Th className="text-right">Economia por ano</Th>
                  <Th className="hidden text-right md:table-cell">A recuperar</Th>
                  <Th className="hidden sm:table-cell">Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((e) => {
                  const emp = nomes.get(e.empresa_id);
                  const estado = ESTADO_ESTUDO[e.estado];
                  const situacao = SITUACAO_ESTUDO[e.situacao];
                  return (
                    <Tr key={e.id}>
                      <Td>
                        <Link href={`/escritorio/oportunidades/${e.empresa_id}#${e.tipo}`} className="font-medium text-primary hover:underline">
                          {emp?.nome_fantasia || emp?.razao_social || "Empresa"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{emp?.documento ? formatarCnpj(emp.documento) : ""}</span>
                      </Td>
                      <Td className="max-w-[420px]">
                        <span className="block text-xs text-muted-foreground">{NOME_TIPO[e.tipo] ?? e.tipo}</span>
                        <span className="block text-sm">{e.estado === "faltam_dados" && e.faltando.length ? `Falta: ${e.faltando.join("; ")}` : e.titulo}</span>
                      </Td>
                      <Td className="numero text-right font-medium text-sucesso">{e.economia_anual ? formatarMoeda(e.economia_anual) : "—"}</Td>
                      <Td className="numero hidden text-right md:table-cell">{e.valor_unico ? formatarMoeda(e.valor_unico) : "—"}</Td>
                      <Td className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {estado ? <Badge variante={estado.tom}>{estado.rotulo}</Badge> : null}
                          {comAchado(e) && situacao ? <Badge variante={situacao.tom}>{situacao.rotulo}</Badge> : null}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio
          icone={PiggyBank}
          titulo={visao === "abertas" ? "Nenhuma oportunidade em aberto" : "Nada por aqui"}
          descricao={
            visao === "abertas"
              ? "Quando o robô encontrar uma forma de economizar ou um risco (como o limite do Simples), ela aparece aqui para a equipe revisar."
              : "Nenhum estudo nesta lista com o filtro escolhido."
          }
        />
      )}
    </>
  );
}
