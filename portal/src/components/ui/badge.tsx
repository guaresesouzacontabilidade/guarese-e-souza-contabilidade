import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const variantesBadge = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variante: {
        neutro: "border-border bg-muted text-muted-foreground",
        primario: "border-transparent bg-secondary text-secondary-foreground",
        sucesso: "border-transparent bg-sucesso-bg text-sucesso-fg",
        alerta: "border-transparent bg-alerta-bg text-alerta-fg",
        perigo: "border-transparent bg-perigo-bg text-perigo-fg",
        info: "border-transparent bg-info-bg text-info-fg",
        contorno: "border-border bg-transparent text-foreground",
      },
    },
    defaultVariants: { variante: "neutro" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof variantesBadge> {}

export function Badge({ className, variante, ...props }: BadgeProps) {
  return <span className={cn(variantesBadge({ variante }), className)} {...props} />;
}
