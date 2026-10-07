import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

// The fork's APNs branch recorded `PushDevices` at migration 55, the id V2 uses for
// OrchestrationV2. The live database carries that row.
const seedForkLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 54 });
  yield* sql`CREATE TABLE push_devices (device_id TEXT PRIMARY KEY, token TEXT NOT NULL)`;
  yield* sql`INSERT INTO push_devices (device_id, token) VALUES ('ipad', 'token')`;
  yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'PushDevices')`;
});

describe("fork PushDevices migration collision", () => {
  it.effect("runs V2 at id 55 on a database that recorded PushDevices there", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedForkLedger;
      assert.deepStrictEqual(yield* runMigrations(), [
        [55, "OrchestrationV2"],
        [56, "RemoveRedundantProjectionIndexes"],
      ]);
      assert.deepStrictEqual(yield* runMigrations(), []);
      const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        history.map((row) => [row.migration_id, row.name] as const),
        migrationManifest,
      );
      assert.strictEqual((yield* sql`SELECT * FROM orchestration_v2_projection_runs`).length, 0);
      assert.deepStrictEqual(yield* sql`SELECT device_id FROM push_devices`, [
        { device_id: "ipad" },
      ]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
