import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { automation, channelConnection, contact, messageLog, thread, trigger, workspace } from "@/db/schema";
import type { Flow } from "@/flow/types";
import type { GraphMessage, Recipient } from "@/instagram/client";
import type { NormalizedEvent } from "@/instagram/webhook";
import { encryptSecret } from "@/lib/crypto";
import { findInstagramConnection } from "./channels";
import { handleEvent, type InboundDeps } from "./inbound";
import { ReplyError, sendAgentReply } from "./inbox";

const ACC = "17841400000000002";
const pos = { x: 0, y: 0 };

type Sent = { recipient: Recipient; message: GraphMessage };

function fakeMessenger() {
  const sent: Sent[] = [];
  let n = 0;
  const messenger: InboundDeps["messenger"] = {
    send: async (_c, recipient, message) => (sent.push({ recipient, message }), { message_id: `out-${++n}` }),
  };
  return { messenger, sent };
}

async function seed(opts: { autoReply?: string } = {}) {
  const [w] = await db.insert(workspace).values({ name: "test" }).returning();
  await db.insert(channelConnection).values({
    workspaceId: w.id,
    platform: "instagram",
    externalId: ACC,
    accessTokenEnc: encryptSecret("token"),
  });
  if (opts.autoReply) {
    const flow: Flow = {
      version: 1,
      startNodeId: "m",
      nodes: [
        {
          id: "m",
          type: "send_message",
          position: pos,
          privateReply: false,
          messages: [{ kind: "text", text: opts.autoReply, buttons: [] }],
          quickReplies: [],
          next: null,
        },
      ],
    };
    const [a] = await db
      .insert(automation)
      .values({ workspaceId: w.id, name: "a", draft: flow, published: flow, publishedVersion: 1 })
      .returning();
    await db.insert(trigger).values({
      workspaceId: w.id,
      automationId: a.id,
      config: { type: "ig_default_reply" },
      type: "ig_default_reply",
      active: true,
    });
  }
  const conn = (await findInstagramConnection(db, ACC))!;
  return { workspaceId: w.id, conn };
}

const dm = (mid: string, text: string, at = new Date()): NormalizedEvent => ({ kind: "dm", accountId: ACC, senderId: "U-1", mid, text, at });

beforeEach(async () => {
  await db.execute(sql`truncate workspace cascade`);
});

describe("thread upsert", () => {
  it("opens an unread thread on an inbound DM and keeps it unread after the automated reply", async () => {
    await seed({ autoReply: "Thanks, we'll be in touch" });
    const { messenger, sent } = fakeMessenger();
    await handleEvent(db, { messenger }, dm("m-1", "hello"));

    expect(sent).toHaveLength(1);
    const threads = await db.select().from(thread);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ status: "open", unread: true, lastMessageText: "Thanks, we'll be in touch" });
  });

  it("does not create a second thread on redelivery or a later message", async () => {
    await seed();
    const { messenger } = fakeMessenger();
    await handleEvent(db, { messenger }, dm("m-1", "hello"));
    await handleEvent(db, { messenger }, dm("m-1", "hello"));
    await handleEvent(db, { messenger }, dm("m-2", "anyone there?"));
    const threads = await db.select().from(thread);
    expect(threads).toHaveLength(1);
    expect(threads[0].lastMessageText).toBe("anyone there?");
  });

  it("reopens a closed thread and marks it unread when the contact writes again", async () => {
    await seed();
    const { messenger } = fakeMessenger();
    await handleEvent(db, { messenger }, dm("m-1", "hello"));
    await db.update(thread).set({ status: "closed", unread: false });

    await handleEvent(db, { messenger }, dm("m-2", "one more thing"));
    const [t] = await db.select().from(thread);
    expect(t).toMatchObject({ status: "open", unread: true });
  });

  it("logs the message but skips automations while the contact is paused", async () => {
    await seed({ autoReply: "bot reply" });
    const { messenger, sent } = fakeMessenger();
    await handleEvent(db, { messenger }, dm("m-1", "hello"));
    await db.update(contact).set({ automationPausedUntil: new Date(Date.now() + 60 * 60_000) });

    await handleEvent(db, { messenger }, dm("m-2", "talk to a human"));
    expect(sent).toHaveLength(1);
    const [t] = await db.select().from(thread);
    expect(t.lastMessageText).toBe("talk to a human");
  });
});

describe("agent reply", () => {
  it("sends inside the 24-hour window, logs it as a human message and marks the thread read", async () => {
    const { workspaceId, conn } = await seed();
    const { messenger, sent } = fakeMessenger();
    await handleEvent(db, { messenger }, dm("m-1", "hello"));
    const [t] = await db.select().from(thread);

    await sendAgentReply(db, { messenger, conn }, { workspaceId, threadId: t.id, text: "Hi! How can I help?" });
    expect(sent).toEqual([{ recipient: { id: "U-1" }, message: { text: "Hi! How can I help?" } }]);
    const [out] = await db.select().from(messageLog).where(eq(messageLog.direction, "out"));
    expect(out).toMatchObject({ text: "Hi! How can I help?", flowRunId: null, externalId: "out-1" });
    const [after] = await db.select().from(thread);
    expect(after).toMatchObject({ unread: false, lastMessageText: "Hi! How can I help?" });
  });

  it("refuses to send once the window has closed", async () => {
    const { workspaceId, conn } = await seed();
    const { messenger, sent } = fakeMessenger();
    const sentAt = new Date(Date.now() - 25 * 60 * 60_000);
    await handleEvent(db, { messenger }, dm("m-1", "hello", sentAt));
    const [t] = await db.select().from(thread);
    // Late deliveries keep their original time in both the thread and the timeline.
    expect(t.lastMessageAt).toEqual(sentAt);
    const [inbound] = await db.select().from(messageLog);
    expect(inbound.createdAt).toEqual(sentAt);

    await expect(sendAgentReply(db, { messenger, conn }, { workspaceId, threadId: t.id, text: "sorry for the wait" })).rejects.toThrow(
      /24-hour messaging window is closed/,
    );
    expect(sent).toHaveLength(0);
    expect(await db.$count(messageLog, eq(messageLog.direction, "out"))).toBe(0);
  });

  it("refuses to DM a contact who has only commented", async () => {
    const { workspaceId, conn } = await seed();
    const { messenger, sent } = fakeMessenger();
    await handleEvent(db, { messenger }, {
      kind: "comment",
      accountId: ACC,
      commentId: "c-1",
      commenterId: "U-2",
      commenterUsername: "fan",
      mediaId: "M-1",
      text: "love this",
      isReply: false,
      at: new Date(),
    });
    const [t] = await db.select().from(thread);
    await expect(sendAgentReply(db, { messenger, conn }, { workspaceId, threadId: t.id, text: "hey" })).rejects.toBeInstanceOf(ReplyError);
    expect(sent).toHaveLength(0);
  });

  it("does not reach threads in another workspace", async () => {
    await seed();
    const { messenger, sent } = fakeMessenger();
    await handleEvent(db, { messenger }, dm("m-1", "hello"));
    const [t] = await db.select().from(thread);
    const [other] = await db.insert(workspace).values({ name: "other" }).returning();
    const conn = (await findInstagramConnection(db, ACC))!;

    await expect(sendAgentReply(db, { messenger, conn }, { workspaceId: other.id, threadId: t.id, text: "hi" })).rejects.toThrow(
      /not found/,
    );
    expect(sent).toHaveLength(0);
  });
});
