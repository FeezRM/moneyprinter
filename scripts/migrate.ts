import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { runMigrations } from "graphile-worker";
import { Pool } from "pg";

// Applies app migrations and installs/updates the graphile-worker schema, which the
// web app needs before it can enqueue jobs.
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
  await runMigrations({ connectionString });
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
