import { db, avatarAssets, imageAssets, and, eq, sql, type AvatarAssetRecord } from "@workspace/db";
import { ImageProviderAdapter, ProviderFailure } from "./provisioning-providers";
import { providerImageUrl } from "./private-images";
import { logger } from "./logger";

export function provisioningOutcome(error: unknown, creating: boolean) {
  const issue = error instanceof ProviderFailure ? error : new ProviderFailure("PROVISIONING_INTERNAL_ERROR", creating);
  return { code: issue.code, ambiguous: creating && issue.ambiguous, retryable: !creating && issue.retryable };
}
export async function runProvisioningTick(options: {
  onlyId?: string;
  adapter?: ImageProviderAdapter;
  signImage?: typeof providerImageUrl;
} = {}) {
  const row = await db.transaction(async tx => {
    const [job] = await tx.select().from(avatarAssets).where(sql`
      ${avatarAssets.status} in ('queued','submitting','processing','deleting')
      and (${avatarAssets.nextPollAt} <= now() or ${!!options.onlyId && !!options.adapter})
      and (${avatarAssets.leaseUntil} is null or ${avatarAssets.leaseUntil} < now())
      and (${options.onlyId ?? null}::text is null or ${avatarAssets.id} = ${options.onlyId ?? null})
    `).for("update", { skipLocked: true }).limit(1);
    if (!job) return undefined;
    if (job.status === "submitting") {
      // Crash/timeout after upstream POST may have created a paid resource.
      // A new POST is unsafe, so require operator reconciliation.
      await tx.update(avatarAssets).set({ status: "reconciliation_required", errorCode: "SUBMISSION_INTERRUPTED", leaseUntil: null, updatedAt: new Date() }).where(eq(avatarAssets.id, job.id));
      return undefined;
    }
    await tx.update(avatarAssets).set({
      status: job.status === "queued" ? "submitting" : job.status,
      leaseUntil: new Date(Date.now() + 120_000), updatedAt: new Date(),
    }).where(eq(avatarAssets.id, job.id));
    return job;
  });
  if (!row) return;
  const creating = row.status === "queued";
  const adapter = options.adapter ?? new ImageProviderAdapter(row.providerId);
  try {
    if (creating) {
      const [source] = await db.select().from(imageAssets).where(and(eq(imageAssets.id, row.imageAssetId), eq(imageAssets.tenantId, row.tenantId)));
      if (!source) throw new ProviderFailure("SOURCE_IMAGE_MISSING");
      const signedUrl = await (options.signImage ?? providerImageUrl)(source.objectPath);
      const result = await adapter.create(row.name, signedUrl, row.voiceName);
      await finish(row, { providerAvatarId: result.id, status: result.ready ? "ready" : "processing", errorCode: null });
    } else if (row.status === "processing") {
      if (!row.providerAvatarId) throw new ProviderFailure("PROVIDER_ID_MISSING");
      await finish(row, { status: await adapter.poll(row.providerAvatarId), errorCode: null });
    } else if (row.status === "deleting") {
      if (row.providerAvatarId) await adapter.remove(row.providerAvatarId);
      await finish(row, { status: "deleted", deletionStatus: "confirmed", errorCode: null, providerAvatarId: null });
    }
  } catch (error) {
    const outcome = provisioningOutcome(error, creating);
    await finish(row, {
      status: row.status === "deleting" ? "deleting"
        : outcome.ambiguous ? "reconciliation_required"
        : outcome.retryable ? row.status : "failed",
      errorCode: outcome.code,
      ...(row.status === "deleting" ? { deletionStatus: "manual_review" as const } : {}),
    });
    logger.warn({ assetId: row.id, code: outcome.code }, "Avatar provisioning operation requires attention");
  }
}
async function finish(row: AvatarAssetRecord, changes: Partial<typeof avatarAssets.$inferInsert>) {
  await db.update(avatarAssets).set({
    ...changes, leaseUntil: null,
    nextPollAt: row.nextPollAt > new Date() ? row.nextPollAt : new Date(Date.now() + 30_000),
    updatedAt: new Date(),
  }).where(eq(avatarAssets.id, row.id));
}
