import { CoinIcon } from "@/components/cupido/coin-icon";
import { GIFTS, type Gift } from "@/lib/cupido";

type GiftGridProps = {
  gifts?: readonly Gift[];
  onSelect: (gift: Gift) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function GiftGrid({ gifts = GIFTS, onSelect, disabled = false, compact = false }: GiftGridProps) {
  return (
    <div className={`grid gap-2 overflow-y-auto pr-1 ${compact ? "max-h-72 grid-cols-3 sm:grid-cols-4" : "max-h-[26rem] grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"}`}>
      {gifts.map((gift) => (
        <button
          key={gift.id}
          type="button"
          onClick={() => onSelect(gift)}
          disabled={disabled}
          title={`${gift.name} · ${gift.credits.toLocaleString("es")} monedas brillantes · US$${gift.cash.toFixed(2)} retirables`}
          className="rounded-2xl border border-white/10 bg-black/20 p-2.5 text-center transition hover:border-amber-300/60 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="block text-2xl">{gift.emoji}</span>
          <span className="mt-1 block truncate text-xs font-medium text-white">{gift.name}</span>
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
