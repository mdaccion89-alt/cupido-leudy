import { Link } from "@tanstack/react-router";
import { Beer, Baby, Eye, Heart, MessageCircle, ThumbsDown, UserMinus, UserPlus, Video, X } from "lucide-react";
import { displayedFollowerCount } from "@/lib/account";
import { countryFlag, countryName, LOOKING_FOR } from "@/lib/cupido";
import { GranLigaStar, VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export type CupidoProfile = {
  id: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  country_code: string;
  email?: string | null;
  official?: boolean;
  looking_for: string;
  drinks: boolean;
  has_kids: boolean;
  is_verified_blue: boolean;
  is_gran_liga: boolean;
  friend_count: number;
  follower_count: number;
  survey_completed: boolean;
  is_cupido_active?: boolean;
  isOnline?: boolean;
  live_id?: string;
  live_viewers?: number;
};

type ProfileCardProps = {
  profile: CupidoProfile;
  myId?: string | null;
  interested?: boolean | undefined;
  following?: boolean | undefined;
  liked?: boolean | undefined;
  friendStatus?: string | undefined;
  onInterested: (kind: "interested" | "pass") => void;
  onLike: () => void;
  onUnlike: () => void;
  onFollow: () => void;
  onFriend: () => void;
};

export function ProfileCard({
  profile,
  myId,
  interested,
  following,
  liked,
  friendStatus,
  onInterested,
  onLike,
  onUnlike,
  onFollow,
  onFriend,
}: ProfileCardProps) {
  const isMe = Boolean(myId && myId === profile.id);
  const looking = LOOKING_FOR.find((item) => item.value === profile.looking_for);
  const initials = profile.display_name.slice(0, 2).toUpperCase();
  const displayFollowers = displayedFollowerCount(profile.follower_count, profile.email);

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-0 backdrop-blur transition hover:-translate-y-1 hover:border-pink-400/40 hover:bg-white/[0.07] sm:p-5">
      <div className="relative aspect-[3/4] overflow-hidden rounded-t-3xl bg-slate-900 sm:hidden">
        <Link to="/perfil" search={{ userId: profile.id }} aria-label={`Ver perfil de ${profile.display_name}`} className="absolute inset-0 block">
          {profile.avatar_url ? <img src={profile.avatar_url} alt={profile.display_name} className="size-full object-cover transition duration-500 group-hover:scale-105" /> : <div className="grid size-full place-items-center bg-gradient-to-br from-violet-950 to-rose-950 text-4xl font-bold text-white/80">{initials}</div>}
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/95" />
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-200/25 bg-emerald-950/70 px-2 py-1 text-[10px] font-semibold text-emerald-100 backdrop-blur">
            <span className={`size-1.5 rounded-full ${profile.isOnline ? "animate-pulse bg-emerald-400" : "bg-slate-400"}`} />
            {profile.isOnline ? "En línea" : "Desconectado"}
          </span>
          {profile.live_id && <span className="absolute left-2.5 top-10 inline-flex items-center gap-1 rounded-full bg-rose-600/95 px-2 py-1 text-[10px] font-bold text-white shadow"><span className="size-1.5 animate-pulse rounded-full bg-white" /> LIVE <Eye className="ml-1 size-3" /> {profile.live_viewers ?? 0}</span>}
          <span className="absolute inset-x-2.5 bottom-2.5">
            <span className="flex min-w-0 items-center gap-1 text-sm font-semibold leading-tight text-white drop-shadow">
              <span className="truncate">{profile.display_name}</span>
              <VerifiedBadge email={profile.email} official={profile.official} verified={profile.is_verified_blue} granLiga={profile.is_gran_liga} className="size-4 shrink-0" />
            </span>
            <span className="mt-1 block truncate text-[10px] text-white/80">{countryFlag(profile.country_code)} {countryName(profile.country_code)}</span>
          </span>
        </Link>
        {!isMe && (
          profile.live_id ? (
            <Link to="/directo" search={{ liveId: profile.live_id }} aria-label={`Entrar al Live de ${profile.display_name}`} className="absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full border border-violet-200/30 bg-violet-600 text-white shadow-lg hover:bg-violet-500"><Video className="size-4" /></Link>
          ) : (
            <Link to="/chat" search={{ userId: profile.id, startVideo: true, roulette: false }} aria-label={`Videollamada con ${profile.display_name}`} className="absolute bottom-2.5 right-2.5 grid size-10 place-items-center rounded-full border border-violet-200/30 bg-violet-600 text-white shadow-lg hover:bg-violet-500"><Video className="size-4" /></Link>
          )
        )}
      </div>
      {isMe ? (
        <Button asChild className="m-2.5 sm:hidden"><Link to="/perfil">Editar perfil</Link></Button>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 p-2.5 sm:hidden">
          <Button variant={interested ? "secondary" : "default"} onClick={() => onInterested("interested")} className="min-h-10 whitespace-normal px-1.5 text-[10px] leading-tight"><Heart className="size-3.5 shrink-0" /> Me interesa</Button>
          <Button variant="outline" onClick={() => onInterested("pass")} className="min-h-10 whitespace-normal px-1.5 text-[10px] leading-tight"><X className="size-3.5 shrink-0" /> No me interesa</Button>
          <Button variant={liked ? "default" : "outline"} onClick={onLike} className="col-span-2 min-h-10 whitespace-normal px-1.5 text-[10px] leading-tight"><Heart className={`size-3.5 shrink-0 ${liked ? "fill-white" : ""}`} /> Me gusta</Button>
        </div>
      )}
      <div className="hidden sm:flex sm:h-full sm:flex-col">
      <div className="flex items-start gap-3 sm:gap-4">
        <Link to="/perfil" search={{ userId: profile.id }} className="relative block shrink-0">
          <GranLigaStar active={profile.is_gran_liga} />
          <Avatar className="h-12 w-12 border-2 border-pink-500/40 sm:h-16 sm:w-16">
            <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
            <AvatarFallback className="bg-pink-500/20 text-lg text-pink-200">{initials}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              to="/perfil"
              search={{ userId: profile.id }}
              className="truncate font-display text-sm text-white hover:text-pink-300 sm:text-lg"
            >
              {profile.display_name}
            </Link>
            <VerifiedBadge email={profile.email} official={profile.official} verified={profile.is_verified_blue} granLiga={profile.is_gran_liga} className="h-5 w-5" />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground" title={countryName(profile.country_code)}>
            {countryFlag(profile.country_code)} {countryName(profile.country_code)}
          </p>
          <p className={`mt-1 flex items-center gap-1.5 text-[11px] ${profile.isOnline ? "text-emerald-300" : "text-muted-foreground"}`}>
            <span className={`size-1.5 rounded-full ${profile.isOnline ? "bg-emerald-400" : "bg-zinc-500"}`} />
            {profile.isOnline ? "En línea" : "Desconectado"}
          </p>
          <p className="mt-1 text-xs text-pink-300/80">
            {displayFollowers.toLocaleString("es")} seguidores · {profile.friend_count.toLocaleString("es")} amigos
          </p>
        </div>
      </div>

      <p className="mt-4 line-clamp-3 min-h-[3.5rem] text-xs text-slate-300 sm:text-sm">
        {profile.bio || "Todavía no escribió su biografía."}
      </p>

      {profile.survey_completed ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-pink-500/15 px-2.5 py-1 text-pink-200">
            {looking?.emoji ?? "💕"} Busca {looking?.label ?? profile.looking_for}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-300">
            <Beer className="mr-1 inline h-3 w-3" /> {profile.drinks ? "Toma" : "No toma"}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-300">
            <Baby className="mr-1 inline h-3 w-3" /> {profile.has_kids ? "Con hijos" : "Sin hijos"}
          </span>
        </div>
      ) : <p className="mt-3 text-xs text-muted-foreground">Encuesta opcional sin responder</p>}

      <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
        {isMe ? (
          <Button asChild className="col-span-2">
            <Link to="/perfil">Editar mi perfil</Link>
          </Button>
        ) : (
          <>
            <Button
              variant={interested ? "secondary" : "default"}
              onClick={() => onInterested("interested")}
              className="gap-1"
            >
              <span aria-hidden="true">💘</span>
              {interested ? "Te interesa" : "Me interesa"}
            </Button>
            <Button variant="outline" onClick={() => onInterested("pass")} className="gap-1">
              <X className="h-4 w-4" /> No me interesa
            </Button>
            <Button variant={liked ? "default" : "outline"} onClick={onLike} className="gap-1">
              <Heart className={`h-4 w-4 ${liked ? "fill-white" : ""}`} /> ❤️ {liked ? "Te gusta" : "Me gusta"}
            </Button>
            <Button variant="outline" onClick={onUnlike} className="gap-1">
              <ThumbsDown className="h-4 w-4" /> 👎 No me gusta
            </Button>
            <Button variant="outline" onClick={onFollow} className="gap-1">
              {following ? <UserMinus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {following ? "Dejar de seguir" : "Seguir"}
            </Button>
            <Button variant="outline" onClick={onFriend} className="gap-1">
              <UserPlus className="h-4 w-4" />
              {friendStatus === "pending" ? "Solicitud enviada" : friendStatus === "accepted" ? "Amigos" : "Agregar amigo"}
            </Button>
            <Button asChild className="gap-1">
              <Link to="/chat" search={{ userId: profile.id }}>
                <MessageCircle className="h-4 w-4" /> Chatear
              </Link>
            </Button>
          </>
        )}
      </div>
      </div>
    </article>
  );
}
