import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type PayPalCheckoutScreenProps = {
  open: boolean;
  onBack: () => void;
  children: ReactNode;
};

export function PayPalCheckoutScreen({ open, onBack, children }: PayPalCheckoutScreenProps) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Pago seguro con PayPal"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="fixed inset-0 z-[12000] h-[100dvh] w-screen overflow-x-hidden overflow-y-auto overscroll-contain bg-white text-zinc-900 [touch-action:pan-y]"
    >
      <header className="sticky top-0 z-10 shrink-0 border-b border-zinc-200 bg-white/95 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
          <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold sm:text-base">
            <ShieldCheck className="size-5 shrink-0 text-emerald-600" />
            <span className="truncate">Pago seguro con PayPal</span>
          </h1>
          <Button type="button" variant="outline" onClick={onBack} className="h-10 shrink-0 gap-1.5 rounded-xl border-zinc-300 px-3 text-xs text-zinc-800 sm:text-sm">
            <ArrowLeft className="size-4" /> Cancelar / Volver
          </Button>
        </div>
      </header>
      <main className="w-full overflow-x-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 [touch-action:pan-y]">
        <div className="mx-auto w-full max-w-lg pb-4">{children}</div>
      </main>
    </section>,
    document.body,
  );
}
