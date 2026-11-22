import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const BRIGHT_EMOJIS = ["💖", "✨", "💘", "🔥", "👑", "🌟", "💕", "💎", "🦋", "💫"] as const;

export function serializeEmojiOverlay(emojis: readonly string[]): string {
  return JSON.stringify([...new Set(emojis)].slice(0, 4));
}

export function parseEmojiOverlay(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((emoji): emoji is string => typeof emoji === "string").slice(0, 4);
  } catch {
    return Array.from(value).slice(0, 4);
  }
  return [];
}

export function EmojiOverlayPicker({ value, onChange, disabled = false }: { value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const toggle = (emoji: string) => {
    onChange(value.includes(emoji) ? value.filter((item) => item !== emoji) : [...value, emoji].slice(-4));
  };

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-100"><Sparkles className="size-3.5" /> Emojis brillantes</p>
      <div className="flex flex-wrap gap-1.5">
        {BRIGHT_EMOJIS.map((emoji) => (
          <Button key={emoji} type="button" size="icon" variant={value.includes(emoji) ? "default" : "outline"} aria-pressed={value.includes(emoji)} aria-label={`${value.includes(emoji) ? "Quitar" : "Agregar"} ${emoji}`} disabled={disabled} onClick={() => toggle(emoji)} className={`size-9 text-lg ${value.includes(emoji) ? "drop-shadow-[0_0_10px_rgba(255,190,70,0.85)]" : ""}`}>
            {emoji}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Elige hasta 4; aparecerán sobre el contenido al reproducirlo.</p>
    </div>
  );
}

export function GlowingEmojiOverlay({ emojis, className = "" }: { emojis: readonly string[]; className?: string }) {
  if (!emojis.length) return null;
  return (
    <div className={`pointer-events-none absolute inset-0 z-10 flex flex-wrap items-center justify-center gap-3 overflow-hidden ${className}`} aria-hidden="true">
      {emojis.map((emoji, index) => (
        <span key={`${emoji}-${index}`} className="animate-bounce text-5xl drop-shadow-[0_0_10px_rgba(255,70,190,0.95)] [filter:drop-shadow(0_0_18px_rgba(255,215,0,0.9))] sm:text-6xl" style={{ animationDelay: `${index * 140}ms` }}>{emoji}</span>
      ))}
    </div>
  );
}
