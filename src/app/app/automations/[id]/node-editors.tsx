"use client";

import type { Predicate } from "@/flow/filter";
import type { Action, Button, FlowNode, Message } from "@/flow/types";

export const NODE_LABELS: Record<FlowNode["type"], string> = {
  send_message: "Send message",
  actions: "Actions",
  condition: "Condition",
  smart_delay: "Smart delay",
  randomizer: "Randomizer",
  start_automation: "Start automation",
};

const uid = () => crypto.randomUUID().slice(0, 8);

export function newNode(type: FlowNode["type"], position: { x: number; y: number }): FlowNode {
  const id = uid();
  switch (type) {
    case "send_message":
      return { id, type, position, privateReply: false, messages: [{ kind: "text", text: "Hey! 👋", buttons: [] }], quickReplies: [], next: null };
    case "actions":
      return { id, type, position, actions: [{ type: "add_tag", tag: "lead" }], next: null };
    case "condition":
      return {
        id,
        type,
        position,
        branches: [{ id: uid(), filter: { operator: "AND", groups: [{ operator: "AND", items: [{ kind: "tag", op: "has", tag: "lead" }] }] }, target: null }],
        elseTarget: null,
      };
    case "smart_delay":
      // 23h keeps a follow-up inside Instagram's 24h messaging window.
      return { id, type, position, amount: 23, unit: "hours", next: null };
    case "randomizer":
      return {
        id,
        type,
        position,
        randomEveryTime: false,
        variants: [
          { id: uid(), label: "A", weight: 50, target: null },
          { id: uid(), label: "B", weight: 50, target: null },
        ],
      };
    case "start_automation":
      return { id, type, position, automationId: "" };
  }
}

export function NodeEditor(props: {
  node: FlowNode;
  otherAutomations: { id: string; name: string }[];
  onChange: (n: FlowNode) => void;
  onDelete: () => void;
}) {
  const { node, onChange } = props;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{NODE_LABELS[node.type]}</h2>
        <button onClick={props.onDelete} className="text-xs text-red-600 hover:underline">
          Delete step
        </button>
      </div>
      {node.type === "send_message" && <SendMessageEditor node={node} onChange={onChange} />}
      {node.type === "actions" && <ActionsEditor node={node} onChange={onChange} />}
      {node.type === "condition" && <ConditionEditor node={node} onChange={onChange} />}
      {node.type === "smart_delay" && (
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={node.amount}
            onChange={(e) => onChange({ ...node, amount: Number(e.target.value) })}
            className={input}
          />
          <select value={node.unit} onChange={(e) => onChange({ ...node, unit: e.target.value as typeof node.unit })} className={input}>
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}
      {node.type === "randomizer" && (
        <div className="flex flex-col gap-2">
          <Check label="Pick a random path every time" checked={node.randomEveryTime} onChange={(v) => onChange({ ...node, randomEveryTime: v })} />
          {node.variants.map((v, i) => (
            <div key={v.id} className="flex gap-2">
              <input value={v.label} onChange={(e) => onChange({ ...node, variants: replaceAt(node.variants, i, { ...v, label: e.target.value }) })} className={input} />
              <input
                type="number"
                min={1}
                value={v.weight}
                onChange={(e) => onChange({ ...node, variants: replaceAt(node.variants, i, { ...v, weight: Number(e.target.value) }) })}
                className={`${input} w-20`}
              />
              {node.variants.length > 2 && <Remove onClick={() => onChange({ ...node, variants: node.variants.filter((_, j) => j !== i) })} />}
            </div>
          ))}
          <Add
            label="Add variation"
            onClick={() => onChange({ ...node, variants: [...node.variants, { id: uid(), label: String.fromCharCode(65 + node.variants.length), weight: 50, target: null }] })}
          />
        </div>
      )}
      {node.type === "start_automation" && (
        <select value={node.automationId} onChange={(e) => onChange({ ...node, automationId: e.target.value })} className={input}>
          <option value="">Choose an automation…</option>
          {props.otherAutomations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-zinc-500">Drag from a handle on the right of a step to connect it to the next one.</p>
    </div>
  );
}

function SendMessageEditor({ node, onChange }: { node: Extract<FlowNode, { type: "send_message" }>; onChange: (n: FlowNode) => void }) {
  const setMessage = (i: number, m: Message) => onChange({ ...node, messages: replaceAt(node.messages, i, m) });
  return (
    <>
      <Check
        label="Send as private reply to the comment"
        checked={node.privateReply}
        onChange={(v) => onChange({ ...node, privateReply: v, messages: v ? node.messages.slice(0, 1) : node.messages })}
      />
      {node.privateReply && (
        <p className="text-xs text-zinc-500">
          Instagram allows one private reply per comment. Add a button so the person can tap it, which opens the
          conversation for follow-up messages.
        </p>
      )}
      {node.messages.map((m, i) => (
        <div key={i} className="flex flex-col gap-2 rounded border border-zinc-200 p-2">
          {m.kind === "text" ? (
            <>
              <textarea
                value={m.text}
                maxLength={1000}
                rows={3}
                onChange={(e) => setMessage(i, { ...m, text: e.target.value })}
                className={input}
              />
              <span className="self-end text-xs text-zinc-400">{1000 - m.text.length}</span>
              {m.buttons.map((b, j) => (
                <ButtonRow key={b.id} button={b} onChange={(nb) => setMessage(i, { ...m, buttons: replaceAt(m.buttons, j, nb) })} onRemove={() => setMessage(i, { ...m, buttons: m.buttons.filter((_, k) => k !== j) })} />
              ))}
              {m.buttons.length < 3 && (
                <Add label="Add button" onClick={() => setMessage(i, { ...m, buttons: [...m.buttons, { id: uid(), type: "node", title: "Continue", target: null }] })} />
              )}
            </>
          ) : (
            <input value={m.url} placeholder="https://… image URL" onChange={(e) => setMessage(i, { ...m, url: e.target.value })} className={input} />
          )}
          {node.messages.length > 1 && <Remove onClick={() => onChange({ ...node, messages: node.messages.filter((_, k) => k !== i) })} />}
        </div>
      ))}
      {!node.privateReply && node.messages.length < 10 && (
        <div className="flex gap-2">
          <Add label="Text" onClick={() => onChange({ ...node, messages: [...node.messages, { kind: "text", text: "…", buttons: [] }] })} />
          <Add label="Image" onClick={() => onChange({ ...node, messages: [...node.messages, { kind: "image", url: "https://example.com/image.jpg" }] })} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="font-medium">Quick replies</span>
        {node.quickReplies.map((q, i) => (
          <div key={q.id} className="flex gap-2">
            <input
              value={q.title}
              maxLength={20}
              onChange={(e) => onChange({ ...node, quickReplies: replaceAt(node.quickReplies, i, { ...q, title: e.target.value }) })}
              className={input}
            />
            <Remove onClick={() => onChange({ ...node, quickReplies: node.quickReplies.filter((_, k) => k !== i) })} />
          </div>
        ))}
        {node.quickReplies.length < 13 && (
          <Add label="Add quick reply" onClick={() => onChange({ ...node, quickReplies: [...node.quickReplies, { id: uid(), title: "Yes", target: null }] })} />
        )}
      </div>
    </>
  );
}

function ButtonRow({ button, onChange, onRemove }: { button: Button; onChange: (b: Button) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded bg-zinc-50 p-2">
      <div className="flex gap-2">
        <input value={button.title} maxLength={20} onChange={(e) => onChange({ ...button, title: e.target.value })} className={input} />
        <select
          value={button.type}
          onChange={(e) =>
            onChange(
              e.target.value === "url"
                ? { id: button.id, type: "url", title: button.title, url: "https://" }
                : { id: button.id, type: "node", title: button.title, target: null },
            )
          }
          className={input}
        >
          <option value="node">Go to step</option>
          <option value="url">Open URL</option>
        </select>
        <Remove onClick={onRemove} />
      </div>
      {button.type === "url" && <input value={button.url} onChange={(e) => onChange({ ...button, url: e.target.value })} className={input} />}
    </div>
  );
}

function ActionsEditor({ node, onChange }: { node: Extract<FlowNode, { type: "actions" }>; onChange: (n: FlowNode) => void }) {
  const set = (i: number, a: Action) => onChange({ ...node, actions: replaceAt(node.actions, i, a) });
  return (
    <div className="flex flex-col gap-2">
      {node.actions.map((a, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-zinc-200 p-2">
          <div className="flex gap-2">
            <select value={a.type} onChange={(e) => set(i, defaultAction(e.target.value as Action["type"]))} className={input}>
              <option value="add_tag">Add tag</option>
              <option value="remove_tag">Remove tag</option>
              <option value="set_field">Set field</option>
              <option value="clear_field">Clear field</option>
              <option value="pause_automations">Pause automations</option>
            </select>
            {node.actions.length > 1 && <Remove onClick={() => onChange({ ...node, actions: node.actions.filter((_, k) => k !== i) })} />}
          </div>
          {(a.type === "add_tag" || a.type === "remove_tag") && <input value={a.tag} placeholder="tag" onChange={(e) => set(i, { ...a, tag: e.target.value })} className={input} />}
          {(a.type === "set_field" || a.type === "clear_field") && <input value={a.key} placeholder="field key" onChange={(e) => set(i, { ...a, key: e.target.value })} className={input} />}
          {a.type === "set_field" && <input value={String(a.value)} placeholder="value" onChange={(e) => set(i, { ...a, value: e.target.value })} className={input} />}
          {a.type === "pause_automations" && (
            <input type="number" min={1} value={a.minutes} onChange={(e) => set(i, { ...a, minutes: Number(e.target.value) })} className={input} />
          )}
        </div>
      ))}
      <Add label="Add action" onClick={() => onChange({ ...node, actions: [...node.actions, defaultAction("add_tag")] })} />
    </div>
  );
}

function defaultAction(type: Action["type"]): Action {
  switch (type) {
    case "add_tag":
    case "remove_tag":
      return { type, tag: "" };
    case "set_field":
      return { type, key: "", value: "" };
    case "clear_field":
      return { type, key: "" };
    case "pause_automations":
      return { type, minutes: 60 };
  }
}

// Each branch edits one AND-group; the else-if chain covers most OR cases.
function ConditionEditor({ node, onChange }: { node: Extract<FlowNode, { type: "condition" }>; onChange: (n: FlowNode) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {node.branches.map((b, i) => {
        const items = b.filter.groups[0].items;
        const setItems = (next: Predicate[]) =>
          onChange({ ...node, branches: replaceAt(node.branches, i, { ...b, filter: { operator: "AND", groups: [{ operator: "AND", items: next }] } }) });
        return (
          <div key={b.id} className="flex flex-col gap-2 rounded border border-zinc-200 p-2">
            <div className="flex items-center justify-between text-xs font-medium text-zinc-600">
              {i === 0 ? "If contact matches all of:" : "Else if contact matches all of:"}
              {node.branches.length > 1 && <Remove onClick={() => onChange({ ...node, branches: node.branches.filter((_, k) => k !== i) })} />}
            </div>
            {items.map((p, j) => (
              <PredicateRow key={j} p={p} onChange={(np) => setItems(replaceAt(items, j, np))} onRemove={items.length > 1 ? () => setItems(items.filter((_, k) => k !== j)) : undefined} />
            ))}
            <Add label="Add condition" onClick={() => setItems([...items, { kind: "tag", op: "has", tag: "" }])} />
          </div>
        );
      })}
      <Add
        label="Add else-if branch"
        onClick={() =>
          onChange({
            ...node,
            branches: [...node.branches, { id: uid(), filter: { operator: "AND", groups: [{ operator: "AND", items: [{ kind: "tag", op: "has", tag: "" }] }] }, target: null }],
          })
        }
      />
    </div>
  );
}

const FIELD_OPS = ["is", "is_not", "contains", "not_contains", "starts_with", "has_value", "is_unknown", "gt", "lt"] as const;

function PredicateRow({ p, onChange, onRemove }: { p: Predicate; onChange: (p: Predicate) => void; onRemove?: () => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      <select
        value={p.kind}
        onChange={(e) => onChange(e.target.value === "tag" ? { kind: "tag", op: "has", tag: "" } : { kind: "field", key: "", op: "is", value: "" })}
        className={input}
      >
        <option value="tag">Tag</option>
        <option value="field">Field</option>
      </select>
      {p.kind === "tag" ? (
        <>
          <select value={p.op} onChange={(e) => onChange({ ...p, op: e.target.value as typeof p.op })} className={input}>
            <option value="has">has</option>
            <option value="not_has">doesn&apos;t have</option>
          </select>
          <input value={p.tag} placeholder="tag" onChange={(e) => onChange({ ...p, tag: e.target.value })} className={input} />
        </>
      ) : (
        <>
          <input value={p.key} placeholder="field (e.g. email)" onChange={(e) => onChange({ ...p, key: e.target.value })} className={input} />
          <select value={p.op} onChange={(e) => onChange({ ...p, op: e.target.value as typeof p.op })} className={input}>
            {FIELD_OPS.map((o) => (
              <option key={o} value={o}>
                {o.replace("_", " ")}
              </option>
            ))}
          </select>
          {p.op !== "has_value" && p.op !== "is_unknown" && (
            <input value={String(p.value ?? "")} placeholder="value" onChange={(e) => onChange({ ...p, value: e.target.value })} className={input} />
          )}
        </>
      )}
      {onRemove && <Remove onClick={onRemove} />}
    </div>
  );
}

export const input = "min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1";

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Add({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="self-start rounded border border-dashed border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
      + {label}
    </button>
  );
}

export function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove" className="px-1 text-zinc-400 hover:text-red-600">
      ✕
    </button>
  );
}

export function replaceAt<T>(arr: readonly T[], i: number, v: T): T[] {
  return arr.map((x, j) => (j === i ? v : x));
}
