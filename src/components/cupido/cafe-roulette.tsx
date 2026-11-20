import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Coins, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { ROULETTE_PRIZES, claimAdReward, spinCafeRoulette } from "@/lib/rewards.functions";

const SEGMENT_COLORS = ["bg-pink-500/20", "bg-violet-500/20", "bg-amber-500/20", "bg-rose-500/20"];

export function CafeRoulette() {
  const account = useAccount();
  const spinFn = useServerFn(spinCafeRoulette);
  const adFn = useServerFn(claimAdReward);
  const queryClient = useQueryClient();
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);

  const spin = useMutation({
    mutationFn: () => spinFn(),
    onMutate: () => setSpinning(true),
    onSuccess: (result) => {
      const target = ((360 - result.index * (360 / ROULETTE_PRIZES.length)) % 360 + 360) % 360;
      setRotation((current) => current + 360 * 5 + (((target - (current % 360)) % 360) + 360) % 360);
      window.setTimeout(() => {
        setSpinning(false);
        toast[result.awarded ? "success" : "info"](
          result.awarded ? `La ruleta Café te dio +${result.awarded} monedas ✨` : "Hoy no hubo premio, vuelve en una hora ❤️",
        );
        account.refresh();
        void queryClient.invalidateQueries({ queryKey: ["account"] });
      }, 2600);
    },
    onError: (error) => {
      setSpinning(false);
      toast.error(error instanceof Error ? error.message : "No se pudo girar la ruleta.");
    },
  });

  const ad = useMutation({
    mutationFn: () => adFn(),
    onSuccess: (result) => {
      toast.success(`Anuncio completado: +${result.awarded} monedas 🎬`);
      account.refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo completar el anuncio."),
  });

  return (
    <section className="rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-pink-200" />
        <p className="text-sm font-medium text-white">Ruleta Café de Cupido Leudy</p>
      </div>
      <p className="mt-1 text-xs text-pink-100/70">Gira gratis cada hora. Premios en monedas brillantes para tus vídeos y regalos.</p>

      <div className="relative mx-auto mt-4 size-44">
        <div
          className="size-full rounded-full border-4 border-amber-200/70 shadow-[0_0_30px_rgba(236,72,153,0.35)] transition-transform duration-[2500ms] ease-out"
          style={{ transform: `rotate(${rotation}deg)`, background: "conic-gradient(#ec4899 0 45deg,#8b5cf6 45deg 90deg,#f59e0b 90deg 135deg,#f43f5e 135deg 180deg,#ec4899 180deg 225deg,#8b5cf6 225deg 270deg,#f59e0b 270deg 315deg,#f43f5e 315deg 360deg)" }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid size-16 place-items-center rounded-full border-4 border-background bg-background/95 font-display text-lg text-white">☕</div>
        </div>
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-lg text-amber-200">▼</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="flex-1 gap-2" disabled={spinning || spin.isPending} onClick={() => spin.mutate()}>
          <Sparkles className="size-4" /> {spinning ? "Girando…" : "Girar ruleta gratis"}
        </Button>
        <Button variant="secondary" className="gap-2" disabled={ad.isPending} onClick={() => ad.mutate()}>
          {ad.isPending ? <Coins className="size-4 animate-pulse" /> : <Play className="size-4" />} Ver anuncio +25
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
        {ROULETTE_PRIZES.map((prize, index) => (
          <span key={index} className={`rounded-full px-2 py-1 ${SEGMENT_COLORS[index % SEGMENT_COLORS.length]}`}>
            {prize ? `+${prize}` : "Suerte"}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-amber-100/70">
        Con tus monedas desbloqueas 1 vídeo gratis y el regalo especial de la dueña ☕❤️
      </p>
    </section>
  );
}
