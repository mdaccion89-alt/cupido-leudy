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
  DURATIONS,
  GENRES,
  INSTRUMENTAL,
  VOICE_TYPES,
  buildMusicPrompt,
  findBlockedArtist,
  isBpm,
  isDuration,
  isGenre,
  modelForDuration,
  sanitizePrompt,
  titleFromPrompt,
} from "./music";

describe("music rules", () => {
  it("offers exactly the requested 16 genres", () => {
    expect([...GENRES]).toEqual([
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
    ]);
    expect(isGenre("Opera")).toBe(false);
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
    expect(sung).toContain("Lyrics:\n[Coro]\nBaila conmigo");
    expect(buildMusicPrompt({ ...base, voice: INSTRUMENTAL })).not.toContain("Lyrics:");
    expect(buildMusicPrompt({ ...base, voice: "Femenina", seconds: 240 })).toContain(
      "4 minutes long",
    );
  });

  it("adds admin advanced parameters only in admin Pro mode", () => {
    const base = {
      description: "x",
      genre: "Jazz" as const,
      voice: INSTRUMENTAL,
      bpm: 120,
      seconds: 60 as const,
      advanced: { key: "D minor" },
    };
    expect(buildMusicPrompt({ ...base, mode: "admin_pro" })).toContain("D minor");
    expect(buildMusicPrompt({ ...base, mode: "user_pro" })).not.toContain("D minor");
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

  it("sells 10, 30 and 100 credits for $4.99, $12.99 and $34.99", () => {
    expect(CREDIT_PACKAGES.map((p) => [p.credits, p.price])).toEqual([
      [10, "4.99"],
      [30, "12.99"],
      [100, "34.99"],
    ]);
    expect(findPackage("pack-999")).toBeUndefined();
  });

  it("locks WAV and Pro mode to PRO/Premium (or admin)", () => {
    expect(canUsePaidPerks("free", false)).toBe(false);
    expect(canUsePaidPerks("pro", false)).toBe(true);
    expect(canUsePaidPerks("free", true)).toBe(true);
  });

  it("verifies creators above 1,000 followers or with Premium", () => {
    expect(isVerifiedCreator(1000, false)).toBe(false);
    expect(isVerifiedCreator(1001, false)).toBe(true);
    expect(isVerifiedCreator(0, true)).toBe(true);
  });
});
