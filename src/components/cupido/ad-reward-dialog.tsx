import { useEffect, useRef, useState } from "react";
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

type Phase = "loading" | "native" | "fallback" | "done";

type RewardResult = { awarded: number; balance: number; remaining: number };

function createClaimKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "No se pudo completar el anuncio. Inténtalo de nuevo.";
  if (raw.includes("AD_REWARD_DAILY_LIMIT")) return "Ya viste los 5 anuncios de hoy. Vuelve mañana ❤️";
  if (raw.includes("AD_REWARD_AUTH_REQUIRED") || raw.includes("JWT")) return "Inicia sesión para recibir monedas por ver anuncios.";
  if (raw.includes("AD_REWARD_SESSION_EXPIRED") || raw.includes("AD_REWARD_INVALID")) return "No pudimos validar la recompensa del anuncio. Vuelve a intentarlo.";
  if (raw.includes("AD_REWARD_PROFILE_NOT_FOUND")) return "No encontramos tu perfil. Vuelve a iniciar sesión.";
  if (raw.includes("NOT_ALLOWED")) return "No tienes permiso para reclamar esta recompensa.";
  return raw || "No se pudo completar el anuncio. Inténtalo de nuevo.";
}

function readRewardResult(value: unknown): RewardResult {
  if (!value || typeof value !== "object") throw new Error("Supabase no confirmó la recompensa.");
  const result = value as Record<string, unknown>;
  const awarded = Number(result["awarded"]);
  const balance = Number(result["balance"]);
  const remaining = Number(result["remaining"]);
  if (![awarded, balance, remaining].every(Number.isFinite)) {
    throw new Error("Supabase no confirmó la recompensa del anuncio.");
  }
  return { awarded, balance, remaining };
}

export function AdRewardDialog({
  open,
  onOpenChange,
  onRewarded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRewarded?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [remaining, setRemaining] = useState(AD_LIMIT);
  const [error, setError] = useState<string | null>(null);
  const account = useAccount();
  const queryClient = useQueryClient();
  const accountRef = useRef(account);
  const queryClientRef = useRef(queryClient);
  const onOpenChangeRef = useRef(onOpenChange);
  const onRewardedRef = useRef(onRewarded);
  const timersRef = useRef<number[]>([]);

  accountRef.current = account;
  queryClientRef.current = queryClient;
  onOpenChangeRef.current = onOpenChange;
  onRewardedRef.current = onRewarded;

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id);
    for (const id of timersRef.current) window.clearInterval(id);
    timersRef.current = [];
  };

  const refreshBalance = async (userId: string) => {
    await Promise.allSettled([
      accountRef.current.refresh(),
      queryClientRef.current.invalidateQueries({ queryKey: ["account", userId] }),
      queryClientRef.current.invalidateQueries({ queryKey: ["cupido-wallet", userId] }),
    ]);
  };

  const applyOptimisticCredit = (userId: string) => {
    queryClientRef.current.setQueryData(["account", userId], (current: unknown) => {
      if (!current || typeof current !== "object") return current;
      const data = current as { balance?: number; adRewardBalance?: number };
      return {
        ...data,
        balance: data.balance === -1 ? -1 : Number(data.balance ?? 0) + AD_REWARD,
        adRewardBalance: Number(data.adRewardBalance ?? 0) + AD_REWARD,
      };
    });
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    const claimKey = createClaimKey();
    setPhase("loading");
    setProgress(0);
    setRemaining(AD_LIMIT);
    setError(null);

    const showError = (message: string) => {
      if (!active) return;
      setError(message);
      setPhase("done");
      toast.error(message);
    };

    const credit = async (userId: string) => {
      try {
        const { data, error: rpcError } = await supabase.rpc("cupido_claim_ad_reward_authenticated", {
          _claim_key: claimKey,
        });
        if (rpcError) throw new Error(messageOf(rpcError));
        const result = readRewardResult(data);
        if (!active) return;
        setRemaining(result.remaining);
        setPhase("done");
        applyOptimisticCredit(userId);
        await refreshBalance(userId);
        if (result.awarded > 0) {
          toast.success("¡+15 monedas acreditadas!");
        } else {
          toast.success("Tu recompensa ya estaba acreditada.");
        }
        onRewardedRef.current?.();
        const timer = window.setTimeout(() => {
          if (active) onOpenChangeRef.current(false);
        }, 700);
        timersRef.current.push(timer);
      } catch (creditError) {
        showError(messageOf(creditError));
      }
    };

    const runFallback = async (userId: string) => {
      if (!active) return;
      setPhase("fallback");
      setProgress(0);
      const startedAt = Date.now();
      await new Promise<void>((resolve) => {
        const tick = window.setInterval(() => {
          if (!active) {
            window.clearInterval(tick);
            resolve();
            return;
          }
          const next = Math.min(100, ((Date.now() - startedAt) / 5_000) * 100);
          setProgress(next);
          if (next >= 100) {
            window.clearInterval(tick);
            resolve();
          }
        }, 80);
        timersRef.current.push(tick);
      });
      if (active) await credit(userId);
    };

    const run = async () => {
      if (!areAdsEnabled()) throw new Error("Los anuncios están pausados en este momento.");
      const userId = accountRef.current.userId;
      if (!userId) throw new Error("Inicia sesión para recibir monedas por ver anuncios.");

      if (!isNativeAds()) {
        toast.info("Usaremos el anuncio de respaldo de Cupido Leudy.");
        await runFallback(userId);
        return;
      }

      setPhase("native");
      const result = await showRewardedAd();
      if (!active) return;
      if (result === "rewarded") {
        await credit(userId);
        return;
      }
      if (result === "dismissed") {
        showError("Cerraste el anuncio antes de completarlo. No se acreditaron monedas.");
        return;
      }
      toast.info("No pudimos cargar el anuncio de Google. Usaremos el anuncio de respaldo.");
      await runFallback(userId);
    };

    void run().catch((runError: unknown) => showError(messageOf(runError)));

    return () => {
      active = false;
      clearTimers();
    };
  }, [open]);

  const busy = phase === "loading" || phase === "native" || phase === "fallback";
  const handleOpenChange = (next: boolean) => {
    if (busy && !next) return;
    if (!next) clearTimers();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm border-pink-400/30 bg-[#1b1020] text-white">
        <DialogHeader>
          <DialogTitle>Anuncio Patrocinado Cupido Leudy</DialogTitle>
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
              <p className="mt-6 font-display text-lg text-amber-100">Anuncio Patrocinado Cupido Leudy</p>
              <p className="mt-2 text-xs text-white/70">Gracias por apoyar Cupido Leudy ❤️</p>
              <Progress value={progress} className="mt-6 h-2 bg-white/10" />
              <p className="mt-2 text-[11px] text-white/60">Reclamar recompensa ({AD_REWARD} monedas) · {Math.round(progress)}%</p>
            </>
          ) : (
            <p className="mt-6 flex items-center justify-center gap-2 text-sm text-amber-100">
              {phase === "done" && !error ? (
                <><Check className="size-4 text-emerald-300" /> Recompensa acreditada</>
              ) : phase === "loading" ? (
                <><Loader2 className="size-4 animate-spin" /> Cargando anuncio...</>
              ) : phase === "native" ? (
                <><Loader2 className="size-4 animate-spin" /> Reproduciendo anuncio de AdMob...</>
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
