import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type BrandEffect = "diamond" | "gold" | "water" | "fire";
const BRAND_EFFECTS: readonly BrandEffect[] = ["diamond", "gold", "water", "fire"];

let appLogoChannel: ReturnType<typeof supabase.channel> | null = null;

export function useAppLogo(): string {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const setting = useQuery({
    queryKey: ["cupido-app-logo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_settings")
        .select("app_logo_url,logo_url")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data?.app_logo_url || data?.logo_url || "";
    },
    staleTime: 60_000,
  });
  const logoUrl = setting.data ?? "";

  useEffect(() => {
    if (!logoUrl || typeof document === "undefined") return;
    localStorage.setItem("cupido-app-logo", logoUrl);
    let icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.append(icon);
    }
    icon.href = logoUrl;
  }, [logoUrl]);

  useEffect(() => {
    const activeChannels = supabase.getChannels();
    if (!appLogoChannel || !activeChannels.includes(appLogoChannel)) {
      appLogoChannel = supabase
        .channel("cupido-app-logo-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "site_settings", filter: "id=eq.1" }, () => {
          void queryClient.invalidateQueries({ queryKey: ["cupido-app-logo"] });
          void queryClient.invalidateQueries({ queryKey: ["cupido-brand-effect"] });
        })
        .subscribe();
    }
  }, [queryClient, session?.user.id]);

  return logoUrl;
}

export function useBrandEffect(): BrandEffect {
  const setting = useQuery({
    queryKey: ["cupido-brand-effect"],
    queryFn: async (): Promise<BrandEffect> => {
      const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      const value = (data as unknown as { brand_effect?: string } | null)?.brand_effect;
      return BRAND_EFFECTS.includes(value as BrandEffect) ? value as BrandEffect : "diamond";
    },
    staleTime: 60_000,
  });
  return setting.data ?? "diamond";
}
