import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const integrationApiKeys = pgTable("integration_api_keys", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  ownerIdHash: text("owner_id_hash").notNull(),
  projectName: text("project_name").notNull(),
  prefix: text("prefix").notNull(),
  secretHash: text("secret_hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("integration_api_key_secret").on(t.secretHash),
  index("integration_api_key_owner").on(t.ownerIdHash),
]);
export const insertIntegrationApiKeySchema = createInsertSchema(integrationApiKeys);
export type IntegrationApiKeyRecord = typeof integrationApiKeys.$inferSelect;
