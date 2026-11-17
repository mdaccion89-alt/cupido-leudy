import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSiteSettings, type PublicSettings } from "./studio.functions";
import { useAuth } from "./auth-context";

export function useAccount() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const query = useQuery({
    queryKey: ["account", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const [credits, roles] = await Promise.all([
        supabase.from("user_credits").select("balance").eq("user_id", userId!).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId!),
      ]);
      return {
        balance: credits.data?.balance ?? 0,
        isAdmin: (roles.data ?? []).some((r) => r.role === "admin"),
      };
    },
  });
  return { userId, balance: query.data?.balance ?? 0, isAdmin: query.data?.isAdmin ?? false, loading: query.isLoading };
}

export const DEFAULT_SETTINGS: PublicSettings = {
  site_title: "Leudy IA Adobe",
  site_tagline: "Convierte tus ideas en canciones",
  banner_text: "",
  banner_image: "",
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
