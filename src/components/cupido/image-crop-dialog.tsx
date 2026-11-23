import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, Move, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ImageCropDialogProps = {
  file: File | null;
  title: string;
  onOpenChange: (open: boolean) => void;
  onApply: (file: File) => void;
};

const CROP_SIZE = 640;

function clampOffset(value: number, imageSize: number) {
  return Math.max((CROP_SIZE - imageSize) / 2, Math.min((imageSize - CROP_SIZE) / 2, value));
}

export function ImageCropDialog({ file, title, onOpenChange, onApply }: ImageCropDialogProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const objectUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  useEffect(() => {
    setError("");
    if (!objectUrl) { setImageSize(null); return; }
    const image = new Image();
    image.onload = () => { setImageSize({ width: image.naturalWidth, height: image.naturalHeight }); setZoom(1); setOffset({ x: 0, y: 0 }); };
    image.onerror = () => setError("No se pudo abrir la imagen. Elige otra foto.");
    image.src = objectUrl;
  }, [objectUrl]);

  const baseScale = imageSize ? Math.max(CROP_SIZE / imageSize.width, CROP_SIZE / imageSize.height) : 1;
  const drawnWidth = imageSize ? imageSize.width * baseScale * zoom : CROP_SIZE;
  const drawnHeight = imageSize ? imageSize.height * baseScale * zoom : CROP_SIZE;
  const displayScale = previewRef.current ? previewRef.current.clientWidth / CROP_SIZE : 1;

  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom);
    if (!imageSize) return;
    const width = imageSize.width * baseScale * nextZoom;
    const height = imageSize.height * baseScale * nextZoom;
    setOffset((current) => ({ x: clampOffset(current.x, width), y: clampOffset(current.y, height) }));
  };

  const applyCrop = async () => {
    if (!file || !objectUrl || !imageSize) return;
    setError("");
    setWorking(true);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = CROP_SIZE;
      canvas.height = CROP_SIZE;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar el recorte.");
      context.drawImage(image, (CROP_SIZE - drawnWidth) / 2 + offset.x, (CROP_SIZE - drawnHeight) / 2 + offset.y, drawnWidth, drawnHeight);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo crear la imagen recortada.")), "image/jpeg", 0.9));
      const baseName = file.name.replace(/\.[^.]+$/, "") || "foto";
      onApply(new File([blob], `${baseName}-recortada.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
    } catch (error) {
      console.error("[image-crop] No se pudo aplicar el encuadre.", error);
      setError(error instanceof Error ? error.message : "No se pudo preparar el recorte.");
    } finally {
      setWorking(false);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: clampOffset(drag.offsetX + (event.clientX - drag.x) / displayScale, drawnWidth),
      y: clampOffset(drag.offsetY + (event.clientY - drag.y) / displayScale, drawnHeight),
    });
  };

  return (
    <Dialog open={Boolean(file)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82dvh] w-[calc(100%-1.5rem)] max-w-sm overflow-y-auto rounded-3xl border-white/10 bg-zinc-950 p-4 text-white">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="flex items-center gap-2 text-xs text-zinc-400"><Move className="size-3.5" /> Arrastra la imagen para encuadrarla y ajusta el zoom.</p>
        <div
          ref={previewRef}
          className="relative mx-auto aspect-square w-full max-w-[320px] touch-none overflow-hidden rounded-2xl border border-white/15 bg-black"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          {objectUrl && imageSize && (
            <img
              src={objectUrl}
              alt="Previsualización del recorte"
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ width: `${drawnWidth / CROP_SIZE * 100}%`, height: `${drawnHeight / CROP_SIZE * 100}%`, left: "50%", top: "50%", transform: `translate(calc(-50% + ${offset.x * displayScale}px), calc(-50% + ${offset.y * displayScale}px))` }}
            />
          )}
        </div>
        <label className="flex items-center gap-3 text-sm text-zinc-300">
          <ZoomIn className="size-4 shrink-0" />
          <span className="sr-only">Zoom de imagen</span>
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} className="w-full accent-pink-500" />
          <span className="w-10 text-right text-xs tabular-nums">{zoom.toFixed(1)}×</span>
        </label>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={working}>Cancelar</Button>
          <Button type="button" onClick={() => void applyCrop()} disabled={!imageSize || working} className="gap-2">
            <Check className="size-4" /> {working ? "Preparando…" : "Usar imagen"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
