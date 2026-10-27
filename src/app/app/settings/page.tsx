import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelConnection } from "@/db/schema";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

// Reads the session on every request; see app/app/layout.tsx.
export const instant = false;

export default async function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  const { workspaceId } = await requireWorkspace();
  const { ig } = await searchParams;
  const [conn] = await db
    .select()
    .from(channelConnection)
    .where(and(eq(channelConnection.workspaceId, workspaceId), eq(channelConnection.platform, "instagram")))
    .orderBy(desc(channelConnection.createdAt), desc(channelConnection.externalId))
    .limit(1);

  return (
    <main className="max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">Instagram</h2>
        {ig === "connected" && <p className="mb-2 text-sm text-green-700">Instagram connected.</p>}
        {ig === "denied" && <p className="mb-2 text-sm text-red-600">Instagram permission was not granted.</p>}
        {conn ? (
          <div className="text-sm">
            <p>
              Connected as <span className="font-medium">@{conn.username}</span> ({conn.status})
            </p>
            {conn.tokenExpiresAt && (
              <p className="text-zinc-500">Access token expires {conn.tokenExpiresAt.toLocaleDateString()}</p>
            )}
            <a href="/api/instagram/connect" className="mt-3 inline-block text-sm underline">
              Reconnect
            </a>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-600">
              Connect an Instagram professional (Business or Creator) account to receive comments and messages.
            </p>
            <a
              href="/api/instagram/connect"
              className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Connect Instagram
            </a>
          </>
        )}
      </section>
      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="mb-1 font-semibold">Webhook</h2>
        <p className="text-zinc-600">In your Meta app, set the Instagram webhook callback URL to:</p>
        <code className="mt-1 block rounded bg-zinc-100 px-2 py-1">{env().BETTER_AUTH_URL}/api/webhooks/instagram</code>
      </section>
    </main>
  );
}
