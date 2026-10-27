"use client";

import { useEffect, useState, useTransition } from "react";
import { addNote, replyToThread, type ActionResult } from "../actions";

// Opening an unread thread marks it read. Done from the client so that prefetching
// or re-rendering the page never counts as the agent having seen it.
export function MarkRead({ action }: { action: () => Promise<void> }) {
  useEffect(() => {
    action();
  }, [action]);
  return null;
}

export function Composer({ threadId, windowOpen }: { threadId: string; windowOpen: boolean }) {
  const [mode, setMode] = useState<"reply" | "note">(windowOpen ? "reply" : "note");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const blocked = mode === "reply" && !windowOpen;

  const submit = () => {
    if (blocked || pending || !text.trim()) return;
    startTransition(async () => {
      const r = mode === "reply" ? await replyToThread(threadId, text) : await addNote(threadId, text);
      setResult(r);
      if (r.ok) setText("");
    });
  };

  return (
    <div className={`border-t border-zinc-200 p-4 ${mode === "note" ? "bg-amber-50" : "bg-white"}`}>
      <div className="mb-2 flex gap-1 text-sm">
        {(["reply", "note"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setResult(null);
            }}
            className={`rounded-md px-3 py-1 ${mode === m ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            {m === "reply" ? "Reply" : "Internal note"}
          </button>
        ))}
      </div>
      {blocked && (
        <div role="status" className="mb-2 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          <span className="font-medium">Messaging window closed.</span> Instagram only allows replies within 24 hours of the
          contact&apos;s last message. You can reply once they message you again, or leave an internal note for your team.
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={blocked}
          rows={2}
          maxLength={1000}
          placeholder={mode === "reply" ? "Write a reply… (Enter to send, Shift+Enter for a new line)" : "Write a note only your team can see…"}
          className="min-h-10 flex-1 resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100"
        />
        <button
          disabled={blocked || pending || !text.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "…" : mode === "reply" ? "Send" : "Add note"}
        </button>
      </form>
      {result && !result.ok && <p className="mt-2 text-sm text-red-600">{result.errors.join(", ")}</p>}
    </div>
  );
}
