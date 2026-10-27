import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contact, contactTag, tag } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";

// Reads the session on every request; see app/app/layout.tsx.
export const instant = false;

export default async function ContactsPage() {
  const { workspaceId } = await requireWorkspace();
  const rows = await db
    .select({
      id: contact.id,
      name: contact.name,
      igUsername: contact.igUsername,
      igWindowUntil: contact.igWindowUntil,
      lastInteractionAt: contact.lastInteractionAt,
      createdAt: contact.createdAt,
      tags: sql<string[]>`coalesce(array_agg(${tag.name}) filter (where ${tag.name} is not null), '{}')`,
    })
    .from(contact)
    .leftJoin(contactTag, eq(contactTag.contactId, contact.id))
    .leftJoin(tag, eq(tag.id, contactTag.tagId))
    .where(eq(contact.workspaceId, workspaceId))
    .groupBy(contact.id)
    .orderBy(desc(contact.createdAt))
    .limit(200);

  const now = new Date();
  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Contacts</h1>
      {rows.length === 0 ? (
        <p className="text-zinc-600">Contacts appear here when people comment on your posts or message you.</p>
      ) : (
        <table className="w-full overflow-hidden rounded-lg border border-zinc-200 bg-white text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-600">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Tags</th>
              <th className="px-4 py-2 font-medium">Messaging window</th>
              <th className="px-4 py-2 font-medium">Last interaction</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2">{c.igUsername ? `@${c.igUsername}` : (c.name ?? "Unknown")}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {c.igWindowUntil && c.igWindowUntil > now ? (
                    <span className="text-green-700">open until {c.igWindowUntil.toLocaleString()}</span>
                  ) : (
                    <span className="text-zinc-500">closed</span>
                  )}
                </td>
                <td className="px-4 py-2 text-zinc-600">{c.lastInteractionAt?.toLocaleString() ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
