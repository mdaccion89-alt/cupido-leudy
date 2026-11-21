import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type MentionPerson = { id: string; display_name: string; avatar_url: string };

type MentionInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className: string;
  maxLength?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  rows?: number;
};

export function MentionInput({ value, onChange, placeholder, className, maxLength = 2000, onKeyDown, rows = 3 }: MentionInputProps) {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const [cursor, setCursor] = useState(value.length);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const people = useQuery({
    queryKey: ["cupido-mention-people", viewerId],
    enabled: Boolean(viewerId),
    staleTime: 30_000,
    queryFn: async () => {
      const [follows, friends] = await Promise.all([
        supabase.from("follows").select("follower_id,following_id").or(`follower_id.eq.${viewerId},following_id.eq.${viewerId}`),
        supabase.from("friend_requests").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
      ]);
      if (follows.error) throw follows.error;
      if (friends.error) throw friends.error;
      const ids = new Set<string>();
      for (const row of follows.data ?? []) {
        const id = row.follower_id === viewerId ? row.following_id : row.follower_id;
        if (id && id !== viewerId) ids.add(id);
      }
      for (const row of friends.data ?? []) {
        const id = row.requester_id === viewerId ? row.addressee_id : row.requester_id;
        if (id && id !== viewerId) ids.add(id);
      }
      if (!ids.size) return [] as MentionPerson[];
      const profiles = await supabase.from("cupido_public_profiles").select("id,display_name,avatar_url").in("id", [...ids]).order("display_name").limit(80);
      if (profiles.error) throw profiles.error;
      return (profiles.data ?? []) as MentionPerson[];
    },
  });

  useEffect(() => {
    if (!viewerId) return;
    const channel = supabase.channel(`cupido-mentions-${viewerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "follows" }, () => { void people.refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, () => { void people.refetch(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => { void people.refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [viewerId, people.refetch]);

  const suggestions = useMemo(() => (people.data ?? []).filter((person) => person.display_name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 6), [people.data, query]);

  const update = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const nextCursor = event.target.selectionStart ?? nextValue.length;
    onChange(nextValue);
    setCursor(nextCursor);
    const beforeCursor = nextValue.slice(0, nextCursor);
    const match = beforeCursor.match(/(?:^|\s)@([\p{L}\p{N}_]{0,32})$/u);
    setOpen(Boolean(match && viewerId));
    setQuery(match?.[1] ?? "");
  };

  const insert = (person: MentionPerson) => {
    const beforeCursor = value.slice(0, cursor);
    const afterCursor = value.slice(cursor);
    const match = beforeCursor.match(/(?:^|\s)@([\p{L}\p{N}_]{0,32})$/u);
    const start = match ? (match.index ?? 0) + match[0].lastIndexOf("@") : cursor;
    const token = `@[${person.display_name}](${person.id}) `;
    const next = `${value.slice(0, start)}${token}${afterCursor}`;
    onChange(next);
    setCursor(start + token.length);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        value={value}
        onChange={update}
        onClick={(event) => setCursor(event.currentTarget.selectionStart ?? value.length)}
        onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? value.length)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); onKeyDown?.(event); }}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className={className}
      />
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 max-h-56 w-full overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-1 shadow-2xl">
          {people.isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Buscando amigos y seguidores…</p>}
          {!people.isLoading && suggestions.map((person) => (
            <button key={person.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(person)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-white hover:bg-white/10">
              <Avatar className="size-7"><AvatarImage src={person.avatar_url} alt={person.display_name} /><AvatarFallback>{person.display_name.slice(0, 1)}</AvatarFallback></Avatar>
              <span className="truncate">{person.display_name}</span>
            </button>
          ))}
          {!people.isLoading && !suggestions.length && <p className="px-3 py-2 text-xs text-muted-foreground">No hay amigos o seguidores con ese nombre.</p>}
        </div>
      )}
    </div>
  );
}
