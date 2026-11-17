import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props<T extends string | number> = {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  variant?: "chips" | "segmented";
  className?: string;
};

export function OptionGroup<T extends string | number>({ label, options, value, onChange, variant = "chips", className }: Props<T>) {
  return (
    <fieldset className={className}>
      <legend className="mb-3 font-display text-sm">{label}</legend>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          variant === "chips" ? "flex flex-wrap gap-2" : "grid gap-1.5 rounded-2xl border border-border bg-surface/80 p-1.5",
        )}
        style={variant === "segmented" ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
      >
        {options.map((o) => (
          <Button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            data-active={value === o.value}
            variant="chip"
            size={variant === "chips" ? "pill" : "default"}
            className={variant === "segmented" ? "h-11 whitespace-normal rounded-xl border-transparent bg-transparent px-2 text-xs sm:text-sm" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
