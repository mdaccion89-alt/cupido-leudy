import { Link } from "@tanstack/react-router";
import { BadgeCheck, Beer, Baby, Heart, MessageCircle, UserMinus, UserPlus, Gift } from "lucide-react";
import { countryFlag, countryName, LOOKING_FOR } from "@/lib/cupido";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export type CupidoProfile = {
  id: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  country_code: string;
  looking_for: string;
  drinks: boolean;
  has_kids: boolean;
  is_verified_blue: boolean;
  friend_count: number;
  follower_count: number;
};

type ProfileCardProps = {
  profile: CupidoProfile;
  myId?: string | null;
  interested?: boolean | undefined;
  following?: boolean | undefined;
  friendStatus?: string | undefined;
  onInterested: (kind: "interested" | "pass") => void;
  onFollow: () => void;
  onFriend: () => void;
  onGift: () => void;
};

export function ProfileCard({
  profile,
  myId,
  interested,
  following,
  friendStatus,
  onInterested,
  onFollow,
  onFriend,
  onGift,
}: ProfileCardProps) {
  const isMe = Boolean(myId && myId === profile.id);
  const looking = LOOKING_FOR.find((item) => item.value === profile.looking_for);
  const initials = profile.display_name.slice(0, 2).toUpperCase();

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur transition hover:-translate-y-1 hover:border-pink-400/40 hover:bg-white/[0.07]">
      <div className="flex items-start gap-4">
        <Link to="/perfil" search={{ userId: profile.id }} className="shrink-0">
          <Avatar className="h-16 w-16 border-2 border-pink-500/40">
            <AvatarImage src={profile.avatar_url} alt={profile.display_name} />
            <AvatarFallback className="bg-pink-500/20 text-lg text-pink-200">{initials}</AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link
              to="/perfil"
              search={{ userId: profile.id }}
              className="truncate font-display text-lg text-white hover:text-pink-300"
            >
              {profile.display_name}
            </Link>
            {profile.is_verified_blue && (
              <BadgeCheck className="h-5 w-5 shrink-0 fill-sky-400 text-white" aria-label="Verificado" />
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground" title={countryName(profile.country_code)}>
            {countryFlag(profile.country_code)} {countryName(profile.country_code)}
          </p>
          <p className="mt-1 text-xs text-pink-300/80">{profile.follower_count} seguidores · {profile.friend_count} amigos</p>
        </div>
      </div>

      <p className="mt-4 line-clamp-3 min-h-[3.5rem] text-sm text-slate-300">
        {profile.bio || "Todavía no escribió su biografía."}
      </p>

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
              <Heart className={`h-4 w-4 ${interested ? "fill-white" : ""}`} />
              {interested ? "Te interesa" : "Me interesa"}
            </Button>
            <Button variant="outline" onClick={() => onInterested("pass")}>
              No me interesa
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
            <Button variant="secondary" onClick={onGift} className="gap-1">
              <Gift className="h-4 w-4" /> Enviar regalo
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
