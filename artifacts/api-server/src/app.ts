import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { SessionProblem } from "./lib/session-service";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? "",
    process.env.CLERK_PUBLISHABLE_KEY,
  ),
})));
// Larger body only after authentication, and only for bounded image ingestion.
// The route attaches its own parser so anonymous clients cannot decode 6MB JSON.
app.use((req, res, next) => {
  if (req.path === "/api/v1/assets/images" && req.method === "POST") return next();
  if (/^\/api\/v1\/sessions\/[^/]+\/audio$/.test(req.path) && req.method === "POST") return next();
  return express.json({ limit: "16kb" })(req, res, next);
});
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof SessionProblem) {
    res.status(error.status).json({ code: error.code, error: error.message }); return;
  }
  if (error?.type === "entity.parse.failed" || error?.name === "ZodError") {
    res.status(400).json({ code: "INVALID_REQUEST", error: "Invalid request." }); return;
  }
  if (error?.type === "entity.too.large") {
    res.status(413).json({ code: "REQUEST_TOO_LARGE", error: "Request body is too large." }); return;
  }
  req.log.error({ errorType: error?.name ?? "Error" }, "API operation failed");
  res.status(500).json({ code: "INTERNAL_ERROR", error: "The operation failed. Please retry or check server diagnostics." });
};
app.use(errorHandler);

export default app;
