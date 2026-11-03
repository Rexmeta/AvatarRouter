import { test } from "node:test";
import assert from "node:assert/strict";
import { liveReadiness, liveCapacityFence } from "./live-admission";
import { randomUUID } from "node:crypto";
import { db, avatarSessions, eq, pool } from "@workspace/db";
import { liveLimits } from "./live-sessions";
import { GetLiveLimitsResponse } from "@workspace/api-zod";
import { after } from "node:test";

const ready = { configured:true, workerReady:true, userRemainingSeconds:240,globalRemainingSeconds:500,
  sessionSeconds:120, cleanupPending:0,serviceBusy:false,serviceCleanupRequired:false,recentAttempts:0 };
test("another project's unresolved creation blocks preflight even with no own cleanup",()=>{
  const result=liveReadiness({...ready,serviceBusy:true,serviceCleanupRequired:true});
  assert.equal(result.creationAllowed,false);
  assert.deepEqual(result.blockingReasons,["LIVE_CLEANUP_REQUIRED"]);
  assert.deepEqual(Object.keys(result).sort(),["blockingReasons","creationAllowed"]);
});
test("running capacity, worker, config, budget and quota are distinct",()=>{
  for(const [change,code] of [
    [{serviceBusy:true},"LIVE_CAPACITY_REACHED"],[{workerReady:false},"LIVE_WORKER_UNAVAILABLE"],
    [{configured:false},"LIVE_NOT_CONFIGURED"],[{userRemainingSeconds:119},"LIVE_USER_DAILY_BUDGET"],
    [{globalRemainingSeconds:119},"LIVE_GLOBAL_DAILY_BUDGET"],[{recentAttempts:5},"LIVE_USER_QUOTA_REACHED"],
    [{cleanupPending:1},"LIVE_CLEANUP_REQUIRED"],
  ] as const) {
    const result=liveReadiness({...ready,...change});
    assert.equal(result.creationAllowed,false);
    assert.ok(result.blockingReasons.includes(code));
  }
});
test("sufficient admission capacity is not consumed by repeated preflight",()=>{
  assert.deepEqual(liveReadiness(ready),{creationAllowed:true,blockingReasons:[]});
  assert.deepEqual(liveReadiness(ready),{creationAllowed:true,blockingReasons:[]});
  assert.equal(ready.userRemainingSeconds,240);
});
test("persisted unknown creation blocks a different project without leaking its identifiers",async()=>{
  const id=randomUUID();
  const unrelatedTenant=randomUUID();
  const otherTenant=randomUUID();
  await db.insert(avatarSessions).values({
    id,ownerHash:`admission-fixture:${id}`,tenantId:otherTenant,providerId:"tavus",avatarId:"tavus-stock-lucy",
    mode:"live",status:"expired",rendererState:"reconciliation_required",providerCreateState:"unknown",
    error:"LIVE_CREATE_RECONCILIATION_REQUIRED",reservedSeconds:0,
    startedAt:new Date(Date.now()-172800000),expiresAt:new Date(Date.now()-172000000),
  });
  try {
    const result=GetLiveLimitsResponse.parse(await liveLimits(unrelatedTenant));
    assert.equal(result.cleanupPending,0);
    assert.equal(result.creationAllowed,false);
    assert.ok(result.blockingReasons?.includes("LIVE_CLEANUP_REQUIRED"));
    assert.ok((await db.select({id:avatarSessions.id}).from(avatarSessions).where(liveCapacityFence())).some(row=>row.id===id));
    assert.doesNotMatch(JSON.stringify(result),new RegExp(`${id}|${otherTenant}|admission-fixture`));
    // Repeated reads cannot change or clear the uncertain provider result.
    await liveLimits(unrelatedTenant);
    const [unchanged]=await db.select().from(avatarSessions).where(eq(avatarSessions.id,id));
    assert.equal(unchanged!.providerCreateState,"unknown");
    assert.equal(unchanged!.error,"LIVE_CREATE_RECONCILIATION_REQUIRED");
  } finally {
    // Only remove the synthetic, expired fixture created in this test.
    await db.delete(avatarSessions).where(eq(avatarSessions.id,id));
  }
});
after(async()=>{await pool.end();});
