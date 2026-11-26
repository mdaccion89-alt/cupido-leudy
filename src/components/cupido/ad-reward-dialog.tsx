import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useAccount } from "@/lib/account";
import { supabase } from "@/integrations/supabase/client";
import { areAdsEnabled, isNativeAds, showRewardedAd } from "@/lib/admob";
import { AD_LIMIT, AD_REWARD } from "@/lib/rewards";
import {
  cancelAdRewardSession,
  claimAdReward,
  getAdRewardStatus,
  startAdRewardSession,
} from "@/lib/rewards.functions";

type Phase = "idle" | "native" | "fallback" | "done";

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [remaining, setRemaining] = useState(AD_LIMIT);
  const [error, setError] = useState<string | null>(null);
  const account = useAccount();
  const queryClient = useQueryClient();
  const start = useServerFn(startAdRewardSession);
  const cancel = useServerFn(cancelAdRewardSession);
  const claim = useServerFn(claimAdReward);
  const readStatus = useServerFn(getAdRewardStatus);
  const startRef = useRef(start);
  const cancelRef = useRef(cancel);
  const claimRef = useRef(claim);
  const readStatusRef = useRef(readStatus);
  const accountRef = useRef(account);
  const queryClientRef = useRef(queryClient);
  const onRewardedRef = useRef(onRewarded);
  const sessionRef = useRef<string | null>(null);
  const claimKeyRef = useRef("");
  const claimedRef = useRef(false);
  const startedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  startRef.current = start;
  cancelRef.current = cancel;
  claimRef.current = claim;
  readStatusRef.current = readStatus;
  accountRef.current = account;
  queryClientRef.current = queryClient;
  onRewardedRef.current = onRewarded;

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  };

  const refreshBalance = async (userId: string) => {
    await Promise.allSettled([
      accountRef.current.refresh(),
      queryClientRef.current.invalidateQueries({ queryKey: ["account", userId] }),
      queryClientRef.current.invalidateQueries({ queryKey: ["cupido-wallet", userId] }),
    ]);
  };

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
    if (!open || startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setProgress(0);
    setPhase("native");
    let active = true;

    const claimSession = async (sessionId: string) => {
      claimedRef.current = true;
      const claimKey = claimKeyRef.current || crypto.randomUUID();
      const userId = accountRef.current.userId!;
      try {
        const result = await claimRef.current({ data: { sessionId, claimKey } });
        if (!active) return;
        setRemaining(result.remaining);
        setPhase("done");
        await refreshBalance(userId);
        if (result.awarded > 0) {
          toast.success(`Recompensa confirmada: +${result.awarded} monedas para regalos.`);
        } else {
          toast.success("Tu recompensa ya estaba confirmada. Tus monedas están disponibles.");
        }
        onRewardedRef.current?.();
        const timer = window.setTimeout(() => { if (active) onOpenChange(false); }, 700);
        timersRef.current.push(timer);
      } catch (creditError) {
        claimedRef.current = false;
        if (!active) return;
        let ssvConfirmed = false;
        try {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const status = await readStatusRef.current({ data: { sessionId } });
            if (status.status === "confirmed" && status.awarded > 0) {
              ssvConfirmed = true;
              break;
            }
            await wait(1_000);
          }
        } catch {
          ssvConfirmed = false;
        }
        if (ssvConfirmed) {
          setPhase("done");
          await refreshBalance(userId);
          toast.success("Recompensa confirmada por Google. Tus monedas ya están disponibles.");
          onRewardedRef.current?.();
          return;
        }
        const message = messageOf(creditError);
        setError(message);
        setPhase("done");
        toast.error(message);
      }
    };

    const runFallback = async (sessionId: string) => {
      if (!active) return;
      setPhase("fallback");
      setProgress(0);
      const startAt = Date.now();
      await new Promise<void>((resolve) => {
        const tick = window.setInterval(() => {
          if (!active) {
            window.clearInterval(tick);
            resolve();
            return;
          }
          const next = Math.min(100, ((Date.now() - startAt) / 5_000) * 100);
          setProgress(next);
          if (next >= 100) {
            window.clearInterval(tick);
            resolve();
          }
        }, 80);
        timersRef.current.push(tick);
      });
      if (active) await claimSession(sessionId);
    };

    const run = async () => {
      let sessionId: string | null = null;
      try {
        if (!areAdsEnabled()) {
          throw new Error("Los anuncios están pausados en este momento.");
        }
        const userId = accountRef.current.userId;
        if (!userId) {
          throw new Error("Inicia sesión para recibir monedas por ver anuncios.");
        }

        const session = await startRef.current();
        if (!active) return;
        sessionId = session.sessionId;
        sessionRef.current = sessionId;
        claimKeyRef.current = crypto.randomUUID();
        setRemaining(session.remaining);

        if (!isNativeAds()) {
          toast.info("Usaremos el anuncio de respaldo de Cupido Leudy.");
          await runFallback(sessionId);
          return;
        }

        const result = await showRewardedAd(userId, sessionId);
        if (!active) return;
        if (result === "rewarded") {
          await claimSession(sessionId);
          return;
        }
        if (result === "dismissed") {
          await cancelRef.current({ data: { sessionId } }).catch(() => undefined);
          claimedRef.current = true;
          setError("Cerraste el anuncio antes de completarlo. No se acreditaron monedas.");
          setPhase("done");
          toast.info("Anuncio cerrado antes de completarse. No se acreditaron monedas.");
          return;
        }

        toast.info("No pudimos cargar el anuncio de Google. Usaremos el anuncio de respaldo.");
        await runFallback(sessionId);
      } catch (runError) {
        if (!active) return;
        const message = messageOf(runError);
        setError(message);
        setPhase("done");
        toast.error(message);
      }
    };

    void run();
    return () => {
      active = false;
      clearTimers();
      const pending = sessionRef.current;
      if (pending && !claimedRef.current) void cancelRef.current({ data: { sessionId: pending } }).catch(() => undefined);
      sessionRef.current = null;
      claimedRef.current = false;
      startedRef.current = false;
    };
  }, [open, onOpenChange]);

  const busy = phase === "native" || phase === "fallback";
  const handleOpenChange = (next: boolean) => {
    if (busy && !next) return;
    if (!next) clearTimers();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm border-pink-400/30 bg-[#1b1020] text-white">
        <DialogHeader>
          <DialogTitle>Anuncio patrocinado Cupido Leudy</DialogTitle>
          <DialogDescription>
            {phase === "fallback"
              ? `Tu recompensa segura de +${AD_REWARD} monedas se acreditará al terminar.`
              : phase === "done" && error
                ? error
                : `Mira el video completo y recibe +${AD_REWARD} monedas para regalos.`}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-pink-600/40 via-fuchsia-600/20 to-amber-500/20 p-8 text-center">
          <span className="rounded-full bg-black/30 px-3 py-1 text-[10px] uppercase tracking-widest text-white/70">Publicidad</span>
          {phase === "fallback" ? (
            <>
              <p className="mt-6 font-display text-lg text-amber-100">Anuncio patrocinado Cupido Leudy</p>
              <p className="mt-2 text-xs text-white/70">Gracias por apoyar Cupido Leudy ❤️</p>
              <Progress value={progress} className="mt-6 h-2 bg-white/10" />
              <p className="mt-2 text-[11px] text-white/60">{Math.round(progress)}%</p>
            </>
          ) : (
            <p className="mt-6 flex items-center justify-center gap-2 text-sm text-amber-100">
              {phase === "done" && !error ? (
                <><Check className="size-4 text-emerald-300" /> Recompensa acreditada</>
              ) : busy ? (
                <><Loader2 className="size-4 animate-spin" /> {phase === "native" ? "Reproduciendo anuncio de AdMob…" : "Preparando anuncio…"}</>
              ) : (
                <><Play className="size-4 fill-current" /> Anuncio listo</>
              )}
            </p>
          )}
        </div>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-100">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        ) : null}

        <p className="text-center text-[11px] text-white/60">
          Máximo {AD_LIMIT} anuncios por día · te quedan {remaining}. Estas monedas no aumentan el saldo retirable.
        </p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => handleOpenChange(false)}>Cerrar</Button>
      </DialogContent>
    </Dialog>
  );
}
