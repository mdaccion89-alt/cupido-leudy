import { CoinIcon } from "@/components/cupido/coin-icon";
import { useGiftCatalog } from "@/lib/gift-catalog";
import type { Gift } from "@/lib/cupido";

type GiftGridProps = {
  gifts?: readonly Gift[];
  onSelect: (gift: Gift) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function GiftGrid({ gifts, onSelect, disabled = false, compact = false }: GiftGridProps) {
  const cachedCatalog = useGiftCatalog();
  const visibleGifts = gifts ?? cachedCatalog;
  return (
    <div className={`grid min-h-0 content-start gap-2 overflow-y-auto overscroll-contain pr-1 [touch-action:pan-y] ${compact ? "max-h-[56dvh] grid-cols-3 sm:max-h-72 sm:grid-cols-4" : "max-h-[56dvh] grid-cols-2 sm:max-h-[26rem] sm:grid-cols-4 lg:grid-cols-6"}`}>
      {visibleGifts.map((gift) => (
        <button
          key={gift.id}
          type="button"
          onClick={() => onSelect(gift)}
          disabled={disabled}
          title={`${gift.name} · ${gift.credits.toLocaleString("es")} monedas brillantes · US$${gift.cash.toFixed(2)} retirables`}
          className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/20 p-2.5 text-center transition hover:border-amber-300/60 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true" className={`mx-auto flex size-12 items-center justify-center rounded-xl bg-white/[0.04] text-3xl drop-shadow-[0_1px_5px_rgba(255,255,255,0.3)] ${gift.id === "gran-liga-diamond" ? "border border-amber-200/50 text-4xl drop-shadow-[0_0_14px_rgba(251,191,36,0.9)]" : ""}`}>
            {gift.emoji}
          </span>
          <span className="mt-1 block break-words text-xs font-medium leading-tight text-white">{gift.name}</span>
          <span className="mt-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-amber-200">
            <CoinIcon className="size-3.5" />
            {gift.credits.toLocaleString("es")}
          </span>
          <span className="block text-[10px] text-muted-foreground">US${gift.cash.toFixed(2)}</span>
        </button>
      ))}
    </div>
  );
}
