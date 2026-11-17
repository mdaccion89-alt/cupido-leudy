// Pure music-generation rules shared by the browser and the server functions.

export const GENRES = ["Dembow", "Reguetón", "Bachata", "Salsa", "Trap", "Pop", "Electrónica", "Rock"] as const;
export type Genre = (typeof GENRES)[number];

export const VOICE_TYPES = [
  "Voz Masculina Realista",
  "Voz Femenina Realista",
  "Coro",
  "Instrumental",
] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];

export const DURATIONS = [
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 180, label: "3 min" },
] as const;
export type DurationSeconds = (typeof DURATIONS)[number]["seconds"];

export const BPM_MIN = 60;
export const BPM_MAX = 180;
export const MAX_PROMPT_LENGTH = 600;
export const MAX_LYRICS_LENGTH = 3000;

const CLIP_MODEL = "google/lyria-3-clip-preview";
const PRO_MODEL = "google/lyria-3-pro-preview";

export const GENRE_DEFAULT_BPM: Record<Genre, number> = {
  Dembow: 120,
  Reguetón: 92,
  Bachata: 128,
  Salsa: 180,
  Trap: 140,
  Pop: 116,
  Electrónica: 126,
  Rock: 132,
};

const GENRE_DIRECTION: Record<Genre, string> = {
  Dembow:
    "Dominican dembow with a fast, hypnotic dembow drum loop, heavy kicks, snappy snares, street energy and chanted hooks.",
  Reguetón:
    "Modern reggaeton with a dembow rhythm, deep 808 bass, crisp percussion, Latin urban vocals and a catchy chorus.",
  Bachata:
    "Romantic Dominican bachata with requinto lead guitar arpeggios, rhythm guitar, bongos, güira and bass.",
  Salsa:
    "Classic salsa with piano montunos, a powerful brass section, congas, timbales, cowbell, bass tumbao and a call-and-response coro.",
  Trap: "Latin trap with booming 808s, rapid hi-hat rolls, dark atmospheric synths and confident melodic flows.",
  Pop: "Polished modern pop with bright synths, punchy drums, warm lead vocals and an unforgettable hook.",
  Electrónica: "Energetic electronic dance music with pulsing synth bass, rising build-ups and a powerful drop.",
  Rock: "Driving rock with overdriven electric guitars, live drums, bass guitar and passionate vocals.",
};

const VOICE_DIRECTION: Record<VoiceType, string> = {
  "Voz Masculina Realista": "Lead vocals: a realistic, expressive male human voice singing in Spanish.",
  "Voz Femenina Realista": "Lead vocals: a realistic, expressive female human voice singing in Spanish.",
  Coro: "Vocals: a full choir of human voices singing in Spanish with rich harmonies.",
  Instrumental: "Instrumental only, no vocals.",
};

export function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value);
}

export function isVoiceType(value: unknown): value is VoiceType {
  return typeof value === "string" && (VOICE_TYPES as readonly string[]).includes(value);
}

export function isDuration(value: unknown): value is DurationSeconds {
  return DURATIONS.some((d) => d.seconds === value);
}

export function isBpm(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= BPM_MIN && value <= BPM_MAX;
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
  const firstLine = prompt.replace(/\[[^\]]*\]/g, " ").trim().split("\n")[0] ?? "";
  const words = firstLine.replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ");
  const clean = words.replace(/[.,;:!?¡¿]+$/g, "").trim();
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

export type SongRequest = {
  description: string;
  lyrics?: string;
  genre: Genre;
  voice: VoiceType;
  bpm: number;
  seconds: DurationSeconds;
};

export function buildMusicPrompt(req: SongRequest): string {
  const lines = [
    GENRE_DIRECTION[req.genre],
    `Tempo: ${req.bpm} BPM.`,
    VOICE_DIRECTION[req.voice],
    req.description.trim() ? `Song idea: ${req.description.trim()}` : "",
    structureFor(req.seconds),
    "Professional, radio-ready mix and mastering.",
  ];
  if (req.lyrics?.trim() && req.voice !== "Instrumental") lines.push(`Lyrics:\n${req.lyrics.trim()}`);
  return lines.filter(Boolean).join("\n");
}
