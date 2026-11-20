import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/server-helpers";
import { isValidReferralId } from "@/lib/referral";

export const registerCupidoReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ref: string }) => ({ ref: typeof input?.ref === "string" ? input.ref.trim() : "" }))
  .handler(async ({ data, context }) => {
    const ref = data.ref;
    if (!isValidReferralId(ref) || ref === context.userId) return { registered: false };

    const admin = await getAdminClient();
    const { data: referrer } = await admin.from("profiles").select("id").eq("id", ref).maybeSingle();
    if (!referrer) return { registered: false };

    const { error: profileError } = await admin
      .from("profiles")
      .update({ referred_by: ref })
      .eq("id", context.userId)
      .is("referred_by", null);
    if (profileError) throw profileError;

    const { error: referralError } = await admin
      .from("cupido_referrals")
      .upsert({ referee_id: context.userId, referrer_id: ref }, { onConflict: "referee_id", ignoreDuplicates: true });
    if (referralError) throw referralError;

    return { registered: true };
  });
