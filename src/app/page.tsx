import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Turn Instagram comments and DMs into customers.</h1>
      <p className="text-lg text-zinc-600">
        Comment-to-DM, keyword replies, story automations and a visual flow builder. Free for your first 1,000
        contacts a month.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
          Start free
        </Link>
        <Link href="/login" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100">
          Sign in
        </Link>
      </div>
    </main>
  );
}
