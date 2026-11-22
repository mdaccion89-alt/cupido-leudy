import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type LivePresence = { user_id?: string; role?: "host" | "viewer" };
const presenceChannels = new Map<string, RealtimeChannel>();
const channelRemovals = new Map<string, Promise<unknown>>();

async function removePresenceChannel(roomId: string, channel: RealtimeChannel): Promise<void> {
  const pending = channelRemovals.get(roomId);
  if (pending) {
    await pending;
    return;
  }

  const removal = supabase.removeChannel(channel).finally(() => {
    if (presenceChannels.get(roomId) === channel) presenceChannels.delete(roomId);
    if (channelRemovals.get(roomId) === removal) channelRemovals.delete(roomId);
  });
  channelRemovals.set(roomId, removal);
  await removal;
}

/** Release a list observer before LiveRoom claims the same Supabase topic. */
export async function releaseLivePresenceCount(roomId: string): Promise<void> {
  const channel = presenceChannels.get(roomId);
  if (channel) {
    await removePresenceChannel(roomId, channel);
    return;
  }
  await channelRemovals.get(roomId);
}

export function useLivePresenceCounts(roomIds: string[], excludedRoomId?: string | null): Record<string, number> {
  const roomKey = [...new Set(roomIds)].filter((roomId) => roomId !== excludedRoomId).slice(0, 40).join(",");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const ids = roomKey ? roomKey.split(",") : [];
    setCounts({});
    if (!ids.length) return;

    let disposed = false;
    const channels: Array<{ roomId: string; channel: RealtimeChannel }> = [];

    const subscribe = async () => {
      for (const roomId of ids) {
        await releaseLivePresenceCount(roomId);
        if (disposed) return;

        const channel = supabase.channel(`cupido-live-presence-${roomId}`, {
          config: { presence: { key: `observer-${crypto.randomUUID()}` } },
        });
        const updateCount = () => {
          const uniqueViewers = new Set<string>();
          Object.values(channel.presenceState<LivePresence>()).flat().forEach((presence) => {
            if (presence.role === "viewer" && presence.user_id) uniqueViewers.add(presence.user_id);
          });
          setCounts((current) => ({ ...current, [roomId]: uniqueViewers.size }));
        };
        presenceChannels.set(roomId, channel);
        channels.push({ roomId, channel });
        channel.on("presence", { event: "sync" }, updateCount).subscribe((status) => {
          if (status === "SUBSCRIBED") updateCount();
        });
      }
    };
    void subscribe();

    return () => {
      disposed = true;
      channels.forEach(({ roomId, channel }) => void removePresenceChannel(roomId, channel));
    };
  }, [roomKey]);

  return counts;
}
