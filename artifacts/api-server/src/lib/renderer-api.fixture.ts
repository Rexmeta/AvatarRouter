// IPC harness for the isolated-schema regression. Never used by a service.
import { pool } from "@workspace/db";
import { createStockSession, closeStockSession, liveConnection } from "./live-sessions";

process.once("message", async (input: { action: "create" | "stop" | "connect"; owner: string; tenant: string; id?: string }) => {
  try {
    const result = input.action === "create"
      ? await createStockSession(input.owner, input.tenant, true)
      : input.action === "stop"
        ? await closeStockSession(input.owner, input.id!)
        : await liveConnection(input.owner, input.tenant, input.id!);
    // Never emit connection tokens, session identity, or environment variables.
    process.send?.({ ok: true, id: "id" in result ? result.id : null });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code?: string }).code ?? "TEST_FAILED" });
  } finally { await pool.end(); process.disconnect?.(); }
});
