import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type LivePresence = { user_id?: string; role?: "host" | "viewer" };

export function useLivePresenceCounts(roomIds: string[]): Record<string, number> {
  const roomKey = [...new Set(roomIds)].slice(0, 40).join(",");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const ids = roomKey ? roomKey.split(",") : [];
    setCounts({});
    if (!ids.length) return;

    const channels = ids.map((roomId) => {
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
      channel.on("presence", { event: "sync" }, updateCount).subscribe((status) => {
        if (status === "SUBSCRIBED") updateCount();
      });
      return channel;
    });

    return () => {
      channels.forEach((channel) => void supabase.removeChannel(channel));
    };
  }, [roomKey]);

  return counts;
}
