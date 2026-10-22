"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Calculator, FileSearch, Loader2, Plus, Send, Trash2, UserPlus } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { SeletorMunicipio } from "@/components/obrigacoes/seletor-municipio";
import { FormDestinatario } from "@/components/nfe/cadastros";
import { lerNumeroBR } from "@/components/nfe/emitir-nota";
import { municipiosDaUf } from "@/lib/nfe-emissao/acoes";
import { emitirConhecimento, preencherPelaNfe, previaCte, usarPropriaEmpresa, type PedidoCte, type PreviaCte } from "@/lib/cte-emissao/acoes";
import { CST_ICMS_CTE, DESTINO_CTE, TOMADOR_CTE } from "@/lib/cte-emissao/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";

export interface OpcaoOperacaoCte {
  id: string;
  nome: string;
  natureza: string;
  cfop: string;
  destino: keyof typeof DESTINO_CTE;
}
export interface OpcaoParticipante {
  id: string;
  nome: string;
  documento: string | null;
  municipio: string | null;
  uf: string | null;
}

const mostrar = (n: string | null | undefined, casas = 4) =>
  n == null || n === "" ? "" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });

interface Componente {
  chave: number;
  nome: string;
  valor: string;
}

export function EmitirCte({
  empresaId,
  ambiente,
  ufEmitente,
  operacoes,
  participantes: participantesIniciais,
  inicial,
  corrigir,
  somenteConferir,
}: {
  empresaId: string;
  ambiente: "homologacao" | "producao";
  ufEmitente: string;
  operacoes: OpcaoOperacaoCte[];
  participantes: OpcaoParticipante[];
  inicial?: PedidoCte | null;
  corrigir?: { id: string; numero: number } | null;
  /** Emissão desligada: só confere os valores (nada vai à SEFAZ). */
  somenteConferir?: boolean;
}) {
  const router = useRouter();
  const seq = React.useRef(10_000);
  const [participantes, setParticipantes] = React.useState(participantesIniciais);
  const [operacaoId, setOperacaoId] = React.useState(inicial?.operacao_id || (operacoes.length === 1 ? operacoes[0].id : ""));
  const [tomador, setTomador] = React.useState<PedidoCte["tomador"] | "">(inicial?.tomador ?? "");
  const [tomadorId, setTomadorId] = React.useState(inicial?.tomador_id ?? "");
  const [remetenteId, setRemetenteId] = React.useState(inicial?.remetente_id ?? "");
  const [destinatarioId, setDestinatarioId] = React.useState(inicial?.destinatario_id ?? "");
  const [outroInicio, setOutroInicio] = React.useState(Boolean(inicial?.municipio_inicio));
  const [outroFim, setOutroFim] = React.useState(Boolean(inicial?.municipio_fim));
  const [municipioInicio, setMunicipioInicio] = React.useState(inicial?.municipio_inicio ?? "");
  const [municipioFim, setMunicipioFim] = React.useState(inicial?.municipio_fim ?? "");
  const [valorPrestacao, setValorPrestacao] = React.useState(mostrar(inicial?.valor_prestacao, 2));
  const [valorReceber, setValorReceber] = React.useState(mostrar(inicial?.valor_receber, 2));
  const [componentes, setComponentes] = React.useState<Componente[]>(() => (inicial?.componentes ?? []).map((c, i) => ({ chave: i + 1, nome: c.nome, valor: mostrar(c.valor, 2) })));
  const [carga, setCarga] = React.useState({
    produto: inicial?.carga?.produto ?? "",
    peso: mostrar(inicial?.carga?.peso_kg),
    valor: mostrar(inicial?.carga?.valor, 2),
    outras: inicial?.carga?.outras ?? "",
  });
  const [nfes, setNfes] = React.useState((inicial?.nfes ?? []).join("\n"));
  const [observacoes, setObservacoes] = React.useState(inicial?.observacoes ?? "");
  const [chaveBusca, setChaveBusca] = React.useState("");
  const [avisosNfe, setAvisosNfe] = React.useState<string[]>([]);
  const [novo, setNovo] = React.useState<"remetente" | "destinatario" | "tomador" | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [previa, setPrevia] = React.useState<PreviaCte | null>(null);
  const [ocupado, setOcupado] = React.useState<"previa" | "emitir" | "nfe" | "propria" | null>(null);
  const [repetida, setRepetida] = React.useState(false);

  const operacao = operacoes.find((o) => o.id === operacaoId);
  const remetente = participantes.find((p) => p.id === remetenteId);
  const destinatario = participantes.find((p) => p.id === destinatarioId);
  const [ufInicio, setUfInicio] = React.useState<string | null>(null);
  const [ufFim, setUfFim] = React.useState<string | null>(null);
  const ini = outroInicio ? ufInicio : (remetente?.uf ?? null);
  const fim = outroFim ? ufFim : (destinatario?.uf ?? null);
  const trajetoErrado =
    operacao && ini && fim
      ? ini !== ufEmitente
        ? `A prestação começa em ${ini}, fora do estado do emitente (${ufEmitente}): esse caso (CFOP 5932/6932) ainda não é emitido pelo portal.`
        : operacao.destino === "interna" && fim !== ini
          ? `A operação é para dentro do estado, mas o frete vai de ${ini} para ${fim}.`
          : operacao.destino === "interestadual" && fim === ini
            ? `A operação é para outro estado, mas o frete começa e termina em ${ini}.`
            : null
      : null;

  const somaComponentes = componentes.reduce((s, c) => s + Number(lerNumeroBR(c.valor, 2) ?? 0), 0);
  const chaves = nfes
    .split(/[\s,;]+/)
    .map((k) => k.replace(/\D/g, ""))
    .filter(Boolean);

  function participanteOpcoes() {
    return participantes.map((p) => (
      <option key={p.id} value={p.id}>
        {p.nome}
        {p.documento ? ` — ${formatarDocumento(p.documento)}` : ""}
        {p.municipio ? ` — ${p.municipio}/${p.uf}` : ""}
      </option>
    ));
  }

  function montar(): PedidoCte | string {
    if (!operacaoId) return "Escolha a operação do frete.";
    if (!remetenteId) return "Escolha o remetente (quem envia a carga).";
    if (!destinatarioId) return "Escolha o destinatário (quem recebe a carga).";
    if (!tomador) return "Escolha quem paga o frete (tomador).";
    if (tomador === "outro" && !tomadorId) return "Escolha quem paga o frete.";
    if (outroInicio && !municipioInicio) return "Escolha o município onde começa a prestação.";
    if (outroFim && !municipioFim) return "Escolha o município onde termina a prestação.";
    const vp = lerNumeroBR(valorPrestacao, 2);
    if (!vp || Number(vp) <= 0) return "Informe o valor do frete (até 2 casas decimais).";
    const vr = valorReceber.trim() ? lerNumeroBR(valorReceber, 2) : "";
    if (vr === null) return "Valor a receber inválido.";
    const comps = [];
    for (const c of componentes) {
      const v = lerNumeroBR(c.valor, 2);
      if (!c.nome.trim() || v == null) return "Cada componente do frete precisa de nome e valor.";
      comps.push({ nome: c.nome.trim().slice(0, 15), valor: v });
    }
    const peso = lerNumeroBR(carga.peso, 4);
    if (!peso || Number(peso) <= 0) return "Informe o peso da carga em kg (até 4 casas decimais).";
    const vc = carga.valor.trim() ? lerNumeroBR(carga.valor, 2) : "";
    if (vc === null) return "Valor da carga inválido.";
    if (!chaves.length) return "Informe a chave de ao menos uma NF-e da carga.";
    if (chaves.some((k) => k.length !== 44)) return "Cada chave de NF-e tem 44 números.";
    return {
      operacao_id: operacaoId,
      tomador,
      tomador_id: tomador === "outro" ? tomadorId : "",
      remetente_id: remetenteId,
      destinatario_id: destinatarioId,
      municipio_inicio: outroInicio ? municipioInicio : "",
      municipio_fim: outroFim ? municipioFim : "",
      valor_prestacao: vp,
      valor_receber: vr,
      componentes: comps,
      carga: { produto: carga.produto.trim(), peso_kg: peso, valor: vc, outras: carga.outras.trim() },
      nfes: [...new Set(chaves)],
      observacoes: observacoes.trim(),
      origem: inicial?.origem,
    };
  }

  async function conferir() {
    setErro(null);
    const p = montar();
    if (typeof p === "string") {
      setErro(p);
      return;
    }
    setOcupado("previa");
    const r = await previaCte(empresaId, p);
    setOcupado(null);
    if (r.ok && r.dados) setPrevia(r.dados);
    else setErro(r.mensagem ?? "Não foi possível calcular o CT-e.");
  }

  async function emitir() {
    const p = montar();
    if (typeof p === "string") {
      setErro(p);
      setPrevia(null);
      return;
    }
    setOcupado("emitir");
    const r = await emitirConhecimento(empresaId, { ...p, confirmar_repetida: repetida }, corrigir?.id ?? null);
    setOcupado(null);
    if (r.ok && r.dados?.id) {
      toast.success(r.mensagem ?? "CT-e enviado à SEFAZ.");
      router.push(`/e/${empresaId}/cte/${r.dados.id}`);
      return;
    }
    setPrevia(null);
    if (r.dados?.repetida) setRepetida(true);
    setErro(r.mensagem ?? "Não foi possível emitir o CT-e.");
  }

  async function buscarNfe() {
    setErro(null);
    setOcupado("nfe");
    const r = await preencherPelaNfe(empresaId, chaveBusca);
    setOcupado(null);
    if (!r.ok || !r.dados) {
      setErro(r.mensagem ?? "Não foi possível buscar a NF-e.");
      return;
    }
    const d = r.dados;
    if (d.remetente_id) setRemetenteId(d.remetente_id);
    if (d.destinatario_id) setDestinatarioId(d.destinatario_id);
    if (d.tomador && !tomador) setTomador(d.tomador);
    setCarga((c) => ({
      ...c,
      produto: c.produto || d.carga.produto || "",
      peso: d.carga.peso_kg ? mostrar(String(Number(lerNumeroBR(c.peso, 4) ?? 0) + Number(d.carga.peso_kg))) : c.peso,
      valor: d.carga.valor ? mostrar(String(Number(lerNumeroBR(c.valor, 2) ?? 0) + Number(d.carga.valor)), 2) : c.valor,
    }));
    if (!chaves.includes(d.chave)) setNfes((t) => (t.trim() ? `${t.trim()}\n${d.chave}` : d.chave));
    setChaveBusca("");
    setAvisosNfe(d.avisos);
    if (r.mensagem) toast.success(r.mensagem);
    router.refresh();
  }

  async function propriaEmpresa() {
    setOcupado("propria");
    const r = await usarPropriaEmpresa(empresaId);
    setOcupado(null);
    if (r.ok && r.dados) {
      setRemetenteId(r.dados.id);
      if (r.mensagem) toast.success(r.mensagem);
      router.refresh();
    } else setErro(r.mensagem ?? "Não foi possível usar a própria empresa.");
  }

  const atualizarComp = (chave: number, dados: Partial<Componente>) => setComponentes((l) => l.map((c) => (c.chave === chave ? { ...c, ...dados } : c)));

  return (
    <div className="space-y-6">
      {somenteConferir ? null : ambiente === "homologacao" ? (
        <Alerta tom="info" titulo="Emissão em teste (homologação)">
          Esta empresa ainda emite no ambiente de testes da SEFAZ: o CT-e não tem valor fiscal e o nome do remetente e do destinatário sai trocado pelo texto exigido pela SEFAZ.
        </Alerta>
      ) : null}
      {corrigir ? (
        <Alerta tom="alerta" titulo={`Correção do CT-e nº ${corrigir.numero}`}>
          O CT-e rejeitado vai de novo para a SEFAZ com o mesmo número, com os dados abaixo.
        </Alerta>
      ) : null}

      <section className="space-y-2 rounded-lg border border-border p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-titulo">Preencher pela NF-e da carga</h2>
        <p className="text-xs text-muted-foreground">
          Digite a chave de acesso (44 números) de uma NF-e que está no portal: o remetente, o destinatário, o produto, o peso e o valor da carga vêm da nota. Quem faltar é
          cadastrado sozinho. Repita para cada nota da mesma carga.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label="Chave da NF-e" inputMode="numeric" placeholder="Chave de acesso da NF-e" value={chaveBusca} onChange={(e) => setChaveBusca(e.target.value)} />
          <Button type="button" variante="contorno" onClick={buscarNfe} disabled={Boolean(ocupado) || chaveBusca.replace(/\D/g, "").length !== 44}>
            {ocupado === "nfe" ? <Loader2 className="animate-spin" /> : <FileSearch />} Buscar NF-e
          </Button>
        </div>
        {avisosNfe.map((a) => (
          <p key={a} className="text-xs text-alerta">
            {a}
          </p>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Campo
          rotulo="Operação do frete"
          htmlFor="operacao"
          obrigatorio
          className="sm:col-span-2"
          ajuda={operacao ? `${operacao.natureza} — CFOP ${operacao.cfop} — ${DESTINO_CTE[operacao.destino]}. ICMS e IBS/CBS definidos pelo escritório.` : "As regras fiscais de cada operação são cadastradas pelo escritório."}
        >
          <Select id="operacao" value={operacaoId} onChange={(e) => setOperacaoId(e.target.value)}>
            <option value="">Escolha...</option>
            {operacoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Remetente (quem envia a carga)" htmlFor="remetente" obrigatorio>
          <div className="flex flex-wrap gap-2 sm:flex-nowrap">
            <Select id="remetente" value={remetenteId} onChange={(e) => setRemetenteId(e.target.value)}>
              <option value="">Escolha...</option>
              {participanteOpcoes()}
            </Select>
            <Button type="button" variante="contorno" onClick={propriaEmpresa} disabled={Boolean(ocupado)} title="A própria empresa envia a carga">
              {ocupado === "propria" ? <Loader2 className="animate-spin" /> : <Building2 />} A própria empresa
            </Button>
            <Button type="button" variante="contorno" onClick={() => setNovo("remetente")}>
              <UserPlus /> Novo
            </Button>
          </div>
        </Campo>
        <Campo rotulo="Destinatário (quem recebe a carga)" htmlFor="destinatario" obrigatorio>
          <div className="flex gap-2">
            <Select id="destinatario" value={destinatarioId} onChange={(e) => setDestinatarioId(e.target.value)}>
              <option value="">Escolha...</option>
              {participanteOpcoes()}
            </Select>
            <Button type="button" variante="contorno" onClick={() => setNovo("destinatario")}>
              <UserPlus /> Novo
            </Button>
          </div>
        </Campo>
        <Campo rotulo="Quem paga o frete (tomador)" htmlFor="tomador" obrigatorio>
          <Select id="tomador" value={tomador} onChange={(e) => setTomador(e.target.value as PedidoCte["tomador"])}>
            <option value="">Escolha...</option>
            {Object.entries(TOMADOR_CTE).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </Campo>
        {tomador === "outro" ? (
          <Campo rotulo="Tomador do serviço" htmlFor="tomador-id" obrigatorio>
            <div className="flex gap-2">
              <Select id="tomador-id" value={tomadorId} onChange={(e) => setTomadorId(e.target.value)}>
                <option value="">Escolha...</option>
                {participanteOpcoes()}
              </Select>
              <Button type="button" variante="contorno" onClick={() => setNovo("tomador")}>
                <UserPlus /> Novo
              </Button>
            </div>
          </Campo>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-titulo">Trajeto</h2>
        <p className="text-sm text-muted-foreground">
          Começa em <strong>{outroInicio ? "outro local" : remetente?.municipio ? `${remetente.municipio}/${remetente.uf}` : "(cidade do remetente)"}</strong> e termina em{" "}
          <strong>{outroFim ? "outro local" : destinatario?.municipio ? `${destinatario.municipio}/${destinatario.uf}` : "(cidade do destinatário)"}</strong>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={outroInicio} onChange={(e) => setOutroInicio(e.target.checked)} /> A carga é coletada em outra cidade
            </label>
            {outroInicio ? (
              <SeletorMunicipio
                idBase="mun-ini"
                nomeCampo="mun_ini"
                nomeUf="uf_ini"
                ufInicial={null}
                municipioInicial={null}
                municipiosIniciais={[]}
                carregar={(uf) => municipiosDaUf(empresaId, uf)}
                aoMudar={(v) => {
                  setUfInicio(v.uf || null);
                  setMunicipioInicio(v.municipio);
                }}
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={outroFim} onChange={(e) => setOutroFim(e.target.checked)} /> A carga é entregue em outra cidade
            </label>
            {outroFim ? (
              <SeletorMunicipio
                idBase="mun-fim"
                nomeCampo="mun_fim"
                nomeUf="uf_fim"
                ufInicial={null}
                municipioInicial={null}
                municipiosIniciais={[]}
                carregar={(uf) => municipiosDaUf(empresaId, uf)}
                aoMudar={(v) => {
                  setUfFim(v.uf || null);
                  setMunicipioFim(v.municipio);
                }}
              />
            ) : null}
          </div>
        </div>
        {trajetoErrado ? <Alerta tom="alerta">{trajetoErrado}</Alerta> : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-titulo">Valor do frete</h2>
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Campo rotulo="Valor total do frete (R$)" htmlFor="valor-prestacao" obrigatorio>
            <Input id="valor-prestacao" inputMode="decimal" value={valorPrestacao} onChange={(e) => setValorPrestacao(e.target.value)} />
          </Campo>
          <Campo rotulo="Valor a receber (R$)" htmlFor="valor-receber" ajuda="Vazio: o valor total do frete.">
            <Input id="valor-receber" inputMode="decimal" value={valorReceber} onChange={(e) => setValorReceber(e.target.value)} />
          </Campo>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Componentes do frete (opcional), como frete peso e pedágio. Se informar, a soma precisa ser igual ao valor do frete.</p>
          {componentes.map((c) => (
            <div key={c.chave} className="grid grid-cols-[1fr_9rem_auto] items-end gap-2">
              <Input aria-label="Nome do componente" maxLength={15} value={c.nome} onChange={(e) => atualizarComp(c.chave, { nome: e.target.value })} placeholder="Ex.: FRETE PESO" />
              <Input aria-label="Valor do componente" inputMode="decimal" value={c.valor} onChange={(e) => atualizarComp(c.chave, { valor: e.target.value })} placeholder="0,00" />
              <Button type="button" variante="fantasma" tamanho="sm" title="Remover" onClick={() => setComponentes((l) => l.filter((x) => x.chave !== c.chave))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variante="contorno" tamanho="sm" onClick={() => setComponentes((l) => [...l, { chave: seq.current++, nome: "", valor: "" }])}>
              <Plus /> Componente
            </Button>
            {componentes.length ? (
              <span className="text-xs text-muted-foreground">
                Soma: <span className="numero">{formatarMoeda(somaComponentes)}</span>
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-titulo">Carga</h2>
        <div className="grid gap-3 sm:grid-cols-4 [&>*]:min-w-0">
          <Campo rotulo="Produto predominante" htmlFor="produto" obrigatorio className="sm:col-span-2" ajuda="Ex.: MILHO EM GRAOS">
            <Input id="produto" maxLength={60} value={carga.produto} onChange={(e) => setCarga({ ...carga, produto: e.target.value })} />
          </Campo>
          <Campo rotulo="Peso (kg)" htmlFor="peso" obrigatorio>
            <Input id="peso" inputMode="decimal" value={carga.peso} onChange={(e) => setCarga({ ...carga, peso: e.target.value })} />
          </Campo>
          <Campo rotulo="Valor da carga (R$)" htmlFor="valor-carga" ajuda="Normalmente o total das NF-e.">
            <Input id="valor-carga" inputMode="decimal" value={carga.valor} onChange={(e) => setCarga({ ...carga, valor: e.target.value })} />
          </Campo>
          <Campo rotulo="Outras características" htmlFor="outras" className="sm:col-span-2" ajuda="Ex.: A GRANEL">
            <Input id="outras" maxLength={30} value={carga.outras} onChange={(e) => setCarga({ ...carga, outras: e.target.value })} />
          </Campo>
          <Campo rotulo="Chaves das NF-e da carga" htmlFor="nfes" obrigatorio className="sm:col-span-2" ajuda={`${chaves.length} nota(s). Uma chave de 44 números por linha.`}>
            <Textarea id="nfes" rows={3} value={nfes} onChange={(e) => setNfes(e.target.value)} />
          </Campo>
        </div>
        <Campo rotulo="Observações" htmlFor="obs" ajuda="Somadas ao texto da operação e ao padrão da empresa (ex.: placa, ordem de carregamento).">
          <Textarea id="obs" rows={2} maxLength={2000} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </Campo>
      </section>

      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
      {repetida ? (
        <Alerta tom="alerta" titulo="Já existe CT-e para uma destas NF-e">
          Se for mesmo outro transporte, clique de novo em “Conferir e emitir” e confirme.
        </Alerta>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={conferir} disabled={Boolean(ocupado) || Boolean(trajetoErrado)}>
          {ocupado === "previa" ? <Loader2 className="animate-spin" /> : <Calculator />} {somenteConferir ? "Conferir os valores" : "Conferir e emitir"}
        </Button>
      </div>

      <Dialog open={Boolean(previa)} onOpenChange={(v) => !v && !ocupado && setPrevia(null)}>
        {previa ? (
          <DialogContent titulo="Confira os valores antes de emitir" descricao="Cálculo com as regras da operação cadastradas pelo escritório.">
            <div className="space-y-4 text-sm">
              {somenteConferir ? <Alerta tom="info">Emissão desligada: só a conferência dos valores. Nada foi enviado à SEFAZ.</Alerta> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">CFOP</dt>
                <dd>
                  {previa.cfop} — {previa.natureza}
                </dd>
                <dt className="text-muted-foreground">Trajeto</dt>
                <dd>{previa.trajeto}</dd>
                <dt className="text-muted-foreground">Quem paga</dt>
                <dd>{previa.tomador}</dd>
                <dt className="text-muted-foreground">ICMS</dt>
                <dd>{CST_ICMS_CTE[previa.icms.cst] ?? previa.icms.cst}</dd>
              </dl>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                {(
                  [
                    ["Base do ICMS", previa.icms.vBC],
                    [`ICMS${previa.icms.pICMS ? ` (${previa.icms.pICMS.replace(".", ",")}%)` : ""}`, previa.icms.vICMS],
                    ["Crédito presumido", previa.icms.vCred],
                    ["IBS (teste 2026)", previa.vIBS],
                    ["CBS (teste 2026)", previa.vCBS],
                    ["Valor a receber", previa.vRec !== previa.vTPrest ? previa.vRec : null],
                  ] as const
                )
                  .filter(([, v]) => v != null && v !== "0.00")
                  .map(([r, v]) => (
                    <React.Fragment key={r}>
                      <dt className="text-muted-foreground">{r}</dt>
                      <dd className="text-right numero">{formatarMoeda(v!)}</dd>
                    </React.Fragment>
                  ))}
                <dt className="font-semibold">Valor do frete</dt>
                <dd className="text-right font-semibold numero">{formatarMoeda(previa.vTPrest)}</dd>
              </dl>
              <div className="flex justify-end gap-2">
                <Button type="button" variante="contorno" onClick={() => setPrevia(null)} disabled={Boolean(ocupado)}>
                  Voltar e corrigir
                </Button>
                {somenteConferir ? null : (
                  <Button type="button" onClick={emitir} disabled={Boolean(ocupado)}>
                    {ocupado === "emitir" ? <Loader2 className="animate-spin" /> : <Send />} {ambiente === "homologacao" ? "Emitir CT-e de teste" : "Emitir CT-e"}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={novo !== null} onOpenChange={(v) => !v && setNovo(null)}>
        <DialogContent titulo="Novo participante" descricao="Fica cadastrado para os próximos CT-e e notas (o mesmo cadastro de clientes da NF-e)." largura="lg">
          <FormDestinatario
            empresaId={empresaId}
            aoSalvar={(id) => {
              if (novo === "remetente") setRemetenteId(id);
              else if (novo === "destinatario") setDestinatarioId(id);
              else setTomadorId(id);
              setNovo(null);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      {/* A lista vem do servidor: depois de cadastrar, a página é atualizada */}
      <SincronizarLista participantes={participantesIniciais} setParticipantes={setParticipantes} />
    </div>
  );
}

function SincronizarLista({ participantes, setParticipantes }: { participantes: OpcaoParticipante[]; setParticipantes: (p: OpcaoParticipante[]) => void }) {
  React.useEffect(() => setParticipantes(participantes), [participantes, setParticipantes]);
  return null;
}
