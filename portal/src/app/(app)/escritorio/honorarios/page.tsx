import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BookOpenCheck, CalendarClock, CheckCircle2, ClipboardCheck, FileQuestion, HandCoins, Plus, Repeat, Settings } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GerarMes } from "@/components/honorarios/cobrancas";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { numeroCobranca, situacaoExibida } from "@/lib/honorarios/comum";
import { competenciaAtual, hojeISO, listaCompetencias, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { emailConfigurado } from "@/lib/email/enviar";
import { envServidor } from "@/lib/env-servidor";

export const metadata: Metadata = { title: "Honorários" };

export default async function PainelHonorarios() {
  const s = await exigirHonorarios();
  const hoje = hojeISO();
  const mes = competenciaAtual();
  const fimMes = ultimoDiaDoMes(mes);

  const [{ data: cfg }, { data: abertas }, { count: rascunhos }, { data: pagasMes }, { data: fichas }, { data: lancMes }, { count: aClassificar }, { data: esc }] = await Promise.all([
    s.supabase.from("honorarios_config").select("pix_chave, whatsapp_ativo, whatsapp_template, competencia_referencia, geracao_automatica, dia_geracao").single(),
    s.supabase.from("honorarios_cobrancas").select("id, ano, numero, pagador_nome, descricao, valor, vencimento, situacao").eq("situacao", "aberta").order("vencimento").limit(1000),
    s.supabase.from("honorarios_cobrancas").select("id", { count: "exact", head: true }).eq("situacao", "rascunho"),
    s.supabase.from("honorarios_cobrancas").select("valor_pago").eq("situacao", "paga").gte("pago_em", mes).lte("pago_em", fimMes),
    s.supabase.from("honorarios_fichas").select("valor_mensal").eq("situacao", "ativa"),
    s.supabase.from("escritorio_lancamentos").select("natureza, valor, categoria:escritorio_categorias(tipo)").gte("data", mes).lte("data", fimMes).not("categoria_id", "is", null),
    s.supabase.from("escritorio_lancamentos").select("id", { count: "exact", head: true }).is("categoria_id", null),
    s.supabase.from("escritorio").select("whatsapp_phone_number_id").eq("id", 1).single(),
  ]);

  const lista = abertas ?? [];
  const vencidas = lista.filter((c) => c.vencimento < hoje);
  const doMes = lista.filter((c) => c.vencimento >= mes && c.vencimento <= fimMes);
  const proximas = lista.filter((c) => c.vencimento >= hoje).slice(0, 8);
  const recorrente = somar((fichas ?? []).map((f) => f.valor_mensal));
  const recebido = somar((pagasMes ?? []).map((p) => p.valor_pago));
  const foraDre = ["investimento", "aporte_socio", "retirada_socio"];
  const doResultado = (lancMes ?? []).filter((l) => !foraDre.includes((l.categoria as unknown as { tipo: string } | null)?.tipo ?? ""));
  const receitas = somar(doResultado.filter((l) => l.natureza === "receita").map((l) => l.valor));
  const despesas = somar(doResultado.filter((l) => l.natureza === "despesa").map((l) => l.valor));
  const resultado = receitas.minus(despesas);

  const whatsappPronto = Boolean(envServidor.whatsapp() && esc?.whatsapp_phone_number_id && cfg?.whatsapp_template);
  const mesesGerar = listaCompetencias(6, 1);
  const padraoGerar = cfg?.competencia_referencia === "mes_atual" ? mes : somarMeses(mes, -1);

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo="Honorários"
        descricao="Cobranças dos clientes com Pix, robô de cobrança por e-mail e WhatsApp e o resultado do escritório."
        acoes={
          <>
            <Button asChild variante="contorno">
              <Link href="/escritorio/honorarios/configuracoes">
                <Settings /> Configurações
              </Link>
            </Button>
            <Button asChild>
              <Link href="/escritorio/honorarios/cobrancas/nova">
                <Plus /> Nova cobrança avulsa
              </Link>
            </Button>
          </>
        }
      />

      {!cfg?.pix_chave ? (
        <Alerta
          tom="alerta"
          titulo="Cadastre a chave Pix do escritório"
          acao={
            <Button asChild tamanho="sm" variante="contorno">
              <Link href="/escritorio/honorarios/configuracoes">Cadastrar chave</Link>
            </Button>
          }
        >
          Sem a chave, as cobranças saem sem QR code e sem Pix copia e cola.
        </Alerta>
      ) : null}
      {!emailConfigurado() || (cfg?.whatsapp_ativo && !whatsappPronto) ? (
        <Alerta tom="info" titulo="Canais de envio">
          {!emailConfigurado() ? "O e-mail do portal está desconectado: nenhuma cobrança sai por e-mail até ele ser configurado. " : null}
          {cfg?.whatsapp_ativo && !whatsappPronto
            ? "O WhatsApp está desconectado (falta o acesso oficial da Meta ou o modelo de mensagem aprovado): nenhuma cobrança sai por WhatsApp até a ativação."
            : null}
        </Alerta>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Indicador rotulo="Receita mensal dos contratos" valor={formatarMoeda(recorrente)} detalhe={`${fichas?.length ?? 0} cliente(s) com ficha ativa`} icone={Repeat} href="/escritorio/honorarios/fichas" />
        <Indicador
          rotulo={`A receber em ${formatarCompetencia(mes, true)}`}
          valor={formatarMoeda(somar(doMes.map((c) => c.valor)))}
          detalhe={`${doMes.length} cobrança(s) em aberto`}
          icone={CalendarClock}
          tom="info"
          href="/escritorio/honorarios/cobrancas?situacao=aberta"
        />
        <Indicador rotulo={`Recebido em ${formatarCompetencia(mes, true)}`} valor={formatarMoeda(recebido)} icone={CheckCircle2} tom="sucesso" href="/escritorio/honorarios/cobrancas?situacao=paga" />
        <Indicador
          rotulo="Vencidas"
          valor={formatarMoeda(somar(vencidas.map((c) => c.valor)))}
          detalhe={`${vencidas.length} cobrança(s) — o robô está lembrando`}
          icone={AlertTriangle}
          tom={vencidas.length ? "perigo" : "neutro"}
          href="/escritorio/honorarios/cobrancas?situacao=vencida"
        />
        <Indicador rotulo="Para conferir" valor={String(rascunhos ?? 0)} detalhe="cobranças geradas aguardando envio" icone={ClipboardCheck} tom={rascunhos ? "alerta" : "neutro"} href="/escritorio/honorarios/cobrancas?situacao=rascunho" />
        <Indicador
          rotulo="A classificar"
          valor={String(aClassificar ?? 0)}
          detalhe="lançamentos sem linha da DRE (fora do resultado)"
          icone={FileQuestion}
          tom={aClassificar ? "alerta" : "neutro"}
          href="/escritorio/honorarios/lancamentos?ver=classificar"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="size-4 text-primary" /> Cobranças do mês
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {cfg?.geracao_automatica ? `O portal gera sozinho no dia ${cfg.dia_geracao} de cada mês.` : "Geração automática desligada."}
          </span>
        </CardHeader>
        <CardContent>
          <GerarMes meses={mesesGerar} padrao={padraoGerar.slice(0, 7)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vencidas</CardTitle>
          </CardHeader>
          <CardContent>
            {vencidas.length ? (
              <ul className="divide-y divide-border">
                {vencidas.slice(0, 8).map((c) => (
                  <ItemCobranca key={c.id} c={c} hoje={hoje} />
                ))}
              </ul>
            ) : (
              <EstadoVazio icone={CheckCircle2} titulo="Nada vencido" descricao="Todas as cobranças estão em dia." />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Próximos vencimentos</CardTitle>
          </CardHeader>
          <CardContent>
            {proximas.length ? (
              <ul className="divide-y divide-border">
                {proximas.map((c) => (
                  <ItemCobranca key={c.id} c={c} hoje={hoje} />
                ))}
              </ul>
            ) : (
              <EstadoVazio icone={CalendarClock} titulo="Sem cobranças em aberto" descricao="Gere as cobranças do mês ou crie uma avulsa." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheck className="size-4 text-primary" /> Resultado de {formatarCompetencia(mes, true)} (pelo dinheiro que entrou e saiu)
          </CardTitle>
          <Button asChild variante="contorno" tamanho="sm">
            <Link href="/escritorio/honorarios/dre">Abrir a DRE</Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Entradas</p>
            <p className="text-lg font-semibold text-sucesso">{formatarMoeda(receitas)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saídas</p>
            <p className="text-lg font-semibold text-perigo">{formatarMoeda(despesas)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Resultado</p>
            <p className={`text-lg font-semibold ${resultado.isNegative() ? "text-perigo" : "text-titulo"}`}>{formatarMoeda(resultado)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ItemCobranca({ c, hoje }: { c: { id: string; ano: number; numero: number; pagador_nome: string; descricao: string; valor: number; vencimento: string; situacao: string }; hoje: string }) {
  const sit = situacaoExibida(c, hoje);
  return (
    <li>
      <Link href={`/escritorio/honorarios/cobrancas/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{c.pagador_nome}</span>
          <span className="block truncate text-xs text-muted-foreground">
            nº {numeroCobranca(c)} · {c.descricao}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold">{formatarMoeda(dec(c.valor))}</span>
          <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            {formatarData(c.vencimento)} <Badge variante={sit.tom === "perigo" ? "perigo" : sit.tom === "alerta" ? "alerta" : "info"}>{sit.rotulo}</Badge>
          </span>
        </span>
      </Link>
    </li>
  );
}
