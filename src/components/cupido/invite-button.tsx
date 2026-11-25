import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/cupido";
import { supabase } from "@/integrations/supabase/client";
import { invitationLink, normalizeReferralCode } from "@/lib/referral";

export function InviteButton({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const referral = useQuery({
    queryKey: ["cupido-referral-code", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
      if (error) throw error;
      return normalizeReferralCode(data?.referral_code);
    },
  });

  const copyLink = async () => {
    const referralCode = referral.data ?? "";
    if (!referralCode) return;
    const link = invitationLink(referralCode);
    const invitation = `¡Únete a ${BRAND} y recibe 50 monedas al registrarte! Usa mi código ${referralCode}: ${link}`;
    const confirmCopy = () => {
      setCopied(true);
      toast.success("Invitación copiada ❤️");
      window.setTimeout(() => setCopied(false), 2500);
    };

    try {
      if (navigator.share) {
        await navigator.share({ title: BRAND, text: invitation, url: link });
        toast.success("¡Enlace compartido! ❤️");
        return;
      }
      await navigator.clipboard.writeText(invitation);
      confirmCopy();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(invitation);
        confirmCopy();
      } catch {
        toast.error("No se pudo copiar el enlace.");
      }
    }
  };

  return (
    <Button variant={compact ? "outline" : "secondary"} disabled={!referral.data} className="w-full max-w-full justify-center gap-2 whitespace-normal px-3 py-2.5 text-center leading-tight sm:w-auto" onClick={() => void copyLink()}>
      {copied ? <Check className="size-4" /> : <UserPlus className="size-4" />}
      <span className="min-w-0">{copied ? "¡Enlace copiado!" : compact ? "Invitar y ganar +100" : "Compartir invitación"}</span>
    </Button>
  );
}
