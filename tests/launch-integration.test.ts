import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { closeStore, readStore, transact, initialStore } from '../src/lib/store';
import { closeDocuments, readDocument, updateDocument } from '../src/lib/durable-store';
import { createState, decideStory, editStoryDraft, runNewsroom } from '../src/lib/engine';
import { COMMERCE_DOCUMENT, initialCommerce } from '../src/lib/commerce-types';
import { consumeMagicLink, currentMember, memberCookie, requestMagicLink } from '../src/lib/members';
import { isLocalAccess, requireSameOrigin, signSession } from '../src/lib/auth';
import type { Publication, SourceItem } from '../src/lib/domain';
import { GET as publicGET } from '../src/app/api/public/route';
import { POST as editorialPOST } from '../src/app/api/editorial/route';
import { GET as newsroomGET, POST as newsroomPOST } from '../src/app/api/newsroom/route';
import { GET as sourceGET } from '../src/app/api/sources/[id]/route';

const folder = mkdtempSync(join(tmpdir(), 'thursday-launch-integration-'));
const tempRoot = resolve(tmpdir());
process.env.NEWSROOM_DB_FILE = join(folder, 'newsroom.sqlite');
process.env.NEWSROOM_DOCUMENT_DB_FILE = join(folder, 'documents.sqlite');
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
process.env.AUTH_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex');
process.env.MEMBER_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NEWSROOM_PUBLIC_URL = 'https://paper.example';
process.env.RESEND_FROM_EMAIL = 'The Thursday Post <members@paper.example>';
process.env.RESEND_API_KEY = 're_integration_test_only';
process.env.STRIPE_SECRET_KEY = 'sk_test_integration_local_only';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_integration_local_only';
process.env.LOCAL_DEMO_ACCESS = 'false';

beforeEach(async () => {
  process.env.LOCAL_DEMO_ACCESS = 'false'; delete process.env.VERCEL;
  await transact(data => { Object.assign(data, initialStore()); });
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { Object.assign(data, initialCommerce()); });
});
after(async () => {
  await closeStore(); await closeDocuments();
  const resolved = resolve(folder);
  assert.ok(resolved.startsWith(tempRoot + sep) && resolved.includes('thursday-launch-integration-'), 'cleanup must remain in this test temporary directory');
  rmSync(resolved, { recursive: true, force: true });
});

const privateSentinels = ['PRIVATE-SOURCE-RAW', 'PRIVATE-SOURCE-EXTRA', 'PRIVATE-EMAIL-BODY', 'private-informant@example.org', 'PRIVATE-EDITOR-SUMMARY', 'PRIVATE-EDITOR-ASSESSMENT', 'PRIVATE-FACT-REVIEW', 'PRIVATE-APPROVAL-NOTE', 'PRIVATE-REPLY-NOTE', 'PRIVATE-ERROR', 'PRIVATE-AUDIT', 'PRIVATE-PROPOSED-HEADLINE'];
const subscriberParagraph = 'SUBSCRIBER-COMPLETE-REPORT: The archived consultation remains open; the full subscriber briefing explains its context.';
const withdrawnDeck = 'WITHDRAWN-DECK-CONTENT: a claim that must disappear when this report is retracted.';
const primary = (): SourceItem => ({ id: 'launch-primary', title: 'Authority consultation record', content: 'The racing authority opened a thoroughbred track safety consultation. PRIVATE-SOURCE-EXTRA remains an archived-only appendix.', rawOriginal: 'PRIVATE-SOURCE-RAW', url: 'https://records.example.org/thoroughbred-safety', type: 'official', sourceName: 'Racing Authority', independenceKey: 'authority', publishedAt: '2026-09-09T00:00:00Z', retrievedAt: '2026-09-09T01:00:00Z' });
const privateMail = (): SourceItem => ({ id: 'launch-private-email', title: 'Private lead', content: 'PRIVATE-EMAIL-BODY', rawOriginal: 'PRIVATE-EMAIL-BODY', url: 'email:private-message', type: 'email', sourceName: 'Private informant', independenceKey: 'reader-mail', publishedAt: '2026-09-09T00:00:00Z', retrievedAt: '2026-09-09T01:00:00Z', email: { messageId: 'private-message', from: 'private-informant@example.org', subject: 'Private lead', receivedAt: '2026-09-09T00:00:00Z', original: 'PRIVATE-EMAIL-BODY' } });

function request(path: string, options: { cookie?: string; body?: unknown; origin?: string | null; host?: string; url?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin !== null) headers.origin = options.origin || 'https://paper.example';
  if (options.host) headers.host = options.host;
  return new Request(options.url || `https://paper.example${path}`, { headers, method: options.body === undefined ? 'GET' : 'POST', ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
}
const owner = () => `newsroom_session=${signSession()}`;
async function account(status: 'active' | 'canceled' | 'none' | 'trialing' = 'active') {
  let token = '';
  await requestMagicLink(request('/api/member'), { email: `${status}@reader.example`, deliveryConsent: true }, async mail => { token = new URLSearchParams(new URL(mail.url).hash.slice(1)).get('token')!; });
  const session = await consumeMagicLink(token);
  const cookie = memberCookie(session, request('/api/member')).split(';')[0];
  const member = (await currentMember(request('/api/member', { cookie })))!;
  // The Stripe boundary is simulated by a canonical durable subscription snapshot; no external API is called.
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[member.id].subscription = { stripeMode: 'test', id: status === 'none' ? null : 'sub_fixture', status, paidThrough: new Date(Date.now() + 86400000).toISOString(), cancelAtPeriodEnd: false, latestInvoiceId: 'in_fixture', reconciledAt: new Date().toISOString() }; });
  return { cookie, memberId: member.id };
}
async function readyDraft() {
  const state = createState();
  await runNewsroom(state, { mode: 'live', items: [primary()] });
  const story = state.stories[0];
  assert.ok(story.draft);
  const claim = story.claims.find(item => item.status === 'verified')!;
  editStoryDraft(state, story.id, { headline: 'Authority opens consultation on track safety', sentences: [{ text: 'A public preview introduces the authority’s consultation.', claimIds: [claim.id] }, { text: subscriberParagraph, claimIds: [claim.id] }], note: 'PRIVATE-FACT-REVIEW: I checked the attributed narrative against the source.', humanReviewed: true, expectedDraftHash: story.draft.hash, deck: withdrawnDeck, access: 'members' });
  story.summary = 'PRIVATE-EDITOR-SUMMARY'; story.selectedReason = 'PRIVATE-EDITOR-ASSESSMENT'; story.editorialTone = 'N'; story.error = 'PRIVATE-ERROR';
  story.rightOfReply = { status: 'not_required', note: 'PRIVATE-REPLY-NOTE', sourceIds: [], recordedAt: new Date().toISOString(), actor: 'James' };
  story.proposedDraft = { headline: 'PRIVATE-PROPOSED-HEADLINE', sentences: [], status: 'requires_human_review', createdAt: new Date().toISOString() };
  const mail = privateMail(); state.sourceItems.push(mail); story.sourceItems.push(mail.id);
  // A draft can cite a verified public record and retain related private evidence without exposing the latter.
  claim.evidence.push({ id: 'private-related-evidence', sourceId: mail.id, quote: mail.content, relation: 'supports', exactMatch: true, independenceKey: mail.independenceKey, recordedAt: new Date().toISOString() });
  state.audit.push({ id: 'private-audit', action: 'private_review', detail: 'PRIVATE-AUDIT', createdAt: new Date().toISOString() });
  await transact(data => { data.state = state; data.inbox = [mail]; });
  return story;
}
async function published() {
  const story = await readyDraft();
  await transact(data => { decideStory(data.state, story.id, 'approve', 'PRIVATE-APPROVAL-NOTE', false); });
  return (await readStore()).state.publications[0];
}
function noPrivateFields(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const marker of privateSentinels) assert.equal(text.includes(marker), false, `${marker} must not reach readers`);
  for (const name of ['editorialTone', 'rightOfReply', 'factReview', 'draftHistory', 'proposedDraft', 'rawOriginal', 'independenceKey', 'verificationScope', 'sourceItems', 'approvals']) assert.equal(text.includes(`"${name}"`), false, `${name} is an internal field`);
}
type ReaderArticle = { id: string; locked: boolean; paragraphs: Array<{ text: string }>; sources: Array<{ title: string; url: string }>; limitations: string[]; excerpt: string; status: string; deck?: string; correctionId?: string; correctionOf?: string; notice?: string };
type ReaderPayload = { articles: ReaderArticle[]; memberAccess: boolean };
async function reader(cookie?: string) {
  const response = await publicGET(request('/api/public', { cookie }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
  const payload = await response.json() as ReaderPayload; noPrivateFields(payload); return payload;
}

test('public API enforces subscriber, canceled, expired and anonymous access without private research leakage', async () => {
  const publication = await published();
  const active = await account('active'); const canceled = await account('canceled'); const unpaid = await account('none');
  for (const cookie of [undefined, canceled.cookie, unpaid.cookie, owner()]) {
    const payload = await reader(cookie); const article = payload.articles.find(item => item.id === publication.id)!;
    assert.equal(payload.memberAccess, false); assert.equal(article.locked, true); assert.deepEqual(article.paragraphs, []); assert.deepEqual(article.sources, []); assert.deepEqual(article.limitations, []);
    assert.equal(JSON.stringify(payload).includes(subscriberParagraph), false);
  }
  const payload = await reader(active.cookie); const article = payload.articles[0];
  assert.equal(payload.memberAccess, true); assert.equal(article.locked, false); assert.equal(article.paragraphs[1].text, subscriberParagraph);
  assert.deepEqual(article.sources, [{ title: primary().title, url: primary().url }]);
  const testKey = process.env.STRIPE_SECRET_KEY;
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_live_launch_fixture_only';
    const livePayload = await reader(active.cookie);
    assert.equal(livePayload.memberAccess, false); assert.equal(livePayload.articles[0].locked, true);
    assert.equal(JSON.stringify(livePayload).includes(subscriberParagraph), false, 'test subscriber cookies cannot unlock live article bodies');
  } finally { if (testKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = testKey; }
  await updateDocument(COMMERCE_DOCUMENT, initialCommerce, data => { data.members[active.memberId].subscription.paidThrough = new Date(Date.now() - 1000).toISOString(); });
  assert.equal((await reader(active.cookie)).articles[0].locked, true);
});

test('free samples are visible to all; private snapshots and every demo publication remain excluded', async () => {
  const publication = await published();
  const reply = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { action: 'publication_access', publicationId: publication.id, access: 'public', note: 'PRIVATE-EDITOR-ASSESSMENT: owner chooses this article as the launch sample.' } }));
  assert.equal(reply.status, 200);
  await transact(data => {
    data.state.publications.push({ ...structuredClone(publication), id: 'private-live', public: false }, { ...structuredClone(publication), id: 'private-demo', mode: 'demo', public: false }, { ...structuredClone(publication), id: 'demo-marked-public', mode: 'demo', public: true, access: 'public' });
  });
  const payload = await reader();
  assert.equal(payload.articles.length, 1); assert.equal(payload.articles[0].locked, false); assert.equal(payload.articles[0].paragraphs[1].text, subscriberParagraph);
  assert.equal(JSON.stringify(payload).includes('private-live'), false); assert.equal(JSON.stringify(payload).includes('demo'), false);
  const restore = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { action: 'publication_access', publicationId: 'private-demo', access: 'public', note: 'Try to expose a synthetic demonstration as a public sample.' } }));
  assert.equal(restore.status, 409);
});

test('retraction removes all article prose including its deck and removal hides the entry while preserving the snapshot', async () => {
  const publication = await published(); const active = await account();
  const original = structuredClone(publication.draft);
  const response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { action: 'publication_status', publicationId: publication.id, status: 'retracted', note: 'This report is withdrawn while an error is reviewed.' } }));
  assert.equal(response.status, 200);
  for (const cookie of [undefined, active.cookie]) {
    const payload = await reader(cookie); const article = payload.articles[0];
    assert.equal(article.status, 'retracted'); assert.deepEqual(article.paragraphs, []); assert.deepEqual(article.sources, []); assert.equal(article.excerpt, '');
    assert.equal(JSON.stringify(payload).includes(withdrawnDeck), false, 'retracted decks must not continue publishing withdrawn claims');
    assert.match(article.notice!, /withdrawn/);
  }
  const removed = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { action: 'publication_status', publicationId: publication.id, status: 'removed', note: 'Remove this withdrawn report from reader access.' } }));
  assert.equal(removed.status, 200); assert.equal((await reader(active.cookie)).articles.length, 0);
  assert.deepEqual((await readStore()).state.publications[0].draft, original);
});

test('published corrections link to the original without leaking unapproved correction drafts', async () => {
  const publication = await published();
  const created = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { action: 'correction', publicationId: publication.id, reason: 'Clarify that the record announces a consultation, rather than an adopted rule.', sourceIds: [primary().id] } }));
  assert.equal(created.status, 200);
  const correctionStory = (await readStore()).state.stories.find(story => story.correctionOf === publication.id)!;
  let payload = await reader(); assert.equal(payload.articles.length, 1); assert.equal(payload.articles[0].correctionId, undefined);
  // A separate approved snapshot represents a correction already through the editorial workflow.
  const correction: Publication = { ...structuredClone(publication), id: 'approved-correction', storyId: correctionStory.id, correctionOf: publication.id, correctionReason: 'The notice announced consultation, not adoption.', access: 'public', draft: { ...structuredClone(publication.draft), label: 'correction' } };
  await transact(data => { data.state.publications.push(correction); });
  payload = await reader(); const original = payload.articles.find(article => article.id === publication.id)!; const publicCorrection = payload.articles.find(article => article.id === correction.id)!;
  assert.equal(original.correctionId, correction.id); assert.equal(publicCorrection.correctionOf, publication.id); assert.equal(publicCorrection.locked, false); assert.match(publicCorrection.notice!, /not adoption/);
  await transact(data => { data.state.publications.find(item => item.id === correction.id)!.status = 'removed'; });
  payload = await reader(); assert.equal(payload.articles.length, 1); assert.equal(payload.articles[0].correctionId, undefined);
});

test('member identity cannot read owner APIs or private originals and cross-origin owner writes are rejected', async () => {
  const story = await readyDraft(); const active = await account();
  const change = { action: 'edit_draft', storyId: story.id, headline: 'A reviewed authority consultation', sentences: story.draft!.sentences, note: 'I verified the narrative against the public record.', humanReviewed: true, expectedDraftHash: story.draft!.hash };
  for (const cookie of [undefined, active.cookie]) {
    assert.equal((await newsroomGET(request('/api/newsroom', { cookie }))).status, 401);
    assert.equal((await editorialPOST(request('/api/editorial', { cookie, body: change }))).status, 401);
    assert.equal((await sourceGET(request('/api/sources/launch-private-email', { cookie }), { params: Promise.resolve({ id: 'launch-private-email' }) })).status, 401);
  }
  for (const origin of [null, 'https://attacker.example', 'https://paper.example.attacker.example', 'http://paper.example']) {
    const response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: change, origin }));
    assert.equal(response.status, 403, `${origin} must not authorize a same-origin edit`);
  }
  const original = await sourceGET(request('/api/sources/launch-private-email', { cookie: owner() }), { params: Promise.resolve({ id: 'launch-private-email' }) });
  assert.equal(original.status, 200); assert.equal(await original.text(), 'PRIVATE-EMAIL-BODY'); assert.equal(original.headers.get('cache-control'), 'private, no-store');
  assert.equal((await readStore()).state.stories[0].draft!.hash, story.draft!.hash);
});

test('local demonstration owner bypass requires a loopback request authority and is disabled on Vercel', () => {
  process.env.LOCAL_DEMO_ACCESS = 'true';
  assert.equal(isLocalAccess(request('/api/newsroom', { url: 'http://localhost:3000/api/newsroom', host: 'localhost:3000' })), true);
  assert.equal(isLocalAccess(request('/api/newsroom', { url: 'http://localhost:3000/api/newsroom', host: 'public.example' })), false, 'a local internal URL must not grant owner access for a remote Host');
  assert.equal(isLocalAccess(new Request('http://localhost:3000/api/newsroom', { headers: { host: 'localhost:3000', 'x-forwarded-host': 'public.example, localhost:3000' } })), false, 'a forwarded public authority must not gain the local owner bypass');
  assert.equal(isLocalAccess(request('/api/newsroom', { url: 'https://paper.example/api/newsroom', host: 'paper.example' })), false);
  process.env.VERCEL = '1';
  assert.equal(isLocalAccess(request('/api/newsroom', { url: 'http://localhost:3000/api/newsroom', host: 'localhost:3000' })), false);
  assert.doesNotThrow(() => requireSameOrigin(request('/api/newsroom', { url: 'http://localhost:3000/api/newsroom', host: 'paper.example', origin: 'https://paper.example' })));
  assert.throws(() => requireSameOrigin(request('/api/newsroom', { url: 'http://localhost:3000/api/newsroom', host: 'paper.example', origin: 'https://attacker.example' })), /must come from/);
  delete process.env.VERCEL; process.env.LOCAL_DEMO_ACCESS = 'false';
});

test('draft edits invalidate stale approval; adverse tone blocks publication until a valid right-of-reply outcome', async () => {
  const story = await readyDraft(); const originalHash = story.draft!.hash;
  await transact(data => { delete data.state.stories.find(item => item.id === story.id)!.rightOfReply; });
  const edit = { action: 'edit_draft', storyId: story.id, headline: 'Authority consultation faces an editorial review', sentences: story.draft!.sentences, note: 'PRIVATE-FACT-REVIEW: reviewed the source and classified this report as adverse.', humanReviewed: true, expectedDraftHash: originalHash, editorialTone: 'B' };
  let response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: edit }));
  assert.equal(response.status, 200);
  let saved = (await readStore()).state.stories.find(item => item.id === story.id)!;
  assert.equal(saved.editorialTone, 'B'); assert.equal(saved.status, 'blocked', 'an adverse draft needs its own right-of-reply outcome');
  // Record a real outstanding reply request; this must close the publication gate.
  response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { action: 'right_of_reply', storyId: story.id, status: 'requested', note: 'PRIVATE-REPLY-NOTE: the authority has been invited to respond.', recipient: 'Authority media office', requestedAt: new Date(Date.now() - 3600000).toISOString(), deadline: new Date(Date.now() + 3600000).toISOString(), sourceIds: [], expectedDraftHash: saved.draft!.hash } }));
  assert.equal(response.status, 200);
  saved = (await readStore()).state.stories.find(item => item.id === story.id)!;
  assert.equal(saved.status, 'blocked'); assert.notEqual(saved.draft!.hash, originalHash);
  response = await newsroomPOST(request('/api/newsroom', { cookie: owner(), body: { action: 'decision', storyId: story.id, decision: 'approve', expectedDraftHash: originalHash } }));
  assert.equal(response.status, 409);
  response = await newsroomPOST(request('/api/newsroom', { cookie: owner(), body: { action: 'decision', storyId: story.id, decision: 'approve', expectedDraftHash: saved.draft!.hash } }));
  assert.equal(response.status, 409); assert.equal((await reader()).articles.length, 0);
  const replyBase = { action: 'right_of_reply', storyId: story.id, note: 'PRIVATE-REPLY-NOTE: retain the authentic response status.', recipient: 'Authority media office', requestedAt: new Date(Date.now() - 3600000).toISOString(), sourceIds: [], expectedDraftHash: saved.draft!.hash };
  response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { ...replyBase, status: 'received' } }));
  assert.equal(response.status, 409, 'a response cannot be invented without archived evidence');
  response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { ...replyBase, status: 'no_response', deadline: new Date(Date.now() + 3600000).toISOString() } }));
  assert.equal(response.status, 409, 'a future response deadline must not count as no response');
  response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: { ...replyBase, status: 'no_response', deadline: new Date(Date.now() - 1000).toISOString() } }));
  assert.equal(response.status, 200);
  saved = (await readStore()).state.stories.find(item => item.id === story.id)!;
  assert.equal(saved.status, 'waiting_approval');
  response = await newsroomPOST(request('/api/newsroom', { cookie: owner(), body: { action: 'decision', storyId: story.id, decision: 'approve', expectedDraftHash: saved.draft!.hash, note: 'PRIVATE-APPROVAL-NOTE' } }));
  assert.equal(response.status, 200); assert.equal((await reader()).articles.length, 1);
  response = await editorialPOST(request('/api/editorial', { cookie: owner(), body: edit }));
  assert.equal(response.status, 409, 'published text cannot be edited in place');
  assert.ok((await readStore()).state.stories[0].draftHistory!.some(draft => draft.hash === originalHash));
  assert.equal(Object.keys((await readDocument(COMMERCE_DOCUMENT, initialCommerce)).members).length, 0);
});
