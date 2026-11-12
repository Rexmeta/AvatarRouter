import express, { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { GetAvatarAssetParams, DeleteImageAssetParams, ListProvisioningProvidersResponse, ReportAvatarLiveValidationBody, GetSeedLiveOptionsResponse, GetSeedLiveOptionsParams } from "@workspace/api-zod";
import { seedLiveOptions } from "../lib/seed-live-options";
import { db, avatarAssets, eq, and, desc } from "@workspace/db";
import { sessionOwner } from "../middlewares/session-owner";
import { recordAssetPlayback } from "../lib/asset-service";
import { assetTenant } from "../middlewares/asset-tenant";
import { provisioningProviders } from "../lib/provisioning-providers";
import { readPrivateImage } from "../lib/private-images";
import { ownedImage, listImages, listAssets, ingestImage, presentImage, presentAvatarAsset, provisionAsset, ownedAvatarAsset, deleteAsset, deleteImage } from "../lib/asset-service";

const router: IRouter = Router();
router.get("/v1/provisioning/providers", (_req, res) => res.json(ListProvisioningProvidersResponse.parse(provisioningProviders())));
const limit = rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: (_req, res) => res.locals.tenantId, standardHeaders: true, legacyHeaders: false });
router.use(["/v1/assets", "/v1/avatar-assets"], assetTenant, limit);
router.get("/v1/assets/images", async (_req, res) => { res.json((await listImages(res.locals.tenantId)).map(presentImage)); });
router.post("/v1/assets/images", express.json({ limit: "6100kb" }), async (req, res) => {
  res.status(201).json(presentImage(await ingestImage(res.locals.tenantId, req.body)));
});
router.get("/v1/assets/images/:id/live-options", async (req, res) => {
  const { id } = GetSeedLiveOptionsParams.parse(req.params);
  const image = await ownedImage(res.locals.tenantId, id);
  const assets = await db.select().from(avatarAssets).where(and(
    eq(avatarAssets.tenantId, res.locals.tenantId), eq(avatarAssets.imageAssetId, id),
    eq(avatarAssets.providerId, "tavus"),
  )).orderBy(desc(avatarAssets.createdAt));
  res.set("Cache-Control", "private, no-store");
  res.json(GetSeedLiveOptionsResponse.parse(seedLiveOptions(image, assets, !!process.env.TAVUS_API_KEY)));
});
router.get("/v1/assets/images/:id/content", async (req, res) => {
  const { id } = DeleteImageAssetParams.parse(req.params);
  const image = await ownedImage(res.locals.tenantId, id);
  const bytes = await readPrivateImage(image.objectPath);
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(bytes);
});
router.delete("/v1/assets/images/:id", async (req, res) => {
  const { id } = DeleteImageAssetParams.parse(req.params);
  await deleteImage(res.locals.tenantId, id); res.status(204).end();
});
router.get("/v1/avatar-assets", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json((await listAssets(res.locals.tenantId)).map(presentAvatarAsset));
});
router.post("/v1/avatar-assets", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.status(202).json(presentAvatarAsset(await provisionAsset(res.locals.tenantId, req.body)));
});
router.get("/v1/avatar-assets/:id", async (req, res) => {
  const { id } = GetAvatarAssetParams.parse(req.params);
  res.set("Cache-Control", "private, no-store");
  res.json(presentAvatarAsset(await ownedAvatarAsset(res.locals.tenantId, id)));
});
router.post("/v1/avatar-assets/:id/live-validation", sessionOwner, async (req, res) => {
  const { id } = GetAvatarAssetParams.parse(req.params);
  const report = ReportAvatarLiveValidationBody.strict().parse(req.body);
  res.json(presentAvatarAsset(await recordAssetPlayback(res.locals.tenantId, res.locals.ownerHash, id, report)));
});
router.delete("/v1/avatar-assets/:id", async (req, res) => {
  const { id } = GetAvatarAssetParams.parse(req.params);
  res.status(202).json(presentAvatarAsset(await deleteAsset(res.locals.tenantId, id)));
});
export default router;
