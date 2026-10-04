// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  GENERATED_CSS_PATH,
  checkTokens,
  contrastRatio,
  parseOklch,
  readTokens,
  renderWarmBrutalismCss,
} from "./lib.ts";

describe("ledger color math", () => {
  it("white on black is 21:1", () => {
    expect(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    const a = "oklch(0.2 0.015 250)";
    const b = "oklch(0.985 0.005 250)";
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("parses oklch components", () => {
    expect(parseOklch("oklch(0.49 0.139 250)")).toEqual({ l: 0.49, c: 0.139, h: 250 });
  });
});

describe("ledger gate", () => {
  const tokens = readTokens();

  it("passes the required contrast pairs in both modes", () => {
    expect(checkTokens(tokens)).toEqual([]);
  });

  it("scopes the bridge to the opt-in profile and never overrides :root", () => {
    const css = renderWarmBrutalismCss(tokens);
    expect(css).toContain('[data-design="warm-brutalism"]');
    expect(css).toContain("--background: var(--wb-surface-page);");
    expect(css).not.toMatch(/^:root \{\s*--background:/m);
  });

  it("keeps the committed CSS current", () => {
    const actual = NodeFS.readFileSync(GENERATED_CSS_PATH, "utf8").trim();
    expect(actual).toBe(renderWarmBrutalismCss(tokens).trim());
  });
});
