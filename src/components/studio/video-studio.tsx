import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Film, Image as ImageIcon, Loader2, Mic, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { FilePicker } from "./file-picker";
import { OptionGroup } from "./option-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
import { useAuth } from "@/lib/auth-context";
import { CREDIT_COSTS } from "@/lib/credits";
import { downloadBlob } from "@/lib/download";
import {
  HF_SPACES,
  directErrorMessage,
  generateDirectFile,
  generateDirectVideo,
} from "@/lib/gradio-direct";
import {
  countActiveElements,
  FIREFLY_ACCENTS,
  FIREFLY_CAMERA_MOVEMENTS,
  FIREFLY_COUNTRIES,
  FIREFLY_IMAGE_PIXELS,
  FIREFLY_IMAGE_SIZES,
  FIREFLY_LANGUAGES,
  FIREFLY_VOICE_STYLES,
  generateFireflyVoice,
  saveFireflyImageHistory,
  type FireflyAsset,
  type FireflyImageSize,
  type FireflyScene,
  type FireflySceneClip,
} from "@/lib/firefly.functions";
import { uploadOwnFile } from "@/lib/uploads";
import { generateCloudflareImage } from "@/lib/video.functions";
import { VideoElementsEditor } from "./video-elements-editor";
import { VideoFrameReference } from "./video-frame-reference";
import { captureFrameFromVideoUrl, uploadCapturedFrame } from "./video-frame-capture";
import { VideoMascot } from "./video-mascot";
import { VideoProgress } from "./video-progress";
import { VideoScenesEditor } from "./video-scenes-editor";

const promptClass =
  "min-h-24 resize-none rounded-xl border-border bg-surface/80 p-4 text-base placeholder:text-muted-foreground/70";
const cardClass = "space-y-4 rounded-xl border border-border bg-surface/60 p-4 backdrop-blur";

type SequenceView = {
  label: string;
  generationId: string;
  clips: FireflySceneClip[];
  stitched: boolean;
};

type ProgressView = {
  active: boolean;
  startedAt: number;
  stage: string;
  progress: number;
  estimatedSeconds: number;
  mascotSeed: number;
};

function parseSeed(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function appendToken(current: string, name: string): string {
  const token = `@${name.trim().replace(/^@+/, "")}`;
  return `${current}${current && !current.endsWith(" ") ? " " : ""}${token}`;
}

export type VideoStudioProps = {
  signedIn: boolean;
  requireSignIn: () => void;
  disabledReason?: string;
  userId?: string | null;
  isAdmin?: boolean;
};

export function VideoStudio({
  signedIn,
  requireSignIn,
  disabledReason,
  userId,
  isAdmin = false,
}: VideoStudioProps) {
  const { session } = useAuth();
  const uid = userId ?? session?.user.id ?? null;
  const voiceFn = useServerFn(generateFireflyVoice);
  const historyFn = useServerFn(saveFireflyImageHistory);
  const imageFn = useServerFn(generateCloudflareImage);

  const [tab, setTab] = useState("image");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<FireflyImageSize>("16:9");
  const [imageSeed, setImageSeed] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageExtension, setImageExtension] = useState("png");
  const [directImages, setDirectImages] = useState<string[]>([]);
  const [videoPrompt, setVideoPrompt] = useState("");
  const [scenes, setScenes] = useState<FireflyScene[]>([{ text: "", seconds: 5 }]);
  const [cameraMovement, setCameraMovement] = useState("static");
  const [videoSeed, setVideoSeed] = useState("");
  const [referencePath, setReferencePath] = useState<string | null>(null);
  const [assets, setAssets] = useState<FireflyAsset[]>([]);
  const [videoResult, setVideoResult] = useState<SequenceView | null>(null);
  const [voiceText, setVoiceText] = useState("");
  const [voice, setVoice] = useState("natural");
  const [language, setLanguage] = useState("es");
  const [country, setCountry] = useState("ES");
  const [accent, setAccent] = useState("neutral");
  const [dubbingFile, setDubbingFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [progress, setProgress] = useState<ProgressView>({
    active: false,
    startedAt: Date.now(),
    stage: "",
    progress: 0,
    estimatedSeconds: 60,
    mascotSeed: Date.now(),
  });

  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  const imageActive = countActiveElements(imagePrompt, assets);
  const videoActive = countActiveElements(
    `${videoPrompt}\n${scenes.map((scene) => scene.text).join("\n")}`,
    assets,
  );
  const referenceClips = (videoResult?.clips ?? []).map((clip) => ({
    songId: clip.songId,
    url: clip.url,
    label: `Escena ${clip.sceneNumber} · ${clip.seconds}s`,
  }));

  const startProgress = (stage: string, estimatedSeconds: number) => {
    const startedAt = Date.now();
    setProgress({
      active: true,
      startedAt,
      stage,
      progress: 0,
      estimatedSeconds,
      mascotSeed: startedAt,
    });
  };

  const advanceProgress = (stage: string, value: number) =>
    setProgress((current) => ({ ...current, active: true, stage, progress: value }));

  const finishProgress = () =>
    setProgress((current) => ({ ...current, active: false, progress: 1 }));

  const imageMutation = useMutation({
    mutationFn: async (): Promise<{
      url: string;
      seed: number;
      extension: string;
      provider: string;
    }> => {
      const { width, height } = FIREFLY_IMAGE_PIXELS[imageSize];
      const prompt = imagePrompt.trim() || "Una escena cinematográfica original";
      const rawSeed = imageSeed.trim();
      const numericSeed = Number(rawSeed) || 0;
      const randomizeSeed = !rawSeed;
      try {
        const result = await imageFn({ data: { prompt } });
        if (!result.ok) throw new Error(result.message);
        return {
          url: result.image,
          seed: numericSeed,
          extension: "png",
          provider: "cloudflare-flux-1-schnell",
        };
      } catch (cloudflareError) {
        console.warn("Cloudflare Workers AI no disponible; usando Hugging Face.", cloudflareError);
        const file = await generateDirectFile({
          space: HF_SPACES.flux,
          kind: "image",
          context: {
            prompt,
            width,
            height,
            seed: numericSeed,
            randomizeSeed,
            steps: 4,
            seconds: 5,
            bpm: 110,
            instrumental: true,
          },
          endpoint: "/infer",
          fallbackParams: [prompt, numericSeed, randomizeSeed, width, height, 4],
        });
        return {
          url: URL.createObjectURL(file.blob),
          seed: numericSeed,
          extension: file.extension,
          provider: "flux-1-schnell",
        };
      }
    },
    onMutate: () => startProgress("Generando imagen HD con Cloudflare Workers AI…", 60),
    onSuccess: (result) => {
      setImageUrl(result.url);
      setImageExtension(result.extension);
      setDirectImages((current) =>
        [result.url, ...current.filter((item) => item !== result.url)].slice(0, 6),
      );
      void historyFn({
        data: {
          prompt: imagePrompt,
          imageUrl: result.url,
          imageSize,
          provider: result.provider,
          seed: result.seed,
        },
      }).catch(() => undefined);
      toast.success("Imagen HD real lista.");
    },
    onError: (error) => toast.error(directErrorMessage(error, "image")),
    onSettled: finishProgress,
  });

  const videoMutation = useMutation({
    mutationFn: async (): Promise<SequenceView> => {
      startProgress("Generando video real con Wan2.1 / LTX-Video en Hugging Face…", 180);
      const seed = parseSeed(videoSeed) ?? Math.floor(Math.random() * 999_999);
      const { width, height } = FIREFLY_IMAGE_PIXELS[imageSize];
      const prompt = [
        videoPrompt.trim(),
        ...scenes.map((scene) => scene.text.trim()).filter(Boolean),
        `Movimiento de cámara: ${cameraMovement}`,
      ]
        .filter(Boolean)
        .join("\n");
      const seconds = Math.min(5, Math.max(2, Math.round(totalSeconds) || 5));
      const file = await generateDirectVideo({
        prompt: prompt || "Una escena cinematográfica original",
        width,
        height,
        seed,
        seconds,
        steps: 20,
        bpm: 110,
        instrumental: true,
      });
      advanceProgress("Descargando video MP4…", 95);
      const provider = /wan/i.test(file.url)
        ? "Wan2.1"
        : /ltx/i.test(file.url)
          ? "LTX-Video"
          : "Hugging Face";
      const clip: FireflySceneClip = {
        songId: `video-${Date.now()}`,
        url: URL.createObjectURL(file.blob),
        storagePath: "",
        sceneNumber: 1,
        seconds,
        mediaType: file.contentType,
        model: provider === "Wan2.1" ? "wan2.1" : "ltx-video",
      };
      return {
        label: `Video real generado con ${provider}`,
        generationId: `video-${Date.now()}`,
        clips: [clip],
        stitched: true,
      };
    },
    onSuccess: (result) => {
      setVideoResult(result);
      toast.success("Video MP4 real listo.");
    },
    onError: (error) => toast.error(directErrorMessage(error, "video")),
    onSettled: finishProgress,
  });

  const voiceMutation = useMutation({
    mutationFn: async () => {
      if (!uid) throw new Error("Inicia sesión para generar voz.");
      let dubbingAudioPath: string | null = null;
      if (dubbingFile)
        dubbingAudioPath = await uploadOwnFile(uid, dubbingFile, dubbingFile.name, "dubbing");
      const result = await voiceFn({
        data: {
          text: voiceText,
          voice,
          language,
          country,
          accent,
          dubbingAudioPath,
        },
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onMutate: () => startProgress(dubbingFile ? "Doblando audio…" : "Generando voz…", 30),
    onSuccess: (result) => {
      setAudioUrl(result.url);
      toast.success(dubbingFile ? "Doblaje listo." : "Voz lista.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo generar la voz."),
    onSettled: finishProgress,
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
    if (tab === "video") setVideoPrompt((current) => appendToken(current, name));
    else setImagePrompt((current) => appendToken(current, name));
  };

  const imageReady = !imageMutation.isPending;
  const videoReady = !videoMutation.isPending;
  const voiceReady = voiceText.trim().length >= 3 && !voiceMutation.isPending && !disabledReason;

  const downloadClip = (clip: FireflySceneClip) => {
    void fetch(clip.url)
      .then((response) => response.blob())
      .then((blob) => {
        const extension = clip.mediaType.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `video-escena-${clip.sceneNumber}.${extension}`);
      });
  };

  return (
    <div className="space-y-7">
      {disabledReason && <p className="text-sm text-destructive">{disabledReason}</p>}

      {progress.stage && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface/50 p-4">
          <VideoMascot seed={progress.mascotSeed} compact />
          <VideoProgress
            className="min-w-[240px] flex-1"
            startedAt={progress.startedAt}
            progress={progress.progress}
            estimatedSeconds={progress.estimatedSeconds}
            stage={progress.stage}
            active={progress.active}
          />
        </div>
      )}

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
            <label htmlFor="video-studio-image-prompt" className="mb-3 block font-display text-sm">
              Describe tu imagen
            </label>
            <Textarea
              id="video-studio-image-prompt"
              value={imagePrompt}
              maxLength={1200}
              placeholder="Ej.: Un faro solitario sobre acantilados al atardecer, estilo cinematográfico…"
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
            <Label htmlFor="video-studio-image-seed">Semilla (opcional)</Label>
            <Input
              id="video-studio-image-seed"
              type="number"
              min={0}
              value={imageSeed}
              placeholder="Ej.: 12345"
              className="rounded-xl border-border bg-surface/80"
              onChange={(event) => setImageSeed(event.target.value)}
            />
          </div>

          <VideoElementsEditor
            assets={assets}
            onChange={setAssets}
            onInsert={insertToken}
            userId={uid}
            activeCount={imageActive}
            disabled={imageMutation.isPending}
          />

          <Button
            type="button"
            variant="hero"
            size="xl"
            className="w-full whitespace-normal px-6"
            disabled={!imageReady}
            onClick={() => void imageMutation.mutate()}
          >
            {imageMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {imageMutation.isPending ? "Generando imagen HD…" : "Generar Imagen · FLUX.1"}
          </Button>

          {imageUrl && (
            <div className={cardClass}>
              <p className="font-display text-sm">Resultado</p>
              <img
                src={imageUrl}
                alt="Imagen generada"
                className="w-full rounded-xl border border-border object-contain"
              />
              <Button asChild variant="glass" size="sm">
                <a href={imageUrl} download={`imagen-leudy-ia.${imageExtension}`}>
                  Descargar imagen
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">
                Imagen HD real generada con FLUX.1 en Hugging Face.
              </p>
            </div>
          )}

          {directImages.length > 0 && (
            <div className={cardClass}>
              <p className="font-display text-sm">Galería reciente</p>
              <div className="grid grid-cols-3 gap-3">
                {directImages.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className="overflow-hidden rounded-lg border border-border"
                    onClick={() => setImageUrl(url)}
                  >
                    <img
                      src={url}
                      alt="Imagen generada"
                      className="h-24 w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="video" className="space-y-7 pt-6">
          <div>
            <label htmlFor="video-studio-prompt" className="mb-3 block font-display text-sm">
              Idea general del video
            </label>
            <Textarea
              id="video-studio-prompt"
              value={videoPrompt}
              maxLength={1200}
              placeholder="Ej.: Un viaje nocturno por una ciudad futurista bajo la lluvia…"
              className={promptClass}
              onChange={(event) => setVideoPrompt(event.target.value)}
            />
          </div>

          <OptionGroup
            label="Formato HD"
            options={FIREFLY_IMAGE_SIZES.map((size) => ({ value: size, label: size }))}
            value={imageSize}
            onChange={(value) => setImageSize(value as FireflyImageSize)}
          />

          <VideoScenesEditor
            scenes={scenes}
            onChange={setScenes}
            disabled={videoMutation.isPending}
          />

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
            <Label htmlFor="video-studio-seed">Semilla (opcional)</Label>
            <Input
              id="video-studio-seed"
              type="number"
              min={0}
              value={videoSeed}
              placeholder="Ej.: 12345"
              className="rounded-xl border-border bg-surface/80"
              onChange={(event) => setVideoSeed(event.target.value)}
            />
          </div>

          <VideoFrameReference
            userId={uid}
            referencePath={referencePath}
            onReferenceChange={(path) => setReferencePath(path)}
            clips={referenceClips}
            disabled={videoMutation.isPending}
          />

          <VideoElementsEditor
            assets={assets}
            onChange={setAssets}
            onInsert={insertToken}
            userId={uid}
            activeCount={videoActive}
            disabled={videoMutation.isPending}
          />

          <Button
            type="button"
            variant="hero"
            size="xl"
            className="w-full whitespace-normal px-6"
            disabled={!videoReady}
            onClick={() => void videoMutation.mutate()}
          >
            {videoMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {videoMutation.isPending
              ? "Probando Wan2.1 / LTX-Video…"
              : "Generar Video · Wan2.1 / LTX-Video"}
          </Button>

          {videoResult && (
            <div className={cardClass}>
              <p className="font-display text-sm">{videoResult.label}</p>
              <p className="text-xs text-muted-foreground">
                Video MP4 real generado en Hugging Face (Wan2.1 o LTX-Video, en cascada). Se puede
                reproducir y descargar directamente.
              </p>
              <div className="space-y-5">
                {videoResult.clips.map((clip) => (
                  <div key={clip.songId} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        Escena {clip.sceneNumber} · {clip.seconds}s
                      </p>
                      <Button
                        type="button"
                        variant="glass"
                        size="sm"
                        onClick={() => downloadClip(clip)}
                      >
                        Descargar escena {clip.sceneNumber}
                      </Button>
                    </div>
                    <video
                      src={clip.url}
                      controls
                      playsInline
                      className="w-full rounded-xl border border-border bg-background"
                    />
                  </div>
                ))}
              </div>
              {videoResult.clips[0] && (
                <Button type="button" variant="hero" onClick={() => downloadClip(videoResult.clips[0]!)}>
                  Descargar video
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Sin animaciones falsas ni canvas local: el archivo es el MP4 devuelto por el Space.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="voice" className="space-y-7 pt-6">
          <div>
            <label htmlFor="video-studio-voice-text" className="mb-3 block font-display text-sm">
              Texto a narrar o doblar
            </label>
            <Textarea
              id="video-studio-voice-text"
              value={voiceText}
              maxLength={4000}
              placeholder="Escribe aquí el guion que quieres convertir en voz…"
              className="min-h-36 resize-y rounded-xl border-border bg-surface/80 p-4 text-base placeholder:text-muted-foreground/70"
              onChange={(event) => setVoiceText(event.target.value)}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="space-y-2">
              <Label>Acento</Label>
              <Select value={accent} onValueChange={setAccent}>
                <SelectTrigger className="rounded-xl border-border bg-surface/80">
                  <SelectValue placeholder="Acento" />
                </SelectTrigger>
                <SelectContent>
                  {FIREFLY_ACCENTS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Audio de origen para doblaje (opcional)</Label>
            <FilePicker
              accept="audio/*"
              file={dubbingFile}
              onChange={setDubbingFile}
              label="Sube un audio para doblarlo al idioma elegido"
              kind="audio"
            />
            <p className="text-xs text-muted-foreground">
              Si el doblaje no está configurado, quita el audio y usa narración TTS.
            </p>
          </div>

          <Button
            type="button"
            variant="hero"
            size="xl"
            className="w-full whitespace-normal px-6"
            disabled={signedIn ? !voiceReady : false}
            onClick={() => start(() => void voiceMutation.mutate())}
          >
            {voiceMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {voiceMutation.isPending
              ? dubbingFile
                ? "Doblando…"
                : "Generando voz…"
              : signedIn
                ? `Generar ${dubbingFile ? "Doblaje" : "Voz"} · ${CREDIT_COSTS.song} crédito`
                : "Inicia sesión para generar"}
          </Button>

          {audioUrl && (
            <div className={cardClass}>
              <p className="font-display text-sm">Resultado</p>
              <audio src={audioUrl} controls className="w-full" />
              <p className="text-xs text-muted-foreground">
                El enlace de descarga caduca en 1 hora{isAdmin ? "" : " y el archivo en 48 horas"}.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
