import { describe, expect, it } from "@effect/vitest";

import { buildSourceIndex, matchSource, normalizeBaseKey, normalizeKey } from "./matching.ts";

describe("matching", () => {
  it("takes the model segment and strips separators", () => {
    expect(normalizeKey("openrouter/anthropic/claude-opus-5.5")).toBe("claudeopus55");
    expect(normalizeKey("anthropic/claude-opus-5-5")).toBe("claudeopus55");
  });

  it("strips trailing release dates and variant suffixes", () => {
    expect(normalizeBaseKey("anthropic/claude-opus-5.5-20260921")).toBe("claudeopus55");
    expect(normalizeBaseKey("openai/gpt-5.2:free")).toBe("gpt52");
    expect(normalizeBaseKey("google/gemini-3.8-flash-latest")).toBe("gemini38flash");
  });

  it("prefers an exact match before falling back", () => {
    const index = buildSourceIndex([
      ["anthropic/claude-opus-5.5", "a"],
      ["google/gemini-3.5-pro", "b"],
    ]);
    expect(matchSource(["anthropic/claude-opus-5.5"], index)?.value).toBe("a");
    expect(matchSource(["anthropic/claude-opus-5.5-20260921"], index)?.value).toBe("a");
  });

  it("does not match an ambiguous normalized key", () => {
    const index = buildSourceIndex([
      ["alpha/shared-model", "a"],
      ["beta/shared-model", "b"],
    ]);
    expect(matchSource(["gamma/shared-model"], index)).toBeUndefined();
  });

  it("does not treat many aliases of one model as ambiguous", () => {
    const index = buildSourceIndex([
      ["anthropic/claude-opus-5.5", "model"],
      ["claude-opus-5.5", "model"],
      ["claude-opus-5-5", "model"],
    ]);
    expect(matchSource(["anthropic/claude-opus-5.5-20260921"], index)?.value).toBe("model");
  });
});
