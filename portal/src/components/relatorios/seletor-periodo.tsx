"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { chaveIntervalo, lerIntervalo } from "@/lib/relatorios/periodo";

type Opcao = { valor: string; rotulo: string };
export type OpcoesPeriodo = { meses: Opcao[]; trimestres: Opcao[]; anos: Opcao[]; doze: Opcao; intervalo: Opcao[] };

const PERSONALIZADO = "__intervalo";

/**
 * Escolha do período: mês, trimestre, ano, últimos 12 meses ou "de um mês
 * até outro" (ex.: 04/2026 até 08/2026). `aoEscolher` recebe a chave do período.
 */
function EscolhaPeriodo({
  valor,
  opcoes,
  aoEscolher,
  idBase,
  textoAplicar,
}: {
  valor: string;
  opcoes: OpcoesPeriodo;
  aoEscolher: (chave: string) => void;
  idBase: string;
  textoAplicar: string;
}) {
  const atual = lerIntervalo(valor);
  const [personalizado, setPersonalizado] = useState(Boolean(atual));
  const padraoAte = opcoes.intervalo[1]?.valor ?? opcoes.intervalo[0]?.valor ?? "";
  const padraoDe = opcoes.intervalo[5]?.valor ?? padraoAte;
  const [de, setDe] = useState(atual ? atual.de.slice(0, 7) : padraoDe);
  const [ate, setAte] = useState(atual ? atual.ate.slice(0, 7) : padraoAte);
  const selecionado = personalizado ? PERSONALIZADO : valor.startsWith("12m") ? "12m" : valor;
  const invertido = de > ate;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <Select
        id={idBase}
        value={selecionado}
        className="w-full sm:w-64"
        onChange={(e) => {
          if (e.target.value === PERSONALIZADO) {
            setPersonalizado(true);
            return;
          }
          setPersonalizado(false);
          aoEscolher(e.target.value);
        }}
      >
        <optgroup label="Mês">
          {opcoes.meses.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </optgroup>
        <optgroup label="Trimestre">
          {opcoes.trimestres.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </optgroup>
        <optgroup label="Ano">
          {opcoes.anos.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </optgroup>
        <optgroup label="Outros">
          <option value={opcoes.doze.valor}>{opcoes.doze.rotulo}</option>
          <option value={PERSONALIZADO}>De um mês até outro…</option>
        </optgroup>
      </Select>
      {personalizado ? (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${idBase}-de`} className="text-sm text-muted-foreground">
            De
          </label>
          <Select id={`${idBase}-de`} value={de} onChange={(e) => setDe(e.target.value)} className="w-32">
            {opcoes.intervalo.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
          <label htmlFor={`${idBase}-ate`} className="text-sm text-muted-foreground">
            até
          </label>
          <Select id={`${idBase}-ate`} value={ate} onChange={(e) => setAte(e.target.value)} className="w-32">
            {opcoes.intervalo.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
          <Button type="button" variante="contorno" onClick={() => aoEscolher(chaveIntervalo(`${de}-01`, `${ate}-01`))}>
            {textoAplicar}
          </Button>
          {invertido ? <span className="text-xs text-muted-foreground">(as datas serão colocadas em ordem)</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Seletor de período que atualiza a página ao trocar (mantém os demais filtros). */
export function SeletorPeriodo({ valor, opcoes, className }: { valor: string; opcoes: OpcoesPeriodo; className?: string }) {
  const router = useRouter();
  const caminho = usePathname();
  const busca = useSearchParams();
  const [pendente, iniciar] = useTransition();
  return (
    <div className={className}>
      <label className="sr-only" htmlFor="periodo">
        Período
      </label>
      <div className="flex items-center gap-2">
        <EscolhaPeriodo
          valor={valor}
          opcoes={opcoes}
          idBase="periodo"
          textoAplicar="Ver período"
          aoEscolher={(chave) => {
            const p = new URLSearchParams(busca.toString());
            p.set("periodo", chave);
            p.delete("detalhe");
            iniciar(() => router.push(`${caminho}?${p.toString()}`));
          }}
        />
        {pendente ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando" /> : null}
      </div>
    </div>
  );
}

/** Campo de período para formulários (envia `name` com a chave escolhida). */
export function CampoPeriodo({ name, valorInicial, opcoes, id }: { name: string; valorInicial: string; opcoes: OpcoesPeriodo; id: string }) {
  const [valor, setValor] = useState(valorInicial.startsWith("12m") ? "12m" : valorInicial);
  return (
    <>
      <input type="hidden" name={name} value={valor} />
      <EscolhaPeriodo valor={valor} opcoes={opcoes} idBase={id} textoAplicar="Usar este período" aoEscolher={setValor} />
      {lerIntervalo(valor) ? <p className="mt-1 text-xs text-muted-foreground">Período escolhido: {valor.replace("_", " até ").replace(/(\d{4})-(\d{2})/g, "$2/$1")}</p> : null}
    </>
  );
}
