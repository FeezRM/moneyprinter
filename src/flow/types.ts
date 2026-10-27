import { z } from "zod";
import { filterSchema } from "./filter";

const nodeId = z.string().min(1);
const target = nodeId.nullable();
const position = z.object({ x: z.number(), y: z.number() });

// Instagram limits: button template text 640 chars, plain text 1000 bytes,
// 1-3 template buttons, up to 13 quick replies of 20 chars.
export const buttonSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("url"), title: z.string().min(1).max(20), url: z.string().url() }),
  z.object({ id: z.string().min(1), type: z.literal("node"), title: z.string().min(1).max(20), target }),
]);

export const quickReplySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(20),
  target,
});

export const messageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(1000),
    buttons: z.array(buttonSchema).max(3).default([]),
  }),
  z.object({ kind: z.literal("image"), url: z.string().url() }),
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_tag"), tag: z.string().min(1) }),
  z.object({ type: z.literal("remove_tag"), tag: z.string().min(1) }),
  z.object({ type: z.literal("set_field"), key: z.string().min(1), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ type: z.literal("clear_field"), key: z.string().min(1) }),
  z.object({ type: z.literal("pause_automations"), minutes: z.number().int().positive() }),
]);

const sendMessageNode = z.object({
  id: nodeId,
  type: z.literal("send_message"),
  position,
  // Comment-triggered runs send the first message as an Instagram private reply.
  privateReply: z.boolean().default(false),
  messages: z.array(messageSchema).min(1).max(10),
  quickReplies: z.array(quickReplySchema).max(13).default([]),
  next: target,
});

const actionsNode = z.object({
  id: nodeId,
  type: z.literal("actions"),
  position,
  actions: z.array(actionSchema).min(1),
  next: target,
});

const conditionNode = z.object({
  id: nodeId,
  type: z.literal("condition"),
  position,
  // Evaluated in order; first match wins, otherwise `elseTarget` (else-if chain).
  branches: z.array(z.object({ id: z.string().min(1), filter: filterSchema, target })).min(1),
  elseTarget: target,
});

const smartDelayNode = z.object({
  id: nodeId,
  type: z.literal("smart_delay"),
  position,
  amount: z.number().int().positive(),
  unit: z.enum(["minutes", "hours", "days"]),
  next: target,
});

const randomizerNode = z.object({
  id: nodeId,
  type: z.literal("randomizer"),
  position,
  // When false, a contact keeps the variant chosen on their first pass.
  randomEveryTime: z.boolean().default(false),
  variants: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1), weight: z.number().int().positive(), target }))
    .min(2),
});

const startAutomationNode = z.object({
  id: nodeId,
  type: z.literal("start_automation"),
  position,
  automationId: z.string().uuid(),
});

export const flowNodeSchema = z.discriminatedUnion("type", [
  sendMessageNode,
  actionsNode,
  conditionNode,
  smartDelayNode,
  randomizerNode,
  startAutomationNode,
]);

export const flowSchema = z
  .object({
    version: z.literal(1),
    startNodeId: target,
    nodes: z.array(flowNodeSchema),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    for (const n of flow.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `duplicate node id ${n.id}` });
      ids.add(n.id);
    }
    const check = (t: string | null, where: string) => {
      if (t !== null && !ids.has(t)) ctx.addIssue({ code: "custom", message: `${where} points to missing node ${t}` });
    };
    check(flow.startNodeId, "startNodeId");
    for (const n of flow.nodes) {
      for (const t of outgoingTargets(n)) check(t, `node ${n.id}`);
      // Instagram permits exactly one private reply per comment.
      if (n.type === "send_message" && n.privateReply && n.messages.length !== 1) {
        ctx.addIssue({ code: "custom", message: `node ${n.id}: a private reply must be a single message` });
      }
    }
  });

export type Flow = z.infer<typeof flowSchema>;
export type FlowNode = z.infer<typeof flowNodeSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Button = z.infer<typeof buttonSchema>;
export type QuickReply = z.infer<typeof quickReplySchema>;
export type Action = z.infer<typeof actionSchema>;

export function outgoingTargets(n: FlowNode): (string | null)[] {
  switch (n.type) {
    case "send_message":
      return [
        n.next,
        ...n.messages.flatMap((m) => (m.kind === "text" ? m.buttons.map((b) => (b.type === "node" ? b.target : null)) : [])),
        ...n.quickReplies.map((q) => q.target),
      ];
    case "actions":
    case "smart_delay":
      return [n.next];
    case "condition":
      return [...n.branches.map((b) => b.target), n.elseTarget];
    case "randomizer":
      return n.variants.map((v) => v.target);
    case "start_automation":
      return [];
  }
}

export const emptyFlow = (): Flow => ({ version: 1, startNodeId: null, nodes: [] });
