import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { channelConnection, workspace } from "@/db/schema";
import { GraphApiError } from "@/instagram/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { findWorkspaceInstagramConnection } from "./channels";
import { refreshExpiringTokens } from "./token-refresh";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-01-01T00:00:00Z");

async function connect(
  workspaceId: string,
  externalId: string,
  over: Partial<typeof channelConnection.$inferInsert> = {},
) {
  await db.insert(channelConnection).values({
    workspaceId,
    platform: "instagram",
    externalId,
    accessTokenEnc: encryptSecret(`token-${externalId}`),
    tokenExpiresAt: new Date(now.getTime() + 5 * DAY),
    ...over,
  });
}

async function row(externalId: string) {
  const [r] = await db.select().from(channelConnection).where(eq(channelConnection.externalId, externalId));
  return r;
}

let workspaceId: string;

beforeEach(async () => {
  await db.execute(sql`truncate workspace cascade`);
  [{ id: workspaceId }] = await db.insert(workspace).values({ name: "test" }).returning();
});

describe("refreshExpiringTokens", () => {
  it("refreshes tokens inside the window and stores the new token and expiry", async () => {
    await connect(workspaceId, "a1");
    const newExpiry = new Date(now.getTime() + 60 * DAY);
    const seen: string[] = [];

    const result = await refreshExpiringTokens(db, {
      now,
      refresh: async (t) => (seen.push(t), { accessToken: "fresh", expiresAt: newExpiry }),
    });

    expect(result).toMatchObject({ refreshed: 1, markedError: 0, failed: [] });
    expect(seen).toEqual(["token-a1"]);
    const r = await row("a1");
    expect(decryptSecret(r.accessTokenEnc)).toBe("fresh");
    expect(r.tokenExpiresAt).toEqual(newExpiry);
    expect(r.status).toBe("active");
  });

  it("leaves tokens outside the window, without an expiry, or not active alone", async () => {
    await connect(workspaceId, "far", { tokenExpiresAt: new Date(now.getTime() + 40 * DAY) });
    await connect(workspaceId, "unknown", { tokenExpiresAt: null });
    await connect(workspaceId, "off", { status: "disabled" });

    const result = await refreshExpiringTokens(db, {
      now,
      refresh: async () => {
        throw new Error("should not be called");
      },
    });

    expect(result).toMatchObject({ refreshed: 0, markedError: 0, failed: [] });
  });

  it("marks an already expired token as error without calling Instagram", async () => {
    await connect(workspaceId, "old", { tokenExpiresAt: new Date(now.getTime() - DAY) });

    const result = await refreshExpiringTokens(db, {
      now,
      refresh: async () => {
        throw new Error("should not be called");
      },
    });

    expect(result.markedError).toBe(1);
    expect((await row("old")).status).toBe("error");
  });

  it("marks the connection as error when Instagram rejects the token", async () => {
    await connect(workspaceId, "revoked");
    const before = (await row("revoked")).accessTokenEnc;

    const result = await refreshExpiringTokens(db, {
      now,
      refresh: async () => {
        throw new GraphApiError("Error validating access token", 400, 190);
      },
    });

    expect(result).toMatchObject({ refreshed: 0, markedError: 1, failed: [] });
    const r = await row("revoked");
    expect(r.status).toBe("error");
    expect(r.accessTokenEnc).toBe(before);
  });

  it("keeps the connection active on transient failures and still processes the rest", async () => {
    await connect(workspaceId, "flaky");
    await connect(workspaceId, "fine");

    const result = await refreshExpiringTokens(db, {
      now,
      refresh: async (t) => {
        if (t === "token-flaky") throw new GraphApiError("Service unavailable", 503);
        return { accessToken: "fresh", expiresAt: new Date(now.getTime() + 60 * DAY) };
      },
    });

    expect(result.refreshed).toBe(1);
    expect(result.markedError).toBe(0);
    expect(result.failed.map((f) => f.accountId)).toEqual(["flaky"]);
    expect((await row("flaky")).status).toBe("active");
    expect(decryptSecret((await row("fine")).accessTokenEnc)).toBe("fresh");
  });
});

describe("findWorkspaceInstagramConnection", () => {
  it("picks the most recently connected active account", async () => {
    await connect(workspaceId, "older", { createdAt: new Date("2025-01-01") });
    await connect(workspaceId, "newer", { createdAt: new Date("2025-06-01") });

    expect((await findWorkspaceInstagramConnection(db, workspaceId))?.externalId).toBe("newer");
  });

  it("skips connections that are not active", async () => {
    await connect(workspaceId, "good", { createdAt: new Date("2025-01-01") });
    await connect(workspaceId, "broken", { createdAt: new Date("2025-06-01"), status: "error" });

    expect((await findWorkspaceInstagramConnection(db, workspaceId))?.externalId).toBe("good");
  });

  it("returns null when the workspace has no active connection", async () => {
    await connect(workspaceId, "broken", { status: "error" });

    expect(await findWorkspaceInstagramConnection(db, workspaceId)).toBeNull();
  });
});
