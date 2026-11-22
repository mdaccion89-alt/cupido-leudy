import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { mediaFilterCss, type MediaFilterId } from "@/lib/media-filters";

type CupidoVideoPlayerProps = {
  src: string;
  className?: string;
  loop?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  controls?: boolean;
  onPlay?: (currentTime: number) => void;
  onPause?: (currentTime: number) => void;
  onSeeking?: (currentTime: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
  filter?: MediaFilterId;
};

export function CupidoVideoPlayer({
  src,
  className = "",
  loop = false,
  autoPlay = false,
  muted: initialMuted = false,
  controls = true,
  onPlay,
  onPause,
  onSeeking,
  onTimeUpdate,
  filter = "normal",
}: CupidoVideoPlayerProps) {
  const [muted, setMuted] = useState(initialMuted || autoPlay);

  return (
    <div
      className="relative h-full w-full"
      onPointerDownCapture={(event) => {
        if (event.target instanceof HTMLVideoElement) setMuted(false);
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Enter" || event.key === " ") setMuted(false);
      }}
    >
      <video
        src={src}
        autoPlay={autoPlay}
        controls={controls}
        playsInline
        loop={loop}
        muted={muted}
        className={className}
        style={{ filter: mediaFilterCss(filter) }}
        onPlay={(event) => onPlay?.(event.currentTarget.currentTime)}
        onPause={(event) => onPause?.(event.currentTarget.currentTime)}
        onSeeking={(event) => onSeeking?.(event.currentTarget.currentTime)}
        onTimeUpdate={(event) => onTimeUpdate?.(event.currentTarget.currentTime)}
      />
      <button
        type="button"
        onClick={() => setMuted(!muted)}
        aria-label={muted ? "Activar sonido del video" : "Silenciar video"}
        title={muted ? "Activar sonido" : "Silenciar"}
        className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white shadow-lg backdrop-blur transition hover:bg-black/90"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </div>
  );
}
