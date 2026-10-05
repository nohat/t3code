// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vite-plus/test";

import { prepareV2Cutover } from "./v2-cutover-prepare.ts";

const NOW = new Date("2026-10-05T13:45:07.123Z");

/** A synthetic v1 home: WAL mode, a migration ledger ending in the fork's id 55, some data. */
function makeHome() {
  const root = mkdtempSync(join(tmpdir(), "v2-cutover-"));
  const userdataDir = join(root, "userdata");
  const backupDir = join(root, "backups");
  mkdirSync(userdataDir);
  const database = new DatabaseSync(join(userdataDir, "state.sqlite"));
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE effect_sql_migrations (migration_id INTEGER PRIMARY KEY, created_at TEXT, name TEXT);
    INSERT INTO effect_sql_migrations VALUES (54, '2026-09-01', 'ThreadSettlement');
    INSERT INTO effect_sql_migrations VALUES (55, '2026-10-04', 'PushDevices');
    CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO projection_threads VALUES ('thread-1', 'First'), ('thread-2', 'Second');
  `);
  database.close();
  return { userdataDir, backupDir };
}

const hashOf = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const ledgerIds = (path: string) => {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database
      .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
      .all()
      .map((row) => `${row.migration_id}:${row.name}`);
  } finally {
    database.close();
  }
};

const threadCount = (path: string) => {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return database.prepare("SELECT count(*) AS count FROM projection_threads").get()?.count;
  } finally {
    database.close();
  }
};

describe("prepareV2Cutover", () => {
  it("backs up, copies, and drops the fork's ledger row from the copy only", async () => {
    const { userdataDir, backupDir } = makeHome();
    const sourcePath = join(userdataDir, "state.sqlite");
    const sourceHash = hashOf(sourcePath);

    const result = await prepareV2Cutover({ userdataDir, backupDir, now: NOW });

    expect(result.backupPath).toBe(join(backupDir, "state-pre-v2-20261005T134507Z.sqlite"));
    expect(result.statev2Path).toBe(join(userdataDir, "statev2.sqlite"));
    expect(result.ledgerRowsRemoved).toBe(1);
    // Only the published file is left beside state.sqlite (read before anything opens it, since
    // opening a WAL database adds its sidecars); the temp directory is gone.
    expect(readdirSync(userdataDir).filter((name) => !name.startsWith("state.sqlite"))).toEqual([
      "statev2.sqlite",
    ]);
    expect(ledgerIds(result.statev2Path)).toEqual(["54:ThreadSettlement"]);
    expect(threadCount(result.statev2Path)).toBe(2);
    expect(ledgerIds(result.backupPath)).toEqual(["54:ThreadSettlement", "55:PushDevices"]);
    expect(threadCount(result.backupPath)).toBe(2);
    expect(ledgerIds(sourcePath)).toEqual(["54:ThreadSettlement", "55:PushDevices"]);
    expect(hashOf(sourcePath)).toBe(sourceHash);
  });

  it("removes nothing from a ledger without the fork's row", async () => {
    const { userdataDir, backupDir } = makeHome();
    const database = new DatabaseSync(join(userdataDir, "state.sqlite"));
    database.exec("DELETE FROM effect_sql_migrations WHERE migration_id = 55");
    database.close();

    const result = await prepareV2Cutover({ userdataDir, backupDir, now: NOW });
    expect(result.ledgerRowsRemoved).toBe(0);
    expect(ledgerIds(result.statev2Path)).toEqual(["54:ThreadSettlement"]);
  });

  it("refuses when statev2.sqlite exists, before writing anything", async () => {
    const { userdataDir, backupDir } = makeHome();
    writeFileSync(join(userdataDir, "statev2.sqlite"), "existing");

    await expect(prepareV2Cutover({ userdataDir, backupDir, now: NOW })).rejects.toThrow(
      /already exists/,
    );
    expect(readFileSync(join(userdataDir, "statev2.sqlite"), "utf8")).toBe("existing");
    expect(existsSync(backupDir)).toBe(false);
  });

  it("never overwrites a backup", async () => {
    const { userdataDir, backupDir } = makeHome();
    mkdirSync(backupDir);
    const backupPath = join(backupDir, "state-pre-v2-20261005T134507Z.sqlite");
    writeFileSync(backupPath, "earlier");

    await expect(prepareV2Cutover({ userdataDir, backupDir, now: NOW })).rejects.toThrow(
      /refusing to overwrite/,
    );
    expect(readFileSync(backupPath, "utf8")).toBe("earlier");
    expect(existsSync(join(userdataDir, "statev2.sqlite"))).toBe(false);
  });
});
