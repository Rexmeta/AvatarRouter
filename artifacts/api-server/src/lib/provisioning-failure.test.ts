import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageProviderAdapter, ProviderFailure } from "./provisioning-providers";
import { provisioningOutcome } from "./provisioning-worker";
import { decodeProvisioningFailure, presentProvisioningFailure, storeProvisioningFailure } from "./provisioning-failure";
import { GetAvatarAssetResponse } from "@workspace/api-zod";
const FailureSchema = GetAvatarAssetResponse.shape.failure;

test("reviewed image framing rejection becomes actionable without retaining provider free text", async () => {
  const message = "There was an issue processing your training image: The photo must show the subject from the navel (belly button) upward only. Fully exposed lower abdomen approaching the crotch/hips, or full-body framing, is not supported. Raised palms or arms lifted above the chest are also not supported. Please crop at or above the navel and keep hands at or below chest height.";
  const adapter = new ImageProviderAdapter("tavus", (async () => Response.json({
    status: "error", error_message: message,
  })) as typeof fetch, () => "fake");
  await assert.rejects(adapter.poll("testface"), (error: unknown) => {
    const result = provisioningOutcome(error, false);
    const failure = presentProvisioningFailure({ errorCode: result.storedCode, status: "failed", providerAvatarId: "existing" })!;
    FailureSchema.parse(failure);
    assert.equal(failure.providerErrorCode, "training_image_framing_invalid");
    assert.equal(failure.category, "input");
    assert.equal(failure.nextAction, "replace_image");
    assert.equal(failure.creationOutcome, "created");
    assert.match(failure.messageKo, /배꼽/);
    assert.equal(result.retryable, false);
    assert.ok(!result.storedCode.includes(message));
    return true;
  });
});

test("successful status HTTP can report asynchronous training failure without leaking body", async () => {
  const secret = "https://private.invalid/image?token=never-output";
  const adapter = new ImageProviderAdapter("tavus", (async () => Response.json({
    status: "error", error_message: secret, thumbnail_video_url: secret,
  })) as typeof fetch, () => "fake");
  await assert.rejects(adapter.poll("testface"), (error: unknown) => {
    const result = provisioningOutcome(error, false);
    assert.equal(result.code, "PROVIDER_TRAINING_FAILED");
    assert.equal(result.ambiguous, false);
    assert.equal(result.retryable, false);
    const failure = presentProvisioningFailure({ errorCode: result.storedCode, status: "failed", providerAvatarId: "private-id" })!;
    FailureSchema.parse(failure);
    assert.equal(failure.stage, "status");
    assert.equal(failure.providerHttpStatus, 200);
    assert.equal(failure.reasonState, "unrecognized_reason");
    assert.equal(failure.creationOutcome, "created");
    assert.equal(failure.category, "training");
    assert.equal(failure.automaticRetryAllowed, false);
    assert.ok(!JSON.stringify(failure).includes(secret));
    assert.ok(!JSON.stringify(failure).includes("private-id"));
    return true;
  });
});

test("upstream HTTP and reviewed reason persist separately from canonical public code", async () => {
  const adapter = new ImageProviderAdapter("tavus", (async () => Response.json({
    error: { code: "insufficient_credits", message: "sensitive ignored" },
  }, { status: 402 })) as typeof fetch, () => "fake");
  await assert.rejects(adapter.create("Fixture", "https://example.invalid/image", "anna"), (error: unknown) => {
    const result = provisioningOutcome(error, true);
    assert.equal(result.ambiguous, false);
    const decoded = decodeProvisioningFailure(result.storedCode)!;
    assert.equal(decoded.code, "PROVIDER_ENTITLEMENT_REQUIRED");
    const failure = presentProvisioningFailure({ errorCode: result.storedCode, status: "failed", providerAvatarId: null })!;
    assert.equal(failure.category, "billing");
    assert.equal(failure.providerHttpStatus, 402);
    assert.equal(failure.providerErrorCode, "insufficient_credits");
    assert.equal(failure.creationOutcome, "not_created");
    return true;
  });
});

test("timeout and server errors never authorize retry of a paid POST", async () => {
  for (const status of [408, 500, 503]) {
    const adapter = new ImageProviderAdapter("tavus", (async () => Response.json({}, { status })) as typeof fetch, () => "fake");
    await assert.rejects(adapter.create("Fixture", "https://example.invalid/image", "anna"), (error: unknown) => {
      assert.ok(error instanceof ProviderFailure);
      const result = provisioningOutcome(error, true);
      assert.equal(result.ambiguous, true);
      assert.equal(result.retryable, false);
      const failure = presentProvisioningFailure({ errorCode: result.storedCode, status: "reconciliation_required", providerAvatarId: null })!;
      assert.equal(failure.creationOutcome, "unknown");
      assert.equal(failure.nextAction, "operator_reconcile");
      return true;
    });
  }
});

test("legacy errors remain honest about missing details; forged diagnostics fail closed", () => {
  const failure = presentProvisioningFailure({ errorCode: "PROVIDER_TRAINING_FAILED", status: "failed", providerAvatarId: "existing" })!;
  assert.equal(failure.providerHttpStatus, null);
  assert.equal(failure.reasonState, "not_retained");
  assert.equal(failure.creationOutcome, "created");
  for (const value of [
    "PROVIDER_TRAINING_FAILED:status:HTTP_200:token_value:safe_code",
    "PROVIDER_TRAINING_FAILED:status:HTTP_999:none:safe_code",
    "PROVIDER_TRAINING_FAILED:status:HTTP_200:none:private",
    "PRIVATE_PROVIDER_ERROR",
  ]) assert.equal(decodeProvisioningFailure(value), null);
  assert.equal(storeProvisioningFailure("PRIVATE_PROVIDER_ERROR"), "PROVISIONING_INTERNAL_ERROR");
});
