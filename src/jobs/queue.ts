import { sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";

export type JobPayloads = {
  process_webhook: { webhookEventId: string };
  resume_run: { runId: string; nodeId: string };
  start_run: { workspaceId: string; automationId: string; contactId: string };
};

// Enqueues through graphile-worker's SQL API so a job commits atomically with
// the caller's transaction.
export async function enqueue<K extends keyof JobPayloads>(
  db: Db | Tx,
  identifier: K,
  payload: JobPayloads[K],
  opts: { runAt?: Date; jobKey?: string; maxAttempts?: number } = {},
): Promise<void> {
  await db.execute(sql`
    select graphile_worker.add_job(
      ${identifier},
      ${JSON.stringify(payload)}::json,
      run_at => ${opts.runAt?.toISOString() ?? null}::timestamptz,
      job_key => ${opts.jobKey ?? null},
      max_attempts => ${opts.maxAttempts ?? 3}
    )
  `);
}
