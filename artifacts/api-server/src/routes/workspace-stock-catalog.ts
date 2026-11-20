import { Router } from "express";
import { getAuth } from "@clerk/express";
import { GetWorkspaceStockFacesResponse, GetWorkspaceStockVoicesResponse } from "@workspace/api-zod";
import { requireOwnedProject } from "../lib/developer-workspaces";
import { SessionProblem } from "../lib/session-service";
import { workspaceStockCatalog } from "../lib/workspace-stock-catalog";

/** Mounted behind the developer router's interactive-only and origin guard. */
export function createWorkspaceStockRoutes(
  verifyOwner: (userId: string, projectId: string) => Promise<unknown> = requireOwnedProject,
  catalog: Pick<typeof workspaceStockCatalog, "listFaces" | "listVoices"> = workspaceStockCatalog,
) {
  const router = Router();
  for (const kind of ["faces", "voices"] as const) {
    router.get(`/v1/developer/workspaces/:projectId/stock-catalog/:providerId/${kind}`, async (req, res) => {
      const { userId } = getAuth(req);
      if (!userId) throw new SessionProblem(401, "AUTHENTICATION_REQUIRED", "Sign in to view this workspace.");
      await verifyOwner(userId, String(req.params.projectId));
      const providerId = req.params.providerId;
      if (providerId !== "anam" && providerId !== "tavus") {
        throw new SessionProblem(404, "STOCK_PROVIDER_NOT_FOUND", "Stock catalog provider not found.");
      }
      res.set("Cache-Control", "private, no-store");
      res.json(kind === "faces"
        ? GetWorkspaceStockFacesResponse.parse(await catalog.listFaces(providerId))
        : GetWorkspaceStockVoicesResponse.parse(await catalog.listVoices(providerId)));
    });
  }
  return router;
}
