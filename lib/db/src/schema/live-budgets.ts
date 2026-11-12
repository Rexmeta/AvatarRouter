import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const liveBudgetSettings = pgTable("live_budget_settings", {
  scope: text("scope").primaryKey(),
  dailySeconds: integer("daily_seconds").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const liveBudgetAudit = pgTable("live_budget_audit", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  before: jsonb("before").$type<{ dailySeconds: number; resetAt: string | null }>().notNull(),
  after: jsonb("after").$type<{ dailySeconds: number; resetAt: string | null }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertLiveBudgetSettingsSchema = createInsertSchema(liveBudgetSettings);
export type LiveBudgetSettings = typeof liveBudgetSettings.$inferSelect;
