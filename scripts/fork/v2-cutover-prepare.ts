#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off
/**
 * Prepares a T3 home for its first orchestration V2 boot, while its server is stopped.
 *
 *   node scripts/fork/v2-cutover-prepare.ts --userdata <dir> [--backup-dir <dir>]
 *
 * 1. Backs up state.sqlite with VACUUM INTO to <backup-dir>/state-pre-v2-<stamp>.sqlite
 *    (default ~/.t3/fork-backups). Never overwrites.
 * 2. Builds statev2.sqlite the way the server's initializeV2Database does: a read-only open of
 *    state.sqlite, an online backup into a temp directory beside it, then a hard link, so only a
 *    complete file is ever published. Refuses when statev2.sqlite already exists.
 * 3. On the new copy only, removes the fork's `PushDevices` row at migration id 55. Upstream gives
 *    id 55 to OrchestrationV2, and the migrator skips every id at or below the recorded maximum,
 *    so with that row present the V2 schema would never be created.
 *
 * state.sqlite is only ever opened read-only.
 */
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

export interface V2CutoverResult {
  readonly backupPath: string;
  readonly statev2Path: string;
  /** Ledger rows removed from the copy: 1 when the fork's PushDevices row was there. */
  readonly ledgerRowsRemoved: number;
}

const stampOf = (now: Date) =>
  now
    .toISOString()
    .replaceAll(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

/** Removes the fork's id-55 ledger row, which would hide upstream's V2 migration 55. */
function dropForkLedgerRow(databasePath: string): number {
  const database = new DatabaseSync(databasePath);
  try {
    const ledger = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'",
      )
      .get();
    if (ledger === undefined) return 0;
    const { changes } = database
      .prepare("DELETE FROM effect_sql_migrations WHERE migration_id = 55 AND name = 'PushDevices'")
      .run();
    // Fold the WAL back in so the single published file holds the change.
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return Number(changes);
  } finally {
    database.close();
  }
}

export async function prepareV2Cutover(options: {
  readonly userdataDir: string;
  readonly backupDir: string;
  readonly now: Date;
}): Promise<V2CutoverResult> {
  const sourcePath = join(options.userdataDir, "state.sqlite");
  const statev2Path = join(options.userdataDir, "statev2.sqlite");
  const backupPath = join(options.backupDir, `state-pre-v2-${stampOf(options.now)}.sqlite`);
  if (!existsSync(sourcePath)) throw new Error(`no database at ${sourcePath}`);
  if (existsSync(statev2Path)) {
    throw new Error(`${statev2Path} already exists; move it aside first to copy again`);
  }
  if (existsSync(backupPath)) throw new Error(`refusing to overwrite ${backupPath}`);

  mkdirSync(options.backupDir, { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  } finally {
    source.close();
  }

  const temporaryDirectory = mkdtempSync(join(options.userdataDir, ".v2-import-"));
  try {
    const snapshotPath = join(temporaryDirectory, "snapshot.sqlite");
    const snapshotSource = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      await backup(snapshotSource, snapshotPath);
    } finally {
      snapshotSource.close();
    }
    const ledgerRowsRemoved = dropForkLedgerRow(snapshotPath);
    // Fails if statev2.sqlite appeared meanwhile, rather than replacing it.
    linkSync(snapshotPath, statev2Path);
    return { backupPath, statev2Path, ledgerRowsRemoved };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      userdata: { type: "string" },
      "backup-dir": { type: "string", default: join(homedir(), ".t3", "fork-backups") },
    },
  });
  if (!values.userdata) {
    console.error("usage: v2-cutover-prepare --userdata <dir> [--backup-dir <dir>]");
    process.exit(64);
  }
  try {
    const result = await prepareV2Cutover({
      userdataDir: values.userdata,
      backupDir: values["backup-dir"],
      now: new Date(),
    });
    console.log(`v2-cutover-prepare: backup ${result.backupPath}`);
    console.log(`v2-cutover-prepare: created ${result.statev2Path}`);
    console.log(
      `v2-cutover-prepare: removed ${result.ledgerRowsRemoved} PushDevices ledger row(s) from the copy`,
    );
  } catch (error) {
    console.error(`v2-cutover-prepare: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
