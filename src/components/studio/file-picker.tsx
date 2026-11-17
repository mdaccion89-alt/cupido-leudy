import { useRef } from "react";
import { FileAudio, ImageIcon, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
  label: string;
  kind?: "audio" | "image";
};

export function FilePicker({ accept, file, onChange, label, kind = "audio" }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const Icon = kind === "image" ? ImageIcon : FileAudio;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface/60 p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file ? file.name : label}</p>
        <p className="text-xs text-muted-foreground">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Máximo 25 MB"}</p>
      </div>
      {file ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Quitar archivo" onClick={() => onChange(null)}>
          <X />
        </Button>
      ) : (
        <Button type="button" variant="glass" size="sm" onClick={() => ref.current?.click()}>
          <Upload /> Elegir
        </Button>
      )}
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={label}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
    </div>
  );
}
