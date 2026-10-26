import { randomUUID } from "node:crypto";
import { db, and, eq, desc, sql, imageAssets, avatarAssets, type ImageAssetRecord, type AvatarAssetRecord } from "@workspace/db";
import { IngestImageBody, ProvisionAvatarBody, IngestImageResponse, GetAvatarAssetResponse } from "@workspace/api-zod";
import { SessionProblem } from "./session-service";
import { decodeImageBase64, fetchAuthorizedImage, validateImage } from "./image-validation";
import { savePrivateImage, removePrivateImage } from "./private-images";
import { requireSupportedProvider } from "./provisioning-providers";

export function presentImage(row: ImageAssetRecord) {
  const { tenantId, objectPath, lineageId, consentReference, rightsConfirmedAt, ...safe } = row;
  return IngestImageResponse.parse({ ...safe, createdAt: row.createdAt.toISOString() });
}
export function presentAvatarAsset(row: AvatarAssetRecord) {
  return GetAvatarAssetResponse.parse({
    id: row.id, imageAssetId: row.imageAssetId, name: row.name,
    sourceContentHash: row.sourceContentHash, providerId: row.providerId, providerAvatarId: row.providerAvatarId,
    status: row.status, creationMode: row.creationMode, errorCode: row.errorCode, deletionStatus: row.deletionStatus,
    capabilities: { reusable: true, liveRendering: true, emotionControl: "unverified", behaviorControl: "unverified", validation: row.status === "ready" ? "provisioned" : "documentation_only" },
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), expiresAt: row.expiresAt?.toISOString() ?? null,
  });
}
export async function ownedImage(tenant: string, id: string) {
  const [row] = await db.select().from(imageAssets).where(and(eq(imageAssets.id, id), eq(imageAssets.tenantId, tenant)));
  if (!row) throw new SessionProblem(404, "IMAGE_NOT_FOUND", "Image not found.");
  return row;
}
export async function ownedAvatarAsset(tenant: string, id: string) {
  const [row] = await db.select().from(avatarAssets).where(and(eq(avatarAssets.id, id), eq(avatarAssets.tenantId, tenant)));
  if (!row) throw new SessionProblem(404, "AVATAR_ASSET_NOT_FOUND", "Avatar asset not found.");
  return row;
}
export async function listImages(tenant: string) {
  return db.select().from(imageAssets).where(eq(imageAssets.tenantId, tenant)).orderBy(desc(imageAssets.createdAt)).limit(200);
}
export async function listAssets(tenant: string) {
  return db.select().from(avatarAssets).where(eq(avatarAssets.tenantId, tenant)).orderBy(desc(avatarAssets.createdAt)).limit(200);
}
export async function ingestImage(tenant: string, input: unknown) {
  const data = IngestImageBody.strict().parse(input);
  if (data.rightsConfirmed !== true || data.likeness === "real_person" && !data.consentReference?.trim()) {
    throw new SessionProblem(400, "RIGHTS_CONFIRMATION_REQUIRED", "Confirm image rights and provide real-person consent evidence when applicable.");
  }
  if (!!data.imageBase64 === !!data.sourceUrl) throw new SessionProblem(400, "IMAGE_SOURCE_INVALID", "Provide exactly one image source.");
  const bytes = data.imageBase64 ? decodeImageBase64(data.imageBase64) : await fetchAuthorizedImage(data.sourceUrl!);
  const validated = await validateImage(bytes);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenant}))`);
    const prior = data.previousVersionId ? await ownedImage(tenant, data.previousVersionId) : undefined;
    const lineageId = prior?.lineageId ?? randomUUID();
    // Exact original byte hash; never cross-tenant deduplication or timing disclosure.
    const [duplicate] = await tx.select().from(imageAssets).where(and(
      eq(imageAssets.tenantId, tenant), eq(imageAssets.contentHash, validated.contentHash),
      eq(imageAssets.likeness, data.likeness),
      ...(prior ? [eq(imageAssets.lineageId, lineageId)] : []),
    )).limit(1);
    if (duplicate) return duplicate;
    const [quota] = await tx.select({ n: sql<number>`count(*)::int` }).from(imageAssets).where(eq(imageAssets.tenantId, tenant));
    if (quota!.n >= 100) throw new SessionProblem(429, "IMAGE_QUOTA_REACHED", "This tenant's preliminary image quota is 100 sources. Delete unused images first.");
    const [latest] = prior ? await tx.select().from(imageAssets).where(and(eq(imageAssets.tenantId, tenant), eq(imageAssets.lineageId, lineageId))).orderBy(desc(imageAssets.version)).limit(1) : [];
    const id = randomUUID();
    const objectPath = await savePrivateImage(tenant, id, validated.bytes);
    try {
      const [row] = await tx.insert(imageAssets).values({
        id, tenantId: tenant, name: data.name.trim() || "Untitled image",
        contentHash: validated.contentHash, objectPath, width: validated.width, height: validated.height,
        byteLength: validated.bytes.length, lineageId, previousVersionId: prior?.id,
        version: (latest?.version ?? 0) + 1, likeness: data.likeness,
        consentReference: data.consentReference, consentStatus: data.likeness === "real_person" ? "pending_review" : "not_required",
      }).returning();
      return row!;
    } catch (error) { await removePrivateImage(objectPath); throw error; }
  });
}
export async function provisionAsset(tenant: string, input: unknown, notBefore = new Date()) {
  const data = ProvisionAvatarBody.strict().parse(input);
  if (!data.costConfirmed) throw new SessionProblem(400, "COST_CONFIRMATION_REQUIRED", "Confirm potential provider training charges first.");
  const providerId = requireSupportedProvider(data.providerId);
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenant}))`);
    const [image] = await tx.select().from(imageAssets).where(and(eq(imageAssets.id, data.imageAssetId), eq(imageAssets.tenantId, tenant))).for("update");
    if (!image) throw new SessionProblem(404, "IMAGE_NOT_FOUND", "Image not found.");
    if (image.likeness === "real_person" && image.consentStatus !== "verified") {
      throw new SessionProblem(409, "CONSENT_REVIEW_REQUIRED", "An operator must review real-person consent and provider identity requirements before transmission.");
    }
    if (providerId === "anam" && (image.width !== image.height || image.width < 1152)) {
      throw new SessionProblem(422, "PROVIDER_IMAGE_REQUIREMENTS", "Anam requires a square source at least 1152×1152 pixels.");
    }
    const voiceName = data.voiceName ?? "anna";
    const [existing] = await tx.select().from(avatarAssets).where(and(eq(avatarAssets.tenantId, tenant), eq(avatarAssets.imageAssetId, image.id), eq(avatarAssets.providerId, providerId), eq(avatarAssets.voiceName, voiceName)));
    if (existing) return existing; // Never repeat a possibly billed POST after failure or deletion.
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(avatarAssets).where(eq(avatarAssets.tenantId, tenant));
    if (count!.n >= 20) throw new SessionProblem(429, "ASSET_QUOTA_REACHED", "This tenant's preliminary provisioning quota is 20 requests. Contact the operator.");
    const [row] = await tx.insert(avatarAssets).values({
      id: randomUUID(), tenantId: tenant, imageAssetId: image.id, name: image.name,
      sourceContentHash: image.contentHash, providerId, voiceName,
      creationMode: providerId === "anam" ? "one_shot" : "image_training",
      nextPollAt: notBefore,
    }).returning();
    return row!;
  });
}
export async function deleteAsset(tenant: string, id: string) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(avatarAssets).where(and(eq(avatarAssets.id, id), eq(avatarAssets.tenantId, tenant))).for("update");
    if (!row) throw new SessionProblem(404, "AVATAR_ASSET_NOT_FOUND", "Avatar asset not found.");
    if (row.status === "deleted" || row.status === "deleting") return row;
    if (row.leaseUntil && row.leaseUntil > new Date()) throw new SessionProblem(409, "ASSET_BUSY", "A provider operation is in progress. Retry after it finishes.");
    if (row.status === "reconciliation_required" || row.status === "submitting") {
      throw new SessionProblem(409, "RECONCILIATION_REQUIRED", "An operator must locate the provider resource before deletion can be confirmed.");
    }
    const [updated] = await tx.update(avatarAssets).set({
      status: "deleting", deletionStatus: "pending", errorCode: null, nextPollAt: new Date(), updatedAt: new Date(),
    }).where(eq(avatarAssets.id, id)).returning();
    return updated!;
  });
}
export async function deleteImage(tenant: string, id: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenant}))`);
    const [image] = await tx.select().from(imageAssets).where(and(eq(imageAssets.id, id), eq(imageAssets.tenantId, tenant))).for("update");
    if (!image) throw new SessionProblem(404, "IMAGE_NOT_FOUND", "Image not found.");
    const refs = await tx.select().from(avatarAssets).where(eq(avatarAssets.imageAssetId, id));
    if (refs.some(r => r.status !== "deleted")) throw new SessionProblem(409, "IMAGE_IN_USE", "Delete every provider avatar derived from this image first.");
    const [child] = await tx.select().from(imageAssets).where(eq(imageAssets.previousVersionId, id)).limit(1);
    if (child) throw new SessionProblem(409, "IMAGE_HAS_VERSIONS", "Delete newer versions first to preserve source history.");
    await removePrivateImage(image.objectPath);
    await tx.delete(avatarAssets).where(eq(avatarAssets.imageAssetId, id));
    await tx.delete(imageAssets).where(eq(imageAssets.id, id));
  });
}
export async function resolveSessionAsset(tenant: string, id: string) {
  const row = await ownedAvatarAsset(tenant, id);
  if (row.status !== "ready" || !row.providerAvatarId) {
    throw new SessionProblem(409, "AVATAR_ASSET_NOT_READY", "The provisioned avatar is not ready.");
  }
  return { avatarAssetId: row.id, providerId: row.providerId, avatarId: row.providerAvatarId };
}
