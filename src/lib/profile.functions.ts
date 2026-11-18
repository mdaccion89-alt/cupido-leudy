import { createServerFn } from "@tanstack/react-start";
import { Buffer } from "node:buffer";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "./server-helpers";

const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

export const uploadAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { base64: string; contentType: string; extension: string }) => {
    if (!input?.base64 || input.base64.length > 32_000_000)
      throw new Error("La imagen es demasiado grande.");
    if (!input.contentType.startsWith("image/")) throw new Error("Solo se permiten imágenes.");
    if (!ALLOWED_EXTENSIONS.includes(input.extension as (typeof ALLOWED_EXTENSIONS)[number]))
      throw new Error("Formato de imagen no permitido.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const admin = await getAdminClient();
    const { error: bucketError } = await admin.storage.createBucket("site", { public: true });
    if (bucketError && !/already exists|ya existe/i.test(bucketError.message)) throw bucketError;

    const base64 = data.base64.includes(",") ? (data.base64.split(",").pop() ?? "") : data.base64;
    const bytes = Buffer.from(base64, "base64");
    const path = `avatars/${context.userId}/${crypto.randomUUID()}.${data.extension}`;
    const { error: uploadError } = await admin.storage.from("site").upload(path, bytes, {
      contentType: data.contentType,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = admin.storage.from("site").getPublicUrl(path);
    const { error: updateError } = await admin
      .from("creator_profiles")
      .update({ avatar_url: publicData.publicUrl })
      .eq("id", context.userId);
    if (updateError) throw updateError;
    return { ok: true, url: publicData.publicUrl };
  });
