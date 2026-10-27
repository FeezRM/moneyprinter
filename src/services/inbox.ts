import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { contact, messageLog, thread } from "@/db/schema";
import { renderMessage } from "@/instagram/client";
import type { InstagramConnection } from "./channels";
import { markActive } from "./contacts";
import type { Messenger } from "./runs";
import { touchThread } from "./threads";

export class ReplyError extends Error {}

export function windowOpen(igWindowUntil: Date | null, now: Date): boolean {
  return igWindowUntil !== null && igWindowUntil > now;
}

// Sends a human reply from the inbox. Instagram rejects standard messages outside
// the 24-hour window, so it is checked here rather than surfacing a Graph error.
export async function sendAgentReply(
  db: Db,
  deps: { messenger: Messenger; conn: InstagramConnection; now?: Date },
  params: { workspaceId: string; threadId: string; text: string },
) {
  const now = deps.now ?? new Date();
  const [t] = await db
    .select({ contactId: contact.id, igsid: contact.igsid, igWindowUntil: contact.igWindowUntil })
    .from(thread)
    .innerJoin(contact, eq(contact.id, thread.contactId))
    .where(and(eq(thread.id, params.threadId), eq(thread.workspaceId, params.workspaceId)));
  if (!t) throw new ReplyError("Conversation not found");
  if (!t.igsid) throw new ReplyError("This contact has no Instagram id");
  if (!windowOpen(t.igWindowUntil, now)) {
    throw new ReplyError("The 24-hour messaging window is closed. You can reply after the contact messages you again.");
  }

  const message = renderMessage({ kind: "text", text: params.text, buttons: [] }, [], () => "");
  const sent = await deps.messenger.send(deps.conn, { id: t.igsid }, message);
  await db.insert(messageLog).values({
    workspaceId: params.workspaceId,
    contactId: t.contactId,
    direction: "out",
    channel: "instagram",
    externalId: sent.message_id,
    text: params.text,
    payload: message,
  });
  await touchThread(db, { workspaceId: params.workspaceId, contactId: t.contactId, direction: "out", at: now, preview: params.text });
  await db.update(thread).set({ unread: false }).where(eq(thread.id, params.threadId));
  await markActive(db, params.workspaceId, t.contactId, now);
}
