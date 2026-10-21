/** Cada tela pública (entrar, recuperar senha...) entra suavemente. */
export default function TemplatePublico({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full justify-center animar-entrada">{children}</div>;
}
