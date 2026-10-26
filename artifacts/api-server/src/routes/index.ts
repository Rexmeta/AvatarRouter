import { Router, type IRouter } from "express";
import healthRouter from "./health";
import avatarRouter from "./avatar-router";
import assetRouter from "./asset-router";

const router: IRouter = Router();

router.use(healthRouter);
router.use(assetRouter);
router.use(avatarRouter);

export default router;
