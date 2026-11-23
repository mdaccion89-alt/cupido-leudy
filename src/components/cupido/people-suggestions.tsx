import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { countryFlag, countryName } from "@/lib/cupido";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

type Suggestion = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  country_code: string | null;
  looking_for: string | null;
  hobbies: string | null;
  is_verified_blue: boolean | null;
  is_gran_liga: boolean | null;
  is_official: boolean | null;
  is_super_admin: boolean | null;
  follower_count: number | null;
};

export function PeopleSuggestions({ search = "", title = "Sugerencias para ti" }: { search?: string; title?: string }) {
  const { session, onlineUserIds } = useAuth();
  const viewerId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const term = search.trim().replace(/[%_]/g, "");

  const people = useQuery({
    queryKey: ["cupido-suggestions", viewerId, term],
    queryFn: async () => {
      let query = supabase
        .from("cupido_public_profiles")
        .select("id,display_name,avatar_url,country_code,looking_for,hobbies,is_verified_blue,is_gran_liga,is_official,is_super_admin,follower_count")
        .eq("is_cupido_active", true)
        .order("is_verified_blue", { ascending: false })
        .order("follower_count", { ascending: false })
        .limit(40);
      if (term) query = query.ilike("display_name", `%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Suggestion[];
    },
  });

  const follows = useQuery({
    queryKey: ["cupido-suggestion-follows", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", viewerId!);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.following_id));
    },
  });

  useEffect(() => {
    const channel = supabase.channel(`cupido-suggestions-live-${viewerId ?? "guest"}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-suggestions"] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-suggestions"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follows" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-suggestion-follows"] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-suggestions"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, viewerId]);

  const toggleFollow = useMutation({
    mutationFn: async (person: Suggestion) => {
      if (!viewerId) throw new Error("Inicia sesión para seguir personas.");
      if (follows.data?.has(person.id)) {
        const { error } = await supabase.from("follows").delete().eq("follower_id", viewerId).eq("following_id", person.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: viewerId, following_id: person.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-suggestion-follows", viewerId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-suggestions"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-follows", viewerId] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
    },
    onError: (error) => {
      if (!viewerId) void navigate({ to: "/auth", search: { ref: "" } });
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el seguimiento.");
    },
  });

  const suggestions = useMemo(() => (people.data ?? []).filter((person) => {
    if (person.id === viewerId || dismissedIds.includes(person.id)) return false;
    return Boolean(term) || !follows.data?.has(person.id);
  }).slice(0, 12), [dismissedIds, follows.data, people.data, term, viewerId]);

  return (
    <section className="min-w-0" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
        {people.isLoading && <span className="text-xs text-muted-foreground">Cargando…</span>}
      </div>
      {people.isError ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">No se pudieron cargar las sugerencias.</p>
      ) : suggestions.length ? (
        <div translate="no" className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {suggestions.map((person) => {
            const isOnline = onlineUserIds.includes(person.id);
            const isFollowing = Boolean(follows.data?.has(person.id));
            const name = person.display_name?.trim() || "Miembro de Cupido";
            const subtitle = isOnline
              ? "En línea"
              : person.country_code
                ? `${countryFlag(person.country_code)} ${countryName(person.country_code)}`
                : person.hobbies?.split(",")[0]?.trim() || "Descubre su perfil";
            return (
              <article key={person.id} className="relative flex w-36 shrink-0 flex-col items-center rounded-2xl border border-white/10 bg-zinc-900/90 p-3">
                <button type="button" aria-label={`Descartar a ${name}`} title="Descartar" onClick={() => setDismissedIds((current) => [...current, person.id])} className="absolute right-2 top-2 grid size-6 place-items-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white"><X className="size-3.5" /></button>
                <Link to="/perfil" search={{ userId: person.id }} aria-label={`Ver perfil de ${name}`} className="mb-2 rounded-full bg-[linear-gradient(135deg,#ec4899,#f59e0b)] p-[3px]">
                  <Avatar userId={person.id} className="size-14 border-2 border-zinc-900">
                    <AvatarImage src={person.avatar_url ?? ""} alt={name} />
                    <AvatarFallback className="bg-pink-500/20 text-pink-100">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
                  </Avatar>
                </Link>
                <p className="flex w-full items-center justify-center gap-1 text-center text-xs font-semibold text-white">
                  <span className="max-w-[5.8rem] truncate">{name}</span>
                  <VerifiedBadge verified={person.is_verified_blue} official={person.is_official || person.is_super_admin} granLiga={person.is_gran_liga} className="size-3.5 shrink-0" />
                </p>
                <p className={`mt-1 flex w-full items-center justify-center gap-1 truncate text-[10px] ${isOnline ? "text-emerald-300" : "text-white/55"}`}>
                  <span className={`size-1.5 shrink-0 rounded-full ${isOnline ? "bg-emerald-400" : "bg-zinc-500"}`} />{subtitle}
                </p>
                <Button type="button" size="sm" variant={isFollowing ? "outline" : "default"} disabled={toggleFollow.isPending} onClick={() => {
                  if (!viewerId) { void navigate({ to: "/auth", search: { ref: "" } }); return; }
                  toggleFollow.mutate(person);
                }} className="mt-3 h-8 w-full gap-1 px-2 text-[11px]">
                  {!isFollowing && <UserPlus className="size-3.5" />}{isFollowing ? "Siguiendo" : "Seguir"}
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {term ? "No encontramos personas con ese nombre." : "Ya sigues a todas las personas sugeridas. Vuelve pronto para descubrir más."}
        </p>
      )}
    </section>
  );
}
