import Link from "next/link";
import { Logo } from "@/components/marca/logo";
import { Button } from "@/components/ui/button";

/** Endereço inexistente (fora da área logada). */
export default function NaoEncontrada() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-muted/60 px-4 text-center">
      <Logo className="h-12" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-titulo">Página não encontrada</h1>
        <p className="text-sm text-muted-foreground">O endereço pode ter sido digitado errado ou a página não existe mais.</p>
      </div>
      <Button asChild>
        <Link href="/">Ir para o início</Link>
      </Button>
    </main>
  );
}
