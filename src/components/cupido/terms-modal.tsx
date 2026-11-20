import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { TERMS_TEXT, TERMS_TITLE, TERMS_VERSION } from "@/lib/cupido";
import { toast } from "sonner";

export function TermsModal() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const terms = useQuery({
    queryKey: ["cupido-terms", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("terms_accepted_at")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data?.terms_accepted_at ?? null;
    },
  });

  const shouldShow =
    Boolean(userId) && !accepted && (terms.isError || (terms.isSuccess && !terms.data));

  const handleAccept = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("cupido_accept_terms", { _version: TERMS_VERSION });
      if (error) throw error;
      setAccepted(true);
      void queryClient.invalidateQueries({ queryKey: ["cupido-terms", userId] });
      toast.success("Términos aceptados. Bienvenido a Cupido Leudy ❤️");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron aceptar los términos.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={shouldShow}>
      <DialogContent
        className="max-w-2xl"
        hideCloseButton
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{TERMS_TITLE}</DialogTitle>
          <DialogDescription className="sr-only">
            Debes aceptar los términos para continuar.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {TERMS_TEXT}
        </div>
        <DialogFooter>
          <Button type="button" className="w-full sm:w-auto" disabled={busy} onClick={() => void handleAccept()}>
            {busy && <Loader2 className="animate-spin" />}
            Acepto los términos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
