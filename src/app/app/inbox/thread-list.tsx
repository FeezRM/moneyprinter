import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { contact, thread, user } from "@/db/schema";
import { AutoRefresh } from "./auto-refresh";
import { filterQuery, type InboxFilter } from "./shared";

export async function ThreadList(props: { workspaceId: string; userId: string; filter: InboxFilter; selectedId?: string }) {
  const f = props.filter;
  const rows = await db
    .select({
      id: thread.id,
      unread: thread.unread,
      lastMessageAt: thread.lastMessageAt,
      lastMessageText: thread.lastMessageText,
      name: contact.name,
      igUsername: contact.igUsername,
      assigneeName: user.name,
    })
    .from(thread)
    .innerJoin(contact, eq(contact.id, thread.contactId))
    .leftJoin(user, eq(user.id, thread.assigneeUserId))
    .where(
      and(
        eq(thread.workspaceId, props.workspaceId),
        eq(thread.status, f.status),
        f.unread && eq(thread.unread, true),
        f.mine && eq(thread.assigneeUserId, props.userId),
      ),
    )
    .orderBy(desc(thread.lastMessageAt))
    .limit(100);

  const query = filterQuery(f);
  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <AutoRefresh seconds={10} />
      <div className="border-b border-zinc-200 p-4">
        <h1 className="mb-3 text-lg font-semibold">Inbox</h1>
        <div className="mb-2 flex rounded-md bg-zinc-100 p-0.5 text-sm">
          {(["open", "closed"] as const).map((s) => (
            <Link
              key={s}
              href={`/app/inbox${filterQuery(f, { status: s })}`}
              className={`flex-1 rounded px-2 py-1 text-center capitalize ${f.status === s ? "bg-white font-medium shadow-sm" : "text-zinc-600"}`}
            >
              {s}
            </Link>
          ))}
        </div>
        <div className="flex gap-2 text-xs">
          <FilterChip href={`/app/inbox${filterQuery(f, { unread: f.unread ? undefined : "1" })}`} active={Boolean(f.unread)}>
            Unread
          </FilterChip>
          <FilterChip href={`/app/inbox${filterQuery(f, { mine: f.mine ? undefined : "1" })}`} active={Boolean(f.mine)}>
            Assigned to me
          </FilterChip>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-zinc-500">
          {f.status === "open" && !f.unread && !f.mine
            ? "Conversations appear here when people message you or comment on your posts."
            : "No conversations match these filters."}
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-zinc-100 overflow-y-auto">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={`/app/inbox/${t.id}${query}`}
                className={`block px-4 py-3 hover:bg-zinc-50 ${t.id === props.selectedId ? "bg-zinc-100" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {t.unread && <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-blue-600" />}
                  <span className={`truncate text-sm ${t.unread ? "font-semibold" : "font-medium"}`}>
                    {t.igUsername ? `@${t.igUsername}` : (t.name ?? "Unknown")}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500">{formatShort(t.lastMessageAt)}</span>
                </div>
                <div className="mt-0.5 truncate text-sm text-zinc-600">{t.lastMessageText ?? "—"}</div>
                {t.assigneeName && <div className="mt-1 truncate text-xs text-zinc-500">Assigned to {t.assigneeName}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function FilterChip(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={`rounded-full border px-2.5 py-1 ${props.active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-700 hover:bg-zinc-100"}`}
    >
      {props.children}
    </Link>
  );
}

function formatShort(d: Date): string {
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
