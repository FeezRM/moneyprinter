"use client";

import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState, useTransition } from "react";
import { removeNode, setSlot, slotsOf, START_HANDLE } from "@/flow/graph";
import type { Flow, FlowNode } from "@/flow/types";
import type { TriggerConfig } from "@/triggers/types";
import { deleteAutomation, publishAutomation, saveDraft, unpublishAutomation, type ActionResult } from "../actions";
import { NodeEditor, newNode, NODE_LABELS } from "./node-editors";
import { TriggerEditor, triggerSummary } from "./trigger-editors";

const TRIGGER_ID = "__trigger";

type StepData = { node: FlowNode };
type TriggerData = { triggers: TriggerConfig[] };
type StepNode = Node<StepData, "step">;
type TriggerNode = Node<TriggerData, "trigger">;

export function Builder(props: {
  id: string;
  initialName: string;
  initialFlow: Flow;
  initialTriggers: TriggerConfig[];
  live: boolean;
  publishedVersion: number;
  otherAutomations: { id: string; name: string }[];
}) {
  const [name, setName] = useState(props.initialName);
  const [flow, setFlow] = useState(props.initialFlow);
  const [triggers, setTriggers] = useState(props.initialTriggers);
  const [selected, setSelected] = useState<string | null>(TRIGGER_ID);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const updateFlow = (f: (prev: Flow) => Flow) => {
    setFlow(f);
    setDirty(true);
  };
  const updateTriggers = (t: TriggerConfig[]) => {
    setTriggers(t);
    setDirty(true);
  };

  const nodes = useMemo<(StepNode | TriggerNode)[]>(
    () => [
      {
        id: TRIGGER_ID,
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { triggers },
        selected: selected === TRIGGER_ID,
        deletable: false,
      },
      ...flow.nodes.map((n) => ({
        id: n.id,
        type: "step" as const,
        position: n.position,
        data: { node: n },
        selected: selected === n.id,
      })),
    ],
    [flow.nodes, triggers, selected],
  );

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    if (flow.startNodeId) {
      out.push({ id: `${TRIGGER_ID}:${START_HANDLE}`, source: TRIGGER_ID, sourceHandle: START_HANDLE, target: flow.startNodeId });
    }
    for (const n of flow.nodes) {
      for (const s of slotsOf(n)) {
        if (s.target) out.push({ id: `${n.id}:${s.handle}`, source: n.id, sourceHandle: s.handle, target: s.target });
      }
    }
    return out;
  }, [flow]);

  function onNodesChange(changes: NodeChange<StepNode | TriggerNode>[]) {
    for (const c of changes) {
      if (c.type === "select" && c.selected) setSelected(c.id);
      if (c.type === "position" && c.position && c.id !== TRIGGER_ID) {
        const p = c.position;
        updateFlow((f) => ({ ...f, nodes: f.nodes.map((n) => (n.id === c.id ? { ...n, position: p } : n)) }));
      }
      if (c.type === "remove" && c.id !== TRIGGER_ID) {
        updateFlow((f) => removeNode(f, c.id));
        setSelected(TRIGGER_ID);
      }
    }
  }

  function onEdgesChange(changes: EdgeChange[]) {
    for (const c of changes) {
      if (c.type !== "remove") continue;
      const edge = edges.find((e) => e.id === c.id);
      if (edge?.sourceHandle) updateFlow((f) => setSlot(f, edge.source, edge.sourceHandle!, null));
    }
  }

  function onConnect(c: Connection) {
    if (!c.sourceHandle || c.target === TRIGGER_ID) return;
    updateFlow((f) => setSlot(f, c.source, c.sourceHandle!, c.target));
  }

  function addNode(type: FlowNode["type"]) {
    const last = flow.nodes.at(-1)?.position ?? { x: 0, y: 0 };
    const node = newNode(type, { x: last.x + 320, y: last.y });
    updateFlow((f) => ({ ...f, nodes: [...f.nodes, node], startNodeId: f.startNodeId ?? node.id }));
    setSelected(node.id);
  }

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) setDirty(false);
    });
  }

  const save = () => run(() => saveDraft(props.id, { name, flow, triggers }));
  const publish = () =>
    run(async () => {
      const saved = await saveDraft(props.id, { name, flow, triggers });
      return saved.ok ? publishAutomation(props.id) : saved;
    });

  const selectedNode = flow.nodes.find((n) => n.id === selected);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="w-72 min-w-0 rounded border border-transparent px-2 py-1 font-medium hover:border-zinc-300"
        />
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${props.live ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-600"}`}>
          {props.live ? "LIVE" : props.publishedVersion > 0 ? "OFF" : "DRAFT"}
        </span>
        <span className="text-xs text-zinc-500">{dirty ? "Unsaved changes" : "Saved"}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button disabled={pending} onClick={save} className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50">
            Save draft
          </button>
          {props.live && (
            <button
              disabled={pending}
              onClick={() => run(() => unpublishAutomation(props.id))}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50"
            >
              Turn off
            </button>
          )}
          <button disabled={pending} onClick={publish} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
            {props.live ? "Publish changes" : "Publish"}
          </button>
        </div>
      </header>
      {result && !result.ok && (
        <ul className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
            <Panel position="top-left" className="flex max-w-md flex-wrap gap-1">
              {(Object.keys(NODE_LABELS) as FlowNode["type"][]).map((t) => (
                <button
                  key={t}
                  onClick={() => addNode(t)}
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs shadow-sm hover:bg-zinc-100"
                >
                  + {NODE_LABELS[t]}
                </button>
              ))}
            </Panel>
          </ReactFlow>
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-4">
          {selected === TRIGGER_ID ? (
            <>
              <TriggerEditor triggers={triggers} onChange={updateTriggers} />
              <Connections
                flow={flow}
                fromId={TRIGGER_ID}
                slots={[{ handle: START_HANDLE, label: "First step", target: flow.startNodeId }]}
                onConnect={(handle, target) => updateFlow((f) => setSlot(f, TRIGGER_ID, handle, target))}
              />
            </>
          ) : selectedNode ? (
            <>
              <NodeEditor
                node={selectedNode}
                otherAutomations={props.otherAutomations}
                onChange={(n) => updateFlow((f) => ({ ...f, nodes: f.nodes.map((x) => (x.id === n.id ? n : x)) }))}
                onDelete={() => {
                  updateFlow((f) => removeNode(f, selectedNode.id));
                  setSelected(TRIGGER_ID);
                }}
              />
              <Connections
                flow={flow}
                fromId={selectedNode.id}
                slots={slotsOf(selectedNode)}
                onConnect={(handle, target) => updateFlow((f) => setSlot(f, selectedNode.id, handle, target))}
              />
            </>
          ) : (
            <p className="text-sm text-zinc-500">Select a step to edit it.</p>
          )}
          <hr className="my-6 border-zinc-200" />
          <form action={deleteAutomation.bind(null, props.id)}>
            <button className="text-sm text-red-600 hover:underline">Delete automation</button>
          </form>
        </aside>
      </div>
    </div>
  );
}

function TriggerCard({ data, selected }: NodeProps<TriggerNode>) {
  return (
    <div className={`w-64 rounded-lg border bg-white p-3 shadow-sm ${selected ? "border-blue-500" : "border-zinc-300"}`}>
      <div className="mb-2 text-xs font-semibold uppercase text-zinc-500">When…</div>
      {data.triggers.length === 0 ? (
        <div className="text-sm text-zinc-500">Click to add a trigger</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.triggers.map((t, i) => (
            <li key={i} className="rounded bg-green-50 px-2 py-1 text-sm">
              {triggerSummary(t)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-right text-xs text-zinc-500">Then</div>
      <Handle type="source" id={START_HANDLE} position={Position.Right} style={{ top: "auto", bottom: 14 }} />
    </div>
  );
}

function StepCard({ data, selected }: NodeProps<StepNode>) {
  const n = data.node;
  const slots = slotsOf(n);
  return (
    <div className={`w-64 rounded-lg border bg-white shadow-sm ${selected ? "border-blue-500" : "border-zinc-300"}`}>
      <Handle type="target" position={Position.Left} />
      <div className="border-b border-zinc-100 px-3 py-2 text-xs font-semibold uppercase text-zinc-500">{NODE_LABELS[n.type]}</div>
      <div className="px-3 py-2 text-sm text-zinc-700">{summarize(n)}</div>
      {slots.map((s) => (
        <div key={s.handle} className="relative border-t border-zinc-100 px-3 py-1.5 text-right text-xs text-zinc-600">
          {s.label}
          <Handle type="source" id={s.handle} position={Position.Right} />
        </div>
      ))}
    </div>
  );
}

const NODE_TYPES = { trigger: TriggerCard, step: StepCard };

// Keyboard-accessible alternative to dragging edges on the canvas.
function Connections(props: {
  flow: Flow;
  fromId: string;
  slots: { handle: string; label: string; target: string | null }[];
  onConnect: (handle: string, target: string | null) => void;
}) {
  if (props.slots.length === 0) return null;
  const options = props.flow.nodes.filter((n) => n.id !== props.fromId);
  return (
    <div className="mt-6 flex flex-col gap-2 text-sm">
      <h3 className="font-semibold">Connections</h3>
      {props.slots.map((s) => (
        <label key={s.handle} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-zinc-600">{s.label}</span>
          <select
            value={s.target ?? ""}
            onChange={(e) => props.onConnect(s.handle, e.target.value || null)}
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1"
          >
            <option value="">— none —</option>
            {options.map((n) => (
              <option key={n.id} value={n.id}>
                {NODE_LABELS[n.type]}: {summarize(n).slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function summarize(n: FlowNode): string {
  switch (n.type) {
    case "send_message": {
      const first = n.messages[0];
      const text = first.kind === "text" ? first.text : "Image";
      return (n.privateReply ? "Private reply: " : "") + (text.length > 80 ? text.slice(0, 80) + "…" : text);
    }
    case "actions":
      return n.actions.map((a) => a.type.replace("_", " ")).join(", ");
    case "condition":
      return `${n.branches.length} condition${n.branches.length > 1 ? "s" : ""}`;
    case "smart_delay":
      return `Wait ${n.amount} ${n.unit}`;
    case "randomizer":
      return n.variants.map((v) => `${v.label} ${v.weight}`).join(" / ");
    case "start_automation":
      return "Start another automation";
  }
}
