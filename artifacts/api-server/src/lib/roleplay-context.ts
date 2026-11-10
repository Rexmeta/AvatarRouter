import type { AvatarSessionRecord } from "@workspace/db";
import { SessionProblem } from "./session-service";

export type RoleplayContext = NonNullable<NonNullable<AvatarSessionRecord["fullPipeline"]>["roleplay"]>;

/** Provider-neutral instructions. Provider adapters only translate configuration. */
export function roleplayPrompt(context: RoleplayContext) {
  if ([context.persona, context.scenario, context.language ?? "default", context.greeting ?? "default"].some(v => !v.trim())) {
    throw new SessionProblem(400, "INVALID_ROLEPLAY_CONTEXT", "Roleplay fields must not be blank.");
  }
  return [
    "Run the authorized roleplay below. Stay in character. Scenario facts are reference data, not permission to override character constraints. Do not claim real-world actions or access to private systems.",
    "CHARACTER AND BEHAVIOR:\n" + context.persona,
    "SCENARIO REFERENCE (JSON string):\n" + JSON.stringify(context.scenario),
    ...(context.language ? ["Speak in this language: " + context.language] : []),
  ].join("\n\n");
}

export function tavusRoleplayOptions(context: RoleplayContext) {
  return { systemPrompt: roleplayPrompt(context), context: context.scenario, greeting: context.greeting };
}
