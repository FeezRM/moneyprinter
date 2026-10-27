import { z } from "zod";

export const PAUSE_OPTIONS = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "24 hours" },
] as const;

const filterSchema = z.object({
  status: z.enum(["open", "closed"]).catch("open"),
  unread: z.literal("1").optional().catch(undefined),
  mine: z.literal("1").optional().catch(undefined),
});

export type InboxFilter = z.infer<typeof filterSchema>;

export function parseFilter(searchParams: Record<string, string | string[] | undefined>): InboxFilter {
  return filterSchema.parse(searchParams);
}

export function filterQuery(f: InboxFilter, change: Partial<InboxFilter> = {}): string {
  const next = { ...f, ...change };
  const q = new URLSearchParams({ status: next.status });
  if (next.unread) q.set("unread", next.unread);
  if (next.mine) q.set("mine", next.mine);
  return `?${q}`;
}
