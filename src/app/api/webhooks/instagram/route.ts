import { createHash } from "node:crypto";
import { db } from "@/db";
import { webhookEvent } from "@/db/schema";
import { verifySignature } from "@/instagram/webhook";
import { enqueue } from "@/jobs/queue";
import { env } from "@/lib/env";

// Meta's subscription handshake.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === env().INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

// Store-then-ack: persist the raw delivery and enqueue processing in one
// transaction, so Meta gets a fast 200 and nothing is lost if the worker is down.
export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), env().INSTAGRAM_APP_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const bodyHash = createHash("sha256").update(raw).digest("hex");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(webhookEvent)
      .values({ platform: "instagram", bodyHash, body })
      .onConflictDoNothing()
      .returning({ id: webhookEvent.id });
    if (row) await enqueue(tx, "process_webhook", { webhookEventId: row.id });
  });

  return new Response("ok", { status: 200 });
}
