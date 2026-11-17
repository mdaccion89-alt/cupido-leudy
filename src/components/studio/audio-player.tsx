import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { deliverFile, safeFilename } from "@/lib/download";
import { formatDuration } from "@/lib/music";
import { Equalizer } from "./equalizer";
import type { Song } from "./types";

type Props = {
  song: Song | null;
  blob: Blob | null;
  loadingAudio: boolean;
  composing: boolean;
  elapsed: number;
  autoPlayKey: string | null;
};

export function AudioPlayer({ song, blob, loadingAudio, composing, elapsed, autoPlayKey }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState<number | null>(null);

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url || !song || autoPlayKey !== song.id) return;
    audio.play().catch(() => undefined);
  }, [url, song, autoPlayKey]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  };

  const ready = Boolean(song && url);
  const shownTime = seeking ?? current;
  const total = duration || song?.duration_seconds || 0;

  return (
    <div className="panel grain flex h-full flex-col overflow-hidden p-6 sm:p-8">
      <div className="relative mb-6 flex aspect-[16/10] items-center justify-center overflow-hidden rounded-2xl bg-surface">
        <div className="absolute inset-0 bg-gradient-primary opacity-20 blur-2xl" />
        <div className="absolute -left-10 -top-10 size-40 rounded-full bg-teal/20 blur-3xl" />
        <div className="relative flex flex-col items-center gap-4 text-center">
          {composing ? (
            <>
              <Equalizer bars={9} className="h-14 gap-1.5 [&>span]:w-1.5" />
              <p className="font-display text-lg">Componiendo tu canción…</p>
              <p className="text-sm text-muted-foreground">
                {formatDuration(elapsed)} · puede tardar un par de minutos
              </p>
            </>
          ) : song ? (
            <>
              <Equalizer bars={9} active={playing} className="h-14 gap-1.5 [&>span]:w-1.5" />
              <p className="max-w-xs font-display text-lg leading-snug">{song.title}</p>
            </>
          ) : (
            <>
              <Equalizer bars={9} active={false} className="h-14 gap-1.5 [&>span]:w-1.5" />
              <p className="max-w-xs text-sm text-muted-foreground">
                Tu canción aparecerá aquí cuando esté lista.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Reproductor</p>
          <p className="truncate font-display text-base">{song?.title ?? "Nada sonando"}</p>
        </div>
        {song && (
          <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {song.genre}
          </span>
        )}
      </div>

      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}

      <div className="mt-4">
        <Slider
          aria-label="Progreso de la canción"
          disabled={!ready}
          min={0}
          max={total || 1}
          step={0.1}
          value={[Math.min(shownTime, total || 1)]}
          onValueChange={([v]) => setSeeking(v ?? 0)}
          onValueCommit={([v]) => {
            if (audioRef.current && v !== undefined) audioRef.current.currentTime = v;
            setCurrent(v ?? 0);
            setSeeking(null);
          }}
        />
        <div className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{formatDuration(shownTime)}</span>
          <span>{formatDuration(total)}</span>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <div className="flex items-center gap-2">
          <Button
            variant="glass"
            size="icon"
            className="rounded-full"
            aria-label="Volver al inicio"
            disabled={!ready}
            onClick={() => {
              if (audioRef.current) audioRef.current.currentTime = 0;
            }}
          >
            <RotateCcw />
          </Button>
          <Button
            variant="hero"
            className="size-14 rounded-full p-0 [&_svg]:size-6"
            aria-label={playing ? "Pausar" : "Reproducir"}
            disabled={!ready}
            onClick={toggle}
          >
            {loadingAudio ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play className="ml-0.5" />}
          </Button>
        </div>
        <Button
          variant="glass"
          size="pill"
          disabled={!ready || !blob}
          onClick={() => song && blob && deliverFile(blob, safeFilename(song.title))}
        >
          <Download />
          Descargar MP3
        </Button>
      </div>
    </div>
  );
}
