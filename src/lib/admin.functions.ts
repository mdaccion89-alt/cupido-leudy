import { createServerFn } from "@tanstack/react-start";
import { Buffer } from "node:buffer";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ADMIN_EMAIL } from "./credits";

type AdminContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  claims?: { email?: string | null } | null;
};

async function assertAdmin({ supabase, userId, claims }: AdminContext) {
  if (claims?.email?.toLowerCase() === ADMIN_EMAIL) return;
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
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
    const [settings, profiles, credits, roles, creators] = await Promise.all([
      supabase.from("site_settings").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("profiles")
        .select("id,email,display_name,full_name,plan,plan_expires_at,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("user_credits").select("user_id,balance,daily_reset_at"),
      supabase.from("user_roles").select("user_id,role"),
      supabase
        .from("creator_profiles")
        .select("id,display_name,is_official,is_premium,follower_count"),
    ]);
    return {
      settings: (settings.data ?? {}) as Partial<AdminSettings>,
      users: (profiles.data ?? []).map((p) => ({
        ...p,
        balance: credits.data?.find((c) => c.user_id === p.id)?.balance ?? 0,
        roles: (roles.data ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
        isOfficial: creators.data?.find((c) => c.id === p.id)?.is_official ?? false,
        followers: creators.data?.find((c) => c.id === p.id)?.follower_count ?? 0,
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
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("payment_settings")
      .update({
        paypal_email: data.email,
        paypal_business_name: data.businessName,
        paypal_client_id: data.clientId,
        paypal_secret: data.secret,
        paypal_mode: data.mode,
      })
      .eq("id", 1);
    if (error) throw error;
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
