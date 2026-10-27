import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Meta signs the raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`.
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Payload shapes, per Meta's Instagram webhook docs. Unknown fields are ignored
// so new Meta additions don't break intake.
const messagingSchema = z.object({
  sender: z.object({ id: z.string() }),
  recipient: z.object({ id: z.string() }),
  timestamp: z.number(),
  message: z
    .object({
      mid: z.string(),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      quick_reply: z.object({ payload: z.string() }).optional(),
      reply_to: z.object({ story: z.object({ id: z.string().optional(), url: z.string().optional() }).optional() }).optional(),
      attachments: z.array(z.object({ type: z.string() })).optional(),
    })
    .optional(),
  postback: z.object({ mid: z.string().optional(), title: z.string().optional(), payload: z.string() }).optional(),
});

const commentValueSchema = z.object({
  id: z.string(),
  text: z.string().default(""),
  from: z.object({ id: z.string(), username: z.string().optional() }),
  media: z.object({ id: z.string() }),
  parent_id: z.string().optional(),
});

export const webhookBodySchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number(),
      messaging: z.array(z.unknown()).optional(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
    }),
  ),
});

export type NormalizedEvent =
  | { kind: "dm"; accountId: string; senderId: string; mid: string; text: string; at: Date }
  | { kind: "story_reply"; accountId: string; senderId: string; mid: string; text: string; at: Date }
  | { kind: "story_mention"; accountId: string; senderId: string; mid: string; at: Date }
  | { kind: "reply_payload"; accountId: string; senderId: string; mid: string | null; payload: string; text: string; at: Date }
  | {
      kind: "comment";
      accountId: string;
      commentId: string;
      commenterId: string;
      commenterUsername: string | null;
      mediaId: string;
      text: string;
      isReply: boolean;
      at: Date;
    };

// Flattens a webhook body into the events the app acts on. Echoes of our own
// messages, deletions, and comments made by the account itself are dropped.
export function normalizeWebhook(body: unknown): NormalizedEvent[] {
  const parsed = webhookBodySchema.safeParse(body);
  if (!parsed.success || parsed.data.object !== "instagram") return [];
  const out: NormalizedEvent[] = [];

  for (const entry of parsed.data.entry) {
    const accountId = entry.id;

    for (const raw of entry.messaging ?? []) {
      const m = messagingSchema.safeParse(raw);
      if (!m.success) continue;
      const { sender, timestamp, message, postback } = m.data;
      const at = new Date(timestamp);
      if (sender.id === accountId) continue;

      if (postback) {
        out.push({ kind: "reply_payload", accountId, senderId: sender.id, mid: postback.mid ?? null, payload: postback.payload, text: postback.title ?? "", at });
        continue;
      }
      if (!message || message.is_echo || message.is_deleted) continue;
      if (message.quick_reply) {
        out.push({ kind: "reply_payload", accountId, senderId: sender.id, mid: message.mid, payload: message.quick_reply.payload, text: message.text ?? "", at });
      } else if (message.attachments?.some((a) => a.type === "story_mention")) {
        out.push({ kind: "story_mention", accountId, senderId: sender.id, mid: message.mid, at });
      } else if (message.reply_to?.story) {
        out.push({ kind: "story_reply", accountId, senderId: sender.id, mid: message.mid, text: message.text ?? "", at });
      } else {
        out.push({ kind: "dm", accountId, senderId: sender.id, mid: message.mid, text: message.text ?? "", at });
      }
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const c = commentValueSchema.safeParse(change.value);
      if (!c.success || c.data.from.id === accountId) continue;
      out.push({
        kind: "comment",
        accountId,
        commentId: c.data.id,
        commenterId: c.data.from.id,
        commenterUsername: c.data.from.username ?? null,
        mediaId: c.data.media.id,
        text: c.data.text,
        isReply: Boolean(c.data.parent_id),
        at: new Date(entry.time * (entry.time < 1e12 ? 1000 : 1)),
      });
    }
  }
  return out;
}

// Button / quick-reply payloads carry the run and the reply that was tapped.
export function encodeReplyPayload(runId: string, nodeId: string, replyId: string): string {
  return `r1|${runId}|${nodeId}|${replyId}`;
}

export function decodeReplyPayload(payload: string): { runId: string; nodeId: string; replyId: string } | null {
  const parts = payload.split("|");
  if (parts.length !== 4 || parts[0] !== "r1") return null;
  const [, runId, nodeId, replyId] = parts;
  return runId && nodeId && replyId ? { runId, nodeId, replyId } : null;
}
