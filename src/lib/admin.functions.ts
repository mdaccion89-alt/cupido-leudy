import { createServerFn } from "@tanstack/react-start";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { getAdminClient } from "./server-helpers";

type AdminContext = { supabase: SupabaseClient<Database>; userId: string };

async function assertAdmin({ supabase, userId }: AdminContext) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

function sectionsObject(value: Json | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function persistEnv(updates: Record<string, string>) {
  const file = path.resolve(process.cwd(), ".env.local");
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    text = "";
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!value.trim()) continue;
    process.env[key] = value;
    const safe = value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text)
      ? text.replace(pattern, `${key}=${safe}`)
      : `${text.trimEnd()}\n${key}=${safe}`;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${text.trim()}\n`, { encoding: "utf8", mode: 0o600 });
}

export type AdminSettings = {
  site_title: string;
  site_tagline: string;
  banner_text: string;
  banner_image_url: string;
  logo_url: string;
  primary_color: string;
  accent_color: string;
  songs_enabled: boolean;
  covers_enabled: boolean;
  videos_enabled: boolean;
  purchases_enabled: boolean;
  gallery_enabled: boolean;
};

export const getAdminSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabase } = context;
    const [settings, profiles, credits, roles, creators, pending, payments] = await Promise.all([
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
      supabase
        .from("songs")
        .select("id,title,kind,user_id,status,review_status,created_at,prompt")
        .eq("review_status", "pending")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("payment_settings").select("paypal_email").eq("id", 1).maybeSingle(),
    ]);
    const sections = sectionsObject(settings.data?.custom_sections as Json | undefined);
    const distributions = Array.isArray(sections["distributions"]) ? sections["distributions"] : [];
    const distributionsWithVoice = await Promise.all(
      distributions.map(async (item) => {
        if (!item || typeof item !== "object") return item;
        const record = item as Record<string, unknown>;
        const voicePath = typeof record["voicePath"] === "string" ? record["voicePath"] : "";
        if (!voicePath) return item;
        const { data: signed } = await supabase.storage
          .from("uploads")
          .createSignedUrl(voicePath, 3600);
        return { ...record, voiceUrl: signed?.signedUrl ?? "" };
      }),
    );
    return {
      settings: (settings.data ?? {}) as Partial<AdminSettings>,
      users: (profiles.data ?? []).map((p) => ({
        ...p,
        balance: credits.data?.find((c) => c.user_id === p.id)?.balance ?? 0,
        roles: (roles.data ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
        isOfficial: creators.data?.find((c) => c.id === p.id)?.is_official ?? false,
        followers: creators.data?.find((c) => c.id === p.id)?.follower_count ?? 0,
      })),
      pending: pending.data ?? [],
      paypalEmail: payments.data?.paypal_email ?? "",
      distributions: distributionsWithVoice,
      secrets: {
        fal: Boolean(process.env["FAL_KEY"]),
        huggingFace: Boolean(process.env["HF_TOKEN"]),
        openai: Boolean(process.env["OPENAI_API_KEY"]),
        paypalClient: Boolean(process.env["PAYPAL_CLIENT_ID"] && process.env["PAYPAL_SECRET"]),
      },
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
        songs_enabled: data.settings.songs_enabled,
        covers_enabled: data.settings.covers_enabled,
        videos_enabled: data.settings.videos_enabled,
        purchases_enabled: data.settings.purchases_enabled,
        gallery_enabled: data.settings.gallery_enabled,
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
    const admin = await getAdminClient();
    const { error: bucketError } = await admin.storage.createBucket("site", { public: true });
    if (bucketError && !/already exists|ya existe/i.test(bucketError.message)) throw bucketError;
    const base64 = data.base64.includes(",") ? (data.base64.split(",").pop() ?? "") : data.base64;
    const bytes = Buffer.from(base64, "base64");
    const { error } = await admin.storage.from("site").upload(data.path, bytes, {
      contentType: data.contentType,
      upsert: true,
    });
    if (error) throw error;
    const { data: publicData } = admin.storage.from("site").getPublicUrl(data.path);
    return { ok: true, url: publicData.publicUrl };
  });

export const savePaypalEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { email: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("payment_settings")
      .update({ paypal_email: data.email.trim() })
      .eq("id", 1);
    if (error) throw error;
    return { ok: true };
  });

export const saveIntegrationSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      paypalClientId?: string;
      paypalSecret?: string;
      falKey?: string;
      huggingFaceToken?: string;
      openaiKey?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    await persistEnv({
      PAYPAL_CLIENT_ID: data.paypalClientId ?? "",
      PAYPAL_SECRET: data.paypalSecret ?? "",
      FAL_KEY: data.falKey ?? "",
      HF_TOKEN: data.huggingFaceToken ?? "",
      OPENAI_API_KEY: data.openaiKey ?? "",
    });
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

export const reviewSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { songId: string; approve: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("admin_review_cover", {
      _song_id: data.songId,
      _approve: data.approve,
    });
    if (error) throw error;
    return { ok: true };
  });

export const reviewDistribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; approve: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: settings } = await context.supabase
      .from("site_settings")
      .select("custom_sections")
      .eq("id", 1)
      .maybeSingle();
    const sections = sectionsObject(settings?.custom_sections as Json | undefined);
    const items = Array.isArray(sections["distributions"]) ? sections["distributions"] : [];
    const updated = items.map((item) => {
      if (!item || typeof item !== "object" || (item as Record<string, unknown>)["id"] !== data.id)
        return item;
      return {
        ...(item as Record<string, unknown>),
        status: data.approve ? "approved" : "rejected",
        reviewed_at: new Date().toISOString(),
      };
    });
    const { error } = await context.supabase
      .from("site_settings")
      .update({ custom_sections: { ...sections, distributions: updated } })
      .eq("id", 1);
    if (error) throw error;
    return { ok: true };
  });
