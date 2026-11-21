import { useEffect, useRef, useState } from "react";
import { Coffee, Play, Sparkles } from "lucide-react";
import { AdRewardDialog } from "@/components/cupido/ad-reward-dialog";
import { Button } from "@/components/ui/button";

export function CafeRoulette() {
  const [adOpen, setAdOpen] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    setRotation((value) => value + 360 * 5 + 120);
    timer.current = window.setTimeout(() => {
      setSpinning(false);
      timer.current = null;
    }, 1400);
  };

  return (
    <section className="rounded-3xl border border-amber-300/25 bg-amber-400/[0.06] p-5">
      <div className="flex items-center gap-2">
        <Coffee className="size-4 text-amber-200" />
        <p className="font-display text-lg text-white">Ruleta Café</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Gira por diversión o desbloquea un giro extra con un anuncio.</p>

      <div className="mt-5 flex justify-center">
        <div
          className="grid h-40 w-40 place-items-center rounded-full border-8 border-white/15 shadow-[0_0_40px_rgba(251,191,36,0.18)]"
          style={{
            background:
              "conic-gradient(#f472b6 0deg 60deg, #fbbf24 60deg 120deg, #a855f7 120deg 180deg, #f472b6 180deg 240deg, #fbbf24 240deg 300deg, #a855f7 300deg 360deg)",
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? "transform 1.4s cubic-bezier(0.2, 0.8, 0.2, 1)" : "none",
          }}
        >
          <span className="grid h-16 w-16 place-items-center rounded-full border-4 border-amber-200/40 bg-[#1b1020] text-amber-100">
            <Coffee className="size-6" />
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" disabled={spinning} onClick={spin} className="gap-2">
          <Sparkles className="size-4" /> Girar ruleta
        </Button>
        <Button variant="outline" className="gap-2 border-amber-200/25" onClick={() => setAdOpen(true)}>
          <Play className="size-4 fill-current" /> Ver anuncio (+25 monedas gratis)
        </Button>
      </div>

      <p className="mt-3 text-center text-[11px] text-white/60">
        Giro extra: completa el anuncio y gana +25 monedas brillantes.
      </p>
      <AdRewardDialog open={adOpen} onOpenChange={setAdOpen} onRewarded={spin} />
    </section>
  );
}
