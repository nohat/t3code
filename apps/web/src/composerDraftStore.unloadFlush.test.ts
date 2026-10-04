// @vitest-environment jsdom

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { COMPOSER_DRAFT_STORAGE_KEY, useComposerDraftStore } from "./composerDraftStore";

const ENVIRONMENT_ID = EnvironmentId.make("environment-unload-flush");

function typeIntoDraft(threadId: string, prompt: string): void {
  const threadRef = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make(threadId));
  useComposerDraftStore.getState().setPrompt(threadRef, prompt);
}

afterEach(async () => {
  await useComposerDraftStore.persist.clearStorage();
  vi.useRealTimers();
});

describe("composerDraftStore unload flush", () => {
  it("lands a still-debounced draft on pagehide", async () => {
    await useComposerDraftStore.persist.clearStorage();
    vi.useFakeTimers();
    typeIntoDraft("thread-pagehide", "typed, then the page went away");
    expect(localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBeNull();

    window.dispatchEvent(new Event("pagehide"));

    expect(localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toContain(
      "typed, then the page went away",
    );
  });

  it("lands a draft when the document hides, but leaves a visible document alone", async () => {
    await useComposerDraftStore.persist.clearStorage();
    vi.useFakeTimers();
    typeIntoDraft("thread-visibility", "typed, then the tab backgrounded");
    expect(localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBeNull();

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBeNull();

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(localStorage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toContain(
      "typed, then the tab backgrounded",
    );
    visibility.mockRestore();
  });
});
