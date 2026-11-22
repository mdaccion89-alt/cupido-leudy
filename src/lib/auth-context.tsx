import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });
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

function ensureMyProfile(): Promise<void> {
  const client = supabase as unknown as {
    rpc: (fn: string) => Promise<{ error: unknown }>;
  };
  return Promise.resolve()
    .then(() => client.rpc("ensure_my_profile"))
    .then(() => client.rpc("cupido_adapt_legacy_profile"))
    .then(() => client.rpc("cupido_admin_auto_terms"))
    .then(() => client.rpc("cupido_admin_auto_follow"))
    .then(() => client.rpc("cupido_sync_my_profile"))
    .then(() => undefined)
    .catch(() => undefined);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      rememberSession(session);
      setState({ session, loading: false });
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event === "SIGNED_OUT") queryClient.removeQueries({ queryKey: ["songs"] });
      else void ensureMyProfile().then(() => queryClient.invalidateQueries());
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        rememberSession(data.session);
        setState({ session: data.session, loading: false });
      });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
