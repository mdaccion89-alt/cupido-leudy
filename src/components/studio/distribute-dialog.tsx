import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic, Square, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { createDistributionOrder } from "@/lib/distribution.functions";
import type { Song } from "./types";

type Props = {
  song: Song;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DistributeDialog({ song, userId, open, onOpenChange }: Props) {
  const createOrder = useServerFn(createDistributionOrder);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voicePath, setVoicePath] = useState("");
  const [busy, setBusy] = useState(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setVoiceBlob(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("No se pudo acceder al micrófono.");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const uploadVoice = async () => {
    if (!voiceBlob) return;
    setBusy(true);
    try {
      const path = `${userId}/distributions/${crypto.randomUUID()}.webm`;
      const { error } = await supabase.storage
        .from("uploads")
        .upload(path, voiceBlob, { contentType: "audio/webm" });
      if (error) throw error;
      setVoicePath(path);
      toast.success("Voz grabada y guardada.");
    } catch {
      toast.error("No se pudo guardar la grabación.");
    } finally {
      setBusy(false);
    }
  };

  const distribute = async () => {
    if (!voicePath) return;
    setBusy(true);
    try {
      const result = await createOrder({
        data: { songId: song.id, title: song.title, voicePath, returnUrl: window.location.origin },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      window.location.assign(result.approveUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo iniciar el pago.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Distribuir «{song.title}» · $2 USD</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Graba una voz presentando tu canción, paga $2 USD con PayPal y el Admin Supremo revisará
            la solicitud antes de publicarla.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <Button variant="glass" onClick={startRecording}>
                <Mic /> Grabar voz
              </Button>
            ) : (
              <Button variant="destructive" onClick={stopRecording}>
                <Square /> Detener
              </Button>
            )}
            {voiceBlob && !voicePath && (
              <Button variant="glass" disabled={busy} onClick={uploadVoice}>
                {busy ? <Loader2 className="animate-spin" /> : <UploadCloud />} Guardar grabación
              </Button>
            )}
            {voiceBlob && (
              <audio controls src={URL.createObjectURL(voiceBlob)} className="h-9 w-full" />
            )}
          </div>
          {voicePath && (
            <p className="text-xs text-primary">Grabación lista. Procede al pago seguro.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="glass" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="hero" disabled={!voicePath || busy} onClick={distribute}>
            {busy && <Loader2 className="animate-spin" />} Pagar $2 y enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
