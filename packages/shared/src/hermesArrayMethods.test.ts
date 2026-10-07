// @effect-diagnostics nodeBuiltinImport:off - scans source files on disk.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Source that runs on the iPad's Hermes engine, which has no ES2023 array copies.
// Node has them, so a call passes every test and throws "undefined is not a
// function" on the device; one of these took the app down when a thread opened.
const HERMES_SOURCE_ROOTS = [
  "packages/client-runtime/src",
  "packages/shared/src",
  "packages/contracts/src",
  "apps/mobile/src",
];
const MISSING_ON_HERMES = /\.(toSorted|toReversed|toSpliced)\(/;

const repoRoot = NodePath.join(import.meta.dirname, "../../..");

const sourceFiles = (directory: string): ReadonlyArray<string> =>
  NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

describe("Hermes array methods", () => {
  it("are not called from source that runs on mobile", () => {
    const offenders = HERMES_SOURCE_ROOTS.flatMap((root) =>
      sourceFiles(NodePath.join(repoRoot, root)).flatMap((path) =>
        NodeFS.readFileSync(path, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            MISSING_ON_HERMES.test(line) && !line.trimStart().startsWith("//")
              ? [`${NodePath.relative(repoRoot, path)}:${index + 1}`]
              : [],
          ),
      ),
    );

    assert.deepStrictEqual(offenders, []);
  });
});
