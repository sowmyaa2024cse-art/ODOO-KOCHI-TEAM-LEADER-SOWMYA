import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase } from "../src/infrastructure/database.js";
import { parseEnvironment } from "../src/config/env.js";
import { logger } from "../src/services/logger.js";

const migrationDirectory = new URL("../database/migrations/", import.meta.url);
const migrationLockId = 73519201;

export async function runMigrations(): Promise<void> {
  const environment = parseEnvironment();
  const database = createDatabase(environment.DATABASE_URL);

  try {
    const files = (await readdir(migrationDirectory))
      .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    if (files.length === 0) {
      throw new Error("No numbered SQL migrations were found.");
    }

    for (let index = 1; index < files.length; index += 1) {
      if (files[index - 1].slice(0, 3) === files[index].slice(0, 3)) {
        throw new Error(
          `Duplicate migration number: ${files[index].slice(0, 3)}`,
        );
      }
    }

    for (const file of files) {
      const sql = await readFile(new URL(file, migrationDirectory), "utf8");

      await database.transaction(async (transaction) => {
        await transaction.raw("SELECT pg_advisory_xact_lock(?)", [
          migrationLockId,
        ]);
        await transaction.schema.createTableIfNotExists(
          "schema_migrations",
          (table) => {
            table.string("migration_name", 255).primary();
            table
              .timestamp("applied_at", { useTz: true })
              .notNullable()
              .defaultTo(transaction.fn.now());
          },
        );

        const alreadyApplied = await transaction("schema_migrations")
          .select("migration_name")
          .where({ migration_name: file })
          .first();

        if (alreadyApplied) {
          return;
        }

        await transaction.raw(sql);
        await transaction("schema_migrations").insert({ migration_name: file });
      });

      logger.info("Database migration checked", { migration: file });
    }
  } finally {
    await database.destroy();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runMigrations().catch((error: unknown) => {
    logger.error("Database migrations failed", {
      message:
        error instanceof Error ? error.message : "Unknown migration error",
    });
    process.exitCode = 1;
  });
}
