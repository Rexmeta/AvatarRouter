import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { db, pool, avatarSessions, eq } from "@workspace/db";

after(() => pool.end());
test("stop-only browser capability survives sign-out but grants no paid/media access", async () => {
  if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("This development HTTP regression requires REPLIT_DEV_DOMAIN and the API workflow.");
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api/v1`;
  const getCookie = async () => {
    const response = await fetch(`${base}/sessions`);
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith("avatar_playground="))?.split(";")[0];
    assert.ok(cookie);
    return cookie!;
  };
  const cookie = await getCookie();
  const otherCookie = await getCookie();
  const ownerHash = createHash("sha256").update(cookie.slice("avatar_playground=".length)).digest("hex");
  const id = randomUUID();
  // An already-ended, resource-free fixture: never creates or terminates a real provider session.
  await db.insert(avatarSessions).values({
    id, ownerHash, tenantId: "test-stop-capability", providerId: "tavus",
    avatarId: "tavus-stock-lucy", mode: "live", status: "ended",
    endedAt: new Date(), expiresAt: new Date(),
  });
  const request = (path: string, authCookie: string, body?: unknown) => fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: authCookie, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  try {
    const end = await request(`/sessions/${id}/end`, cookie, {});
    assert.equal(end.status, 200);
    assert.equal((await end.json() as { status: string }).status, "ended");
    assert.equal((await request(`/sessions/${id}/end`, otherCookie, {})).status, 404);
    assert.equal((await request(`/sessions/${id}/connection`, cookie)).status, 401);
    assert.equal((await request(`/sessions/${id}/audio`, cookie, { sample: true })).status, 401);
    assert.equal((await request(`/sessions/${id}/interrupt`, cookie, {})).status, 401);
    assert.equal((await request("/sessions", cookie, {
      providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live", costConfirmed: true,
    })).status, 401);
  } finally { await db.delete(avatarSessions).where(eq(avatarSessions.id, id)); }
});
