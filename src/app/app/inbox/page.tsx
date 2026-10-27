import { requireWorkspace } from "@/lib/session";
import { parseFilter } from "./shared";
import { ThreadList } from "./thread-list";

// Reads the session on every request; see app/app/layout.tsx.
export const instant = false;

export default async function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  const { workspaceId, user } = await requireWorkspace();
  const filter = parseFilter(await searchParams);
  return (
    <main className="flex h-screen min-h-0">
      <ThreadList workspaceId={workspaceId} userId={user.id} filter={filter} />
      <div className="flex flex-1 items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        Select a conversation
      </div>
    </main>
  );
}
