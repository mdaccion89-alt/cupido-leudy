import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, Gift, Heart, Loader2, MessageCircle, Save, ShieldCheck, Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InviteButton } from "@/components/cupido/invite-button";
import { FaceVideoVerification } from "@/components/cupido/live-face-verification";
import { LegalLinks } from "@/components/cupido/legal-links";
import { ProfileSettings } from "@/components/cupido/profile-settings";
import { CupidoGroupInvites, GranLigaGroups } from "@/components/cupido/gran-liga-groups";
import { CupidoStudioPanel } from "@/components/cupido/cupido-studio-panel";
import { SafeViewBoundary } from "@/components/cupido/safe-view-boundary";
import { WallFeed } from "@/components/cupido/wall-feed";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { supabase } from "@/integrations/supabase/client";
import { displayedFollowerCount, useAccount, isSupremeAdminEmail } from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { COUNTRIES, LOOKING_FOR, countryFlag, countryName } from "@/lib/cupido";
import { moderateCupidoPhoto } from "@/lib/cupido.functions";
import { extraField, saveAvatarDirect, saveProfileDirect } from "@/lib/profile-write";
import { compressImageFile } from "@/lib/storage";
import { blockUser, reportUser } from "@/lib/safety";

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

function limitProfileName(value: string): string {
  return Array.from(value).slice(0, 40).join("");
}

function safeCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function ageFromBirthDate(value: string): number | null {
  if (!value) return null;
  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) years -= 1;
  return years;
}

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message || fallback;
  if (value && typeof value === "object" && "message" in value) {
    const message = String((value as { message?: unknown }).message ?? "");
    if (message) return message;
  }
  return fallback;
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
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState("");
  const [countryCode, setCountryCode] = useState("DO");
  const [lookingFor, setLookingFor] = useState("amistad");
  const [drinks, setDrinks] = useState(false);
  const [hasKids, setHasKids] = useState(false);
  const [zodiac, setZodiac] = useState("");
  const [smokes, setSmokes] = useState(false);
  const [hobbies, setHobbies] = useState("");
  const [followersOpen, setFollowersOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"posts" | "saved" | "favorites">("posts");

  const profile = useQuery({
    queryKey: ["cupido-profile", profileId, viewerId],
    enabled: Boolean(profileId),
    queryFn: async () => {
      const [creator, privateProfile, follow, friendA, friendB, followerTotal, watchSeconds] = await Promise.all([
        supabase
          .from("cupido_public_profiles")
          .select("id,display_name,avatar_url,bio,country_code,age,gender,looking_for,zodiac,smokes,hobbies,survey_completed,drinks,has_kids,is_verified_blue,is_gran_liga,is_super_admin,is_official,is_cupido_active,hide_followers,verification_status,friend_count,follower_count,created_at")
          .eq("id", profileId!)
          .maybeSingle(),
        viewerId === profileId
          ? supabase
              .from("profiles")
              .select("display_name,full_name,email,phone,birth_date,country_code,terms_accepted_at,avatar_url,bio,age,gender,looking_for,drinks,has_kids,zodiac,smokes,hobbies,survey_completed,hide_followers")
              .eq("id", profileId!)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
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
              .from("friend_requests")
              .select("status")
              .eq("requester_id", viewerId)
              .eq("addressee_id", profileId!)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        viewerId
          ? supabase
              .from("friend_requests")
              .select("status")
              .eq("requester_id", profileId!)
              .eq("addressee_id", viewerId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.rpc("cupido_count_followers", { _following: profileId! }),
        viewerId === profileId
          ? supabase.rpc("cupido_get_video_watch_seconds", { _user: profileId! })
          : Promise.resolve({ data: 0, error: null }),
      ]);
      if (creator.error) {
        console.error("[perfil] Falló la consulta del perfil público.", creator.error);
        throw creator.error;
      }
      if (privateProfile.error) {
        console.error("[perfil] No se pudieron leer los datos privados del propietario.", privateProfile.error);
        throw privateProfile.error;
      }
      return {
        creator: creator.data,
        privateProfile: privateProfile.data,
        following: Boolean(follow.data),
        actualFollowerCount: followerTotal.data ?? 0,
        videoWatchSeconds: watchSeconds.data ?? 0,
        friendStatus: friendA.data?.status ?? friendB.data?.status ?? null,
      };
    },
  });

  useEffect(() => {
    if (!profileId) return;
    const channelName = `cupido-profile-followers-${profileId}-${viewerId ?? "guest"}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel((channelName) + "-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cupido_follower_count_events", filter: `user_id=eq.${profileId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["cupido-profile", profileId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, queryClient, viewerId]);

  useEffect(() => {
    if (!profileId) return;
    const channel = supabase
      .channel((`cupido-profile-live-${profileId}`) + "-" + crypto.randomUUID())
      .on("postgres_changes", { event: "*", schema: "public", table: "creator_profiles", filter: `id=eq.${profileId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-profile", profileId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "follows", filter: `following_id=eq.${profileId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["cupido-profile", profileId] });
        void queryClient.invalidateQueries({ queryKey: ["cupido-followers", profileId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profileId, queryClient]);

  const followersList = useQuery({
    queryKey: ["cupido-followers", profileId],
    enabled: Boolean(profileId && followersOpen && !profile.data?.creator?.is_official && !profile.data?.creator?.is_super_admin && !profile.data?.creator?.hide_followers),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cupido_list_followers", { _following: profileId! });
      if (error) throw error;
      return data ?? [];
    },
  });

  const friendsList = useQuery({
    queryKey: ["cupido-friends", profileId],
    enabled: Boolean(profileId && friendsOpen),
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: Array<{ friend_id: string; display_name: string; avatar_url: string }> | null; error: { message: string } | null }> })
        .rpc("cupido_list_friends", { _user: profileId! });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    const creator = profile.data?.creator;
    const privateProfile = profile.data?.privateProfile;
    setDisplayName(safeText(creator?.display_name, safeText(privateProfile?.display_name)));
    setFullName(safeText(privateProfile?.full_name));
    setBirthDate(safeText(privateProfile?.birth_date));
    setPhone(safeText(privateProfile?.phone));
    setBio(safeText(creator?.bio, safeText(privateProfile?.bio)));
    setAge(safeText(extraField(creator, "age"), safeText(privateProfile?.age)));
    setGender(safeText(extraField(creator, "gender"), safeText(privateProfile?.gender)));
    setCountryCode(safeText(creator?.country_code, safeText(privateProfile?.country_code, "DO")) || "DO");
    setLookingFor(safeText(creator?.looking_for, safeText(privateProfile?.looking_for, "amistad")) || "amistad");
    setDrinks(Boolean(creator?.drinks ?? privateProfile?.drinks));
    setHasKids(Boolean(creator?.has_kids ?? privateProfile?.has_kids));
    setZodiac(safeText(creator?.zodiac, safeText(privateProfile?.zodiac)));
    setSmokes(Boolean(creator?.smokes ?? privateProfile?.smokes));
    setHobbies(safeText(creator?.hobbies, safeText(privateProfile?.hobbies)));
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profileId) return;
      const publicName = displayName.trim() || fullName.trim();
      const personalName = fullName.trim() || publicName;
      if (!publicName || !personalName || Array.from(publicName).length > 40 || Array.from(personalName).length > 40) {
        throw new Error("Escribe un nombre público y un nombre completo de hasta 40 caracteres.");
      }
      const birthdayAge = ageFromBirthDate(birthDate);
      if (birthDate && (!birthdayAge || birthdayAge < 18 || birthdayAge > 120)) {
        throw new Error("La fecha de nacimiento debe corresponder a una persona adulta.");
      }
      const parsedAge = birthdayAge ?? Number.parseInt(age, 10);
      await saveProfileDirect(profileId, {
        displayName: publicName,
        fullName: personalName,
        bio: bio.trim(),
        age: Number.isFinite(parsedAge) && parsedAge >= 18 && parsedAge <= 100 ? parsedAge : null,
        gender: gender.trim() || null,
        countryCode,
        lookingFor,
        drinks,
        hasKids,
        birthDate,
        phone: phone.trim(),
        zodiac,
        smokes,
        hobbies: hobbies.trim(),
        surveyCompleted: true,
      });
    },
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-media"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-post-comments"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-profiles"] });
      toast.success("Perfil actualizado ❤️");
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo guardar.")),
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
      const path = `${viewerId}/${Date.now()}.${extensionOf(uploadFile, "jpg")}`;
      const { error: uploadError } = await supabase.storage.from("media").upload(path, uploadFile, {
        contentType: uploadFile.type || "image/jpeg",
        upsert: true,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { data: publicData } = supabase.storage.from("media").getPublicUrl(path);
      const url = publicData?.publicUrl ?? "";
      if (!url) throw new Error("No se pudo obtener la URL pública de la imagen.");
      await saveAvatarDirect(viewerId, url, verdict.needsReview ? "pending" : "approved");
      return verdict;
    },
    onSuccess: (verdict) => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      if (verdict.needsReview) toast.info("Foto subida. El Admin Supremo la revisará.");
      else toast.success("Foto aprobada y actualizada ❤️");
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo subir la foto.")),
  });

  const liveVerification = useMutation({
    mutationFn: async (video: Blob) => {
      if (!viewerId) throw new Error("Inicia sesión.");
      if (video.size < 1 || video.size > 20 * 1024 * 1024) throw new Error("El video debe pesar menos de 20 MB.");
      const extension = video.type.includes("mp4") ? "mp4" : "webm";
      const path = `${viewerId}/verification/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("cupido-private").upload(path, video, {
        contentType: video.type || "video/webm",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: rpcError } = await supabase.rpc("cupido_submit_face_verification_video", { _video_path: path });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      setVerificationOpen(false);
      toast.success("Video enviado al Administrador Oficial para revisión.");
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo enviar la verificación.")),
  });

  const toggleHideFollowers = useMutation({
    mutationFn: async (hidden: boolean) => {
      if (!viewerId || viewerId !== profileId) throw new Error("Solo puedes cambiar tu propia privacidad.");
      const profileUpdate = await supabase.from("profiles").update({ hide_followers: hidden }).eq("id", viewerId);
      if (profileUpdate.error) throw profileUpdate.error;
      const creatorUpdate = await supabase.from("creator_profiles").update({ hide_followers: hidden }).eq("id", viewerId);
      if (creatorUpdate.error) throw creatorUpdate.error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile", profileId] });
      toast.success("Privacidad de seguidores actualizada.");
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo actualizar la privacidad.")),
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
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["cupido-people"] });
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo actualizar el seguidor.")),
  });

  const requestFriend = useMutation({
    mutationFn: async () => {
      if (!viewerId || !profileId) return;
      const { error } = await supabase.from("friend_requests").upsert(
        { requester_id: viewerId, addressee_id: profileId, status: "pending" },
        { onConflict: "requester_id,addressee_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cupido-profile"] });
      toast.success("Solicitud de amistad enviada ❤️");
    },
    onError: (error) => toast.error(errorMessage(error, "No se pudo enviar la solicitud.")),
  });

  if (authLoading || profile.isLoading)
    return <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">Cargando perfil…</div>;

  if (profile.isError) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-5">
        <div className="panel grain max-w-md p-8 text-center">
          <h1 className="text-xl font-semibold">No se pudo cargar este perfil</h1>
          <pre className="mt-2 break-words whitespace-pre-wrap text-left font-mono text-xs text-red-300">
            {errorMessage(profile.error, "Error desconocido al cargar el perfil.")}
          </pre>
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
  const isSupremeAdmin = isSupremeAdminEmail(session?.user.email);
  const isAdmin = isSupremeAdmin && own;
  const verified = Boolean(creator?.is_verified_blue);
  const profileEmail = safeText(privateProfile?.email) || undefined;
  const officialProfile = Boolean(creator?.is_official || creator?.is_super_admin || isSupremeAdminEmail(profileEmail));
  const displayLabel = displayName || (officialProfile ? "Cupido Leudy Cuenta Oficial" : "Miembro de Cupido");
  const actualFollowerCount = safeCount(profile.data?.actualFollowerCount);
  const followers = displayedFollowerCount(actualFollowerCount, profileEmail, officialProfile);
  const friends = safeCount(creator?.friend_count);
  const countryForDisplay = safeText(creator?.country_code, safeText(privateProfile?.country_code, "DO")) || "DO";
  const avatarUrl = safeText(creator?.avatar_url).trim();
  const verificationProfile = privateProfile;
  const verificationEligible = Boolean(
    own && !officialProfile && verificationProfile?.avatar_url && verificationProfile?.full_name?.trim()
    && verificationProfile?.birth_date && verificationProfile?.country_code?.trim()
    && verificationProfile?.phone?.trim() && verificationProfile?.bio?.trim()
    && verificationProfile?.survey_completed === true,
  );
  const publicAge = safeText(extraField(creator, "age"), safeText(privateProfile?.age)) || "—";
  const publicGender = safeText(extraField(creator, "gender"), safeText(privateProfile?.gender)) || "—";

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      {isSupremeAdmin && (
        <Button asChild className="mb-5 h-14 w-full justify-center gap-3 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-pink-600 text-base font-bold text-white shadow-lg shadow-orange-950/30 hover:brightness-110">
          <Link to="/admin"><ShieldCheck className="size-5" /> Panel Admin Supremo (/admin)</Link>
        </Button>
      )}
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
        <div className={`relative h-32 bg-gradient-to-r ${creator?.is_gran_liga ? "animate-pulse from-amber-400/70 via-orange-600/35 to-red-600/30" : "from-pink-600/40 via-fuchsia-600/20 to-transparent"}`}>
          {creator?.is_gran_liga && <span className="absolute bottom-3 right-5 rounded-full border border-amber-200/50 bg-black/50 px-3 py-1 text-xs font-bold tracking-wide text-amber-100">🔥 Portada VIP · GRAN LIGA 🔥</span>}
        </div>
        <div className="px-6 pb-8">
          <div className="-mt-12 flex items-end gap-4">
            <div className="relative shrink-0">
              <div className={`flex size-24 items-center justify-center overflow-hidden rounded-3xl border-4 border-background bg-pink-500/20 text-2xl font-bold ${creator?.is_gran_liga ? "ring-2 ring-amber-300 shadow-[0_0_24px_rgba(251,191,36,0.75)]" : ""}`}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt={displayName || "Perfil"} className="size-full object-cover" />
                ) : (
                  (displayName || "C").slice(0, 1).toUpperCase()
                )}
              </div>
              {creator?.is_gran_liga && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-2xl drop-shadow-[0_0_9px_rgba(251,191,36,0.95)] animate-bounce" aria-label="Estrella de Gran Liga">⭐</span>}
            </div>
            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl text-white">{displayLabel}</h1>
                <VerifiedBadge
                  email={profileEmail}
                  official={officialProfile}
                  granLiga={Boolean(creator?.is_gran_liga)}
                  verified={
                    verified ||
                    Boolean(creator?.is_official) ||
                    officialProfile
                  }
                  className="size-6"
                />
                {officialProfile && (
                  <Badge className="gap-1 bg-gradient-to-r from-pink-500 to-violet-500">
                    <VerifiedBadge verified official className="size-3.5" /> Cuenta Oficial
                  </Badge>
                )}
                {creator?.verification_status === "pending" && <Badge variant="secondary">Verificación pendiente</Badge>}
                {creator?.verification_status === "rejected" && <Badge variant="destructive">Verificación rechazada</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {countryFlag(countryForDisplay)} {countryName(countryForDisplay)} ·{" "}
                {publicAge} años ·{" "}
                {publicGender} ·{" "}
                <span className="text-white">{followers.toLocaleString("es")} seguidores</span> · <button type="button" className="text-white hover:underline" onClick={() => setFriendsOpen(true)}>{friends.toLocaleString("es")} amigos</button>
              </p>
              {officialProfile ? (
                <p className="mt-2 text-xs text-muted-foreground">La lista de seguidores de la Cuenta Oficial es privada</p>
              ) : creator?.hide_followers && !own ? (
                <p className="mt-2 text-xs text-muted-foreground">Esta persona mantiene privada su lista de seguidores.</p>
              ) : (
                <Button variant="link" className="mt-1 h-auto px-0 text-xs text-pink-300" onClick={() => setFollowersOpen(true)}>
                  Ver quién sigue este perfil ({actualFollowerCount.toLocaleString("es")})
                </Button>
              )}

            </div>
          </div>

          <Dialog open={followersOpen} onOpenChange={setFollowersOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Seguidores reales</DialogTitle></DialogHeader>
              {officialProfile ? <p className="py-6 text-center text-sm text-muted-foreground">La lista de seguidores de la Cuenta Oficial es privada</p> : null}
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {followersList.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Cargando seguidores...</p> : null}
                {followersList.data?.map((follower) => (
                  <Link key={follower.follower_id} to="/perfil" search={{ userId: follower.follower_id }} onClick={() => setFollowersOpen(false)} className="flex items-center gap-3 rounded-xl p-2 hover:bg-accent">
                    <Avatar className="size-10"><AvatarImage src={follower.avatar_url ?? ""} alt={safeText(follower.display_name, "Miembro")} /><AvatarFallback>{safeText(follower.display_name, "M").slice(0, 1)}</AvatarFallback></Avatar>
                    <span className="text-sm font-medium">{safeText(follower.display_name, "Miembro")}</span>
                  </Link>
                ))}
                {!followersList.isLoading && !followersList.data?.length ? <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay seguidores activos.</p> : null}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={friendsOpen} onOpenChange={setFriendsOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Amigos reales</DialogTitle></DialogHeader>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {friendsList.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Cargando amigos...</p>}
                {(friendsList.data ?? []).map((friend) => <Link key={friend.friend_id} to="/perfil" search={{ userId: friend.friend_id }} onClick={() => setFriendsOpen(false)} className="flex items-center gap-3 rounded-xl p-2 hover:bg-accent"><Avatar className="size-10"><AvatarImage src={friend.avatar_url ?? ""} alt={safeText(friend.display_name, "Miembro")} /><AvatarFallback>{safeText(friend.display_name, "M").slice(0, 1)}</AvatarFallback></Avatar><span className="text-sm font-medium">{safeText(friend.display_name, "Miembro")}</span></Link>)}
                {!friendsList.isLoading && !friendsList.data?.length && <p className="py-6 text-center text-sm text-muted-foreground">Todavía no hay amigos activos.</p>}
              </div>
            </DialogContent>
          </Dialog>
          <p className="mt-5 max-w-2xl text-sm text-foreground/80">
            {bio || "Todavía no escribió su biografía."}
          </p>
          {Boolean(creator?.survey_completed ?? privateProfile?.survey_completed) ? <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-pink-500/15 px-3 py-1 text-pink-200">
              Busca {LOOKING_FOR.find((item) => item.value === lookingFor)?.label ?? lookingFor}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1">{drinks ? "Toma" : "No toma"}</span>
            <span className="rounded-full bg-white/10 px-3 py-1">{hasKids ? "Con hijos" : "Sin hijos"}</span>
            {safeText(creator?.zodiac, safeText(privateProfile?.zodiac)) && (
              <span className="rounded-full bg-white/10 px-3 py-1">Signo: {safeText(creator?.zodiac, safeText(privateProfile?.zodiac))}</span>
            )}
            <span className="rounded-full bg-white/10 px-3 py-1">{Boolean(creator?.smokes ?? privateProfile?.smokes) ? "Fuma" : "No fuma"}</span>
          </div> : <p className="mt-3 text-xs text-muted-foreground">La encuesta de perfil es opcional y está pendiente.</p>}
          {Boolean(creator?.survey_completed ?? privateProfile?.survey_completed) && safeText(creator?.hobbies, safeText(privateProfile?.hobbies)) && (
            <p className="mt-3 text-sm text-muted-foreground">Pasatiempos: {safeText(creator?.hobbies, safeText(privateProfile?.hobbies))}</p>
          )}

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
                <Button asChild variant="outline">
                  <Link to="/tienda" search={{ userId: profileId }}>
                    <Gift /> Enviar regalo
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => void reportUser(profileId!, "Perfil reportado desde su página").then(() => toast.success("Reporte enviado al equipo de moderación.")).catch((error: unknown) => toast.error(errorMessage(error, "No se pudo enviar el reporte.")))}>
                  <Flag /> Reportar
                </Button>
                <Button variant="destructive" onClick={() => void blockUser(profileId!).then(() => { toast.success("Usuario bloqueado. Sus publicaciones se ocultarán."); window.location.assign("/muro"); }).catch((error: unknown) => toast.error(errorMessage(error, "No se pudo bloquear al usuario.")))}>
                  <Ban /> Bloquear
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link to="/auth" search={{ ref: "" }}>Inicia sesión para conectar</Link>
              </Button>
            )}
          </div>
          <LegalLinks className="mt-5 justify-start" />

          {own && editing && (
            <div className="mt-8 grid gap-5 rounded-2xl border border-white/10 bg-black/20 p-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{isAdmin ? "Nombre público (Cuenta Oficial)" : "Nombre público"}</Label>
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(limitProfileName(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre completo</Label>
                <Input value={fullName} onChange={(event) => setFullName(limitProfileName(event.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Fecha de nacimiento (solo visible para ti)</Label>
                <Input
                  type="date"
                  max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().slice(0, 10)}
                  value={birthDate}
                  onChange={(event) => setBirthDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Teléfono (privado)</Label>
                <Input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
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
              <div className="space-y-2">
                <Label>Signo zodiacal</Label>
                <Select value={zodiac || "sin-especificar"} onValueChange={(value) => setZodiac(value === "sin-especificar" ? "" : value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo", "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"].map((sign) => <SelectItem key={sign} value={sign}>{sign}</SelectItem>)}
                    <SelectItem value="sin-especificar">Prefiero omitirlo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={smokes} onCheckedChange={(value) => setSmokes(Boolean(value))} />
                Fuma
              </label>
              <div className="space-y-2 sm:col-span-2">
                <Label>Pasatiempos favoritos (visibles en el perfil)</Label>
                <Input value={hobbies} maxLength={240} onChange={(event) => setHobbies(event.target.value)} placeholder="Música, baile, senderismo…" />
              </div>
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
              {creator?.verification_status === "pending" ? (
                <p className="rounded-xl border border-white/10 p-4 text-sm text-muted-foreground">Tu solicitud está en revisión.</p>
              ) : !verified ? (
                <>
                  {!verificationEligible && <p className="mb-3 rounded-xl border border-white/10 p-4 text-sm text-muted-foreground">Completa tu foto, nombre, fecha de nacimiento, país, teléfono, biografía y encuesta para solicitar la insignia azul.</p>}
                  <Button type="button" onClick={() => setVerificationOpen(true)} disabled={!verificationEligible}>
                    Habilitar insignia
                  </Button>
                  <Dialog open={verificationOpen} onOpenChange={setVerificationOpen}>
                    <DialogContent className="max-w-lg">
                      <DialogHeader><DialogTitle>Habilitar insignia azul</DialogTitle></DialogHeader>
                      <FaceVideoVerification onComplete={(video) => liveVerification.mutateAsync(video)} />
                    </DialogContent>
                  </Dialog>
                </>
              ) : null}
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
            <div className="mt-6 space-y-3">
              {!officialProfile && (
                <label className="flex items-center gap-3 rounded-xl border border-white/10 p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(creator?.hide_followers ?? privateProfile?.hide_followers)}
                    disabled={toggleHideFollowers.isPending}
                    onChange={(event) => toggleHideFollowers.mutate(event.target.checked)}
                  />
                  Ocultar mi lista de seguidores
                </label>
              )}
              <div className="flex justify-end">
                <Button asChild variant="outline">
                  <Link to="/ajustes">Abrir ajustes</Link>
                </Button>
              </div>
              <ProfileSettings
                email={profileEmail}
                phone={safeText(privateProfile?.phone) || undefined}
              />
            </div>
          )}
        </div>
      </section>

      <section className="mt-8 space-y-8">
        {own && viewerId && (
          <CupidoStudioPanel userId={viewerId} followerCount={actualFollowerCount} />
        )}
        {own && viewerId && <CupidoGroupInvites userId={viewerId} />}
        {own && viewerId && creator?.is_gran_liga && <GranLigaGroups userId={viewerId} />}
        {own ? (
          <>
            <div className="flex gap-2" role="tablist" aria-label="Contenido del perfil">
              <button
                type="button"
                role="tab"
                aria-selected={profileTab === "posts"}
                onClick={() => setProfileTab("posts")}
                className={`rounded-full border px-4 py-2 text-sm transition ${profileTab === "posts" ? "border-pink-400/40 bg-pink-500/15 text-pink-100" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white"}`}
              >
                Publicaciones
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={profileTab === "saved"}
                onClick={() => setProfileTab("saved")}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${profileTab === "saved" ? "border-pink-400/40 bg-pink-500/15 text-pink-100" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white"}`}
              >
                <Save className="size-4" /> Guardados
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={profileTab === "favorites"}
                onClick={() => setProfileTab("favorites")}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${profileTab === "favorites" ? "border-pink-400/40 bg-pink-500/15 text-pink-100" : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white"}`}
              >
                <Heart className="size-4" /> Favoritos
              </button>
            </div>
            {profileTab === "posts" ? (
              <div>
                <h2 className="mb-4 font-display text-xl text-white">Publicaciones de {displayName || "este perfil"}</h2>
                <WallFeed
                  onlyUserId={profileId}
                  hideUpload={!own}
                  emptyText="Esta persona todavía no tiene fotos ni videos publicados."
                />
              </div>
            ) : profileTab === "saved" ? (
              <div>
                <h2 className="mb-4 font-display text-xl text-white">Guardados 🔖</h2>
                <WallFeed
                  savedOnly
                  hideUpload
                  emptyText="Aún no guardaste publicaciones. Toca 🔖 en cualquier foto o video."
                />
              </div>
            ) : (
              <div>
                <h2 className="mb-4 font-display text-xl text-white">Favoritos ❤️</h2>
                <WallFeed likedOnly hideUpload emptyText="Todavía no marcaste publicaciones como favoritas." />
              </div>
            )}
          </>
        ) : (
          <div>
            <h2 className="mb-4 font-display text-xl text-white">Publicaciones de {displayName || "este perfil"}</h2>
            <WallFeed
              onlyUserId={profileId}
              hideUpload
              emptyText="Esta persona todavía no tiene fotos ni videos publicados."
            />
          </div>
        )}
      </section>
    </main>
  );
}
