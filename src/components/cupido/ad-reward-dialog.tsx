import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccount } from "@/lib/account";
import { AD_REWARD } from "@/lib/rewards";
import { claimAdReward } from "@/lib/rewards.functions";

type RewardedListener = { remove: () => void };
type RewardedPlugin = {
  setOptions?: (options: Record<string, unknown>) => void | Promise<void>;
  prepare?: () => void | Promise<void>;
  show?: () => void | Promise<void>;
  addListener?: (event: string, callback: () => void) => RewardedListener | Promise<RewardedListener>;
};

function rewardedPlugin(): RewardedPlugin | null {
  if (typeof window === "undefined") return null;
  const bridge = window as unknown as {
    Capacitor?: { isNative?: boolean; Plugins?: { AdMobRewarded?: RewardedPlugin } };
    AdMobRewarded?: RewardedPlugin;
  };
  return bridge.Capacitor?.Plugins?.AdMobRewarded ?? bridge.AdMobRewarded ?? null;
}

export function AdRewardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [seconds, setSeconds] = useState(15);
  const [nativeAd, setNativeAd] = useState(false);
  const claimed = useRef(false);
  const account = useAccount();
  const queryClient = useQueryClient();
  const claim = useServerFn(claimAdReward);

  const mutation = useMutation({
    mutationFn: () => claim(),
    onSuccess: (result) => {
      toast.success(`Anuncio completado: +${result.awarded} monedas 🎬`);
      void queryClient.invalidateQueries({ queryKey: ["account"] });
      account.refresh();
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "No se pudo completar el anuncio.");
      claimed.current = false;
      onOpenChange(false);
    },
  });

  const finishAd = () => {
    if (claimed.current) return;
    claimed.current = true;
    mutation.mutate();
  };

  useEffect(() => {
    if (!open) return;
    setSeconds(15);
    claimed.current = false;

    const plugin = rewardedPlugin();
    if (plugin && (plugin.show || plugin.prepare)) {
      setNativeAd(true);
      let cancelled = false;
      let listener: RewardedListener | undefined;

      const startNativeAd = async () => {
        try {
          const adUnitId = import.meta.env["VITE_ADMOB_REWARDED_ID"];
          if (adUnitId && plugin.setOptions) await plugin.setOptions({ adUnitId });
          if (plugin.addListener) {
            const registered = plugin.addListener("rewarded", () => {
              if (!cancelled) finishAd();
            });
            listener = registered instanceof Promise ? await registered : registered;
          }
          if (plugin.prepare) await plugin.prepare();
          if (plugin.show) await plugin.show();
        } catch {
          if (!cancelled) {
            toast.error("No se pudo cargar el anuncio de AdMob.");
            onOpenChange(false);
          }
        }
      };
      void startNativeAd();

      return () => {
        cancelled = true;
        listener?.remove();
      };
    }

    setNativeAd(false);
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || nativeAd || seconds > 0 || claimed.current) return;
    finishAd();
  }, [open, nativeAd, seconds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-pink-400/30 bg-[#1b1020] text-white">
        <DialogHeader>
          <DialogTitle>Anuncio patrocinado</DialogTitle>
          <DialogDescription>
            Mira el anuncio completo y recibe +{AD_REWARD} monedas brillantes.
          </DialogDescription>
        </DialogHeader>

        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-pink-600/40 via-fuchsia-600/20 to-amber-500/20 p-8 text-center">
          <span className="rounded-full bg-black/30 px-3 py-1 text-[10px] uppercase tracking-widest text-white/70">
            Publicidad
          </span>
          <p className="mt-6 font-display text-2xl text-white">Cupido Leudy ❤️</p>
          <p className="mt-1 text-xs text-pink-100/80">Conecta con personas reales</p>

          {nativeAd ? (
            <p className="mt-6 flex items-center justify-center gap-2 text-sm text-amber-100">
              <Loader2 className="size-4 animate-spin" /> Reproduciendo anuncio de AdMob…
            </p>
          ) : (
            <>
              <p className="mt-6 font-display text-5xl text-amber-200">{seconds}s</p>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pink-500 to-amber-400 transition-all duration-1000 ease-linear"
                  style={{ width: `${((15 - seconds) / 15) * 100}%` }}
                />
              </div>
            </>
          )}
        </div>

        {nativeAd && (
          <Button variant="secondary" className="gap-2" onClick={finishAd} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Ya vi el anuncio · +{AD_REWARD}
          </Button>
        )}
        <p className="text-center text-[11px] text-white/60">Máximo 5 anuncios por día.</p>
      </DialogContent>
    </Dialog>
  );
}
