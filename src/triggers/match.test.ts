import { describe, expect, it } from "vitest";
import { matchesKeywordRule, selectTrigger, type CandidateTrigger } from "./match";
import { triggerConfigSchema } from "./types";

const t = (id: string, config: unknown): CandidateTrigger => ({ id, config: triggerConfigSchema.parse(config) });

describe("selectTrigger: comments", () => {
  const onPost = t("post", { type: "ig_comment", mediaId: "m1", includeKeywords: ["1k"], excludeKeywords: ["spam"] });
  const anyPost = t("any", { type: "ig_comment", mediaId: null });

  it("matches whole-word keywords on the configured post", () => {
    expect(selectTrigger({ kind: "comment", mediaId: "m1", text: "1K please!", isReply: false }, [onPost])?.id).toBe("post");
    expect(selectTrigger({ kind: "comment", mediaId: "m1", text: "21k", isReply: false }, [onPost])).toBeNull();
    expect(selectTrigger({ kind: "comment", mediaId: "m2", text: "1k", isReply: false }, [onPost])).toBeNull();
  });

  it("honours exclude keywords and root-only", () => {
    expect(selectTrigger({ kind: "comment", mediaId: "m1", text: "1k spam", isReply: false }, [onPost])).toBeNull();
    expect(selectTrigger({ kind: "comment", mediaId: "m1", text: "1k", isReply: true }, [onPost])).toBeNull();
  });

  it("falls through to an any-post trigger", () => {
    expect(selectTrigger({ kind: "comment", mediaId: "m9", text: "hello", isReply: false }, [onPost, anyPost])?.id).toBe("any");
  });
});

describe("selectTrigger: DMs", () => {
  const kw = t("kw", { type: "ig_dm_keyword", rules: [{ match: "contains", keywords: ["price"] }] });
  const fallback = t("default", { type: "ig_default_reply" });

  it("prefers a keyword match over the default reply regardless of order", () => {
    expect(selectTrigger({ kind: "dm", text: "what's the price?" }, [fallback, kw])?.id).toBe("kw");
    expect(selectTrigger({ kind: "dm", text: "hey" }, [fallback, kw])?.id).toBe("default");
  });

  it("routes story replies and mentions only to their trigger types", () => {
    const story = t("story", { type: "ig_story_reply" });
    const mention = t("mention", { type: "ig_story_mention" });
    expect(selectTrigger({ kind: "story_reply", text: "🔥" }, [kw, story])?.id).toBe("story");
    expect(selectTrigger({ kind: "story_mention" }, [kw, mention])?.id).toBe("mention");
  });
});

describe("matchesKeywordRule", () => {
  it("supports is / starts_with / phrase contains", () => {
    expect(matchesKeywordRule({ match: "is", keywords: ["Start"] }, "  start ")).toBe(true);
    expect(matchesKeywordRule({ match: "starts_with", keywords: ["link"] }, "link please")).toBe(true);
    expect(matchesKeywordRule({ match: "contains", keywords: ["free guide"] }, "send the FREE  guide")).toBe(true);
  });
});
