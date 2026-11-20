import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type ErrorRequestHandler } from "express";
import operatorVoicesRouter from "./operator-voices";
import { SessionProblem } from "../lib/session-service";

test("voice gender curation rejects unsigned users and project service credentials", async () => {
  const app = express();
  app.use(express.json(), (req, res, next) => {
    if (req.get("x-test-service") === "yes") {
      res.locals.serviceApiIdentity = { provider: "api-key", tenantId: "test-tenant", ownerHash: "test-owner", scopes: ["assets:read"] };
    }
    Object.assign(req, {
      auth: Object.assign(() => ({ userId: null, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
      }),
    });
    next();
  });
  app.use("/api", operatorVoicesRouter);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof SessionProblem ? error.status : 500)
      .json({ code: error instanceof SessionProblem ? error.code : "INTERNAL_ERROR" });
  };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const read = await fetch(`${origin}/api/v1/operator/voice-catalog`);
    assert.equal(read.status, 401);
    assert.deepEqual(await read.json(), { code: "AUTHENTICATION_REQUIRED" });
    const serviceWrite = await fetch(`${origin}/api/v1/operator/voice-catalog/tavus/example-voice/gender`, {
      method: "PUT", headers: { "Content-Type": "application/json", "x-test-service": "yes" },
      body: JSON.stringify({ gender: "female" }),
    });
    assert.equal(serviceWrite.status, 403);
    assert.deepEqual(await serviceWrite.json(), { code: "TRUSTED_OPERATOR_REQUIRED" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
