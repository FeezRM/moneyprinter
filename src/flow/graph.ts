import type { Flow, FlowNode } from "./types";

// Every place a node can point to another node is a "slot" with a stable handle id.
// The builder renders one source handle per slot; connecting edges writes the slot.

export const START_HANDLE = "start";

export type Slot = { handle: string; label: string; target: string | null };

export function slotsOf(node: FlowNode): Slot[] {
  switch (node.type) {
    case "send_message":
      return [
        ...node.messages.flatMap((m) =>
          m.kind === "text"
            ? m.buttons.filter((b) => b.type === "node").map((b) => ({ handle: `btn:${b.id}`, label: b.title, target: b.type === "node" ? b.target : null }))
            : [],
        ),
        ...node.quickReplies.map((q) => ({ handle: `qr:${q.id}`, label: q.title, target: q.target })),
        { handle: "next", label: "Next step", target: node.next },
      ];
    case "actions":
    case "smart_delay":
      return [{ handle: "next", label: "Next step", target: node.next }];
    case "condition":
      return [
        ...node.branches.map((b, i) => ({ handle: `br:${b.id}`, label: i === 0 ? "If matches" : "Else if matches", target: b.target })),
        { handle: "else", label: "Otherwise", target: node.elseTarget },
      ];
    case "randomizer":
      return node.variants.map((v) => ({ handle: `var:${v.id}`, label: `${v.label} (${v.weight})`, target: v.target }));
    case "start_automation":
      return [];
  }
}

export function setSlot(flow: Flow, nodeId: string, handle: string, target: string | null): Flow {
  if (nodeId === "__trigger") return { ...flow, startNodeId: target };
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === nodeId ? setNodeSlot(n, handle, target) : n)),
  };
}

function setNodeSlot(node: FlowNode, handle: string, target: string | null): FlowNode {
  const [kind, id] = handle.includes(":") ? handle.split(":") : [handle, ""];
  switch (node.type) {
    case "send_message":
      if (kind === "next") return { ...node, next: target };
      if (kind === "btn")
        return {
          ...node,
          messages: node.messages.map((m) =>
            m.kind === "text"
              ? { ...m, buttons: m.buttons.map((b) => (b.id === id && b.type === "node" ? { ...b, target } : b)) }
              : m,
          ),
        };
      if (kind === "qr") return { ...node, quickReplies: node.quickReplies.map((q) => (q.id === id ? { ...q, target } : q)) };
      return node;
    case "actions":
    case "smart_delay":
      return kind === "next" ? { ...node, next: target } : node;
    case "condition":
      if (kind === "else") return { ...node, elseTarget: target };
      if (kind === "br") return { ...node, branches: node.branches.map((b) => (b.id === id ? { ...b, target } : b)) };
      return node;
    case "randomizer":
      return kind === "var" ? { ...node, variants: node.variants.map((v) => (v.id === id ? { ...v, target } : v)) } : node;
    case "start_automation":
      return node;
  }
}

// Removes a node and clears every slot that pointed at it.
export function removeNode(flow: Flow, nodeId: string): Flow {
  let next: Flow = {
    ...flow,
    startNodeId: flow.startNodeId === nodeId ? null : flow.startNodeId,
    nodes: flow.nodes.filter((n) => n.id !== nodeId),
  };
  for (const n of next.nodes) {
    for (const s of slotsOf(n)) {
      if (s.target === nodeId) next = setSlot(next, n.id, s.handle, null);
    }
  }
  return next;
}
