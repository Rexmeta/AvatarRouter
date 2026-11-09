import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { AnamRuntime, anamLabel, anamTokenBody, anamRoleplayPersona, terminateAnamResources, ANAM_PERSONA_ID } from "./anam-runtime";
import { CreateSessionBody } from "@workspace/api-zod";
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

const template = {
  avatar: { id }, voice: { id: remoteId }, llmId: id, avatarModel: "cara-4",
  tools: [{ name: "private-webhook" }], knowledge: [{ id: "private-folder" }],
  brain: { systemPrompt: "shared-private-prompt" },
};
const roleplay = { persona: "까다로운 구매 담당자", scenario: "가격 협상 연습. 예산 100만원.", language: "Korean", greeting: "가격을 설명해 주세요." };

test("roleplay contract enforces required fields and bounded inputs", () => {
  const input = { providerId: "anam", avatarId: "anam-persona-default", mode: "live", pipeline: "anam_full", roleplay };
  assert.deepEqual(CreateSessionBody.parse(input).roleplay, roleplay);
  for (const invalid of [{ persona: "x" }, { ...roleplay, scenario: "" }, { ...roleplay, persona: "x".repeat(8001) }, { ...roleplay, scenario: "x".repeat(16001) }]) {
    assert.equal(CreateSessionBody.safeParse({ ...input, roleplay: invalid }).success, false);
  }
});

test("ephemeral roleplay uses template media only, isolated prompts and no shared knowledge or tools", () => {
  const config = anamRoleplayPersona(template, roleplay);
  assert.equal(config.avatarId, id);
  assert.equal(config.voiceId, remoteId);
  assert.equal(config.initialMessage, roleplay.greeting);
  assert.equal(config.maxSessionLengthSeconds, 120);
  assert.ok(config.systemPrompt.includes(roleplay.persona));
  assert.ok(config.systemPrompt.includes(roleplay.scenario));
  assert.ok(config.systemPrompt.includes("Korean"));
  for (const secret of ["private-webhook", "private-folder", "shared-private-prompt"]) {
    assert.ok(!JSON.stringify(config).includes(secret));
  }
  assert.ok(!("personaId" in config));
  const second = anamRoleplayPersona(template, { persona: "다른 역할", scenario: "별도 대화" });
  assert.ok(!second.systemPrompt.includes(roleplay.persona));
  assert.throws(() => anamRoleplayPersona({ ...template, voice: null }, roleplay), { code: "ANAM_TEMPLATE_INVALID" });
});

test("roleplay reads a fixed template once then mints one token and discards context", async () => {
  const calls: string[] = [];
  let saved: unknown;
  const row = { ...sampleRow, fullPipeline: { systemPrompt: "", roleplay } };
  const runtime = new AnamRuntime(row, async () => {}, async () => {}, async value => { saved = value; },
    async (input, init) => {
      calls.push(String(input));
      if (calls.length === 1) {
        assert.equal(String(input), `https://api.anam.ai/v1/personas/${ANAM_PERSONA_ID}`);
        assert.equal(init?.method, "GET");
        return reply(template);
      }
      const body = JSON.parse(init?.body as string);
      assert.deepEqual(body.personaConfig, anamRoleplayPersona(template, roleplay));
      assert.equal(body.maxSessions, 1);
      return reply({ sessionToken: "private-test-roleplay-token" });
    });
  await Promise.all([runtime.start(), runtime.start()]);
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(saved).includes(roleplay.persona));
  assert.ok(!JSON.stringify(presentSession({ ...row, fullPipeline: saved as AvatarSessionRecord["fullPipeline"] })).includes(roleplay.scenario));
});

test("missing or invalid template never falls back to shared persona or issues a token", async () => {
  for (const response of [() => reply({}, 403), () => reply({ avatar: null })]) {
    let calls = 0, rejected = 0;
    const runtime = new AnamRuntime({ ...sampleRow, fullPipeline: { systemPrompt: "", roleplay } },
      async () => {}, async () => { rejected++; }, async () => { assert.fail("must not persist token"); },
      async () => { calls++; return response(); });
    await assert.rejects(runtime.start(), (e: { code?: string }) => ["ANAM_TEMPLATE_UNAVAILABLE", "ANAM_TEMPLATE_INVALID"].includes(e.code!));
    assert.equal(calls, 1);
    assert.equal(rejected, 1);
  }
});

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
  assert.equal(anam.status, "available"); // configured + implemented, not a playback-validation claim
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
