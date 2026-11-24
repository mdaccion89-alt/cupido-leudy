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
import { supabase } from "@/integrations/supabase/client";
import { areAdsEnabled, isNativeAds, showRewardedAd } from "@/lib/admob";
import { AD_LIMIT, AD_REWARD } from "@/lib/rewards";
import {
  cancelAdRewardSession,
  getAdRewardStatus,
  startAdRewardSession,
} from "@/lib/rewards.functions";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "No se pudo completar el anuncio. Inténtalo de nuevo.";
}

const wait = (duration: number) => new Promise<void>((resolve) => window.setTimeout(resolve, duration));

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
  const start = useServerFn(startAdRewardSession);
  const cancel = useServerFn(cancelAdRewardSession);
  const readStatus = useServerFn(getAdRewardStatus);
  const startRef = useRef(start);
  const cancelRef = useRef(cancel);
  const readStatusRef = useRef(readStatus);
  const accountRef = useRef(account);
  const queryClientRef = useRef(queryClient);
  const onRewardedRef = useRef(onRewarded);

  startRef.current = start;
  cancelRef.current = cancel;
  readStatusRef.current = readStatus;
  accountRef.current = account;
  queryClientRef.current = queryClient;
  onRewardedRef.current = onRewarded;

  useEffect(() => {
    if (!account.userId) return;
    const channel = supabase
      .channel(`cupido-ad-reward-balance-${account.userId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${account.userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["account", account.userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_credits", filter: `user_id=eq.${account.userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["account", account.userId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [account.userId, queryClient]);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;

    if (!isNativeAds()) {
      toast.info("Los videos recompensados están disponibles en la app Android oficial de Cupido Leudy ❤️.");
      started.current = false;
      onOpenChange(false);
      return;
    }
    if (!areAdsEnabled()) {
      toast.info("Los anuncios están pausados en este momento.");
      started.current = false;
      onOpenChange(false);
      return;
    }
    if (!accountRef.current.userId) {
      toast.info("Inicia sesión para recibir monedas por ver anuncios.");
      started.current = false;
      onOpenChange(false);
      return;
    }

    let active = true;
    setPlaying(true);
    const run = async () => {
      let sessionId: string | null = null;
      try {
        const session = await startRef.current();
        sessionId = session.sessionId;
        const result = await showRewardedAd(accountRef.current.userId!, sessionId);
        if (result === "unavailable") {
          await cancelRef.current({ data: { sessionId } });
          toast.error("No se pudo cargar el anuncio. Comprueba tu conexión e inténtalo de nuevo.");
          return;
        }
        if (result === "dismissed") {
          await cancelRef.current({ data: { sessionId } });
          toast.info("Anuncio cerrado antes de completarse. No se acreditaron monedas.");
          return;
        }

        for (let attempt = 0; attempt < 24; attempt += 1) {
          const status = await readStatusRef.current({ data: { sessionId } });
          if (status.status === "confirmed" && status.awarded === AD_REWARD) {
            await accountRef.current.refresh();
            await queryClientRef.current.invalidateQueries({ queryKey: ["account", accountRef.current.userId] });
            toast.success(`Recompensa confirmada por Google: +${AD_REWARD} monedas para regalos.`);
            onRewardedRef.current?.();
            return;
          }
          if (status.status === "cancelled") throw new Error("La sesión del anuncio se cerró antes de confirmar el premio.");
          await wait(2_000);
        }

        await accountRef.current.refresh();
        toast.info("Google está verificando el anuncio. Las monedas se acreditarán automáticamente al confirmarse.");
      } catch (error) {
        toast.error(messageOf(error));
      } finally {
        if (active) {
          setPlaying(false);
          started.current = false;
          onOpenChange(false);
        }
      }
    };

    void run();
    return () => { active = false; };
  }, [open, onOpenChange]);

  const handleOpenChange = (next: boolean) => {
    if (playing && !next) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm border-pink-400/30 bg-[#1b1020] text-white">
        <DialogHeader>
          <DialogTitle>Anuncio patrocinado</DialogTitle>
          <DialogDescription>Mira el video completo. Google confirma la recompensa de +{AD_REWARD} monedas para regalos.</DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-pink-600/40 via-fuchsia-600/20 to-amber-500/20 p-8 text-center">
          <span className="rounded-full bg-black/30 px-3 py-1 text-[10px] uppercase tracking-widest text-white/70">Publicidad</span>
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-amber-100">
            {playing ? <><Loader2 className="size-4 animate-spin" /> Reproduciendo anuncio de AdMob…</> : <><Play className="size-4 fill-current" /> Anuncio listo</>}
          </p>
        </div>

        <p className="text-center text-[11px] text-white/60">Máximo {AD_LIMIT} anuncios recompensados por día. Estas monedas no aumentan el saldo retirable.</p>
        <Button type="button" variant="outline" disabled={playing} onClick={() => handleOpenChange(false)}>Cerrar</Button>
      </DialogContent>
    </Dialog>
  );
}
