import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { beginRunRecord, finishRunRecord, operationsPayload, sendOwnerAlert, estimateRunCost } from '../src/lib/operations';
import { createBackup, parseBackup, restoreBackupToNewSqlite, restoreBackupToNewPostgres } from '../src/lib/backup';
import { closeStore, readStore, transact } from '../src/lib/store';
import { closeDocuments, exportDocuments, updateDocument } from '../src/lib/durable-store';
import { GET as downloadBackup } from '../src/app/api/owner/backup/route';
import { POST as operationsAction } from '../src/app/api/owner/operations/route';
import { runNewsroom, decideStory } from '../src/lib/engine';
import { DEMO_ITEMS } from '../src/lib/fixtures';
import { collectSourcesOnly, startRun } from '../src/lib/service';
import { GET as scheduler } from '../src/app/api/cron/route';
import type { GatewayUsage } from '../src/lib/providers';

const directory = mkdtempSync(join(tmpdir(), 'thursday-post-operations-'));
const saved = Object.fromEntries(['DATABASE_URL', 'VERCEL', 'NEWSROOM_DB_FILE', 'NEWSROOM_DOCUMENT_DB_FILE', 'NEWSROOM_MODEL_PRICES_JSON', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'NEWSROOM_OWNER_ALERT_EMAIL', 'LOCAL_DEMO_ACCESS'].map(key => [key, process.env[key]]));
delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.NEWSROOM_DOCUMENT_DB_FILE; delete process.env.NEWSROOM_MODEL_PRICES_JSON;
process.env.NEWSROOM_DB_FILE = join(directory, 'source.sqlite');
process.env.LOCAL_DEMO_ACCESS = 'true';
after(async () => {
  await closeDocuments(); await closeStore();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const target = resolve(directory);
  if (target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/')) rmSync(target, { recursive: true, force: true });
});

test('durable run records are idempotent, redact provider errors and price only explicit model rates', async () => {
  const usage = [{ model: 'fixture/model', stage: 'research' as const, inputTokens: 1_000_000, outputTokens: 500_000 }];
  assert.equal(estimateRunCost(usage, '{}'), null);
  assert.equal(estimateRunCost(usage, '{"fixture/model":{"inputUsdPerMillion":2,"outputUsdPerMillion":8}}'), 6);
  assert.equal(estimateRunCost([{ ...usage[0], outputTokens: null }], '{"fixture/model":{"inputUsdPerMillion":2,"outputUsdPerMillion":8}}'), null);
  const record = await beginRunRecord('live', 'run-failure-fixture');
  assert.deepEqual(await beginRunRecord('live', record.id), record);
  const finished = await finishRunRecord(record.id, { status: 'failed', error: new Error('SECRET reader@example.invalid private investigation'), usage });
  assert.equal(finished.estimatedUsd, null);
  assert.deepEqual(await finishRunRecord(record.id, { status: 'completed', usage }), finished);
  const health = await operationsPayload();
  assert.equal(health.totals.started, 1); assert.equal(health.totals.failed, 1); assert.equal(health.totals.completed, 0);
  assert.equal(health.totals.inputTokens, 1_000_000);
  assert.ok(!JSON.stringify(health).includes('SECRET')); assert.ok(!JSON.stringify(health).includes('reader@example.invalid'));
  assert.ok(health.issues.some(issue => issue.code === 'latest_live_failed'));
});

test('health identifies stale and missed daily work without reading private content into the response', async () => {
  await transact(data => { data.monitoring = true; data.inbox.push({ id: 'private-email', title: 'Private reader lead', content: 'CONFIDENTIAL_SOURCE_BODY', url: 'email:fixture', type: 'email', sourceName: 'Reader', independenceKey: 'mail', publishedAt: '2026-09-09T00:00:00Z', retrievedAt: '2026-09-09T00:00:00Z', rawOriginal: 'PRIVATE_RAW_ORIGINAL' }); });
  await beginRunRecord('live', 'stale-run-fixture');
  const health = await operationsPayload(Date.now() + 27 * 60 * 60_000);
  assert.ok(health.issues.some(issue => issue.code === 'missed_daily_run'));
  assert.ok(health.staleRunIds.includes('stale-run-fixture'));
  assert.equal(health.counts.inbox, 1);
  assert.ok(!JSON.stringify(health).includes('CONFIDENTIAL_SOURCE_BODY'));
  await finishRunRecord('stale-run-fixture', { status: 'interrupted' });
});

test('owner alert sends only to the configured owner once and never includes source content', async () => {
  process.env.RESEND_API_KEY = 'fixture-resend-key'; process.env.RESEND_FROM_EMAIL = 'Thursday Post <news@example.invalid>'; process.env.NEWSROOM_OWNER_ALERT_EMAIL = 'owner@example.invalid';
  let sent = 0;
  const transport: typeof fetch = async (url, init) => {
    sent++; assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.to, ['owner@example.invalid']);
    assert.ok(!String(init?.body).includes('CONFIDENTIAL_SOURCE_BODY'));
    assert.ok((init?.headers as Record<string, string>)['Idempotency-Key'].startsWith('owner-alert-'));
    return Response.json({ id: 'fixture-message' });
  };
  assert.equal((await sendOwnerAlert('run-failure-fixture', { transport })).status, 'sent');
  assert.equal((await sendOwnerAlert('run-failure-fixture', { transport })).status, 'sent');
  assert.equal(sent, 1);
  process.env.NEWSROOM_OWNER_ALERT_EMAIL = 'owner@example.invalid,unapproved@example.invalid';
  assert.equal((await sendOwnerAlert('stale-run-fixture', { transport })).status, 'not_configured');
  assert.equal(sent, 1);
});

test('backup contains complete private source data and named documents, validates integrity and restores to a new isolated database', async () => {
  const populatedState = (await readStore()).state;
  await runNewsroom(populatedState, { mode: 'demo', items: DEMO_ITEMS });
  decideStory(populatedState, populatedState.stories[0].id, 'approve', 'Reviewed synthetic restore fixture', false);
  await transact(data => { data.state = populatedState; });
  await updateDocument('fixture-private-document', () => ({ notes: [] as string[] }), data => { data.notes.push('PRIVATE_DOCUMENT_VALUE'); });
  const store = await readStore(); const documents = await exportDocuments();
  const backup = await createBackup();
  assert.deepEqual(backup.payload.store, store); assert.deepEqual(backup.payload.documents, documents);
  assert.equal(backup.payload.store.state.publications.length, 1);
  assert.ok(JSON.stringify(backup).includes('PRIVATE_RAW_ORIGINAL'));
  const serialized = JSON.stringify(backup);
  assert.deepEqual(parseBackup(serialized), backup);
  assert.throws(() => parseBackup(serialized.replace('PRIVATE_DOCUMENT_VALUE', 'TAMPERED_DOCUMENT')), /integrity/);
  assert.throws(() => parseBackup({ ...backup, unexpected: true }), /validation/);
  const target = join(directory, 'restored.sqlite');
  const result = restoreBackupToNewSqlite(backup, target);
  assert.equal(result.verified, true);
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const row = db.prepare('SELECT payload FROM newsroom WHERE id=1').get() as { payload: string };
    assert.deepEqual(JSON.parse(row.payload), store);
    const restored = (db.prepare('SELECT id,payload,revision FROM newsroom_documents ORDER BY id').all() as { id: string; payload: string; revision: number }[]).map(item => ({ ...item, payload: JSON.parse(item.payload) }));
    assert.deepEqual(restored, documents);
  } finally { db.close(); }
  assert.throws(() => restoreBackupToNewSqlite(backup, target), /new local database/);
  assert.throws(() => restoreBackupToNewSqlite(backup, process.env.NEWSROOM_DB_FILE!), /new local database/);
  assert.deepEqual(await readStore(), store);
});

test('backup endpoint requires owner access, rejects active runs and mutation endpoint enforces same-origin', async () => {
  assert.equal((await downloadBackup(new Request('https://newsroom.example/api/owner/backup'))).status, 401);
  const response = await downloadBackup(new Request('http://127.0.0.1/api/owner/backup'));
  assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition')!, /attachment/); assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal(parseBackup(await response.text()).format, 'thursday-post-backup');
  await transact(data => { data.lease = { id: 'active-backup-test', mode: 'demo', expiresAt: new Date(Date.now() + 60_000).toISOString() }; });
  await assert.rejects(() => createBackup(), /active newsroom run/);
  await transact(data => { delete data.lease; });
  const mutation = new Request('http://127.0.0.1/api/owner/operations', { method: 'POST', headers: { origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'alert', runId: 'run-failure-fixture' }) });
  assert.equal((await operationsAction(mutation)).status, 403);
});

test('Postgres restore rejects the configured source before any connection and CLI restores an isolated copy without printing private data', async () => {
  const backup = await createBackup();
  process.env.DATABASE_URL = 'postgres://fixture:secret@fixture.example/source';
  await assert.rejects(() => restoreBackupToNewPostgres(backup, 'postgres://different:credential@fixture.example/source?sslmode=require'), /differ/);
  delete process.env.DATABASE_URL;
  const filename = join(directory, 'fixture-backup.json');
  const exported = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backup.mjs', '--output', filename], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /Private backup saved/);
  assert.deepEqual(parseBackup(readFileSync(filename)).payload, backup.payload);
  const target = join(directory, 'cli-restored.sqlite');
  const restored = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/restore-backup.mjs', '--input', filename, '--sqlite', target], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /Isolated restore verified/);
  assert.ok(!restored.stdout.includes('PRIVATE')); assert.ok(!restored.stderr.includes('secret@'));
  const before = createHash('sha256').update(readFileSync(target)).digest('hex');
  const refused = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/restore-backup.mjs', '--input', filename, '--sqlite', target], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(createHash('sha256').update(readFileSync(target)).digest('hex'), before);
});

test('source-only collection recovers an expired run and a later live run consumes its archived backlog with persisted usage', async () => {
  const settings = Object.fromEntries(['NEWSROOM_AI_PAUSED', 'AI_GATEWAY_API_KEY', 'NEWSROOM_MODEL'].map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected external request'); };
  process.env.NEWSROOM_AI_PAUSED = 'true';
  const item = { id: 'archived-live-safety', title: 'Thoroughbred track safety consultation opens', content: 'The racing authority opened a track safety consultation.', url: 'https://authority.example.org/track-safety', type: 'official' as const, sourceName: 'Racing Authority', independenceKey: 'authority-record', publishedAt: '2026-09-09T00:00:00Z', retrievedAt: '2026-09-09T01:00:00Z' };
  try {
    await beginRunRecord('live', 'expired-research-fixture');
    await transact(data => { data.lease = { id: 'expired-research-fixture', mode: 'live', expiresAt: new Date(Date.now() - 1000).toISOString() }; });
    const collected = await collectSourcesOnly({ collect: async options => { assert.ok(options!.deadline! <= Date.now() + 90_000); return { items: [item], errors: [] }; } });
    assert.equal(collected.added, 1);
    let health = await operationsPayload();
    assert.equal(health.runs.find(run => run.id === 'expired-research-fixture')!.status, 'interrupted');
    assert.ok(health.runs.some(run => run.mode === 'collect' && run.status === 'completed'));
    assert.ok(!(await readStore()).state.stories.some(story => story.sourceItems.includes(item.id)));
    process.env.NEWSROOM_AI_PAUSED = 'false'; process.env.AI_GATEWAY_API_KEY = 'fixture-key'; process.env.NEWSROOM_MODEL = 'fixture/model';
    const usage: GatewayUsage[] = [];
    await startRun('live', { collect: async options => { assert.ok(options!.deadline! <= Date.now() + 60_000); return { items: [], errors: [] }; }, createProvider: () => ({ usage, async preflight() { usage.push({ model: 'fixture/model', stage: 'preflight', inputTokens: 10, outputTokens: 2 }); }, async research(request) { usage.push({ model: 'fixture/model', stage: 'research', inputTokens: 20, outputTokens: 10 }); return { findings: request.sourceItems.filter(source => source.type === 'official').map(source => ({ text: 'Authority record', kind: 'record_statement' as const, sourceIds: [source.id], quote: source.content, confidence: 'high' as const })) }; } }) });
    const story = (await readStore()).state.stories.find(story => story.mode === 'live' && story.sourceItems.includes(item.id));
    assert.equal(story?.status, 'waiting_approval');
    health = await operationsPayload();
    const live = health.runs.find(run => run.mode === 'live')!;
    assert.equal(live.status, 'completed'); assert.ok(live.inputTokens > 10); assert.equal(live.usage.length, usage.length);
    assert.equal(networkCalls, 0); assert.equal((await readStore()).lease, undefined);
    assert.equal((await readStore()).state.publications.filter(publication => publication.mode === 'live').length, 0);
  } finally { globalThis.fetch = originalFetch; for (const [key, value] of Object.entries(settings)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('authenticated cron checks previously authorized delivery while monitoring is paused and never starts a new campaign', async () => {
  const settings = Object.fromEntries(['CRON_SECRET', 'RESEND_FROM_EMAIL', 'NEWSROOM_PUBLIC_URL', 'RESEND_API_KEY'].map(key => [key, process.env[key]]));
  process.env.CRON_SECRET = 'fixture-cron-secret-with-at-least-32-characters';
  delete process.env.RESEND_API_KEY;
  await transact(data => { data.monitoring = false; });
  const before = await exportDocuments();
  const response = await scheduler(new Request('https://newsroom.example/api/cron', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.skipped, true); assert.equal(result.publishedAutomatically, false);
  assert.deepEqual(result.delivery, { processed: 0, sent: 0, configured: false });
  assert.deepEqual(await exportDocuments(), before);
  for (const [key, value] of Object.entries(settings)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
