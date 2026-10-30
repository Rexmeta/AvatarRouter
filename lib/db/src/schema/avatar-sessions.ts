import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const avatarSessions = pgTable("avatar_sessions", {
  id: text("id").primaryKey(),
  ownerHash: text("owner_hash").notNull(),
  tenantId: text("tenant_id"),
  roomName: text("room_name"),
  providerConversationId: text("provider_conversation_id"),
  rendererState: text("renderer_state").notNull().default("queued"),
  workerId: text("worker_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  providerCreateState: text("provider_create_state").notNull().default("not_started"),
  stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
  stopStatus: text("stop_status", { enum: ["ended", "expired", "failed"] }),
  stopError: text("stop_error"),
  cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
  cleanupRetryAt: timestamp("cleanup_retry_at", { withTimezone: true }),
  reservedSeconds: integer("reserved_seconds").notNull().default(0),
  providerId: text("provider_id").notNull(),
  avatarId: text("avatar_id").notNull(),
  avatarAssetId: text("avatar_asset_id"),
  purpose: text("purpose", { enum: ["conversation", "validation"] }).notNull().default("conversation"),
  mode: text("mode", { enum: ["mock", "live"] }).notNull(),
  status: text("status", { enum: ["active", "ended", "expired", "failed"] }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  interruptions: integer("interruptions").notNull().default(0),
  error: text("error"),
}, (t) => [
  index("avatar_sessions_owner_idx").on(t.ownerHash, t.startedAt),
  index("avatar_sessions_expiry_idx").on(t.status, t.expiresAt),
  index("avatar_sessions_worker_idx").on(t.mode, t.rendererState, t.leaseExpiresAt),
  uniqueIndex("avatar_sessions_one_active_owner").on(t.ownerHash).where(sql`${t.status} = 'active'`),
]);

export const insertAvatarSessionSchema = createInsertSchema(avatarSessions);
export type AvatarSessionRecord = typeof avatarSessions.$inferSelect;

export const avatarSessionEvents = pgTable("avatar_session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => avatarSessions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("avatar_events_session_idx").on(t.sessionId, t.createdAt)]);

export const insertAvatarSessionEventSchema = createInsertSchema(avatarSessionEvents);

export const avatarSessionReconciliationAudit = pgTable("avatar_session_reconciliation_audit", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => avatarSessions.id),
  operatorUserId: text("operator_user_id").notNull(),
  action: text("action", { enum: ["conversation_id_attached"] }).notNull(),
  providerConversationId: text("provider_conversation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("avatar_reconciliation_audit_session_idx").on(t.sessionId, t.createdAt)]);
export const insertAvatarSessionReconciliationAuditSchema = createInsertSchema(avatarSessionReconciliationAudit);
export type AvatarSessionReconciliationAudit = typeof avatarSessionReconciliationAudit.$inferSelect;

export const rendererCommands = pgTable("renderer_commands", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => avatarSessions.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["audio", "interrupt"] }).notNull(),
  objectPath: text("object_path"),
  state: text("state").notNull().default("queued"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [index("renderer_commands_session_idx").on(t.sessionId, t.state, t.createdAt)]);
export const insertRendererCommandSchema = createInsertSchema(rendererCommands);

export const rendererWorkers = pgTable("renderer_workers", {
  id: text("id").primaryKey(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertRendererWorkerSchema = createInsertSchema(rendererWorkers);
