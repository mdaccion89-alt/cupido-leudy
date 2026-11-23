import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/cupido";
import { invitationLink } from "@/lib/referral";

export function InviteButton({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const link = invitationLink(userId);
    const confirmCopy = () => {
      setCopied(true);
      toast.success("Enlace copiado ❤️");
      window.setTimeout(() => setCopied(false), 2500);
    };

    try {
      if (navigator.share) {
        await navigator.share({ title: BRAND, text: `Únete a ${BRAND} ❤️`, url: link });
        toast.success("¡Enlace compartido! ❤️");
        return;
      }
      await navigator.clipboard.writeText(link);
      confirmCopy();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(link);
        confirmCopy();
      } catch {
        toast.error("No se pudo copiar el enlace.");
      }
    }
  };

  return (
    <Button variant={compact ? "outline" : "secondary"} className="w-full max-w-full justify-center gap-2 whitespace-normal px-3 py-2.5 text-center leading-tight sm:w-auto" onClick={() => void copyLink()}>
      {copied ? <Check className="size-4" /> : <UserPlus className="size-4" />}
      <span className="min-w-0">{copied ? "¡Enlace copiado!" : compact ? "Invitar y ganar +200" : "Copiar / Compartir enlace de invitación"}</span>
    </Button>
  );
}
