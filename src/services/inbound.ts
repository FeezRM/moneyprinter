import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { automation, messageLog, trigger } from "@/db/schema";
import { replyToComment, sendMessage } from "@/instagram/client";
import { decodeReplyPayload, type NormalizedEvent } from "@/instagram/webhook";
import { selectTrigger, type CandidateTrigger, type InboundEvent } from "@/triggers/match";
import type { TriggerType } from "@/triggers/types";
import { findInstagramConnection, type InstagramConnection } from "./channels";
import { recordInbound, upsertIgContact } from "./contacts";
import { resumeFromReply, startRun, type Messenger } from "./runs";
import { touchThread } from "./threads";

export type InboundDeps = {
  messenger: Messenger;
  publicReply?: (conn: InstagramConnection, commentId: string, text: string) => Promise<void>;
  random?: () => number;
  now?: Date;
};

export async function handleEvent(db: Db, deps: InboundDeps, event: NormalizedEvent): Promise<void> {
  const conn = await findInstagramConnection(db, event.accountId);
  if (!conn) return;

  const senderId = event.kind === "comment" ? event.commenterId : event.senderId;
  const username = event.kind === "comment" ? event.commenterUsername : null;
  const c = await upsertIgContact(db, { workspaceId: conn.workspaceId, igsid: senderId, username });

  // Claim the event: Meta redelivers on failure, and the unique (channel, external_id)
  // index makes a second delivery a no-op instead of a second automated reply.
  const externalId = event.kind === "comment" ? `comment:${event.commentId}` : event.mid;
  if (externalId) {
    const inserted = await db
      .insert(messageLog)
      .values({
        workspaceId: conn.workspaceId,
        contactId: c.id,
        direction: "in",
        channel: "instagram",
        externalId,
        text: "text" in event ? event.text : null,
        payload: event,
        // Meta can redeliver up to 36h late; the inbox orders by when it was sent.
        createdAt: event.at,
      })
      .onConflictDoNothing()
      .returning({ id: messageLog.id });
    if (inserted.length === 0) return;
    await touchThread(db, {
      workspaceId: conn.workspaceId,
      contactId: c.id,
      direction: "in",
      at: event.at,
      preview: "text" in event ? event.text : "Mentioned you in their story",
    });
  }

  await recordInbound(db, { workspaceId: conn.workspaceId, contactId: c.id, at: event.at, opensWindow: event.kind !== "comment" });

  const now = deps.now ?? new Date();
  if (c.automationPausedUntil && c.automationPausedUntil > now) return;
  const runDeps = { messenger: deps.messenger, conn, now };

  if (event.kind === "reply_payload") {
    const decoded = decodeReplyPayload(event.payload);
    if (decoded && (await resumeFromReply(db, runDeps, { ...decoded, contactId: c.id }))) return;
    // Unknown or stale payload: treat the tapped title like a typed message.
    await startFromTrigger(db, runDeps, deps, { kind: "dm", text: event.text }, c.id, {});
    return;
  }

  const inbound: InboundEvent =
    event.kind === "comment"
      ? { kind: "comment", mediaId: event.mediaId, text: event.text, isReply: event.isReply }
      : event.kind === "story_mention"
        ? { kind: "story_mention" }
        : { kind: event.kind, text: event.text };

  await startFromTrigger(db, runDeps, deps, inbound, c.id, event.kind === "comment" ? { commentId: event.commentId } : {});
}

const TYPES_FOR: Record<InboundEvent["kind"], TriggerType[]> = {
  comment: ["ig_comment"],
  dm: ["ig_dm_keyword", "ig_default_reply"],
  story_reply: ["ig_story_reply"],
  story_mention: ["ig_story_mention"],
};

async function startFromTrigger(
  db: Db,
  runDeps: { messenger: Messenger; conn: InstagramConnection; now: Date },
  deps: InboundDeps,
  inbound: InboundEvent,
  contactId: string,
  context: { commentId?: string },
): Promise<string | null> {
  const rows = await db
    .select({ id: trigger.id, config: trigger.config, automationId: trigger.automationId })
    .from(trigger)
    .innerJoin(automation, eq(automation.id, trigger.automationId))
    .where(
      and(
        eq(trigger.workspaceId, runDeps.conn.workspaceId),
        eq(trigger.active, true),
        inArray(trigger.type, TYPES_FOR[inbound.kind]),
        isNotNull(automation.published),
      ),
    )
    .orderBy(asc(trigger.createdAt));

  const chosen = selectTrigger(inbound, rows as CandidateTrigger[]);
  if (!chosen) return null;
  const row = rows.find((r) => r.id === chosen.id)!;

  if (chosen.config.type === "ig_comment" && context.commentId && chosen.config.publicReplies.length > 0 && deps.publicReply) {
    const replies = chosen.config.publicReplies;
    const text = replies[Math.floor((deps.random ?? Math.random)() * replies.length)];
    // A failed public reply shouldn't block the DM, which is the point of the trigger.
    await deps.publicReply(runDeps.conn, context.commentId, text).catch((e) => console.error("public comment reply failed", e));
  }

  return startRun(db, runDeps, { automationId: row.automationId, contactId, triggerId: row.id, context });
}

export const graphMessenger: Messenger = {
  send: (conn, recipient, message) =>
    sendMessage({ accountId: conn.externalId, token: conn.accessToken, recipient, message }),
};

export async function graphPublicReply(conn: InstagramConnection, commentId: string, text: string) {
  await replyToComment({ commentId, token: conn.accessToken, message: text });
}
