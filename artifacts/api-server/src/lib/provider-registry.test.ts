import { test } from "node:test";
import assert from "node:assert/strict";
import { getProviders } from "./provider-registry";

test("providers start unconfigured without paid credentials", () => {
  const providers = getProviders({});
  assert.equal(providers.length, 4);
  for (const p of providers) {
    assert.equal(p.status, "unconfigured");
    assert.ok(p.missing.length >= 4);
    assert.equal(p.modes[0], "renderer");
    assert.match(p.sourceUrl, /^https:\/\/docs.livekit.io\//);
  }
});
test("credential presence does not fabricate live validation", () => {
  const [anam] = getProviders({
    LIVEKIT_URL: "wss://test.invalid", LIVEKIT_API_KEY: "test-only",
    LIVEKIT_API_SECRET: "test-only", ANAM_API_KEY: "test-only", ANAM_AVATAR_ID: "test-only",
  });
  assert.equal(anam!.status, "unavailable");
  assert.deepEqual(anam!.missing, []);
  assert.match(anam!.validation, /pending/);
});
test("only initial Anam and Tavus worker adapters are marked implemented", () => {
  const providers = getProviders({});
  assert.deepEqual(providers.filter(p => p.implemented).map(p => p.id), ["anam", "tavus"]);
  assert.equal(providers.find(p => p.id === "simli")!.runtime, "Python");
});
