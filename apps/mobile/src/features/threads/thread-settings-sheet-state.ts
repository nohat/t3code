import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";

export function modelFavoriteKey(provider: ProviderInstanceId, model: string): string {
  return `${provider}:${model}`;
}

export function favoritesFirst(
  models: ReadonlyArray<ModelOption>,
  favoriteKeys: ReadonlySet<string>,
): ReadonlyArray<ModelOption> {
  const favorites: ModelOption[] = [];
  const others: ModelOption[] = [];
  for (const model of models) {
    (favoriteKeys.has(model.key) ? favorites : others).push(model);
  }
  return [...favorites, ...others];
}

/** Every starred model across providers, in instance then catalog order. */
export function collectStarredModels(
  groups: ReadonlyArray<ProviderGroup>,
  favoriteKeys: ReadonlySet<string>,
): ReadonlyArray<ModelOption> {
  const starred: ModelOption[] = [];
  for (const group of groups) {
    for (const model of group.models) {
      if (favoriteKeys.has(model.key)) {
        starred.push(model);
      }
    }
  }
  return starred;
}

/** Match the terms a user can actually see or recognize in the model picker. */
export function modelMatchesCatalogQuery(input: {
  readonly model: ModelOption;
  readonly providerLabel: string;
  readonly query: string;
}): boolean {
  const query = input.query.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return true;
  }

  return [
    input.model.label,
    input.model.subtitle,
    input.model.selection.model,
    input.providerLabel,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

export function pendingModelAfterPress(input: {
  readonly current: ModelOption | null;
  readonly pressed: ModelOption;
  readonly pressedIsApplied: boolean;
  readonly restoreSelection?: (selection: ModelSelection) => ModelSelection;
}): ModelOption | null {
  if (input.pressedIsApplied) {
    return null;
  }
  if (input.current?.key === input.pressed.key) {
    return input.current;
  }
  return input.restoreSelection
    ? { ...input.pressed, selection: input.restoreSelection(input.pressed.selection) }
    : input.pressed;
}

export function canCommitPendingModel(
  pending: ModelOption,
  groups: ReadonlyArray<ProviderGroup>,
): boolean {
  return groups.some((group) =>
    group.models.some(
      (model) => model.key === pending.key && !model.isUnavailable && !model.isHidden,
    ),
  );
}

/**
 * What a dismissal (Done, Save, swipe, backdrop, or back navigation) does with
 * the staged model. Cancel never reaches here because it clears the staged
 * model first.
 */
export type ThreadSettingsDismissAction =
  | { readonly kind: "none" }
  | { readonly kind: "commit"; readonly option: ModelOption }
  | { readonly kind: "unavailable"; readonly option: ModelOption };

export function resolveDismissAction(input: {
  readonly pending: ModelOption | null;
  readonly groups: ReadonlyArray<ProviderGroup>;
}): ThreadSettingsDismissAction {
  if (!input.pending) {
    return { kind: "none" };
  }
  return canCommitPendingModel(input.pending, input.groups)
    ? { kind: "commit", option: input.pending }
    : { kind: "unavailable", option: input.pending };
}

/**
 * Primary and selected providers start open; all other catalogs start closed.
 * A user's disclosure tap inverts that default until the picker is dismissed.
 */
export function providerSectionIsCollapsed(input: {
  readonly defaultExpanded: boolean;
  readonly hasExpansionOverride: boolean;
  readonly isNarrowed: boolean;
}): boolean {
  if (input.isNarrowed) {
    return false;
  }
  return input.defaultExpanded ? input.hasExpansionOverride : !input.hasExpansionOverride;
}
