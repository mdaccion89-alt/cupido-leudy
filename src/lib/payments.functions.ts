import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findPackage } from "./credits";
import { getAdminClient } from "./server-helpers";

const PAYPAL_API_BASE =
  process.env["PAYPAL_API_BASE"] ??
  (process.env["PAYPAL_MODE"] === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com");

let cachedToken: { value: string; expiresAt: number } | undefined;

async function paypalToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const clientId = process.env["PAYPAL_CLIENT_ID"];
  const secret = process.env["PAYPAL_SECRET"];
  if (!clientId || !secret) throw new Error("PAYPAL_NOT_CONFIGURED");
  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
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
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export async function paypal(path: string, init: RequestInit = {}) {
  const token = await paypalToken();
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
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
  if (code === "PAYPAL_NOT_CONFIGURED") return "Los pagos aún no están configurados.";
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
      const { data: pay } = await admin
        .from("payment_settings")
        .select("paypal_email")
        .eq("id", 1)
        .maybeSingle();
      const payeeEmail = pay?.paypal_email?.trim();
      try {
        const order = await paypal("/v2/checkout/orders", {
          method: "POST",
          headers: { "PayPal-Request-Id": crypto.randomUUID() },
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id: pack.id,
                description: `${pack.credits} créditos · Cupido Leudy`,
                amount: { currency_code: "USD", value: pack.price },
                ...(payeeEmail ? { payee: { email_address: payeeEmail } } : {}),
              },
            ],
            ...(data.returnUrl
              ? {
                  application_context: {
                    return_url: data.returnUrl,
                    cancel_url: data.returnUrl,
                    user_action: "PAY_NOW",
                  },
                }
              : {}),
          }),
        });
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

type CaptureResult = { ok: true; credits: number } | { ok: false; message: string };

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
    if (order.status === "captured") return { ok: true, credits: order.credits };
    const pack = findPackage(order.package_id);
    if (!pack) return { ok: false, message: "Paquete no válido." };

    try {
      const captured = await paypal(
        `/v2/checkout/orders/${encodeURIComponent(data.orderId)}/capture`,
        {
          method: "POST",
          headers: { "PayPal-Request-Id": `capture-${order.id}` },
        },
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
        await admin.rpc("grant_credits", {
          _user_id: context.userId,
          _amount: pack.credits,
          _reason: `Compra PayPal ${pack.credits} créditos`,
        });
      }
      return { ok: true, credits: pack.credits };
    } catch (err) {
      return { ok: false, message: paypalMessage(err) };
    }
  });
