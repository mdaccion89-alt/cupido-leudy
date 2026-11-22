import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useAppLogo(): string {
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
    const channel = supabase
      .channel(("cupido-app-logo-live") + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "site_settings", filter: "id=eq.1" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-app-logo"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return logoUrl;
}
