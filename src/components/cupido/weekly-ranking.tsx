import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export type WeeklyRankUser = {
  user_id: string;
  display_name: string;
  avatar_url: string;
  coins: number;
};

export type WeeklyRanking = {
  week_starts_at: string;
  creators: WeeklyRankUser[];
  fans: WeeklyRankUser[];
};

export const WEEKLY_RANKING_KEY = ["cupido-weekly-ranking"] as const;

const EMPTY_RANKING: WeeklyRanking = { week_starts_at: "", creators: [], fans: [] };
const WeeklyRankContext = createContext<Set<string>>(new Set());

function readRankUsers(value: unknown): WeeklyRankUser[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.user_id !== "string") return [];
    return [{
      user_id: row.user_id,
      display_name: typeof row.display_name === "string" ? row.display_name : "Miembro",
      avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : "",
      coins: Number(row.coins ?? 0),
    }];
  });
}

export async function fetchWeeklyRanking(): Promise<WeeklyRanking> {
  const { data, error } = await supabase.rpc("cupido_get_weekly_ranking");
  if (error) throw error;
  const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
  return {
    week_starts_at: typeof value.week_starts_at === "string" ? value.week_starts_at : "",
    creators: readRankUsers(value.creators),
    fans: readRankUsers(value.fans),
  };
}

export function WeeklyRankingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const ranking = useQuery({
    queryKey: WEEKLY_RANKING_KEY,
    enabled: Boolean(session),
    queryFn: fetchWeeklyRanking,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const topIds = useMemo(() => new Set([
    ...(ranking.data?.creators.slice(0, 3).map((row) => row.user_id) ?? []),
    ...(ranking.data?.fans.slice(0, 3).map((row) => row.user_id) ?? []),
  ]), [ranking.data]);

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel(`cupido-weekly-ranking-${session.user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cupido_gift_sends" }, () => {
        void queryClient.invalidateQueries({ queryKey: WEEKLY_RANKING_KEY });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "cupido_calls" }, () => {
        void queryClient.invalidateQueries({ queryKey: WEEKLY_RANKING_KEY });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, session]);

  return <WeeklyRankContext.Provider value={topIds}>{children}</WeeklyRankContext.Provider>;
}

export function useIsWeeklyTopThree(userId?: string | null) {
  const rankedIds = useContext(WeeklyRankContext);
  return Boolean(userId && rankedIds.has(userId));
}

export function useWeeklyRankingData() {
  return useQuery({
    queryKey: WEEKLY_RANKING_KEY,
    queryFn: fetchWeeklyRanking,
    staleTime: 30_000,
    initialData: EMPTY_RANKING,
  });
}
