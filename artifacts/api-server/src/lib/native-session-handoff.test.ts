import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { canResumeNativeSession } from "./native-session-handoff";
import { TavusFullRuntime } from "./tavus-full-runtime";

const now = Date.now();
function running() {
  return {
    id: "existing-call", pipeline: "tavus_full", providerId: "tavus", status: "active",
    rendererState: "running", providerCreateState: "known", providerConversationId: "provider-existing",
    stopRequestedAt: null, expiresAt: new Date(now + 600_000),
    fullPipeline: { palId: "pal-existing", url: "https://existing.daily.co/room", token: "private-fixture-token" },
  } as AvatarSessionRecord;
}

test("only confirmed active native calls may survive a supervisor handoff", () => {
  assert.equal(canResumeNativeSession(running(), now), true);
  for (const patch of [
    { pipeline: "external_audio" }, { pipeline: "anam_full" }, { providerId: "anam" },
    { status: "failed" }, { rendererState: "starting" }, { rendererState: "stopping" },
    { providerCreateState: "unknown" }, { providerCreateState: "submitted" },
    { providerConversationId: null }, { fullPipeline: null },
    { fullPipeline: { palId: "only-partial" } }, { stopRequestedAt: new Date(now) },
    { stopStatus: "failed" }, { stopError: "LIVE_LEASE_LOST" }, { error: "LIVE_CLEANUP_PENDING" },
    { expiresAt: new Date(now) },
  ]) {
    assert.equal(canResumeNativeSession({ ...running(), ...patch } as AvatarSessionRecord, now), false);
  }
});

test("resuming supervision never creates a new persona, call, token or deadline", async () => {
  let calls = 0;
  const forbidden = async () => { calls++; throw new Error("must not be called during native resume"); };
  const row = running();
  const expiry = row.expiresAt.getTime();
  const runtime = new TavusFullRuntime(row, forbidden, forbidden, forbidden, forbidden, forbidden);
  await runtime.start();
  await runtime.start();
  assert.equal(calls, 0);
  assert.equal(row.expiresAt.getTime(), expiry);
  assert.equal(row.providerConversationId, "provider-existing");
});
