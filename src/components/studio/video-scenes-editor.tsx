import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FireflyScene } from "@/lib/firefly.functions";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export function VideoScenesEditor({
  scenes,
  onChange,
  disabled = false,
}: {
  scenes: FireflyScene[];
  onChange: (scenes: FireflyScene[]) => void;
  disabled?: boolean;
}) {
  const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  const update = (index: number, patch: Partial<FireflyScene>) =>
    onChange(scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  const add = () => {
    if (scenes.length >= 12) {
      toast.error("Puedes añadir hasta 12 escenas.");
      return;
    }
    onChange([...scenes, { text: "", seconds: 5 }]);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm">Guion por escenas</span>
        <Button type="button" variant="glass" size="sm" onClick={add} disabled={disabled}>
          <Plus /> Añadir escena
        </Button>
      </div>
      {scenes.map((scene, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border border-border/70 bg-surface-raised/40 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Escena {index + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Quitar escena"
              disabled={disabled || scenes.length === 1}
              onClick={() => onChange(scenes.filter((_, i) => i !== index))}
            >
              <Trash2 /> Quitar
            </Button>
          </div>
          <Textarea
            value={scene.text}
            maxLength={600}
            placeholder="Describe lo que ocurre en esta escena…"
            className="min-h-16 resize-y rounded-lg border-border bg-surface/80 p-3 text-sm"
            disabled={disabled}
            onChange={(event) => update(index, { text: event.target.value })}
          />
          <div className="flex items-center gap-3">
            <Label className="text-xs text-muted-foreground">Segundos</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={scene.seconds}
              className="h-9 w-24 rounded-lg bg-surface/80 tabular-nums"
              disabled={disabled}
              onChange={(event) => update(index, { seconds: Number(event.target.value) })}
            />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
        <span className="text-xs text-muted-foreground">Hasta 12 escenas · máximo 60 s</span>
        <span
          className={`text-sm tabular-nums ${total > 60 ? "text-destructive" : "text-primary"}`}
        >
          Total: {total} / 60 s
        </span>
      </div>
      {total > 60 && (
        <p className="text-sm text-destructive">
          Reduce la duración: el total no puede superar los 60 segundos.
        </p>
      )}
    </div>
  );
}
