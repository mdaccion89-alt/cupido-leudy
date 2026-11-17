import { cn } from "@/lib/utils";

export function Equalizer({ bars = 5, active = true, className }: { bars?: number; active?: boolean; className?: string }) {
  return (
    <div className={cn("flex h-5 items-end gap-[3px]", className)} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn("h-full w-[3px] origin-bottom rounded-full bg-gradient-primary", active ? "animate-eq" : "scale-y-[0.3]")}
          style={{ animationDelay: `${(i * 0.13) % 0.9}s` }}
        />
      ))}
    </div>
  );
}
