import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { account, session, user, verification, workspace, workspaceMember } from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: { enabled: true },
  databaseHooks: {
    user: {
      create: {
        // Every account starts with its own workspace.
        after: async (u) => {
          await db.transaction(async (tx) => {
            const [w] = await tx.insert(workspace).values({ name: `${u.name}'s workspace` }).returning();
            await tx.insert(workspaceMember).values({ workspaceId: w.id, userId: u.id, role: "owner" });
          });
        },
      },
    },
  },
  // Must stay last so cookies set inside server actions reach the browser.
  plugins: [nextCookies()],
});
