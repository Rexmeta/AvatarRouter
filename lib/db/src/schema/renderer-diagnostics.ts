import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { avatarSessions } from "./avatar-sessions";

// Private operational evidence, deliberately separate from tenant session events.
export const rendererDiagnosticRecords = pgTable("renderer_diagnostic_records", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => avatarSessions.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  evidence: jsonb("evidence").notNull(),
}, t => [
  index("renderer_diagnostics_session_idx").on(t.sessionId, t.recordedAt),
  index("renderer_diagnostics_retention_idx").on(t.recordedAt),
]);
export const insertRendererDiagnosticSchema = createInsertSchema(rendererDiagnosticRecords);
export type RendererDiagnosticRecord = typeof rendererDiagnosticRecords.$inferSelect;
