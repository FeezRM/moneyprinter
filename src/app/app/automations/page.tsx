import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { automation, flowRun, trigger } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { createAutomation } from "./actions";

// Reads the session on every request; see app/app/layout.tsx.
export const instant = false;

export default async function AutomationsPage() {
  const { workspaceId } = await requireWorkspace();
  const rows = await db
    .select({
      id: automation.id,
      name: automation.name,
      publishedVersion: automation.publishedVersion,
      updatedAt: automation.updatedAt,
    })
    .from(automation)
    .where(eq(automation.workspaceId, workspaceId))
    .orderBy(desc(automation.updatedAt));

  const live = new Set(
    (
      await db
        .selectDistinct({ id: trigger.automationId })
        .from(trigger)
        .where(and(eq(trigger.workspaceId, workspaceId), eq(trigger.active, true)))
    ).map((r) => r.id),
  );
  const runs = new Map(
    (
      await db
        .select({ id: flowRun.automationId, n: count() })
        .from(flowRun)
        .where(eq(flowRun.workspaceId, workspaceId))
        .groupBy(flowRun.automationId)
    ).map((r) => [r.id, r.n]),
  );

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automations</h1>
        <form action={createAutomation}>
          <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
            New automation
          </button>
        </form>
      </div>
      {rows.length === 0 ? (
        <p className="text-zinc-600">No automations yet. Create one to auto-DM people who comment on your posts.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {rows.map((a) => (
            <li key={a.id}>
              <Link href={`/app/automations/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                <StatusBadge live={live.has(a.id)} published={a.publishedVersion > 0} />
                <span className="font-medium">{a.name}</span>
                <span className="ml-auto text-sm text-zinc-500">{runs.get(a.id) ?? 0} runs</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function StatusBadge({ live, published }: { live: boolean; published: boolean }) {
  const [label, cls] = live
    ? ["LIVE", "bg-red-600 text-white"]
    : published
      ? ["OFF", "bg-zinc-300 text-zinc-700"]
      : ["DRAFT", "bg-zinc-100 text-zinc-600"];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}
