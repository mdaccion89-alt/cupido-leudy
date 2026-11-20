import { Heart, Image as ImageIcon, Play, ThumbsDown, X } from "lucide-react";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export type CupidoMedia = {
  id: string;
  user_id: string;
  media_url: string;
  kind: "photo" | "video";
  caption: string;
  likes_count: number;
  display_name: string;
  avatar_url: string;
  is_verified_blue: boolean;
  email?: string | null;
};

type MediaCardProps = {
  media: CupidoMedia;
  myId?: string | null;
  interested: boolean;
  liked: boolean;
  onInterested: () => void;
  onPass: () => void;
  onLike: () => void;
  onUnlike: () => void;
};

export function MediaCard({ media, myId, interested, liked, onInterested, onPass, onLike, onUnlike }: MediaCardProps) {
  const isMe = Boolean(myId && myId === media.user_id);

  return (
    <article className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
      <div className="relative aspect-[9/14] max-h-[520px] w-full bg-black">
        {media.kind === "video" ? (
          <video src={media.media_url} controls playsInline loop muted className="h-full w-full object-cover" />
        ) : (
          <img src={media.media_url} alt={media.caption || "Foto de Cupido Leudy"} className="h-full w-full object-cover" />
        )}
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          {media.kind === "video" ? <Play className="mr-1 inline h-3 w-3 fill-white" /> : <ImageIcon className="mr-1 inline h-3 w-3" />}
          {media.kind === "video" ? "Short" : "Foto"}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 border border-pink-400/40">
            <AvatarImage src={media.avatar_url} alt={media.display_name} />
            <AvatarFallback className="bg-pink-500/20 text-xs text-pink-200">
              {media.display_name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {media.display_name}
              <VerifiedBadge email={media.email} verified={media.is_verified_blue} className="ml-1 inline size-4" />
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{media.caption || "Momento en Cupido Leudy ❤️"}</p>
          </div>
          <span className="flex items-center gap-1 text-xs text-pink-200">
            <Heart className="size-3.5 fill-pink-400 text-pink-400" /> {media.likes_count}
          </span>
        </div>
        {!isMe && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant={interested ? "secondary" : "default"} size="sm" onClick={onInterested} className="gap-1">
              <span aria-hidden="true">💘</span> {interested ? "Te interesa" : "Me interesa"}
            </Button>
            <Button variant="outline" size="sm" onClick={onPass} className="gap-1">
              <X className="h-3.5 w-3.5" /> No me interesa
            </Button>
            <Button variant={liked ? "default" : "outline"} size="sm" onClick={onLike} className="gap-1">
              <Heart className={`h-3.5 w-3.5 ${liked ? "fill-white" : ""}`} /> ❤️ {liked ? "Te gusta" : "Me gusta"}
            </Button>
            <Button variant="outline" size="sm" onClick={onUnlike} className="gap-1">
              <ThumbsDown className="h-3.5 w-3.5" /> 👎 No me gusta
            </Button>
          </div>
        )}
        {isMe && <p className="mt-4 text-center text-xs text-muted-foreground">Esta publicación es tuya ❤️</p>}
      </div>
    </article>
  );
}
