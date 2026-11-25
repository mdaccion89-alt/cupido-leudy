import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettings, type PublicSettings } from "./studio.functions";
import { useAuth } from "./auth-context";
import { SLOGAN } from "./cupido";
import { REVIEW_MODE_CREDITS, isPlayStoreReviewMode } from "./review-mode";

const IMMEDIATE_ADMIN_EMAIL = "leudyfeliz81@gmail.com";

export function isSupremeAdminEmail(email?: string | null): boolean {
  return email?.toLowerCase() === IMMEDIATE_ADMIN_EMAIL;
}

export const OFFICIAL_FOLLOWER_BONUS = 40_000;

export function displayedFollowerCount(
  realCount?: number | null,
  email?: string | null,
  isAdminProfile?: boolean,
): number {
  const real = Math.max(0, Math.floor(Number(realCount) || 0));
  return isSupremeAdminEmail(email) || isAdminProfile === true ? real + OFFICIAL_FOLLOWER_BONUS : real;
}

export function useAccount() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const isImmediateAdmin = session?.user.email?.toLowerCase() === IMMEDIATE_ADMIN_EMAIL;
  const isReviewMode = isPlayStoreReviewMode(session?.user.email);
  const query = useQuery({
    queryKey: ["account", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { error: refreshError } = await supabase.rpc("refresh_my_credits");
      if (refreshError) throw refreshError;
      const [credits, roles, profile, privateProfile, coinMirror, capturedOrders] = await Promise.all([
        (async () => {
          const result = await supabase
            .from("user_credits")
            .select("balance,ad_reward_balance,daily_reset_at")
            .eq("user_id", userId!)
            .maybeSingle();
          if (result.error?.code === "42703" || result.error?.code === "PGRST204") {
            const fallback = await supabase
              .from("user_credits")
              .select("balance,daily_reset_at")
              .eq("user_id", userId!)
              .maybeSingle();
            return { data: fallback.data, error: fallback.error, adRewardBalance: 0 };
          }
          return { data: result.data, error: result.error, adRewardBalance: Number(result.data?.ad_reward_balance ?? 0) };
        })(),
        supabase.from("user_roles").select("role").eq("user_id", userId!),
        supabase
          .from("creator_profiles")
          .select("is_official,is_premium,is_gran_liga")
          .eq("id", userId!)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("credits,credits_balance,daily_streak,last_daily_claim,has_purchased,has_recharged,is_gran_liga")
          .eq("id", userId!)
          .maybeSingle(),
        supabase.from("profiles").select("coins").eq("id", userId!).maybeSingle(),
        supabase
          .from("paypal_orders")
          .select("id")
          .eq("user_id", userId!)
          .eq("status", "captured")
          .limit(1),
      ]);
      if (privateProfile.error) throw privateProfile.error;
      if (credits.error) throw credits.error;
      if (coinMirror.error && coinMirror.error.code !== "42703" && coinMirror.error.code !== "PGRST204") throw coinMirror.error;
      return {
        balance:
          coinMirror.data?.coins ??
          privateProfile.data?.credits_balance ??
          privateProfile.data?.credits ??
          credits.data?.balance ??
          0,
        nextReset: credits.data?.daily_reset_at ?? null,
        adRewardBalance: credits.adRewardBalance,
        isAdmin: (roles.data ?? []).some((r) => r.role === "admin" || r.role === "admin_supremo"),
        isSupremeAdmin: isImmediateAdmin || (roles.data ?? []).some((r) => r.role === "admin_supremo"),
        isOfficial: Boolean(profile.data?.is_official),
        isGranLiga: Boolean(profile.data?.is_gran_liga || privateProfile.data?.is_gran_liga),
        plan: profile.data?.is_premium ? "premium" : "free",
        hasPurchased: isImmediateAdmin || Boolean(privateProfile.data?.has_purchased || capturedOrders.data?.length),
        dailyStreak: privateProfile.data?.daily_streak ?? 0,
        lastDailyClaim: privateProfile.data?.last_daily_claim ?? null,
      };
    },
  });
  return {
    userId,
    isReviewMode,
    balance: isReviewMode ? REVIEW_MODE_CREDITS : isImmediateAdmin ? Infinity : (query.data?.balance ?? 0),
    balanceUnavailable: query.isError && !query.data,
    nextReset: query.data?.nextReset ?? null,
    adRewardBalance: isReviewMode ? REVIEW_MODE_CREDITS : isImmediateAdmin ? Infinity : (query.data?.adRewardBalance ?? 0),
    isAdmin: isImmediateAdmin || Boolean(query.data?.isAdmin),
    isInfiniteCreditsAdmin: isImmediateAdmin || isReviewMode,
    isSupremeAdmin: isImmediateAdmin || Boolean(query.data?.isSupremeAdmin),
    isOfficial: isImmediateAdmin || Boolean(query.data?.isOfficial),
    isGranLiga: isImmediateAdmin || isReviewMode || Boolean(query.data?.isGranLiga),
    plan: isImmediateAdmin || isReviewMode ? "premium" : (query.data?.plan ?? "free"),
    hasPurchased: isImmediateAdmin || isReviewMode || Boolean(query.data?.hasPurchased),
    dailyStreak: query.data?.dailyStreak ?? 0,
    lastDailyClaim: query.data?.lastDailyClaim ?? null,
    loading: query.isLoading,
    refresh: () => query.refetch(),
    addPurchasedCredits: (credits: number) => {
      if (!userId || !Number.isFinite(credits) || credits <= 0) return;
      queryClient.setQueryData(["account", userId], (current: typeof query.data) => current
        ? { ...current, balance: current.balance === -1 ? -1 : current.balance + credits, hasPurchased: true, isGranLiga: current.isGranLiga || credits >= 1_000_000 }
        : current);
    },
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
  ads_enabled: true,
  theme_preset: "cafe",
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
