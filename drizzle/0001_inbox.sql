CREATE TABLE "thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee_user_id" text,
	"unread" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_message_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_user_id" text,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_assignee_user_id_user_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_note" ADD CONSTRAINT "thread_note_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_note" ADD CONSTRAINT "thread_note_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_note" ADD CONSTRAINT "thread_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_contact_id_index" ON "thread" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "thread_workspace_id_status_last_message_at_index" ON "thread" USING btree ("workspace_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "thread_note_thread_id_created_at_index" ON "thread_note" USING btree ("thread_id","created_at");--> statement-breakpoint
INSERT INTO "thread" ("workspace_id", "contact_id", "last_message_at", "last_message_text")
SELECT DISTINCT ON ("contact_id") "workspace_id", "contact_id", "created_at", "text"
FROM "message_log"
ORDER BY "contact_id", "created_at" DESC;
