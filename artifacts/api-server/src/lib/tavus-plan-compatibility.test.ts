import { test } from "node:test";
import assert from "node:assert/strict";
import { livePipelineConfigured, LIVE_SESSION_MS, dailyLimits } from "./stock-policy";
import { getProviders } from "./provider-registry";
import { GetLiveLimitsQueryParams, CreateSessionBody } from "@workspace/api-zod";
import { tavusRoleplayOptions } from "./roleplay-context";

test("native Tavus needs its API key, while external-audio still requires LiveKit", () => {
  const paidKeyOnly = { TAVUS_API_KEY: "mock-only" };
  assert.equal(livePipelineConfigured("tavus", "tavus_full", paidKeyOnly), true);
  assert.equal(livePipelineConfigured("tavus", "external_audio", paidKeyOnly), false);
  assert.equal(livePipelineConfigured("tavus", undefined, paidKeyOnly), false);
  assert.equal(livePipelineConfigured("tavus", "tavus_full", {}), false);
  assert.equal(livePipelineConfigured("tavus", "anam_full", paidKeyOnly), false);
  assert.equal(livePipelineConfigured("anam", "tavus_full", { ANAM_API_KEY: "mock" }), false);
});

test("catalog advertises native support without pretending paid balance or playback was verified", () => {
  const tavus = getProviders({ TAVUS_API_KEY: "mock-only" }).find(p => p.id === "tavus")!;
  assert.equal(tavus.status, "available");
  assert.deepEqual(tavus.modes, ["full_pipeline", "renderer"]);
  assert.deepEqual(tavus.missing, []);
  assert.match(tavus.validation, /do not verify plan, balance or playback/);
  assert.equal(getProviders({}).find(p => p.id === "tavus")!.status, "unconfigured");
});

test("RoleplayX can request native preflight and isolated persona context through the existing key contract", () => {
  assert.deepEqual(GetLiveLimitsQueryParams.parse({ providerId: "tavus", pipeline: "tavus_full" }),
    { providerId: "tavus", pipeline: "tavus_full" });
  assert.equal(GetLiveLimitsQueryParams.safeParse({ pipeline: "unknown" }).success, false);
  const body = CreateSessionBody.parse({
    providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live", costConfirmed: true,
    roleplay: { persona: "Korean customer", scenario: "Sales training", language: "Korean" },
  });
  const options = tavusRoleplayOptions(body.roleplay!);
  assert.match(options.systemPrompt, /Korean customer/);
  assert.match(options.context!, /Sales training/);
  // Plan upgrade never changes router budgets or grants indefinite sessions.
  assert.equal(LIVE_SESSION_MS, 120_000);
  assert.ok(dailyLimits().user >= 0);
});
