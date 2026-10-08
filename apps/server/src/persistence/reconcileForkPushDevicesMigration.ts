import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The fork's APNs branch recorded `PushDevices` at migration 55, the id V2 uses for
// OrchestrationV2. The migrator keys on id, so V2's schema would be skipped silently.
// Free id 55 in this database (the V2 copy; state.sqlite is never opened here) so V2
// runs. The `push_devices` table is left in place and unused.
export const reconcileForkPushDevicesMigration = Effect.fn("reconcileForkPushDevicesMigration")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
    `;
    if (tables.length === 0) return;
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 55 AND name = 'PushDevices'`;
  },
);
