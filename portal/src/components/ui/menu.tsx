"use client";

import * as React from "react";
import { DropdownMenu as M, Tooltip as T, Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuGatilho = M.Trigger;

export function MenuConteudo({ className, align = "end", ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-card p-1 text-sm shadow-lg", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function MenuRotulo({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn("px-2.5 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...props} />;
}

export function MenuSeparador() {
  return <M.Separator className="my-1 h-px bg-border" />;
}

export function Dica({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <T.Provider delayDuration={300}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={4} className="z-50 max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow">
            {texto}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}

export const Popover = P.Root;
export const PopoverGatilho = P.Trigger;
export function PopoverConteudo({ className, align = "end", ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card p-0 shadow-lg", className)}
        {...props}
      />
    </P.Portal>
  );
}
