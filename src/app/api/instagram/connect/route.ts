import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl } from "@/instagram/client";
import { IG_STATE_COOKIE } from "@/instagram/oauth";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

export async function GET() {
  await requireWorkspace();
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(IG_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/instagram",
  });
  return Response.redirect(authorizeUrl(`${env().BETTER_AUTH_URL}/api/instagram/callback`, state), 302);
}
