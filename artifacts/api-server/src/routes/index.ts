import { Router, type IRouter } from "express";
import healthRouter from "./health";
import avatarRouter from "./avatar-router";

const router: IRouter = Router();

router.use(healthRouter);
router.use(avatarRouter);

export default router;
