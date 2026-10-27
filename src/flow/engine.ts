import { evaluateFilter, type ContactSnapshot } from "./filter";
import type { Action, Flow, FlowNode, Message, QuickReply } from "./types";

// Pure flow interpreter: walks nodes from a starting point and returns the
// side effects to apply plus where the run should park. The worker owns I/O.

export type Effect =
  | {
      type: "send";
      nodeId: string;
      message: Message;
      // Attached to the last message of a node only, as Instagram expects.
      quickReplies: QuickReply[];
      asPrivateReply: boolean;
    }
  | { type: "action"; nodeId: string; action: Action }
  | { type: "start_automation"; nodeId: string; automationId: string };

export type RunPosition =
  | { status: "completed"; currentNodeId: string | null }
  | { status: "waiting_input"; currentNodeId: string }
  | { status: "waiting_delay"; currentNodeId: string; resumeAt: Date }
  | { status: "failed"; currentNodeId: string | null; error: string };

export type StepInput = {
  flow: Flow;
  startNodeId: string | null;
  contact: ContactSnapshot;
  now: Date;
  // Previously chosen randomizer variants, keyed by node id.
  splitChoices: Readonly<Record<string, string>>;
  // True when the run came from a comment and its private reply is still unused.
  privateReplyAvailable: boolean;
  random?: () => number;
  maxSteps?: number;
};

export type StepResult = {
  effects: Effect[];
  position: RunPosition;
  splitChoices: Record<string, string>;
  privateReplyUsed: boolean;
};

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

export function runUntilBlocked(input: StepInput): StepResult {
  const random = input.random ?? Math.random;
  const maxSteps = input.maxSteps ?? 100;
  const nodes = new Map(input.flow.nodes.map((n) => [n.id, n]));
  const effects: Effect[] = [];
  const splitChoices = { ...input.splitChoices };
  // Local copy so actions earlier in the pass affect later conditions.
  const tags = new Set(input.contact.tags);
  const fields = { ...input.contact.fields };
  let privateReplyAvailable = input.privateReplyAvailable;
  let privateReplyUsed = false;

  let currentId = input.startNodeId;
  let lastInteractiveId: string | null = null;

  for (let step = 0; currentId !== null; step++) {
    if (step >= maxSteps) {
      return done({ status: "failed", currentNodeId: currentId, error: "step limit exceeded (possible loop)" });
    }
    const node: FlowNode | undefined = nodes.get(currentId);
    if (!node) {
      return done({ status: "failed", currentNodeId: currentId, error: `node ${currentId} not found` });
    }

    switch (node.type) {
      case "send_message": {
        const asPrivateReply = node.privateReply && privateReplyAvailable;
        node.messages.forEach((message, i) => {
          const isLast = i === node.messages.length - 1;
          effects.push({
            type: "send",
            nodeId: node.id,
            message,
            quickReplies: isLast ? node.quickReplies : [],
            asPrivateReply,
          });
        });
        if (asPrivateReply) {
          privateReplyAvailable = false;
          privateReplyUsed = true;
        }
        if (hasInteractiveTargets(node)) lastInteractiveId = node.id;
        currentId = node.next;
        break;
      }
      case "actions": {
        for (const action of node.actions) {
          effects.push({ type: "action", nodeId: node.id, action });
          applyLocally(action, tags, fields);
        }
        currentId = node.next;
        break;
      }
      case "condition": {
        const snapshot = { tags, fields };
        const branch = node.branches.find((b) => evaluateFilter(b.filter, snapshot));
        currentId = branch ? branch.target : node.elseTarget;
        break;
      }
      case "smart_delay": {
        if (node.next === null) return done({ status: "completed", currentNodeId: node.id });
        const resumeAt = new Date(input.now.getTime() + node.amount * UNIT_MS[node.unit]);
        return done({ status: "waiting_delay", currentNodeId: node.next, resumeAt });
      }
      case "randomizer": {
        const remembered = node.randomEveryTime ? undefined : splitChoices[node.id];
        const variant =
          node.variants.find((v) => v.id === remembered) ?? pickWeighted(node.variants, random);
        splitChoices[node.id] = variant.id;
        currentId = variant.target;
        break;
      }
      case "start_automation": {
        effects.push({ type: "start_automation", nodeId: node.id, automationId: node.automationId });
        return done({ status: "completed", currentNodeId: node.id });
      }
    }
  }

  // Ran off the end of the graph. If a message offered buttons, keep the run
  // resumable so a later click continues it.
  return done(
    lastInteractiveId
      ? { status: "waiting_input", currentNodeId: lastInteractiveId }
      : { status: "completed", currentNodeId: null },
  );

  function done(position: RunPosition): StepResult {
    return { effects, position, splitChoices, privateReplyUsed };
  }
}

// Where a button or quick reply on `nodeId` leads, or undefined if it no longer exists
// (e.g. the automation was republished without it).
export function resolveReplyTarget(flow: Flow, nodeId: string, replyId: string): string | null | undefined {
  const node = flow.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "send_message") return undefined;
  for (const m of node.messages) {
    if (m.kind !== "text") continue;
    const b = m.buttons.find((x) => x.id === replyId);
    if (b) return b.type === "node" ? b.target : null;
  }
  const q = node.quickReplies.find((x) => x.id === replyId);
  return q ? q.target : undefined;
}

function hasInteractiveTargets(node: Extract<FlowNode, { type: "send_message" }>): boolean {
  return (
    node.quickReplies.some((q) => q.target !== null) ||
    node.messages.some((m) => m.kind === "text" && m.buttons.some((b) => b.type === "node" && b.target !== null))
  );
}

function applyLocally(action: Action, tags: Set<string>, fields: Record<string, unknown>): void {
  switch (action.type) {
    case "add_tag":
      tags.add(action.tag);
      break;
    case "remove_tag":
      tags.delete(action.tag);
      break;
    case "set_field":
      fields[action.key] = action.value;
      break;
    case "clear_field":
      delete fields[action.key];
      break;
    case "pause_automations":
      break;
  }
}

function pickWeighted<T extends { weight: number }>(items: T[], random: () => number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r < 0) return item;
  }
  return items[items.length - 1];
}
