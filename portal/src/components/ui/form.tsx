import * as React from "react";
import { cn } from "@/lib/utils";

const baseCampo =
  "w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-perigo";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input ref={ref} type={type} className={cn(baseCampo, "h-10", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(baseCampo, "py-2 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(baseCampo, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function Checkbox({ className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      type="checkbox"
      className={cn("size-4 rounded border-input accent-[var(--primary)] focus-visible:outline-2 focus-visible:outline-ring", className)}
      {...props}
    />
  );
}

interface CampoProps {
  rotulo: React.ReactNode;
  htmlFor?: string;
  ajuda?: React.ReactNode;
  erro?: string | string[] | null;
  obrigatorio?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Campo de formulário com rótulo, ajuda e mensagem de erro acessível. */
export function Campo({ rotulo, htmlFor, ajuda, erro, obrigatorio, className, children }: CampoProps) {
  const mensagem = Array.isArray(erro) ? erro[0] : erro;
  const idAjuda = htmlFor ? `${htmlFor}-ajuda` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {rotulo}
        {obrigatorio ? (
          <span className="text-perigo" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children}
      {mensagem ? (
        <p id={idAjuda} role="alert" className="text-xs text-perigo">
          {mensagem}
        </p>
      ) : ajuda ? (
        <p id={idAjuda} className="text-xs text-muted-foreground">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
}
