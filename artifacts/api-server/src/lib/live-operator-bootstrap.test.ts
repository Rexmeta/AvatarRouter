import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveOperatorBootstrap } from "./live-operator-bootstrap";

const account = () => ({
  id: "user_ProductionOperator1", primaryEmailAddressId: "email_1",
  emailAddresses: [{ id: "email_1", emailAddress: "operator@example.com", verification: { status: "verified" } }],
  banned: false, locked: false,
});
const resolved = (user = account()) => ({ totalCount: 1, data: [user] });

test("only verified primary email in the runtime tenant resolves an exact operator ID", async () => {
  const bootstrap = new LiveOperatorBootstrap(" Operator@Example.com ", "production");
  const requests: string[] = [];
  assert.deepEqual(await bootstrap.resolve(async email => {
    requests.push(email); return resolved();
  }), { configuredCount: 1, resolvedCount: 1 });
  assert.deepEqual(requests, ["operator@example.com"]);
  assert.equal(bootstrap.has("user_ProductionOperator1"), true);
  assert.equal(bootstrap.has("user_ProductionOperator1Extra"), false);
  assert.equal(bootstrap.has("user_DevelopmentOperator"), false);
});

test("development, empty, invalid and wildcard configuration never queries or grants", async () => {
  for (const [email, environment] of [
    ["operator@example.com", "development"], ["operator@example.com", undefined],
    ["", "production"], ["*@example.com", "production"], ["operator@example.com,broken", "production"],
  ]) {
    const bootstrap = new LiveOperatorBootstrap(email, environment);
    let calls = 0;
    await bootstrap.resolve(async () => { calls++; return resolved(); });
    assert.equal(calls, 0);
    assert.equal(bootstrap.has("user_ProductionOperator1"), false);
  }
});

test("absent, ambiguous, unverified, mismatched, secondary-only, banned and locked users remain denied", async () => {
  const user = account();
  const candidates = [
    { totalCount: 0, data: [] }, { totalCount: 2, data: [user, user] },
    { totalCount: 2, data: [user] },
    resolved({ ...user, emailAddresses: [{ ...user.emailAddresses[0]!, verification: { status: "unverified" } }] }),
    resolved({ ...user, emailAddresses: [{ ...user.emailAddresses[0]!, emailAddress: "other@example.com" }] }),
    resolved({ ...user, primaryEmailAddressId: "different" }),
    resolved({ ...user, banned: true }), resolved({ ...user, locked: true }),
    resolved({ ...user, id: "not-a-clerk-user" }),
  ];
  for (const candidate of candidates) {
    const bootstrap = new LiveOperatorBootstrap("operator@example.com", "production");
    assert.equal((await bootstrap.resolve(async () => candidate)).resolvedCount, 0);
    assert.equal(bootstrap.has(user.id), false);
  }
});

test("lookup errors, timeouts and late results never grant; a failed rerun removes prior resolution", async () => {
  const bootstrap = new LiveOperatorBootstrap("operator@example.com", "production");
  await bootstrap.resolve(async () => resolved());
  assert.equal(bootstrap.has(account().id), true);
  await bootstrap.resolve(async () => { throw new Error("private-clerk-error"); });
  assert.equal(bootstrap.has(account().id), false);
  let complete!: (value: ReturnType<typeof resolved>) => void;
  await bootstrap.resolve(() => new Promise(done => { complete = done; }), 5);
  complete(resolved());
  await Promise.resolve();
  assert.equal(bootstrap.has(account().id), false);
});

test("reruns are idempotent and removing configuration cannot retain a previous grant", async () => {
  const bootstrap = new LiveOperatorBootstrap("operator@example.com,OPERATOR@EXAMPLE.COM", "production");
  for (let n = 0; n < 2; n++) {
    assert.deepEqual(await bootstrap.resolve(async () => resolved()), { configuredCount: 1, resolvedCount: 1 });
  }
  const removed = new LiveOperatorBootstrap(undefined, "production");
  await removed.resolve(async () => resolved());
  assert.equal(removed.has(account().id), false);
});
