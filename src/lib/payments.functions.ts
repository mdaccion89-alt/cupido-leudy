import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findPackage } from "./credits";
import { getAdminClient } from "./server-helpers";

type PaypalConfig = {
  apiBase: string;
  clientId: string;
  secret: string;
  email: string;
  businessName: string;
  paypalMeLink: string;
  mode: "sandbox" | "live";
};

let cachedToken: { key: string; value: string; expiresAt: number } | undefined;

async function getPaypalConfig(): Promise<PaypalConfig> {
  const admin = await getAdminClient();
  const db = admin as unknown as { from: (table: string) => any };
  let payment = await db
    .from("payment_settings")
    .select(
      "id,business_name,paypal_business_name,paypal_email,admin_paypal_email,paypal_client_id,paypal_secret,paypal_mode",
    )
    .eq("id", 1)
    .maybeSingle();
  if (payment.error) {
    payment = await db
      .from("payment_settings")
      .select("id,paypal_business_name,paypal_email,paypal_client_id,paypal_secret,paypal_mode")
      .eq("id", 1)
      .maybeSingle();
  }
  const data = payment.data;
  let appQuery = await db
    .from("app_settings")
    .select(
      "id,business_name,paypal_email,admin_paypal_email,paypal_client_id,paypal_secret,paypal_mode,paypal_me_link,config",
    )
    .eq("id", 1)
    .maybeSingle();
  if (appQuery.error) {
    appQuery = await db.from("app_settings").select("id,paypal_email,paypal_me_link,config").eq("id", 1).maybeSingle();
  }
  const appData = appQuery.data;
  const app = appData as
    | {
        business_name?: string | null;
        paypal_email?: string | null;
        admin_paypal_email?: string | null;
        paypal_client_id?: string | null;
        paypal_secret?: string | null;
        paypal_mode?: string | null;
        paypal_me_link?: string | null;
        config?: Record<string, unknown> | null;
      }
    | null;
  const config = app?.config ?? {};
  const fromConfig = (...keys: string[]) => {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  const mode: "sandbox" | "live" =
    data?.paypal_mode === "sandbox" ||
    app?.paypal_mode === "sandbox" ||
    fromConfig("paypal_mode", "mode") === "sandbox"
      ? "sandbox"
      : "live";
  const apiBase =
    process.env["PAYPAL_API_BASE"] ??
    (mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
  return {
    apiBase,
    clientId:
      data?.paypal_client_id?.trim() ||
      app?.paypal_client_id?.trim() ||
      fromConfig("paypal_client_id", "paypalClientId", "clientId") ||
      process.env["PAYPAL_CLIENT_ID"] ||
      "",
    secret:
      data?.paypal_secret?.trim() ||
      app?.paypal_secret?.trim() ||
      fromConfig("paypal_secret", "paypalSecret") ||
      process.env["PAYPAL_SECRET"] ||
      "",
    email:
      data?.paypal_email?.trim() ||
      data?.admin_paypal_email?.trim() ||
      app?.paypal_email?.trim() ||
      app?.admin_paypal_email?.trim() ||
      fromConfig("paypal_email", "admin_paypal_email") ||
      "",
    businessName:
      data?.business_name?.trim() ||
      data?.paypal_business_name?.trim() ||
      app?.business_name?.trim() ||
      fromConfig("business_name", "paypal_business_name", "businessName") ||
      "Cupido Leudy ❤️",
    paypalMeLink: app?.paypal_me_link?.trim() || fromConfig("paypal_me_link", "paypalMeLink") || "",
    mode,
  };
}

export type PublicPaypalConfig = {
  configured: boolean;
  clientId: string;
  mode: "sandbox" | "live";
  businessName: string;
  email: string;
  paypalMeLink: string;
};

export const getPaypalCheckoutConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicPaypalConfig> => {
    const config = await getPaypalConfig();
    return {
      configured: Boolean(config.clientId && config.secret),
      clientId: config.clientId,
      mode: config.mode,
      businessName: config.businessName,
      email: config.email,
      paypalMeLink: config.paypalMeLink,
    };
  },
);

async function paypalToken(config: PaypalConfig) {
  const key = `${config.mode}:${config.clientId}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now() + 30_000)
    return cachedToken.value;
  if (!config.clientId || !config.secret) throw new Error("PAYPAL_NOT_CONFIGURED");
  const basic = Buffer.from(`${config.clientId}:${config.secret}`).toString("base64");
  const res = await fetch(`${config.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    console.error(`PayPal token failed [${res.status}]: ${(await res.text()).slice(0, 400)}`);
    throw new Error(`PAYPAL_${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("PAYPAL_NO_TOKEN");
  cachedToken = {
    key,
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export async function paypal(path: string, init: RequestInit = {}, config?: PaypalConfig) {
  const activeConfig = config ?? (await getPaypalConfig());
  const token = await paypalToken(activeConfig);
  const res = await fetch(`${activeConfig.apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`PayPal ${path} failed [${res.status}]: ${text.slice(0, 600)}`);
    throw new Error(`PAYPAL_${res.status}`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export function paypalMessage(err: unknown) {
  const code = err instanceof Error ? err.message : "";
  if (code === "PAYPAL_NOT_CONFIGURED")
    return "El Admin Supremo debe configurar PayPal Business en el panel Admin antes de comprar.";
  if (code === "PAYPAL_422") return "PayPal rechazó el pago. Revisa tu método de pago.";
  return "No se pudo completar el pago con PayPal. Inténtalo de nuevo.";
}

export const createPaypalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { packageId: string; returnUrl?: string }) => {
    const pack = findPackage(input?.packageId);
    if (!pack) throw new Error("Paquete no válido.");
    let returnUrl: string | null = null;
    if (input.returnUrl) {
      try {
        const url = new URL(input.returnUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad");
        returnUrl = url.toString();
      } catch {
        throw new Error("URL de retorno no válida.");
      }
    }
    return { packageId: pack.id, returnUrl };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; orderId: string; approveUrl: string } | { ok: false; message: string }> => {
      const pack = findPackage(data.packageId)!;
      const admin = await getAdminClient();
      const { data: settings } = await admin
        .from("site_settings")
        .select("purchases_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (settings && !settings.purchases_enabled)
        return { ok: false, message: "Las compras están desactivadas por ahora." };
      const config = await getPaypalConfig();
      try {
        const order = await paypal("/v2/checkout/orders", {
          method: "POST",
          headers: { "PayPal-Request-Id": crypto.randomUUID() },
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id: pack.id,
                description: `${pack.credits.toLocaleString("es")} monedas brillantes · Cupido Leudy`,
                amount: { currency_code: "USD", value: pack.price },
                ...(config.email ? { payee: { email_address: config.email } } : {}),
              },
            ],
            application_context: {
              ...(data.returnUrl ? { return_url: data.returnUrl, cancel_url: data.returnUrl } : {}),
              user_action: "PAY_NOW",
            },
          }),
        }, config);
        const orderId = String(order["id"] ?? "");
        if (!orderId) throw new Error("PAYPAL_NO_ID");
        const links = (order["links"] as { href?: string; rel?: string }[] | undefined) ?? [];
        const approveUrl =
          links.find((link) => link.rel === "approve")?.href ??
          `https://www.paypal.com/checkoutnow?token=${orderId}`;
        await admin.from("paypal_orders").insert({
          user_id: context.userId,
          package_id: pack.id,
          credits: pack.credits,
          amount: pack.price,
          currency: "USD",
          paypal_order_id: orderId,
        });
        return { ok: true, orderId, approveUrl };
      } catch (err) {
        return { ok: false, message: paypalMessage(err) };
      }
    },
  );

type CaptureResult = { ok: true; credits: number; hasPurchased: boolean } | { ok: false; message: string };

export const capturePaypalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (typeof input?.orderId !== "string" || !/^[A-Z0-9-]{5,40}$/i.test(input.orderId))
      throw new Error("Pedido no válido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<CaptureResult> => {
    const admin = await getAdminClient();
    const { data: order } = await admin
      .from("paypal_orders")
      .select("*")
      .eq("paypal_order_id", data.orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) return { ok: false, message: "No se encontró el pedido." };
    if (order.status === "captured") return { ok: true, credits: order.credits, hasPurchased: true };
    const pack = findPackage(order.package_id);
    if (!pack) return { ok: false, message: "Paquete no válido." };

    try {
      const config = await getPaypalConfig();
      const captured = await paypal(
        `/v2/checkout/orders/${encodeURIComponent(data.orderId)}/capture`,
        {
          method: "POST",
          headers: { "PayPal-Request-Id": `capture-${order.id}` },
        },
        config,
      );
      type Capture = { status?: string; amount?: { currency_code?: string; value?: string } };
      const units =
        (captured["purchase_units"] as { payments?: { captures?: Capture[] } }[] | undefined) ?? [];
      const capture = units[0]?.payments?.captures?.[0];
      const paid =
        captured["status"] === "COMPLETED" &&
        capture?.status === "COMPLETED" &&
        capture.amount?.currency_code === "USD" &&
        capture.amount?.value === pack.price;
      if (!paid) {
        console.error("PayPal capture mismatch", JSON.stringify(captured).slice(0, 600));
        await admin
          .from("paypal_orders")
          .update({ status: "failed" })
          .eq("id", order.id)
          .eq("status", "created");
        return { ok: false, message: "El pago no se completó." };
      }
      const { data: claimed } = await admin
        .from("paypal_orders")
        .update({ status: "captured", captured_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "created")
        .select("id")
        .maybeSingle();
      if (claimed) {
        const { data: granted } = await admin.rpc("grant_credits", {
          _user_id: context.userId,
          _amount: pack.credits,
          _reason: `Compra PayPal ${pack.credits} créditos`,
        });
        const { data: profile } = await admin
          .from("profiles")
          .select("credits")
          .eq("id", context.userId)
          .maybeSingle();
        const nextCredits =
          Number(granted) > 0 ? Number(granted) : Number(profile?.credits ?? 0) + pack.credits;
        await admin
          .from("profiles")
          .update({ credits: nextCredits, has_purchased: true })
          .eq("id", context.userId);
      }
      return { ok: true, credits: pack.credits, hasPurchased: true };
    } catch (err) {
      return { ok: false, message: paypalMessage(err) };
    }
  });
