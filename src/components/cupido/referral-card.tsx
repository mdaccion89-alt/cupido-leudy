import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Gift, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { supabase } from "@/integrations/supabase/client";
import { invitationLink, normalizeReferralCode } from "@/lib/referral";

export function ReferralCard({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const codeQuery = useQuery({
    queryKey: ["cupido-referral-code", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
      if (error) throw error;
      return normalizeReferralCode(data?.referral_code);
    },
  });
  const referralsQuery = useQuery({
    queryKey: ["cupido-referrals", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cupido_referrals").select("referee_id,status,rewarded_at").eq("referrer_id", userId);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`cupido-referrals-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_referrals", filter: `referrer_id=eq.${userId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-referrals", userId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, userId]);

  const code = codeQuery.data ?? "";
  const invitation = code ? invitationLink(code) : "";
  const rewardedReferrals = (referralsQuery.data ?? []).filter((referral) => referral.status === "rewarded" && referral.rewarded_at);
  const earnedCoins = rewardedReferrals.length * 100;

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("No se pudo copiar. Mantén pulsado el código para seleccionarlo.");
    }
  };

  const shareInvitation = async () => {
    if (!code || !invitation) return;
    const text = `¡Únete a Cupido Leudy y gana 50 monedas al registrarte! Usa mi código ${code}: ${invitation}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Invitación a Cupido Leudy", text, url: invitation });
        return;
      }
      await copy(text, "Invitación copiada");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      await copy(text, "Invitación copiada");
    }
  };

  return (
    <section className="mt-4 w-full max-w-full rounded-2xl border border-pink-300/25 bg-gradient-to-br from-pink-500/[0.13] via-rose-500/[0.07] to-amber-400/[0.08] p-4 shadow-[0_12px_40px_rgba(190,24,93,0.08)] sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-pink-200/15 bg-pink-300/10 text-pink-100"><Gift className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-white">Invita Amigos y Gana Monedas</h2>
          <p className="mt-1 text-xs leading-relaxed text-pink-100/70">Tu amigo recibe 50 monedas al registrarse y tú ganas 100. Solo son monedas para regalos, no retirables.</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center gap-2 text-xs text-white/65"><Users className="size-4 text-pink-200" /> Amigos invitados</div>
          <p className="mt-1 text-xl font-bold text-white">{referralsQuery.isLoading ? "—" : rewardedReferrals.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center gap-2 text-xs text-white/65"><CoinIcon className="size-4" /> Monedas ganadas</div>
          <p className="mt-1 text-xl font-bold text-amber-100">{referralsQuery.isLoading ? "—" : earnedCoins.toLocaleString("es")}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/50">Tu código personal</p>
          <p className="mt-0.5 font-mono text-lg font-bold tracking-[0.22em] text-white">{code || (codeQuery.isLoading ? "••••••" : "—")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!code} onClick={() => void copy(code, "Código copiado")} className="gap-2 border-white/15 bg-white/[0.04]">
          {code ? <Copy className="size-4" /> : <Check className="size-4" />} Copiar código
        </Button>
      </div>

      <Button type="button" disabled={!code} onClick={() => void shareInvitation()} className="mt-3 h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 font-semibold text-white shadow-[0_8px_24px_rgba(236,72,153,0.2)] hover:brightness-110">
        <Share2 className="size-4" /> Compartir invitación
      </Button>
      {codeQuery.isError && <p className="mt-2 text-xs text-rose-200">No se pudo cargar el código de invitación.</p>}
    </section>
  );
}
