import { useState } from "react";
import { AtSign, Check, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FIREFLY_ASSET_SLOTS,
  type FireflyAsset,
  type FireflyAssetSlot,
} from "@/lib/firefly.functions";
import { uploadOwnFile } from "@/lib/uploads";
import { cn } from "@/lib/utils";

export function VideoElementsEditor({
  assets,
  onChange,
  onInsert,
  userId,
  activeCount,
  disabled = false,
}: {
  assets: FireflyAsset[];
  onChange: (assets: FireflyAsset[]) => void;
  onInsert: (name: string) => void;
  userId: string | null;
  activeCount: number;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState<string | null>(null);

  const update = (index: number, patch: Partial<FireflyAsset>) =>
    onChange(assets.map((asset, i) => (i === index ? { ...asset, ...patch } : asset)));

  const add = () => onChange([...assets, { name: "", description: "", references: {} }]);

  const upload = async (index: number, slot: FireflyAssetSlot, file: File | undefined) => {
    if (!file) return;
    if (!userId) {
      toast.error("Inicia sesión para subir referencias.");
      return;
    }
    const key = `${index}-${slot}`;
    setUploading(key);
    try {
      const path = await uploadOwnFile(userId, file, file.name, "elements");
      const asset = assets[index];
      if (!asset) return;
      update(index, { references: { ...asset.references, [slot]: path } });
      toast.success(`Referencia ${slot} guardada.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo subir la referencia.");
    } finally {
      setUploading(null);
    }
  };

  const removeReference = (index: number, slot: FireflyAssetSlot) => {
    const asset = assets[index];
    if (!asset?.references) return;
    const references = { ...asset.references };
    delete references[slot];
    update(index, { references });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-display text-sm">Elementos y personajes</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Hasta 5 referencias por elemento. Usa @nombre en el prompt; máximo 3 activos.
          </p>
        </div>
        <Button type="button" variant="glass" size="sm" onClick={add} disabled={disabled}>
          <Plus /> Añadir elemento
        </Button>
      </div>
      <div
        className={cn(
          "text-sm tabular-nums",
          activeCount > 3
            ? "text-destructive"
            : activeCount === 3
              ? "text-amber-300"
              : "text-primary",
        )}
      >
        Elementos usados: {activeCount}/3
      </div>
      {activeCount > 3 && (
        <p className="text-sm text-destructive">Quita algún @nombre del prompt antes de generar.</p>
      )}

      {assets.map((asset, index) => (
        <div
          key={index}
          className="space-y-3 rounded-lg border border-border/70 bg-surface-raised/40 p-3"
        >
          <div className="flex gap-2">
            <Input
              value={asset.name}
              maxLength={40}
              placeholder="Nombre (sin @)"
              className="rounded-lg bg-surface/80"
              disabled={disabled}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Button
              type="button"
              variant="glass"
              size="icon"
              aria-label="Insertar en el prompt"
              disabled={disabled || !asset.name.trim()}
              onClick={() => onInsert(asset.name)}
            >
              <AtSign />
            </Button>
            <Button
              type="button"
              variant="glass"
              size="icon"
              aria-label="Quitar elemento"
              disabled={disabled}
              onClick={() => onChange(assets.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <Textarea
            value={asset.description}
            maxLength={300}
            placeholder="Descripción: aspecto, rasgos, estilo…"
            className="min-h-16 resize-y rounded-lg border-border bg-surface/80 p-3 text-sm"
            disabled={disabled}
            onChange={(event) => update(index, { description: event.target.value })}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {FIREFLY_ASSET_SLOTS.map((slot) => {
              const inputId = `element-${index}-${slot.value}`;
              const uploaded = Boolean(asset.references?.[slot.value]);
              const busy = uploading === `${index}-${slot.value}`;
              return (
                <div
                  key={slot.value}
                  className="rounded-lg border border-border/60 bg-surface/60 p-2"
                >
                  <p className="mb-2 text-[11px] leading-tight text-muted-foreground">
                    {slot.label}
                  </p>
                  <input
                    id={inputId}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={disabled}
                    onChange={(event) => {
                      void upload(index, slot.value, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <label
                      htmlFor={inputId}
                      className="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border border-border bg-surface-raised px-2 text-xs hover:bg-accent"
                    >
                      {uploaded ? <Check className="size-3" /> : <Upload className="size-3" />}
                      {busy ? "Subiendo…" : uploaded ? "Cambiar" : "Subir"}
                    </label>
                    {uploaded && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar ${slot.label}`}
                        disabled={disabled}
                        onClick={() => removeReference(index, slot.value)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
