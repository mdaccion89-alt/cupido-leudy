import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/server-helpers";
import { normalizeReferralCode } from "@/lib/referral";

export const registerCupidoReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { ref: string }) => ({ ref: normalizeReferralCode(input?.ref) }))
  .handler(async ({ data, context }) => {
    if (!data.ref) return { registered: false };

    const admin = await getAdminClient();
    const { data: registered, error } = await admin.rpc("cupido_register_referral", {
      _referee: context.userId,
      _referral_code: data.ref,
    });
    if (error) throw error;
    return { registered: registered === true };
  });
