import test from 'node:test';
import assert from 'node:assert/strict';
import { errorResponse, HttpError } from '../src/lib/auth';

test('unexpected failures keep a generic public body but log the cause for the owner', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const failure = Object.assign(new Error('Your project has exceeded the data transfer quota.'), { code: 'XX000' });
  const response = errorResponse(failure);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, 'The operation could not complete. Check the service configuration and try again.');
  assert.doesNotMatch(JSON.stringify(body), /quota|XX000/);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0][1], { name: 'Error', code: 'XX000', message: 'Your project has exceeded the data transfer quota.' });
});

test('expected HTTP errors are returned as-is and are not logged as failures', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const response = errorResponse(new HttpError('Unauthorized scheduler.', 401));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'Unauthorized scheduler.');
  assert.equal(logged.length, 0);
});

test('Postgres quota and resource exhaustion defer the newsroom timer with HTTP 503', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const failure = Object.assign(new Error('Your account or project has exceeded the quota. Upgrade your plan to increase limits.'), { name: 'PostgresError', code: '53000' });
  const response = errorResponse(failure);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, 'The newsroom database is temporarily unavailable. Check storage quota, then the next scheduled run will resume.');
  assert.doesNotMatch(JSON.stringify(body), /Upgrade your plan|53000/);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0][1], { name: 'PostgresError', code: '53000', message: failure.message });
});

test('other Postgres errors stay generic HTTP 500 failures', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const failure = Object.assign(new Error('duplicate key value violates unique constraint'), { name: 'PostgresError', code: '23505' });
  const response = errorResponse(failure);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, 'The operation could not complete. Check the service configuration and try again.');
  assert.doesNotMatch(JSON.stringify(body), /duplicate key|23505/);
  assert.equal(logged.length, 1);
});
