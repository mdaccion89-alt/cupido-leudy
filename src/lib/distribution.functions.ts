import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { paypal, paypalMessage } from "./payments.functions";
import { getAdminClient } from "./server-helpers";

const DISTRIBUTION_PRICE = "2.00";

type DistributionRecord = {
  id: string;
  userId: string;
  songId: string;
  title: string;
  voicePath: string;
  amount: string;
  status: "pending_payment" | "paid" | "approved" | "rejected";
  createdAt: string;
  paypalOrderId: string;
};

function sectionsObject(value: Json | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export const createDistributionOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { songId: string; title: string; voicePath: string; returnUrl: string }) => {
    if (!input?.songId || !input.title?.trim() || !input.voicePath)
      throw new Error("Datos de distribución no válidos.");
    if (
      !input.voicePath.startsWith(`${input.songId}/`) &&
      !input.voicePath.includes("/distributions/")
    )
      throw new Error("Ruta de voz no válida.");
    let origin: URL;
    try {
      origin = new URL(input.returnUrl);
    } catch {
      throw new Error("URL de retorno no válida.");
    }
    if (!["http:", "https:"].includes(origin.protocol))
      throw new Error("URL de retorno no válida.");
    return {
      songId: input.songId,
      title: input.title.trim().slice(0, 120),
      voicePath: input.voicePath,
      returnUrl: `${origin.origin}/perfil?distribution=1`,
      cancelUrl: `${origin.origin}/perfil?distribution=0`,
    };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<
      { ok: true; orderId: string; approveUrl: string } | { ok: false; message: string }
    > => {
      const admin = await getAdminClient();
      const { userId } = context;
      const id = crypto.randomUUID();
      try {
        const order = await paypal("/v2/checkout/orders", {
          method: "POST",
          headers: { "PayPal-Request-Id": crypto.randomUUID() },
          body: JSON.stringify({
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id: "distribution",
                description: `Distribución de "${data.title}" · Cupido Leudy ❤️`,
                amount: { currency_code: "USD", value: DISTRIBUTION_PRICE },
              },
            ],
            application_context: {
              return_url: data.returnUrl,
              cancel_url: data.cancelUrl,
              user_action: "PAY_NOW",
            },
          }),
        });
        const orderId = String(order["id"] ?? "");
        const links = (order["links"] as { rel?: string; href?: string }[] | undefined) ?? [];
        const approveUrl = links.find((l) => l.rel === "approve")?.href ?? "";
        if (!orderId || !approveUrl) throw new Error("PAYPAL_NO_ID");

        await admin.from("paypal_orders").insert({
          user_id: userId,
          package_id: "distribution",
          credits: 0,
          amount: DISTRIBUTION_PRICE,
          currency: "USD",
          paypal_order_id: orderId,
          plan_id: data.songId,
        });

        const { data: settings } = await admin
          .from("site_settings")
          .select("custom_sections")
          .eq("id", 1)
          .maybeSingle();
        const sections = sectionsObject(settings?.custom_sections as Json | undefined);
        const current = Array.isArray(sections["distributions"]) ? sections["distributions"] : [];
        const record: DistributionRecord = {
          id,
          userId,
          songId: data.songId,
          title: data.title,
          voicePath: data.voicePath,
          amount: DISTRIBUTION_PRICE,
          status: "pending_payment",
          createdAt: new Date().toISOString(),
          paypalOrderId: orderId,
        };
        await admin
          .from("site_settings")
          .update({ custom_sections: { ...sections, distributions: [...current, record] } })
          .eq("id", 1);

        return { ok: true, orderId, approveUrl };
      } catch (err) {
        return { ok: false, message: paypalMessage(err) };
      }
    },
  );

export const captureDistributionOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { orderId: string }) => {
    if (typeof input?.orderId !== "string" || !/^[A-Z0-9-]{5,40}$/i.test(input.orderId))
      throw new Error("Pedido no válido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const admin = await getAdminClient();
    const { userId } = context;
    const { data: order } = await admin
      .from("paypal_orders")
      .select("*")
      .eq("paypal_order_id", data.orderId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!order || order.package_id !== "distribution")
      return { ok: false, message: "No se encontró el pedido de distribución." };

    try {
      const captured = await paypal(
        `/v2/checkout/orders/${encodeURIComponent(data.orderId)}/capture`,
        {
          method: "POST",
          headers: { "PayPal-Request-Id": `distribution-${order.id}` },
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
        capture.amount?.value === DISTRIBUTION_PRICE;
      if (!paid) return { ok: false, message: "El pago de distribución no se completó." };

      await admin
        .from("paypal_orders")
        .update({ status: "captured", captured_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "created");

      const { data: settings } = await admin
        .from("site_settings")
        .select("custom_sections")
        .eq("id", 1)
        .maybeSingle();
      const sections = sectionsObject(settings?.custom_sections as Json | undefined);
      const items = Array.isArray(sections["distributions"]) ? sections["distributions"] : [];
      const updated = items.map((item) =>
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>)["paypalOrderId"] === data.orderId
          ? { ...(item as Record<string, unknown>), status: "paid" }
          : item,
      );
      await admin
        .from("site_settings")
        .update({ custom_sections: { ...sections, distributions: updated } })
        .eq("id", 1);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: paypalMessage(err) };
    }
  });
