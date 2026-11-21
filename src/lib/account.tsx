import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettings, type PublicSettings } from "./studio.functions";
import { useAuth } from "./auth-context";
import { SLOGAN } from "./cupido";

const IMMEDIATE_ADMIN_EMAIL = "leudyfeliz81@gmail.com";

export function isSupremeAdminEmail(email?: string | null): boolean {
  return email?.toLowerCase() === IMMEDIATE_ADMIN_EMAIL;
}

export const OFFICIAL_FOLLOWER_BONUS = 40_000;

export function displayedFollowerCount(
  realCount?: number | null,
  email?: string | null,
  isOfficialProfile?: boolean,
): number {
  const real = Math.max(0, Math.floor(Number(realCount) || 0));
  return isSupremeAdminEmail(email) || isOfficialProfile ? real + OFFICIAL_FOLLOWER_BONUS : real;
}

export function useAccount() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const isImmediateAdmin = session?.user.email?.toLowerCase() === IMMEDIATE_ADMIN_EMAIL;
  const query = useQuery({
    queryKey: ["account", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      await supabase.rpc("refresh_my_credits");
      const [credits, roles, profile, privateProfile, capturedOrders] = await Promise.all([
        supabase
          .from("user_credits")
          .select("balance,daily_reset_at")
          .eq("user_id", userId!)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId!),
        supabase
          .from("creator_profiles")
          .select("is_official,is_premium")
          .eq("id", userId!)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("credits,credits_balance,has_purchased,daily_streak,last_daily_claim")
          .eq("id", userId!)
          .maybeSingle(),
        supabase
          .from("paypal_orders")
          .select("id")
          .eq("user_id", userId!)
          .eq("status", "captured")
          .limit(1),
      ]);
      return {
        balance:
          privateProfile.data?.credits_balance ??
          privateProfile.data?.credits ??
          credits.data?.balance ??
          500,
        nextReset: credits.data?.daily_reset_at ?? null,
        isAdmin: (roles.data ?? []).some((r) => r.role === "admin" || r.role === "admin_supremo"),
        isOfficial: Boolean(profile.data?.is_official),
        plan: profile.data?.is_premium ? "premium" : "free",
        hasPurchased:
          Boolean(privateProfile.data?.has_purchased) || Boolean(capturedOrders.data?.length),
        dailyStreak: privateProfile.data?.daily_streak ?? 0,
        lastDailyClaim: privateProfile.data?.last_daily_claim ?? null,
      };
    },
  });
  return {
    userId,
    balance: isImmediateAdmin || query.data?.balance === -1 ? Infinity : (query.data?.balance ?? 500),
    nextReset: query.data?.nextReset ?? null,
    isAdmin: isImmediateAdmin || Boolean(query.data?.isAdmin),
    isOfficial: isImmediateAdmin || Boolean(query.data?.isOfficial),
    plan: isImmediateAdmin ? "premium" : (query.data?.plan ?? "free"),
    hasPurchased: isImmediateAdmin || Boolean(query.data?.hasPurchased),
    dailyStreak: query.data?.dailyStreak ?? 0,
    lastDailyClaim: query.data?.lastDailyClaim ?? null,
    loading: query.isLoading,
    refresh: () => query.refetch(),
  };
}

export const DEFAULT_SETTINGS: PublicSettings = {
  site_title: "Cupido Leudy ❤️",
  site_tagline: SLOGAN,
  banner_text: "Encuentra conexiones reales. Verificación azul, seguridad y diversión.",
  banner_image: "",
  logo_url: "",
  primary_color: "",
  accent_color: "",
  songs_enabled: false,
  covers_enabled: false,
  videos_enabled: false,
  purchases_enabled: true,
  gallery_enabled: true,
};

export const siteSettingsQuery = {
  queryKey: ["site-settings"],
  queryFn: () => getSiteSettings(),
  staleTime: 30_000,
};

export function useSiteSettings(): PublicSettings {
  const { data } = useQuery(siteSettingsQuery);
  return data ?? DEFAULT_SETTINGS;
}
