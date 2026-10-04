import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ProviderOptionSelection } from "@t3tools/contracts";

import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  canCommitPendingModel,
  collectStarredModels,
  favoritesFirst,
  modelFavoriteKey,
  modelMatchesCatalogQuery,
  pendingModelAfterPress,
  resolveDismissAction,
  toggleModelFavorite,
} from "./thread-settings-sheet-state";

function modelOption(
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> = [],
): ModelOption {
  return {
    key: `codex:${model}`,
    label: model,
    subtitle: "",
    providerKey: "codex",
    providerLabel: "Codex",
    providerDriver: "codex",
    isDefault: false,
    isLegacy: false,
    capabilities: null,
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model,
      options,
    },
  };
}

describe("thread settings sheet state", () => {
  it("keeps favorites in catalog order ahead of other models", () => {
    const models = [
      modelOption("first"),
      modelOption("second"),
      modelOption("third"),
      modelOption("fourth"),
    ];
    const favorites = new Set([models[2]!.key, models[0]!.key]);

    expect(favoritesFirst(models, favorites).map((model) => model.selection.model)).toEqual([
      "first",
      "third",
      "second",
      "fourth",
    ]);
    expect(models.map((model) => model.selection.model)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("adds and removes favorites for one provider instance", () => {
    const codexModel = modelOption("shared");
    const otherProvider = ProviderInstanceId.make("codex_personal");
    const personalModel = {
      ...codexModel,
      key: modelFavoriteKey(otherProvider, "shared"),
      selection: { ...codexModel.selection, instanceId: otherProvider },
    };
    const favorites = toggleModelFavorite([], codexModel);

    expect(toggleModelFavorite(favorites, personalModel)).toEqual([
      { provider: ProviderInstanceId.make("codex"), model: "shared" },
      { provider: otherProvider, model: "shared" },
    ]);
    expect(toggleModelFavorite(favorites, codexModel)).toEqual([]);
  });

  it("matches visible model and provider terms", () => {
    const model = modelOption("gpt-next");

    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "NEXT" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "codex" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "claude" })).toBe(
      false,
    );
  });

  it("treats whitespace-only catalog searches as empty", () => {
    expect(
      modelMatchesCatalogQuery({
        model: modelOption("gpt-next"),
        providerLabel: "Codex",
        query: "   ",
      }),
    ).toBe(true);
  });

  it("matches the upstream provider's display name", () => {
    const model = {
      ...modelOption("opencode/claude-fable-5"),
      label: "Claude Fable 5",
      subtitle: "OpenCode Zen",
    };

    expect(modelMatchesCatalogQuery({ model, providerLabel: "OpenCode", query: " ZEN " })).toBe(
      true,
    );
    expect(modelMatchesCatalogQuery({ model, providerLabel: "OpenCode", query: "copilot" })).toBe(
      false,
    );
  });

  it("clears staging when the applied model is pressed", () => {
    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed: modelOption("gpt-current"),
        pressedIsApplied: true,
      }),
    ).toBeNull();
  });

  it("preserves staged options when the highlighted model is pressed again", () => {
    const pending = modelOption("gpt-next", [{ id: "effort", value: "high" }]);

    expect(
      pendingModelAfterPress({
        current: pending,
        pressed: modelOption("gpt-next"),
        pressedIsApplied: false,
      }),
    ).toBe(pending);
  });

  it("stages a different model", () => {
    const pressed = modelOption("gpt-other");

    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed,
        pressedIsApplied: false,
      }),
    ).toBe(pressed);
  });

  it("cannot save a staged model after sign-out removes it from the catalog", () => {
    const pending = modelOption("gemini-native");
    const group = { providerKey: "codex", providerLabel: "Codex", models: [pending] };

    expect(canCommitPendingModel(pending, [group])).toBe(true);
    expect(canCommitPendingModel(pending, [])).toBe(false);
    expect(
      canCommitPendingModel(pending, [
        {
          ...group,
          models: [{ ...pending, isUnavailable: true }],
        },
      ]),
    ).toBe(false);
  });

  it("commits a staged model on dismissal and reports an unavailable one", () => {
    const pending = modelOption("gpt-next");
    const group: ProviderGroup = {
      providerKey: "codex",
      providerLabel: "Codex",
      models: [pending],
    };

    expect(resolveDismissAction({ pending, groups: [group] })).toEqual({
      kind: "commit",
      option: pending,
    });
    expect(resolveDismissAction({ pending: null, groups: [group] })).toEqual({ kind: "none" });
    expect(
      resolveDismissAction({
        pending,
        groups: [{ ...group, models: [{ ...pending, isUnavailable: true }] }],
      }),
    ).toEqual({ kind: "unavailable", option: pending });
  });

  it("collects starred models across providers in instance then catalog order", () => {
    const codexFirst = modelOption("codex-first");
    const codexSecond = modelOption("codex-second");
    const claudeProvider = ProviderInstanceId.make("claudeAgent");
    const claudeModel = {
      ...modelOption("claude-first"),
      key: modelFavoriteKey(claudeProvider, "claude-first"),
      providerKey: "claudeAgent",
      providerLabel: "Claude",
      selection: { ...modelOption("claude-first").selection, instanceId: claudeProvider },
    };
    const groups: ReadonlyArray<ProviderGroup> = [
      { providerKey: "codex", providerLabel: "Codex", models: [codexFirst, codexSecond] },
      {
        providerKey: "claudeAgent",
        providerLabel: "Claude",
        models: [claudeModel, modelOption("claude-unstarred")],
      },
    ];

    expect(
      collectStarredModels(groups, new Set([codexSecond.key, claudeModel.key, codexFirst.key])).map(
        (model) => model.key,
      ),
    ).toEqual([codexFirst.key, codexSecond.key, claudeModel.key]);
  });
});
