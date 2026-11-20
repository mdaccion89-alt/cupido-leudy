import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Gift, Loader2, ShieldCheck, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { supabase } from "@/integrations/supabase/client";
import { savePaypalBusinessSettings, type PaypalBusinessInput } from "@/lib/admin.functions";
import { countryFlag, countryName } from "@/lib/cupido";

const LIVE_POSES = ["Frente", "Derecha", "Izquierda"];

type VerificationRow = {
  id: string;
  display_name: string;
  avatar_url: string;
  selfie_path: string;
  verification_frames: string[];
  country_code: string;
  verification_status: string;
  is_verified_blue: boolean;
  email?: string | null;
};

type WithdrawalRow = {
  id: string;
  user_id: string;
  amount: number;
  country_code: string;
  method: string;
  account_details: string;
  status: string;
  created_at: string;
};

type GiftRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  gift_id: string;
  credits: number;
  cash_value: number;
  created_at: string;
};

export function CupidoAdminPanel() {
  const queryClient = useQueryClient();
  const savePaypal = useServerFn(savePaypalBusinessSettings);
  const [paypalConfig, setPaypalConfig] = useState<PaypalBusinessInput>({
    email: "",
    businessName: "",
    clientId: "",
    secret: "",
    mode: "live",
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cupido-admin"] });
  };

  const verifications = useQuery({
    queryKey: ["cupido-admin", "verifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select("id,display_name,avatar_url,selfie_path,verification_frames,country_code,verification_status,is_verified_blue")
        .eq("verification_status", "pending")
        .order("display_name");
      if (error) throw error;
      const emails = data?.length
        ? await supabase.from("profiles").select("id,email").in("id", data.map((row) => row.id))
        : { data: [], error: null };
      if (emails.error) throw emails.error;
      const map = new Map((emails.data ?? []).map((row) => [row.id, row.email]));
      return (data ?? []).map((row) => ({ ...row, email: map.get(row.id) ?? null })) as VerificationRow[];
    },
  });

  const withdrawals = useQuery({
    queryKey: ["cupido-admin", "withdrawals"],
    enabled: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_withdrawals")
        .select("id,user_id,amount,country_code,method,account_details,status,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WithdrawalRow[];
    },
  });

  const gifts = useQuery({
    queryKey: ["cupido-admin", "gifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cupido_gift_sends")
        .select("id,sender_id,receiver_id,gift_id,credits,cash_value,created_at")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as GiftRow[];
    },
  });

  const paypal = useQuery({
    queryKey: ["cupido-admin", "paypal"],
    queryFn: async () => {
      const { data } = await supabase
        .from("payment_settings")
        .select("paypal_email,paypal_business_name,paypal_client_id,paypal_secret,paypal_mode")
        .eq("id", 1)
        .maybeSingle();
      const next = {
        email: data?.paypal_email ?? "",
        businessName: data?.paypal_business_name ?? "",
        clientId: data?.paypal_client_id ?? "",
        secret: data?.paypal_secret ?? "",
        mode: data?.paypal_mode === "sandbox" ? ("sandbox" as const) : ("live" as const),
      };
      setPaypalConfig(next);
      return next;
    },
  });

  const reviewVerification = useMutation({
    mutationFn: async ({ userId, approve }: { userId: string; approve: boolean }) => {
      const { error } = await supabase.rpc("cupido_review_verification", {
        _user_id: userId,
        _approve: approve,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.approve ? "Insignia azul aprobada." : "Verificación rechazada.");
      invalidate();
    },
    onError: () => toast.error("No se pudo revisar la verificación."),
  });

  const reviewWithdrawal = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc("cupido_review_withdrawal", { _id: id, _approve: approve });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.approve ? "Retiro aprobado y enviado." : "Retiro rechazado; saldo devuelto.");
      invalidate();
    },
    onError: () => toast.error("No se pudo revisar el retiro."),
  });

  const savePaypalConfig = useMutation({
    mutationFn: async () => {
      await savePaypal({ data: paypalConfig });
    },
    onSuccess: () => {
      toast.success("Configuración PayPal Business actualizada.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo guardar PayPal."),
  });

  const selfieUrl = async (path: string) => {
    if (!path) return "";
    const { data } = await supabase.storage.from("cupido-private").createSignedUrl(path, 300);
    return data?.signedUrl ?? "";
  };

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-pink-400/20 bg-pink-500/[0.06] p-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-5 text-pink-300" />
          <div>
            <h2 className="font-display text-lg text-white">Selfies pendientes / Revisiones</h2>
            <p className="text-xs text-muted-foreground">
              Revisa las 3 capturas en vivo de cada usuario y decide quién recibe la insignia azul.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(verifications.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay verificaciones pendientes.</p>
          ) : (
            verifications.data!.map((row) => (
              <div key={row.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-pink-500/20 text-sm text-pink-100">
                    {row.avatar_url ? (
                      <img src={row.avatar_url} alt="" className="size-full object-cover" />
                    ) : (
                      row.display_name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-sm font-medium text-white">
                      {row.display_name}
                      <VerifiedBadge email={row.email} verified={row.is_verified_blue} className="size-4" />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {countryFlag(row.country_code)} {countryName(row.country_code)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(row.verification_frames.length === 3 ? row.verification_frames : [row.selfie_path]).map(
                    (path, index) => (
                      <div key={`${row.id}-${index}`}>
                        <p className="mb-1 text-center text-[11px] text-sky-200">
                          {LIVE_POSES[index] ?? "Captura"}
                        </p>
                        <SelfiePreview path={path} load={selfieUrl} compact />
                      </div>
                    ),
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={reviewVerification.isPending}
                    onClick={() => reviewVerification.mutate({ userId: row.id, approve: true })}
                  >
                    <Check className="size-4" /> Aprobar
                  </Button>
                  <Button
                    size="sm"
                    variant="glass"
                    className="flex-1"
                    disabled={reviewVerification.isPending}
                    onClick={() => reviewVerification.mutate({ userId: row.id, approve: false })}
                  >
                    <X className="size-4" /> Rechazar
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-amber-400/20 bg-amber-500/[0.06] p-5">
        <div className="flex items-center gap-3">
          <Wallet className="size-5 text-amber-300" />
          <div>
            <h2 className="font-display text-lg text-white">Retiros pendientes</h2>
            <p className="text-xs text-muted-foreground">Saldo generado por regalos recibidos.</p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {(withdrawals.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay retiros pendientes.</p>
          ) : (
            withdrawals.data!.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    US${Number(row.amount).toFixed(2)} · {row.method}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {countryFlag(row.country_code)} {countryName(row.country_code)} · {row.account_details}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={reviewWithdrawal.isPending}
                    onClick={() => reviewWithdrawal.mutate({ id: row.id, approve: true })}
                  >
                    <Check className="size-4" /> Pagar
                  </Button>
                  <Button
                    size="sm"
                    variant="glass"
                    disabled={reviewWithdrawal.isPending}
                    onClick={() => reviewWithdrawal.mutate({ id: row.id, approve: false })}
                  >
                    <X className="size-4" /> Rechazar
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <Gift className="size-5 text-violet-300" />
            <h2 className="font-display text-lg text-white">Últimos regalos</h2>
          </div>
          <div className="mt-4 space-y-2">
            {(gifts.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay regalos enviados.</p>
            ) : (
              gifts.data!.map((gift) => (
                <div key={gift.id} className="flex justify-between gap-3 rounded-xl bg-black/20 px-3 py-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {gift.gift_id} · {gift.sender_id.slice(0, 8)} → {gift.receiver_id.slice(0, 8)}
                  </span>
                  <span className="shrink-0 text-white">
                    {gift.credits.toLocaleString("es")} cr · US${Number(gift.cash_value).toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <Wallet className="size-5 text-emerald-300" />
            <h2 className="font-display text-lg text-white">Integraciones PayPal Business (Checkout Real)</h2>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Los pagos de créditos y tarjeta llegan a esta cuenta Business. Nunca compartas el secreto de PayPal.
          </p>
          <div className="mt-4 space-y-2">
            <Label htmlFor="cupido-paypal-business">Nombre del negocio</Label>
            <Input
              id="cupido-paypal-business"
              value={paypalConfig.businessName}
              onChange={(event) => setPaypalConfig((current) => ({ ...current, businessName: event.target.value }))}
              placeholder="Cupido Leudy"
            />
            <Label htmlFor="cupido-paypal-email">Correo Business</Label>
            <Input
              id="cupido-paypal-email"
              type="email"
              value={paypalConfig.email}
              onChange={(event) => setPaypalConfig((current) => ({ ...current, email: event.target.value }))}
              placeholder="pagos@cupidoleudy.com"
            />
            <Label htmlFor="cupido-paypal-client">Client ID</Label>
            <Input
              id="cupido-paypal-client"
              value={paypalConfig.clientId}
              onChange={(event) => setPaypalConfig((current) => ({ ...current, clientId: event.target.value }))}
              placeholder="Client ID de la app PayPal"
            />
            <Label htmlFor="cupido-paypal-secret">Secret</Label>
            <Input
              id="cupido-paypal-secret"
              type="password"
              value={paypalConfig.secret}
              onChange={(event) => setPaypalConfig((current) => ({ ...current, secret: event.target.value }))}
              placeholder="Secreto de la app PayPal"
            />
            <Label htmlFor="cupido-paypal-mode">Modo</Label>
            <select
              id="cupido-paypal-mode"
              value={paypalConfig.mode}
              onChange={(event) =>
                setPaypalConfig((current) => ({
                  ...current,
                  mode: event.target.value === "sandbox" ? "sandbox" : "live",
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="live">Live (producción)</option>
              <option value="sandbox">Sandbox (pruebas)</option>
            </select>
            {paypal.isLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Cargando configuración…
              </p>
            ) : null}
            <Button
              className="mt-2"
              disabled={savePaypalConfig.isPending}
              onClick={() => savePaypalConfig.mutate()}
            >
              Guardar PayPal Business
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SelfiePreview({
  path,
  load,
  compact = false,
}: {
  path: string;
  load: (path: string) => Promise<string>;
  compact?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!path || ready) return;
    setReady(true);
    void load(path).then(setUrl);
  }, [path, ready, load]);

  return (
    <div className={`${compact ? "h-24" : "mt-3 h-32"} flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30`}>
      {url ? (
        <img src={url} alt="Selfie de verificación" className="h-full object-contain" />
      ) : (
        <span className="px-3 text-center text-xs text-muted-foreground">
          {path ? "Selfie privada disponible para revisión." : "El usuario no envió selfie."}
        </span>
      )}
    </div>
  );
}
