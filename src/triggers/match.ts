import type { KeywordRule, TriggerConfig } from "./types";

export type InboundEvent =
  | { kind: "comment"; mediaId: string; text: string; isReply: boolean }
  | { kind: "dm"; text: string }
  | { kind: "story_reply"; text: string }
  | { kind: "story_mention" };

export type CandidateTrigger = { id: string; config: TriggerConfig };

// Returns the trigger that should start a run, or null. Order of precedence for
// DMs: specific keyword triggers first, then the default reply as a fallback.
// Among equally specific triggers, the earliest in `candidates` wins.
export function selectTrigger(event: InboundEvent, candidates: CandidateTrigger[]): CandidateTrigger | null {
  switch (event.kind) {
    case "comment":
      return candidates.find((t) => t.config.type === "ig_comment" && matchesComment(t.config, event)) ?? null;
    case "story_reply":
      return (
        candidates.find(
          (t) =>
            t.config.type === "ig_story_reply" &&
            (t.config.rules.length === 0 || t.config.rules.some((r) => matchesKeywordRule(r, event.text))),
        ) ?? null
      );
    case "story_mention":
      return candidates.find((t) => t.config.type === "ig_story_mention") ?? null;
    case "dm":
      return (
        candidates.find(
          (t) => t.config.type === "ig_dm_keyword" && t.config.rules.some((r) => matchesKeywordRule(r, event.text)),
        ) ??
        candidates.find((t) => t.config.type === "ig_default_reply") ??
        null
      );
  }
}

function matchesComment(
  config: Extract<TriggerConfig, { type: "ig_comment" }>,
  event: Extract<InboundEvent, { kind: "comment" }>,
): boolean {
  if (config.mediaId !== null && config.mediaId !== event.mediaId) return false;
  if (config.rootCommentsOnly && event.isReply) return false;
  const words = tokenize(event.text);
  const text = normalize(event.text);
  const hit = (kw: string) => containsKeyword(text, words, kw);
  if (config.excludeKeywords.some(hit)) return false;
  return config.includeKeywords.length === 0 || config.includeKeywords.some(hit);
}

export function matchesKeywordRule(rule: KeywordRule, rawText: string): boolean {
  const text = normalize(rawText);
  const words = tokenize(rawText);
  return rule.keywords.some((kw) => {
    const k = normalize(kw);
    switch (rule.match) {
      case "is":
        return text === k;
      case "starts_with":
        return text.startsWith(k);
      case "contains":
        return containsKeyword(text, words, kw);
    }
  });
}

// Single-word keywords match whole words ("1k" matches "1k pls" but not "21k");
// multi-word keywords match as a phrase.
function containsKeyword(text: string, words: Set<string>, keyword: string): boolean {
  const k = normalize(keyword);
  return k.includes(" ") ? text.includes(k) : words.has(k);
}

function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(/[^\p{L}\p{N}_]+/u).filter(Boolean));
}
