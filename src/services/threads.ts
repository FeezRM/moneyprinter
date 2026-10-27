import { sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { thread } from "@/db/schema";

// Keeps the contact's inbox thread in step with message_log. A message from the
// contact marks the thread unread and reopens it; outbound messages only move it
// up the list, so automated replies don't hide that a human hasn't looked yet.
export async function touchThread(
  db: Db | Tx,
  params: { workspaceId: string; contactId: string; direction: "in" | "out"; at: Date; preview: string | null },
) {
  const inbound = params.direction === "in";
  await db
    .insert(thread)
    .values({
      workspaceId: params.workspaceId,
      contactId: params.contactId,
      unread: inbound,
      lastMessageAt: params.at,
      lastMessageText: params.preview,
    })
    .onConflictDoUpdate({
      target: thread.contactId,
      set: {
        lastMessageAt: sql`greatest(${thread.lastMessageAt}, excluded.last_message_at)`,
        lastMessageText: sql`case when excluded.last_message_at >= ${thread.lastMessageAt} then excluded.last_message_text else ${thread.lastMessageText} end`,
        updatedAt: new Date(),
        ...(inbound && { unread: true, status: "open" as const }),
      },
    });
}
