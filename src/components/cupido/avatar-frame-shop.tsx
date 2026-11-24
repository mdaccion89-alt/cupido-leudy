import type { CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAccount } from "@/lib/account";
import { useEquippedAvatarFrame } from "@/lib/avatar-frames";

type AvatarFrame = {
  id: string;
  level: number;
  name: string;
  coin_cost: number;
  color_a: string;
  color_b: string;
  effect: string;
};

type AvatarFrameShopProps = { open: boolean; onOpenChange: (open: boolean) => void; userId: string; avatarUrl: string; displayName: string };
const db = supabase as unknown as { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export function AvatarFrameShop({ open, onOpenChange, userId, avatarUrl, displayName }: AvatarFrameShopProps) {
  const queryClient = useQueryClient();
  const account = useAccount();
  const equipped = useEquippedAvatarFrame(userId);
  const catalog = useQuery({
    queryKey: ["cupido-avatar-frame-catalog"],
    enabled: open,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("cupido_avatar_frames").select("id,level,name,coin_cost,color_a,color_b,effect").order("level", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AvatarFrame[];
    },
  });
  const owned = useQuery({
    queryKey: ["cupido-user-avatar-frames", userId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await db.from("cupido_user_avatar_frames").select("frame_id,paid_credits").eq("user_id", userId);
      if (error) throw error;
      return new Set<string>((data ?? []).map((row: { frame_id: string }) => row.frame_id));
    },
  });
  const wallet = useQuery({
    queryKey: ["cupido-frame-wallet", userId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await db.from("user_credits").select("purchased_credit_balance").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return Number(data?.purchased_credit_balance ?? 0);
    },
  });
  const purchase = useMutation({
    mutationFn: async (frameId: string) => {
      const { data, error } = await db.rpc("cupido_purchase_avatar_frame", { _frame_id: frameId });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        account.refresh(),
        queryClient.invalidateQueries({ queryKey: ["cupido-frame-wallet", userId] }),
        queryClient.invalidateQueries({ queryKey: ["cupido-user-avatar-frames", userId] }),
        queryClient.invalidateQueries({ queryKey: ["cupido-avatar-frame-catalog"] }),
      ]);
      toast.success("Marco adquirido con monedas de compra real.");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("INSUFFICIENT_PURCHASED_CREDITS")) toast.error("No tienes suficientes monedas compradas. Los bonos y recompensas no sirven para marcos.");
      else if (message.includes("REAL_PURCHASE_REQUIRED")) toast.error("Necesitas una compra real confirmada para adquirir marcos.");
      else toast.error(message || "No se pudo adquirir el marco.");
    },
  });
  const equip = useMutation({
    mutationFn: async (frameId: string | null) => {
      const { error } = await db.rpc("cupido_equip_avatar_frame", { _frame_id: frameId });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cupido-avatar-frame", userId] });
      toast.success("Tu marco se actualizó en todos tus perfiles.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88dvh] max-h-[88dvh] max-w-2xl flex-col overflow-hidden border-amber-300/20 bg-zinc-950 p-0 text-white">
        <DialogHeader className="shrink-0 border-b border-white/10 px-4 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-amber-200" />59 Marcos de Avatar</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-white/60">Aros animados para perfil, feed, chat y Live. Se compran solo con monedas respaldadas por pagos PayPal capturados; bonos y anuncios quedan excluidos.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 [touch-action:pan-y]">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/95 py-3 backdrop-blur">
            <span className="text-xs text-white/70">Saldo: {account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")} monedas · {wallet.data?.toLocaleString("es") ?? "…"} compradas disponibles</span>
            {!account.hasPurchased && <Button asChild size="sm" variant="outline" className="h-8 text-xs"><Link to="/tienda">Comprar monedas</Link></Button>}
            {equipped && <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={equip.isPending} onClick={() => equip.mutate(null)}>Quitar marco</Button>}
          </div>
          {catalog.isLoading ? <p className="py-10 text-center text-sm text-white/60">Cargando colección…</p> : catalog.isError ? <p className="py-10 text-center text-sm text-rose-200">No se pudo cargar la colección de marcos.</p> : (
            <div className="grid grid-cols-2 gap-2.5 pt-3 sm:grid-cols-3">
              {(catalog.data ?? []).map((frame) => {
                const isOwned = owned.data?.has(frame.id) ?? false;
                const isEquipped = equipped?.frame_id === frame.id;
                const enoughPaidCredits = Boolean(account.hasPurchased && (wallet.data ?? 0) >= frame.coin_cost);
                return (
                  <article key={frame.id} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-center">
                    <Avatar userId={userId} className="cupido-avatar-frame-root mx-auto size-14 border border-white/10" style={{ "--avatar-frame-a": frame.color_a, "--avatar-frame-b": frame.color_b } as CSSProperties} data-avatar-frame={frame.id} data-avatar-frame-effect={frame.effect}>
                      <AvatarImage src={avatarUrl} alt={displayName} />
                      <AvatarFallback>{displayName.slice(0, 1).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <p className="mt-2 truncate text-xs font-semibold text-white">Nv. {frame.level} · {frame.name}</p>
                    <p className="mt-1 text-[10px] text-amber-100">{frame.coin_cost.toLocaleString("es")} monedas compradas</p>
                    {isEquipped ? <span className="mt-2 inline-flex h-8 items-center gap-1 text-xs font-semibold text-emerald-200"><Check className="size-4" /> Equipado</span>
                      : isOwned ? <Button size="sm" className="mt-2 h-8 w-full text-xs" disabled={equip.isPending} onClick={() => equip.mutate(frame.id)}>Equipar</Button>
                        : enoughPaidCredits ? <Button size="sm" variant="outline" className="mt-2 h-8 w-full text-xs" disabled={purchase.isPending} onClick={() => purchase.mutate(frame.id)}>
                          {purchase.isPending && purchase.variables === frame.id ? <Loader2 className="size-3.5 animate-spin" /> : "Adquirir"}
                        </Button>
                          : <Button asChild size="sm" variant="outline" className="mt-2 h-8 w-full text-xs"><Link to="/tienda">{account.hasPurchased ? "Recargar" : "Comprar monedas"}</Link></Button>}
                  </article>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-center text-[10px] leading-relaxed text-white/45">Los marcos son cosméticos y no modifican monedas, ganancias ni el libro mayor de retiros.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
