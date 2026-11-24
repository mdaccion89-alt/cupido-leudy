import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AuthState = { session: Session | null; loading: boolean; onlineUserIds: string[] };
const AuthContext = createContext<AuthState>({ session: null, loading: true, onlineUserIds: [] });
const SAVED_ACCOUNTS_KEY = "cupido_saved_accounts";

type SavedSession = {
  user_id: string;
  email: string | null;
  access_token: string;
  refresh_token: string;
  last_used_at: string;
};

export type SavedAccountChoice = Pick<SavedSession, "user_id" | "email" | "last_used_at">;

function readSavedSessions(): SavedSession[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_ACCOUNTS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is SavedSession =>
      Boolean(entry && typeof entry === "object" &&
        typeof entry.user_id === "string" && typeof entry.access_token === "string" &&
        typeof entry.refresh_token === "string" && typeof entry.last_used_at === "string"),
    );
  } catch {
    return [];
  }
}

function rememberSession(session: Session | null): void {
  if (typeof localStorage === "undefined" || !session?.refresh_token) return;
  const saved = readSavedSessions().filter((entry) => entry.user_id !== session.user.id);
  saved.unshift({
    user_id: session.user.id,
    email: session.user.email ?? null,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    last_used_at: new Date().toISOString(),
  });
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(saved.slice(0, 5)));
  } catch {
    // Keep auth transitions working even when browser storage is unavailable.
  }
}

export function getSavedAccounts(): SavedAccountChoice[] {
  return readSavedSessions().map(({ user_id, email, last_used_at }) => ({ user_id, email, last_used_at }));
}

export function forgetSavedAccount(userId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(readSavedSessions().filter((entry) => entry.user_id !== userId)));
  } catch {
    // Account removal should continue even when browser storage is unavailable.
  }
}

export async function switchSavedAccount(userId: string): Promise<void> {
  const saved = readSavedSessions().find((entry) => entry.user_id === userId);
  if (!saved) throw new Error("No encontramos esa cuenta guardada en este dispositivo.");
  await supabase.removeAllChannels();
  const { error } = await supabase.auth.setSession({
    access_token: saved.access_token,
    refresh_token: saved.refresh_token,
  });
  if (error) throw error;
}

function ensureMyProfile(userId: string | null): Promise<void> {
  if (!userId) return Promise.resolve();
  const client = supabase as unknown as {
    rpc: (fn: string) => Promise<{ error: unknown }>;
  };
  return Promise.resolve().then(async () => {
    const { data: savedProfile, error: readError } = await supabase
      .from("profiles")
      .select("display_name,full_name")
      .eq("id", userId)
      .maybeSingle();
    const savedDisplayName = !readError ? savedProfile?.display_name?.trim() : "";
    const savedFullName = !readError ? savedProfile?.full_name?.trim() : "";

    await Promise.resolve()
      .then(() => client.rpc("ensure_my_profile"))
      .then(() => client.rpc("cupido_adapt_legacy_profile"))
      .then(() => client.rpc("cupido_admin_auto_terms"))
      .then(() => client.rpc("cupido_admin_auto_follow"))
      .then(() => client.rpc("cupido_sync_my_profile"))
      .catch(() => undefined);

    if (!savedDisplayName && !savedFullName) return;
    const profileNamePatch = {
      ...(savedDisplayName ? { display_name: savedDisplayName } : {}),
      ...(savedFullName ? { full_name: savedFullName } : {}),
    };
    const creatorNamePatch = {
      ...(savedDisplayName ? { display_name: savedDisplayName } : {}),
      ...(savedFullName ? { full_name: savedFullName } : {}),
    };
    const [profileWrite, creatorWrite] = await Promise.all([
      supabase.from("profiles").update(profileNamePatch).eq("id", userId),
      supabase.from("creator_profiles").update(creatorNamePatch).eq("id", userId),
    ]);
    if (profileWrite.error || creatorWrite.error) {
      console.warn("[Auth] Se conservaron los nombres guardados, pero no se pudo sincronizar cada proyección.", profileWrite.error ?? creatorWrite.error);
    }
  }).catch(() => undefined);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, onlineUserIds: [] });
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    let appUrlListener: Awaited<ReturnType<typeof App.addListener>> | undefined;
    const handledAuthUrls = new Set<string>();
    const handleNativeAuthUrl = async (url: string) => {
      let callback: URL;
      try {
        callback = new URL(url);
      } catch {
        return;
      }
      if (callback.protocol !== "com.cupido.leudy:" || callback.hostname !== "auth" || handledAuthUrls.has(url)) return;
      handledAuthUrls.add(url);
      try {
        await Browser.close().catch(() => undefined);
        const authError = callback.searchParams.get("error_description") ?? callback.searchParams.get("error");
        if (authError) throw new Error(authError);
        const hash = new URLSearchParams(callback.hash.replace(/^#/, ""));
        const code = callback.searchParams.get("code") ?? hash.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const accessToken = hash.get("access_token") ?? callback.searchParams.get("access_token");
          const refreshToken = hash.get("refresh_token") ?? callback.searchParams.get("refresh_token");
          if (!accessToken || !refreshToken) throw new Error("El enlace de acceso no contiene una sesión válida.");
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) throw error;
        }
        await router.navigate({ to: "/" });
      } catch (error) {
        console.error("[Auth] No se pudo completar el callback nativo", error);
        toast.error(error instanceof Error ? error.message : "No se pudo completar el acceso de Google.");
      }
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      rememberSession(session);
      setState((current) => ({ ...current, session, loading: false }));
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event === "SIGNED_OUT") queryClient.removeQueries({ queryKey: ["songs"] });
      else void ensureMyProfile(session?.user.id ?? null).then(() => queryClient.invalidateQueries());
    });
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appUrlOpen", ({ url }) => handleNativeAuthUrl(url)).then((listener) => {
        if (active) appUrlListener = listener;
        else void listener.remove();
      });
      void App.getLaunchUrl().then((launch) => {
        if (launch?.url) void handleNativeAuthUrl(launch.url);
      });
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        rememberSession(data.session);
        setState((current) => ({ ...current, session: data.session, loading: false }));
      });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      void appUrlListener?.remove();
    };
  }, [router, queryClient]);

  const viewerId = state.session?.user.id ?? null;

  useEffect(() => {
    if (!viewerId) {
      setState((current) => current.onlineUserIds.length ? { ...current, onlineUserIds: [] } : current);
      return;
    }
    const channel = supabase
      .channel("cupido-global-presence", { config: { presence: { key: viewerId } } })
      .on("presence", { event: "sync" }, () => {
        const ids = new Set<string>();
        Object.values(channel.presenceState<{ user_id?: string }>()).flat().forEach((presence) => {
          if (presence.user_id) ids.add(presence.user_id);
        });
        setState((current) => ({ ...current, onlineUserIds: [...ids] }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ user_id: viewerId, online_at: new Date().toISOString() });
        }
      });
    return () => { void supabase.removeChannel(channel); };
  }, [viewerId]);

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase.channel(`cupido-account-live-${viewerId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_credits", filter: `user_id=eq.${viewerId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["account", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `id=eq.${viewerId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["account", viewerId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cupido_balances", filter: `user_id=eq.${viewerId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-wallet", viewerId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
