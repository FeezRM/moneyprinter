"use client";

import type { KeywordRule, TriggerConfig } from "@/triggers/types";
import { Add, Check, input, Remove, replaceAt } from "./node-editors";

const LABELS: Record<TriggerConfig["type"], string> = {
  ig_comment: "User comments on a post or reel",
  ig_dm_keyword: "User sends a DM keyword",
  ig_story_reply: "User replies to a story",
  ig_story_mention: "User mentions you in a story",
  ig_default_reply: "Default reply (no keyword matched)",
};

export function triggerSummary(t: TriggerConfig): string {
  switch (t.type) {
    case "ig_comment":
      return `${t.mediaId ? "Comment on a specific post" : "Comment on any post"}${t.includeKeywords.length ? ` containing ${t.includeKeywords.join(", ")}` : ""}`;
    case "ig_dm_keyword":
      return `DM ${t.rules.map((r) => `${r.match.replace("_", " ")} ${r.keywords.join("/")}`).join(" or ")}`;
    case "ig_story_reply":
      return t.rules.length ? `Story reply matching ${t.rules.flatMap((r) => r.keywords).join(", ")}` : "Any story reply";
    case "ig_story_mention":
      return "Story mention";
    case "ig_default_reply":
      return "Default reply";
  }
}

function defaultTrigger(type: TriggerConfig["type"]): TriggerConfig {
  switch (type) {
    case "ig_comment":
      return { type, mediaId: null, includeKeywords: [], excludeKeywords: [], rootCommentsOnly: true, publicReplies: [] };
    case "ig_dm_keyword":
      return { type, rules: [{ match: "contains", keywords: ["info"] }] };
    case "ig_story_reply":
      return { type, rules: [] };
    case "ig_story_mention":
    case "ig_default_reply":
      return { type };
  }
}

// Edits a string list as comma-separated text (or one item per line), committing on
// blur. Keyed by its value so it resets when the list changes from elsewhere.
function ListInput({ value, onChange, multiline }: { value: string[]; onChange: (v: string[]) => void; multiline?: boolean }) {
  const sep = multiline ? "\n" : ",";
  const commit = (raw: string) => onChange(raw.split(sep).map((x) => x.trim()).filter(Boolean));
  const key = value.join(sep);
  const shared = { defaultValue: value.join(multiline ? "\n" : ", "), className: input };
  return multiline ? (
    <textarea key={key} rows={3} {...shared} onBlur={(e) => commit(e.target.value)} />
  ) : (
    <input key={key} {...shared} onBlur={(e) => commit(e.target.value)} />
  );
}

export function TriggerEditor({ triggers, onChange }: { triggers: TriggerConfig[]; onChange: (t: TriggerConfig[]) => void }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <h2 className="font-semibold">Triggers</h2>
      <p className="text-xs text-zinc-500">The automation starts when any of these happens. Changes go live when you publish.</p>
      {triggers.map((t, i) => {
        const set = (nt: TriggerConfig) => onChange(replaceAt(triggers, i, nt));
        return (
          <div key={i} className="flex flex-col gap-2 rounded border border-zinc-200 p-2">
            <div className="flex items-center justify-between font-medium">
              {LABELS[t.type]}
              <Remove onClick={() => onChange(triggers.filter((_, j) => j !== i))} />
            </div>
            {t.type === "ig_comment" && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-600">Post or reel ID (blank = any post)</span>
                  <input value={t.mediaId ?? ""} onChange={(e) => set({ ...t, mediaId: e.target.value.trim() || null })} className={input} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-600">Only comments containing (comma-separated; blank = any comment)</span>
                  <ListInput value={t.includeKeywords} onChange={(v) => set({ ...t, includeKeywords: v })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-600">Ignore comments containing</span>
                  <ListInput value={t.excludeKeywords} onChange={(v) => set({ ...t, excludeKeywords: v })} />
                </label>
                <Check label="Ignore replies to other comments" checked={t.rootCommentsOnly} onChange={(v) => set({ ...t, rootCommentsOnly: v })} />
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-600">Public replies to the comment, one per line (one is picked at random)</span>
                  <ListInput multiline value={t.publicReplies} onChange={(v) => set({ ...t, publicReplies: v })} />
                </label>
              </>
            )}
            {(t.type === "ig_dm_keyword" || t.type === "ig_story_reply") && (
              <RulesEditor rules={t.rules} allowEmpty={t.type === "ig_story_reply"} onChange={(rules) => set({ ...t, rules } as TriggerConfig)} />
            )}
          </div>
        );
      })}
      <select
        value=""
        onChange={(e) => e.target.value && onChange([...triggers, defaultTrigger(e.target.value as TriggerConfig["type"])])}
        className={input}
      >
        <option value="">+ Add trigger…</option>
        {(Object.keys(LABELS) as TriggerConfig["type"][]).map((k) => (
          <option key={k} value={k}>
            {LABELS[k]}
          </option>
        ))}
      </select>
    </div>
  );
}

function RulesEditor({ rules, allowEmpty, onChange }: { rules: KeywordRule[]; allowEmpty: boolean; onChange: (r: KeywordRule[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r, i) => (
        <div key={i} className="flex gap-2">
          <select value={r.match} onChange={(e) => onChange(replaceAt(rules, i, { ...r, match: e.target.value as KeywordRule["match"] }))} className={`${input} max-w-32`}>
            <option value="is">is</option>
            <option value="contains">contains</option>
            <option value="starts_with">starts with</option>
          </select>
          <ListInput value={r.keywords} onChange={(v) => onChange(replaceAt(rules, i, { ...r, keywords: v }))} />
          {(allowEmpty || rules.length > 1) && <Remove onClick={() => onChange(rules.filter((_, j) => j !== i))} />}
        </div>
      ))}
      <Add label="Add keyword rule" onClick={() => onChange([...rules, { match: "contains", keywords: ["keyword"] }])} />
    </div>
  );
}
