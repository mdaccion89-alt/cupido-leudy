import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AdRewardDialog } from "@/components/cupido/ad-reward-dialog";
import { Button } from "@/components/ui/button";
import { useAccount } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { HOUR_MS, ROULETTE_PRIZES, formatCountdown } from "@/lib/rewards";
import { spinCafeRoulette } from "@/lib/rewards.functions";

const SEGMENT_COLORS = ["bg-pink-500/20", "bg-violet-500/20", "bg-amber-500/20", "bg-rose-500/20"];
const SEGMENT_SIZE = 360 / ROULETTE_PRIZES.length;

export function CafeRoulette() {
  const account = useAccount();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [wheelAngle, setWheelAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [adOpen, setAdOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const spinRoulette = useServerFn(spinCafeRoulette);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const spin = async () => {
    if (!session?.user.id) {
      toast.error("Inicia sesión para girar la ruleta.");
      return;
    }
    setSpinning(true);
    try {
      const result = await spinRoulette();
      const index = Math.max(0, Math.min(ROULETTE_PRIZES.length - 1, result.index));
      const target = (((360 - (index + 0.5) * SEGMENT_SIZE) % 360) + 360) % 360;
      const baseAngle = wheelAngle - (wheelAngle % 360);
      setWheelAngle(baseAngle + 360 * 5 + target);
      toast[result.awarded ? "success" : "info"](
        result.awarded
          ? `La ruleta Café te dio +${result.awarded} monedas ✨`
          : "Suerte esta vez, vuelve en una hora ❤️",
      );
      void queryClient.invalidateQueries({ queryKey: ["account"] });
      account.refresh();
      setNow(Date.now());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo girar la ruleta.");
    } finally {
      setSpinning(false);
    }
  };

  const lastSpin = account.lastWheelSpin ? Date.parse(account.lastWheelSpin) : 0;
  const waitingMs = Math.max(0, lastSpin + HOUR_MS - now);
  const onCooldown = waitingMs > 0;
  const busy = spinning;

  return (
    <section className="rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-pink-200" />
        <p className="text-sm font-medium text-white">Ruleta Café de Cupido Leudy</p>
      </div>
      <p className="mt-1 text-xs text-pink-100/70">Gira gratis cada hora. Premios en monedas brillantes para tus vídeos y regalos.</p>

      <div className="relative mx-auto mt-4 size-44">
        <div
          className="size-full rounded-full border-4 border-amber-200/70 shadow-[0_0_30px_rgba(236,72,153,0.35)]"
          style={{
            transform: `rotate(${wheelAngle}deg)`,
            transition: "transform 3.5s cubic-bezier(0.17, 0.67, 0.12, 0.99)",
            background:
              "conic-gradient(#ec4899 0 45deg,#8b5cf6 45deg 90deg,#f59e0b 90deg 135deg,#f43f5e 135deg 180deg,#ec4899 180deg 225deg,#8b5cf6 225deg 270deg,#f59e0b 270deg 315deg,#f43f5e 315deg 360deg)",
          }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid size-16 place-items-center rounded-full border-4 border-background bg-background/95 font-display text-lg text-white">☕</div>
        </div>
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-lg text-amber-200">▼</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="flex-1 gap-2" disabled={busy || onCooldown} onClick={() => void spin()}>
          <Sparkles className="size-4" />
          {busy ? "Girando…" : onCooldown ? `Gira de nuevo en ${formatCountdown(waitingMs)}` : "Girar ruleta gratis"}
        </Button>
        <Button variant="secondary" className="gap-2" onClick={() => setAdOpen(true)}>
          <Play className="size-4" /> Ver anuncio +25
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
      <AdRewardDialog open={adOpen} onOpenChange={setAdOpen} />
    </section>
  );
}
