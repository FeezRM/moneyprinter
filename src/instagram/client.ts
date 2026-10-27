import { z } from "zod";
import type { Message, QuickReply } from "@/flow/types";
import { env } from "@/lib/env";

const GRAPH = "https://graph.instagram.com";

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

const graphErrorSchema = z.object({
  error: z.object({ message: z.string(), code: z.number().optional(), error_subcode: z.number().optional() }),
});

async function graphFetch<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = graphErrorSchema.safeParse(body);
    throw e.success
      ? new GraphApiError(e.data.error.message, res.status, e.data.error.code, e.data.error.error_subcode)
      : new GraphApiError(`Instagram API ${res.status}`, res.status);
  }
  return schema.parse(body);
}

// ---------- OAuth (Business Login for Instagram) ----------

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
] as const;

export function authorizeUrl(redirectUri: string, state: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", env().INSTAGRAM_APP_ID);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

// Docs show both a flat body and one wrapped in `data: [...]`; accept either.
const shortTokenSchema = z
  .union([
    z.object({ access_token: z.string(), user_id: z.union([z.string(), z.number()]), permissions: z.union([z.string(), z.array(z.string())]).optional() }),
    z.object({
      data: z
        .array(z.object({ access_token: z.string(), user_id: z.union([z.string(), z.number()]), permissions: z.union([z.string(), z.array(z.string())]).optional() }))
        .min(1),
    }),
  ])
  .transform((v) => ("data" in v ? v.data[0] : v));

export async function exchangeCode(code: string, redirectUri: string) {
  const form = new URLSearchParams({
    client_id: env().INSTAGRAM_APP_ID,
    client_secret: env().INSTAGRAM_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: code.replace(/#_$/, ""),
  });
  const t = await graphFetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form }, shortTokenSchema);
  const permissions = typeof t.permissions === "string" ? t.permissions.split(",") : (t.permissions ?? []);
  return { accessToken: t.access_token, permissions };
}

const longTokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });

export async function exchangeForLongLived(shortToken: string) {
  const u = new URL(`${GRAPH}/access_token`);
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", env().INSTAGRAM_APP_SECRET);
  u.searchParams.set("access_token", shortToken);
  const t = await graphFetch(u.toString(), { method: "GET" }, longTokenSchema);
  return { accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
}

export async function refreshLongLived(token: string) {
  const u = new URL(`${GRAPH}/refresh_access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  const t = await graphFetch(u.toString(), { method: "GET" }, longTokenSchema);
  return { accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
}

// `user_id` is the professional account id that appears as webhook `entry[].id`.
const meSchema = z.object({ user_id: z.union([z.string(), z.number()]).transform(String), username: z.string() });

export async function getMe(token: string) {
  const u = new URL(`${GRAPH}/${env().INSTAGRAM_GRAPH_VERSION}/me`);
  u.searchParams.set("fields", "user_id,username");
  return graphFetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } }, meSchema);
}

export const WEBHOOK_FIELDS = ["comments", "messages", "messaging_postbacks"] as const;

export async function subscribeWebhooks(token: string) {
  const u = new URL(`${GRAPH}/${env().INSTAGRAM_GRAPH_VERSION}/me/subscribed_apps`);
  u.searchParams.set("subscribed_fields", WEBHOOK_FIELDS.join(","));
  await graphFetch(u.toString(), { method: "POST", headers: { Authorization: `Bearer ${token}` } }, z.object({ success: z.boolean() }));
}

// ---------- Messaging ----------

export type Recipient = { id: string } | { comment_id: string };

type GraphButton = { type: "web_url"; url: string; title: string } | { type: "postback"; payload: string; title: string };

export type GraphMessage =
  | { text: string; quick_replies?: GraphQuickReply[] }
  | {
      attachment:
        | { type: "template"; payload: { template_type: "button"; text: string; buttons: GraphButton[] } }
        | { type: "image"; payload: { url: string } };
      quick_replies?: GraphQuickReply[];
    };

type GraphQuickReply = { content_type: "text"; title: string; payload: string };

// Maps a flow message to the Graph API shape. Text with buttons uses the button
// template (text <= 640 chars, 1-3 buttons); `payloadFor` encodes reply routing.
export function renderMessage(message: Message, quickReplies: QuickReply[], payloadFor: (replyId: string) => string): GraphMessage {
  const qr = quickReplies.length
    ? quickReplies.map((q) => ({ content_type: "text" as const, title: q.title, payload: payloadFor(q.id) }))
    : undefined;

  if (message.kind === "image") {
    return { attachment: { type: "image", payload: { url: message.url } }, ...(qr && { quick_replies: qr }) };
  }
  if (message.buttons.length === 0) {
    return { text: message.text, ...(qr && { quick_replies: qr }) };
  }
  if (message.text.length > 640) {
    throw new Error("Instagram button messages are limited to 640 characters");
  }
  const buttons: GraphButton[] = message.buttons.map((b) =>
    b.type === "url" ? { type: "web_url", url: b.url, title: b.title } : { type: "postback", payload: payloadFor(b.id), title: b.title },
  );
  return {
    attachment: { type: "template", payload: { template_type: "button", text: message.text, buttons } },
    ...(qr && { quick_replies: qr }),
  };
}

const sendResultSchema = z.object({ recipient_id: z.string().optional(), message_id: z.string() });

export async function sendMessage(params: { accountId: string; token: string; recipient: Recipient; message: GraphMessage }) {
  return graphFetch(
    `${GRAPH}/${env().INSTAGRAM_GRAPH_VERSION}/${params.accountId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${params.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: params.recipient, message: params.message }),
    },
    sendResultSchema,
  );
}

export async function replyToComment(params: { commentId: string; token: string; message: string }) {
  const u = new URL(`${GRAPH}/${env().INSTAGRAM_GRAPH_VERSION}/${params.commentId}/replies`);
  u.searchParams.set("message", params.message);
  return graphFetch(u.toString(), { method: "POST", headers: { Authorization: `Bearer ${params.token}` } }, z.object({ id: z.string() }));
}
