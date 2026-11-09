import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { AnamRuntime, anamLabel, anamTokenBody, terminateAnamResources, ANAM_PERSONA_ID } from "./anam-runtime";
import { requiredRoleplayxScope } from "../middlewares/session-owner";
import { presentSession } from "./session-service";
import { getProviders } from "./provider-registry";

const id = "31000000-0000-4000-8000-000000000001";
const remoteId = "32000000-0000-4000-8000-000000000002";
const now = Date.now();
const options = {
  systemPrompt: "", connectionIssuedAt: new Date(now - 1000).toISOString(),
  tokenExpiresAt: new Date(now + 120_000).toISOString(),
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const sampleRow = {
  id, pipeline: "anam_full", mode: "live", status: "active", startedAt: new Date(now), expiresAt: new Date(now + 120_000),
  rendererState: "running", fullPipeline: options,
} as AvatarSessionRecord;
const list = (data: unknown[]) => reply({ data, meta: { next: null, lastPage: 1 } });

test("Anam uses server-selected persona, single-start short token and explicit scope", () => {
  assert.equal(requiredRoleplayxScope("POST", `/api/v1/sessions/${id}/client-connection`), "sessions:connect");
  assert.equal(requiredRoleplayxScope("GET", `/api/v1/sessions/${id}/client-connection`), "unrecognized:route");
  assert.deepEqual(anamTokenBody(id), {
    personaConfig: { personaId: ANAM_PERSONA_ID }, maxSessions: 1, expiresInSeconds: 120, clientLabel: anamLabel(id),
  });
  assert.equal(requiredRoleplayxScope("POST", `/api/v1/sessions/${id}/anam-connection`), "sessions:connect");
  assert.equal(requiredRoleplayxScope("GET", `/api/v1/sessions/${id}/anam-connection`), "unrecognized:route");
  const anam = getProviders({ ANAM_API_KEY: "test-only" }).find(p => p.id === "anam")!;
  assert.deepEqual(anam.missing, []);
  assert.equal(anam.externalAudio, false);
  assert.equal(anam.status, "degraded"); // implemented, not live playback verified
});

test("token creation persists privately once; does not start a provider engine", async () => {
  const calls: string[] = [];
  let saved: unknown;
  let rejected = 0;
  const runtime = new AnamRuntime(sampleRow, async () => {}, async () => { rejected++; }, async config => { saved = config; },
    async (input, init) => {
      calls.push(`${init?.method} ${input}`);
      assert.equal(String(input), "https://api.anam.ai/v1/auth/session-token");
      assert.deepEqual(JSON.parse(init?.body as string), anamTokenBody(id));
      return reply({ sessionToken: "test-private-token" });
    });
  const first = runtime.start();
  assert.equal(runtime.start(), first);
  await first;
  assert.equal(calls.length, 1);
  assert.equal(rejected, 0);
  assert.equal((saved as { token: string }).token, "test-private-token");
  assert.ok(!JSON.stringify(presentSession({ ...sampleRow, fullPipeline: saved as AvatarSessionRecord["fullPipeline"] })).includes("test-private-token"));
  await assert.rejects(runtime.sendAudio(Buffer.alloc(960)), { code: "ANAM_DIRECT_MEDIA" });
  await assert.rejects(runtime.interrupt(), { code: "ANAM_DIRECT_MEDIA" });
});

test("token rejection and unknown transport fail explicitly without retry or raw errors", async () => {
  for (const [status, code] of [[401, "ANAM_KEY_REJECTED"], [403, "ANAM_PERMISSION_DENIED"], [404, "ANAM_PERSONA_NOT_FOUND"], [429, "ANAM_RATE_LIMITED"]] as const) {
    let count = 0;
    const runtime = new AnamRuntime(sampleRow, async () => {}, async () => {}, async () => {},
      async () => { count++; return reply({ message: "private-provider-body" }, status); });
    await assert.rejects(runtime.start(), (error: Error & { code?: string }) => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes("private-provider-body"));
      return true;
    });
    assert.equal(count, 1);
  }
  let rejected = false;
  const runtime = new AnamRuntime(sampleRow, async () => {}, async () => { rejected = true; }, async () => {},
    async () => { throw new Error("private-network-detail"); });
  await assert.rejects(runtime.start(), { code: "ANAM_TOKEN_FAILED" });
  assert.equal(rejected, true);
});

test("unissued credentials can close without a provider call", async () => {
  const result = await terminateAnamResources(id, { systemPrompt: "", token: "private" }, async () => { throw new Error("must not call"); });
  assert.equal(result.providerEnded, true);
});

test("issued token with no visible session stays fenced until expiry and authoritative empty list", async () => {
  const fetcher = async () => list([]);
  assert.equal((await terminateAnamResources(id, options, fetcher, now)).providerEnded, false);
  assert.equal((await terminateAnamResources(id, options, fetcher, now + 131_000)).providerEnded, true);
  assert.equal((await terminateAnamResources(id, options, async () => reply({}, 403), now + 131_000)).providerEnded, false);
  assert.equal((await terminateAnamResources(id, options, async () => reply({ data: [], meta: { next: 2 } }), now + 131_000)).providerEnded, false);
});

test("stop acceptance and stop 404 alone never prove native termination", async () => {
  for (const stopStatus of [200, 404]) {
    let ended = false;
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).includes("?search=")) return list([{ id: remoteId, clientLabel: anamLabel(id), endTime: null }]);
      if (init?.method === "POST") return reply({}, stopStatus);
      return reply({ id: remoteId, clientLabel: anamLabel(id), endTime: ended ? new Date(now).toISOString() : null });
    };
    assert.equal((await terminateAnamResources(id, options, fetcher, now)).providerEnded, false);
    ended = true;
    assert.equal((await terminateAnamResources(id, options, fetcher, now)).providerEnded, true);
  }
});

test("reconciliation never stops another label or trusts a mismatched provider row", async () => {
  let stops = 0;
  const foreign: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") stops++;
    return list([{ id: remoteId, clientLabel: "another-project", endTime: null }]);
  };
  assert.equal((await terminateAnamResources(id, options, foreign, now)).providerEnded, false);
  assert.equal(stops, 0);
  const mismatch: typeof fetch = async (input, init) => {
    if (String(input).includes("?search=")) return list([{ id: remoteId, clientLabel: anamLabel(id), endTime: null }]);
    if (init?.method === "POST") return reply({});
    return reply({ id: remoteId, clientLabel: "another-project", endTime: new Date(now).toISOString() });
  };
  assert.equal((await terminateAnamResources(id, options, mismatch, now)).providerEnded, false);
});
