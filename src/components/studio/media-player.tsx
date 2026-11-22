import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Download,
  Globe,
  Loader2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { audioBufferToWav, decodeAudio } from "@/lib/audio";
import { downloadCertificate } from "@/lib/certificate";
import { deliverFile, safeFilename } from "@/lib/download";
import { formatDuration } from "@/lib/music";
import { DistributeDialog } from "./distribute-dialog";
import { Equalizer } from "./equalizer";
import type { Song } from "./types";
import { Waveform } from "./waveform";

type Props = {
  song: Song | null;
  blob: Blob | null;
  loadingMedia: boolean;
  composing: boolean;
  composingLabel: string;
  elapsed: number;
  autoPlayKey: string | null;
  onTogglePublic?: (song: Song) => void;
  galleryEnabled: boolean;
  userId?: string | null;
};

export function MediaPlayer({
  song,
  blob,
  loadingMedia,
  composing,
  composingLabel,
  elapsed,
  autoPlayKey,
  onTogglePublic,
  galleryEnabled,
  userId,
}: Props) {
  const mediaRef = useRef<HTMLAudioElement & HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [converting, setConverting] = useState(false);
  const [certBusy, setCertBusy] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const isVideo = song?.kind === "video";
  const isImage = song?.kind === "image";
  const isAudio = !isVideo && !isImage;

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
    const el = mediaRef.current;
    if (!el || !url || !song || autoPlayKey !== song.id) return;
    el.play().catch(() => undefined);
  }, [url, song, autoPlayKey]);

  const toggle = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  };

  const ready = Boolean(song && url);
  const total = duration || song?.duration_seconds || 0;
  const fileExtension = () => {
    const type = blob?.type.toLowerCase() ?? "";
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    if (type.includes("webp")) return "webp";
    if (type.includes("png")) return "png";
    if (type.includes("quicktime")) return "mov";
    if (type.includes("webm")) return "webm";
    if (type.includes("mp4")) return "mp4";
    if (type.includes("wav")) return "wav";
    if (type.includes("mpeg")) return "mp3";
    return isImage ? "png" : isVideo ? "mp4" : "mp3";
  };
  const mediaEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setCurrent(e.currentTarget.currentTime),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setDuration(e.currentTarget.duration),
  };

  const downloadWav = async () => {
    if (!song || !blob) return;
    setConverting(true);
    try {
      const wav = blob.type.includes("wav") ? blob : audioBufferToWav(await decodeAudio(blob));
      await deliverFile(wav, safeFilename(song.title, "wav"));
    } finally {
      setConverting(false);
    }
  };

  const certificate = async () => {
    if (!song) return;
    setCertBusy(true);
    try {
      await downloadCertificate(song.id);
      toast.success("Certificado descargado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo generar el certificado.");
    } finally {
      setCertBusy(false);
    }
  };

  return (
    <div className="panel grain flex h-full flex-col overflow-hidden p-6 sm:p-8">
      <div className="relative mb-6 flex aspect-[16/10] items-center justify-center overflow-hidden rounded-2xl bg-surface">
        {isVideo && url && !composing ? (
          <video
            ref={mediaRef}
            src={url}
            controls
            playsInline
            webkit-playsinline="true"
            className="absolute inset-0 h-full w-full bg-background object-contain"
            {...mediaEvents}
          />
        ) : isImage && url && !composing ? (
          <img
            src={url}
            alt={song?.title ?? "Imagen generada"}
            className="absolute inset-0 h-full w-full bg-background object-contain"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-primary opacity-20 blur-2xl" />
            <div className="absolute -left-10 -top-10 size-40 rounded-full bg-teal/20 blur-3xl" />
            <div className="relative flex flex-col items-center gap-4 px-6 text-center">
              {composing ? (
                <>
                  <Equalizer bars={9} className="h-14 gap-1.5 [&>span]:w-1.5" />
                  <p className="font-display text-lg">{composingLabel}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDuration(elapsed)} · puede tardar unos minutos
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
                    Tu creación aparecerá aquí cuando esté lista.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Reproductor</p>
          <p className="truncate font-display text-base">{song?.title ?? "Nada sonando"}</p>
        </div>
        {song && (
          <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {song.kind === "cover"
              ? "Cover IA"
              : song.kind === "video"
                ? "Videoclip"
                : song.kind === "image"
                  ? "Imagen IA"
                  : song.kind === "voice"
                    ? "Voz IA"
                    : song.genre}
          </span>
        )}
      </div>

      {isAudio && url && <audio ref={mediaRef} src={url} preload="metadata" {...mediaEvents} />}

      {isAudio && (
        <div>
          <Waveform
            blob={composing ? null : blob}
            progress={total ? current / total : 0}
            disabled={!ready}
            onSeek={(r) => {
              if (mediaRef.current && total) mediaRef.current.currentTime = r * total;
            }}
          />
          <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{formatDuration(current)}</span>
            <span>{formatDuration(total)}</span>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
        {isAudio ? (
          <div className="flex items-center gap-2">
            <Button
              variant="glass"
              size="icon"
              className="rounded-full"
              aria-label="Volver al inicio"
              disabled={!ready}
              onClick={() => {
                if (mediaRef.current) mediaRef.current.currentTime = 0;
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
              {loadingMedia ? (
                <Loader2 className="animate-spin" />
              ) : playing ? (
                <Pause />
              ) : (
                <Play className="ml-0.5" />
              )}
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {loadingMedia ? (isImage ? "Cargando imagen…" : "Cargando video…") : ""}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isVideo || isImage ? (
            <Button
              variant="glass"
              size="pill"
              disabled={!ready}
              onClick={() =>
                song && blob && deliverFile(blob, safeFilename(song.title, fileExtension()))
              }
            >
              <Download /> {isVideo ? "MP4" : fileExtension().toUpperCase()}
            </Button>
          ) : (
            <>
              {blob?.type.includes("mpeg") && (
                <Button
                  variant="glass"
                  size="pill"
                  disabled={!ready}
                  onClick={() => song && blob && deliverFile(blob, safeFilename(song.title, "mp3"))}
                >
                  <Download /> MP3
                </Button>
              )}
              <Button
                variant="glass"
                size="pill"
                disabled={!ready || converting}
                onClick={downloadWav}
              >
                {converting ? <Loader2 className="animate-spin" /> : <Download />} WAV
              </Button>
            </>
          )}
          {galleryEnabled && onTogglePublic && song?.status === "ready" && (
            <Button
              variant={song.is_public ? "chip" : "glass"}
              data-active={song.is_public}
              size="pill"
              onClick={() => onTogglePublic(song)}
            >
              {song.is_public ? <Globe /> : <Lock />}
              {song.is_public ? "Publicada" : "Publicar"}
            </Button>
          )}
          {song?.status === "ready" && (
            <>
              <Button variant="glass" size="pill" disabled={certBusy} onClick={certificate}>
                {certBusy ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Certificado
              </Button>
              {userId && (
                <Button variant="glass" size="pill" onClick={() => setDistributeOpen(true)}>
                  <Send /> Distribuir $2
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {song && userId && (
        <DistributeDialog
          song={song}
          userId={userId}
          open={distributeOpen}
          onOpenChange={setDistributeOpen}
        />
      )}
    </div>
  );
}
