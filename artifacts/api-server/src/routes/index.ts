import { Router, type IRouter } from "express";
import healthRouter from "./health";
import avatarRouter from "./avatar-router";
import assetRouter from "./asset-router";
import developerKeysRouter from "./developer-keys";

const router: IRouter = Router();

router.use(healthRouter);
router.use(developerKeysRouter);
router.use(assetRouter);
router.use(avatarRouter);

export default router;
