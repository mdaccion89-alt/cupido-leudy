import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettings, type PublicSettings } from "./studio.functions";
import { useAuth } from "./auth-context";

const IMMEDIATE_ADMIN_EMAIL = "leudyfeliz81@gmail.com";

export function useAccount() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const isImmediateAdmin = session?.user.email?.toLowerCase() === IMMEDIATE_ADMIN_EMAIL;
  const query = useQuery({
    queryKey: ["account", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      await supabase.rpc("refresh_my_credits");
      const [credits, roles, profile] = await Promise.all([
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
      ]);
      return {
        balance: credits.data?.balance ?? 0,
        nextReset: credits.data?.daily_reset_at ?? null,
        isAdmin: (roles.data ?? []).some((r) => r.role === "admin" || r.role === "admin_supremo"),
        isOfficial: Boolean(profile.data?.is_official),
        plan: profile.data?.is_premium ? "premium" : "free",
      };
    },
  });
  return {
    userId,
    balance: isImmediateAdmin ? Infinity : (query.data?.balance ?? 0),
    nextReset: query.data?.nextReset ?? null,
    isAdmin: isImmediateAdmin || Boolean(query.data?.isAdmin),
    isOfficial: isImmediateAdmin || Boolean(query.data?.isOfficial),
    plan: isImmediateAdmin ? "premium" : (query.data?.plan ?? "free"),
    loading: query.isLoading,
    refresh: () => query.refetch(),
  };
}

export const DEFAULT_SETTINGS: PublicSettings = {
  site_title: "Cupido Leudy ❤️",
  site_tagline: "Citas reales, chat social y videos cortos",
  banner_text: "Encuentra conexiones reales. Verificación azul, seguridad y diversión.",
  banner_image: "",
  logo_url: "",
  primary_color: "",
  accent_color: "",
  songs_enabled: true,
  covers_enabled: true,
  videos_enabled: true,
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
