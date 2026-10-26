import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db, sql } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});
router.get("/health", (_req, res) => { res.json({ status: "ok" }); });
router.get("/ready", async (req, res): Promise<void> => {
  try {
    await db.execute(sql`select 1`);
    res.json({
      status: "ready", database: true, liveEnabled: false,
      message: "Mock ready. Private assets require sign-in. Image-derived live validation and public live dispatch are pending.",
    });
  } catch {
    req.log.warn("Database readiness check failed");
    res.status(503).json({
      status: "not_ready", database: false, liveEnabled: false,
      message: "Database unavailable. Session persistence is not ready.",
    });
  }
});

export default router;
