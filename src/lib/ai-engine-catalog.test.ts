import { describe, expect, it } from "vitest";
import {
  AI_ENGINES,
  AI_ENGINE_KEYS,
  AI_FUNCTION_KEYS,
  DEFAULT_AI_ROUTES,
  defaultModelFor,
  enginesForFunction,
  getAiEngine,
  isAiEngineKey,
  isAiFunctionKey,
  normalizeEngineModel,
  routesForFunction,
  supportsFunction,
} from "./ai-engine-catalog";

describe("AI engine catalog", () => {
  it("declares the six requested engines", () => {
    expect(AI_ENGINE_KEYS).toEqual([
      "gemini",
      "cloudflare",
      "ollama",
      "groq",
      "flux",
      "stable-diffusion",
    ]);
    expect(AI_ENGINES).toHaveLength(6);
  });

  it("maps capabilities to the requested functions", () => {
    expect(AI_FUNCTION_KEYS).toEqual(["text", "image", "transcription"]);
    expect(supportsFunction("gemini", "text")).toBe(true);
    expect(supportsFunction("gemini", "image")).toBe(false);
    expect(supportsFunction("groq", "transcription")).toBe(true);
    expect(supportsFunction("flux", "image")).toBe(true);
    expect(supportsFunction("stable-diffusion", "image")).toBe(true);
    expect(supportsFunction("ollama", "text")).toBe(true);
  });

  it("requires explicit authorization for overage-capable engines", () => {
    expect(getAiEngine("cloudflare").paidAuthorizationRequired).toBe(true);
    expect(getAiEngine("flux").paidAuthorizationRequired).toBe(true);
    expect(getAiEngine("stable-diffusion").paidAuthorizationRequired).toBe(true);
    expect(getAiEngine("gemini").paidAuthorizationRequired).toBe(false);
    expect(getAiEngine("groq").paidAuthorizationRequired).toBe(false);
    expect(getAiEngine("ollama").paidAuthorizationRequired).toBe(false);
  });

  it("provides ordered fallback routes for every function", () => {
    for (const functionKey of AI_FUNCTION_KEYS) {
      const routes = routesForFunction(functionKey);
      expect(routes.length).toBeGreaterThan(0);
      expect(routes.every((route) => route.enabled)).toBe(true);
      expect(routes.map((route) => route.priority)).toEqual(
        [...routes.map((route) => route.priority)].sort((a, b) => a - b),
      );
      expect(
        routes.every((route) =>
          enginesForFunction(functionKey).some((engine) => engine.key === route.providerKey),
        ),
      ).toBe(true);
    }
    expect(DEFAULT_AI_ROUTES).toHaveLength(7);
  });

  it("normalizes models and allows custom Ollama models", () => {
    expect(normalizeEngineModel("gemini", "text", "gemini-2.5-flash-lite")).toBe(
      "gemini-2.5-flash-lite",
    );
    expect(normalizeEngineModel("gemini", "text", "modelo-inventado")).toBe(
      defaultModelFor("gemini", "text"),
    );
    expect(normalizeEngineModel("ollama", "text", "mi-modelo:latest")).toBe("mi-modelo:latest");
    expect(normalizeEngineModel("ollama", "text", "../malicioso")).toBe(
      defaultModelFor("ollama", "text"),
    );
  });

  it("validates catalog keys", () => {
    expect(isAiEngineKey("groq")).toBe(true);
    expect(isAiEngineKey("otro")).toBe(false);
    expect(isAiFunctionKey("text")).toBe(true);
    expect(isAiFunctionKey("video")).toBe(false);
  });
});
