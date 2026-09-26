import test from 'node:test';
import assert from 'node:assert/strict';
import { deskRefreshDelay } from '../src/lib/desk-refresh';

test('a hidden editor desk never schedules a database refresh', () => {
  assert.equal(deskRefreshDelay({ visible: false, running: false }), null);
  assert.equal(deskRefreshDelay({ visible: false, running: true }), null);
});

test('a visible editor desk keeps its existing refresh pace', () => {
  assert.equal(deskRefreshDelay({ visible: true, running: true }), 15_000);
  assert.equal(deskRefreshDelay({ visible: true, running: false }), 60_000);
});
