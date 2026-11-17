import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, CREDIT_PACKAGES, FREE_SIGNUP_CREDITS, findPackage } from "./credits";
import { DURATIONS, GENRES, VOICE_TYPES, buildMusicPrompt, isBpm, isDuration, isGenre, modelForDuration, titleFromPrompt } from "./music";

describe("music rules", () => {
  it("offers exactly the requested genres", () => {
    expect([...GENRES]).toEqual(["Dembow", "Reguetón", "Bachata", "Salsa", "Trap", "Pop", "Electrónica", "Rock"]);
    expect(isGenre("Lo-Fi")).toBe(false);
  });

  it("offers the four requested voice types", () => {
    expect([...VOICE_TYPES]).toEqual(["Voz Masculina Realista", "Voz Femenina Realista", "Coro", "Instrumental"]);
  });

  it("offers 30s, 1, 2 and 3 minute durations only", () => {
    expect(DURATIONS.map((d) => d.seconds)).toEqual([30, 60, 120, 180]);
    expect(isDuration(45)).toBe(false);
  });

  it("accepts BPM between 60 and 180", () => {
    expect(isBpm(60)).toBe(true);
    expect(isBpm(181)).toBe(false);
  });

  it("uses the clip model for 30 seconds and the full-song model for longer songs", () => {
    expect(modelForDuration(30)).toBe("google/lyria-3-clip-preview");
    expect(modelForDuration(180)).toBe("google/lyria-3-pro-preview");
  });

  it("puts the lyrics, BPM and voice in the prompt, and drops lyrics for instrumentals", () => {
    const base = { description: "amor en la playa", lyrics: "[Coro]\nBaila conmigo", genre: "Bachata" as const, bpm: 128, seconds: 120 as const };
    const sung = buildMusicPrompt({ ...base, voice: "Voz Femenina Realista" });
    expect(sung).toContain("128 BPM");
    expect(sung).toContain("female");
    expect(sung).toContain("Lyrics:\n[Coro]\nBaila conmigo");
    expect(buildMusicPrompt({ ...base, voice: "Instrumental" })).not.toContain("Lyrics:");
  });

  it("builds a short title from the description", () => {
    expect(titleFromPrompt("una canción alegre sobre el verano en la playa")).toBe("Una canción alegre sobre el verano");
  });
});

describe("credit rules", () => {
  it("gives 3 free credits on signup", () => {
    expect(FREE_SIGNUP_CREDITS).toBe(3);
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
});
