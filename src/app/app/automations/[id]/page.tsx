import { and, eq, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { automation, trigger } from "@/db/schema";
import { requireWorkspace } from "@/lib/session";
import { Builder } from "./builder";

// Reads the session on every request; see app/app/layout.tsx.
export const instant = false;

export default async function AutomationPage({ params }: PageProps<"/app/automations/[id]">) {
  const { id } = await params;
  const { workspaceId } = await requireWorkspace();
  const [a] = await db
    .select()
    .from(automation)
    .where(and(eq(automation.id, id), eq(automation.workspaceId, workspaceId)));
  if (!a) notFound();

  const [liveTrigger] = await db
    .select({ id: trigger.id })
    .from(trigger)
    .where(and(eq(trigger.automationId, a.id), eq(trigger.active, true)))
    .limit(1);
  const others = await db
    .select({ id: automation.id, name: automation.name })
    .from(automation)
    .where(and(eq(automation.workspaceId, workspaceId), ne(automation.id, a.id)));

  return (
    <Builder
      id={a.id}
      initialName={a.name}
      initialFlow={a.draft}
      initialTriggers={a.draftTriggers}
      live={Boolean(liveTrigger)}
      publishedVersion={a.publishedVersion}
      otherAutomations={others}
    />
  );
}
