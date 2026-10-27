import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const avatarSessions = pgTable("avatar_sessions", {
  id: text("id").primaryKey(),
  ownerHash: text("owner_hash").notNull(),
  tenantId: text("tenant_id"),
  roomName: text("room_name"),
  providerConversationId: text("provider_conversation_id"),
  providerId: text("provider_id").notNull(),
  avatarId: text("avatar_id").notNull(),
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
