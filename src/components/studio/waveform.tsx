import { useEffect, useState } from "react";
import { computePeaks, decodeAudio } from "@/lib/audio";
import { cn } from "@/lib/utils";

const BARS = 96;

type Props = {
  blob: Blob | null;
  progress: number; // 0..1
  onSeek?: (ratio: number) => void;
  disabled?: boolean;
  className?: string;
};

export function Waveform({ blob, progress, onSeek, disabled, className }: Props) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    if (!blob) return;
    decodeAudio(blob)
      .then((buf) => !cancelled && setPeaks(computePeaks(buf, BARS)))
      .catch(() => !cancelled && setPeaks(null));
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const bars = peaks ?? Array.from({ length: BARS }, (_, i) => 0.12 + 0.08 * Math.sin(i / 3) ** 2);

  return (
    <div
      role="slider"
      aria-label="Progreso de la canción"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={disabled ? -1 : 0}
      className={cn("flex h-20 w-full cursor-pointer items-center gap-[2px]", disabled && "pointer-events-none opacity-50", className)}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek?.(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") onSeek?.(Math.min(1, progress + 0.05));
        if (e.key === "ArrowLeft") onSeek?.(Math.max(0, progress - 0.05));
      }}
    >
      {bars.map((h, i) => {
        const played = i / bars.length < progress;
        return (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-full transition-colors",
              played ? "bg-gradient-primary" : "bg-muted-foreground/25",
              !peaks && blob && "animate-pulse",
            )}
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
