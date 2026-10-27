import type { Response } from "express";
import { mapRoleplayxIdentity, type RoleplayxIdentity } from "./roleplayx-auth";

export type IntegrationIdentity = {
  tenantId: string;
  ownerHash: string;
  scopes: readonly string[];
  provider: "api-key" | "roleplayx";
};

export function integrationIdentity(res: Response): IntegrationIdentity | undefined {
  const service = res.locals.serviceApiIdentity as IntegrationIdentity | undefined;
  if (service) return service;
  const roleplayx = res.locals.roleplayxIdentity as RoleplayxIdentity | undefined;
  return roleplayx ? { ...mapRoleplayxIdentity(roleplayx), scopes: roleplayx.scopes, provider: "roleplayx" } : undefined;
}
