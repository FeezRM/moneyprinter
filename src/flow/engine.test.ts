import { describe, expect, it } from "vitest";
import { resolveReplyTarget, runUntilBlocked, type StepInput } from "./engine";
import { flowSchema, type Button, type Flow } from "./types";

const pos = { x: 0, y: 0 };
const now = new Date("2026-10-16T12:00:00Z");

function input(flow: Flow, overrides: Partial<StepInput> = {}): StepInput {
  return {
    flow: flowSchema.parse(flow),
    startNodeId: flow.startNodeId,
    contact: { tags: new Set(), fields: {} },
    now,
    splitChoices: {},
    privateReplyAvailable: false,
    ...overrides,
  };
}

const text = (t: string, buttons: Button[] = []) => ({ kind: "text" as const, text: t, buttons });

describe("runUntilBlocked", () => {
  it("sends messages along a linear path and completes", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "a",
      nodes: [
        { id: "a", type: "send_message", position: pos, privateReply: false, messages: [text("hi")], quickReplies: [], next: "b" },
        { id: "b", type: "actions", position: pos, actions: [{ type: "add_tag", tag: "lead" }], next: null },
      ],
    };
    const r = runUntilBlocked(input(flow));
    expect(r.effects.map((e) => e.type)).toEqual(["send", "action"]);
    expect(r.position).toEqual({ status: "completed", currentNodeId: null });
  });

  it("sends a comment run's first message as a private reply exactly once", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "a",
      nodes: [
        { id: "a", type: "send_message", position: pos, privateReply: true, messages: [text("link")], quickReplies: [], next: "b" },
        { id: "b", type: "send_message", position: pos, privateReply: true, messages: [text("again")], quickReplies: [], next: null },
      ],
    };
    const r = runUntilBlocked(input(flow, { privateReplyAvailable: true }));
    const sends = r.effects.filter((e) => e.type === "send");
    expect(sends.map((s) => s.asPrivateReply)).toEqual([true, false]);
    expect(r.privateReplyUsed).toBe(true);
  });

  it("parks on a delay and resumes at the following node", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "d",
      nodes: [
        { id: "d", type: "smart_delay", position: pos, amount: 23, unit: "hours", next: "m" },
        { id: "m", type: "send_message", position: pos, privateReply: false, messages: [text("follow up")], quickReplies: [], next: null },
      ],
    };
    const r = runUntilBlocked(input(flow));
    expect(r.effects).toEqual([]);
    expect(r.position).toEqual({
      status: "waiting_delay",
      currentNodeId: "m",
      resumeAt: new Date("2026-10-17T11:00:00Z"),
    });
  });

  it("lets earlier actions in the same pass influence conditions", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "t",
      nodes: [
        { id: "t", type: "actions", position: pos, actions: [{ type: "add_tag", tag: "vip" }], next: "c" },
        {
          id: "c",
          type: "condition",
          position: pos,
          branches: [
            {
              id: "b1",
              filter: { operator: "AND", groups: [{ operator: "AND", items: [{ kind: "tag", op: "has", tag: "vip" }] }] },
              target: "yes",
            },
          ],
          elseTarget: "no",
        },
        { id: "yes", type: "actions", position: pos, actions: [{ type: "set_field", key: "path", value: "yes" }], next: null },
        { id: "no", type: "actions", position: pos, actions: [{ type: "set_field", key: "path", value: "no" }], next: null },
      ],
    };
    const r = runUntilBlocked(input(flow));
    expect(r.effects.at(-1)).toMatchObject({ type: "action", action: { key: "path", value: "yes" } });
  });

  it("keeps a contact on its first randomizer variant unless randomEveryTime", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "r",
      nodes: [
        {
          id: "r",
          type: "randomizer",
          position: pos,
          randomEveryTime: false,
          variants: [
            { id: "A", label: "A", weight: 50, target: null },
            { id: "B", label: "B", weight: 50, target: null },
          ],
        },
      ],
    };
    const first = runUntilBlocked(input(flow, { random: () => 0.9 }));
    expect(first.splitChoices).toEqual({ r: "B" });
    const again = runUntilBlocked(input(flow, { random: () => 0.1, splitChoices: first.splitChoices }));
    expect(again.splitChoices).toEqual({ r: "B" });
  });

  it("waits for input when the path ends on a message with buttons", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "a",
      nodes: [
        {
          id: "a",
          type: "send_message",
          position: pos,
          privateReply: false,
          messages: [text("pick", [{ id: "btn", type: "node", title: "Go", target: "b" }])],
          quickReplies: [],
          next: null,
        },
        { id: "b", type: "actions", position: pos, actions: [{ type: "add_tag", tag: "clicked" }], next: null },
      ],
    };
    const r = runUntilBlocked(input(flow));
    expect(r.position).toEqual({ status: "waiting_input", currentNodeId: "a" });
    expect(resolveReplyTarget(input(flow).flow, "a", "btn")).toBe("b");
    expect(resolveReplyTarget(input(flow).flow, "a", "gone")).toBeUndefined();
  });

  it("fails instead of looping forever", () => {
    const flow: Flow = {
      version: 1,
      startNodeId: "x",
      nodes: [
        { id: "x", type: "actions", position: pos, actions: [{ type: "add_tag", tag: "t" }], next: "y" },
        { id: "y", type: "actions", position: pos, actions: [{ type: "remove_tag", tag: "t" }], next: "x" },
      ],
    };
    const r = runUntilBlocked(input(flow, { maxSteps: 10 }));
    expect(r.position.status).toBe("failed");
  });
});

describe("flowSchema", () => {
  it("rejects edges to missing nodes and multi-message private replies", () => {
    const bad = flowSchema.safeParse({
      version: 1,
      startNodeId: "a",
      nodes: [
        { id: "a", type: "send_message", position: pos, privateReply: true, messages: [text("1"), text("2")], quickReplies: [], next: "zzz" },
      ],
    });
    expect(bad.success).toBe(false);
    const messages = bad.error!.issues.map((i) => i.message).join("\n");
    expect(messages).toMatch(/missing node zzz/);
    expect(messages).toMatch(/single message/);
  });
});
