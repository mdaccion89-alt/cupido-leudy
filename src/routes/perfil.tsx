import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Loader2, Save, UserPlus, UserRoundMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isVerifiedCreator } from "@/lib/credits";
import { captureDistributionOrder } from "@/lib/distribution.functions";

export const Route = createFileRoute("/perfil")({
  validateSearch: (search: { userId?: string; distribution?: string; token?: string }) => search,
  head: () => ({ meta: [{ title: "Perfil — Leudy IA Adobe" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { session, loading: authLoading } = useAuth();
  const { userId: searchId, distribution, token } = Route.useSearch();
  const viewerId = session?.user.id ?? null;
  const profileId = searchId ?? viewerId;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [fullName, setFullName] = useState("");
  const captureOrder = useServerFn(captureDistributionOrder);
  const capturedRef = useRef(false);

  useEffect(() => {
    if (distribution !== "1" || !token || capturedRef.current) return;
    capturedRef.current = true;
    captureOrder({ data: { orderId: token } })
      .then((result) => {
        if (result.ok) toast.success("Pago confirmado. Tu distribución quedó en revisión.");
        else toast.error(result.message);
      })
      .catch(() => toast.error("No se pudo confirmar el pago."));
  }, [distribution, token, captureOrder]);

  const profile = useQuery({
    queryKey: ["creator-profile", profileId, viewerId],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const [creator, privateProfile, follow, plans] = await Promise.all([
        supabase.from("creator_profiles").select("*").eq("id", profileId!).maybeSingle(),
        supabase
          .from("profiles")
          .select("display_name,full_name,plan,email")
          .eq("id", profileId!)
          .maybeSingle(),
        viewerId
          ? supabase
              .from("follows")
              .select("follower_id")
              .eq("follower_id", viewerId)
              .eq("following_id", profileId!)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("user_roles").select("role").eq("user_id", profileId!),
      ]);
      return {
        creator: creator.data,
        privateProfile: privateProfile.data,
        following: Boolean(follow.data),
        isAdmin: (plans.data ?? []).some((r) => r.role === "admin" || r.role === "admin_supremo"),
      };
    },
  });

  useEffect(() => {
    setDisplayName(
      profile.data?.creator?.display_name ?? profile.data?.privateProfile?.display_name ?? "",
    );
    setBio(profile.data?.creator?.bio ?? "");
    setFullName(profile.data?.privateProfile?.full_name ?? "");
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profileId) return;
      const updates = await Promise.all([
        supabase
          .from("profiles")
          .update({ display_name: displayName, full_name: fullName || null })
          .eq("id", profileId),
        supabase
          .from("creator_profiles")
          .update({ display_name: displayName, bio })
          .eq("id", profileId),
      ]);
      const error = updates.find((r) => r.error)?.error;
      if (error) throw error;
    },
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["creator-profile"] });
      toast.success("Perfil actualizado.");
    },
    onError: () => toast.error("No se pudo actualizar el perfil."),
  });

  const toggleFollow = useMutation({
    mutationFn: async () => {
      if (!viewerId || !profileId) return;
      if (profile.data?.following) {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", viewerId)
          .eq("following_id", profileId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: viewerId, following_id: profileId });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creator-profile"] }),
    onError: () => toast.error("No se pudo actualizar el seguidor."),
  });

  if (authLoading || profile.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Cargando perfil…
      </div>
    );

  if (!profileId) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">Inicia sesión para ver tu perfil</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu perfil público se crea automáticamente con tu cuenta.
          </p>
          <Button asChild variant="hero" className="mt-5">
            <a href="/auth">Iniciar sesión</a>
          </Button>
        </div>
      </main>
    );
  }

  const creator = profile.data?.creator;
  const followers = creator?.follower_count ?? 0;
  const isOfficial = Boolean(creator?.is_official || profile.data?.isAdmin);
  const verified = isVerifiedCreator(followers, Boolean(creator?.is_premium) || isOfficial);
  const own = viewerId === profileId;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8">
      <section className="panel grain overflow-hidden">
        <div className="h-28 bg-gradient-primary/20" />
        <div className="relative px-6 pb-8">
          <div className="-mt-10 flex size-20 items-center justify-center rounded-2xl border-4 border-background bg-gradient-primary text-2xl font-bold shadow-glow">
            {(displayName || "A").slice(0, 1).toUpperCase()}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold">{displayName || "Artista"}</h1>
            {verified && (
              <BadgeCheck className="size-6 text-primary" aria-label="Perfil oficial verificado" />
            )}
            {isOfficial && <Badge>Oficial</Badge>}
            {creator?.is_premium && <Badge variant="secondary">Premium</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {profile.data?.privateProfile?.email}
          </p>
          <p className="mt-4 max-w-xl text-sm text-foreground/80">
            {bio || "Creador de música con IA en Leudy IA Adobe."}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
            <span>
              <strong>{followers.toLocaleString("es")}</strong> seguidores
            </span>
            {own ? (
              <Button variant="glass" size="sm" onClick={() => setEditing(!editing)}>
                {editing ? "Cancelar" : "Editar perfil"}
              </Button>
            ) : viewerId ? (
              <Button
                variant={profile.data?.following ? "glass" : "hero"}
                size="sm"
                disabled={toggleFollow.isPending}
                onClick={() => toggleFollow.mutate()}
              >
                {toggleFollow.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : profile.data?.following ? (
                  <UserRoundMinus />
                ) : (
                  <UserPlus />
                )}
                {profile.data?.following ? "Siguiendo" : "Seguir"}
              </Button>
            ) : null}
          </div>

          {editing && own && (
            <div className="mt-6 grid gap-4 rounded-xl border border-border/60 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre público</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Biografía</Label>
                <Textarea value={bio} maxLength={300} onChange={(e) => setBio(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Button variant="hero" disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Guardar
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
