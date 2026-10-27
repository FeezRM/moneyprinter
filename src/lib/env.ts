import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  INSTAGRAM_APP_ID: z.string().min(1),
  INSTAGRAM_APP_SECRET: z.string().min(1),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  INSTAGRAM_GRAPH_VERSION: z.string().default("v25.0"),
  // 32-byte key, base64-encoded; encrypts channel access tokens at rest.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Parsed lazily so `next build` and tooling don't require runtime secrets.
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
