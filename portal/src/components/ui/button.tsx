import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const variantesBotao = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variante: {
        primario: "bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm",
        secundario: "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        contorno: "border border-input bg-card hover:bg-muted text-foreground",
        fantasma: "hover:bg-muted text-foreground",
        perigo: "bg-perigo text-white hover:opacity-90 dark:text-[#1b120d]",
        sucesso: "bg-sucesso text-white hover:opacity-90 dark:text-[#0b1d10]",
        link: "text-primary underline-offset-4 hover:underline px-0",
      },
      tamanho: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icone: "h-10 w-10",
        iconeSm: "h-8 w-8",
      },
    },
    defaultVariants: { variante: "primario", tamanho: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variantesBotao> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variante, tamanho, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(variantesBotao({ variante, tamanho }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
