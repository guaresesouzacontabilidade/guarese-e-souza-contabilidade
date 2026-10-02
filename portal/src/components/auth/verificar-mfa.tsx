"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { registrarAcessoMfa } from "./acoes-mfa";

export function VerificarMfa({ proximo }: { proximo: string }) {
  const router = useRouter();
  const [fatorId, setFatorId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const supabase = criarClienteNavegador();
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) {
        setErro("Não foi possível carregar a verificação. Entre novamente.");
        return;
      }
      const fator = data?.totp.find((f) => f.status === "verified");
      if (!fator) router.replace("/mfa/cadastrar");
      else setFatorId(fator.id);
    });
  }, [router]);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    if (!fatorId) return;
    setOcupado(true);
    setErro(null);
    const supabase = criarClienteNavegador();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.replace(/\D/g, "") });
    if (error) {
      setErro("Código inválido ou expirado. Confira o horário do celular e tente novamente.");
      setOcupado(false);
      return;
    }
    await registrarAcessoMfa();
    router.replace(proximo);
    router.refresh();
  }

  return (
    <div className="space-y-4">
    <form onSubmit={verificar} className="space-y-4">
      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
      <Campo rotulo="Código de 6 dígitos" htmlFor="codigo" ajuda="Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy etc.).">
        <Input
          id="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="text-center text-lg tracking-[0.4em]"
          autoFocus
          required
        />
      </Campo>
      <Button type="submit" className="w-full" disabled={ocupado || !fatorId || codigo.replace(/\D/g, "").length !== 6}>
        <ShieldCheck />
        {ocupado ? "Verificando..." : "Verificar"}
      </Button>
    </form>
    <form action="/auth/sair" method="post" className="text-center">
      <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Sair e entrar com outra conta
      </button>
    </form>
    </div>
  );
}
