import Link from "next/link";
import { Suspense } from "react";
import { requireWorkspace } from "@/lib/session";

const NAV = [
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/automations", label: "Automations" },
  { href: "/app/contacts", label: "Contacts" },
  { href: "/app/settings", label: "Settings" },
] as const;

// Every page here verifies the signed session cookie and reads per-user data on each
// request, so navigations into /app are allowed to block (`loading.tsx` shows meanwhile).
export const instant = false;

// The sidebar is a static shell; everything that reads the session renders inside
// Suspense so the shell can be prerendered with Cache Components.
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 p-4">
        <div className="mb-6">
          <div className="text-sm font-semibold">Moneyprinter</div>
          <Suspense fallback={<div className="h-4" />}>
            <WorkspaceName />
          </Suspense>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-2 py-1.5 text-sm hover:bg-zinc-200">
              {n.label}
            </Link>
          ))}
        </nav>
        <Suspense>
          <UserEmail />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="p-8 text-sm text-zinc-500">Loading…</div>}>{children}</Suspense>
      </div>
    </div>
  );
}

async function WorkspaceName() {
  const { workspaceName } = await requireWorkspace();
  return <div className="truncate text-xs text-zinc-500">{workspaceName}</div>;
}

async function UserEmail() {
  const { user } = await requireWorkspace();
  return <div className="mt-auto truncate text-xs text-zinc-500">{user.email}</div>;
}
