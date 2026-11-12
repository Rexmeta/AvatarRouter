import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesToSeconds, validateBudget } from './workspace-budget-input';
test('whole minutes convert exactly; blank, negative, fractional, exponent and over-limit values reject', () => {
  assert.equal(minutesToSeconds('60'), 3600);
  assert.equal(minutesToSeconds('120'), 7200);
  assert.equal(minutesToSeconds('0'), 0);
  for (const s of ['', ' ', '-1', '1.5', '1e2', '1441', 'NaN']) assert.equal(minutesToSeconds(s), null);
});
test('project cannot exceed service; service has its own upper bound', () => {
  const budget = { service: { dailySeconds: 7200 } };
  assert.equal(validateBudget('project', 7201, budget), 'exceeds_service');
  assert.equal(validateBudget('project', 3600, budget), null);
  assert.equal(validateBudget('service', 10000, budget), null);
  assert.equal(validateBudget('service', 86401, budget), 'invalid');
});
