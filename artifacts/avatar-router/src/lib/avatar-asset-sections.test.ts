import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeAvatarAssetSection, avatarAssetNavigation, workspaceAvatarAssetSection } from './avatar-asset-sections';

test('project navigation presents five separate asset sections in the same workspace', () => {
  const projectId = 'project-one';
  const navigation = avatarAssetNavigation(projectId);
  assert.deepEqual(navigation.map(item => item.id), ['images', 'avatars', 'faces', 'voices', 'guide']);
  for (const item of navigation) {
    assert.equal(item.href, `/workspaces/${projectId}/${item.workspacePath}`);
    assert.equal(workspaceAvatarAssetSection(item.workspacePath), item.id);
    assert.equal(activeAvatarAssetSection(item.href, projectId), item.id);
    assert.equal(activeAvatarAssetSection(item.href, 'different-project'), undefined);
  }
  assert.equal(workspaceAvatarAssetSection('assets', 'existing-avatar-id'), 'avatars');
  assert.equal(activeAvatarAssetSection(`/workspaces/${projectId}/assets/existing-avatar-id`, projectId), 'avatars');
  assert.equal(workspaceAvatarAssetSection('stock-voices', 'extra-path'), undefined);
  assert.equal(workspaceAvatarAssetSection('activity'), undefined);
});

test('personal links preserve old details without exposing workspace-only stock menus', () => {
  const navigation = avatarAssetNavigation();
  assert.deepEqual(navigation.map(item => item.id), ['images', 'avatars', 'guide']);
  assert.equal(activeAvatarAssetSection('/avatar-assets'), 'avatars');
  assert.equal(activeAvatarAssetSection('/avatar-assets/existing-avatar-id'), 'avatars');
  assert.equal(activeAvatarAssetSection('/avatar-assets/images'), 'images');
  assert.equal(activeAvatarAssetSection('/avatar-assets/guide/?preview=true'), 'guide');
  assert.equal(activeAvatarAssetSection('/workspaces/a/stock-voices'), undefined);
});
