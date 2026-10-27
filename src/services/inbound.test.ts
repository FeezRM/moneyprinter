import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { automation, channelConnection, contact, flowRun, messageLog, trigger, workspace } from "@/db/schema";
import type { Flow } from "@/flow/types";
import type { GraphMessage, Recipient } from "@/instagram/client";
import { encodeReplyPayload, type NormalizedEvent } from "@/instagram/webhook";
import { encryptSecret } from "@/lib/crypto";
import type { TriggerConfig } from "@/triggers/types";
import { handleEvent, type InboundDeps } from "./inbound";

const ACC = "17841400000000001";
const pos = { x: 0, y: 0 };

type Sent = { recipient: Recipient; message: GraphMessage };

function fakeDeps(now = new Date()) {
  const sent: Sent[] = [];
  const publicReplies: string[] = [];
  let n = 0;
  const deps: InboundDeps = {
    now,
    random: () => 0,
    messenger: { send: async (_c, recipient, message) => (sent.push({ recipient, message }), { message_id: `out-${++n}` }) },
    publicReply: async (_c, _id, text) => void publicReplies.push(text),
  };
  return { deps, sent, publicReplies };
}

async function seed(flow: Flow, config: TriggerConfig) {
  const [w] = await db.insert(workspace).values({ name: "test" }).returning();
  await db.insert(channelConnection).values({
    workspaceId: w.id,
    platform: "instagram",
    externalId: ACC,
    accessTokenEnc: encryptSecret("token"),
  });
  const [a] = await db
    .insert(automation)
    .values({ workspaceId: w.id, name: "a", draft: flow, published: flow, publishedVersion: 1 })
    .returning();
  await db.insert(trigger).values({ workspaceId: w.id, automationId: a.id, config, type: config.type, active: true });
  return { workspaceId: w.id, automationId: a.id };
}

const commentEvent = (over: Partial<Extract<NormalizedEvent, { kind: "comment" }>> = {}): NormalizedEvent => ({
  kind: "comment",
  accountId: ACC,
  commentId: "c-1",
  commenterId: "U-1",
  commenterUsername: "fan",
  mediaId: "M-1",
  text: "1k please",
  isReply: false,
  at: new Date(),
  ...over,
});

beforeEach(async () => {
  await db.execute(sql`truncate workspace cascade`);
});

describe("comment-to-DM", () => {
  const flow: Flow = {
    version: 1,
    startNodeId: "pr",
    nodes: [
      {
        id: "pr",
        type: "send_message",
        position: pos,
        privateReply: true,
        messages: [{ kind: "text", text: "Here's your link 👇", buttons: [{ id: "b1", type: "node", title: "Send it", target: "link" }] }],
        quickReplies: [],
        next: null,
      },
      {
        id: "link",
        type: "send_message",
        position: pos,
        privateReply: false,
        messages: [{ kind: "text", text: "https://example.com/guide", buttons: [] }],
        quickReplies: [],
        next: "tag",
      },
      { id: "tag", type: "actions", position: pos, actions: [{ type: "add_tag", tag: "lead" }], next: null },
    ],
  };
  const config: TriggerConfig = {
    type: "ig_comment",
    mediaId: "M-1",
    includeKeywords: ["1k"],
    excludeKeywords: [],
    rootCommentsOnly: true,
    publicReplies: ["Sent you a DM!"],
  };

  it("sends a private reply with a button, then continues the run when it is tapped", async () => {
    await seed(flow, config);
    const { deps, sent, publicReplies } = fakeDeps();

    await handleEvent(db, deps, commentEvent());
    expect(publicReplies).toEqual(["Sent you a DM!"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].recipient).toEqual({ comment_id: "c-1" });
    const [run] = await db.select().from(flowRun);
    expect(run.status).toBe("waiting_input");

    // The commenter taps the button: a postback opens the 24h window and resumes the run.
    await handleEvent(db, deps, {
      kind: "reply_payload",
      accountId: ACC,
      senderId: "U-1",
      mid: "pb-1",
      payload: encodeReplyPayload(run.id, "pr", "b1"),
      text: "Send it",
      at: new Date(),
    });
    expect(sent).toHaveLength(2);
    expect(sent[1].recipient).toEqual({ id: "U-1" });
    expect(sent[1].message).toEqual({ text: "https://example.com/guide" });
    const [after] = await db.select().from(flowRun).where(eq(flowRun.id, run.id));
    expect(after.status).toBe("completed");
    const tags = await db.execute(sql`select t.name from contact_tag ct join tag t on t.id = ct.tag_id`);
    expect(tags.rows).toEqual([{ name: "lead" }]);
  });

  it("ignores a redelivered comment", async () => {
    await seed(flow, config);
    const { deps, sent } = fakeDeps();
    await handleEvent(db, deps, commentEvent());
    await handleEvent(db, deps, commentEvent());
    expect(sent).toHaveLength(1);
    expect(await db.$count(flowRun)).toBe(1);
  });

  it("does not trigger on non-matching comments", async () => {
    await seed(flow, config);
    const { deps, sent } = fakeDeps();
    await handleEvent(db, deps, commentEvent({ commentId: "c-2", text: "nice video" }));
    expect(sent).toHaveLength(0);
    // The commenter is still captured as a contact.
    expect(await db.$count(contact)).toBe(1);
  });
});

describe("messaging window", () => {
  it("fails the run rather than DMing a commenter who never messaged", async () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "m",
      nodes: [{ id: "m", type: "send_message", position: pos, privateReply: false, messages: [{ kind: "text", text: "hi", buttons: [] }], quickReplies: [], next: null }],
    };
    await seed(flow, { type: "ig_comment", mediaId: null, includeKeywords: [], excludeKeywords: [], rootCommentsOnly: true, publicReplies: [] });
    const { deps, sent } = fakeDeps();
    await handleEvent(db, deps, commentEvent());
    expect(sent).toHaveLength(0);
    const [run] = await db.select().from(flowRun);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/24-hour/);
  });
});

describe("DM keyword + delay", () => {
  it("replies inside the window and schedules the delayed step as a job", async () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "m",
      nodes: [
        { id: "m", type: "send_message", position: pos, privateReply: false, messages: [{ kind: "text", text: "Price is $9", buttons: [] }], quickReplies: [], next: "d" },
        { id: "d", type: "smart_delay", position: pos, amount: 23, unit: "hours", next: "f" },
        { id: "f", type: "send_message", position: pos, privateReply: false, messages: [{ kind: "text", text: "Still keen?", buttons: [] }], quickReplies: [], next: null },
      ],
    };
    await seed(flow, { type: "ig_dm_keyword", rules: [{ match: "contains", keywords: ["price"] }] });
    const { deps, sent } = fakeDeps();
    await handleEvent(db, deps, { kind: "dm", accountId: ACC, senderId: "U-9", mid: "dm-1", text: "what's the price", at: new Date() });

    expect(sent.map((s) => s.message)).toEqual([{ text: "Price is $9" }]);
    const [run] = await db.select().from(flowRun);
    expect(run).toMatchObject({ status: "waiting_delay", currentNodeId: "f" });
    const jobs = await db.execute(sql`select task_identifier, key from graphile_worker.jobs`);
    expect(jobs.rows).toEqual([{ task_identifier: "resume_run", key: `run:${run.id}` }]);
    expect(await db.$count(messageLog)).toBe(2);
  });
});
