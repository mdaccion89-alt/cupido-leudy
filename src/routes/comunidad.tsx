import { useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, SlidersHorizontal, Users } from "lucide-react";
import { toast } from "sonner";
import { ProfileCard, type CupidoProfile } from "@/components/cupido/profile-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { COUNTRIES, LOOKING_FOR, countryFlag } from "@/lib/cupido";

export const Route = createFileRoute("/comunidad")({
  head: () => ({ meta: [{ title: "Comunidad — Cupido Leudy ❤️" }] }),
  component: CommunityPage,
});

type FriendMap = Map<string, string>;

function CommunityPage() {
  const { session } = useAuth();
  const viewerId = session?.user.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("all");
  const [looking, setLooking] = useState("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const people = useQuery({
    queryKey: ["cupido-people", search, country, looking, verifiedOnly],
    queryFn: async () => {
      let query = supabase
        .from("creator_profiles")
        .select("*")
        .order("is_verified_blue", { ascending: false })
        .order("follower_count", { ascending: false })
        .limit(60);
      if (country !== "all") query = query.eq("country_code", country);
      if (looking !== "all") query = query.eq("looking_for", looking);
      if (verifiedOnly) query = query.eq("is_verified_blue", true);
      if (search.trim()) query = query.ilike("display_name", `%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const relations = useQuery({
    queryKey: ["cupido-relations", viewerId],
    enabled: Boolean(viewerId),
    queryFn: async () => {
      const [likes, follows, friends] = await Promise.all([
        supabase.from("cupido_likes").select("target_id,kind").eq("actor_id", viewerId!),
        supabase.from("follows").select("following_id").eq("follower_id", viewerId!),
        supabase
          .from("cupido_friends")
          .select("requester_id,addressee_id,status")
          .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
      ]);
      if (likes.error) throw likes.error;
      if (follows.error) throw follows.error;
      if (friends.error) throw friends.error;
      const liked = new Set((likes.data ?? []).filter((row) => row.kind === "interested").map((row) => row.target_id));
      const following = new Set((follows.data ?? []).map((row) => row.following_id));
      const friendMap: FriendMap = new Map(
        (friends.data ?? []).map((row) => [
          row.requester_id === viewerId ? row.addressee_id : row.requester_id,
          row.status,
        ]),
      );
      return { liked, following, friendMap };
    },
  });

  const cards = useMemo<CupidoProfile[]>(
    () =>
      (people.data ?? []).map((person) => ({
        id: person.id,
        display_name: person.display_name ?? "Miembro",
        avatar_url: person.avatar_url ?? "",
        bio: person.bio ?? "",
        country_code: person.country_code ?? "",
        looking_for: person.looking_for ?? "amistad",
        drinks: Boolean(person.drinks),
        has_kids: Boolean(person.has_kids),
        is_verified_blue: Boolean(person.is_verified_blue),
        friend_count: person.friend_count ?? 0,
        follower_count: person.follower_count ?? 0,
      })),
    [people.data],
  );

  const requireLogin = () => {
    toast.info("Inicia sesión para conectar.");
    void navigate({ to: "/auth" });
  };

  const like = useMutation({
    mutationFn: async ({ targetId, kind }: { targetId: string; kind: "interested" | "pass" }) => {
      if (!viewerId) return requireLogin();
      const { error } = await supabase
        .from("cupido_likes")
        .upsert({ actor_id: viewerId, target_id: targetId, kind }, { onConflict: "actor_id,target_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
    },
    onError: () => toast.error("No se pudo guardar tu interés."),
  });

  const follow = useMutation({
    mutationFn: async (targetId: string) => {
      if (!viewerId) return requireLogin();
      if (relations.data?.following.has(targetId)) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", viewerId)
          .eq("following_id", targetId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: viewerId, following_id: targetId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
    },
    onError: () => toast.error("No se pudo actualizar el seguidor."),
  });

  const friend = useMutation({
    mutationFn: async (targetId: string) => {
      if (!viewerId) return requireLogin();
      const { error } = await supabase
        .from("cupido_friends")
        .insert({ requester_id: viewerId, addressee_id: targetId, status: "pending" });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-relations", viewerId] });
      toast.success("Solicitud de amistad enviada ❤️");
    },
    onError: () => toast.error("No se pudo enviar la solicitud."),
  });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="mb-6">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-pink-300" /> Comunidad
        </p>
        <h1 className="font-display text-3xl text-white sm:text-4xl">Personas reales, conexiones reales</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Filtra por país, intereses e insignia azul. Envía un me gusta, sigue o agrega como amigo.
        </p>
      </section>

      {!session && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pink-400/30 bg-pink-500/10 p-4">
          <p className="text-sm text-pink-100/80">Inicia sesión para dar me gusta, seguir y agregar amigos.</p>
          <Link to="/auth" className="text-sm font-medium text-white underline-offset-4 hover:underline">
            Iniciar sesión
          </Link>
        </div>
      )}

      <section className="mb-6 grid gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label>Buscar por nombre</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre"
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>País</Label>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">Todos los países</SelectItem>
              {COUNTRIES.map(([code, name]) => (
                <SelectItem key={code} value={code}>{countryFlag(code)} {name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Busca</Label>
          <Select value={looking} onValueChange={setLooking}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Cualquier interés</SelectItem>
              {LOOKING_FOR.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.emoji} {item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Checkbox
            id="verified-only"
            checked={verifiedOnly}
            onCheckedChange={(value) => setVerifiedOnly(Boolean(value))}
          />
          <Label htmlFor="verified-only" className="flex items-center gap-1 text-sm">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Solo verificados
          </Label>
        </div>
      </section>

      {people.isLoading ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          Cargando personas…
        </div>
      ) : people.isError ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          No se pudo cargar la comunidad. Intenta de nuevo más tarde.
        </div>
      ) : cards.length > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((person) => (
            <ProfileCard
              key={person.id}
              profile={person}
              myId={viewerId}
              interested={relations.data?.liked.has(person.id)}
              following={relations.data?.following.has(person.id)}
              friendStatus={relations.data?.friendMap.get(person.id)}
              onInterested={(kind) => like.mutate({ targetId: person.id, kind })}
              onFollow={() => follow.mutate(person.id)}
              onFriend={() => friend.mutate(person.id)}
              onGift={() => void navigate({ to: "/tienda", search: { userId: person.id } })}
            />
          ))}
        </section>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          No encontramos personas con esos filtros.
        </div>
      )}
    </main>
  );
}
