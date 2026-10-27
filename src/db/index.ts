import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

// pg connects lazily on first query, so builds don't need a database.
// The pool is reused across Next.js dev hot reloads.
const pool = (globalForDb.pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));

export const db = drizzle({ client: pool, schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
