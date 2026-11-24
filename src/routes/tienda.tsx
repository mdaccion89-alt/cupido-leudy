import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, CreditCard, Gift, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { PayPalCheckoutButtons } from "@/components/cupido/paypal-checkout-buttons";
import { PayPalLogo } from "@/components/cupido/paypal-logo";
import { GranLigaStar, VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account";
import { CREDIT_PACKAGES, GRAN_LIGA_PACKAGE_ID } from "@/lib/credits";
import { loadPaypalClientId } from "@/lib/paypal-public";
import {
  COUNTRIES,
  GRAN_LIGA_MIN_WITHDRAWAL,
  MIN_WITHDRAWAL,
  canSendGift,
  countryFlag,
  countryName,
  giftErrorMessage,
  withdrawalMethods,
  type Gift as GiftItem,
} from "@/lib/cupido";
import { capturePaypalOrder } from "@/lib/payments.functions";
import { readableErrorMessage } from "@/lib/cupido";
import { SUPREME_ADMIN_EMAIL } from "@/lib/posts";
import { useAndroidBackDismiss } from "@/hooks/use-android-back-dismiss";

export const Route = createFileRoute("/tienda")({
  validateSearch: (search: { userId?: string; token?: string }) => search,
  head: () => ({ meta: [{ title: "Tienda — Cupido Leudy ❤️" }] }),
  component: StorePage,
});

function StorePage() {
  const { session, loading: authLoading } = useAuth();
  const viewerId = session?.user.id ?? null;
  const { userId: giftTo, token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const account = useAccount();
  const minimumWithdrawal = account.isGranLiga ? GRAN_LIGA_MIN_WITHDRAWAL : MIN_WITHDRAWAL;
  const captureOrder = useServerFn(capturePaypalOrder);
  const capturedRef = useRef<string | null>(null);
  const [captureRetry, setCaptureRetry] = useState<{ orderId: string; message: string; retryable: boolean } | null>(null);
  const [captureRetrying, setCaptureRetrying] = useState(false);

  const [pendingGift, setPendingGift] = useState<GiftItem | null>(null);
  const [selectedCheckoutPackageId, setSelectedCheckoutPackageId] = useState<string | null>(null);
  const [checkoutForGift, setCheckoutForGift] = useState(false);
  const [amount, setAmount] = useState("20");
  const [country, setCountry] = useState("DO");
  const [method, setMethod] = useState("PayPal");
  const [accountDetails, setAccountDetails] = useState("");
  const closeCheckoutSheet = () => {
    setSelectedCheckoutPackageId(null);
    setCheckoutForGift(false);
  };
  useAndroidBackDismiss(Boolean(selectedCheckoutPackageId), closeCheckoutSheet);

  const target = useQuery({
    queryKey: ["cupido-gift-target", giftTo],
    enabled: Boolean(giftTo),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_public_profiles")
        .select("id,display_name,avatar_url,is_verified_blue,is_gran_liga,is_official,is_super_admin")
        .eq("id", giftTo!)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { ...data, email: data.is_super_admin ? SUPREME_ADMIN_EMAIL : null }
        : data;
    },
  });

  const wallet = useQuery({
    queryKey: ["cupido-wallet", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("withdrawable_balance")
        .eq("id", viewerId!)
        .maybeSingle();
      if (error && error.code !== "42703" && error.code !== "PGRST204") throw error;
      if (!error && data) return Number(data.withdrawable_balance ?? 0);

      // Read the canonical ledger until the profile mirror migration is applied.
      const ledger = await supabase.from("cupido_balances").select("balance").eq("user_id", viewerId!).maybeSingle();
      if (ledger.error) throw ledger.error;
      return Number(ledger.data?.balance ?? 0);
    },
  });

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase
      .channel((`cupido-wallet-${viewerId}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${viewerId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-wallet", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_balances", filter: `user_id=eq.${viewerId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-wallet", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_withdrawals", filter: `user_id=eq.${viewerId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-withdrawals", viewerId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  const withdrawals = useQuery({
    queryKey: ["cupido-withdrawals", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_withdrawals")
        .select("*")
        .eq("user_id", viewerId!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  });

  const paypalConfig = useQuery({
    queryKey: ["paypal-checkout-config"],
    queryFn: async () => {
      const clientId = await loadPaypalClientId();
      return { configured: Boolean(clientId), clientId, businessName: "Cupido Leudy" };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const channel = supabase
      .channel(("cupido-paypal-config") + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["paypal-checkout-config"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_settings" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["paypal-checkout-config"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const verifyReturnedOrder = async (orderId: string) => {
    setCaptureRetrying(true);
    try {
      const result = await captureOrder({ data: { orderId } });
      if (!result.ok) throw new Error(result.message);
      account.addPurchasedCredits(result.credits);
      await account.refresh();
      void queryClient.invalidateQueries({ queryKey: ["cupido-wallet", viewerId] });
      setCaptureRetry(null);
      toast.success(result.isGranLiga
        ? "Diamante Gran Liga activado: 1.000.000 monedas, insignia VIP y privilegios desbloqueados."
        : `Se acreditaron ${result.credits.toLocaleString("es")} monedas brillantes ❤️`);
      void queryClient.invalidateQueries({ queryKey: ["paypal-checkout-config"] });
      void navigate({ to: "/tienda", search: giftTo ? { userId: giftTo } : {}, replace: true });
    } catch (error) {
      const message = readableErrorMessage(error, "No se pudo verificar el pago. Reintenta la confirmación del mismo pedido.");
      const lowerMessage = message.toLowerCase();
      const retryable = !lowerMessage.includes("pago cancelado") &&
        !lowerMessage.includes("no se acreditaron monedas") &&
        !lowerMessage.includes("no se encontró el pedido") &&
        !lowerMessage.includes("paquete no válido");
      setCaptureRetry({ orderId, message, retryable });
      toast.error(message);
    } finally {
      setCaptureRetrying(false);
    }
  };

  useEffect(() => {
    if (!token || !viewerId || capturedRef.current === token) return;
    capturedRef.current = token;
    void verifyReturnedOrder(token);
  }, [token, viewerId, giftTo, captureOrder, account, navigate]);

  const sendGift = useMutation({
    mutationFn: async ({ gift, verifiedRecharge = false }: { gift: GiftItem; verifiedRecharge?: boolean }) => {
      if (!giftTo) throw new Error("Elige a quién regalar.");
      if (!canSendGift(gift, account) && !verifiedRecharge) {
        throw new Error(account.hasPurchased || account.isInfiniteCreditsAdmin
          ? "No tienes monedas brillantes suficientes para ese regalo."
          : "Confirma una recarga real para desbloquear tus monedas y enviar regalos.");
      }
      const { error } = await supabase.rpc("cupido_send_gift", {
        _receiver: giftTo,
        _gift_id: gift.id,
        _credits: gift.credits,
        _cash_value: gift.cash,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      account.refresh();
      setPendingGift(null);
      toast.success("Regalo enviado ❤️");

    },
    onError: (error) =>
      toast.error(giftErrorMessage(error, "No se pudo registrar el regalo. Comprueba tu saldo e inténtalo otra vez.")),
  });

  const pendingGiftPackage = pendingGift
    ? CREDIT_PACKAGES.find((pack) => pack.credits >= Math.max(pendingGift.credits - (Number.isFinite(account.balance) ? account.balance : pendingGift.credits), account.hasPurchased ? 0 : 1))
    : undefined;
  const selectedCheckoutPackage = CREDIT_PACKAGES.find((pack) => pack.id === selectedCheckoutPackageId);

  const handleCheckoutSuccess = async (credits: number) => {
    account.addPurchasedCredits(credits);
    await account.refresh();
    void queryClient.invalidateQueries({ queryKey: ["cupido-wallet", viewerId] });
    void queryClient.invalidateQueries({ queryKey: ["paypal-checkout-config"] });
    setSelectedCheckoutPackageId(null);
    if (checkoutForGift && pendingGift) {
      setCheckoutForGift(false);
      sendGift.mutate({ gift: pendingGift, verifiedRecharge: true });
      return;
    }
    setCheckoutForGift(false);
    toast.success(credits >= 1_000_000
      ? "Diamante Gran Liga activado: 1.000.000 monedas, insignia VIP y privilegios desbloqueados."
      : `Se acreditaron ${credits.toLocaleString("es")} monedas brillantes ❤️`);
  };

  const withdraw = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value < minimumWithdrawal) throw new Error(`El mínimo es US$${minimumWithdrawal}.`);
      if (value > (wallet.data ?? 0)) throw new Error("No tienes saldo suficiente.");
      if (!accountDetails.trim()) throw new Error("Escribe los datos de tu cuenta.");
      const { error } = await supabase.rpc("cupido_request_withdrawal", {
        _amount: value,
        _country_code: country,
        _method: method,
        _account_details: accountDetails.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAccountDetails("");
      void queryClient.invalidateQueries({ queryKey: ["cupido-wallet", viewerId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-withdrawals", viewerId] });
      toast.success("Solicitud de retiro enviada. El Admin Supremo la revisará.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo solicitar el retiro."),
  });

  if (authLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">Cargando tienda…</div>;
  }

  if (!viewerId) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <h1 className="font-display text-2xl text-white">Inicia sesión para comprar o regalar</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Las monedas brillantes se usan en llamadas Hot/Café y en regalos virtuales.
          </p>
          <Button asChild className="mt-5">
            <Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-white">Tienda</h1>
          <p className="text-sm text-muted-foreground">Monedas brillantes, 99 regalos y retiros de Cupido Leudy.</p>
        </div>
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 px-5 py-3 text-right">
          <p className="flex items-center justify-end gap-1.5 text-xs uppercase tracking-wide text-amber-200/80">
            <CoinIcon className="size-4" /> Mis Monedas
          </p>
          <p className="font-display text-2xl text-white">
            {account.loading ? "..." : account.balanceUnavailable ? "—" : account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
          </p>
        </div>
      </header>

      {captureRetry && (
        <section role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-300/30 bg-amber-400/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-100">{captureRetry.message}</p>
          <Button type="button" className="w-full whitespace-normal sm:w-auto" disabled={captureRetrying} onClick={() => {
            if (captureRetry.retryable) void verifyReturnedOrder(captureRetry.orderId);
            else void navigate({ to: "/tienda", search: giftTo ? { userId: giftTo } : {}, replace: true });
          }}>
            {captureRetrying ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            {captureRetry.retryable ? "Reintentar confirmación" : "Volver a elegir monedas"}
          </Button>
        </section>
      )}


      {giftTo && (
        <section className="mb-8 rounded-3xl border border-pink-400/30 bg-pink-500/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0"><GranLigaStar active={target.data?.is_gran_liga} /><Avatar userId={target.data?.id} className="h-14 w-14 border border-pink-300/40">
                <AvatarImage src={target.data?.avatar_url ?? ""} alt={target.data?.display_name ?? ""} />
                <AvatarFallback className="bg-pink-500/20 text-pink-100">
                  {(target.data?.display_name ?? "C").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar></div>
              <div>
                <p className="flex items-center gap-1 font-semibold text-white">
                  {target.data?.display_name ?? "Miembro de Cupido"}
                  <VerifiedBadge email={target.data?.email} verified={target.data?.is_verified_blue} granLiga={target.data?.is_gran_liga} className="h-4 w-4" />
                </p>
                <p className="text-xs text-pink-100/70">Enviar un regalo convierte su valor en saldo retirable.</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/tienda">Ver paquetes de monedas</Link>
            </Button>
          </div>
          <div className="mt-5 flex items-center gap-2">
            <Gift className="h-4 w-4 text-pink-300" />
            <h2 className="font-display text-lg text-white">99 regalos para enamorar</h2>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Las 500 monedas de bienvenida se desbloquean después de una recarga real confirmada. Solo PayPal Live y tarjeta acreditan monedas automáticamente.
          </p>
          {pendingGift && (
            <div className="mt-3 space-y-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-4">
              <div>
                <p className="font-semibold text-white">Desbloquea y envía {pendingGift.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Elige una recarga confirmada para habilitar las monedas. Al aprobarse el pago, el regalo se enviará a {target.data?.display_name ?? "la persona elegida"}.
                </p>
              </div>
              {pendingGiftPackage ? (
                <Button type="button" className="w-full whitespace-normal px-3 py-2.5 text-center leading-tight" disabled={paypalConfig.isLoading || !paypalConfig.data?.configured || sendGift.isPending} onClick={() => {
                  setCheckoutForGift(true);
                  setSelectedCheckoutPackageId(pendingGiftPackage.id);
                }}>
                  {paypalConfig.isLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                  Recargar y enviar regalo
                </Button>
              ) : (
                <p className="text-center text-sm text-amber-100/80">No hay un paquete compatible con el saldo de este regalo.</p>
              )}
              {!paypalConfig.isLoading && !paypalConfig.data?.configured && <p className="text-center text-xs text-amber-100/80">Configura PayPal Business Live en /admin para completar el pago seguro con PayPal o tarjeta.</p>}
              <Button type="button" variant="ghost" className="w-full" onClick={() => setPendingGift(null)}>Cancelar</Button>
            </div>
          )}
          <div className="mt-3">
            <GiftGrid onSelect={(gift) => {
              if (canSendGift(gift, account)) sendGift.mutate({ gift });
              else setPendingGift(gift);
            }} disabled={sendGift.isPending || account.loading || account.balanceUnavailable} />
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-pink-300" />
          <h2 className="font-display text-xl text-white">Paquetes de monedas brillantes</h2>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {CREDIT_PACKAGES.map((pack) => {
            const config = paypalConfig.data;
            const officialCheckout = Boolean(config?.configured && config.clientId);
            return (
              <article
                key={pack.id}
                className={`relative flex min-w-0 flex-col rounded-2xl border p-2.5 sm:rounded-3xl sm:p-4 ${
                  "featured" in pack && pack.featured ? "border-pink-400/60 bg-pink-500/10" : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="mb-2 flex min-h-8 flex-wrap items-start gap-1">
                  {"discountLabel" in pack && pack.discountLabel && <Badge className="px-1.5 py-0.5 text-[9px] leading-none">{pack.discountLabel}</Badge>}
                  {"promoLabel" in pack && pack.promoLabel && <Badge variant="secondary" className="px-1.5 py-0.5 text-[8px] leading-none">{pack.promoLabel}</Badge>}
                </div>
                <p className="min-w-0 break-words text-[9px] leading-tight text-muted-foreground sm:text-xs">{pack.label}</p>
                <p className="mt-1 min-w-0 break-words font-display text-base leading-tight text-white sm:text-xl">{pack.credits.toLocaleString("es")}</p>
                <p className="min-w-0 break-words text-[9px] leading-tight text-muted-foreground sm:text-xs">monedas brillantes</p>
                {"originalPrice" in pack && pack.originalPrice && <p className="mt-2 text-[10px] text-muted-foreground line-through sm:text-xs">US${pack.originalPrice}</p>}
                <p className="min-w-0 break-words text-xs font-semibold leading-tight text-white sm:text-xl">US${pack.price}</p>
                <Button type="button" className="mt-3 h-auto min-h-9 w-full max-w-full whitespace-normal px-2 py-2 text-center text-[10px] leading-tight sm:text-sm" disabled={paypalConfig.isLoading || !officialCheckout} onClick={() => {
                  setCheckoutForGift(false);
                  setSelectedCheckoutPackageId(pack.id);
                }}>
                  {paypalConfig.isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5 shrink-0" />}
                  Comprar
                </Button>
                {pack.id === GRAN_LIGA_PACKAGE_ID && !officialCheckout && !paypalConfig.isLoading && <p className="mt-2 text-[9px] leading-tight text-amber-100/80">Activa PayPal Business en /admin.</p>}
              </article>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {paypalConfig.data?.configured && paypalConfig.data.clientId
            ? `Checkout Business real de ${paypalConfig.data.businessName}: paga con saldo PayPal o tarjeta. Las monedas se acreditan automáticamente.`
            : "El Admin Supremo debe guardar las credenciales de PayPal Business Live en /admin para habilitar pagos verificados y acreditación automática."}
        </p>
      </section>

      <Sheet open={Boolean(selectedCheckoutPackageId)} onOpenChange={(open) => {
        if (!open) closeCheckoutSheet();
      }}>
        <SheetContent side="bottom" className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border-white/10 bg-zinc-950 p-0 text-white">
          <SheetHeader className="shrink-0 border-b border-white/10 px-4 py-3 pr-12 text-left">
            <div className="flex items-center justify-between gap-3">
              <SheetTitle className="text-white">Pago seguro</SheetTitle>
              <Button type="button" variant="ghost" className="h-9 shrink-0 gap-1 px-2 text-white" onClick={closeCheckoutSheet}>
                <ArrowLeft className="size-4" /> Volver
              </Button>
            </div>
            <SheetDescription>
              {selectedCheckoutPackage ? `${selectedCheckoutPackage.credits.toLocaleString("es")} monedas · US$${selectedCheckoutPackage.price}` : "Paga con PayPal o tarjeta."}
              {checkoutForGift && pendingGift ? ` Después de confirmar, enviaremos ${pendingGift.name}.` : " Los campos de tarjeta se pueden recorrer dentro de esta ventana."}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-8 [padding-bottom:calc(env(safe-area-inset-bottom)+2rem)]">
            {selectedCheckoutPackage && paypalConfig.data?.configured && paypalConfig.data.clientId ? (
              <PayPalCheckoutButtons
                key={selectedCheckoutPackage.id}
                clientId={paypalConfig.data.clientId}
                packageId={selectedCheckoutPackage.id}
                disabled={sendGift.isPending}
                onSuccess={(credits) => { void handleCheckoutSuccess(credits).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Se acreditó el pago, pero no se pudo actualizar el saldo.")); }}
                onError={(message) => toast.error(message)}
                onCancel={(message) => toast.info(message)}
              />
            ) : paypalConfig.isLoading ? (
              <p className="flex min-h-16 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Preparando PayPal…</p>
            ) : (
              <p className="text-center text-sm text-amber-100/80">Configura PayPal Business Live en /admin para habilitar pagos seguros con PayPal o tarjeta.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex items-center gap-2">
            <PayPalLogo className="h-7 w-[94px]" />
            <h2 className="font-display text-xl text-white">Retirar saldo</h2>
          </div>
          <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-emerald-200/70">Saldo retirable</p>
            <p className="font-display text-2xl text-white">
              US${(wallet.data ?? 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-emerald-100/60">Mínimo de retiro: US${minimumWithdrawal}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Monto (USD)</Label>
              <Input
                type="number"
                min={minimumWithdrawal}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>País</Label>
              <Select
                value={country}
                onValueChange={(value) => {
                  setCountry(value);
                  setMethod(withdrawalMethods(value)[0] ?? "PayPal");
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map(([code, name]) => (
                    <SelectItem key={code} value={code}>{countryFlag(code)} {name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Método</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {withdrawalMethods(country).map((item) => (
                    <SelectItem key={item} value={item}>
                      {item.toLowerCase() === "paypal" ? <span className="flex items-center gap-2"><PayPalLogo className="h-5 w-[72px]" /> PayPal</span> : item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cuenta o teléfono</Label>
              <Input
                value={accountDetails}
                onChange={(event) => setAccountDetails(event.target.value)}
                placeholder="Correo PayPal, cuenta o teléfono"
                maxLength={200}
              />
            </div>
          </div>
          <Button className="mt-4" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
            {withdraw.isPending ? <Loader2 className="animate-spin" /> : <Wallet />} Solicitar retiro
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            El Admin Supremo revisa cada retiro antes de enviarlo. País actual: {countryName(country)}.
          </p>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-sky-300" />
            <h2 className="font-display text-xl text-white">Mis retiros</h2>
          </div>
          {withdrawals.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!withdrawals.isLoading && !withdrawals.data?.length && (
            <p className="text-sm text-muted-foreground">Todavía no has solicitado retiros.</p>
          )}
          <div className="space-y-2">
            {withdrawals.data?.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                <div>
                  <p className="text-sm text-white">US${Number(item.amount).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.method} · {countryName(item.country_code)}
                  </p>
                </div>
                <Badge variant={item.status === "pagado" || item.status === "approved" ? "default" : item.status === "rejected" ? "destructive" : "secondary"}>
                  {item.status === "pagado" || item.status === "approved" ? "Pagado" : item.status === "rejected" ? "Rechazado" : "Pendiente"}
                </Badge>
              </div>
            ))}
          </div>
          <Button asChild variant="outline" className="mt-4 w-full">
            <Link to="/perfil">Completar mi perfil</Link>
          </Button>
        </div>
      </section>

      <p className="mt-6 flex items-center gap-1 text-xs text-muted-foreground">
        <Gift className="h-3.5 w-3.5" /> Los regalos recibidos se guardan como saldo retirable en tu cuenta.
      </p>
    </main>
  );
}
