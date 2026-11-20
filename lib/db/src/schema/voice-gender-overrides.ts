import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const voiceGenderOverrides = pgTable("voice_gender_overrides", {
  providerId: text("provider_id", { enum: ["anam", "tavus"] }).notNull(),
  voiceId: text("voice_id").notNull(),
  gender: text("gender", { enum: ["male", "female", "neutral", "unclassified"] }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.providerId, table.voiceId] }),
]);

export type VoiceGenderOverrideRecord = typeof voiceGenderOverrides.$inferSelect;
