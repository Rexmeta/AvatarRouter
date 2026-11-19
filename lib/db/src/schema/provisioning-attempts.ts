import { pgTable, text, uuid, integer, smallint, timestamp, index } from "drizzle-orm/pg-core";

export const provisioningAttemptStates = ["active", "finished", "result_unknown"] as const;
export const provisioningCallStates = ["not_started", "reserved", "started", "returned", "result_unknown"] as const;
export const provisioningAttemptStages = [
  "attempt", "image_preparation", "gemini_generate", "provider_create",
  "provider_status", "provider_delete", "persistence",
] as const;
export const provisioningAttemptEvents = [
  "started", "completed", "failed", "skipped", "call_reserved",
  "call_started", "call_returned", "call_result_unknown", "call_blocked",
  "finished", "recovered_unknown",
] as const;

/**
 * One compact durable snapshot per worker attempt. It intentionally stores no
 * provider response, prompt, image, URL, credential, persona name, or tenant data.
 */
export const provisioningAttempts = pgTable("provisioning_attempts", {
  attemptId: uuid("attempt_id").primaryKey(),
  assetId: text("asset_id").notNull(),
  providerId: text("provider_id", { enum: ["anam", "tavus"] }).notNull(),
  sourceBuildId: text("source_build_id").notNull(),
  state: text("state", { enum: provisioningAttemptStates }).notNull(),
  stage: text("stage", { enum: provisioningAttemptStages }).notNull(),
  event: text("event", { enum: provisioningAttemptEvents }).notNull(),
  sequence: integer("sequence").notNull(),
  elapsedMs: integer("elapsed_ms").notNull().default(0),
  geminiCallsStarted: smallint("gemini_calls_started").notNull().default(0),
  geminiCallState: text("gemini_call_state", { enum: provisioningCallStates }).notNull().default("not_started"),
  providerCreatesStarted: smallint("provider_creates_started").notNull().default(0),
  providerCreateCallState: text("provider_create_call_state", { enum: provisioningCallStates }).notNull().default("not_started"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("provisioning_attempts_asset_state_created").on(table.assetId, table.state, table.createdAt),
]);

export type ProvisioningAttemptRecord = typeof provisioningAttempts.$inferSelect;
export type InsertProvisioningAttempt = typeof provisioningAttempts.$inferInsert;
