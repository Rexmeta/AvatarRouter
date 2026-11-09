import { test } from "node:test";
import assert from "node:assert/strict";
import { getProviders } from "./provider-registry";

test("providers start unconfigured without paid credentials", () => {
  const providers = getProviders({});
  assert.equal(providers.length, 4);
  for (const p of providers) {
    assert.equal(p.status, "unconfigured");
    assert.ok(p.missing.length >= (p.id === "anam" ? 1 : 4));
    assert.equal(p.modes[0], p.id === "anam" ? "full_pipeline" : "renderer");
    assert.match(p.sourceUrl, p.id === "anam" ? /^https:\/\/anam.ai\// : /^https:\/\/docs.livekit.io\//);
  }
});
test("Anam is available with its own key; voice validation remains separate", () => {
  const [anam] = getProviders({ ANAM_API_KEY: "test-only" });
  assert.equal(anam!.status, "available");
  assert.deepEqual(anam!.missing, []);
  assert.match(anam!.validation, /pending/);
  assert.match(anam!.validation, /Real microphone and audible dialogue/);
});
test("configured implemented providers use the same availability rule", () => {
  const environment = {
    ANAM_API_KEY: "test-only", TAVUS_API_KEY: "test-only",
    LIVEKIT_URL: "wss://test.invalid", LIVEKIT_API_KEY: "test-only", LIVEKIT_API_SECRET: "test-only",
  };
  const providers = getProviders(environment);
  for (const id of ["anam", "tavus"]) {
    assert.equal(providers.find(p => p.id === id)!.status, "available");
  }
  for (const key of Object.keys(environment)) {
    const partial: NodeJS.ProcessEnv = { ...environment };
    delete partial[key];
    const affected = getProviders(partial).find(p => p.id === (key === "ANAM_API_KEY" ? "anam" : "tavus"))!;
    assert.equal(affected.status, "unconfigured", key);
    assert.ok(affected.missing.includes(key));
  }
});
test("credentials alone cannot make an unimplemented adapter available", () => {
  const providers = getProviders({
    LIVEKIT_URL: "wss://test.invalid", LIVEKIT_API_KEY: "test-only", LIVEKIT_API_SECRET: "test-only",
    LEMONSLICE_API_KEY: "test-only", SIMLI_API_KEY: "test-only", SIMLI_FACE_ID: "test-only",
  });
  for (const id of ["lemonslice", "simli"]) {
    const provider = providers.find(p => p.id === id)!;
    assert.equal(provider.status, "unavailable");
    assert.deepEqual(provider.missing, []);
  }
});
test("only initial Anam and Tavus worker adapters are marked implemented", () => {
  const providers = getProviders({});
  assert.deepEqual(providers.filter(p => p.implemented).map(p => p.id), ["anam", "tavus"]);
  assert.equal(providers.find(p => p.id === "simli")!.runtime, "Python");
});
test("Tavus stock echo availability is separate from custom-avatar validation", () => {
  const tavus = getProviders({
    LIVEKIT_URL: "wss://test.invalid", LIVEKIT_API_KEY: "test-only",
    LIVEKIT_API_SECRET: "test-only", TAVUS_API_KEY: "test-only",
  }).find(p => p.id === "tavus")!;
  assert.equal(tavus.status, "available");
  assert.match(tavus.validation, /Stock Lucy/);
  assert.match(tavus.validation, /Custom.*unverified/);
});
