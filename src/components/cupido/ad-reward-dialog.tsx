import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
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
import { isNativeAds, showRewardedAd } from "@/lib/admob";
import { AD_REWARD } from "@/lib/rewards";
import { claimAdReward } from "@/lib/rewards.functions";

export function AdRewardDialog({
  open,
  onOpenChange,
  onRewarded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRewarded?: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const started = useRef(false);
  const account = useAccount();
  const queryClient = useQueryClient();
  const claim = useServerFn(claimAdReward);
  const claimRef = useRef(claim);
  const accountRef = useRef(account);
  const queryClientRef = useRef(queryClient);
  const onRewardedRef = useRef(onRewarded);

  claimRef.current = claim;
  accountRef.current = account;
  queryClientRef.current = queryClient;
  onRewardedRef.current = onRewarded;

  useEffect(() => {
    if (!open) return;
    started.current = false;

    if (!isNativeAds()) {
      toast.info("Los anuncios en video están disponibles en la App Android oficial de Cupido Leudy ❤️.");
      onOpenChange(false);
      return;
    }

    if (started.current) return;
    started.current = true;
    setPlaying(true);

    const grant = async () => {
      try {
        const result = await claimRef.current();
        if (result.awarded !== AD_REWARD) throw new Error("Supabase no confirmó las 25 monedas del anuncio.");
        accountRef.current.addPurchasedCredits(result.awarded);
        toast.success(`Anuncio completado: +${result.awarded} monedas 🎬`);
        await queryClientRef.current.invalidateQueries({ queryKey: ["account"] });
        void accountRef.current.refresh();
        onRewardedRef.current?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo acreditar la recompensa.");
      }
    };

    void showRewardedAd(grant)
      .then((result) => {
        if (result === "dismissed") {
          toast.info("Anuncio cerrado antes de completarse. No se acreditaron monedas.");
        }
      })
      .finally(() => {
        setPlaying(false);
        started.current = false;
        onOpenChange(false);
      });
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-pink-400/30 bg-[#1b1020] text-white">
        <DialogHeader>
          <DialogTitle>Anuncio patrocinado</DialogTitle>
          <DialogDescription>Mira el anuncio completo y recibe +{AD_REWARD} monedas brillantes.</DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-pink-600/40 via-fuchsia-600/20 to-amber-500/20 p-8 text-center">
          <span className="rounded-full bg-black/30 px-3 py-1 text-[10px] uppercase tracking-widest text-white/70">
            Publicidad
          </span>
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-amber-100">
            {playing ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Reproduciendo anuncio de AdMob…
              </>
            ) : (
              <>
                <Play className="size-4 fill-current" /> Anuncio listo
              </>
            )}
          </p>
        </div>

        <p className="text-center text-[11px] text-white/60">Máximo 5 anuncios por día.</p>
      </DialogContent>
    </Dialog>
  );
}
