"use client";

import * as React from "react";
import { Loader2, Plug, PlugZap, Scale, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { ENQ, MENSAGEM_LEITURA, lerQuadroToledo, lerTextoContinuo, type LeituraBalanca } from "@/lib/gestao/balanca";

/**
 * Balança ligada ao computador do caixa (USB ou serial), lida pelo
 * navegador (Web Serial: Google Chrome ou Microsoft Edge no computador).
 * As opções da porta (modo e velocidade) ficam guardadas neste computador.
 */

interface PortaSerial {
  open(opcoes: { baudRate: number; dataBits?: number; stopBits?: number; parity?: "none" | "even" | "odd" }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialNavegador {
  requestPort(): Promise<PortaSerial>;
  getPorts(): Promise<PortaSerial[]>;
}

export type ModoBalanca = "pedido" | "continuo";
export interface ConfigBalanca {
  /** "pedido": protocolo Toledo/Filizola (o caixa pede o peso); "continuo": a balança envia o peso sem parar. */
  modo: ModoBalanca;
  velocidade: number;
}

const CHAVE = "portal-balanca-caixa";
const PADRAO: ConfigBalanca = { modo: "pedido", velocidade: 9600 };
export const VELOCIDADES = [2400, 4800, 9600, 19200];

function serial(): SerialNavegador | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as unknown as { serial?: SerialNavegador }).serial ?? null;
}

function lerConfig(): ConfigBalanca {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Partial<ConfigBalanca> | null;
    if (c && (c.modo === "pedido" || c.modo === "continuo") && VELOCIDADES.includes(Number(c.velocidade))) return { modo: c.modo, velocidade: Number(c.velocidade) };
  } catch {
    // sem armazenamento do navegador: fica o padrão
  }
  return PADRAO;
}

const espera = (ms: number) => new Promise<"tempo">((r) => setTimeout(() => r("tempo"), ms));

export interface Balanca {
  suportada: boolean;
  conectada: boolean;
  conectando: boolean;
  lendo: boolean;
  config: ConfigBalanca;
  salvarConfig(c: ConfigBalanca): Promise<void>;
  conectar(): Promise<void>;
  desconectar(): Promise<void>;
  lerPeso(): Promise<LeituraBalanca>;
  erro: string | null;
}

const semInscricao = () => () => undefined;

export function useBalanca(): Balanca {
  // O navegador tem leitura de porta (Chrome/Edge no computador)? No servidor, não.
  const suportada = React.useSyncExternalStore(semInscricao, () => Boolean(serial()), () => false);
  const [conectada, setConectada] = React.useState(false);
  const [conectando, setConectando] = React.useState(false);
  const [lendo, setLendo] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  // As opções guardadas neste computador (só aparecem na janela de opções, depois de abrir a tela)
  const [config, setConfig] = React.useState<ConfigBalanca>(() => (typeof window === "undefined" ? PADRAO : lerConfig()));
  const porta = React.useRef<PortaSerial | null>(null);
  const ocupada = React.useRef(false);

  const abrir = React.useCallback(async (p: PortaSerial, c: ConfigBalanca) => {
    await p.open({ baudRate: c.velocidade, dataBits: 8, stopBits: 1, parity: "none" });
    porta.current = p;
    setConectada(true);
    setErro(null);
  }, []);

  // Reabre sozinha a balança já autorizada neste computador
  React.useEffect(() => {
    const s = serial();
    const c = lerConfig();
    if (!s) return;
    let cancelado = false;
    s.getPorts()
      .then(async (portas) => {
        if (!cancelado && portas.length === 1 && !porta.current) await abrir(portas[0], c);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
      porta.current?.close().catch(() => undefined);
      porta.current = null;
    };
  }, [abrir]);

  const conectar = React.useCallback(async () => {
    const s = serial();
    if (!s) return;
    setConectando(true);
    try {
      const p = await s.requestPort();
      if (porta.current) await porta.current.close().catch(() => undefined);
      await abrir(p, config);
    } catch (e) {
      const nome = (e as { name?: string })?.name;
      if (nome !== "NotFoundError") setErro("Não foi possível abrir a porta da balança. Confira se ela está ligada e se outro programa não está usando a balança.");
    } finally {
      setConectando(false);
    }
  }, [abrir, config]);

  const desconectar = React.useCallback(async () => {
    await porta.current?.close().catch(() => undefined);
    porta.current = null;
    setConectada(false);
  }, []);

  const salvarConfig = React.useCallback(
    async (c: ConfigBalanca) => {
      setConfig(c);
      try {
        localStorage.setItem(CHAVE, JSON.stringify(c));
      } catch {
        // sem armazenamento: vale só nesta tela
      }
      const p = porta.current;
      if (p) {
        await p.close().catch(() => undefined);
        porta.current = null;
        setConectada(false);
        await abrir(p, c).catch(() => setErro("Não foi possível reabrir a balança com as novas opções."));
      }
    },
    [abrir],
  );

  const lerPeso = React.useCallback(async (): Promise<LeituraBalanca> => {
    const p = porta.current;
    if (!p?.readable || ocupada.current) return { estado: "invalido", pesoKg: null };
    ocupada.current = true;
    setLendo(true);
    const leitor = p.readable.getReader();
    try {
      if (config.modo === "pedido" && p.writable) {
        const escritor = p.writable.getWriter();
        await escritor.write(new Uint8Array([ENQ]));
        escritor.releaseLock();
      }
      // Junta o que chegar por até 1,5 s (ou até um quadro completo no modo pedido)
      let recebido = "";
      const limite = Date.now() + 1500;
      while (Date.now() < limite) {
        const r = await Promise.race([leitor.read(), espera(limite - Date.now())]);
        if (r === "tempo" || r.done) break;
        recebido += new TextDecoder("latin1").decode(r.value);
        if (config.modo === "pedido" && recebido.includes("\u0003")) break;
        if (config.modo === "continuo" && /\r|\n/.test(recebido) && recebido.length > 40) break;
      }
      return config.modo === "pedido" ? lerQuadroToledo(recebido) : lerTextoContinuo(recebido);
    } catch {
      return { estado: "invalido", pesoKg: null };
    } finally {
      await leitor.cancel().catch(() => undefined);
      leitor.releaseLock();
      ocupada.current = false;
      setLendo(false);
    }
  }, [config.modo]);

  return { suportada, conectada, conectando, lendo, config, salvarConfig, conectar, desconectar, lerPeso, erro };
}

/** Situação da balança e botões de conectar e opções (no alto do caixa). */
export function PainelBalanca({ balanca }: { balanca: Balanca }) {
  const [opcoes, setOpcoes] = React.useState(false);
  const [teste, setTeste] = React.useState<string | null>(null);
  if (!balanca.suportada) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Scale className="size-3.5" /> Para ler a balança direto no caixa, use o Google Chrome ou o Microsoft Edge no computador. Dá para digitar o peso.
      </p>
    );
  }
  async function testar() {
    setTeste("Lendo...");
    const r = await balanca.lerPeso();
    setTeste(r.estado === "estavel" && r.pesoKg ? `Peso lido: ${r.pesoKg.toFixed(3).replace(".", ",")} kg` : MENSAGEM_LEITURA[r.estado as Exclude<typeof r.estado, "estavel">]);
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex items-center gap-1.5">
        <Scale className="size-4 text-primary" />
        Balança: <span className={balanca.conectada ? "font-medium text-sucesso" : "text-muted-foreground"}>{balanca.conectada ? "conectada" : "desconectada"}</span>
      </span>
      {balanca.conectada ? (
        <Button variante="fantasma" tamanho="sm" onClick={() => balanca.desconectar()}>
          <Plug /> Desconectar
        </Button>
      ) : (
        <Button variante="contorno" tamanho="sm" onClick={() => balanca.conectar()} disabled={balanca.conectando}>
          {balanca.conectando ? <Loader2 className="animate-spin" /> : <PlugZap />} Conectar balança
        </Button>
      )}
      <Button variante="fantasma" tamanho="sm" onClick={() => setOpcoes(true)} aria-label="Opções da balança">
        <Settings2 /> Opções
      </Button>
      {balanca.erro ? <span className="text-xs text-perigo">{balanca.erro}</span> : null}
      <Dialog open={opcoes} onOpenChange={(a) => { setOpcoes(a); if (!a) setTeste(null); }}>
        <DialogContent
          titulo="Opções da balança"
          descricao="Valem para este computador. Se o peso não aparecer, confira no manual da balança o protocolo e a velocidade (a maioria usa o protocolo Toledo)."
        >
          <div className="space-y-4">
            <Campo rotulo="Como a balança envia o peso" htmlFor="balanca-modo">
              <Select id="balanca-modo" value={balanca.config.modo} onChange={(e) => balanca.salvarConfig({ ...balanca.config, modo: e.target.value as ModoBalanca })}>
                <option value="pedido">Quando o caixa pede (protocolo Toledo / Filizola)</option>
                <option value="continuo">Sem parar, como texto (modo contínuo)</option>
              </Select>
            </Campo>
            <Campo rotulo="Velocidade da porta" htmlFor="balanca-velocidade" ajuda="Toledo e Filizola costumam usar 2400 ou 9600; Urano e Elgin, 9600.">
              <Select
                id="balanca-velocidade"
                value={String(balanca.config.velocidade)}
                onChange={(e) => balanca.salvarConfig({ ...balanca.config, velocidade: Number(e.target.value) })}
              >
                {VELOCIDADES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Campo>
            {balanca.conectada ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variante="contorno" onClick={testar} disabled={balanca.lendo}>
                  {balanca.lendo ? <Loader2 className="animate-spin" /> : <Scale />} Testar leitura
                </Button>
                {teste ? <span className="text-sm">{teste}</span> : null}
              </div>
            ) : (
              <Alerta tom="info">Conecte a balança para testar a leitura.</Alerta>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
