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
import {
  beginFireflyVideo,
  countActiveElements,
  FIREFLY_ACCENTS,
  FIREFLY_CAMERA_MOVEMENTS,
  FIREFLY_COUNTRIES,
  FIREFLY_IMAGE_PROVIDERS,
  FIREFLY_IMAGE_SIZES,
  FIREFLY_LANGUAGES,
  FIREFLY_VIDEO_MODELS,
  FIREFLY_VOICE_STYLES,
  finishFireflyVideo,
  generateFireflyImage,
  generateFireflyVideo,
  generateFireflyVideoScene,
  generateFireflyVoice,
  type FireflyAsset,
  type FireflyImageProvider,
  type FireflyImageSize,
  type FireflyScene,
  type FireflySceneClip,
  type FireflyVideoModel,
} from "@/lib/firefly.functions";
import { uploadOwnFile } from "@/lib/uploads";
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
  const imageFn = useServerFn(generateFireflyImage);
  const beginFn = useServerFn(beginFireflyVideo);
  const sceneFn = useServerFn(generateFireflyVideoScene);
  const finishFn = useServerFn(finishFireflyVideo);
  const fallbackFn = useServerFn(generateFireflyVideo);
  const voiceFn = useServerFn(generateFireflyVoice);

  const [tab, setTab] = useState("image");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageSize, setImageSize] = useState<FireflyImageSize>("16:9");
  const [imageProvider, setImageProvider] = useState<FireflyImageProvider>("pollinations");
  const [imageSeed, setImageSeed] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [scenes, setScenes] = useState<FireflyScene[]>([{ text: "", seconds: 5 }]);
  const [cameraMovement, setCameraMovement] = useState("static");
  const [videoModel, setVideoModel] = useState<FireflyVideoModel>("ltx");
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
    mutationFn: async () => {
      if (imageActive > 3) throw new Error("Máximo 3 elementos activos por prompt (@nombre).");
      const result = await imageFn({
        data: {
          prompt: imagePrompt,
          imageSize,
          provider: imageProvider,
          seed: parseSeed(imageSeed),
          assets,
        },
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onMutate: () => startProgress("Generando imagen…", 35),
    onSuccess: (result) => {
      setImageUrl(result.url);
      toast.success("Imagen lista.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo generar la imagen."),
    onSettled: finishProgress,
  });

  const videoMutation = useMutation({
    mutationFn: async (): Promise<SequenceView> => {
      if (videoActive > 3) throw new Error("Máximo 3 elementos activos por prompt (@nombre).");
      if (totalSeconds <= 0 || totalSeconds > 60)
        throw new Error("El total de las escenas debe estar entre 1 y 60 segundos.");
      if (!uid) throw new Error("Inicia sesión para generar videos.");
      startProgress("Preparando escenas…", Math.max(90, totalSeconds * 6));
      let chainStarted = false;
      try {
        const started = await beginFn({
          data: {
            prompt: videoPrompt,
            scenes,
            cameraMovement,
            seed: parseSeed(videoSeed),
            assets,
            model: videoModel,
            referencePath,
          },
        });
        if (!started.ok) throw new Error(started.message);
        chainStarted = true;
        const clips: FireflySceneClip[] = [];
        let sceneReference: string | null = referencePath;
        for (const [index, scene] of scenes.entries()) {
          advanceProgress(`Escena ${index + 1} de ${scenes.length}…`, index / scenes.length);
          const sceneResult = await sceneFn({
            data: {
              generationId: started.generationId,
              sceneIndex: index,
              scene,
              cameraMovement,
              seed: parseSeed(videoSeed),
              referencePath: sceneReference,
            },
          });
          if (!sceneResult.ok) throw new Error(sceneResult.message);
          clips.push(sceneResult.clip);
          setVideoResult({
            label: "Secuencia de escenas (sin unir)",
            generationId: started.generationId,
            clips: [...clips],
            stitched: false,
          });
          if (index < scenes.length - 1) {
            const captured = await captureFrameFromVideoUrl(
              sceneResult.clip.url,
              Math.max(0, sceneResult.clip.seconds - 0.15),
            );
            sceneReference = await uploadCapturedFrame(uid, captured.blob, captured.seconds);
          }
          advanceProgress(
            `Escena ${index + 1} de ${scenes.length} lista`,
            (index + 1) / scenes.length,
          );
        }
        const finished = await finishFn({ data: { generationId: started.generationId } });
        if (!finished.ok) throw new Error(finished.message);
        return {
          label: finished.label,
          generationId: finished.generationId,
          clips: finished.clips,
          stitched: finished.stitched,
        };
      } catch (error) {
        if (!chainStarted) throw error;
        toast.message("Encadenamiento no disponible. Probando Cinemático Multi-Escena…");
        startProgress("Renderizando Cinemático Multi-Escena…", Math.max(120, totalSeconds * 8));
        const fallback = await fallbackFn({
          data: { prompt: videoPrompt, scenes, cameraMovement, seed: parseSeed(videoSeed), assets },
        });
        if (!fallback.ok) throw new Error(fallback.message);
        return {
          label: fallback.label ?? "Cinemático Multi-Escena (un solo render)",
          generationId: fallback.songId,
          clips: [
            {
              songId: fallback.songId,
              url: fallback.url,
              storagePath: "",
              sceneNumber: 1,
              seconds: totalSeconds,
              mediaType: fallback.mediaType,
              model: "fallback",
            },
          ],
          stitched: true,
        };
      }
    },
    onSuccess: (result) => {
      setVideoResult(result);
      toast.success("Video listo.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "No se pudo generar el video."),
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

  const imageReady =
    imagePrompt.trim().length >= 3 &&
    imageActive <= 3 &&
    !imageMutation.isPending &&
    !disabledReason;
  const videoReady =
    videoPrompt.trim().length >= 3 &&
    totalSeconds > 0 &&
    totalSeconds <= 60 &&
    videoActive <= 3 &&
    !videoMutation.isPending &&
    !disabledReason;
  const voiceReady = voiceText.trim().length >= 3 && !voiceMutation.isPending && !disabledReason;

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
            label="Proveedor"
            options={FIREFLY_IMAGE_PROVIDERS.map((provider) => ({
              value: provider.value,
              label: provider.label,
            }))}
            value={imageProvider}
            onChange={setImageProvider}
          />

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
            disabled={signedIn ? !imageReady : false}
            onClick={() => start(() => void imageMutation.mutate())}
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
                alt="Imagen generada"
                className="w-full rounded-xl border border-border object-contain"
              />
              <p className="text-xs text-muted-foreground">
                El enlace de descarga caduca en 1 hora{isAdmin ? "" : " y el archivo en 48 horas"}.
              </p>
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
            label="Modelo"
            options={FIREFLY_VIDEO_MODELS.map((model) => ({
              value: model.value,
              label: model.label,
            }))}
            value={videoModel}
            onChange={setVideoModel}
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
            disabled={signedIn ? !videoReady : false}
            onClick={() => start(() => void videoMutation.mutate())}
          >
            {videoMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {videoMutation.isPending
              ? "Generando escenas…"
              : signedIn
                ? `Generar Video · ${CREDIT_COSTS.video} créditos`
                : "Inicia sesión para generar"}
          </Button>

          {videoResult && (
            <div className={cardClass}>
              <p className="font-display text-sm">{videoResult.label}</p>
              <p className="text-xs text-muted-foreground">
                {videoResult.stitched
                  ? "Render único devuelto por el proveedor."
                  : "Clips en orden. No se creó un MP4 unificado."}
              </p>
              <div className="space-y-5">
                {videoResult.clips.map((clip) => (
                  <div key={clip.songId} className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {clip.sceneNumber === 1 && videoResult.stitched
                        ? "Render completo"
                        : `Escena ${clip.sceneNumber}`}{" "}
                      · {clip.seconds}s
                    </p>
                    <video
                      src={clip.url}
                      controls
                      playsInline
                      className="w-full rounded-xl border border-border bg-background"
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Los enlaces caducan en 1 hora{isAdmin ? "" : " y los archivos en 48 horas"}.
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
