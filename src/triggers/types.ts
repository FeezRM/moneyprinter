import { z } from "zod";

export const keywordRuleSchema = z.object({
  match: z.enum(["is", "contains", "starts_with"]),
  keywords: z.array(z.string().min(1)).min(1),
});

export const triggerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ig_comment"),
    // null = any post or reel.
    mediaId: z.string().min(1).nullable(),
    // Empty = any comment.
    includeKeywords: z.array(z.string().min(1)).default([]),
    excludeKeywords: z.array(z.string().min(1)).default([]),
    rootCommentsOnly: z.boolean().default(true),
    // One is picked at random per comment so public replies don't look identical.
    publicReplies: z.array(z.string().min(1).max(300)).max(10).default([]),
  }),
  z.object({ type: z.literal("ig_dm_keyword"), rules: z.array(keywordRuleSchema).min(1) }),
  z.object({
    type: z.literal("ig_story_reply"),
    // Empty = any story reply.
    rules: z.array(keywordRuleSchema).default([]),
  }),
  z.object({ type: z.literal("ig_story_mention") }),
  z.object({ type: z.literal("ig_default_reply") }),
]);

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;
export type TriggerType = TriggerConfig["type"];
export type KeywordRule = z.infer<typeof keywordRuleSchema>;
