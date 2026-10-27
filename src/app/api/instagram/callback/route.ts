import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { channelConnection } from "@/db/schema";
import { exchangeCode, exchangeForLongLived, getMe, subscribeWebhooks } from "@/instagram/client";
import { encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";
import { IG_STATE_COOKIE } from "@/instagram/oauth";

export async function GET(request: Request) {
  const { workspaceId } = await requireWorkspace();
  const params = new URL(request.url).searchParams;
  const jar = await cookies();
  const expected = jar.get(IG_STATE_COOKIE)?.value;
  jar.delete({ name: IG_STATE_COOKIE, path: "/api/instagram" });

  if (params.get("error")) redirect(`/app/settings?ig=denied`);
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) {
    return new Response("invalid OAuth state", { status: 400 });
  }

  const short = await exchangeCode(code, `${env().BETTER_AUTH_URL}/api/instagram/callback`);
  const long = await exchangeForLongLived(short.accessToken);
  const me = await getMe(long.accessToken);
  await subscribeWebhooks(long.accessToken);

  const now = new Date();
  await db
    .insert(channelConnection)
    .values({
      workspaceId,
      platform: "instagram",
      externalId: me.user_id,
      username: me.username,
      accessTokenEnc: encryptSecret(long.accessToken),
      tokenExpiresAt: long.expiresAt,
      scopes: short.permissions,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [channelConnection.platform, channelConnection.externalId],
      // Reconnecting moves the account to the current workspace with a fresh token.
      set: {
        workspaceId,
        username: me.username,
        accessTokenEnc: encryptSecret(long.accessToken),
        tokenExpiresAt: long.expiresAt,
        scopes: short.permissions,
        status: "active",
        updatedAt: now,
      },
    });

  redirect("/app/settings?ig=connected");
}
