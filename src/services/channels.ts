import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { channelConnection } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

export async function findInstagramConnection(db: Db, accountId: string) {
  const [row] = await db
    .select()
    .from(channelConnection)
    .where(and(eq(channelConnection.platform, "instagram"), eq(channelConnection.externalId, accountId)));
  if (!row || row.status !== "active") return null;
  return { ...row, accessToken: decryptSecret(row.accessTokenEnc) };
}

// A workspace can hold several Instagram accounts; delayed and chained sends
// use the most recently connected active one so the choice is stable.
export async function findWorkspaceInstagramConnection(db: Db, workspaceId: string) {
  const [row] = await db
    .select()
    .from(channelConnection)
    .where(
      and(
        eq(channelConnection.workspaceId, workspaceId),
        eq(channelConnection.platform, "instagram"),
        eq(channelConnection.status, "active"),
      ),
    )
    .orderBy(desc(channelConnection.createdAt), desc(channelConnection.externalId))
    .limit(1);
  return row ? { ...row, accessToken: decryptSecret(row.accessTokenEnc) } : null;
}

export type InstagramConnection = NonNullable<Awaited<ReturnType<typeof findInstagramConnection>>>;
