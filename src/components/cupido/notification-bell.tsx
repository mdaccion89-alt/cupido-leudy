import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  kind: string | null;
  actor_id: string | null;
  target_id: string | null;
};

function notificationIcon(kind: string | null): string {
  if (kind === "interest" || kind === "interested") return "💘";
  if (kind === "like") return "❤️";
  if (kind === "comment") return "💬";
  if (kind === "message") return "💌";
  if (kind === "follow") return "👤";
  if (kind === "friend") return "🤝";
  if (kind === "gift" || kind === "live_gift") return "🎁";
  return "🔔";
}

export function NotificationBell() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const notifications = useQuery({
    queryKey: ["cupido-notifications", viewerId],
    enabled: Boolean(viewerId),
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id,title,body,read,created_at,kind,actor_id,target_id")
        .eq("user_id", viewerId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  const unreadCount = useQuery({
    queryKey: ["cupido-notifications-count", viewerId],
    enabled: Boolean(viewerId),
    staleTime: 0,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", viewerId!)
        .eq("read", false);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const sounds = useQuery({
    queryKey: ["cupido-sound-preference", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("sounds_enabled").eq("id", viewerId!).maybeSingle();
      if (error) throw error;
      return data?.sounds_enabled !== false;
    },
  });

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase
      .channel(`cupido-notifications-${viewerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${viewerId}` },
        (payload) => {
          void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", viewerId] });
          void queryClient.invalidateQueries({ queryKey: ["cupido-notifications-count", viewerId] });
          if (payload.eventType === "INSERT" && sounds.data !== false) {
            try {
              const audio = new AudioContext();
              const oscillator = audio.createOscillator();
              const gain = audio.createGain();
              oscillator.frequency.value = 880;
              gain.gain.value = 0.035;
              oscillator.connect(gain);
              gain.connect(audio.destination);
              oscillator.start();
              oscillator.stop(audio.currentTime + 0.12);
              window.setTimeout(() => void audio.close(), 250);
            } catch {
              // Audio can be blocked until the user interacts with the page.
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [viewerId, queryClient, sounds.data]);

  const unread = unreadCount.data ?? (notifications.data ?? []).filter((row) => !row.read).length;

  const markRead = async (row: NotificationRow) => {
    if (!viewerId || row.read) return;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", row.id)
      .eq("user_id", viewerId);
    if (error) return;
    void queryClient.invalidateQueries({ queryKey: ["cupido-notifications", viewerId] });
    void queryClient.invalidateQueries({ queryKey: ["cupido-notifications-count", viewerId] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="glass" size="icon" className="relative rounded-full" aria-label="Notificaciones">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center justify-between px-2 py-2">
          <p className="font-display text-sm text-white">Notificaciones</p>
          <span className="text-[11px] text-muted-foreground">{unread} sin leer</span>
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {!notifications.data?.length && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Todavía no tienes notificaciones.</p>
          )}
          {notifications.data?.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => void markRead(row)}
              className={`flex w-full gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.06] ${row.read ? "" : "bg-pink-500/10"}`}
            >
              <span className="text-lg">{notificationIcon(row.kind)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{row.title}</span>
                <span className="block text-xs text-muted-foreground">{row.body}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              {!row.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-pink-400" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
