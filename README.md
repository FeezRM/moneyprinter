# Moneyprinter

Instagram DM automation: comment-to-DM, DM keyword replies, story replies and mentions, a visual flow builder, and a contacts CRM. The feature research behind it is in [docs/manychat-teardown.md](docs/manychat-teardown.md).

## Stack

- Next.js 16 (App Router, Cache Components) for the dashboard, server actions and webhook routes
- Postgres with Drizzle ORM
- graphile-worker, a Postgres-backed job queue for webhook processing, smart delays and chained automations
- Better Auth for email and password sign-in, with one workspace per account
- React Flow (`@xyflow/react`) for the builder canvas
- Vitest for unit tests and Postgres integration tests

## Local setup

```bash
pnpm install
pnpm db:start        # project-local Postgres in .data/pg on port 5433
cp .env.example .env # then fill in the values (see below)
pnpm db:migrate      # app tables + graphile-worker schema
pnpm dev --port 3100 # web app
pnpm worker          # job worker, in a second terminal
```

`BETTER_AUTH_URL` must match the URL you open in the browser. The default is `http://localhost:3100`.

### Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgres://postgres@localhost:5433/moneyprinter` for the local cluster |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | Public base URL of the app |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | From Meta App Dashboard → Instagram → API setup with Instagram login |
| `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Any random string; enter the same value in Meta's webhook settings |
| `INSTAGRAM_GRAPH_VERSION` | Defaults to `v25.0` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`; encrypts stored Instagram tokens (AES-256-GCM) |

## Connecting a real Instagram account

1. In the Meta app, add **Instagram → API setup with Instagram login**.
2. Add `{BETTER_AUTH_URL}/api/instagram/callback` as an OAuth redirect URI.
3. Set the webhook callback to `{BETTER_AUTH_URL}/api/webhooks/instagram` with your verify token, and subscribe to `comments`, `messages` and `messaging_postbacks`. Meta needs a public HTTPS URL; for local work, use a tunnel such as `cloudflared` or `ngrok`, and set `BETTER_AUTH_URL` to the tunnel URL.
4. In the app, go to **Settings → Connect Instagram** with a Business or Creator account. The account must be an app tester until App Review passes.
5. Going live for other accounts requires Business Verification and App Review for `instagram_business_basic`, `instagram_business_manage_messages` and `instagram_business_manage_comments`.

## How it works

1. `POST /api/webhooks/instagram` verifies `X-Hub-Signature-256`. It then stores the raw body, deduplicated by hash, and enqueues `process_webhook` in the same transaction.
2. The worker normalizes events (`src/instagram/webhook.ts`) and upserts the contact. It claims each event by inserting its inbound `message_log` row, which is unique on Meta's message or comment ID, so redeliveries never trigger a second reply.
3. The worker then selects a trigger (`src/triggers/match.ts`) and runs the published flow with the pure engine (`src/flow/engine.ts`). The resulting effects are applied in `src/services/runs.ts`.

Instagram's rules are enforced in code:

- **Private replies:** one private reply per comment.
- **24-hour window:** normal DMs only go out inside the window opened by the contact's last message. A comment doesn't open it, but tapping a private reply's button does.
- **Smart delays:** become `resume_run` jobs.
- **Failed sends:** fail the run rather than retry, so contacts never receive duplicates.

Automations have a draft and a published snapshot. Trigger edits stay in the draft until **Publish**.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm test` | Unit + integration tests (recreates `moneyprinter_test` on the local cluster) |
| `pnpm typecheck` | Route typegen + `tsc` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | New Drizzle migration after editing `src/db/schema.ts` |
