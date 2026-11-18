import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { isVerifiedCreator } from "./credits";

export type CreatorProfile = {
  id: string;
  display_name: string;
  bio: string;
  avatar_url: string;
  is_official: boolean;
  is_premium: boolean;
  follower_count: number;
  created_at: string;
};

const PUBLIC_FIELDS =
  "id,display_name,bio,avatar_url,is_official,is_premium,follower_count,created_at";

export const creatorKeys = {
  all: ["creators"] as const,
  list: () => ["creators", "list"] as const,
  detail: (id: string | null) => ["creators", "detail", id] as const,
  follows: (viewerId: string | null, creatorId: string | null) =>
    ["creators", "follows", viewerId, creatorId] as const,
};

export function isCreatorVerified(
  creator: Pick<CreatorProfile, "is_official" | "is_premium" | "follower_count">,
): boolean {
  return creator.is_official || isVerifiedCreator(creator.follower_count, creator.is_premium);
}

export function useCreators() {
  return useQuery({
    queryKey: creatorKeys.list(),
    queryFn: async (): Promise<CreatorProfile[]> => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select(PUBLIC_FIELDS)
        .order("follower_count", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CreatorProfile[];
    },
    staleTime: 30_000,
  });
}

export function useCreator(id: string | null | undefined) {
  return useQuery({
    queryKey: creatorKeys.detail(id ?? null),
    enabled: Boolean(id),
    queryFn: async (): Promise<CreatorProfile | null> => {
      const { data, error } = await supabase
        .from("creator_profiles")
        .select(PUBLIC_FIELDS)
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data as CreatorProfile | null) ?? null;
    },
  });
}

export function useFollowsCreator(creatorId: string | null | undefined) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const query = useQuery({
    queryKey: creatorKeys.follows(viewerId, creatorId ?? null),
    enabled: Boolean(viewerId && creatorId && viewerId !== creatorId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", viewerId!)
        .eq("following_id", creatorId!)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  });
  return { ...query, following: query.data ?? false, viewerId };
}

export function useToggleFollow(creatorId: string | null | undefined) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (following: boolean): Promise<void> => {
      if (!viewerId || !creatorId || viewerId === creatorId) throw new Error("NOT_AUTHENTICATED");
      if (following) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", viewerId)
          .eq("following_id", creatorId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: viewerId, following_id: creatorId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: creatorKeys.follows(viewerId, creatorId ?? null),
      });
      void queryClient.invalidateQueries({ queryKey: creatorKeys.all });
    },
  });
}
