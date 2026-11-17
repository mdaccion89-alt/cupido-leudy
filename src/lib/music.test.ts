import { describe, expect, it } from "vitest";
import { DURATIONS, GENRES, buildMusicPrompt, isDuration, isGenre, modelForDuration, titleFromPrompt } from "./music";

describe("music rules", () => {
  it("offers exactly the five requested genres", () => {
    expect([...GENRES]).toEqual(["Reguetón", "Pop", "Electrónica", "Rock", "Lo-Fi"]);
    expect(isGenre("Jazz")).toBe(false);
  });

  it("offers 30s, 1, 2 and 3 minute durations only", () => {
    expect(DURATIONS.map((d) => d.seconds)).toEqual([30, 60, 120, 180]);
    expect(isDuration(45)).toBe(false);
  });

  it("uses the clip model for 30 seconds and the full-song model for longer songs", () => {
    expect(modelForDuration(30)).toBe("google/lyria-3-clip-preview");
    expect(modelForDuration(180)).toBe("google/lyria-3-pro-preview");
  });

  it("includes the user's idea and duration guidance in the prompt", () => {
    const p = buildMusicPrompt("amor en la playa", "Reguetón", 120);
    expect(p).toContain("amor en la playa");
    expect(p).toContain("2 minutes");
  });

  it("builds a short title from the description", () => {
    expect(titleFromPrompt("una canción alegre sobre el verano en la playa")).toBe("Una canción alegre sobre el verano");
  });
});
