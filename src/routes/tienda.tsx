import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Gift, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { CoinIcon } from "@/components/cupido/coin-icon";
import { GiftGrid } from "@/components/cupido/gift-grid";
import { PayPalCheckoutButtons } from "@/components/cupido/paypal-checkout-buttons";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account";
import { CREDIT_PACKAGES } from "@/lib/credits";
import {
  COUNTRIES,
  FREE_GIFT_MAX_CREDITS,
  MIN_WITHDRAWAL,
  canSendGift,
  countryFlag,
  countryName,
  giftErrorMessage,
  withdrawalMethods,
  type Gift as GiftItem,
} from "@/lib/cupido";
import {
  capturePaypalOrder,
  createPaypalOrder,
  getPaypalCheckoutConfig,
} from "@/lib/payments.functions";

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
  const createOrder = useServerFn(createPaypalOrder);
  const captureOrder = useServerFn(capturePaypalOrder);
  const capturedRef = useRef<string | null>(null);

  const [amount, setAmount] = useState("20");
  const [country, setCountry] = useState("DO");
  const [method, setMethod] = useState("PayPal");
  const [accountDetails, setAccountDetails] = useState("");

  const target = useQuery({
    queryKey: ["cupido-gift-target", giftTo],
    enabled: Boolean(giftTo),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select("id,display_name,avatar_url,is_verified_blue")
        .eq("id", giftTo!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return data;
      const { data: privateProfile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", giftTo!)
        .maybeSingle();
      return { ...data, email: privateProfile?.email ?? null };
    },
  });

  const wallet = useQuery({
    queryKey: ["cupido-wallet", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_balances")
        .select("balance")
        .eq("user_id", viewerId!)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.balance ?? 0);
    },
  });

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
    queryFn: () => getPaypalCheckoutConfig(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!token || !viewerId || capturedRef.current === token) return;
    capturedRef.current = token;
    void (async () => {
      const result = await captureOrder({ data: { orderId: token } });
      if (result.ok) {
        toast.success(`Se acreditaron ${result.credits.toLocaleString("es")} monedas brillantes ❤️`);
        account.refresh();
        void queryClient.invalidateQueries({ queryKey: ["paypal-checkout-config"] });
        void navigate({ to: "/tienda", search: giftTo ? { userId: giftTo } : {}, replace: true });
      } else {
        toast.error(result.message);
      }
    })();
  }, [token, viewerId, giftTo, captureOrder, account, navigate]);

  const buy = useMutation({
    mutationFn: async (packageId: string) => {
      const returnUrl = `${window.location.origin}/tienda${giftTo ? `?userId=${giftTo}` : ""}`;
      const result = await createOrder({ data: { packageId, returnUrl } });
      if (!result.ok) throw new Error(result.message);
      return result.approveUrl;
    },
    onSuccess: (url) => window.location.assign(url),
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo abrir PayPal."),
  });

  const sendGift = useMutation({
    mutationFn: async (gift: GiftItem) => {
      if (!giftTo) throw new Error("Elige a quién regalar.");
      if (!canSendGift(gift, account))
        throw new Error(
          account.hasPurchased || account.isAdmin
            ? "No tienes monedas brillantes suficientes para ese regalo."
            : `Los regalos de más de ${FREE_GIFT_MAX_CREDITS} monedas requieren compra o recarga.`,
        );
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
      toast.success("Regalo enviado ❤️");
    },
    onError: (error) =>
      toast.error(giftErrorMessage(error instanceof Error ? error.message : "", "No se pudo enviar el regalo.")),
  });

  const withdraw = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value < MIN_WITHDRAWAL) throw new Error(`El mínimo es US$${MIN_WITHDRAWAL}.`);
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
            <CoinIcon className="size-4" /> Monedas brillantes disponibles
          </p>
          <p className="font-display text-2xl text-white">
            {account.balance === Infinity ? "∞" : account.balance.toLocaleString("es")}
          </p>
        </div>
      </header>

      {giftTo && (
        <section className="mb-8 rounded-3xl border border-pink-400/30 bg-pink-500/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14 border border-pink-300/40">
                <AvatarImage src={target.data?.avatar_url ?? ""} alt={target.data?.display_name ?? ""} />
                <AvatarFallback className="bg-pink-500/20 text-pink-100">
                  {(target.data?.display_name ?? "C").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="flex items-center gap-1 font-semibold text-white">
                  {target.data?.display_name ?? "Miembro de Cupido"}
                  <VerifiedBadge email={target.data?.email} verified={target.data?.is_verified_blue} className="h-4 w-4" />
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
            500 monedas gratis de bienvenida: regalos hasta {FREE_GIFT_MAX_CREDITS} monedas. Para regalos
            superiores y llamadas, compra o recarga.
          </p>
          <div className="mt-3">
            <GiftGrid onSelect={(gift) => sendGift.mutate(gift)} disabled={sendGift.isPending} />
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-pink-300" />
          <h2 className="font-display text-xl text-white">Paquetes de monedas brillantes</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CREDIT_PACKAGES.map((pack) => (
            <article
              key={pack.id}
              className={`relative flex flex-col rounded-3xl border p-5 ${
                "featured" in pack && pack.featured ? "border-pink-400/60 bg-pink-500/10" : "border-white/10 bg-white/[0.04]"
              }`}
            >
              {"featured" in pack && pack.featured && <Badge className="absolute right-4 top-4">Popular</Badge>}
              <p className="text-sm text-muted-foreground">{pack.label}</p>
              <p className="mt-2 font-display text-3xl text-white">{pack.credits.toLocaleString("es")}</p>
              <p className="text-xs text-muted-foreground">monedas brillantes</p>
              <p className="mt-4 text-2xl font-semibold text-white">US${pack.price}</p>
              {paypalConfig.data?.configured ? (
                <PayPalCheckoutButtons
                  clientId={paypalConfig.data.clientId}
                  packageId={pack.id}
                  disabled={buy.isPending}
                  onSuccess={(credits) => {
                    toast.success(`Se acreditaron ${credits.toLocaleString("es")} monedas brillantes ❤️`);
                    account.refresh();
                    void queryClient.invalidateQueries({ queryKey: ["paypal-checkout-config"] });
                  }}
                  onError={(message) => toast.error(message)}
                />
              ) : (
                <Button className="mt-5" disabled={buy.isPending} onClick={() => buy.mutate(pack.id)}>
                  {buy.isPending ? <Loader2 className="animate-spin" /> : <CreditCard />} PayPal o tarjeta
                </Button>
              )}
            </article>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {paypalConfig.data?.configured
            ? `Checkout Business real de ${paypalConfig.data.businessName}: paga con saldo PayPal o tarjeta. Las monedas se acreditan automáticamente.`
            : "El Admin Supremo debe conectar PayPal Business en /admin para habilitar el checkout real."}
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-300" />
            <h2 className="font-display text-xl text-white">Retirar saldo</h2>
          </div>
          <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-emerald-200/70">Saldo retirable</p>
            <p className="font-display text-2xl text-white">
              US${(wallet.data ?? 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-emerald-100/60">Mínimo de retiro: US${MIN_WITHDRAWAL}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Monto (USD)</Label>
              <Input
                type="number"
                min={MIN_WITHDRAWAL}
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
                    <SelectItem key={item} value={item}>{item}</SelectItem>
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
                <Badge variant={item.status === "approved" ? "default" : item.status === "rejected" ? "destructive" : "secondary"}>
                  {item.status === "approved" ? "Aprobado" : item.status === "rejected" ? "Rechazado" : "Pendiente"}
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
