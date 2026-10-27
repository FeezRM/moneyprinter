"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { automation, trigger } from "@/db/schema";
import { emptyFlow, flowSchema } from "@/flow/types";
import { requireWorkspace } from "@/lib/session";
import { triggerConfigSchema } from "@/triggers/types";

export type ActionResult = { ok: true } | { ok: false; errors: string[] };

const draftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  flow: flowSchema,
  triggers: z.array(triggerConfigSchema).max(20),
});

export async function createAutomation() {
  const { workspaceId } = await requireWorkspace();
  const [a] = await db
    .insert(automation)
    .values({ workspaceId, name: "Untitled automation", draft: emptyFlow(), draftTriggers: [] })
    .returning({ id: automation.id });
  redirect(`/app/automations/${a.id}`);
}

export async function saveDraft(id: string, input: unknown): Promise<ActionResult> {
  const { workspaceId } = await requireWorkspace();
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(formatIssue) };
  const updated = await db
    .update(automation)
    .set({ name: parsed.data.name, draft: parsed.data.flow, draftTriggers: parsed.data.triggers, updatedAt: new Date() })
    .where(and(eq(automation.id, id), eq(automation.workspaceId, workspaceId)))
    .returning({ id: automation.id });
  if (updated.length === 0) return { ok: false, errors: ["automation not found"] };
  revalidatePath(`/app/automations/${id}`);
  return { ok: true };
}

// Publishing snapshots the draft for the engine and swaps in the draft triggers.
export async function publishAutomation(id: string): Promise<ActionResult> {
  const { workspaceId } = await requireWorkspace();
  const [a] = await db
    .select()
    .from(automation)
    .where(and(eq(automation.id, id), eq(automation.workspaceId, workspaceId)));
  if (!a) return { ok: false, errors: ["automation not found"] };

  const flow = flowSchema.safeParse(a.draft);
  if (!flow.success) return { ok: false, errors: flow.error.issues.map(formatIssue) };
  if (flow.data.startNodeId === null) return { ok: false, errors: ["choose a first step before publishing"] };
  if (a.draftTriggers.length === 0) return { ok: false, errors: ["add at least one trigger before publishing"] };

  await db.transaction(async (tx) => {
    await tx
      .update(automation)
      .set({ published: flow.data, publishedVersion: a.publishedVersion + 1, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(automation.id, a.id));
    await tx.delete(trigger).where(eq(trigger.automationId, a.id));
    await tx.insert(trigger).values(
      a.draftTriggers.map((config) => ({ workspaceId, automationId: a.id, config, type: config.type, active: true })),
    );
  });
  revalidatePath("/app/automations");
  revalidatePath(`/app/automations/${id}`);
  return { ok: true };
}

export async function unpublishAutomation(id: string): Promise<ActionResult> {
  const { workspaceId } = await requireWorkspace();
  await db
    .update(trigger)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(trigger.automationId, id), eq(trigger.workspaceId, workspaceId)));
  revalidatePath("/app/automations");
  revalidatePath(`/app/automations/${id}`);
  return { ok: true };
}

export async function deleteAutomation(id: string) {
  const { workspaceId } = await requireWorkspace();
  await db.delete(automation).where(and(eq(automation.id, id), eq(automation.workspaceId, workspaceId)));
  redirect("/app/automations");
}

function formatIssue(i: z.core.$ZodIssue): string {
  return i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
}
