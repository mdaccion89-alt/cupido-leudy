import { Heart, Play } from "lucide-react";
import { VerifiedBadge } from "@/components/cupido/verified-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CupidoVideoPlayer } from "@/components/cupido/video-player";

export type CupidoVideo = {
  id: string;
  user_id: string;
  media_url: string;
  caption: string;
  likes_count: number;
  display_name: string;
  avatar_url: string;
  is_verified_blue: boolean;
  is_gran_liga: boolean;
};

type VideoCardProps = {
  video: CupidoVideo;
  liked: boolean;
  onLike: () => void;
};

export function VideoCard({ video, liked, onLike }: VideoCardProps) {
  return (
    <article className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
      <div className="relative aspect-[9/14] max-h-[520px] w-full bg-black">
        <CupidoVideoPlayer src={video.media_url} controls loop className="h-full w-full object-cover" />
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          <Play className="mr-1 inline h-3 w-3 fill-white" /> Short
        </span>
      </div>
      <div className="flex items-center gap-3 p-4">
        <Avatar className="h-10 w-10 border border-pink-400/40">
          <AvatarImage src={video.avatar_url} alt={video.display_name} />
          <AvatarFallback className="bg-pink-500/20 text-xs text-pink-200">
            {video.display_name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">
            {video.display_name}
            <VerifiedBadge verified={video.is_verified_blue} granLiga={video.is_gran_liga} className="ml-1 size-3.5" />
          </p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{video.caption || "Momento en Cupido Leudy ❤️"}</p>
        </div>
        <Button
          variant={liked ? "default" : "outline"}
          size="icon"
          onClick={onLike}
          aria-label="Me gusta"
        >
          <Heart className={`h-4 w-4 ${liked ? "fill-white" : ""}`} />
        </Button>
        <span className="text-xs text-muted-foreground">{video.likes_count}</span>
      </div>
    </article>
  );
}
