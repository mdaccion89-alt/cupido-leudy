import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { findPackage } from "./credits";
import { getAdminClient } from "./server-helpers";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/paypal";

async function paypal(path: string, init: RequestInit = {}) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const paypalKey = process.env["PAYPAL_API_KEY"];
  if (!lovableKey || !paypalKey) throw new Error("PAYPAL_NOT_CONFIGURED");
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": paypalKey,
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

function paypalMessage(err: unknown) {
  const code = err instanceof Error ? err.message : "";
  if (code === "PAYPAL_NOT_CONFIGURED") return "Los pagos aún no están configurados.";
  if (code === "PAYPAL_422") return "PayPal rechazó el pago. Revisa tu método de pago.";
  return "No se pudo completar el pago con PayPal. Inténtalo de nuevo.";
}

export const createPaypalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { packageId: string }) => {
    const pack = findPackage(input?.packageId);
    if (!pack) throw new Error("Paquete no válido.");
    return { packageId: pack.id };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; orderId: string } | { ok: false; message: string }> => {
    const pack = findPackage(data.packageId)!;
    const admin = await getAdminClient();
    const { data: settings } = await admin.from("site_settings").select("purchases_enabled").eq("id", 1).maybeSingle();
    if (settings && !settings.purchases_enabled) return { ok: false, message: "Las compras están desactivadas por ahora." };
    const { data: pay } = await admin.from("payment_settings").select("paypal_email").eq("id", 1).maybeSingle();
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
              description: `${pack.credits} créditos · Leudy IA Adobe`,
              amount: { currency_code: "USD", value: pack.price },
              ...(payeeEmail ? { payee: { email_address: payeeEmail } } : {}),
            },
          ],
        }),
      });
      const orderId = String(order["id"] ?? "");
      if (!orderId) throw new Error("PAYPAL_NO_ID");
      await admin.from("paypal_orders").insert({
        user_id: context.userId,
        package_id: pack.id,
        credits: pack.credits,
        amount: pack.price,
        currency: "USD",
        paypal_order_id: orderId,
      });
      return { ok: true, orderId };
    } catch (err) {
      return { ok: false, message: paypalMessage(err) };
    }
  });

type CaptureResult = { ok: true; credits: number } | { ok: false; message: string };

export const capturePaypalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (typeof input?.orderId !== "string" || !/^[A-Z0-9-]{5,40}$/i.test(input.orderId)) throw new Error("Pedido no válido.");
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
      const captured = await paypal(`/v2/checkout/orders/${encodeURIComponent(data.orderId)}/capture`, {
        method: "POST",
        headers: { "PayPal-Request-Id": `capture-${order.id}` },
      });
      type Capture = { status?: string; amount?: { currency_code?: string; value?: string } };
      const units = (captured["purchase_units"] as { payments?: { captures?: Capture[] } }[] | undefined) ?? [];
      const capture = units[0]?.payments?.captures?.[0];
      const paid =
        captured["status"] === "COMPLETED" &&
        capture?.status === "COMPLETED" &&
        capture.amount?.currency_code === "USD" &&
        capture.amount?.value === pack.price;
      if (!paid) {
        console.error("PayPal capture mismatch", JSON.stringify(captured).slice(0, 600));
        await admin.from("paypal_orders").update({ status: "failed" }).eq("id", order.id).eq("status", "created");
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
        await admin.rpc("grant_credits", { _user_id: context.userId, _amount: pack.credits, _reason: `Compra PayPal ${pack.credits} créditos` });
      }
      return { ok: true, credits: pack.credits };
    } catch (err) {
      return { ok: false, message: paypalMessage(err) };
    }
  });
