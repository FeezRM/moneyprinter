import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { automation, contact, flowRun, messageLog, type RunContext } from "@/db/schema";
import { resolveReplyTarget, runUntilBlocked, type Effect } from "@/flow/engine";
import { renderMessage, type GraphMessage, type Recipient } from "@/instagram/client";
import { encodeReplyPayload } from "@/instagram/webhook";
import { enqueue } from "@/jobs/queue";
import type { InstagramConnection } from "./channels";
import { addTag, loadSnapshot, markActive, removeTag, setField } from "./contacts";
import { touchThread } from "./threads";

export type Messenger = {
  send(conn: InstagramConnection, recipient: Recipient, message: GraphMessage): Promise<{ message_id: string }>;
};

export class RunError extends Error {}

export async function startRun(
  db: Db,
  deps: { messenger: Messenger; conn: InstagramConnection; now?: Date },
  params: { automationId: string; contactId: string; triggerId: string | null; context: RunContext },
) {
  const [a] = await db.select().from(automation).where(eq(automation.id, params.automationId));
  if (!a?.published) return null;
  const [run] = await db
    .insert(flowRun)
    .values({
      workspaceId: a.workspaceId,
      automationId: a.id,
      automationVersion: a.publishedVersion,
      contactId: params.contactId,
      triggerId: params.triggerId,
      status: "running",
      currentNodeId: a.published.startNodeId,
      context: params.context,
    })
    .returning();
  await advanceRun(db, deps, run.id, a.published.startNodeId);
  return run.id;
}

// A tapped button / quick reply continues its run from the reply's target node.
export async function resumeFromReply(
  db: Db,
  deps: { messenger: Messenger; conn: InstagramConnection; now?: Date },
  params: { runId: string; contactId: string; nodeId: string; replyId: string },
): Promise<boolean> {
  const [run] = await db
    .select()
    .from(flowRun)
    .where(and(eq(flowRun.id, params.runId), eq(flowRun.contactId, params.contactId)));
  if (!run || run.status === "cancelled") return false;
  const [a] = await db.select().from(automation).where(eq(automation.id, run.automationId));
  if (!a?.published) return false;
  const target = resolveReplyTarget(a.published, params.nodeId, params.replyId);
  if (!target) return false;
  await advanceRun(db, deps, run.id, target);
  return true;
}

export async function advanceRun(
  db: Db,
  deps: { messenger: Messenger; conn: InstagramConnection; now?: Date },
  runId: string,
  fromNodeId: string | null,
) {
  const now = deps.now ?? new Date();
  const [run] = await db.select().from(flowRun).where(eq(flowRun.id, runId));
  if (!run || run.status === "cancelled") return;
  const [c] = await db.select().from(contact).where(eq(contact.id, run.contactId));

  // Paused contacts (human takeover) resume when the pause ends.
  if (c.automationPausedUntil && c.automationPausedUntil > now && fromNodeId) {
    await db.update(flowRun).set({ status: "waiting_delay", currentNodeId: fromNodeId, updatedAt: now }).where(eq(flowRun.id, run.id));
    await enqueue(db, "resume_run", { runId: run.id, nodeId: fromNodeId }, { runAt: c.automationPausedUntil, jobKey: `run:${run.id}` });
    return;
  }

  const [a] = await db.select().from(automation).where(eq(automation.id, run.automationId));
  if (!a?.published) {
    await failRun(db, run.id, "automation is no longer published", now);
    return;
  }

  const result = runUntilBlocked({
    flow: a.published,
    startNodeId: fromNodeId,
    contact: await loadSnapshot(db, c.id),
    now,
    splitChoices: run.splitChoices,
    privateReplyAvailable: Boolean(run.context.commentId) && !run.context.privateReplyUsed,
  });

  const context: RunContext = { ...run.context, privateReplyUsed: run.context.privateReplyUsed || result.privateReplyUsed };
  try {
    for (const effect of result.effects) {
      await applyEffect(db, deps, { runId: run.id, workspaceId: run.workspaceId, contactId: c.id, context, now }, effect);
    }
  } catch (e) {
    // No retry: a partially delivered sequence must not be re-sent.
    await failRun(db, run.id, e instanceof Error ? e.message : String(e), now, result.splitChoices, context);
    return;
  }

  const p = result.position;
  await db
    .update(flowRun)
    .set({
      status: p.status,
      currentNodeId: p.currentNodeId,
      splitChoices: result.splitChoices,
      context,
      error: p.status === "failed" ? p.error : null,
      updatedAt: now,
    })
    .where(eq(flowRun.id, run.id));
  if (p.status === "waiting_delay") {
    await enqueue(db, "resume_run", { runId: run.id, nodeId: p.currentNodeId }, { runAt: p.resumeAt, jobKey: `run:${run.id}` });
  }
}

async function applyEffect(
  db: Db,
  deps: { messenger: Messenger; conn: InstagramConnection },
  run: { runId: string; workspaceId: string; contactId: string; context: RunContext; now: Date },
  effect: Effect,
) {
  switch (effect.type) {
    case "send": {
      const [c] = await db.select().from(contact).where(eq(contact.id, run.contactId));
      let recipient: Recipient;
      if (effect.asPrivateReply && run.context.commentId) {
        recipient = { comment_id: run.context.commentId };
      } else {
        if (!c.igsid) throw new RunError("contact has no Instagram id");
        if (!c.igWindowUntil || c.igWindowUntil <= run.now) {
          throw new RunError("Instagram 24-hour messaging window is closed for this contact");
        }
        recipient = { id: c.igsid };
      }
      const message = renderMessage(effect.message, effect.quickReplies, (replyId) =>
        encodeReplyPayload(run.runId, effect.nodeId, replyId),
      );
      const sent = await deps.messenger.send(deps.conn, recipient, message);
      await db.insert(messageLog).values({
        workspaceId: run.workspaceId,
        contactId: run.contactId,
        direction: "out",
        channel: "instagram",
        externalId: sent.message_id,
        text: effect.message.kind === "text" ? effect.message.text : null,
        payload: message,
        flowRunId: run.runId,
        nodeId: effect.nodeId,
      });
      await touchThread(db, {
        workspaceId: run.workspaceId,
        contactId: run.contactId,
        direction: "out",
        at: run.now,
        preview: effect.message.kind === "text" ? effect.message.text : "Image",
      });
      await markActive(db, run.workspaceId, run.contactId, run.now);
      return;
    }
    case "action": {
      const a = effect.action;
      switch (a.type) {
        case "add_tag":
          return addTag(db, run.workspaceId, run.contactId, a.tag);
        case "remove_tag":
          return removeTag(db, run.workspaceId, run.contactId, a.tag);
        case "set_field":
          return setField(db, run.contactId, a.key, a.value);
        case "clear_field":
          return setField(db, run.contactId, a.key, null);
        case "pause_automations":
          await db
            .update(contact)
            .set({ automationPausedUntil: new Date(run.now.getTime() + a.minutes * 60_000) })
            .where(eq(contact.id, run.contactId));
          return;
      }
      return;
    }
    case "start_automation":
      await enqueue(db, "start_run", {
        workspaceId: run.workspaceId,
        automationId: effect.automationId,
        contactId: run.contactId,
      });
      return;
  }
}

async function failRun(
  db: Db,
  runId: string,
  error: string,
  now: Date,
  splitChoices?: Record<string, string>,
  context?: RunContext,
) {
  await db
    .update(flowRun)
    .set({ status: "failed", error, updatedAt: now, ...(splitChoices && { splitChoices }), ...(context && { context }) })
    .where(eq(flowRun.id, runId));
}
