import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

// Metro bundles the package's `src/` (its `react-native` field), so the guard reads those
// files. patches/react-native-keyboard-controller@1.22.4.patch changes them; an upstream
// version bump that drops the hunks would bring the bug back silently.
function readPatchedSource(relativePath: string) {
  const require = NodeModule.createRequire(import.meta.url);
  const packageRoot = NodePath.dirname(
    require.resolve("react-native-keyboard-controller/package.json"),
  );
  return NodeFS.readFileSync(NodePath.join(packageRoot, relativePath), "utf8");
}

describe("react-native-keyboard-controller patch", () => {
  // A contentOffset written through animated props stays on the native scroll view and is
  // reset to 0 by a later React commit of the list, throwing a reader at the end of a long
  // thread back to its top on their next touch. Shifts for composer-height changes and for
  // keyboard events must scroll imperatively instead.
  it.each([
    "src/components/KeyboardChatScrollView/useExtraContentPadding/index.ts",
    "src/components/KeyboardChatScrollView/useChatKeyboard/index.ios.ts",
  ])("%s never writes the animated contentOffset", (relativePath) => {
    expect(readPatchedSource(relativePath)).not.toMatch(/contentOffsetY\.value\s*=/);
  });
});
