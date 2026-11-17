import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, Loader2, Music2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music";
import { cn } from "@/lib/utils";
import { Equalizer } from "./equalizer";
import type { Song } from "./types";

type Props = {
  songs: Song[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (song: Song) => void;
  onDelete: (song: Song) => void;
};

export function CreationsList({ songs, loading, selectedId, onSelect, onDelete }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando tus creaciones…
      </div>
    );
  }
  if (songs.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-3 p-10 text-center">
        <Music2 className="size-8 text-primary" />
        <p className="font-display">Aún no tienes canciones</p>
        <p className="text-sm text-muted-foreground">Describe una idea arriba y genera tu primera canción.</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {songs.map((song, i) => {
        const selected = song.id === selectedId;
        const ready = song.status === "ready";
        return (
          <li
            key={song.id}
            className={cn(
              "panel group flex min-w-0 animate-float-in items-center gap-4 p-4 transition-colors",
              selected && "border-primary/60",
            )}
            style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
          >
            <Button
              variant={selected ? "hero" : "glass"}
              size="icon"
              className="size-12 shrink-0 rounded-full"
              aria-label={`Escuchar ${song.title}`}
              disabled={!ready}
              onClick={() => onSelect(song)}
            >
              {(song.status === "generating" || song.status === "saving") ? (
                <Loader2 className="animate-spin" />
              ) : song.status === "failed" ? (
                <AlertCircle />
              ) : (
                <Play className="ml-0.5" />
              )}
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{song.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {song.genre} · {formatDuration(song.duration_seconds)} ·{" "}
                {format(new Date(song.created_at), "d MMM, HH:mm", { locale: es })}
              </p>
              {song.status === "failed" && (
                <p className="mt-1 truncate text-xs text-destructive" title={song.error ?? undefined}>
                  {song.error ?? "No se pudo generar"}
                </p>
              )}
              {(song.status === "generating" || song.status === "saving") && <p className="mt-1 text-xs text-primary">Componiendo…</p>}
            </div>
            {selected && ready && <Equalizer bars={3} className="h-4" />}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
              aria-label={`Eliminar ${song.title}`}
              onClick={() => onDelete(song)}
            >
              <Trash2 />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
