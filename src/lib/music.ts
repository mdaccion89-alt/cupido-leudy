// Pure music-generation rules shared by the browser and the server functions.

export const GENRES = [
  "Bachata",
  "Dembow",
  "Reguetón",
  "Salsa",
  "Merengue",
  "Trap",
  "Corridos",
  "Cumbia",
  "Pop",
  "Rock",
  "Electrónica",
  "Hip-Hop",
  "R&B",
  "Jazz",
  "Lo-Fi",
  "Cine/Épico",
] as const;
export type Genre = (typeof GENRES)[number];

export const VOICE_TYPES = [
  "Masculina",
  "Femenina",
  "Niño",
  "Niña",
  "Ardilla (Aguda)",
  "Coro",
  "Instrumental (Sin Voz)",
] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];
export const INSTRUMENTAL: VoiceType = "Instrumental (Sin Voz)";

/** Studio modes: user Pro mode needs a paid plan; admin Pro mode is admin-only. */
export const STUDIO_MODES = ["standard", "user_pro", "admin_pro"] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];

export const DURATIONS = [
  { seconds: 30, label: "30 s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 180, label: "3 min" },
  { seconds: 240, label: "4 min" },
] as const;
export type DurationSeconds = (typeof DURATIONS)[number]["seconds"];

export const BPM_MIN = 60;
export const BPM_MAX = 180;
export const MAX_PROMPT_LENGTH = 600;
export const MAX_LYRICS_LENGTH = 3000;
export const MAX_ADVANCED_LENGTH = 400;

const CLIP_MODEL = "google/lyria-3-clip-preview";
const PRO_MODEL = "google/lyria-3-pro-preview";

export const GENRE_DEFAULT_BPM: Record<Genre, number> = {
  Bachata: 128,
  Dembow: 120,
  Reguetón: 92,
  Salsa: 180,
  Merengue: 150,
  Trap: 140,
  Corridos: 110,
  Cumbia: 100,
  Pop: 116,
  Rock: 132,
  Electrónica: 126,
  "Hip-Hop": 90,
  "R&B": 80,
  Jazz: 120,
  "Lo-Fi": 75,
  "Cine/Épico": 100,
};

const GENRE_DIRECTION: Record<Genre, string> = {
  Bachata:
    "Romantic Dominican bachata with requinto lead guitar arpeggios, rhythm guitar, bongos, güira and bass.",
  Dembow:
    "Dominican dembow with a fast, hypnotic dembow drum loop, heavy kicks, snappy snares, street energy and chanted hooks.",
  Reguetón:
    "Modern reggaeton with a dembow rhythm, deep 808 bass, crisp percussion, Latin urban vocals and a catchy chorus.",
  Salsa:
    "Classic salsa with piano montunos, a powerful brass section, congas, timbales, cowbell, bass tumbao and a call-and-response coro.",
  Merengue:
    "Festive Dominican merengue with fast tambora, güira, accordion or saxophone riffs, bright brass and a danceable two-step groove.",
  Trap: "Latin trap with booming 808s, rapid hi-hat rolls, dark atmospheric synths and confident melodic flows.",
  Corridos:
    "Mexican corridos tumbados with requinto guitar, acoustic twelve-string guitar, tuba or upright bass and storytelling vocals.",
  Cumbia:
    "Latin cumbia with a steady güiro scrape, accordion melodies, congas, bass and a joyful swaying rhythm.",
  Pop: "Polished modern pop with bright synths, punchy drums, warm lead vocals and an unforgettable hook.",
  Rock: "Driving rock with overdriven electric guitars, live drums, bass guitar and passionate vocals.",
  Electrónica:
    "Energetic electronic dance music with pulsing synth bass, rising build-ups and a powerful drop.",
  "Hip-Hop":
    "Boom-bap and modern hip-hop with hard-hitting drums, sampled textures, deep bass and rhythmic rap flows.",
  "R&B":
    "Smooth contemporary R&B with silky chords, laid-back drums, warm bass and soulful vocal runs.",
  Jazz: "Acoustic jazz combo with upright bass, brushed drums, piano comping and expressive improvised solos.",
  "Lo-Fi":
    "Mellow lo-fi hip-hop with dusty drums, vinyl crackle, warm Rhodes chords and a relaxed head-nodding groove.",
  "Cine/Épico":
    "Epic cinematic orchestral score with huge strings, brass, choir, taiko drums and a powerful emotional build.",
};

const VOICE_DIRECTION: Record<VoiceType, string> = {
  Masculina: "Lead vocals: a realistic, expressive adult male human voice singing in Spanish.",
  Femenina: "Lead vocals: a realistic, expressive adult female human voice singing in Spanish.",
  Niño: "Lead vocals: a sweet, clear young boy's voice singing in Spanish.",
  Niña: "Lead vocals: a sweet, clear young girl's voice singing in Spanish.",
  "Ardilla (Aguda)":
    "Lead vocals: a playful, very high-pitched chipmunk-style voice singing in Spanish.",
  Coro: "Vocals: a full choir of human voices singing in Spanish with rich harmonies.",
  "Instrumental (Sin Voz)": "Instrumental only, no vocals.",
};

// Famous real artists that must not be imitated or named in prompts.
export const BLOCKED_ARTISTS = [
  "Bad Bunny",
  "Shakira",
  "Romeo Santos",
  "Daddy Yankee",
  "J Balvin",
  "Karol G",
  "Ozuna",
  "Anuel",
  "Maluma",
  "Rauw Alejandro",
  "Feid",
  "Peso Pluma",
  "Natanael Cano",
  "Marc Anthony",
  "Juan Luis Guerra",
  "Aventura",
  "Prince Royce",
  "El Alfa",
  "Rochy RD",
  "Tokischa",
  "Don Omar",
  "Wisin",
  "Yandel",
  "Nicky Jam",
  "Farruko",
  "Arcángel",
  "Myke Towers",
  "Becky G",
  "Rosalía",
  "Rosalia",
  "Enrique Iglesias",
  "Ricky Martin",
  "Selena",
  "Celia Cruz",
  "Héctor Lavoe",
  "Hector Lavoe",
  "Taylor Swift",
  "Beyoncé",
  "Beyonce",
  "Rihanna",
  "Drake",
  "Eminem",
  "Ed Sheeran",
  "Adele",
  "Billie Eilish",
  "Ariana Grande",
  "Justin Bieber",
  "The Weeknd",
  "Dua Lipa",
  "Bruno Mars",
  "Michael Jackson",
  "Madonna",
  "Lady Gaga",
  "Kanye West",
  "Travis Scott",
  "Post Malone",
  "Coldplay",
  "Metallica",
  "Bizarrap",
  "Quevedo",
  "Grupo Frontera",
  "Fuerza Regida",
] as const;

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Returns the first famous artist name found in the text, or null. */
export function findBlockedArtist(text: string): string | null {
  const hay = ` ${normalize(text).replace(/[^a-z0-9]+/g, " ")} `;
  for (const name of BLOCKED_ARTISTS) {
    const needle = ` ${normalize(name)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()} `;
    if (hay.includes(needle)) return name;
  }
  return null;
}

/** Cleans user text so it never breaks the generator: strips control chars, odd symbols and extra spaces. */
export function sanitizePrompt(text: string, max = MAX_PROMPT_LENGTH): string {
  return text
    .replace(/[^\P{Cc}\t\n\r]/gu, "")
    .replace(/[<>{}`$\\|^~]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export function isGenre(value: unknown): value is Genre {
  return typeof value === "string" && (GENRES as readonly string[]).includes(value);
}
export function isVoiceType(value: unknown): value is VoiceType {
  return typeof value === "string" && (VOICE_TYPES as readonly string[]).includes(value);
}
export function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === "string" && (STUDIO_MODES as readonly string[]).includes(value);
}
export function isDuration(value: unknown): value is DurationSeconds {
  return DURATIONS.some((d) => d.seconds === value);
}
export function isBpm(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= BPM_MIN && value <= BPM_MAX
  );
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
  const firstLine =
    prompt
      .replace(/\[[^\]]*\]/g, " ")
      .trim()
      .split("\n")[0] ?? "";
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
  if (seconds <= 180)
    return "Make it about 3 minutes long: [00:00] intro, [00:15] verse, [00:45] chorus, [01:15] second verse, [01:45] chorus, [02:15] bridge, [02:35] final chorus and outro.";
  return "Make it about 4 minutes long: [00:00] intro, [00:20] verse one, [00:50] chorus, [01:20] verse two, [01:50] chorus, [02:20] instrumental break, [02:50] bridge, [03:10] final chorus, [03:35] extended outro.";
}

export type AdvancedParams = { key?: string; mood?: string; instruments?: string; extra?: string };

export type SongRequest = {
  description: string;
  lyrics?: string;
  genre: Genre;
  voice: VoiceType;
  bpm: number;
  seconds: DurationSeconds;
  mode?: StudioMode;
  advanced?: AdvancedParams;
};

export function buildMusicPrompt(req: SongRequest): string {
  const lines = [
    `Genre: ${req.genre}. ${GENRE_DIRECTION[req.genre]} Stay strictly within this genre's rhythm and style.`,
    `Tempo: exactly ${req.bpm} BPM.`,
    VOICE_DIRECTION[req.voice],
    req.description.trim() ? `Song idea: ${req.description.trim()}` : "",
    structureFor(req.seconds),
  ];
  if (req.mode === "user_pro" || req.mode === "admin_pro")
    lines.push(
      "Studio mode: real acoustic instruments performed by human session musicians, recorded in a high-end studio with natural dynamics and room ambience. Avoid synthetic or robotic sounds.",
    );
  if (req.mode === "admin_pro" && req.advanced) {
    const a = req.advanced;
    if (a.key?.trim()) lines.push(`Musical key: ${a.key.trim()}.`);
    if (a.mood?.trim()) lines.push(`Mood: ${a.mood.trim()}.`);
    if (a.instruments?.trim()) lines.push(`Featured instruments: ${a.instruments.trim()}.`);
    if (a.extra?.trim()) lines.push(`Producer notes: ${a.extra.trim()}`);
  }
  lines.push("Original composition. Professional, radio-ready mix and mastering.");
  if (req.lyrics?.trim() && req.voice !== INSTRUMENTAL) lines.push(`Lyrics:\n${req.lyrics.trim()}`);
  return lines.filter(Boolean).join("\n");
}
