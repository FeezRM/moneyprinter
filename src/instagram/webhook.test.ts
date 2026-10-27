import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeReplyPayload, encodeReplyPayload, normalizeWebhook, verifySignature } from "./webhook";

describe("verifySignature", () => {
  const body = '{"object":"instagram","entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");

  it("accepts a correct signature and rejects tampering", () => {
    expect(verifySignature(body, sig, "secret")).toBe(true);
    expect(verifySignature(body + " ", sig, "secret")).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "secret")).toBe(false);
    expect(verifySignature(body, "sha256=zz", "secret")).toBe(false);
  });
});

describe("normalizeWebhook", () => {
  const ACC = "17841400000000000";
  const msg = (message: object) => ({ sender: { id: "U1" }, recipient: { id: ACC }, timestamp: 1_760_000_000_000, message });

  it("classifies DMs, story replies, mentions, quick replies and postbacks; drops echoes", () => {
    const events = normalizeWebhook({
      object: "instagram",
      entry: [
        {
          id: ACC,
          time: 1_760_000_000,
          messaging: [
            msg({ mid: "m1", text: "price?" }),
            msg({ mid: "m2", text: "🔥", reply_to: { story: { id: "s1", url: "https://x" } } }),
            msg({ mid: "m3", attachments: [{ type: "story_mention", payload: { url: "https://x" } }] }),
            msg({ mid: "m4", text: "Yes", quick_reply: { payload: "r1|run|n|q" } }),
            msg({ mid: "m5", text: "me", is_echo: true }),
            { sender: { id: "U1" }, recipient: { id: ACC }, timestamp: 1, postback: { mid: "m6", title: "Go", payload: "r1|run|n|b" } },
            { sender: { id: ACC }, recipient: { id: "U1" }, timestamp: 1, message: { mid: "m7", text: "own" } },
          ],
        },
      ],
    });
    expect(events.map((e) => e.kind)).toEqual(["dm", "story_reply", "story_mention", "reply_payload", "reply_payload"]);
  });

  it("extracts comments and skips the account's own comments", () => {
    const events = normalizeWebhook({
      object: "instagram",
      entry: [
        {
          id: ACC,
          time: 1_760_000_000,
          changes: [
            { field: "comments", value: { id: "c1", text: "1k", from: { id: "U2", username: "fan" }, media: { id: "M1", media_product_type: "REELS" } } },
            { field: "comments", value: { id: "c2", text: "thanks", from: { id: ACC }, media: { id: "M1" }, parent_id: "c1" } },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "comment", commentId: "c1", commenterId: "U2", mediaId: "M1", isReply: false });
  });

  it("ignores non-instagram objects and malformed bodies", () => {
    expect(normalizeWebhook({ object: "page", entry: [] })).toEqual([]);
    expect(normalizeWebhook("nope")).toEqual([]);
  });
});

describe("reply payloads", () => {
  it("round-trips and rejects foreign payloads", () => {
    expect(decodeReplyPayload(encodeReplyPayload("run", "node", "btn"))).toEqual({ runId: "run", nodeId: "node", replyId: "btn" });
    expect(decodeReplyPayload("SOME_OTHER_APP")).toBeNull();
  });
});
