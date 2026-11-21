import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

function ensureMyProfile(): Promise<void> {
  const client = supabase as unknown as {
    rpc: (fn: string) => Promise<{ error: unknown }>;
  };
  return Promise.resolve()
    .then(() => client.rpc("ensure_my_profile"))
    .then(() => client.rpc("cupido_adapt_legacy_profile"))
    .then(() => client.rpc("cupido_admin_auto_terms"))
    .then(() => client.rpc("cupido_admin_auto_follow"))
    .then(() => undefined)
    .catch(() => undefined);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState({ session, loading: false });
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event === "SIGNED_OUT") queryClient.removeQueries({ queryKey: ["songs"] });
      else void ensureMyProfile().then(() => queryClient.invalidateQueries());
    });
    supabase.auth
      .getSession()
      .then(({ data }) => setState({ session: data.session, loading: false }));
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
