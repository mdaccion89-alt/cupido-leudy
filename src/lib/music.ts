// Pure music-generation rules shared by the browser and the server function.

export const GENRES = ["Reguetón", "Pop", "Electrónica", "Rock", "Lo-Fi"] as const;
export type Genre = (typeof GENRES)[number];

export const DURATIONS = [
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 180, label: "3 min" },
] as const;
export type DurationSeconds = (typeof DURATIONS)[number]["seconds"];

export const MAX_PROMPT_LENGTH = 600;

const CLIP_MODEL = "google/lyria-3-clip-preview";
const PRO_MODEL = "google/lyria-3-pro-preview";

const GENRE_DIRECTION: Record<Genre, string> = {
  Reguetón:
    "Modern reggaeton with a dembow rhythm around 92 BPM, deep 808 bass, crisp percussion, Latin urban vocals and a catchy chorus.",
  Pop: "Polished modern pop around 116 BPM, bright synths, punchy drums, warm lead vocals and an unforgettable hook.",
  Electrónica:
    "Energetic electronic dance music around 126 BPM, pulsing synth bass, rising build-ups and a powerful drop.",
  Rock: "Driving rock around 132 BPM with overdriven electric guitars, live drums, bass guitar and passionate vocals.",
  "Lo-Fi":
    "Chill lo-fi hip hop around 80 BPM, dusty drums, mellow electric piano, vinyl crackle and a relaxed late-night mood.",
};

export function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value);
}

export function isDuration(value: unknown): value is DurationSeconds {
  return DURATIONS.some((d) => d.seconds === value);
}

/** 30-second songs use the clip model; anything longer needs the full-song model. */
export function modelForDuration(seconds: DurationSeconds): string {
  return seconds <= 30 ? CLIP_MODEL : PRO_MODEL;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function titleFromPrompt(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ");
  const clean = words.replace(/[.,;:!?¡¿]+$/g, "");
  if (!clean) return "Sin título";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function structureFor(seconds: DurationSeconds): string {
  if (seconds <= 30) return "Keep it a focused 30-second piece with one clear musical idea.";
  if (seconds <= 60)
    return "Make it about 1 minute long: [00:00] short intro, [00:10] verse, [00:30] chorus, [00:50] outro.";
  if (seconds <= 120)
    return "Make it about 2 minutes long: [00:00] intro, [00:15] verse, [00:45] chorus, [01:10] second verse, [01:35] final chorus and outro.";
  return "Make it about 3 minutes long: [00:00] intro, [00:15] verse, [00:45] chorus, [01:15] second verse, [01:45] chorus, [02:15] bridge, [02:35] final chorus and outro.";
}

export function buildMusicPrompt(description: string, genre: Genre, seconds: DurationSeconds): string {
  return [
    GENRE_DIRECTION[genre],
    `Song idea: ${description.trim()}`,
    "If the song has vocals, sing in Spanish unless the idea asks for another language.",
    structureFor(seconds),
    "Professional, radio-ready mix and mastering.",
  ].join("\n");
}
