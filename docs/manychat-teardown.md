# ManyChat teardown and clone plan

Researched 2026-10-16 inside the owner's ManyChat account (Pro, legacy plan, Instagram connected) using Claude in Chrome, following REA's investigation method: a question checklist, evidence tied to each claim, and observations kept separate from inferences and unknowns.

## Method and boundaries

- **Browser:** Claude in Chrome on the owner's signed-in session. Nothing was published, sent, connected or changed.
- **Side effects:**
  - Opening one Inbox thread probably marked it read.
  - One existing flow was opened in edit mode and left with no changes.
  - With the owner's approval, one throwaway draft automation ("Untitled") was created to inspect the step editors, then deleted. It sits in ManyChat's Trash, which was not emptied.
- **Data model evidence:** A page-local XHR wrapper recorded the JSON the app itself fetched. Only key names and types were kept; contact PII was not extracted. Re-requesting the endpoints directly returned 404 HTML, so the app sends headers or tokens that weren't reproduced.
- **Static evidence:** A string inventory of the shipped JS bundle (111 scripts, about 3.4 MB). The action catalog is lazy-loaded, so only `add_tag` and `remove_tag` were confirmed there.
- **REA:** REA's headless `capture_browser_scenario` against manychat.com was stopped by a Cloudflare bot check (evidence: page title "Performing security verification"). It was not bypassed.

Tags used below: **[O]** observed in UI or JSON, **[I]** inferred, **[U]** unknown or not observed.

## 1. Information architecture [O]

- **Sidebar:** Home, Contacts, Automation, Manychat AI, Inbox, Settings.
- **Broadcasts:** at `/{page}/posting`, which is no longer in the sidebar.
- **Automation sub-nav:** My Automations (folders, search, trigger-type and trigger-state filters, list or grid, Trash), Basic, Sequences.
- **Routing:** All API routes are scoped by account, as `/{fb<page_id>}/<module>/<verb>`. Examples: `cms/getFlows`, `flow/getFlowData`, `subscribers/search`, `im/loadThreads`, `customFields/list`.

## 2. Automations (flows)

### Data model [O]

**Flow**

- `ns`: a namespace string such as `content20250402023528_396915`.
- Basic fields: `name`, `root_content_id`, `status`, and `has_unpublished_changes` / `has_published_content`. Drafts and published versions are separate, and there is version history (beta).
- Per-channel usage flags: `facebook`, `instagram`, `whatsapp`, `tiktok`, `telegram`, `sms`, `email`.
- Sharing (share hash, cloning, player embed URL).
- Stats: `sent`, `delivered`, `read`, `clicked`, unique and total.
- Layout: `coordinates` and `draft_coordinates`, a map of node `_oid` (UUID) to `{x, y}`.

**Content node** (`contents[]`)

- Identity: `content_id`, `type` (the channel, such as `instagram`), `caption`.
- `data`:
  - `messages[]`: each message has `type` (`text`, `attachment`), `content`, and `keyboard[]` (buttons).
  - `message_tag`
  - `target`: the next node.
  - `private_reply`
  - `one_time_notify_reason_id`
- Per-node stats, each linked to a segment ID (for example `content:clicked_<id>`). Any stat (sent, delivered, read, clicked) can be clicked open as an audience.

**Button**

- `type: "content"`, with `content_id` / `_content_oid` pointing to the target node.
- `caption`, `actions[]` (actions run on click) and `button_click_stats`.

**Attachment**

- `content.type: "image"`, plus `img_big`, `img_small`, `img_original` and a signed URL.

### Trigger buckets on a flow [O]

The flow's triggers are grouped into these buckets:

| Bucket | Bucket | Bucket |
|---|---|---|
| widgets | keywords | trigger_rules |
| external_triggers | another_flow | default_replies |
| follow_reply | story_mentions | welcome_messages |
| follow_ups | conversation_starters | intents |
| cart_replies | | |

### Comment trigger (widget `feed_comment_trigger`) [O]

- `post_id`, or any post.
- `track_root_comment_only`
- `include_keywords_array` and `exclude_keywords_array`
- `comment_contains` (`specific_words` or any)
- Cached `post_data`: caption, permalink, media type, thumbnail.
- `public_reply_messages[]`: several variants, which [I] are rotated so the public replies don't all look identical.
- Per-trigger `runs` and `ctr`.

### Keyword rule [O]

- `keyword_rules[]`, each `{keywords[], condition}` where `condition` is `contains`, etc.
- `channel`, `status` (`draft` or `active`).

### Trigger catalog (Instagram) [O]

- Post or Reel comments
- Story reply
- Instagram message (DM keyword)
- Instagram Ads click
- Live comments
- Ref URL

**Contact events:**

- New contact created
- Custom field changed
- System field changed
- Tag applied
- Tag removed
- Subscribed to a sequence
- Unsubscribed from a sequence
- Date/time occurred

**Channel-level triggers** (in Settings): Default Reply, Main Menu, Conversation Starters, Opt-in ("Start"/"Subscribe"), Opt-out ("Stop"/"Unsubscribe"), Story Mention Reply, and "Say hi to new followers" (beta).

### Step catalog (the "+" menu) [O]

- Trigger
- Send Message (per channel), plus Add Channel
- Start Automation
- AI Step
- Actions
- Condition
- Randomizer
- Smart Delay
- Comment (a canvas note)

### Send Message editor [O]

- "Send as Private Reply" toggle. When it is on, the editor allows only one text message.
- Text editor with AI "Improve", emoji picker, `{}` variables and a 1,000-character counter.
- "+ Add Button" and "+ Add Quick Reply".
- The full block list in normal mode was not observed [U].

### Builder UX [O]

- Canvas with a "When…" trigger card that can hold several triggers.
- Edges run from buttons or "Next Step" handles.
- Per-node live stats: Sent, Delivered, Opened, Clicked.
- Key-metrics side panel: sends, unique contacts, emails, phones.
- Autosave ("Saved"), undo/redo, Preview, Publish, and a "Go To Basic Builder" alternative (a linear editor).
- Quick Automations: templates such as "Auto-DM links from comments" and "Generate leads with stories".

### Step editors (observed in a throwaway draft) [O]

**New automation entry points**

- Templates gallery, filterable by goal or by trigger.
- "Start From Scratch", which starts from a trigger (comment, story reply, DM), a blank canvas, or "Start with AI".
- The canvas also has a "Create with AI" prompt box.

**Draft persistence**

- `cms/createFlow` creates the flow.
- `flow/setDraft` runs once, then incremental `flow/patchDraft` calls send `{ns, batch: {contents: [changed nodes]}, coordinates, client_id}`.
- Publishing is the separate "Set Live" button.

**Actions step** (`type: "action_group"`, `actions[]`, `target`)

The catalog, by category:

| Category | Actions |
|---|---|
| Contact data | Add Tag, Remove Tag, Set User Field, Clear User Field, Delete Contact, Set Instagram Opt-in, Set Instagram Opt-out |
| Automation | Set Bot Field, Subscribe to Sequence, Unsubscribe from Sequence, Make External Request, Log Conversion Event, Update Instagram Custom Audience, Pause all automations |
| Inbox | Mark conversation Open, Mark conversation Closed, Assign conversation, Notify Assignees |
| Ads Optimization | Meta Conversions API events (requires CAPI to be connected in channel settings) |
| Google Sheets | Insert row, Get row by value, Update row |

**External Request** (`type: "external_request"`)

- Method: GET, POST, PUT or DELETE.
- URL: HTTPS only, and accepts `{}` variables.
- "Contact for testing", plus tabs for Headers, Body, Response and Response mapping.
- Body: a JSON editor with a live preview, "+ Add Full Contact Data" and "{+} Add a Field".
- Response mapping (JSON response values into contact fields) is enabled only after "Test Request" returns a real response.

**Condition step** (`type: "multi_condition"`)

- The header question is "Does the contact match all/any of the following conditions?"
- Structure: `conditions[]`, each a `{filter, target}` pair, plus `default_target`. This makes it an if / else-if / else chain: "Yes, the contact matches", then "If not", then "+ Add Another Condition", then a final fallback step.
- Each `filter` uses the same DSL as segments and the inbox, for example `{type: "suf", field: "email", operator: "IS_UNKNOWN", value: null, case_sensitive}`.
- Recommended pickers: Tag, Email, **Follows your account** (the follow-gate check).
- Other pickers: General Filters, System Fields, Custom User Fields.
- Text operators: is, isn't, has any value, contains, doesn't contain, begins with, is unknown.

**Smart Delay** (`type: "smart_delay"`)

- Duration mode:
  - Wait for N seconds, minutes, hours or days. The default is **23 hours**, which [I] keeps the follow-up inside the 24-hour window.
  - N can be a numeric contact-field formula. The maximum is 365 days.
  - "Send within specific hours" (`limit_time`) uses the contact's local time zone, or the account's if theirs is unknown.
- Date mode:
  - Wait until a specific date or a dynamic date taken from a field.
  - "Automation stops here if the date has already passed."
  - Stored as `wait_until {value, is_formula}`.

**Randomizer** (`type: "split"`)

- `variants[]` of `{data: {title, color}, percent, target}`. The default is A/B at 50/50, with "+ New Variation" for more.
- `randomized` maps to the "Pick a random path every time" toggle. When it's off, [I] each contact keeps their first path.

**Automation row menu:** Rename, Duplicate, Convert channels, Move to, Duplicate to another page, Delete. Delete goes to Trash.

## 3. Contacts / CRM [O]

**One unified contact record per person**, with:

- Per-channel identity: `fb_psid`, `ig_id`/`ig_username`, `wa_id`, `tg_username`, `tt_user_id`.
- Per-channel opt-in and status: `optin_ig`, `ig_status`, …
- Messaging-window timestamps: `ts_wa_customer_service_window_until`, `ts_wa_free_entry_point_until`, `ts_wa_response_window_until`, and "Window Open Until in Instagram".
- Human-takeover pause: `ts_automation_paused_until` and `ts_automation_paused_forever`.
- `optin_source`, locale, language, timezone, and last interaction or last seen per channel.

**Fields**

- System fields: about 30, including follower count, phone country, US state from phone, and SMS opt-in.
- Custom user fields: typed (`boolean`, `text`, …) and foldered.
- Global (bot) fields.
- Integration fields and AI fields.

**Page sidebar:** Segments (saved filters), Tags, Widgets (opt-in sources), and Sequences, each with contact counts.

**Table:** search, bulk actions, import, create contact. The search response includes `billable_contacts`.

**Filter DSL**, which the Inbox uses as well:

```
{operator: AND, groups: [{operator: OR, items: [{type, field, operator: IS, value}]}]}
```

## 4. Inbox [O]

- **Views:** All chats, Reminders, and Labels. Labels can carry their own filter and an `ai_intent` for AI auto-labeling.
- **List filters:** status (new, opened, closed), unread, sort, channel.
- **Thread actions:**
  - Assign
  - Labels
  - "Remind me in"
  - Mark Closed / Mark Unread
  - **Pause automation**
  - Contact panel
  - "All Channels History"
- **Composer:**
  - Reply versus internal **Note**
  - Emoji, image, file and audio
  - Send a flow
  - Snippets (`im/liveChatSnippet`)
  - Scheduling, available once the thread is assigned to yourself
- Automated messages are marked with an automation icon in the thread.
- **Inbox settings:** Inbox Behavior and Auto-Assignment.
- **Seats:** Inbox seats are a **$99/month add-on**.

## 5. Broadcasts, sequences, AI

- **Broadcasts [O]:**
  - "New Broadcast" and "Broadcast From Automation", sent immediately or scheduled.
  - **Instagram is not a broadcast channel.** On an Instagram-only account, "New Broadcast" opens a "Connect Channel" dialog that offers only Messenger, SMS, Email, Telegram and WhatsApp. This is [I] why Broadcasts is missing from the sidebar.
  - The composer itself was not reached, because it needs one of those channels connected [U].
- **Sequences [O]:** drip campaigns with subscribe and unsubscribe. The account has one.
- **Manychat AI [O]:** beta, Instagram only, **$29/month add-on**.
  - AI Replies: from a knowledge base you provide.
  - AI Comments: replies in a tone you set.
  - AI Goals: steer the conversation toward leads, follows or clicks.
  - There is also an "AI Step" in flows and "Improve" in the text editor.

## 6. Settings and platform [O]

- **General:** link shortener (`My.Manychat.Com`, needed for click-through-rate tracking), time zone, Clone to Another Account, Use as Template (share a snapshot by link).
- **Team:** Team Members with roles, plus Logs.
- **Channels:** Instagram, TikTok, WhatsApp, Messenger, SMS, Email, Telegram.
- **Instagram connection:** either "Instagram OAuth" or "Meta for Business", the second unlocking the full feature set. Also Refresh Permissions, Disable, and Remove (which deletes that channel's contacts). Meta Conversions API is configured here too.
- **Automation:** Fields, Tags, Conversion Events.
- **Extensions:** API (API secret), Apps (App Store), Payments, Installed Templates, Pixel.
- **Integrations:** Google Sheets, HubSpot, Klaviyo, ActiveCampaign, MailChimp, Kit, Flodesk, Hotmart, TikTok Ads, and bring-your-own LLM keys for **ChatGPT, Claude and DeepSeek**.

## 7. Pricing (current public page, read 2026-10-16) [O]

| Plan | Price (annual) | Active contacts/mo | Notes |
|---|---|---|---|
| Free | $0 | 25 | 2 channels, 4 automations, branding |
| Essential | $14 | 250 | 2 channels, 2 users |
| Pro | $29 | 2,500 | 3 channels, broadcasts, AI convos, 3 users |
| Business | $69 | 7,500 | Unlimited channels, shared inbox, 5 users |
| Advanced | $139 | 25,000 | 10 users |

- **Overage:** billed per extra active contact (rate not shown publicly [U]).
- **Legacy plan on this account:** Pro at $15/month for 500 contacts, plus the Inbox seat add-on at $99/month and the AI add-on at $29/month.
- **Active contact:** anyone messaged or messaging in the month.

---

# Clone plan

## Positioning

Same core workflow, priced on what it actually costs to serve:

- A generous free tier.
- Flat paid tiers.
- Meta, WhatsApp and SMS fees passed through **at cost**.
- AI as bring-your-own key or at-cost credits.
- Inbox seats included rather than sold at $99.

## MVP scope (Instagram first; ManyChat's core use case)

1. **Instagram connection.** Instagram Login plus webhooks for messages, comments, story replies and story mentions. Add follows once the permission is approved.
2. **Triggers:**
   - Comment on a post or reel, for a specific post or any post, with include/exclude keywords, root comments only, a private reply, and rotating public replies.
   - DM keyword: `is`, `contains` or `starts with`.
   - Story reply.
   - Story mention.
   - Ref URL.
   - Default reply.
   - Conversation starters.
   - Opt-in and opt-out keywords.
3. **Flow builder** (React Flow canvas):
   - Steps: Send Message (text, image, buttons, quick replies), Condition, Actions (tag, field, sequence, notify, HTTP request), Smart Delay, Randomizer, Start Automation, Comment note.
   - Behaviour: separate draft and published versions, autosave, preview, and per-node stats that can become a segment.
4. **Contacts:**
   - A unified contact with per-channel identities and messaging-window timestamps.
   - Tags and typed custom fields.
   - Segments built on the filter DSL above.
   - CSV import and export.
5. **Inbox:**
   - Threads with status, assignment, labels and notes.
   - Pause automation on human takeover.
   - Snippets and reminders.
6. **Billing:** Stripe, metered on active contacts.

## Phase 2 and later

- **Phase 2:**
  - Messenger.
  - WhatsApp: Embedded Signup, a template manager, and a per-message cost preview before sending.
  - Broadcasts gated by messaging-window and template rules.
  - Sequences.
  - Link shortener with click tracking.
  - Conversion events.
  - Templates, clone account, and share-as-template.
- **Phase 3:**
  - AI step, AI replies and AI comment replies, using bring-your-own keys.
  - AI intent labels.
  - Public API and webhooks.
  - Integrations: Sheets, HubSpot, Klaviyo, Zapier and Make.
  - TikTok, Telegram, SMS and email.

## Data model (initial)

- `workspace`, `channel_connection` (platform, external id, tokens, scopes)
- `contact` (identity per channel, opt-in and status per channel, `window_until` per channel, `automation_paused_until`), `contact_field_value`, `tag`, `contact_tag`, `field_def`
- `flow` (ns, draft_json, published_json, version), `flow_version`
- `trigger` (type, channel, config JSON, status, flow_id)
- `run` (contact, flow, current_node, state, `wake_at`), `message_log` (direction, channel, node_id, delivered/read/clicked)
- `thread` (status, assignee, labels, reminder), `note`, `snippet`
- `segment` (filter DSL JSON), `broadcast`, `sequence`, `sequence_step`
- `usage_month` (active contact counter per workspace)

## Stack (recommended)

- **Language:** TypeScript monorepo.
- **App:** Next.js (App Router) for the dashboard, API and webhook receivers.
- **Database:** Postgres (Neon) with Drizzle.
- **Flow engine:** a worker that interprets flow JSON per contact run. Durable waits (Smart Delay, sequences, scheduled broadcasts) and rate-limited send queues run on a **Postgres-backed job queue** (graphile-worker or pg-boss), so there is no extra queue service and costs stay predictable.
- **Webhook path:** verify the signature, write to an inbox table, enqueue, and return 200 quickly. Meta retries, so processing must be idempotent on message ID.
- **Builder:** @xyflow/react (React Flow). **UI:** shadcn/ui. **Auth:** Better Auth or Clerk. **Billing:** Stripe usage records.
- **Hosting:** Vercel for the web app and webhooks, plus one small always-on worker on Fly, Railway or Hetzner.
- **All-serverless alternative:** Vercel Queues plus Workflow. This needs no server to look after, but cost per operation at high message volume is unverified.

## Pricing proposal

| Plan | Price | Active contacts/mo | Includes |
|---|---|---|---|
| Free | $0 | 1,000 | All channels, unlimited automations, 1 seat, small "Powered by" footer |
| Pro | $9/mo | 10,000 | No branding, broadcasts, sequences, 3 seats, API |
| Team | $29/mo | 50,000 | 10 seats, shared inbox, auto-assignment, roles |

- **Overage:** $3 per extra 1,000 contacts.
- **WhatsApp and SMS:** passed through at Meta or carrier cost.
- **AI:** bring your own key free, or at-cost credits.

For comparison, ManyChat Pro is $29 for 2,500 contacts and Business is $69 for 7,500. The prices proposed here assume webhook processing plus Postgres costs well under $0.001 per active contact per month. **That assumption needs a load test before launch.**

## Platform constraints and risks (these set the schedule)

- **Meta approvals.** Meta App Review plus Business Verification is required for `instagram_business_manage_messages`, `instagram_business_manage_comments`, `pages_messaging` and WhatsApp messaging. WhatsApp onboarding of customer accounts also needs Tech Provider status. **Start this on day 1; it takes weeks.**
- **24-hour window.** Instagram and Messenger allow only 24 hours after the user's last message. The `HUMAN_AGENT` tag (7 days) is for human replies only. Broadcasts outside the window need WhatsApp templates or Messenger marketing opt-ins.
- **Private replies.** One per comment, within 7 days of the comment. Third-party sources say the limit is about 750 per hour per account [U, verify in Meta docs].
- **New-follower DM.** ManyChat flags this as needing updated Instagram permissions [O]. The permission name is [U].
- **WhatsApp pricing.** Per message by category and country since 2025-07-01. Third-party sources report that service messages become billable on 2026-10-01 [U, verify on Meta's rate card].
- **Abuse.** A free tier invites spam, and spam can get the whole Meta app restricted. Rate-limit per workspace and screen new accounts.
- **Legal.** Build our own UI and copy rather than copying ManyChat's code, assets or text. This teardown records feature behaviour and data shapes only.

## Open questions

- Broadcast composer: inspecting it needs Messenger, WhatsApp, SMS, Email or Telegram connected to the ManyChat account.
- Operators for number, date and boolean conditions (only text operators were observed).
- Sequences editor and Basic builder.
- Product name and domain.
- Hosting choice: worker host, or all-Vercel.
