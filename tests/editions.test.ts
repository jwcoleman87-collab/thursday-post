import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Webhook } from 'svix';
import { closeStore, transact } from '../src/lib/store';
import { closeDocuments, readDocument, updateDocument } from '../src/lib/durable-store';
import { createState, draftHash } from '../src/lib/engine';
import { createEdition, currentEditionArticles, editionPreview, getEdition, listEditions, releaseEdition, updateEdition } from '../src/lib/editions';
import { DELIVERY_DOCUMENT, getDeliveryStatus, initialDelivery, processDeliveryQueue, queueEditionDelivery, receiveDeliveryWebhook, unsubscribeDelivery } from '../src/lib/delivery';
import { COMMERCE_DOCUMENT, initialCommerce, type Member } from '../src/lib/commerce-types';
import { consumeMagicLink, unsubscribeToken } from '../src/lib/members';
import { GET as publicEdition } from '../src/app/api/editions/[id]/route';
import { GET as publicList } from '../src/app/api/editions/route';
import { POST as createRoute } from '../src/app/api/owner/editions/route';
import { POST as ownerAction } from '../src/app/api/owner/editions/[id]/route';
import { GET as unsubscribeGet, POST as unsubscribePost } from '../src/app/api/unsubscribe/route';
import { signSession } from '../src/lib/auth';
import type { ArticleDraft, Publication, SourceItem, Story } from '../src/lib/domain';

const folder = mkdtempSync(join(tmpdir(), 'thursday-editions-test-'));
process.env.NEWSROOM_DB_FILE = join(folder, 'newsroom.sqlite');
process.env.NEWSROOM_DOCUMENT_DB_FILE = join(folder, 'documents.sqlite');
delete process.env.DATABASE_URL; delete process.env.VERCEL;
process.env.AUTH_SECRET = randomBytes(32).toString('hex');
process.env.MEMBER_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex');
process.env.LOCAL_DEMO_ACCESS = 'false';
// These tests cover snapshots, hashes, entitlement and delivery with one-line fixture articles.
// The five-page release gate has its own tests in edition-pages.test.ts.
process.env.EDITION_MINIMUM_PAGES = '0';
process.env.RESEND_API_KEY = 'test-only-no-network';
process.env.STRIPE_SECRET_KEY = 'sk_test_editions_fixture_only';
process.env.RESEND_FROM_EMAIL = 'The Thursday Post <editions@post.example.org>';
process.env.NEWSROOM_PUBLIC_URL = 'https://post.example.org';
process.env.RESEND_DELIVERY_WEBHOOK_SECRET = `whsec_${randomBytes(32).toString('base64')}`;
const actualFetch = globalThis.fetch;
after(async () => { globalThis.fetch = actualFetch; await closeStore(); await closeDocuments(); rmSync(folder, { recursive: true, force: true }); });

const now = () => new Date().toISOString();
function member(): Member {
  return { id: randomUUID(), email: 'reader@example.org', verifiedAt: now(), createdAt: now(), deliveryEnabled: true, consentAt: now(), consentVersion: 'edition-email-v1', suppressedAt: null, suppressionReason: null, stripeCustomerId: 'cus_test', subscription: { stripeMode: 'test', id: 'sub_test', status: 'active', paidThrough: new Date(Date.now() + 86400_000).toISOString(), cancelAtPeriodEnd: false, latestInvoiceId: 'in_test', reconciledAt: now() } };
}
let reader: Member;
beforeEach(async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected unmocked network request.'); };
  process.env.RESEND_API_KEY = 'test-only-no-network';
  reader = member();
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { Object.assign(data, initialCommerce()); data.members[reader.id] = reader; });
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => Object.assign(data, initialDelivery()));
  await updateDocument('newspaper-editions', () => ({ version: 1, editions: [] }), data => { data.editions = []; });
  await transact(data => { data.state = createState(); });
});

async function seedPublication(id = 'pub-one') {
  const stamp = now();
  const source: SourceItem = { id: `source-${id}`, title: 'Official track notice', content: 'The track meeting starts at noon.', url: 'https://racing.example.org/notice', type: 'official', sourceName: 'Racing authority', independenceKey: 'authority', publishedAt: stamp, retrievedAt: stamp };
  const draft: ArticleDraft = { id: `draft-${id}`, headline: `Track notice ${id}`, byline: 'Agent One', peAgentId: 1, sentences: [{ text: `PAID BODY SECRET ${id}`, claimIds: ['claim-one'] }], body: `PAID BODY SECRET ${id}`, hash: '', createdAt: stamp, limitations: [] };
  draft.hash = draftHash(draft);
  const story: Story = { id: `story-${id}`, title: draft.headline, summary: 'Track notice', mode: 'live', status: 'published', selectedReason: 'Official notice', researchAgentIds: [2], peAgentId: 1, sourceItems: [source.id], claims: [], findings: [], gaps: [], media: [], draft, compliance: [], approvals: [{ id: `approval-${id}`, decision: 'approve', note: 'Reviewed', actor: 'James', draftHash: draft.hash, wageringAcknowledged: false, createdAt: stamp }], wagering: false, createdAt: stamp, updatedAt: stamp };
  const publication: Publication = { id, storyId: story.id, mode: 'live', public: true, draftHash: draft.hash, draft, approvedBy: 'James', approvedAt: stamp, publishedAt: stamp };
  await transact(data => { data.state.sourceItems.push(source); data.state.stories.push(story); data.state.publications.push(publication); });
  return publication;
}
const input = (ids = ['pub-one']) => ({ number: 1, date: '2026-09-10', title: 'This Thursday in racing', preview: 'A short, owner-reviewed free preview.', publicationIds: ids });
async function released() { await seedPublication(); const edition = await createEdition(input()); return releaseEdition(edition.id, edition.reviewHash); }
async function login() {
  const token = randomBytes(32).toString('base64url');
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.links[createHash('sha256').update(token).digest('hex')] = { email: reader.email, expires: Date.now() + 60_000, deliveryConsent: true }; });
  return consumeMagicLink(token);
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function ownerRequest(id: string, action: string, hash: string, origin = 'https://post.example.org') {
  return new Request(`https://post.example.org/api/owner/editions/${id}`, { method: 'POST', headers: { cookie: `newsroom_session=${signSession()}`, origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, expectedReviewHash: hash }) });
}
function webhook(type: string, emailId = 'provider-one', eventId = randomUUID(), jobId?: string) {
  const body = JSON.stringify({ type, data: { email_id: emailId, to: [reader.email], ...(jobId ? { tags: { delivery_job: jobId } } : {}) } });
  const date = new Date();
  return new Request('https://post.example.org/api/webhooks/delivery', { method: 'POST', body, headers: { 'svix-id': eventId, 'svix-timestamp': String(Math.floor(date.getTime() / 1000)), 'svix-signature': new Webhook(process.env.RESEND_DELIVERY_WEBHOOK_SECRET!).sign(eventId, date, body) } });
}

test('editions reject unapproved, demo, fixture-backed and withdrawn publications', async () => {
  await seedPublication();
  await transact(data => { data.state.stories[0].approvals = []; });
  await assert.rejects(() => createEdition(input()), /approved, current live/);
  await transact(data => { data.state.publications = []; data.state.stories = []; data.state.sourceItems = []; });
  await seedPublication();
  await transact(data => { data.state.publications[0].mode = 'demo'; });
  await assert.rejects(() => createEdition(input()), /approved, current live/);
  await transact(data => { data.state.publications[0].mode = 'live'; data.state.sourceItems[0].demo = true; });
  await assert.rejects(() => createEdition(input()), /approved, current live/);
  await transact(data => { data.state.sourceItems[0].demo = false; data.state.publications[0].status = 'retracted'; });
  await assert.rejects(() => createEdition(input()), /approved, current live/);
});

test('edition order, immutable snapshots, dates and reviewed hashes are enforced', async () => {
  await seedPublication(); await seedPublication('pub-two');
  await assert.rejects(() => createEdition({ ...input(), date: '2026-02-30' }));
  const edition = await createEdition(input(['pub-two', 'pub-one']));
  assert.equal(edition.articles[0].publicationId, 'pub-two');
  assert.equal((await listEditions()).length, 0);
  await assert.rejects(() => releaseEdition(edition.id, 'stale'), /changed/);
  const updated = await updateEdition(edition.id, { ...input(['pub-one', 'pub-two']), title: 'Changed title' }, edition.reviewHash);
  await assert.rejects(() => releaseEdition(edition.id, edition.reviewHash), /changed/);
  await releaseEdition(edition.id, updated.reviewHash);
  await assert.rejects(() => updateEdition(edition.id, input(), updated.reviewHash), /cannot be edited/);
  assert.equal((await getDeliveryStatus()).jobs.length, 0, 'Release alone must never enqueue email');
  await closeDocuments();
  assert.equal((await getEdition(edition.id)).status, 'released', 'Released snapshot survives restart');
});

test('public APIs reveal only explicit previews and paid body requires current entitlement', async () => {
  const edition = await released();
  const anonymous = await publicEdition(new Request('https://post.example.org/api/editions/test'), context(edition.id));
  assert.equal(anonymous.status, 200); assert.doesNotMatch(await anonymous.text(), /PAID BODY SECRET/);
  assert.doesNotMatch(await (await publicList()).text(), /PAID BODY SECRET/);
  const token = await login();
  const request = () => new Request('https://post.example.org/api/editions/test', { headers: { cookie: `thursday_member=${token}` } });
  assert.match(await (await publicEdition(request(), context(edition.id))).text(), /PAID BODY SECRET/);
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[reader.id].subscription.status = 'refunded'; });
  assert.doesNotMatch(await (await publicEdition(request(), context(edition.id))).text(), /PAID BODY SECRET/);
  await transact(data => { data.state.publications[0].status = 'removed'; });
  assert.equal((await currentEditionArticles(edition)).length, 0);
  assert.match((await editionPreview(edition)).preview, /withdrawn/);
});

test('owner edition mutations reject anonymous and cross-origin requests', async () => {
  const edition = await released();
  const anonymous = new Request('https://post.example.org/api/owner/editions', { method: 'POST', body: JSON.stringify(input()) });
  assert.equal((await createRoute(anonymous)).status, 401);
  assert.equal((await ownerAction(ownerRequest(edition.id, 'send', edition.reviewHash, 'https://attacker.example'), context(edition.id))).status, 403);
  assert.equal((await getDeliveryStatus()).jobs.length, 0);
});

test('SEND queues once, snapshots confirmed paid consent and sends escaped content with unsubscribe headers', async () => {
  const edition = await released();
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => {
    const unpaid = { ...member(), id: randomUUID(), email: 'unpaid@example.org', subscription: { ...reader.subscription, status: 'none' as const } };
    const noConsent = { ...member(), id: randomUUID(), email: 'no-consent@example.org', consentAt: null };
    data.members[unpaid.id] = unpaid; data.members[noConsent.id] = noConsent;
  });
  const queued = await queueEditionDelivery(edition.id, edition.reviewHash);
  assert.equal(queued.queued, 1);
  assert.equal((await queueEditionDelivery(edition.id, edition.reviewHash)).alreadyQueued, true);
  let calls = 0;
  globalThis.fetch = async (url, init) => { calls++; assert.equal(String(url), 'https://api.resend.com/emails'); const body = JSON.parse(String(init?.body)); assert.equal(body.reply_to, 'workbenchadmin@gmail.com'); assert.match(body.text, /PAID BODY SECRET/); assert.match(body.headers['List-Unsubscribe'], /api\/unsubscribe\?token=/); assert.equal(body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click'); return Response.json({ id: 'provider-one' }); };
  assert.equal((await processDeliveryQueue()).sent, 1);
  assert.equal((await processDeliveryQueue()).processed, 0);
  assert.equal(calls, 1);
  assert.equal((await getDeliveryStatus()).counts.sent, 1);
});

test('queue and delivery fail closed when configuration is missing', async () => {
  const edition = await released();
  delete process.env.RESEND_API_KEY;
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(); };
  await assert.rejects(() => queueEditionDelivery(edition.id, edition.reviewHash), /requires/);
  assert.equal((await processDeliveryQueue()).configured, false);
  assert.equal(calls, 0);
});

test('atomic leases stop overlapping workers and preserve deterministic retry payloads', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  const requests: { key: string; body: string }[] = [];
  let allowFirst: (() => void) | undefined;
  globalThis.fetch = async (_url, init) => {
    requests.push({ key: new Headers(init?.headers).get('Idempotency-Key')!, body: String(init?.body) });
    if (requests.length === 1) { await new Promise<void>(resolve => { allowFirst = resolve; }); throw new Error('Ambiguous provider timeout'); }
    return Response.json({ id: 'provider-one' });
  };
  const first = processDeliveryQueue();
  while (!allowFirst) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await processDeliveryQueue()).processed, 0);
  allowFirst(); await first;
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => { data.jobs[0].nextAttemptAt = 0; });
  assert.equal((await processDeliveryQueue()).sent, 1);
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
});

test('attempts beyond the provider idempotency window never resend', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => { Object.assign(data.jobs[0], { status: 'sending', attempts: 1, firstAttemptAt: Date.now() - 24 * 60 * 60 * 1000, lease: { id: 'expired', until: Date.now() - 1 } }); });
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ id: 'provider-one' }); };
  await processDeliveryQueue();
  assert.equal(calls, 0); assert.equal((await getDeliveryStatus()).counts.failed, 1);
});

test('withdrawals cancel pending delivery before any provider call', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  await transact(data => { data.state.publications[0].status = 'retracted'; });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(); };
  await processDeliveryQueue(); assert.equal(calls, 0); assert.equal((await getDeliveryStatus()).counts.cancelled, 1);
  await assert.rejects(() => queueEditionDelivery(edition.id, edition.reviewHash), /withdrawn/);
});

test('signed bounce and complaint webhooks suppress future delivery without changing billing', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  globalThis.fetch = async () => Response.json({ id: 'provider-one' });
  await processDeliveryQueue();
  const id = randomUUID();
  await receiveDeliveryWebhook(webhook('email.bounced', 'provider-one', id));
  await receiveDeliveryWebhook(webhook('email.bounced', 'provider-one', id));
  await receiveDeliveryWebhook(webhook('email.delivered'));
  const state = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  assert.equal(state.members[reader.id].subscription.status, 'active');
  assert.equal(state.members[reader.id].deliveryEnabled, false);
  assert.equal((await getDeliveryStatus()).counts.suppressed, 1);
  assert.equal((await readDocument(DELIVERY_DOCUMENT, initialDelivery)).webhookIds.filter(value => value === id).length, 1);
  await assert.rejects(() => receiveDeliveryWebhook(new Request('https://post.example.org/api/webhooks/delivery', { method: 'POST', body: JSON.stringify({ type: 'email.complained', data: { email_id: 'provider-one' } }) })));
});

test('unsubscribe GET has no side effects; signed POST stops mail and leaves subscription active', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  const token = unsubscribeToken(reader.id);
  assert.equal((await unsubscribeGet(new Request(`https://post.example.org/api/unsubscribe?token=${token}`))).status, 200);
  assert.equal((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[reader.id].deliveryEnabled, true);
  await assert.rejects(() => unsubscribeDelivery(`${token}forged`), /invalid/);
  const response = await unsubscribePost(new Request(`https://post.example.org/api/unsubscribe?token=${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }));
  assert.equal(response.status, 200);
  const state = await readDocument(COMMERCE_DOCUMENT, initialCommerce);
  assert.equal(state.members[reader.id].deliveryEnabled, false); assert.equal(state.members[reader.id].subscription.status, 'active');
  assert.equal((await getDeliveryStatus()).counts.suppressed, 1);
});

test('expired sending leases recover inside the retry window and stop after bounded attempts', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => { Object.assign(data.jobs[0], { status: 'sending', attempts: 1, firstAttemptAt: Date.now() - 100_000, lease: { id: 'expired', until: Date.now() - 1 } }); });
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ error: 'temporary' }, { status: 503 }); };
  await processDeliveryQueue();
  assert.equal(calls, 1);
  assert.equal((await getDeliveryStatus()).counts.pending, 1);
  await updateDocument(DELIVERY_DOCUMENT, initialDelivery, data => { data.jobs[0].attempts = 5; data.jobs[0].nextAttemptAt = 0; });
  await processDeliveryQueue();
  assert.equal(calls, 1); assert.equal((await getDeliveryStatus()).counts.failed, 1);
});

test('a canceled membership is rechecked after queueing and never receives an edition', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[reader.id].subscription.status = 'canceled'; });
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error(); };
  await processDeliveryQueue();
  assert.equal(calls, 0); assert.equal((await getDeliveryStatus()).counts.suppressed, 1);
});

test('webhook tags correlate delivery before the provider response, unrelated email events do not', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  const job = (await readDocument(DELIVERY_DOCUMENT, initialDelivery)).jobs[0];
  globalThis.fetch = async () => {
    await receiveDeliveryWebhook(webhook('email.delivered', 'unrelated-signin-message'));
    assert.equal((await getDeliveryStatus()).counts.delivered, 0);
    await receiveDeliveryWebhook(webhook('email.delivered', 'provider-one', randomUUID(), job.id));
    return Response.json({ id: 'provider-one' });
  };
  await processDeliveryQueue();
  assert.equal((await getDeliveryStatus()).counts.delivered, 1, 'Send confirmation must not downgrade delivered status');
});

test('complaints received while sending cancel the lease and remain suppressed after send confirmation', async () => {
  const edition = await released(); await queueEditionDelivery(edition.id, edition.reviewHash);
  const job = (await readDocument(DELIVERY_DOCUMENT, initialDelivery)).jobs[0];
  globalThis.fetch = async () => { await receiveDeliveryWebhook(webhook('email.complained', 'provider-one', randomUUID(), job.id)); return Response.json({ id: 'provider-one' }); };
  await processDeliveryQueue();
  assert.equal((await getDeliveryStatus()).counts.suppressed, 1);
  assert.equal((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members[reader.id].subscription.status, 'active');
});
