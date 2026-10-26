import { pgTable, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const imageAssets = pgTable("image_assets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  contentHash: text("content_hash").notNull(),
  objectPath: text("object_path").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  byteLength: integer("byte_length").notNull(),
  lineageId: text("lineage_id").notNull(),
  previousVersionId: text("previous_version_id"),
  version: integer("version").notNull(),
  likeness: text("likeness", { enum: ["synthetic", "real_person"] }).notNull(),
  consentStatus: text("consent_status", { enum: ["not_required", "pending_review", "verified"] }).notNull(),
  consentReference: text("consent_reference"),
  rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("image_lineage_version").on(t.tenantId, t.lineageId, t.version)]);
export const insertImageAssetSchema = createInsertSchema(imageAssets);
export type ImageAssetRecord = typeof imageAssets.$inferSelect;
