import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { playCupidoSound } from "@/lib/cupido-sounds";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
  kind: string | null;
  actor_id: string | null;
  target_id: string | null;
  action_url: string | null;
};

function notificationIcon(kind: string | null): string {
  if (kind === "interest" || kind === "interested") return "💘";
  if (kind === "like") return "❤️";
  if (kind === "comment") return "💬";
  if (kind === "comment_reply") return "↩️";
  if (kind === "comment_like") return "❤️";
  if (kind === "message") return "💌";
  if (kind === "follow") return "👤";
  if (kind === "friend") return "🤝";
  if (kind === "friend_accepted") return "💞";
  if (kind === "support_ticket" || kind === "support_reply") return "🎫";
  if (kind === "report") return "🚩";
  if (kind === "verification") return "✅";
  if (kind === "gift" || kind === "live_gift") return "🎁";
  return "🔔";
}

export function NotificationBell() {
  const { session } = useAuth();
  const navigate = useNavigate();
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
        .select("id,title,body,read,created_at,kind,actor_id,target_id,action_url")
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
          if (payload.eventType === "INSERT") {
            void playCupidoSound("notification", viewerId);
            const row = payload.new as NotificationRow;
            const soundEnabled = localStorage.getItem("cupido-sounds") !== "false";
            const notificationsEnabled = localStorage.getItem("cupido-notifications") !== "false";
            if (notificationsEnabled && document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
              void navigator.serviceWorker.ready.then((registration) => registration.showNotification(row.title || "Cupido Leudy ❤️", {
                body: row.body || "Tienes una notificación nueva.",
                icon: localStorage.getItem("cupido-app-logo") || "/favicon.ico",
                badge: "/favicon.ico",
                tag: `cupido-${row.id}`,
                data: { url: row.action_url ?? (row.target_id ? `/?post=${encodeURIComponent(row.target_id)}` : "/") },
                ...(soundEnabled ? { vibrate: [120, 80, 120] } : {}),
              } as NotificationOptions));
            }
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [viewerId, queryClient]);

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

  const openNotification = (row: NotificationRow) => {
    void markRead(row);
    setOpen(false);
    if (row.kind === "live" && row.target_id) {
      void navigate({ to: "/directo", search: { liveId: row.target_id } });
      return;
    }
    if (row.action_url?.startsWith("/")) void navigate({ to: row.action_url as never });
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
              onClick={() => openNotification(row)}
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
