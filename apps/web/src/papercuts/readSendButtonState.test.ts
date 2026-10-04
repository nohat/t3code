import { describe, expect, it } from "vite-plus/test";

import { readSendButtonState } from "./readSendButtonState";

function rootWithButton(button: { label: string | null; disabled: boolean } | null): ParentNode {
  return {
    querySelector: () =>
      button === null ? null : { disabled: button.disabled, getAttribute: () => button.label },
  } as unknown as ParentNode;
}

describe("readSendButtonState", () => {
  it("reports nothing when the composer is not on screen", () => {
    expect(readSendButtonState(rootWithButton(null))).toEqual({});
  });

  it("carries the label when the button is enabled", () => {
    expect(readSendButtonState(rootWithButton({ label: "Send message", disabled: false }))).toEqual(
      {
        sendLabel: "Send message",
      },
    );
  });

  it("uses the visible reason when the button explains why it is disabled", () => {
    expect(
      readSendButtonState(rootWithButton({ label: "Environment disconnected", disabled: true })),
    ).toEqual({
      sendLabel: "Environment disconnected",
      sendDisabledReason: "Environment disconnected",
    });
  });

  it("flags a disabled button that shows no reason", () => {
    expect(readSendButtonState(rootWithButton({ label: "Send message", disabled: true }))).toEqual({
      sendLabel: "Send message",
      sendDisabledReason: "disabled with no reason shown",
    });
  });
});
