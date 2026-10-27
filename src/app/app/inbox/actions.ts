"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { contact, thread, threadNote } from "@/db/schema";
import { GraphApiError } from "@/instagram/client";
import { requireWorkspace } from "@/lib/session";
import { findWorkspaceInstagramConnection } from "@/services/channels";
import { graphMessenger } from "@/services/inbound";
import { ReplyError, sendAgentReply } from "@/services/inbox";
import { filterQuery, PAUSE_OPTIONS, parseFilter } from "./shared";

export type ActionResult = { ok: true } | { ok: false; errors: string[] };

const threadIdSchema = z.uuid();
// Instagram caps text messages at 1000 characters.
const textSchema = z.string().trim().min(1, "Write something first").max(1000);
const pauseSchema = z.coerce
  .number()
  .refine((m) => PAUSE_OPTIONS.some((o) => o.minutes === m), "Unsupported pause duration");

function invalid(e: z.ZodError): ActionResult {
  return { ok: false, errors: e.issues.map((i) => i.message) };
}

function revalidateInbox() {
  revalidatePath("/app/inbox", "layout");
}

export async function replyToThread(threadId: string, text: string): Promise<ActionResult> {
  const { workspaceId } = await requireWorkspace();
  const id = threadIdSchema.safeParse(threadId);
  if (!id.success) return invalid(id.error);
  const body = textSchema.safeParse(text);
  if (!body.success) return invalid(body.error);

  const conn = await findWorkspaceInstagramConnection(db, workspaceId);
  if (!conn) return { ok: false, errors: ["Connect Instagram in Settings before replying"] };
  try {
    await sendAgentReply(db, { messenger: graphMessenger, conn }, { workspaceId, threadId: id.data, text: body.data });
  } catch (e) {
    if (e instanceof ReplyError) return { ok: false, errors: [e.message] };
    if (e instanceof GraphApiError) return { ok: false, errors: [`Instagram rejected the message: ${e.message}`] };
    throw e;
  }
  revalidateInbox();
  return { ok: true };
}

export async function addNote(threadId: string, text: string): Promise<ActionResult> {
  const { workspaceId, user } = await requireWorkspace();
  const id = threadIdSchema.safeParse(threadId);
  if (!id.success) return invalid(id.error);
  const body = textSchema.safeParse(text);
  if (!body.success) return invalid(body.error);

  const [t] = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.id, id.data), eq(thread.workspaceId, workspaceId)));
  if (!t) return { ok: false, errors: ["Conversation not found"] };
  await db.insert(threadNote).values({ workspaceId, threadId: t.id, authorUserId: user.id, text: body.data });
  revalidateInbox();
  return { ok: true };
}

async function updateThread(threadId: string, set: Partial<typeof thread.$inferInsert>) {
  const { workspaceId } = await requireWorkspace();
  const id = threadIdSchema.parse(threadId);
  await db
    .update(thread)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(thread.id, id), eq(thread.workspaceId, workspaceId)));
  revalidateInbox();
}

export async function setThreadStatus(threadId: string, status: "open" | "closed") {
  await updateThread(threadId, { status: z.enum(["open", "closed"]).parse(status) });
}

export async function markThreadRead(threadId: string) {
  await updateThread(threadId, { unread: false });
}

// Leaves the thread so that viewing it doesn't immediately mark it read again.
export async function markThreadUnread(threadId: string, filter: unknown) {
  await updateThread(threadId, { unread: true });
  redirect(`/app/inbox${filterQuery(parseFilter(z.record(z.string(), z.string().optional()).parse(filter)))}`);
}

export async function assignThread(threadId: string, toMe: boolean) {
  const { user } = await requireWorkspace();
  await updateThread(threadId, { assigneeUserId: z.boolean().parse(toMe) ? user.id : null });
}

// The engine skips triggers and parks running flows while automationPausedUntil is in the future.
export async function pauseAutomation(threadId: string, formData: FormData) {
  const minutes = pauseSchema.parse(formData.get("minutes"));
  await setPause(threadId, new Date(Date.now() + minutes * 60_000));
}

export async function resumeAutomation(threadId: string) {
  await setPause(threadId, null);
}

async function setPause(threadId: string, until: Date | null) {
  const { workspaceId } = await requireWorkspace();
  const id = threadIdSchema.parse(threadId);
  const [t] = await db
    .select({ contactId: thread.contactId })
    .from(thread)
    .where(and(eq(thread.id, id), eq(thread.workspaceId, workspaceId)));
  if (!t) return;
  await db
    .update(contact)
    .set({ automationPausedUntil: until, updatedAt: new Date() })
    .where(and(eq(contact.id, t.contactId), eq(contact.workspaceId, workspaceId)));
  revalidateInbox();
}
