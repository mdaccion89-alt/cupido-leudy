import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AtSign, Film, Image as ImageIcon, Loader2, Mic, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CREDIT_COSTS } from "@/lib/credits";
import {
  FIREFLY_CAMERA_MOVEMENTS,
  FIREFLY_COUNTRIES,
  FIREFLY_IMAGE_SIZES,
  FIREFLY_LANGUAGES,
  FIREFLY_VOICE_STYLES,
  generateFireflyImage,
  generateFireflyVideo,
  generateFireflyVoice,
  type FireflyAsset,
  type FireflyScene,
} from "@/lib/firefly.functions";
import { findBlockedArtist } from "@/lib/music";
import { OptionGroup } from "./option-group";

const promptClass =
  "min-h-24 resize-none rounded-xl border-border bg-surface/80 p-4 text-base placeholder:text-muted-foreground/70";
const cardClass = "space-y-4 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur";

function parseSeed(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function blockedMessage(text: string): string | null {
  const artist = findBlockedArtist(text);
  return artist
    ? `No podemos imitar ni nombrar a artistas reales como ${artist}. Usa una descripción original.`
    : null;
}

type AssetsEditorProps = {
  assets: FireflyAsset[];
  onChange: (assets: FireflyAsset[]) => void;
  onInsert: (name: string) => void;
};

function AssetsEditor({ assets, onChange, onInsert }: AssetsEditorProps) {
  const update = (index: number, patch: Partial<FireflyAsset>) =>
    onChange(assets.map((asset, i) => (i === index ? { ...asset, ...patch } : asset)));

  const add = () => {
    if (assets.length >= 20) {
      toast.error("Puedes definir hasta 20 personajes o elementos.");
      return;
    }
    onChange([...assets, { name: "", description: "" }]);
  };

  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm">Personajes y elementos</span>
        <Button type="button" variant="glass" size="sm" onClick={add}>
          <Plus /> Añadir
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Escribe @nombre en el prompt para usar la descripción de cada elemento.
      </p>
      {assets.map((asset, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg border border-border/70 bg-surface-raised/40 p-3"
        >
          <div className="flex gap-2">
            <Input
              value={asset.name}
              maxLength={40}
              placeholder="Nombre"
              className="rounded-lg bg-surface/80"
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <Button
              type="button"
              variant="glass"
              size="icon"
              aria-label="Insertar en el prompt"
              disabled={!asset.name.trim()}
              onClick={() => onInsert(asset.name)}
            >
              <AtSign />
            </Button>
            <Button
              type="button"
              variant="glass"
              size="icon"
              aria-label="Quitar elemento"
              onClick={() => onChange(assets.filter((_, i) => i !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <Input
            value={asset.description}
            maxLength={300}
            placeholder="Descripción: aspecto, rasgos, estilo…"
            className="rounded-lg bg-surface/80"
            onChange={(event) => update(index, { description: event.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

type ScenesEditorProps = {
  scenes: FireflyScene[];
  onChange: (scenes: FireflyScene[]) => void;
};

function ScenesEditor({ scenes, onChange }: ScenesEditorProps) {
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
    <div className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm">Guion por escenas</span>
        <Button type="button" variant="glass" size="sm" onClick={add}>
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
              disabled={scenes.length === 1}
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

export function FireflyTab({
  signedIn,
  requireSignIn,
  disabledReason,
}: {
  signedIn: boolean;
  requireSignIn: () => void;
  disabledReason?: string;
}) {
  const imageFn = useServerFn(generateFireflyImage);
  const videoFn = useServerFn(generateFireflyVideo);
  const voiceFn = useServerFn(generateFireflyVoice);

  const [tab, setTab] = useState("image");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<(typeof FIREFLY_IMAGE_SIZES)[number]>("16:9");
  const [imageSeed, setImageSeed] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [scenes, setScenes] = useState<FireflyScene[]>([{ text: "", seconds: 5 }]);
  const [cameraMovement, setCameraMovement] = useState("static");
  const [videoSeed, setVideoSeed] = useState("");
  const [assets, setAssets] = useState<FireflyAsset[]>([]);
  const [voiceText, setVoiceText] = useState("");
  const [voice, setVoice] = useState("natural");
  const [language, setLanguage] = useState("es");
  const [country, setCountry] = useState("ES");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");

  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.seconds, 0);

  const imageMutation = useMutation({
    mutationFn: () => {
      const blocked = blockedMessage(imagePrompt);
      if (blocked) throw new Error(blocked);
      return imageFn({
        data: { prompt: imagePrompt, imageSize, seed: parseSeed(imageSeed), assets },
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        setImageUrl(result.url);
        toast.success("Imagen lista.");
      } else toast.error(result.message);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo generar la imagen."),
  });

  const videoMutation = useMutation({
    mutationFn: () => {
      const blocked = blockedMessage(`${videoPrompt}\n${scenes.map((s) => s.text).join("\n")}`);
      if (blocked) throw new Error(blocked);
      if (totalSeconds > 60)
        throw new Error("El total de las escenas no puede superar los 60 segundos.");
      return videoFn({
        data: {
          prompt: videoPrompt,
          scenes,
          cameraMovement,
          seed: parseSeed(videoSeed),
          assets,
        },
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        setVideoUrl(result.url);
        toast.success("Video listo.");
      } else toast.error(result.message);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo generar el video."),
  });

  const voiceMutation = useMutation({
    mutationFn: () => {
      const blocked = blockedMessage(voiceText);
      if (blocked) throw new Error(blocked);
      return voiceFn({ data: { text: voiceText, voice, language, country } });
    },
    onSuccess: (result) => {
      if (result.ok) {
        setAudioUrl(result.url);
        toast.success("Voz generada.");
      } else toast.error(result.message);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo generar la voz."),
  });

  const start = (fn: () => void) => {
    if (!signedIn) {
      requireSignIn();
      return;
    }
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    fn();
  };

  const insertToken = (name: string) => {
    const token = `@${name.trim().replace(/^@+/, "")}`;
    const append = (current: string) =>
      `${current}${current && !current.endsWith(" ") ? " " : ""}${token}`;
    if (tab === "video") setVideoPrompt((current) => append(current));
    else setImagePrompt((current) => append(current));
  };

  const imageReady = imagePrompt.trim().length >= 3 && !imageMutation.isPending && !disabledReason;
  const videoReady =
    videoPrompt.trim().length >= 3 &&
    totalSeconds > 0 &&
    totalSeconds <= 60 &&
    !videoMutation.isPending &&
    !disabledReason;
  const voiceReady = voiceText.trim().length >= 3 && !voiceMutation.isPending && !disabledReason;

  return (
    <div className="space-y-7">
      <div>
        <p className="font-display text-lg">Estudio Firefly</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Imagen, video y voz con IA. Todo se guarda en tus creaciones privadas.
        </p>
      </div>

      {disabledReason && <p className="text-sm text-destructive">{disabledReason}</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl border border-border bg-surface/80 p-1.5">
          <TabsTrigger value="image" className="gap-2 py-2 text-xs sm:text-sm">
            <ImageIcon /> Imagen IA
          </TabsTrigger>
          <TabsTrigger value="video" className="gap-2 py-2 text-xs sm:text-sm">
            <Film /> Video / Película IA
          </TabsTrigger>
          <TabsTrigger value="voice" className="gap-2 py-2 text-xs sm:text-sm">
            <Mic /> Voz y Doblaje IA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="image" className="space-y-7 pt-6">
          <div>
            <label htmlFor="firefly-image-prompt" className="mb-3 block font-display text-sm">
              Describe tu imagen
            </label>
            <Textarea
              id="firefly-image-prompt"
              value={imagePrompt}
              maxLength={1200}
              placeholder="Ej.: Un faro solitario sobre acantilados al atardecer, estilo cinematográfico, luces cálidas…"
              className={promptClass}
              onChange={(event) => setImagePrompt(event.target.value)}
            />
          </div>

          <OptionGroup
            label="Formato"
            options={FIREFLY_IMAGE_SIZES.map((size) => ({ value: size, label: size }))}
            value={imageSize}
            onChange={setImageSize}
          />

          <div className="space-y-2">
            <Label htmlFor="firefly-image-seed">Semilla (opcional)</Label>
            <Input
              id="firefly-image-seed"
              type="number"
              min={0}
              value={imageSeed}
              placeholder="Ej.: 12345"
              className="rounded-xl border-border bg-surface/80"
              onChange={(event) => setImageSeed(event.target.value)}
            />
          </div>

          <AssetsEditor assets={assets} onChange={setAssets} onInsert={insertToken} />

          <Button
            type="button"
            variant="hero"
            size="xl"
            className="w-full whitespace-normal px-6"
            disabled={signedIn ? !imageReady : false}
            onClick={() =>
              start(() => {
                void imageMutation.mutate();
              })
            }
          >
            {imageMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {imageMutation.isPending
              ? "Generando imagen…"
              : signedIn
                ? `Generar Imagen · ${CREDIT_COSTS.song} crédito`
                : "Inicia sesión para generar"}
          </Button>

          {imageUrl && (
            <div className={cardClass}>
              <p className="font-display text-sm">Resultado</p>
              <img
                src={imageUrl}
                alt="Imagen generada con Firefly"
                className="w-full rounded-xl border border-border object-contain"
              />
              <p className="text-xs text-muted-foreground">
                El enlace de descarga caduca en 1 hora.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="video" className="space-y-7 pt-6">
          <div>
            <label htmlFor="firefly-video-prompt" className="mb-3 block font-display text-sm">
              Idea general del video
            </label>
            <Textarea
              id="firefly-video-prompt"
              value={videoPrompt}
              maxLength={1200}
              placeholder="Ej.: Un viaje nocturno por una ciudad futurista bajo la lluvia…"
              className={promptClass}
              onChange={(event) => setVideoPrompt(event.target.value)}
            />
          </div>

          <ScenesEditor scenes={scenes} onChange={setScenes} />

          <OptionGroup
            label="Movimiento de cámara"
            options={FIREFLY_CAMERA_MOVEMENTS.map((movement) => ({
              value: movement.value,
              label: movement.label,
            }))}
            value={cameraMovement}
            onChange={setCameraMovement}
          />

          <div className="space-y-2">
            <Label htmlFor="firefly-video-seed">Semilla (opcional)</Label>
            <Input
              id="firefly-video-seed"
              type="number"
              min={0}
              value={videoSeed}
              placeholder="Ej.: 12345"
              className="rounded-xl border-border bg-surface/80"
              onChange={(event) => setVideoSeed(event.target.value)}
            />
          </div>

          <AssetsEditor assets={assets} onChange={setAssets} onInsert={insertToken} />

          <Button
            type="button"
            variant="hero"
            size="xl"
            className="w-full whitespace-normal px-6"
            disabled={signedIn ? !videoReady : false}
            onClick={() =>
              start(() => {
                void videoMutation.mutate();
              })
            }
          >
            {videoMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {videoMutation.isPending
              ? "Generando video…"
              : signedIn
                ? `Generar Video · ${CREDIT_COSTS.video} créditos`
                : "Inicia sesión para generar"}
          </Button>

          {videoUrl && (
            <div className={cardClass}>
              <p className="font-display text-sm">Resultado</p>
              <video
                src={videoUrl}
                controls
                playsInline
                className="w-full rounded-xl border border-border bg-background"
              />
              <p className="text-xs text-muted-foreground">
                El enlace de descarga caduca en 1 hora.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="voice" className="space-y-7 pt-6">
          <div>
            <label htmlFor="firefly-voice-text" className="mb-3 block font-display text-sm">
              Texto a narrar o doblar
            </label>
            <Textarea
              id="firefly-voice-text"
              value={voiceText}
              maxLength={4000}
              placeholder="Escribe aquí el guion que quieres convertir en voz…"
              className="min-h-36 resize-y rounded-xl border-border bg-surface/80 p-4 text-base placeholder:text-muted-foreground/70"
              onChange={(event) => setVoiceText(event.target.value)}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Estilo de voz</Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="rounded-xl border-border bg-surface/80">
                  <SelectValue placeholder="Estilo" />
                </SelectTrigger>
                <SelectContent>
                  {FIREFLY_VOICE_STYLES.map((style) => (
                    <SelectItem key={style.value} value={style.value}>
                      {style.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Idioma</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="rounded-xl border-border bg-surface/80">
                  <SelectValue placeholder="Idioma" />
                </SelectTrigger>
                <SelectContent>
                  {FIREFLY_LANGUAGES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>País</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="rounded-xl border-border bg-surface/80">
                  <SelectValue placeholder="País" />
                </SelectTrigger>
                <SelectContent>
                  {FIREFLY_COUNTRIES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            variant="hero"
            size="xl"
            className="w-full whitespace-normal px-6"
            disabled={signedIn ? !voiceReady : false}
            onClick={() =>
              start(() => {
                void voiceMutation.mutate();
              })
            }
          >
            {voiceMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {voiceMutation.isPending
              ? "Generando voz…"
              : signedIn
                ? `Generar Voz · ${CREDIT_COSTS.song} crédito`
                : "Inicia sesión para generar"}
          </Button>

          {audioUrl && (
            <div className={cardClass}>
              <p className="font-display text-sm">Resultado</p>
              <audio src={audioUrl} controls className="w-full" />
              <p className="text-xs text-muted-foreground">
                El enlace de descarga caduca en 1 hora.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
