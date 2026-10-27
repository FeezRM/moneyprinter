import { describe, expect, it } from "vitest";
import { evaluateFilter, type Filter } from "./filter";

const contact = { tags: new Set(["lead"]), fields: { email: "A@x.com", budget: 500, empty: "" } };

const one = (item: Filter["groups"][number]["items"][number]): Filter => ({
  operator: "AND",
  groups: [{ operator: "AND", items: [item] }],
});

describe("evaluateFilter", () => {
  it.each([
    [{ kind: "tag", op: "has", tag: "lead" }, true],
    [{ kind: "tag", op: "not_has", tag: "lead" }, false],
    [{ kind: "field", key: "email", op: "is", value: "a@x.com" }, true],
    [{ kind: "field", key: "email", op: "contains", value: "@X." }, true],
    [{ kind: "field", key: "email", op: "starts_with", value: "b" }, false],
    [{ kind: "field", key: "empty", op: "is_unknown", value: null }, true],
    [{ kind: "field", key: "missing", op: "has_value", value: null }, false],
    [{ kind: "field", key: "missing", op: "is_not", value: "x" }, true],
    [{ kind: "field", key: "budget", op: "gt", value: 100 }, true],
    [{ kind: "field", key: "email", op: "lt", value: 3 }, false],
  ] as const)("%o -> %s", (item, expected) => {
    expect(evaluateFilter(one(item as never), contact)).toBe(expected);
  });

  it("combines groups with OR", () => {
    const f: Filter = {
      operator: "OR",
      groups: [
        { operator: "AND", items: [{ kind: "tag", op: "has", tag: "nope" }] },
        { operator: "AND", items: [{ kind: "tag", op: "has", tag: "lead" }] },
      ],
    };
    expect(evaluateFilter(f, contact)).toBe(true);
  });
});
