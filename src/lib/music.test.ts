import { describe, expect, it } from "vitest";
import {
  CREDIT_COSTS,
  CREDIT_PACKAGES,
  DAILY_FREE_CREDITS,
  FREE_FILE_RETENTION_DAYS,
  canUsePaidPerks,
  findPackage,
  isVerifiedCreator,
} from "./credits";
import {
  CREATION_MODES,
  DURATIONS,
  ENGINES,
  GENRES,
  INSTRUMENTAL,
  MAX_GENRE_LENGTH,
  VOICE_TYPES,
  buildMusicPrompt,
  bpmForGenre,
  engineModel,
  findBlockedArtist,
  isBpm,
  isCreationMode,
  isDuration,
  isEngineId,
  isGenre,
  modelForDuration,
  parseTokenList,
  sanitizePrompt,
  titleFromPrompt,
} from "./music";

describe("music rules", () => {
  it("offers the requested styles and accepts custom genres", () => {
    expect(GENRES).toEqual(
      expect.arrayContaining([
        "Dembow",
        "Bachata",
        "Reguetón",
        "Trap",
        "Salsa",
        "Merengue",
        "Pop",
        "Rock",
        "Hip Hop",
        "Dance Pop",
        "Synth-pop",
        "Cyberpunk",
        "Afrobeat",
        "Drill",
        "R&B",
        "Corridos",
        "Electrónica",
        "Lo-Fi",
        "Jazz",
        "Gospel",
        "Balada",
        "K-Pop",
        "House",
      ]),
    );
    expect(isGenre("Opera")).toBe(true);
    expect(isGenre("Dembow, Bachata, Trap, Reguetón, Salsa")).toBe(true);
    expect(isGenre("x".repeat(MAX_GENRE_LENGTH + 1))).toBe(false);
    expect(isGenre(" ")).toBe(false);
    expect(bpmForGenre("Ópera")).toBe(110);
  });

  it("offers all music engines and both creation modes", () => {
    expect(ENGINES.map((e) => e.id)).toEqual([
      "v7-pro",
      "v6-studio",
      "v5-fast",
      "minimax-3",
      "elevenlabs-v2",
      "ace-step",
      "musicgen-free",
      "yue-vocal",
    ]);
    expect(isEngineId("yue-vocal")).toBe(true);
    expect(isEngineId("unknown")).toBe(false);
    expect(engineModel("minimax-3")).toBe("fal-ai/minimax/music-03");
    expect(engineModel("yue-vocal")).toBe("m-a-p/YuE-s1-7B-anneal-en-cot");
    expect(CREATION_MODES).toEqual(["simple", "custom"]);
    expect(isCreationMode("custom")).toBe(true);
    expect(isCreationMode("pro")).toBe(false);
  });

  it("parses multiple Hugging Face tokens without duplicates", () => {
    expect(parseTokenList("hf_a, hf_b\nhf_a; hf_c")).toEqual(["hf_a", "hf_b", "hf_c"]);
    expect(parseTokenList(undefined)).toEqual([]);
  });

  it("offers the seven requested voices", () => {
    expect([...VOICE_TYPES]).toEqual([
      "Masculina",
      "Femenina",
      "Niño",
      "Niña",
      "Ardilla (Aguda)",
      "Coro",
      "Instrumental (Sin Voz)",
    ]);
  });

  it("offers 30s, 1, 2, 3 and 4 minute durations only", () => {
    expect(DURATIONS.map((d) => d.seconds)).toEqual([30, 60, 120, 180, 240]);
    expect(isDuration(45)).toBe(false);
    expect(isDuration(240)).toBe(true);
  });

  it("accepts BPM between 60 and 180", () => {
    expect(isBpm(60)).toBe(true);
    expect(isBpm(181)).toBe(false);
  });

  it("uses the clip model for 30 seconds and the full-song model for longer songs", () => {
    expect(modelForDuration(30)).toBe("google/lyria-3-clip-preview");
    expect(modelForDuration(180)).toBe("google/lyria-3-pro-preview");
  });

  it("puts lyrics, BPM and voice in the prompt, and drops lyrics for instrumentals", () => {
    const base = {
      description: "amor en la playa",
      lyrics: "[Coro]\nBaila conmigo",
      genre: "Bachata" as const,
      bpm: 128,
      seconds: 120 as const,
    };
    const sung = buildMusicPrompt({ ...base, voice: "Femenina" });
    expect(sung).toContain("128 BPM");
    expect(sung).toContain("female");
    expect(sung).toContain("V7 Pro");
    expect(sung).toContain("Lyrics:\n[Coro]\nBaila conmigo");
    expect(buildMusicPrompt({ ...base, voice: INSTRUMENTAL })).not.toContain("Lyrics:");
    expect(buildMusicPrompt({ ...base, voice: "Femenina", seconds: 240 })).toContain(
      "4 minutes long",
    );
  });

  it("adds custom advanced parameters for any user and keeps Pro studio mode separate", () => {
    const base = {
      description: "x",
      genre: "Jazz" as const,
      voice: INSTRUMENTAL,
      bpm: 120,
      seconds: 60 as const,
      advanced: { key: "D minor" },
    };
    expect(buildMusicPrompt(base)).toContain("D minor");
    expect(buildMusicPrompt({ ...base, mode: "admin_pro" })).toContain("D minor");
    expect(buildMusicPrompt({ ...base, mode: "user_pro" })).toContain("human session musicians");
  });

  it("blocks famous artist names with or without accents", () => {
    expect(findBlockedArtist("una canción estilo bad bunny")).toBe("Bad Bunny");
    expect(findBlockedArtist("como SHAKIRA en vivo")).toBe("Shakira");
    expect(findBlockedArtist("con voz de romeo santos")).toBe("Romeo Santos");
    expect(findBlockedArtist("una bachata romántica")).toBeNull();
  });

  it("cleans prompts of control characters and symbols", () => {
    expect(sanitizePrompt("  hola\u0000 {mundo}   <b>  ")).toBe("hola mundo b");
  });

  it("builds a short title from the description", () => {
    expect(titleFromPrompt("una canción alegre sobre el verano en la playa")).toBe(
      "Una canción alegre sobre el verano",
    );
  });
});

describe("credit and plan rules", () => {
  it("gives free accounts 5 credits daily and keeps free files 7 days", () => {
    expect(DAILY_FREE_CREDITS).toBe(5);
    expect(FREE_FILE_RETENTION_DAYS).toBe(7);
  });

  it("charges 1 per song, 2 per cover and 5 per videoclip", () => {
    expect(CREDIT_COSTS).toEqual({ song: 1, cover: 2, video: 5 });
  });

  it("sells the current credit packages", () => {
    expect(CREDIT_PACKAGES.map((p) => [p.credits, p.price])).toEqual([
      [5000, "19.99"],
      [12000, "39.99"],
      [30000, "89.99"],
      [80000, "199.99"],
      [1000000, "100.00"],
    ]);
    expect(findPackage("pack-999")).toBeUndefined();
  });

  it("locks WAV and Pro mode to PRO/Premium (or admin)", () => {
    expect(canUsePaidPerks("free", false)).toBe(false);
    expect(canUsePaidPerks("pro", false)).toBe(true);
    expect(canUsePaidPerks("free", true)).toBe(true);
  });

  it("keeps creator verification under admin approval", () => {
    expect(isVerifiedCreator(1000, false)).toBe(false);
    expect(isVerifiedCreator(1001, false)).toBe(false);
    expect(isVerifiedCreator(0, true)).toBe(false);
  });
});
