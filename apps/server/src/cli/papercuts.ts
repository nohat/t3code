/**
 * `t3 papercuts list` - lists stored papercut reports. It reads the record
 * files directly, so it works while the server is stopped.
 */
import { type PapercutRecord, PapercutStatus } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { listPapercutRecords, papercutsDirectory } from "../papercuts/Papercuts.ts";
import { baseDirFlag } from "./config.ts";

const NOTE_PREVIEW_CHARS = 48;

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export function formatPapercutTable(records: ReadonlyArray<PapercutRecord>): string {
  const header = ["id", "status", "surface", "thread", "screenshot", "note"];
  const rows = records.map((record) => {
    const note = record.localOnly.note ?? "";
    return [
      record.id,
      record.status,
      record.evidence.when.clientSurface,
      record.evidence.where?.threadId ?? "-",
      record.localOnly.screenshot ? "yes" : "no",
      note.length > NOTE_PREVIEW_CHARS ? `${note.slice(0, NOTE_PREVIEW_CHARS - 1)}…` : note,
    ];
  });
  const table = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...table.map((row) => row[column]!.length)));
  return table
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const papercutsListCommand = Command.make("list", {
  baseDir: baseDirFlag,
  status: Flag.Literals("status", PapercutStatus.literals).pipe(
    Flag.withDescription("Only show reports with this status."),
    Flag.optional,
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Print the full records, evidence and local-only fields, as JSON."),
  ),
}).pipe(
  Command.withDescription("List stored papercut reports, newest first."),
  Command.withHandler(
    Effect.fn("cli.papercuts.list")(function* (flags) {
      const path = yield* Path.Path;
      // --base-dir, else T3CODE_HOME, else the default home. Implicit dev runs
      // store reports in the dev state directory; pass --base-dir for those.
      const envHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(Option.orElse(flags.baseDir, () => envHome)),
      );
      const { stateDir } = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
      const directory = papercutsDirectory(path, stateDir);
      const records = (yield* listPapercutRecords(directory)).filter(
        (record) => Option.isNone(flags.status) || record.status === flags.status.value,
      );

      if (flags.json) {
        yield* Console.log(encodeJson(records));
        return;
      }
      yield* Console.log(
        records.length === 0 ? `No papercuts found in ${directory}.` : formatPapercutTable(records),
      );
    }),
  ),
);

export const papercutsCommand = Command.make("papercuts").pipe(
  Command.withDescription("Inspect papercut reports stored by this T3 Code environment."),
  Command.withSubcommands([papercutsListCommand]),
);
