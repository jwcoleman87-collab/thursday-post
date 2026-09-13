import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { closeStore, readStore, transact, initialStore } from '../src/lib/store';
import { closeDocuments } from '../src/lib/durable-store';
import { createState, runNewsroom } from '../src/lib/engine';
import { createBackup, parseBackup, restoreBackupToNewSqlite } from '../src/lib/backup';
import { signSession } from '../src/lib/auth';
import { GET as contextGET, POST as editorialPOST } from '../src/app/api/editorial/route';
import { GET as newsroomGET } from '../src/app/api/newsroom/route';
import type { ResearchProvider, SourceItem } from '../src/lib/domain';

const directory = mkdtempSync(join(tmpdir(), 'scope-api-'));
const keys = ['DATABASE_URL', 'VERCEL', 'NEWSROOM_DB_FILE', 'NEWSROOM_DOCUMENT_DB_FILE', 'AUTH_SECRET', 'ADMIN_PASSWORD', 'LOCAL_DEMO_ACCESS', 'NEWSROOM_DELEGATED_SCOPE_ASSESSMENT'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
delete process.env.DATABASE_URL; delete process.env.VERCEL;
process.env.NEWSROOM_DB_FILE = join(directory, 'newsroom.sqlite');
process.env.NEWSROOM_DOCUMENT_DB_FILE = join(directory, 'documents.sqlite');
process.env.AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex');
process.env.LOCAL_DEMO_ACCESS = 'false';
const quote = 'The racing authority recorded the revised meeting date';
const question = 'Can you provide more details about owners and stable staff for a fuller profile?';
const rationale = 'This briefing quotes only the authority’s meeting date, not ownership or staffing. The requested additional profile angle supports no assertion in this version.';
const source: SourceItem = { id: 'scope-http-source', title: 'Racing welfare update', content: quote + '.', type: 'official', sourceName: 'Scope HTTP fixture authority', independenceKey: 'fixture-authority', url: 'https://records.example.org/scope-http-fixture', publishedAt: '2026-09-11T00:00:00Z', retrievedAt: '2026-09-11T01:00:00Z', region: 'QLD' };
const provider: ResearchProvider = {
  async research() { return { findings: [{ text: quote, quote, kind: 'record_statement', sourceIds: [source.id], confidence: 'high', questions: [], contradictorySourceIds: [] }] }; },
  async draft(request) { const claim = request.story.claims[0]; return { headline: 'Meeting update', sentences: [{ text: claim.text, claimIds: [claim.id] }], researchRequests: [{ agentId: 6, question }] }; },
};

beforeEach(async () => {
  process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT = 'false';
  await transact(data => { Object.assign(data, initialStore()); });
});
after(async () => {
  await closeStore(); await closeDocuments();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  rmSync(directory, { recursive: true, force: true });
});
function request(path: string, body?: unknown, authenticated = true, origin = 'https://paper.example') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', origin };
  if (authenticated) headers.cookie = `newsroom_session=${signSession()}`;
  return new Request(`https://paper.example${path}`, { headers, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function fixture() {
  const state = createState();
  await runNewsroom(state, { mode: 'live', items: [source], maxRounds: 1, maxTaskRetries: 0 }, provider);
  const story = state.stories[0], gap = story.gaps.find(gap => gap.question === question)!;
  await transact(data => { data.state = state; });
  const url = `/api/editorial?storyId=${encodeURIComponent(story.id)}&gapId=${encodeURIComponent(gap.id)}`;
  const response = await contextGET(request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const context = await response.json();
  const input = { action: 'scope_assessment', storyId: story.id, gapId: gap.id, rationale, claimIds: story.draft!.sentences.flatMap(sentence => sentence.claimIds), expectedDraftHash: context.expectedDraftHash, expectedEvidenceFingerprint: context.expectedEvidenceFingerprint };
  return { story, gap, input, url };
}

test('scope endpoints reject anonymous, forged, cross-origin and undelegated writes without changing state', async () => {
  const { input, url } = await fixture();
  const before = await readStore();
  assert.equal((await contextGET(request(url, undefined, false))).status, 401);
  assert.equal((await editorialPOST(request('/api/editorial', input, false))).status, 401);
  assert.equal((await editorialPOST(new Request('https://paper.example/api/editorial', { method: 'POST', headers: { origin: 'https://paper.example', 'Content-Type': 'application/json', cookie: 'newsroom_session=forged' }, body: JSON.stringify(input) }))).status, 401);
  assert.equal((await editorialPOST(request('/api/editorial', input, true, 'https://attacker.example'))).status, 403);
  assert.equal((await editorialPOST(request('/api/editorial', input))).status, 403);
  assert.deepEqual(await readStore(), before);
});

test('scope endpoint rejects smuggled actor, verdict and authority fields even when enabled', async () => {
  const { input } = await fixture();
  process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT = 'true';
  const before = await readStore();
  for (const injected of [{ assessor: 'James' }, { outcome: 'verified' }, { authorised: true }, { authorisingOwner: 'someone-else' }])
    assert.equal((await editorialPOST(request('/api/editorial', { ...input, ...injected }))).status, 400);
  assert.deepEqual(await readStore(), before);
});

test('scope write rechecks draft and evidence bindings and rejects an active research lease', async () => {
  const { input } = await fixture();
  process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT = 'true';
  assert.equal((await editorialPOST(request('/api/editorial', { ...input, expectedDraftHash: '0'.repeat(64) }))).status, 409);
  assert.equal((await editorialPOST(request('/api/editorial', { ...input, expectedEvidenceFingerprint: '0'.repeat(64) }))).status, 409);
  await transact(data => { data.lease = { id: 'scope-test-lease', mode: 'live', expiresAt: new Date(Date.now() + 60_000).toISOString() }; });
  assert.equal((await editorialPOST(request('/api/editorial', input))).status, 409);
  await transact(data => { delete data.lease; data.state.stories[0].claims[0].questions = ['A changed question']; });
  assert.equal((await editorialPOST(request('/api/editorial', input))).status, 409);
  assert.equal((await readStore()).state.stories[0].gaps.find(gap => gap.id === input.gapId)!.scopeAssessment, undefined);
});

test('actual HTTP assessment reaches the owner tray, survives backup restore, and can be withdrawn with delegation off', async () => {
  const { input } = await fixture();
  process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT = 'true';
  const response = await editorialPOST(request('/api/editorial', input));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.state.stories[0].status, 'waiting_approval');
  assert.equal(payload.state.publications.length, 0);
  const store = await readStore();
  const assessment = store.state.stories[0].gaps.find(gap => gap.id === input.gapId)!.scopeAssessment;
  assert.equal(assessment!.assessor, 'newsroom-assessor');
  assert.equal(store.state.stories[0].draft!.factReview, undefined);
  const backup = await createBackup();
  assert.deepEqual(parseBackup(JSON.stringify(backup)).payload.store, store);
  const target = join(directory, 'scope-restored.sqlite');
  assert.equal(restoreBackupToNewSqlite(backup, target).verified, true);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    const row = restored.prepare('SELECT payload FROM newsroom WHERE id=1').get() as { payload: string };
    assert.deepEqual(JSON.parse(row.payload), store);
  } finally { restored.close(); }
  process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT = 'false';
  const withdrawal = { action: 'withdraw_scope_assessment', storyId: input.storyId, gapId: input.gapId, note: 'Please report this angle before publication.', expectedDraftHash: input.expectedDraftHash };
  const { expectedDraftHash: _hash, ...noHash } = withdrawal;
  assert.equal((await editorialPOST(request('/api/editorial', noHash))).status, 400);
  const withdrawn = await editorialPOST(request('/api/editorial', withdrawal));
  assert.equal(withdrawn.status, 200);
  const after = (await readStore()).state;
  assert.equal(after.stories[0].status, 'sent_back');
  assert.equal(after.stories[0].gaps.find(gap => gap.id === input.gapId)!.scopeAssessment, undefined);
  assert.equal(after.publications.length, 0);
});

test('owner GET never presents a superseded assessment as active or mutates the persisted audit', async () => {
  const { input } = await fixture();
  process.env.NEWSROOM_DELEGATED_SCOPE_ASSESSMENT = 'true';
  assert.equal((await editorialPOST(request('/api/editorial', input))).status, 200);
  await transact(data => { data.state.stories[0].claims[0].questions = ['New evidence issue']; });
  const stored = await readStore();
  const response = await newsroomGET(request('/api/newsroom'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.state.stories[0].gaps.find((gap: { id: string }) => gap.id === input.gapId).scopeAssessment, undefined);
  assert.equal(payload.state.stories[0].status, 'blocked');
  assert.deepEqual(await readStore(), stored);
});
