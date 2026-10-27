import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { runMigrations } from "graphile-worker";
import { Client, Pool } from "pg";

export const TEST_DATABASE_URL = "postgres://postgres@localhost:5433/moneyprinter_test";

// Recreates the test database from migrations before the suite runs.
export default async function setup() {
  const admin = new Client({ connectionString: "postgres://postgres@localhost:5433/postgres" });
  await admin.connect();
  await admin.query("drop database if exists moneyprinter_test with (force)");
  await admin.query("create database moneyprinter_test");
  await admin.end();

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
  await runMigrations({ connectionString: TEST_DATABASE_URL });
}
