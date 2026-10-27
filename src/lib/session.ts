import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { workspace, workspaceMember } from "@/db/schema";
import { auth } from "./auth";

// Resolves the signed-in user and their workspace, or redirects to sign-in.
// Every page, action and route under /app scopes its queries by `workspaceId`.
export const requireWorkspace = cache(async () => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) redirect("/login");
  const [m] = await db
    .select({ workspaceId: workspaceMember.workspaceId, role: workspaceMember.role, name: workspace.name })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(eq(workspaceMember.userId, s.user.id))
    .limit(1);
  if (!m) throw new Error(`user ${s.user.id} has no workspace`);
  return { user: s.user, workspaceId: m.workspaceId, workspaceName: m.name, role: m.role };
});
