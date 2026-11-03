import assert from "node:assert/strict";
import test from "node:test";
import { ownedProject, projectTenant } from "./developer-workspaces";
import { hashServiceValue } from "./service-api-keys";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
test("workspace selection requires exact membership in the interactive owner's projects", () => {
  const keys = [{projectId:a,projectName:"A"},{projectId:b,projectName:"B"},{projectId:a,projectName:"A"}];
  assert.equal(ownedProject(keys,a).keys.length,2);
  assert.ok(ownedProject(keys,a).keys.every(key=>key.projectId===a));
  for (const id of [b, "", "../keys", a+"extra"]) {
    assert.throws(()=>ownedProject([keys[0]!], id),{code:"WORKSPACE_NOT_FOUND"});
  }
  assert.throws(()=>ownedProject([],a),{code:"WORKSPACE_NOT_FOUND"});
});
test("workspace tenant is exactly the existing service-key namespace, not a new namespace", () => {
  assert.equal(projectTenant(a),hashServiceValue(`avatarrouter:project:${a}`));
  assert.notEqual(projectTenant(a),projectTenant(b));
  assert.notEqual(projectTenant(a),hashServiceValue(`avatar-router:user:${a}`));
});
