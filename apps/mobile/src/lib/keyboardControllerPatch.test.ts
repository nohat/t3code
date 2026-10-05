import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

// Metro bundles the package's `src/` (its `react-native` field), so the guard reads those
// files. patches/react-native-keyboard-controller@1.22.6.patch (upstream #14808) changes them;
// a version bump that drops the hunks would bring the iPad feed jump (#17) back silently.
function packageRoot() {
  const require = NodeModule.createRequire(import.meta.url);
  return NodePath.dirname(require.resolve("react-native-keyboard-controller/package.json"));
}

function readPatchedSource(relativePath: string) {
  return NodeFS.readFileSync(NodePath.join(packageRoot(), relativePath), "utf8");
}

describe("react-native-keyboard-controller patch", () => {
  it("is installed at the version the patch targets", () => {
    const manifest = JSON.parse(
      NodeFS.readFileSync(NodePath.join(packageRoot(), "package.json"), "utf8"),
    ) as { readonly version: string };
    expect(manifest.version).toBe("1.22.6");
  });

  // A reader at the end of a long thread was thrown back to its top on the next touch. The
  // upstream fix keeps offset math in UIKit's coordinates: it adds the safe-area inset UIKit
  // applies on top of the raw contentInset, and clamps the lowest scroll target to the leading
  // inset instead of 0, so a keyboard or composer-height shift never targets the top.
  it("clamps keyboard-driven scroll targets to UIKit's adjusted insets", () => {
    const chatKeyboard = readPatchedSource(
      "src/components/KeyboardChatScrollView/useChatKeyboard/index.ios.ts",
    );
    expect(chatKeyboard).toMatch(/\+\s*adjustedInsetCompensation;/);
    expect(chatKeyboard).toMatch(/-adjustedStartInsetCompensation,\s*\)/);
  });

  it("threads the inset compensation into composer-height shifts", () => {
    const extraPadding = readPatchedSource(
      "src/components/KeyboardChatScrollView/useExtraContentPadding/index.ts",
    );
    expect(extraPadding).toContain("adjustedInsetCompensation: number;");
    expect(extraPadding).toContain("adjustedStartInsetCompensation: number;");
  });
});
