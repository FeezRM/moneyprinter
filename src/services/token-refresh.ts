import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { channelConnection } from "@/db/schema";
import { GraphApiError, refreshLongLived } from "@/instagram/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

// Instagram long-lived tokens last 60 days and can only be refreshed while
// still valid, so refresh well before expiry to leave room for retries.
export const REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// Graph API error code 190 means the token is invalid, expired or revoked.
const isAuthFailure = (e: unknown) => e instanceof GraphApiError && (e.code === 190 || e.status === 401);

export type RefreshDeps = {
  refresh?: typeof refreshLongLived;
  now?: Date;
};

export type RefreshResult = { refreshed: number; markedError: number; failed: Array<{ accountId: string; error: unknown }> };

// Refreshes tokens nearing expiry. Connections whose token is already expired or
// rejected by Instagram are marked `error` (they stop receiving automations until
// the user reconnects); other failures are reported so the caller can retry.
export async function refreshExpiringTokens(db: Db, deps: RefreshDeps = {}): Promise<RefreshResult> {
  const refresh = deps.refresh ?? refreshLongLived;
  const now = deps.now ?? new Date();
  const result: RefreshResult = { refreshed: 0, markedError: 0, failed: [] };

  const due = await db
    .select()
    .from(channelConnection)
    .where(
      and(
        eq(channelConnection.platform, "instagram"),
        eq(channelConnection.status, "active"),
        isNotNull(channelConnection.tokenExpiresAt),
        lt(channelConnection.tokenExpiresAt, new Date(now.getTime() + REFRESH_WINDOW_MS)),
      ),
    );

  const markError = async (id: string) => {
    await db.update(channelConnection).set({ status: "error", updatedAt: now }).where(eq(channelConnection.id, id));
    result.markedError++;
  };

  for (const conn of due) {
    if (conn.tokenExpiresAt! <= now) {
      await markError(conn.id);
      continue;
    }
    try {
      const next = await refresh(decryptSecret(conn.accessTokenEnc));
      await db
        .update(channelConnection)
        .set({ accessTokenEnc: encryptSecret(next.accessToken), tokenExpiresAt: next.expiresAt, updatedAt: now })
        .where(eq(channelConnection.id, conn.id));
      result.refreshed++;
    } catch (e) {
      if (isAuthFailure(e)) await markError(conn.id);
      else result.failed.push({ accountId: conn.externalId, error: e });
    }
  }
  return result;
}
