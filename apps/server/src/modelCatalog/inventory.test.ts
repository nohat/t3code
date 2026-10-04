import { describe, expect, it } from "@effect/vitest";

import { buildInventorySeed, parseProviderInventory, resolveIdentity } from "./inventory.ts";

const model = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: slug,
  isCustom: false,
  aliases: [],
  isDefault: false,
  isLegacy: false,
  ...extra,
});

describe("parseProviderInventory", () => {
  it("parses a persisted snapshot and skips malformed models", () => {
    const parsed = parseProviderInventory({
      instanceId: "codex",
      driver: "codex",
      displayName: "Codex",
      models: [model("gpt-6.1-sol"), { name: "missing slug" }, "nope"],
    });
    expect(parsed?.instanceId).toBe("codex");
    expect(parsed?.models).toHaveLength(1);
  });

  it("rejects a snapshot without an instance id", () => {
    expect(parseProviderInventory({ driver: "codex", models: [] })).toBeUndefined();
  });
});

describe("resolveIdentity", () => {
  it("qualifies first-party models with the driver's maker", () => {
    expect(resolveIdentity("claudeAgent", "claude-opus-5-5")).toEqual({
      makerId: "anthropic",
      modelName: "claude-opus-5-5",
    });
    expect(resolveIdentity("codex", "gpt-6.1-sol")).toEqual({
      makerId: "openai",
      modelName: "gpt-6-1-sol",
    });
  });

  it("strips routed prefixes and uses the maker segment", () => {
    expect(resolveIdentity("opencode", "openrouter/anthropic/claude-sonnet-4-5")).toEqual({
      makerId: "anthropic",
      modelName: "claude-sonnet-4-5",
    });
  });

  it("falls back to a name prefix or the driver for proprietary models", () => {
    expect(resolveIdentity("cursor", "composer-2.5").makerId).toBe("cursor");
  });
});

describe("buildInventorySeed", () => {
  it("merges the same model from two instances into one record with two offers", () => {
    const { models, servingProviders, makers } = buildInventorySeed([
      {
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        displayName: "Claude",
        models: [model("claude-opus-5-5", { name: "Claude Opus 5.5" })],
      },
      {
        instanceId: "opencode",
        driver: "opencode",
        displayName: "OpenCode",
        models: [model("openrouter/anthropic/claude-opus-5.5")],
      },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("anthropic/claude-opus-5-5");
    expect(models[0]?.offers).toHaveLength(2);
    expect(models[0]?.primaryOfferId).toBe("claudeAgent:claude-opus-5-5");
    expect(servingProviders.map((provider) => provider.kind)).toEqual([
      "makerDirect",
      "aggregator",
    ]);
    expect(makers[0]?.name).toBe("Anthropic");
  });

  it("excludes custom models", () => {
    const { models } = buildInventorySeed([
      {
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        models: [model("my-private-model", { isCustom: true })],
      },
    ]);
    expect(models).toHaveLength(0);
  });
});
