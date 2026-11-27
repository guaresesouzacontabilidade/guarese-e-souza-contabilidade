"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck2, Loader2, Pencil, Printer, RotateCcw, Save, Send, Trash2, Undo2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoAcao } from "@/components/ui/acao";
import { Confirmacao } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { excluirEscala, publicarEscala, renomearEscala, salvarConfiguracao, salvarGrade } from "@/lib/escalas/acoes";
import { conferirEscala, type Achado } from "@/lib/escalas/conferencia";
import { descreverTurno } from "@/lib/escalas/horas";
import type { ConfigEscala, Grade, Historico } from "@/lib/escalas/tipos";
import { GradeEscala, Pincel } from "./grade";
import { ListaConferencia, ResumoConferencia } from "./conferencia";
import { ConfigEmpresa, ConfigPessoas, type FuncionarioCadastro } from "./configuracao";
import { Assistente, type SituacaoIa } from "./assistente";
import { corDoTurno } from "./codigos";

const ABAS = [
  { valor: "grade", rotulo: "Grade do mês" },
  { valor: "pessoas", rotulo: "Pessoas e modelos" },
  { valor: "empresa", rotulo: "Turnos e funcionamento" },
  { valor: "assistente", rotulo: "Assistente de IA" },
  { valor: "conferencia", rotulo: "Conferência da CLT" },
] as const;
type Aba = (typeof ABAS)[number]["valor"];

export function EditorEscala({
  empresaId,
  escala,
  configInicial,
  gradeInicial,
  historico,
  funcionarios,
  situacaoIa,
  admin,
}: {
  empresaId: string;
  escala: { id: string; nome: string; competencia: string; status: string; ia_resumo: string | null; mesTexto: string };
  configInicial: ConfigEscala;
  gradeInicial: Grade;
  historico: Historico;
  funcionarios: FuncionarioCadastro[];
  situacaoIa: SituacaoIa;
  admin: boolean;
}) {
  const router = useRouter();
  const [aba, setAba] = React.useState<Aba>("grade");
  const [config, setConfig] = React.useState(configInicial);
  const [grade, setGrade] = React.useState(gradeInicial);
  const [configMudou, setConfigMudou] = React.useState(false);
  const [gradeMudou, setGradeMudou] = React.useState(false);
  const [pincel, setPincel] = React.useState("F");
  const [destaque, setDestaque] = React.useState<{ pessoaId?: string; dia?: number } | null>(null);
  const [salvando, iniciarSalvar] = React.useTransition();
  const [editandoNome, setEditandoNome] = React.useState(false);
  const [nome, setNome] = React.useState(escala.nome);

  // Quando o servidor manda uma versão nova (depois de salvar ou aplicar a IA), recomeça dela
  const [versao, setVersao] = React.useState({ configInicial, gradeInicial });
  if (versao.configInicial !== configInicial || versao.gradeInicial !== gradeInicial) {
    setVersao({ configInicial, gradeInicial });
    setConfig(configInicial);
    setGrade(gradeInicial);
    setConfigMudou(false);
    setGradeMudou(false);
  }

  const pendente = configMudou || gradeMudou;
  React.useEffect(() => {
    if (!pendente) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [pendente]);

  // Pessoas novas na configuração ainda sem grade aparecem com folga até gerar
  const gradeTela = React.useMemo(() => {
    const n = Object.values(grade)[0]?.length ?? new Date(Date.UTC(Number(escala.competencia.slice(0, 4)), Number(escala.competencia.slice(5, 7)), 0)).getUTCDate();
    return Object.fromEntries(config.pessoas.map((p) => [p.id, grade[p.id]?.length ? grade[p.id] : new Array(n).fill("F")]));
  }, [grade, config.pessoas, escala.competencia]);
  const conferencia = React.useMemo(() => conferirEscala(config, escala.competencia, gradeTela, historico), [config, escala.competencia, gradeTela, historico]);
  const nomes = React.useMemo(() => new Map(config.pessoas.map((p) => [p.id, p.nome])), [config.pessoas]);

  const mudarConfig = (f: (c: ConfigEscala) => ConfigEscala) => {
    setConfig(f);
    setConfigMudou(true);
  };
  const pintar = (pessoaId: string, dia: number) => {
    if (!config.turnos.some((t) => t.id === pincel) && !["F", "FE", "AF"].includes(pincel)) return;
    setGrade((g) => {
      const atual = gradeTela[pessoaId];
      const nova = [...atual];
      nova[dia] = pincel;
      return { ...g, [pessoaId]: nova };
    });
    setGradeMudou(true);
  };

  const salvar = (gerar: boolean) =>
    iniciarSalvar(async () => {
      if (configMudou || gerar) {
        if (gradeMudou && !gerar) {
          const g = await salvarGrade(empresaId, escala.id, JSON.stringify(gradeTela));
          if (!g.ok) return void toast.error(g.mensagem ?? "Não foi possível salvar a grade.");
        }
        const r = await salvarConfiguracao(empresaId, escala.id, JSON.stringify(config), gerar);
        if (!r.ok) return void toast.error(r.mensagem ?? "Não foi possível salvar.");
        if (r.dados?.grade) setGrade(r.dados.grade);
        toast.success(r.mensagem ?? "Salvo.");
      } else if (gradeMudou) {
        const r = await salvarGrade(empresaId, escala.id, JSON.stringify(gradeTela));
        if (!r.ok) return void toast.error(r.mensagem ?? "Não foi possível salvar.");
        toast.success(r.mensagem ?? "Salvo.");
      }
      setConfigMudou(false);
      setGradeMudou(false);
      router.refresh();
    });

  const escolherAchado = (a: Achado) => {
    setDestaque({ pessoaId: a.pessoaId, dia: a.dia });
    setAba("grade");
  };

  const publicar = async () => {
    const r = await publicarEscala(empresaId, escala.id, true, conferencia.erros > 0);
    if (r.ok) {
      toast.success(r.mensagem ?? "Publicada.");
      router.refresh();
    } else toast.error(r.mensagem ?? "Não foi possível publicar.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between print:hidden">
        <div className="min-w-0 space-y-1">
          {editandoNome ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await renomearEscala(empresaId, escala.id, nome);
                if (r.ok) {
                  setEditandoNome(false);
                  router.refresh();
                } else toast.error(r.mensagem ?? "Não foi possível renomear.");
              }}
            >
              <Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} aria-label="Nome da escala" className="h-10 w-64" autoFocus />
              <Button type="submit" tamanho="sm">
                Salvar
              </Button>
            </form>
          ) : (
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {escala.nome}
              <Button variante="fantasma" tamanho="iconeSm" aria-label="Renomear" onClick={() => setEditandoNome(true)}>
                <Pencil />
              </Button>
            </h1>
          )}
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{escala.mesTexto.charAt(0).toUpperCase() + escala.mesTexto.slice(1)}</span>
            <Badge variante={escala.status === "publicada" ? "sucesso" : "neutro"}>{escala.status === "publicada" ? "Publicada" : "Rascunho"}</Badge>
            <span>· {config.pessoas.length} pessoa(s)</span>
          </p>
          <ResumoConferencia r={conferencia} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendente ? (
            <>
              <Button onClick={() => salvar(false)} disabled={salvando}>
                {salvando ? <Loader2 className="animate-spin" /> : <Save />} Salvar
              </Button>
              <Button
                variante="contorno"
                disabled={salvando}
                onClick={() => {
                  setConfig(configInicial);
                  setGrade(gradeInicial);
                  setConfigMudou(false);
                  setGradeMudou(false);
                }}
              >
                <Undo2 /> Desfazer
              </Button>
            </>
          ) : null}
          <Confirmacao
            gatilho={
              <Button variante={configMudou ? "primario" : "contorno"} disabled={salvando}>
                <Wand2 /> {configMudou ? "Salvar e gerar a escala" : "Gerar de novo"}
              </Button>
            }
            titulo="Gerar a escala de novo?"
            descricao="O portal monta todos os dias outra vez com a configuração atual. Férias e afastamentos lançados ficam; as trocas feitas à mão na grade se perdem."
            textoConfirmar="Gerar"
            aoConfirmar={() => salvar(true)}
          />
          <Button variante="contorno" onClick={() => window.print()} disabled={pendente} title={pendente ? "Salve antes de imprimir" : undefined}>
            <Printer /> Imprimir
          </Button>
          {escala.status === "publicada" ? (
            <BotaoAcao variante="contorno" acao={() => publicarEscala(empresaId, escala.id, false)}>
              <RotateCcw /> Voltar a rascunho
            </BotaoAcao>
          ) : conferencia.erros > 0 ? (
            <Confirmacao
              gatilho={
                <Button variante="sucesso" disabled={pendente}>
                  <Send /> Publicar
                </Button>
              }
              titulo="Publicar com pontos fora da CLT?"
              descricao={`A conferência encontrou ${conferencia.erros} ponto(s) fora da regra. Publique só se houver convenção coletiva ou acordo que permita. Veja a aba Conferência da CLT.`}
              textoConfirmar="Publicar mesmo assim"
              aoConfirmar={publicar}
            />
          ) : (
            <Button variante="sucesso" disabled={pendente} onClick={publicar}>
              <Send /> Publicar
            </Button>
          )}
          <BotaoAcao
            variante="fantasma"
            tamanho="iconeSm"
            aria-label="Excluir escala"
            acao={() => excluirEscala(empresaId, escala.id)}
            confirmar={{ titulo: "Excluir esta escala?", descricao: "A escala do mês será apagada. Não dá para desfazer.", textoConfirmar: "Excluir", perigo: true }}
          >
            <Trash2 />
          </BotaoAcao>
        </div>
      </div>

      {/* Título na impressão */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">
          {escala.nome} — <span>{escala.mesTexto.charAt(0).toUpperCase() + escala.mesTexto.slice(1)}</span>
        </h1>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border print:hidden" role="tablist" aria-label="Partes da escala">
        {ABAS.map((a) => (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={aba === a.valor}
            onClick={() => setAba(a.valor)}
            className={cn(
              "-mb-px min-h-10 whitespace-nowrap border-b-2 px-3 text-sm",
              aba === a.valor ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {a.rotulo}
            {a.valor === "conferencia" && conferencia.erros + conferencia.alertas > 0 ? (
              <Badge variante={conferencia.erros ? "perigo" : "alerta"} className="ml-1.5">
                {conferencia.erros + conferencia.alertas}
              </Badge>
            ) : null}
          </button>
        ))}
      </div>

      <div className={cn(aba !== "grade" && "hidden print:block", "space-y-3")}>
        <Pincel config={config} valor={pincel} aoMudar={setPincel} />
        <p className="text-xs text-muted-foreground print:hidden">
          Escolha acima o que marcar e clique nos dias. Contorno vermelho: fora da regra; amarelo: atenção. Dias em cinza: empresa fechada; FER: feriado.
        </p>
        <GradeEscala config={config} competencia={escala.competencia} grade={gradeTela} conferencia={conferencia} aoClicar={pintar} destaque={destaque} />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {config.turnos.map((t) => (
            <li key={t.id} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: corDoTurno(config.turnos, t.id) }} />
              {t.nome}: {descreverTurno(t)}
            </li>
          ))}
          <li>F: folga · FÉ: férias · AF: afastamento</li>
        </ul>
        {escala.ia_resumo ? (
          <Card className="print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarCheck2 className="size-4" /> Última proposta do assistente aplicada
              </CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-line text-sm text-muted-foreground">{escala.ia_resumo}</CardContent>
          </Card>
        ) : null}
      </div>

      {aba === "pessoas" ? <ConfigPessoas config={config} mudar={mudarConfig} funcionarios={funcionarios} empresaId={empresaId} /> : null}
      {aba === "empresa" ? <ConfigEmpresa config={config} mudar={mudarConfig} competencia={escala.competencia} /> : null}
      {aba === "assistente" ? (
        <Assistente
          empresaId={empresaId}
          escalaId={escala.id}
          competencia={escala.competencia}
          historico={historico}
          situacao={situacaoIa}
          alteracoesPendentes={pendente}
          admin={admin}
        />
      ) : null}
      {aba === "conferencia" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            O portal confere jornada diária e semanal, intervalo, 11 horas entre jornadas, folga semanal, domingo, feriados, trabalho noturno, menores e cobertura mínima. A
            convenção coletiva da categoria pode trazer regras próprias: na dúvida, fale com o escritório.
          </p>
          <ListaConferencia r={conferencia} aoEscolher={escolherAchado} nomes={nomes} />
        </div>
      ) : null}
      {(aba === "pessoas" || aba === "empresa") && configMudou ? (
        <div className="sticky bottom-3 z-30 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur print:hidden">
          <span className="mr-auto text-sm text-muted-foreground">Alterações na configuração ainda não salvas.</span>
          <Button variante="contorno" onClick={() => salvar(false)} disabled={salvando}>
            <Save /> Salvar sem gerar
          </Button>
          <Button onClick={() => salvar(true)} disabled={salvando}>
            {salvando ? <Loader2 className="animate-spin" /> : <Wand2 />} Salvar e gerar a escala
          </Button>
        </div>
      ) : null}
    </div>
  );
}
