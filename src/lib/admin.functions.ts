import { createServerFn } from "@tanstack/react-start";
import { Buffer } from "node:buffer";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ADMIN_EMAIL } from "./credits";
import { getAdminClient } from "./server-helpers";

type AdminContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims?: { email?: string | null } | null;
};

function assertAdmin({ claims }: AdminContext) {
  if (claims?.email?.trim().toLowerCase() !== ADMIN_EMAIL) throw new Error("Forbidden");
}

function assertSupremeAdmin({ claims }: AdminContext) {
  if (claims?.email?.trim().toLowerCase() !== ADMIN_EMAIL) throw new Error("Forbidden");
}

export type AdminSettings = {
  site_title: string;
  site_tagline: string;
  banner_text: string;
  banner_image_url: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
};

export const getAdminSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabase } = context;
    const [settings, profiles, credits, roles, creators, loginMetadata] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("profiles")
        .select("id,email,display_name,full_name,plan,plan_expires_at,created_at,credits,credits_balance")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("user_credits").select("user_id,balance,daily_reset_at"),
      supabase.from("user_roles").select("user_id,role"),
      supabase
        .from("creator_profiles")
        .select("id,display_name,is_official,is_premium,is_verified_blue,follower_count"),
      (supabase as unknown as { from: (table: string) => any }).from("cupido_login_metadata")
        .select("user_id,country_code,language_code,last_ip"),
    ]);
    return {
      settings: (settings.data ?? {}) as Partial<AdminSettings>,
      users: (profiles.data ?? []).map((p) => ({
        ...p,
        balance:
          credits.data?.find((c) => c.user_id === p.id)?.balance ??
          p.credits_balance ??
          p.credits ??
          0,
        roles: (roles.data ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
        isOfficial: creators.data?.find((c) => c.id === p.id)?.is_official ?? false,
        isVerified: creators.data?.find((c) => c.id === p.id)?.is_verified_blue ?? false,
        followers: creators.data?.find((c) => c.id === p.id)?.follower_count ?? 0,
        countryCode: loginMetadata.data?.find((row: { user_id: string }) => row.user_id === p.id)?.country_code ?? "",
        languageCode: loginMetadata.data?.find((row: { user_id: string }) => row.user_id === p.id)?.language_code ?? "",
        lastIp: loginMetadata.data?.find((row: { user_id: string }) => row.user_id === p.id)?.last_ip ?? null,
      })),
    };
  });

export const saveAdminSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { settings: AdminSettings }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("site_settings")
      .update({
        site_title: data.settings.site_title,
        site_tagline: data.settings.site_tagline,
        banner_text: data.settings.banner_text,
        banner_image_url: data.settings.banner_image_url,
        logo_url: data.settings.logo_url,
        primary_color: data.settings.primary_color,
        accent_color: data.settings.accent_color,
      })
      .eq("id", 1);
    if (error) throw error;
    return { ok: true };
  });

export const uploadSiteAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string; contentType: string; base64: string }) => {
    if (!input?.path.startsWith("identity/") || input.path.includes(".."))
      throw new Error("Ruta de imagen no válida.");
    if (!input.contentType.startsWith("image/")) throw new Error("Solo se permiten imágenes.");
    if (!input.base64 || input.base64.length > 32_000_000)
      throw new Error("La imagen es demasiado grande.");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const base64 = data.base64.includes(",") ? (data.base64.split(",").pop() ?? "") : data.base64;
    const bytes = Buffer.from(base64, "base64");
    const path = `${context.userId}/${data.path}`;
    const { error } = await context.supabase.storage.from("media").upload(path, bytes, {
      contentType: data.contentType,
      upsert: true,
    });
    if (error) throw error;
    const { data: publicData } = context.supabase.storage.from("media").getPublicUrl(path);
    return { ok: true, url: publicData.publicUrl };
  });

export type PaypalBusinessInput = {
  email: string;
  businessName: string;
  clientId: string;
  secret: string;
  mode: "sandbox" | "live";
};

export type PaypalBusinessSettingsResult = PaypalBusinessInput & {
  configured: boolean;
  source: "supabase" | "environment" | "missing";
};

export const getPaypalBusinessSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaypalBusinessSettingsResult> => {
    assertSupremeAdmin(context);
    const db = await getAdminClient() as unknown as { from: (table: string) => any };
    const paymentResult = await db.from("payment_settings")
      .select("business_name,paypal_business_name,paypal_email,admin_paypal_email,paypal_client_id,paypal_secret,paypal_mode")
      .eq("id", 1).maybeSingle();
    const paymentFallback = paymentResult.error
      ? await db.from("payment_settings").select("paypal_business_name,paypal_email,paypal_client_id,paypal_secret,paypal_mode").eq("id", 1).maybeSingle()
      : paymentResult;
    const appResult = await db.from("app_settings")
      .select("business_name,paypal_email,admin_paypal_email,paypal_client_id,paypal_mode,config")
      .eq("id", 1).maybeSingle();
    const appFallback = appResult.error
      ? await db.from("app_settings").select("paypal_email,config").eq("id", 1).maybeSingle()
      : appResult;
    if (paymentFallback.error && appFallback.error) {
      throw new Error(`No se pudo leer la configuración PayPal: ${paymentFallback.error.message}; ${appFallback.error.message}`);
    }
    const payment = paymentFallback.data as Record<string, unknown> | null;
    const app = appFallback.data as Record<string, unknown> | null;
    const config = app?.["config"] && typeof app["config"] === "object"
      ? app["config"] as Record<string, unknown>
      : {};
    const first = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
    const databaseClientId = first(payment?.["paypal_client_id"], app?.["paypal_client_id"], config["paypal_client_id"], config["paypalClientId"], config["clientId"]);
    const databaseSecret = first(payment?.["paypal_secret"], config["paypal_secret"], config["paypalSecret"]);
    const environmentClientId = first(process.env["PAYPAL_CLIENT_ID"], import.meta.env["VITE_PAYPAL_CLIENT_ID"]);
    const environmentSecret = first(process.env["PAYPAL_SECRET"]);
    const clientId = databaseClientId || environmentClientId;
    const secret = databaseSecret || environmentSecret;
    const configured = Boolean(clientId && secret);
    return {
      email: first(payment?.["paypal_email"], payment?.["admin_paypal_email"], app?.["paypal_email"], app?.["admin_paypal_email"], config["paypal_email"], config["admin_paypal_email"]),
      businessName: first(payment?.["business_name"], payment?.["paypal_business_name"], app?.["business_name"], config["business_name"], config["paypal_business_name"], config["businessName"]),
      clientId,
      secret,
      mode: first(payment?.["paypal_mode"], app?.["paypal_mode"], config["paypal_mode"], config["mode"]) === "sandbox" ? "sandbox" : "live",
      configured,
      source: databaseClientId || databaseSecret ? "supabase" : configured ? "environment" : "missing",
    };
  });

export const savePaypalBusinessSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: PaypalBusinessInput) => {
    const email = input?.email?.trim() ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Escribe un correo PayPal válido.");
    return {
      email,
      businessName: (input.businessName ?? "").trim().slice(0, 120),
      clientId: (input.clientId ?? "").trim().slice(0, 240),
      secret: (input.secret ?? "").trim().slice(0, 240),
      mode: input.mode === "sandbox" ? "sandbox" : "live",
    };
  })
  .handler(async ({ data, context }) => {
    assertSupremeAdmin(context);
    const admin = await getAdminClient() as unknown as {
      from: (table: string) => { upsert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }> };
    };
    const config = {
      business_name: data.businessName,
      paypal_business_name: data.businessName,
      paypal_email: data.email,
      admin_paypal_email: data.email,
      paypal_client_id: data.clientId,
      paypal_mode: data.mode,
    };
    const paymentBase = { id: 1, ...config, paypal_secret: data.secret };
    let paymentSaved = false;
    let paymentError = "";
    for (const payload of [
      paymentBase,
      { id: 1, paypal_email: data.email, paypal_business_name: data.businessName, paypal_client_id: data.clientId, paypal_secret: data.secret, paypal_mode: data.mode },
    ]) {
      const { error } = await admin.from("payment_settings").upsert(payload);
      if (!error) {
        paymentSaved = true;
        break;
      }
      paymentError = paymentError || error.message;
    }
    if (!paymentSaved) throw new Error(`payment_settings: ${paymentError || "No se pudo guardar PayPal Business."}`);

    let appSaved = false;
    let appError = "";
    const appConfig = {
      business_name: data.businessName,
      paypal_business_name: data.businessName,
      paypal_email: data.email,
      admin_paypal_email: data.email,
      paypal_client_id: data.clientId,
      paypal_mode: data.mode,
    };
    for (const payload of [
      { id: 1, ...appConfig, config: appConfig },
      { id: 1, paypal_email: data.email, paypal_client_id: data.clientId, paypal_mode: data.mode, config: appConfig },
      { id: 1, paypal_email: data.email, config: appConfig },
    ]) {
      const { error } = await admin.from("app_settings").upsert(payload);
      if (!error) {
        appSaved = true;
        break;
      }
      appError = appError || error.message;
    }
    if (!appSaved) throw new Error(`app_settings: ${appError || "No se pudo guardar PayPal Business."}`);
    return { ok: true };
  });

export const adminAdjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; delta: number }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("admin_adjust_credits", {
      _user_id: data.userId,
      _delta: data.delta,
    });
    if (error) throw error;
    return { ok: true };
  });

export const adminSetPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; plan: "free" | "pro" | "premium"; days: number }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("admin_set_plan", {
      _user_id: data.userId,
      _plan: data.plan,
      _days: data.days,
    });
    if (error) throw error;
    return { ok: true };
  });
