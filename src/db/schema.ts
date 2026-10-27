import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Flow } from "@/flow/types";
import type { TriggerConfig } from "@/triggers/types";

// ---------- Better Auth core tables ----------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Workspaces ----------

export const workspace = pgTable("workspace", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "agent"] }).notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index().on(t.userId)],
);

// ---------- Channels ----------

export const channelPlatform = pgEnum("channel_platform", ["instagram"]);

export const channelConnection = pgTable(
  "channel_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    platform: channelPlatform("platform").notNull(),
    // Instagram professional account id: matches webhook `entry[].id`.
    externalId: text("external_id").notNull(),
    username: text("username"),
    accessTokenEnc: text("access_token_enc").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: text("status", { enum: ["active", "disabled", "error"] }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.platform, t.externalId), index().on(t.workspaceId)],
);

// ---------- Contacts / CRM ----------

export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name"),
    igsid: text("igsid"),
    igUsername: text("ig_username"),
    igOptIn: boolean("ig_opt_in").notNull().default(true),
    // Instagram allows standard messaging until 24h after the contact's last message.
    igWindowUntil: timestamp("ig_window_until", { withTimezone: true }),
    lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
    automationPausedUntil: timestamp("automation_paused_until", { withTimezone: true }),
    fields: jsonb("fields").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.igsid), index().on(t.workspaceId, t.createdAt)],
);

export const tag = pgTable(
  "tag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.name)],
);

export const contactTag = pgTable(
  "contact_tag",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index().on(t.tagId)],
);

export const fieldDef = pgTable(
  "field_def",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: ["text", "number", "boolean", "date"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.workspaceId, t.key)],
);

// ---------- Automations ----------

export const automation = pgTable(
  "automation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    draft: jsonb("draft").$type<Flow>().notNull(),
    // Trigger edits stay in the draft until publish syncs them to `trigger`.
    draftTriggers: jsonb("draft_triggers").$type<TriggerConfig[]>().notNull().default([]),
    // Snapshot the engine executes; null until first publish.
    published: jsonb("published").$type<Flow>(),
    publishedVersion: integer("published_version").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId, t.updatedAt)],
);

export const trigger = pgTable(
  "trigger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    config: jsonb("config").$type<TriggerConfig>().notNull(),
    // Denormalised from config.type for indexed lookup during webhook processing.
    type: text("type").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.workspaceId, t.type, t.active), index().on(t.automationId)],
);

export const flowRun = pgTable(
  "flow_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    automationVersion: integer("automation_version").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    triggerId: uuid("trigger_id").references(() => trigger.id, { onDelete: "set null" }),
    status: text("status", {
      enum: ["running", "waiting_input", "waiting_delay", "completed", "failed", "cancelled"],
    }).notNull(),
    currentNodeId: text("current_node_id"),
    // Per-run context, e.g. the comment id a private reply must target.
    context: jsonb("context").$type<RunContext>().notNull().default({}),
    // Randomizer choices per node, for sticky splits.
    splitChoices: jsonb("split_choices").$type<Record<string, string>>().notNull().default({}),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.contactId, t.status), index().on(t.automationId)],
);

export type RunContext = {
  commentId?: string;
  privateReplyUsed?: boolean;
};

export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    channel: channelPlatform("channel").notNull(),
    externalId: text("external_id"),
    text: text("text"),
    payload: jsonb("payload"),
    flowRunId: uuid("flow_run_id").references(() => flowRun.id, { onDelete: "set null" }),
    nodeId: text("node_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.contactId, t.createdAt),
    uniqueIndex().on(t.channel, t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

// ---------- Inbox ----------

// One live-chat thread per contact; upserted whenever a message is logged.
export const thread = pgTable(
  "thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    unread: boolean("unread").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    lastMessageText: text("last_message_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.contactId), index().on(t.workspaceId, t.status, t.lastMessageAt)],
);

// Internal notes are visible to the team only and are never sent to the contact.
export const threadNote = pgTable(
  "thread_note",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.threadId, t.createdAt)],
);

// ---------- Webhook intake ----------

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: channelPlatform("platform").notNull(),
    // sha256 of the raw body; Meta retries deliveries for up to 36h.
    bodyHash: text("body_hash").notNull(),
    body: jsonb("body").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.platform, t.bodyHash)],
);

// ---------- Usage (billing basis) ----------

export const activeContactMonth = pgTable(
  "active_contact_month",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    // First day of the month, UTC.
    month: timestamp("month", { mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.month, t.contactId] })],
);
