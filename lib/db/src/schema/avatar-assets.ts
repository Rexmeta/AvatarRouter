import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { imageAssets } from "./image-assets";

export const avatarAssets = pgTable("avatar_assets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  imageAssetId: text("image_asset_id").notNull().references(() => imageAssets.id),
  name: text("name").notNull(),
  sourceContentHash: text("source_content_hash").notNull(),
  providerId: text("provider_id", { enum: ["anam", "tavus"] }).notNull(),
  providerAvatarId: text("provider_avatar_id"),
  liveValidatedAt: timestamp("live_validated_at", { withTimezone: true }),
  liveValidationSessionId: text("live_validation_session_id"),
  liveValidationProviderAvatarId: text("live_validation_provider_avatar_id"),
  voiceName: text("voice_name").notNull(),
  status: text("status", { enum: ["queued", "submitting", "processing", "ready", "failed", "reconciliation_required", "deleting", "deleted"] }).notNull().default("queued"),
  creationMode: text("creation_mode", { enum: ["image_training", "one_shot"] }).notNull(),
  errorCode: text("error_code"),
  deletionStatus: text("deletion_status", { enum: ["not_requested", "pending", "confirmed", "manual_review"] }).notNull().default("not_requested"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextPollAt: timestamp("next_poll_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("avatar_asset_dedup").on(t.tenantId, t.imageAssetId, t.providerId, t.voiceName),
  index("avatar_asset_queue").on(t.nextPollAt),
]);
export const insertAvatarAssetSchema = createInsertSchema(avatarAssets);
export type AvatarAssetRecord = typeof avatarAssets.$inferSelect;
