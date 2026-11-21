import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, Loader2, MessageCircle, Save, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InviteButton } from "@/components/cupido/invite-button";
import { LiveFaceVerification } from "@/components/cupido/live-face-verification";
import { ProfileSettings } from "@/components/cupido/profile-settings";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";
import { WallFeed } from "@/components/cupido/wall-feed";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAccount, isSupremeAdminEmail } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { COUNTRIES, LOOKING_FOR, countryFlag, countryName } from "@/lib/cupido";
import { moderateCupidoPhoto } from "@/lib/cupido.functions";
import { notifyUser } from "@/lib/posts";
import { extraField, saveAvatarDirect, saveProfileDirect } from "@/lib/profile-write";
import { compressImageFile, uploadPublicImage } from "@/lib/storage";

export const Route = createFileRoute("/perfil")({
  validateSearch: (search: { userId?: string }) => search,
  head: () => ({ meta: [{ title: "Perfil — Cupido Leudy ❤️" }] }),
  component: () => (
    <SafeViewBoundary label="tu perfil">
      <ProfilePage />
    </SafeViewBoundary>
  ),
});

function safeText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function safeCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

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

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",").pop() ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function ProfilePage() {
  const { session, loading: authLoading } = useAuth();
  const account = useAccount();
  const { userId: searchId } = Route.useSearch();
  const viewerId = safeText(session?.user.id) || null;
  const searchProfileId = safeText(searchId);
  const profileId = searchProfileId || viewerId;
  const queryClient = useQueryClient();
  const avatarInput = useRef<HTMLInputElement>(null);
  const moderatePhoto = useServerFn(moderateCupidoPhoto);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
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
          .select(
            "display_name,full_name,email,phone,country_code,terms_accepted_at,avatar_url,bio,age,gender,looking_for,drinks,has_kids",
          )
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
    const privateProfile = profile.data?.privateProfile;
    setDisplayName(safeText(creator?.display_name, safeText(privateProfile?.display_name)));
    setFullName(safeText(privateProfile?.full_name));
    setBio(safeText(creator?.bio, safeText(privateProfile?.bio)));
    setAge(safeText(extraField(creator, "age"), safeText(privateProfile?.age)));
    setGender(safeText(extraField(creator, "gender"), safeText(privateProfile?.gender)));
    setCountryCode(safeText(creator?.country_code, safeText(privateProfile?.country_code, "DO")) || "DO");
    setLookingFor(safeText(creator?.looking_for, safeText(privateProfile?.looking_for, "amistad")) || "amistad");
    setDrinks(Boolean(creator?.drinks ?? privateProfile?.drinks));
    setHasKids(Boolean(creator?.has_kids ?? privateProfile?.has_kids));
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profileId) return;
      const parsedAge = Number.parseInt(age, 10);
      await saveProfileDirect(profileId, {
        displayName: displayName.trim() || "Miembro de Cupido",
        fullName: fullName.trim(),
        bio: bio.trim(),
        age: Number.isFinite(parsedAge) && parsedAge >= 18 && parsedAge <= 100 ? parsedAge : null,
        gender: gender.trim() || null,
        countryCode,
        lookingFor,
        drinks,
        hasKids,
      });
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
      if (file.size > 25 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 25 MB.");
      const uploadFile = await compressImageFile(file);
      const dataUrl = await readFileAsBase64(uploadFile);
      const verdict = await moderatePhoto({ data: { dataUrl } });
      if (!verdict.ok) throw new Error(verdict.message);
      if (!verdict.safe && !verdict.needsReview) throw new Error(verdict.reason);
      const { url } = await uploadPublicImage(viewerId, uploadFile, "avatars", extensionOf(uploadFile, "jpg"));
      await saveAvatarDirect(viewerId, url, verdict.needsReview ? "pending" : "approved");
      return verdict;
    },
    onSuccess: (verdict) => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      if (verdict.needsReview) toast.info("Foto subida. El Admin Supremo la revisará.");
      else toast.success("Foto aprobada y actualizada ❤️");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo subir la foto."),
  });

  const liveVerification = useMutation({
    mutationFn: async (frames: string[]) => {
      if (!viewerId) throw new Error("Inicia sesión.");
      if (frames.length !== 3) throw new Error("Debes completar las 3 poses.");
      const stamp = Date.now();
      const paths: string[] = [];
      for (let index = 0; index < frames.length; index += 1) {
        const path = `${viewerId}/verification/${stamp}-${index + 1}.jpg`;
        const { error } = await supabase.storage.from("cupido-private").upload(path, dataUrlBytes(frames[index]!), {
          contentType: "image/jpeg",
          upsert: false,
        });
        if (error) throw error;
        paths.push(path);
      }
      const { error: rpcError } = await supabase.rpc("cupido_submit_live_verification", { _frames: paths });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      toast.success("3 capturas enviadas. El Admin Supremo revisará tu verificación ❤️");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "No se pudo enviar la verificación."),
  });

  const toggleFollow = useMutation({
    mutationFn: async () => {
      if (!viewerId || !profileId) return;
      if (Boolean(profile.data?.following)) {
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
    onSuccess: () => {
      if (profileId && viewerId && !Boolean(profile.data?.following)) {
        void notifyUser({
          userId: profileId,
          title: "👀 Nueva persona que te sigue",
          body: "Alguien acaba de seguir tu perfil.",
          kind: "follow",
          actorId: viewerId,
          targetId: profileId,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
    },
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
      if (profileId && viewerId) {
        void notifyUser({
          userId: profileId,
          title: "🤝 Solicitud de amistad",
          body: "Una persona real quiere ser tu amiga.",
          kind: "friend",
          actorId: viewerId,
          targetId: profileId,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      toast.success("Solicitud de amistad enviada ❤️");
    },
    onError: () => toast.error("No se pudo enviar la solicitud."),
  });

  if (authLoading || profile.isLoading)
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">Cargando perfil…</div>;

  if (profile.isError) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">No se pudo cargar este perfil</h1>
          <p className="mt-2 text-sm text-muted-foreground">Intenta recargar la página en unos segundos.</p>
          <Button className="mt-5" onClick={() => void profile.refetch()}>Reintentar</Button>
        </div>
      </main>
    );
  }

  if (!profileId) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">Inicia sesión para ver tu perfil</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tu perfil público se crea automáticamente con tu cuenta.
          </p>
          <Button asChild className="mt-5">
            <Link to="/auth" search={{ ref: "" }}>Iniciar sesión</Link>
          </Button>
        </div>
      </main>
    );
  }

  const creator = profile.data?.creator ?? null;
  const privateProfile = profile.data?.privateProfile ?? null;
  const own = Boolean(viewerId && viewerId === profileId);
  const isAdmin = Boolean(account.isAdmin) && own;
  const verified = Boolean(creator?.is_verified_blue);
  const followers = safeCount(creator?.follower_count);
  const friends = safeCount(creator?.friend_count);
  const countryForDisplay = safeText(creator?.country_code, safeText(privateProfile?.country_code, "DO")) || "DO";
  const profileEmail = safeText(privateProfile?.email) || undefined;
  const avatarUrl = safeText(creator?.avatar_url).trim();
  const publicAge = safeText(extraField(creator, "age"), safeText(privateProfile?.age)) || "—";
  const publicGender = safeText(extraField(creator, "gender"), safeText(privateProfile?.gender)) || "—";

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
        <div className="h-32 bg-gradient-to-r from-pink-600/40 via-fuchsia-600/20 to-transparent" />
        <div className="px-6 pb-8">
          <div className="-mt-12 flex items-end gap-4">
            <div className="flex size-24 items-center justify-center overflow-hidden rounded-3xl border-4 border-background bg-pink-500/20 text-2xl font-bold">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName || "Perfil"} className="size-full object-cover" />
              ) : (
                (displayName || "C").slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl text-white">{displayName || "Miembro de Cupido"}</h1>
                <VerifiedBadge
                  email={profileEmail}
                  verified={
                    verified ||
                    Boolean(creator?.is_official) ||
                    isSupremeAdminEmail(profileEmail)
                  }
                  className="size-6"
                />
                {Boolean(creator?.is_official) && (
                  <Badge className="gap-1 bg-gradient-to-r from-pink-500 to-violet-500">
                    <VerifiedBadge verified className="size-3.5" /> Cuenta Oficial
                  </Badge>
                )}
                {creator?.verification_status === "pending" && <Badge variant="secondary">Verificación pendiente</Badge>}
                {creator?.verification_status === "rejected" && <Badge variant="destructive">Verificación rechazada</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {countryFlag(countryForDisplay)} {countryName(countryForDisplay)} ·{" "}
                {publicAge} años ·{" "}
                {publicGender} ·{" "}
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
                <Button variant={Boolean(profile.data?.following) ? "outline" : "default"} onClick={() => toggleFollow.mutate()} disabled={toggleFollow.isPending}>
                  {toggleFollow.isPending && <Loader2 className="animate-spin" />}
                  {Boolean(profile.data?.following) ? "Dejar de seguir" : "Seguir"}
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
                <Link to="/auth" search={{ ref: "" }}>Inicia sesión para conectar</Link>
              </Button>
            )}
          </div>

          {own && editing && (
            <div className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-black/20 p-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{isAdmin ? "Nombre público (Cuenta Oficial)" : "Nombre público"}</Label>
                <Input
                  value={displayName}
                  maxLength={60}
                  disabled={isAdmin}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={fullName} maxLength={80} onChange={(event) => setFullName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Edad</Label>
                <Input
                  type="number"
                  min={18}
                  max={100}
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  placeholder="18"
                />
              </div>
              <div className="space-y-2">
                <Label>Género</Label>
                <Select value={gender || "prefiero-no-decirlo"} onValueChange={(value) => setGender(value === "prefiero-no-decirlo" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mujer">Mujer</SelectItem>
                    <SelectItem value="hombre">Hombre</SelectItem>
                    <SelectItem value="no-binario">No binario</SelectItem>
                    <SelectItem value="prefiero-no-decirlo">Prefiero no decirlo</SelectItem>
                  </SelectContent>
                </Select>
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

          {own && !isAdmin && (
            <div className="mt-6">
              <LiveFaceVerification onComplete={(frames) => liveVerification.mutateAsync(frames)} />
            </div>
          )}

          {own && viewerId && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pink-400/25 bg-pink-500/[0.06] p-4">
              <div>
                <p className="text-sm font-medium text-white">Invita y gana +200 monedas brillantes</p>
                <p className="mt-1 text-xs text-pink-100/70">
                  Comparte tu enlace. Recibirás la recompensa cuando tu invitado apruebe su verificación facial.
                </p>
              </div>
              <InviteButton userId={viewerId} />
            </div>
          )}

          {own && viewerId && (
            <div className="mt-6">
              <ProfileSettings
                email={profileEmail}
                phone={safeText(privateProfile?.phone) || undefined}
              />
            </div>
          )}
        </div>
      </section>

      <section className="mt-8 space-y-8">
        <div>
          <h2 className="mb-4 font-display text-xl text-white">Publicaciones de {displayName || "este perfil"}</h2>
          <WallFeed
            onlyUserId={profileId}
            hideUpload
            emptyText="Esta persona todavía no tiene fotos ni videos publicados."
          />
        </div>
        {own && viewerId && (
          <div>
            <h2 className="mb-4 font-display text-xl text-white">Mis favoritos 🔖</h2>
            <WallFeed
              savedOnly
              hideUpload
              emptyText="Aún no guardaste publicaciones. Toca 🔖 en cualquier foto o video."
            />
          </div>
        )}
      </section>
    </main>
  );
}
