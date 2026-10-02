"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { Alerta, Carregando } from "@/components/ui/feedback";
import { registrarAcessoMfa } from "./acoes-mfa";

export function CadastrarMfa({ proximo }: { proximo: string }) {
  const router = useRouter();
  const [fator, setFator] = useState<{ id: string; qr: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const supabase = criarClienteNavegador();
      const { data: lista } = await supabase.auth.mfa.listFactors();
      for (const f of lista?.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      if (lista?.totp.some((f) => f.status === "verified")) {
        router.replace("/mfa");
        return;
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Autenticador ${new Date().toLocaleDateString("pt-BR")}`,
        issuer: "Portal Guarese's ON",
      });
      if (cancelado) return;
      if (error || !data) setErro("Não foi possível iniciar o cadastro da verificação em duas etapas.");
      else setFator({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
    })();
    return () => {
      cancelado = true;
    };
  }, [router]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!fator) return;
    setOcupado(true);
    setErro(null);
    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator.id, code: codigo.replace(/\D/g, "") });
    if (error) {
      setErro("Código inválido. Confira se o aplicativo foi configurado com este QR Code.");
      setOcupado(false);
      return;
    }
    await registrarAcessoMfa("mfa_ativado");
    toast.success("Verificação em duas etapas ativada.");
    router.replace(proximo);
    router.refresh();
  }

  if (erro && !fator) return <Alerta tom="perigo">{erro}</Alerta>;
  if (!fator) return <Carregando texto="Preparando o QR Code..." />;

  return (
    <form onSubmit={confirmar} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
        <li>Leia o QR Code abaixo com o aplicativo.</li>
        <li>Digite o código de 6 dígitos exibido no aplicativo.</li>
      </ol>
      <div className="flex justify-center rounded-lg border border-border bg-white p-4">
        <img src={fator.qr} alt="QR Code para o aplicativo autenticador" className="size-48" />
      </div>
      <div className="rounded-md bg-muted p-3 text-xs">
        <p className="mb-1 text-muted-foreground">Não consegue ler o QR Code? Digite esta chave no aplicativo:</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 break-all font-mono text-foreground">{fator.segredo}</code>
          <Button
            variante="fantasma"
            tamanho="iconeSm"
            aria-label="Copiar chave"
            onClick={() => navigator.clipboard.writeText(fator.segredo).then(() => toast.success("Chave copiada."))}
          >
            <Copy />
          </Button>
        </div>
      </div>
      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
      <Campo rotulo="Código de 6 dígitos" htmlFor="codigo">
        <Input
          id="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="text-center text-lg tracking-[0.4em]"
          required
        />
      </Campo>
      <Button type="submit" className="w-full" disabled={ocupado || codigo.replace(/\D/g, "").length !== 6}>
        <ShieldCheck />
        {ocupado ? "Ativando..." : "Ativar verificação em duas etapas"}
      </Button>
    </form>
  );
}
