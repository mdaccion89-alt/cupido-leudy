import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Camera, Gift, Loader2, MessageCircle, Save, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { COUNTRIES, LOOKING_FOR, countryFlag, countryName } from "@/lib/cupido";
import { moderateCupidoPhoto } from "@/lib/cupido.functions";

export const Route = createFileRoute("/perfil")({
  validateSearch: (search: { userId?: string }) => search,
  head: () => ({ meta: [{ title: "Perfil — Cupido Leudy ❤️" }] }),
  component: ProfilePage,
});

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function extensionOf(file: File, fallback: string): string {
  return file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
}

function ProfilePage() {
  const { session, loading: authLoading } = useAuth();
  const { userId: searchId } = Route.useSearch();
  const viewerId = session?.user.id ?? null;
  const profileId = searchId ?? viewerId;
  const queryClient = useQueryClient();
  const avatarInput = useRef<HTMLInputElement>(null);
  const selfieInput = useRef<HTMLInputElement>(null);
  const moderatePhoto = useServerFn(moderateCupidoPhoto);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [countryCode, setCountryCode] = useState("DO");
  const [lookingFor, setLookingFor] = useState("amistad");
  const [drinks, setDrinks] = useState(false);
  const [hasKids, setHasKids] = useState(false);

  const profile = useQuery({
    queryKey: ["cupido-profile", profileId, viewerId],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const [creator, privateProfile, follow, friendA, friendB] = await Promise.all([
        supabase.from("creator_profiles").select("*").eq("id", profileId!).maybeSingle(),
        supabase
          .from("profiles")
          .select("display_name,full_name,email,phone,country_code,terms_accepted_at")
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
        viewerId
          ? supabase
              .from("cupido_friends")
              .select("status")
              .eq("requester_id", viewerId)
              .eq("addressee_id", profileId!)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        viewerId
          ? supabase
              .from("cupido_friends")
              .select("status")
              .eq("requester_id", profileId!)
              .eq("addressee_id", viewerId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        creator: creator.data,
        privateProfile: privateProfile.data,
        following: Boolean(follow.data),
        friendStatus: friendA.data?.status ?? friendB.data?.status ?? null,
      };
    },
  });

  useEffect(() => {
    const creator = profile.data?.creator;
    setDisplayName(creator?.display_name ?? profile.data?.privateProfile?.display_name ?? "");
    setFullName(profile.data?.privateProfile?.full_name ?? "");
    setBio(creator?.bio ?? "");
    setCountryCode(creator?.country_code ?? "DO");
    setLookingFor(creator?.looking_for ?? "amistad");
    setDrinks(Boolean(creator?.drinks));
    setHasKids(Boolean(creator?.has_kids));
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profileId) return;
      const { error } = await supabase.rpc("cupido_save_profile", {
        _display_name: displayName,
        _bio: bio,
        _country_code: countryCode,
        _looking_for: lookingFor,
        _drinks: drinks,
        _has_kids: hasKids,
      });
      if (error) throw error;
      const { error: privateError } = await supabase
        .from("profiles")
        .update({ full_name: fullName || null })
        .eq("id", profileId);
      if (privateError) throw privateError;
    },
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      toast.success("Perfil actualizado ❤️");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo guardar."),
  });

  const avatarUpload = useMutation({
    mutationFn: async (file: File) => {
      if (!viewerId) throw new Error("Inicia sesión.");
      if (!file.type.startsWith("image/")) throw new Error("Elige una imagen válida.");
      if (file.size > 12 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 12 MB.");
      const dataUrl = await readFileAsBase64(file);
      const verdict = await moderatePhoto({ data: { dataUrl } });
      if (!verdict.ok) throw new Error(verdict.message);
      if (!verdict.safe && !verdict.needsReview) throw new Error(verdict.reason);
      const path = `${viewerId}/avatar-${Date.now()}.${extensionOf(file, "jpg")}`;
      const { error } = await supabase.storage.from("cupido-media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("cupido-media").getPublicUrl(path);
      const { error: rpcError } = await supabase.rpc("cupido_set_avatar", {
        _url: data.publicUrl,
        _moderation: verdict.needsReview ? "pending" : "approved",
      });
      if (rpcError) throw rpcError;
      return verdict;
    },
    onSuccess: (verdict) => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      if (verdict.needsReview) toast.info("Foto subida. El Admin Supremo la revisará.");
      else toast.success("Foto aprobada y actualizada ❤️");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo subir la foto."),
  });

  const selfieUpload = useMutation({
    mutationFn: async (file: File) => {
      if (!viewerId) throw new Error("Inicia sesión.");
      if (!file.type.startsWith("image/")) throw new Error("Elige una selfie válida.");
      const dataUrl = await readFileAsBase64(file);
      const verdict = await moderatePhoto({ data: { dataUrl } });
      if (!verdict.ok) throw new Error(verdict.message);
      if (!verdict.safe && !verdict.needsReview) throw new Error(verdict.reason);
      const path = `${viewerId}/selfies/${Date.now()}.${extensionOf(file, "jpg")}`;
      const { error } = await supabase.storage.from("cupido-private").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { error: rpcError } = await supabase.rpc("cupido_submit_selfie", { _path: path });
      if (rpcError) throw rpcError;
      return verdict;
    },
    onSuccess: (verdict) => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      toast.success(
        verdict.needsReview
          ? "Selfie recibida. El Escudo y el Admin Supremo la revisarán."
          : "Selfie aprobada por el Escudo. El Admin Supremo decidirá tu insignia azul.",
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar la selfie."),
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] }),
    onError: () => toast.error("No se pudo actualizar el seguidor."),
  });

  const requestFriend = useMutation({
    mutationFn: async () => {
      if (!viewerId || !profileId) return;
      const { error } = await supabase.from("cupido_friends").insert({
        requester_id: viewerId,
        addressee_id: profileId,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      toast.success("Solicitud de amistad enviada ❤️");
    },
    onError: () => toast.error("No se pudo enviar la solicitud."),
  });

  if (authLoading || profile.isLoading)
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">Cargando perfil…</div>;

  if (!profileId) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">Inicia sesión para ver tu perfil</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu perfil público se crea automáticamente con tu cuenta.
          </p>
          <Button asChild className="mt-5">
            <Link to="/auth">Iniciar sesión</Link>
          </Button>
        </div>
      </main>
    );
  }

  const creator = profile.data?.creator;
  const own = viewerId === profileId;
  const verified = Boolean(creator?.is_verified_blue);
  const followers = creator?.follower_count ?? 0;
  const friends = creator?.friend_count ?? 0;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
        <div className="h-32 bg-gradient-to-r from-pink-600/40 via-fuchsia-600/20 to-transparent" />
        <div className="px-6 pb-8">
          <div className="-mt-12 flex items-end gap-4">
            <div className="flex size-24 items-center justify-center overflow-hidden rounded-3xl border-4 border-background bg-pink-500/20 text-2xl font-bold">
              {creator?.avatar_url ? (
                <img src={creator.avatar_url} alt={displayName || "Perfil"} className="size-full object-cover" />
              ) : (
                (displayName || "C").slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl text-white">{displayName || "Miembro de Cupido"}</h1>
                {verified && (
                  <BadgeCheck className="size-6 fill-sky-400 text-white" aria-label="Verificado" />
                )}
                {creator?.verification_status === "pending" && <Badge variant="secondary">Verificación pendiente</Badge>}
                {creator?.verification_status === "rejected" && <Badge variant="destructive">Verificación rechazada</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {countryFlag(creator?.country_code)} {countryName(creator?.country_code)} ·{" "}
                {followers.toLocaleString("es")} seguidores · {friends.toLocaleString("es")} amigos
              </p>
            </div>
          </div>

          <p className="mt-5 max-w-2xl text-sm text-foreground/80">
            {bio || "Todavía no escribió su biografía."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-pink-500/15 px-3 py-1 text-pink-200">
              Busca {LOOKING_FOR.find((item) => item.value === lookingFor)?.label ?? lookingFor}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1">{drinks ? "Toma" : "No toma"}</span>
            <span className="rounded-full bg-white/10 px-3 py-1">{hasKids ? "Con hijos" : "Sin hijos"}</span>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {own ? (
              <Button onClick={() => setEditing((value) => !value)}>{editing ? "Cancelar" : "Editar perfil"}</Button>
            ) : viewerId ? (
              <>
                <Button variant={profile.data?.following ? "outline" : "default"} onClick={() => toggleFollow.mutate()} disabled={toggleFollow.isPending}>
                  {toggleFollow.isPending && <Loader2 className="animate-spin" />}
                  {profile.data?.following ? "Dejar de seguir" : "Seguir"}
                </Button>
                <Button variant="outline" onClick={() => requestFriend.mutate()} disabled={requestFriend.isPending || Boolean(profile.data?.friendStatus)}>
                  <UserPlus /> {profile.data?.friendStatus === "pending" ? "Solicitud enviada" : profile.data?.friendStatus === "accepted" ? "Amigos" : "Agregar amigo"}
                </Button>
                <Button asChild>
                  <Link to="/chat" search={{ userId: profileId }}>
                    <MessageCircle /> Chatear
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link to="/tienda" search={{ userId: profileId }}>
                    <Gift /> Enviar regalo
                  </Link>
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link to="/auth">Inicia sesión para conectar</Link>
              </Button>
            )}
          </div>

          {own && editing && (
            <div className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-black/20 p-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nombre público</Label>
                <Input value={displayName} maxLength={60} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={fullName} maxLength={80} onChange={(event) => setFullName(event.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Biografía</Label>
                <Textarea value={bio} maxLength={300} onChange={(event) => setBio(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>País</Label>
                <Select value={countryCode} onValueChange={setCountryCode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {COUNTRIES.map(([code, name]) => (
                      <SelectItem key={code} value={code}>{countryFlag(code)} {name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Qué busca</Label>
                <Select value={lookingFor} onValueChange={setLookingFor}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOOKING_FOR.map((item) => (
                      <SelectItem key={item.value} value={item.value}>{item.emoji} {item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={drinks} onCheckedChange={(value) => setDrinks(Boolean(value))} />
                Toma alcohol
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={hasKids} onCheckedChange={(value) => setHasKids(Boolean(value))} />
                Tiene hijos
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Guardar
                </Button>
                <Button variant="outline" onClick={() => avatarInput.current?.click()} disabled={avatarUpload.isPending}>
                  {avatarUpload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Cambiar foto
                </Button>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) avatarUpload.mutate(file);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </div>
          )}

          {own && (
            <div className="mt-6 rounded-2xl border border-sky-400/30 bg-sky-500/10 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-semibold text-white">
                    <Camera className="h-4 w-4 text-sky-300" /> Verificación azul
                  </p>
                  <p className="mt-1 text-xs text-sky-100/70">
                    Sube una selfie real. El Admin Supremo la revisa y activa tu insignia azul.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => selfieInput.current?.click()} disabled={selfieUpload.isPending}>
                  {selfieUpload.isPending ? <Loader2 className="animate-spin" /> : <Camera />}
                  {creator?.verification_status === "approved" ? "Actualizar selfie" : "Enviar selfie"}
                </Button>
                <input
                  ref={selfieInput}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) selfieUpload.mutate(file);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
