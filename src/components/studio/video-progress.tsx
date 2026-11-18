import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function VideoProgress({
  startedAt,
  progress,
  estimatedSeconds,
  stage,
  active,
  className,
}: {
  startedAt: number;
  progress: number;
  estimatedSeconds: number;
  stage: string;
  active: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active, startedAt]);

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const bounded = Math.max(0, Math.min(progress, active ? 0.99 : 1));
  const percent = Math.round(bounded * 100);
  const remaining =
    bounded > 0.02
      ? Math.max(0, (elapsed * (1 - bounded)) / bounded)
      : Math.max(0, estimatedSeconds - elapsed);

  return (
    <div className={cn("space-y-2 rounded-xl border border-border bg-surface/70 p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-display">{stage}</span>
        <span className="tabular-nums text-primary">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-raised">
        <div
          className="h-full rounded-full bg-gradient-primary transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">Transcurrido {formatClock(elapsed)}</span>
        <span className="tabular-nums">
          {active ? `Quedan aprox. ${formatClock(remaining)}` : "Proceso finalizado"}
        </span>
      </div>
    </div>
  );
}
