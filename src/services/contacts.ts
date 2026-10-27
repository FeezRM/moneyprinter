import { and, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { activeContactMonth, contact, contactTag, tag } from "@/db/schema";
import type { ContactSnapshot } from "@/flow/filter";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function upsertIgContact(
  db: Db | Tx,
  params: { workspaceId: string; igsid: string; username: string | null },
) {
  const [row] = await db
    .insert(contact)
    .values({ workspaceId: params.workspaceId, igsid: params.igsid, igUsername: params.username, name: params.username })
    .onConflictDoUpdate({
      target: [contact.workspaceId, contact.igsid],
      set: { igUsername: sql`coalesce(excluded.ig_username, ${contact.igUsername})`, updatedAt: new Date() },
    })
    .returning();
  return row;
}

// A message from the contact opens Instagram's 24h standard messaging window.
// Comments do not, so `opensWindow` is false for them.
export async function recordInbound(
  db: Db | Tx,
  params: { workspaceId: string; contactId: string; at: Date; opensWindow: boolean },
) {
  await db
    .update(contact)
    .set({
      lastInteractionAt: params.at,
      updatedAt: new Date(),
      ...(params.opensWindow && { igWindowUntil: new Date(params.at.getTime() + WINDOW_MS) }),
    })
    .where(eq(contact.id, params.contactId));
  await markActive(db, params.workspaceId, params.contactId, params.at);
}

// Billing basis: one row per contact per month they were messaged or messaged us.
export async function markActive(db: Db | Tx, workspaceId: string, contactId: string, at: Date) {
  const month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
  await db.insert(activeContactMonth).values({ workspaceId, contactId, month }).onConflictDoNothing();
}

export async function loadSnapshot(db: Db | Tx, contactId: string): Promise<ContactSnapshot> {
  const [c] = await db.select().from(contact).where(eq(contact.id, contactId));
  const tags = await db
    .select({ name: tag.name })
    .from(contactTag)
    .innerJoin(tag, eq(tag.id, contactTag.tagId))
    .where(eq(contactTag.contactId, contactId));
  return {
    tags: new Set(tags.map((t) => t.name)),
    fields: { ...c.fields, ig_username: c.igUsername, name: c.name },
  };
}

export async function addTag(db: Db | Tx, workspaceId: string, contactId: string, name: string) {
  const [t] = await db
    .insert(tag)
    .values({ workspaceId, name })
    .onConflictDoUpdate({ target: [tag.workspaceId, tag.name], set: { name } })
    .returning({ id: tag.id });
  await db.insert(contactTag).values({ contactId, tagId: t.id }).onConflictDoNothing();
}

export async function removeTag(db: Db | Tx, workspaceId: string, contactId: string, name: string) {
  const [t] = await db.select({ id: tag.id }).from(tag).where(and(eq(tag.workspaceId, workspaceId), eq(tag.name, name)));
  if (t) await db.delete(contactTag).where(and(eq(contactTag.contactId, contactId), eq(contactTag.tagId, t.id)));
}

export async function setField(db: Db | Tx, contactId: string, key: string, value: string | number | boolean | null) {
  await db
    .update(contact)
    .set({
      fields: value === null ? sql`${contact.fields} - ${key}` : sql`${contact.fields} || ${JSON.stringify({ [key]: value })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(contact.id, contactId));
}
