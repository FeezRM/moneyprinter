import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { contact, contactTag, messageLog, tag, thread, threadNote, user } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { windowOpen } from "@/services/inbox";
import {
  assignThread,
  markThreadRead,
  markThreadUnread,
  pauseAutomation,
  resumeAutomation,
  setThreadStatus,
} from "../actions";
import { PAUSE_OPTIONS, parseFilter } from "../shared";
import { ThreadList } from "../thread-list";
import { Composer, MarkRead } from "./client";

// Reads the session on every request; see app/app/layout.tsx.
export const instant = false;

export default async function ThreadPage({ params, searchParams }: PageProps<"/app/inbox/[threadId]">) {
  const { workspaceId, user: me } = await requireWorkspace();
  const { threadId } = await params;
  const filter = parseFilter(await searchParams);
  if (!z.uuid().safeParse(threadId).success) notFound();

  const [t] = await db
    .select({
      id: thread.id,
      status: thread.status,
      unread: thread.unread,
      assigneeUserId: thread.assigneeUserId,
      assigneeName: user.name,
      contactId: contact.id,
      name: contact.name,
      igUsername: contact.igUsername,
      igWindowUntil: contact.igWindowUntil,
      automationPausedUntil: contact.automationPausedUntil,
    })
    .from(thread)
    .innerJoin(contact, eq(contact.id, thread.contactId))
    .leftJoin(user, eq(user.id, thread.assigneeUserId))
    .where(and(eq(thread.id, threadId), eq(thread.workspaceId, workspaceId)));
  if (!t) notFound();

  const [messages, notes, tags] = await Promise.all([
    db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.contactId, t.contactId), eq(messageLog.workspaceId, workspaceId)))
      .orderBy(desc(messageLog.createdAt))
      .limit(200),
    db
      .select({ id: threadNote.id, text: threadNote.text, createdAt: threadNote.createdAt, authorName: user.name })
      .from(threadNote)
      .leftJoin(user, eq(user.id, threadNote.authorUserId))
      .where(eq(threadNote.threadId, t.id))
      .orderBy(asc(threadNote.createdAt)),
    db
      .select({ name: tag.name })
      .from(contactTag)
      .innerJoin(tag, eq(tag.id, contactTag.tagId))
      .where(eq(contactTag.contactId, t.contactId)),
  ]);

  const timeline: TimelineItem[] = [
    ...messages.map((m) => ({ kind: "message" as const, at: m.createdAt, m })),
    ...notes.map((n) => ({ kind: "note" as const, at: n.createdAt, n })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const now = new Date();
  const open = windowOpen(t.igWindowUntil, now);
  const paused = t.automationPausedUntil && t.automationPausedUntil > now ? t.automationPausedUntil : null;
  const assignedToMe = t.assigneeUserId === me.id;

  return (
    <main className="flex h-screen min-h-0">
      <ThreadList workspaceId={workspaceId} userId={me.id} filter={filter} selectedId={t.id} />
      <section className="flex min-w-0 flex-1 flex-col bg-zinc-50">
        {t.unread && <MarkRead action={markThreadRead.bind(null, t.id)} />}
        <header className="border-b border-zinc-200 bg-white px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-lg font-semibold">{t.igUsername ? `@${t.igUsername}` : (t.name ?? "Unknown")}</h2>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${t.status === "open" ? "bg-green-100 text-green-800" : "bg-zinc-200 text-zinc-700"}`}
            >
              {t.status}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <form action={assignThread.bind(null, t.id, !assignedToMe)}>
                <HeaderButton>{assignedToMe ? "Unassign" : "Assign to me"}</HeaderButton>
              </form>
              <form action={markThreadUnread.bind(null, t.id, filter)}>
                <HeaderButton>Mark unread</HeaderButton>
              </form>
              <form action={setThreadStatus.bind(null, t.id, t.status === "open" ? "closed" : "open")}>
                <HeaderButton primary>{t.status === "open" ? "Close" : "Reopen"}</HeaderButton>
              </form>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-600">
            <span>{t.assigneeName ? `Assigned to ${assignedToMe ? "you" : t.assigneeName}` : "Unassigned"}</span>
            <span className={open ? "text-green-700" : "text-zinc-500"}>
              {open ? `Messaging window open until ${t.igWindowUntil!.toLocaleString()}` : "Messaging window closed"}
            </span>
            {paused ? (
              <form action={resumeAutomation.bind(null, t.id)} className="flex items-center gap-2">
                <span className="font-medium text-amber-700">Automation paused until {paused.toLocaleString()}</span>
                <button className="underline hover:text-zinc-900">Resume</button>
              </form>
            ) : (
              <form action={pauseAutomation.bind(null, t.id)} className="flex items-center gap-1">
                <select name="minutes" defaultValue="60" aria-label="Pause duration" className="rounded border border-zinc-300 bg-white px-1 py-0.5">
                  {PAUSE_OPTIONS.map((o) => (
                    <option key={o.minutes} value={o.minutes}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button className="rounded border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-100">Pause automation</button>
              </form>
            )}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((g) => (
                  <span key={g.name} className="rounded bg-zinc-100 px-1.5 py-0.5">
                    {g.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </header>
        {/* column-reverse keeps the scroll pinned to the newest message without a script. */}
        <div className="flex flex-1 flex-col-reverse overflow-y-auto px-6 py-4">
          <ol className="flex flex-col gap-3">
            {timeline.map((item) => (
              <TimelineEntry key={item.kind === "message" ? item.m.id : item.n.id} item={item} />
            ))}
          </ol>
        </div>
        <Composer threadId={t.id} windowOpen={open} />
      </section>
    </main>
  );
}

type Message = typeof messageLog.$inferSelect;
type TimelineItem =
  | { kind: "message"; at: Date; m: Message }
  | { kind: "note"; at: Date; n: { id: string; text: string; createdAt: Date; authorName: string | null } };

function TimelineEntry({ item }: { item: TimelineItem }) {
  if (item.kind === "note") {
    const n = item.n;
    return (
      <li className="mx-auto w-full max-w-lg rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
        <div className="mb-0.5 text-xs text-amber-800">
          Internal note · {n.authorName ?? "Former member"} · {n.createdAt.toLocaleString()}
        </div>
        <div className="whitespace-pre-wrap">{n.text}</div>
      </li>
    );
  }

  const m = item.m;
  const inbound = m.direction === "in";
  const label = inbound ? inboundLabel(m.payload) : m.flowRunId ? "Automation" : "Live chat";
  const buttons = inbound ? [] : buttonTitles(m.payload);
  const image = inbound ? null : imageUrl(m.payload);
  return (
    <li className={`flex flex-col ${inbound ? "items-start" : "items-end"}`}>
      <div className="mb-0.5 text-xs text-zinc-500">
        {label && <span className="font-medium">{label} · </span>}
        {m.createdAt.toLocaleString()}
      </div>
      <div
        className={`max-w-md rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          inbound ? "bg-white ring-1 ring-zinc-200" : m.flowRunId ? "bg-zinc-800 text-white" : "bg-blue-600 text-white"
        }`}
      >
        {m.text ??
          (image ? (
            <a href={image} target="_blank" rel="noreferrer" className="underline">
              Image
            </a>
          ) : (
            <span className="italic opacity-80">{inbound ? "No text" : "Message"}</span>
          ))}
      </div>
      {buttons.length > 0 && (
        <div className="mt-1 flex flex-wrap justify-end gap-1">
          {buttons.map((b, i) => (
            <span key={i} className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-700">
              {b}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

const INBOUND_LABELS: Record<string, string> = {
  comment: "Commented on your post",
  story_reply: "Replied to your story",
  story_mention: "Mentioned you in their story",
  reply_payload: "Tapped a button",
};

// Inbound payloads are normalized webhook events; outbound ones are Graph API messages.
function inboundLabel(payload: unknown): string | null {
  const kind = z.object({ kind: z.string() }).safeParse(payload);
  return kind.success ? (INBOUND_LABELS[kind.data.kind] ?? null) : null;
}

const graphPayloadSchema = z.object({
  attachment: z
    .object({
      type: z.string(),
      payload: z.object({ url: z.string().optional(), buttons: z.array(z.object({ title: z.string() })).optional() }),
    })
    .optional(),
  quick_replies: z.array(z.object({ title: z.string() })).optional(),
});

function buttonTitles(payload: unknown): string[] {
  const p = graphPayloadSchema.safeParse(payload);
  if (!p.success) return [];
  return [...(p.data.attachment?.payload.buttons ?? []), ...(p.data.quick_replies ?? [])].map((b) => b.title);
}

function imageUrl(payload: unknown): string | null {
  const p = graphPayloadSchema.safeParse(payload);
  return p.success && p.data.attachment?.type === "image" ? (p.data.attachment.payload.url ?? null) : null;
}

function HeaderButton(props: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        props.primary ? "bg-zinc-900 text-white hover:bg-zinc-700" : "border border-zinc-300 bg-white hover:bg-zinc-100"
      }`}
    >
      {props.children}
    </button>
  );
}
