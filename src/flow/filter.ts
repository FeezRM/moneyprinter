import { z } from "zod";

// Segment / condition DSL: AND/OR of groups, each an AND/OR of predicates.
export const predicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tag"), op: z.enum(["has", "not_has"]), tag: z.string().min(1) }),
  z.object({
    kind: z.literal("field"),
    key: z.string().min(1),
    op: z.enum(["is", "is_not", "contains", "not_contains", "starts_with", "has_value", "is_unknown", "gt", "lt"]),
    value: z.union([z.string(), z.number(), z.boolean()]).nullable().default(null),
  }),
]);

export const filterSchema = z.object({
  operator: z.enum(["AND", "OR"]),
  groups: z
    .array(z.object({ operator: z.enum(["AND", "OR"]), items: z.array(predicateSchema).min(1) }))
    .min(1),
});

export type Predicate = z.infer<typeof predicateSchema>;
export type Filter = z.infer<typeof filterSchema>;

export type ContactSnapshot = {
  tags: ReadonlySet<string>;
  // Custom fields plus system fields (e.g. `ig_username`) under one namespace.
  fields: Readonly<Record<string, string | number | boolean | null | undefined>>;
};

export function evaluateFilter(filter: Filter, contact: ContactSnapshot): boolean {
  const groupResults = filter.groups.map((g) => {
    const results = g.items.map((p) => evaluatePredicate(p, contact));
    return g.operator === "AND" ? results.every(Boolean) : results.some(Boolean);
  });
  return filter.operator === "AND" ? groupResults.every(Boolean) : groupResults.some(Boolean);
}

function evaluatePredicate(p: Predicate, contact: ContactSnapshot): boolean {
  if (p.kind === "tag") {
    const has = contact.tags.has(p.tag);
    return p.op === "has" ? has : !has;
  }
  const actual = contact.fields[p.key];
  const known = actual !== null && actual !== undefined && actual !== "";
  switch (p.op) {
    case "has_value":
      return known;
    case "is_unknown":
      return !known;
    case "is":
      return known && norm(actual) === norm(p.value);
    case "is_not":
      return !known || norm(actual) !== norm(p.value);
    case "contains":
      return known && norm(actual).includes(norm(p.value));
    case "not_contains":
      return !known || !norm(actual).includes(norm(p.value));
    case "starts_with":
      return known && norm(actual).startsWith(norm(p.value));
    case "gt":
    case "lt": {
      const a = Number(actual);
      const b = Number(p.value);
      if (!known || Number.isNaN(a) || Number.isNaN(b)) return false;
      return p.op === "gt" ? a > b : a < b;
    }
  }
}

function norm(v: string | number | boolean | null | undefined): string {
  return String(v ?? "").trim().toLowerCase();
}
