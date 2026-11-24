import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EquippedAvatarFrame = {
  frame_id: string;
  color_a: string;
  color_b: string;
  effect: "orbit" | "shine" | "water" | "fire" | "wings" | "galaxy" | "diamond";
};

const FRAME_QUERY_KEY = ["cupido-avatar-frame"] as const;
type FrameListener = (userId: string) => void;
const frameListeners = new Set<FrameListener>();
let frameChannel: ReturnType<typeof supabase.channel> | null = null;

function startFrameChannel() {
  if (frameChannel) return;
  const db = supabase as unknown as { channel: (name: string) => any };
  frameChannel = db.channel("cupido-avatar-frames-global")
    .on("postgres_changes", { event: "*", schema: "public", table: "cupido_equipped_avatar_frames" }, (payload: unknown) => {
      const event = payload as { new?: { user_id?: string }; old?: { user_id?: string } };
      const userId = event.new?.user_id ?? event.old?.user_id;
      if (userId) frameListeners.forEach((listener) => listener(userId));
    })
    .subscribe();
}

export function useEquippedAvatarFrame(userId?: string | null): EquippedAvatarFrame | null {
  const queryClient = useQueryClient();
  const frame = useQuery({
    queryKey: [...FRAME_QUERY_KEY, userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const db = supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
      const { data, error } = await db.rpc("cupido_get_equipped_avatar_frame", { _user: userId! });
      if (error) throw new Error(error.message);
      const value = Array.isArray(data) ? data[0] : data;
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      if (typeof row["frame_id"] !== "string" || typeof row["color_a"] !== "string" || typeof row["color_b"] !== "string") return null;
      const effects = new Set<EquippedAvatarFrame["effect"]>(["orbit", "shine", "water", "fire", "wings", "galaxy", "diamond"]);
      const effect = typeof row["effect"] === "string" && effects.has(row["effect"] as EquippedAvatarFrame["effect"])
        ? row["effect"] as EquippedAvatarFrame["effect"]
        : "orbit";
      return { frame_id: row["frame_id"], color_a: row["color_a"], color_b: row["color_b"], effect };
    },
  });

  useEffect(() => {
    if (!userId) return;
    const listener: FrameListener = (changedUserId) => {
      if (changedUserId === userId) void queryClient.invalidateQueries({ queryKey: [...FRAME_QUERY_KEY, userId] });
    };
    frameListeners.add(listener);
    startFrameChannel();
    return () => {
      frameListeners.delete(listener);
      if (!frameListeners.size && frameChannel) {
        void supabase.removeChannel(frameChannel);
        frameChannel = null;
      }
    };
  }, [queryClient, userId]);

  return frame.data ?? null;
}
