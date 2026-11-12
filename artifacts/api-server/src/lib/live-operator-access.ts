import { liveOperatorBootstrap } from "./live-operator-bootstrap";

export function isTrustedLiveOperator(userId: string, configured = process.env.LIVE_SESSION_OPERATOR_IDS ?? "") {
  const allowed = new Set(configured.split(",").map(value => value.trim()).filter(Boolean));
  return allowed.has(userId) || liveOperatorBootstrap.has(userId);
}
