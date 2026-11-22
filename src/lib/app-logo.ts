import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

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
        })
        .subscribe();
    }
  }, [queryClient, session?.user.id]);

  return logoUrl;
}
