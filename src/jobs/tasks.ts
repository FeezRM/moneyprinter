import { eq } from "drizzle-orm";
import type { Task, TaskList } from "graphile-worker";
import { db } from "@/db";
import { flowRun, webhookEvent } from "@/db/schema";
import { normalizeWebhook } from "@/instagram/webhook";
import { findWorkspaceInstagramConnection } from "@/services/channels";
import { graphMessenger, graphPublicReply, handleEvent } from "@/services/inbound";
import { advanceRun, startRun } from "@/services/runs";
import { refreshExpiringTokens } from "@/services/token-refresh";
import type { JobPayloads } from "./queue";

const processWebhook: Task = async (payload) => {
  const { webhookEventId } = payload as JobPayloads["process_webhook"];
  const [ev] = await db.select().from(webhookEvent).where(eq(webhookEvent.id, webhookEventId));
  if (!ev || ev.processedAt) return;
  for (const event of normalizeWebhook(ev.body)) {
    await handleEvent(db, { messenger: graphMessenger, publicReply: graphPublicReply }, event);
  }
  await db.update(webhookEvent).set({ processedAt: new Date() }).where(eq(webhookEvent.id, ev.id));
};

const resumeRun: Task = async (payload) => {
  const { runId, nodeId } = payload as JobPayloads["resume_run"];
  const [run] = await db.select().from(flowRun).where(eq(flowRun.id, runId));
  if (!run || run.status !== "waiting_delay") return;
  const conn = await findWorkspaceInstagramConnection(db, run.workspaceId);
  if (!conn) return;
  await advanceRun(db, { messenger: graphMessenger, conn }, runId, nodeId);
};

const startRunTask: Task = async (payload) => {
  const p = payload as JobPayloads["start_run"];
  const conn = await findWorkspaceInstagramConnection(db, p.workspaceId);
  if (!conn) return;
  await startRun(db, { messenger: graphMessenger, conn }, { automationId: p.automationId, contactId: p.contactId, triggerId: null, context: {} });
};

// Scheduled from the crontab in worker.ts. Throwing on transient failures lets
// graphile-worker retry with backoff.
const refreshTokens: Task = async () => {
  const result = await refreshExpiringTokens(db);
  for (const f of result.failed) console.error(`token refresh failed for ${f.accountId}`, f.error);
  if (result.failed.length > 0) throw new Error(`token refresh failed for ${result.failed.length} connection(s)`);
};

export const taskList: TaskList = {
  refresh_tokens: refreshTokens,
  process_webhook: processWebhook,
  resume_run: resumeRun,
  start_run: startRunTask,
};
