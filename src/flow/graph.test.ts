import { describe, expect, it } from "vitest";
import { removeNode, setSlot, slotsOf } from "./graph";
import { flowSchema, type Flow } from "./types";

const pos = { x: 0, y: 0 };
const flow: Flow = {
  version: 1,
  startNodeId: "a",
  nodes: [
    {
      id: "a",
      type: "send_message",
      position: pos,
      privateReply: false,
      messages: [{ kind: "text", text: "hi", buttons: [{ id: "b1", type: "node", title: "Go", target: "c" }] }],
      quickReplies: [{ id: "q1", title: "Later", target: null }],
      next: null,
    },
    {
      id: "c",
      type: "condition",
      position: pos,
      branches: [{ id: "x", filter: { operator: "AND", groups: [{ operator: "AND", items: [{ kind: "tag", op: "has", tag: "t" }] }] }, target: "a" }],
      elseTarget: null,
    },
  ],
};

describe("flow graph slots", () => {
  it("lists button, quick reply and next slots", () => {
    expect(slotsOf(flow.nodes[0]).map((s) => s.handle)).toEqual(["btn:b1", "qr:q1", "next"]);
  });

  it("connects slots and the trigger start", () => {
    let f = setSlot(flow, "a", "qr:q1", "c");
    f = setSlot(f, "c", "else", "a");
    f = setSlot(f, "__trigger", "start", "c");
    expect(slotsOf(f.nodes[0]).find((s) => s.handle === "qr:q1")?.target).toBe("c");
    expect(slotsOf(f.nodes[1]).find((s) => s.handle === "else")?.target).toBe("a");
    expect(f.startNodeId).toBe("c");
    expect(flowSchema.safeParse(f).success).toBe(true);
  });

  it("removing a node clears every reference to it", () => {
    const f = removeNode(flow, "c");
    expect(f.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(slotsOf(f.nodes[0]).every((s) => s.target === null)).toBe(true);
    expect(flowSchema.safeParse(f).success).toBe(true);
    expect(removeNode(flow, "a").startNodeId).toBeNull();
  });
});
