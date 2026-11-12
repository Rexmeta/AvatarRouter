import test from "node:test";
import assert from "node:assert/strict";
import { provisioningCompletion } from "./provisioning-completion";

test("completion message requires provider-confirmed ready state and an ID", () => {
  for (const status of ["queued", "submitting", "processing", "failed", "reconciliation_required", "deleting", "deleted"]) {
    for (const providerAvatarId of [null, "provider-fixture"]) {
      assert.deepEqual(provisioningCompletion({ status, providerAvatarId }), { completionMessage: null, completionMessageKo: null });
    }
  }
  assert.equal(provisioningCompletion({ status: "ready", providerAvatarId: null }).completionMessage, null);
  const ready = provisioningCompletion({ status: "ready", providerAvatarId: "provider-fixture" });
  assert.match(ready.completionMessage!, /completed/);
  assert.match(ready.completionMessageKo!, /생성이 완료/);
});
